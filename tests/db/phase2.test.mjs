// Phase 2 database checks: stage the real export, commit drafts, prove idempotency and privacy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { parseTrackerTsv, summarise } from "../../src/lib/import/trackerTsv.ts";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const EDITOR = "00000000-0000-0000-0000-00000000000e";
const dir = new URL("../../db/migrations/", import.meta.url);
const text = readFileSync(new URL("../../data/source/tracker-export-2026-10-10.tsv", import.meta.url), "utf8");
const parsed = parseTrackerTsv(text);

// Every migration, so the import functions are tested as they run today (0009 redefines one).
const db = new PGlite();
for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  await db.exec(readFileSync(new URL(f, dir), "utf8"));
}
await db.exec(`insert into app_users (id, email, display_name, is_fixture) values
  ('${ADMIN}', 'admin@example.test', 'Fixture admin', true), ('${EDITOR}', 'editor@example.test', 'Fixture editor', true);`);
await db.exec(`insert into team_memberships (user_id, role, display_name) values
  ('${ADMIN}', 'admin', 'Fixture admin'), ('${EDITOR}', 'editor', 'Fixture editor');`);

async function as(user, q, params = []) {
  await db.exec(`select set_config('nut.user_id', '${user ?? ""}', false); set role ${user ? "nut_member" : "nut_anon"};`);
  try { return (await db.query(q, params)).rows; } finally { await db.exec("reset role;"); }
}
const one = async (user, q, params) => Object.values((await as(user, q, params))[0])[0];
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);
const stage = (user) => one(user, "select stage_import($1, $2, $3, $4, $5, $6)", [
  "tracker-export-2026-10-10.tsv", text, parsed.reportedAsOf, "trackerTsv@1",
  JSON.stringify({ ...summarise(parsed), ignored: parsed.ignored }), JSON.stringify(parsed.rows),
]);
const count = async (q) => Number(Object.values((await db.query(q)).rows[0])[0]);

let importId;

test("only an administrator can stage an import", async () => {
  await rejects(stage(EDITOR), "42501");
  await rejects(stage(null), "42501");
});

test("staging stores 399 rows with provenance, holds and legacy claims", async () => {
  importId = await stage(ADMIN);
  assert.equal(await count(`select count(*) from import_rows where import_id = '${importId}'`), 399);
  assert.equal(await count(`select count(*) from import_rows where serial_raw = '#REF!'`), 45);
  assert.equal(await count(`select count(*) from import_rows where mapped->>'name' is null and held`), 4);
  assert.equal(await count(`select count(*) from import_rows r, jsonb_each(r.legacy_indicators) e where e.value = 'null'::jsonb`), 6);
  assert.equal(await count(`select count(*) from imports where source_reported_as_of = '2026-10-10'`), 1);
  const afit = await db.query(`select held from import_rows where mapped->>'name' like 'Air Force Institute of Technology%'`);
  assert.deepEqual(afit.rows.map((r) => r.held), [true, true]);
});

test("staging the same file again returns the same import and adds nothing", async () => {
  assert.equal(await stage(ADMIN), importId);
  assert.equal(await count("select count(*) from imports"), 1);
  assert.equal(await count("select count(*) from import_rows"), 399);
});

test("commit creates private drafts only for unheld rows, starting unassessed", async () => {
  await rejects(as(EDITOR, "select commit_import($1)", [importId]), "42501");
  const res = await one(ADMIN, "select commit_import($1)", [importId]);
  assert.equal(res.created, 329);
  assert.equal(res.held, 70);
  assert.equal(await count("select count(*) from institutions"), 329);
  assert.equal(await count("select count(*) from revisions where status = 'draft'"), 329);
  assert.equal(await count("select count(*) from revision_indicators where state <> 'not_assessed'"), 0);
  assert.equal(await count("select count(*) from published_snapshots"), 0);
  assert.equal(await count("select count(*) from revisions where last_verified_at is not null"), 0);
  // Legacy status kept verbatim on the draft; the website kept only when written as one valid URL.
  const unn = (await db.query(`select legacy_report_status, website_url, state from revisions where name = 'University of Nigeria, Nsukka'`)).rows[0];
  assert.deepEqual(unn, { legacy_report_status: "YES", website_url: "https://www.unn.edu.ng", state: "Enugu" });
  // A repaired address (https:// added) and a town in the state column are not written as data.
  const forestry = (await db.query(`select website_url, state from revisions where name like 'Federal College of Forestry Resources Management, Maiduguri%'`)).rows[0];
  assert.deepEqual(forestry, { website_url: null, state: null });
  const lautech = (await db.query(`select state, city from revisions where name = 'Ladoke Akintola University of Technology'`)).rows[0];
  assert.deepEqual(lautech, { state: null, city: "Ogbomoso" });
  assert.equal(await count("select count(*) from revisions where website_url is not null"), 240);
});

test("committing again creates nothing new", async () => {
  const res = await one(ADMIN, "select commit_import($1)", [importId]);
  assert.equal(res.created, 0);
  assert.equal(res.already_committed, 329);
  assert.equal(await count("select count(*) from institutions"), 329);
});

test("AFIT is resolved only by explicit human decisions", async () => {
  const [univ, poly] = (await db.query(`select id from import_rows where mapped->>'name' like 'Air Force Institute of Technology%' order by source_line`)).rows.map((r) => r.id);
  await as(ADMIN, "select decide_import_row($1, 'create_new', null, 'Treat as one institution')", [univ]);
  const res = await one(ADMIN, "select commit_import($1)", [importId]);
  assert.equal(res.created, 1);
  const inst = await one(ADMIN, "select institution_id from import_rows where id = $1", [univ]);
  await rejects(as(ADMIN, "select decide_import_row($1, 'match_existing', $2, null)", [poly, inst]), "23514"); // reason required
  await as(ADMIN, "select decide_import_row($1, 'match_existing', $2, 'Same institution listed twice')", [poly, inst]);
  assert.equal(await count("select count(*) from institutions"), 330);
  assert.equal(await count(`select count(*) from import_rows where institution_id = '${inst}'`), 2);
});

test("unnamed rows cannot be created from the import", async () => {
  const row = await one(ADMIN, "select id from import_rows where mapped->>'name' is null limit 1");
  await rejects(as(ADMIN, "select decide_import_row($1, 'create_new')", [row]), "23514");
});

test("a later import of the same names does not duplicate institutions", async () => {
  const later = text.replace("As at OCTOBER 10, 2026", "As at OCTOBER 24, 2026");
  const p = parseTrackerTsv(later);
  const id2 = await one(ADMIN, "select stage_import($1, $2, $3, $4, $5, $6)", [
    "later.tsv", later, p.reportedAsOf, "trackerTsv@1", JSON.stringify(summarise(p)), JSON.stringify(p.rows)]);
  assert.notEqual(id2, importId);
  const res = await one(ADMIN, "select commit_import($1)", [id2]);
  assert.equal(res.created, 0);
  assert.equal(res.needs_match, 329);
  assert.equal(await count("select count(*) from institutions"), 330);
});

test("imports, staged rows and drafts are invisible to the public and immutable", async () => {
  await rejects(as(null, "select * from imports"), "42501");
  await rejects(as(null, "select * from import_rows"), "42501");
  assert.equal((await as(null, "select * from published_snapshots")).length, 0);
  await rejects(db.query("update import_rows set mapped = '{}' where serial_raw = '#REF!'"), "55000");
  await rejects(db.query("delete from imports"), "55000");
  await rejects(as(EDITOR, "update import_rows set decision = 'skip'"), "42501");
});

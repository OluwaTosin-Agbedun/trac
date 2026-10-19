// The public compliance report: only an administrator can show or hide it, the public reads only
// the shown import's federal rows, and nothing else about imports becomes readable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { federalOnly, parseTrackerTsv, summarise } from "../../src/lib/import/trackerTsv.ts";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const EDITOR = "00000000-0000-0000-0000-00000000000e";
const dir = new URL("../../db/migrations/", import.meta.url);
const db = new PGlite();
for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));
await db.exec(`insert into app_users (id, email, display_name) values ('${ADMIN}', 'a@example.test', 'Admin'), ('${EDITOR}', 'e@example.test', 'Editor');
  insert into team_memberships (user_id, role, display_name) values ('${ADMIN}', 'admin', 'Admin'), ('${EDITOR}', 'editor', 'Editor');`);

async function as(user, q, params = []) {
  await db.exec(`select set_config('nut.user_id', '${user ?? ""}', false); set role ${user ? "nut_member" : "nut_anon"};`);
  try { return (await db.query(q, params)).rows; } finally { await db.exec("reset role;"); }
}
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);

const text = readFileSync(new URL("../../data/source/tracker-export-2026-10-10.tsv", import.meta.url), "utf8");
const fed = federalOnly(parseTrackerTsv(text));

test("federalOnly keeps the three federal sections only", () => {
  assert.equal(fed.rows.length, 194);
  assert.ok(fed.rows.every((r) => r.section.startsWith("federal_")));
  assert.equal(fed.excludedStateRows, 205);
});

test("only an administrator shows the report; the public reads federal rows and nothing else", async () => {
  const [{ id }] = await as(ADMIN, "select stage_import($1,$2,$3,$4,$5,$6) as id", ["t.tsv", text, fed.reportedAsOf, "trackerTsv@2",
    JSON.stringify(summarise(fed)), JSON.stringify(fed.rows)]);
  assert.equal((await as(null, "select * from tracker_report()")).length, 0);
  await rejects(as(EDITOR, "select publish_tracker_report($1)", [id]), "42501");
  await rejects(as(null, "select publish_tracker_report($1)", [id]), "42501");
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  const rows = await as(null, "select * from tracker_report()");
  assert.ok(rows.length > 150);
  assert.ok(rows.every((r) => r.section.startsWith("federal_")));
  assert.ok(rows.every((r) => r.website_url === null || /^https?:\/\//i.test(r.website_url)));
  // Raw import tables stay private.
  await rejects(as(null, "select * from import_rows"), "42501");
  await rejects(as(null, "select * from public_reports"), "42501");
  await rejects(as(EDITOR, "select hide_tracker_report()"), "42501");
  await as(ADMIN, "select hide_tracker_report()");
  assert.equal((await as(null, "select * from tracker_report()")).length, 0);
});

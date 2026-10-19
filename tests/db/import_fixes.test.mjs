// Import fixes (0009): guessed values never reach drafts, and rows whose name already exists are
// listed for a human decision instead of being skipped by every commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { parseTrackerTsv, summarise } from "../../src/lib/import/trackerTsv.ts";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const EDITOR = "00000000-0000-0000-0000-00000000000e";
const dir = new URL("../../db/migrations/", import.meta.url);
const text = readFileSync(new URL("../../data/source/tracker-export-2026-10-10.tsv", import.meta.url), "utf8");
const parsed = parseTrackerTsv(text);

const db = new PGlite();
for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  await db.exec(readFileSync(new URL(f, dir), "utf8"));
}
await db.exec(`insert into app_users (id, email, display_name, is_fixture) values
  ('${ADMIN}', 'admin@example.test', 'Fixture admin', true), ('${REVIEWER}', 'reviewer@example.test', 'Fixture reviewer', true),
  ('${EDITOR}', 'editor@example.test', 'Fixture editor', true);`);
await db.exec(`insert into team_memberships (user_id, role, display_name) values
  ('${ADMIN}', 'admin', 'Fixture admin'), ('${REVIEWER}', 'reviewer', 'Fixture reviewer'), ('${EDITOR}', 'editor', 'Fixture editor');`);

async function as(who, q, params = []) {
  const role = ["nut_worker", "nut_system"].includes(who) ? who : who ? "nut_member" : "nut_anon";
  const uid = who && !who.startsWith("nut_") ? who : "";
  await db.exec(`select set_config('nut.user_id', '${uid}', false); set role ${role};`);
  try { return (await db.query(q, params)).rows; } finally { await db.exec("reset role;"); }
}
const one = async (who, q, params) => Object.values((await as(who, q, params))[0])[0];
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);
const count = async (q, params = []) => Number(Object.values((await db.query(q, params)).rows[0])[0]);
const stage = (fileName, body, rows, summary = {}) => one(ADMIN, "select stage_import($1, $2, $3, $4, $5, $6)", [
  fileName, body, "2026-10-10", "trackerTsv@2", JSON.stringify(summary), JSON.stringify(rows)]);

let first;

test("drafts take an address only when it was written as one valid URL, and never a guessed state", async () => {
  first = await stage("tracker.tsv", text, parsed.rows, summarise(parsed));
  const res = await one(ADMIN, "select commit_import($1)", [first]);
  assert.equal(res.created, 329);
  const rows = (await db.query(
    `select r.mapped, r.issues, v.website_url, v.state, v.city
       from import_rows r join revisions v on v.id = r.revision_id where r.import_id = $1`, [first])).rows;
  assert.equal(rows.length, 329);
  for (const r of rows) {
    const m = r.mapped;
    const expected = m.websiteConfirmed === true ? m.websiteCandidates[0] : null;
    assert.equal(r.website_url, expected, `${m.name}: website`);
    if (r.issues.some((i) => i.code === "location_not_state")) {
      assert.equal(r.state, null, `${m.name}: state`);
      assert.equal(r.city, m.stateRaw, `${m.name}: the town stays as the city`);
    }
  }
  // Each kind of guess: protocol added, one of several URLs, Markdown link, shared domain.
  for (const code of ["website_missing_protocol", "website_multiple_urls", "website_markdown_link", "shared_domain"]) {
    const n = await count(
      `select count(*) from import_rows r join revisions v on v.id = r.revision_id
        where r.import_id = $1 and v.website_url is not null
          and exists (select 1 from jsonb_array_elements(r.issues) i where i->>'code' = $2)`, [first, code]);
    assert.equal(n, 0, code);
  }
  assert.equal(await count("select count(*) from revisions where website_url is not null"), 240);
  // The raw cell stays on the import row for an editor to confirm.
  const forestry = (await db.query(`select mapped->>'websiteRaw' as raw from import_rows where mapped->>'name' = 'Federal College of Forestry Resources Management, Maiduguri'`)).rows[0];
  assert.equal(forestry.raw, "fcfrmmaiduguri.com.ng/contact/");
});

test("the draft function checks the issues as well as the flag, and rows staged before the flag get no address", async () => {
  const base = parsed.rows.find((r) => r.mapped.name === "University of Nigeria, Nsukka");
  const variant = (name, change) => {
    const r = structuredClone(base);
    r.mapped.name = name;
    change(r);
    return r;
  };
  const rows = [
    variant("Flagless Test University (TEST DATA)", (r) => { delete r.mapped.websiteConfirmed; }),
    variant("Contradicted Flag University (TEST DATA)", (r) => {
      r.issues.push({ code: "website_missing_protocol", detail: "test", holds: false });
    }),
    variant("Two Candidates University (TEST DATA)", (r) => { r.mapped.websiteCandidates.push("https://www.example.edu.ng"); }),
    variant("Not A Url University (TEST DATA)", (r) => { r.mapped.websiteCandidates = ["javascript:alert(1)"]; }),
    variant("Confirmed Test University (TEST DATA)", () => {}),
  ].map((r, i) => ({ ...r, sourceLine: 1000 + i, sectionIndex: 1000 + i }));
  const id = await stage("flags.tsv", `flags ${Date.now()}`, rows);
  const res = await one(ADMIN, "select commit_import($1)", [id]);
  assert.equal(res.created, 5);
  const sites = Object.fromEntries((await db.query(
    `select v.name, v.website_url from import_rows r join revisions v on v.id = r.revision_id where r.import_id = $1`, [id]))
    .rows.map((r) => [r.name, r.website_url]));
  assert.deepEqual(sites, {
    "Flagless Test University (TEST DATA)": null,
    "Contradicted Flag University (TEST DATA)": null,
    "Two Candidates University (TEST DATA)": null,
    "Not A Url University (TEST DATA)": null,
    "Confirmed Test University (TEST DATA)": "https://www.unn.edu.ng",
  });
});

let second;

test("a later upload lists every waiting same-name row with its institution, and commit still skips them", async () => {
  const later = text.replace("As at OCTOBER 10, 2026", "As at OCTOBER 24, 2026");
  const p = parseTrackerTsv(later);
  second = await stage("later.tsv", later, p.rows, summarise(p));
  const before = await count("select count(*) from institutions");
  const res = await one(ADMIN, "select commit_import($1)", [second]);
  assert.equal(res.created, 0);
  assert.equal(res.needs_match, 329);
  assert.equal(await count("select count(*) from institutions"), before);

  const matches = await as(REVIEWER, "select * from import_name_matches($1)", [second]);
  const unheld = await count(
    `select count(*) from import_name_matches($1) m join import_rows r on r.id = m.row_id where not r.held`, [second]);
  assert.equal(unheld, 329, "every row the commit reported as needing a match is listed");
  // Each is offered the institution created from the same row of the first upload, under its current name.
  const wrong = await count(
    `select count(*) from import_name_matches($1) m
       join import_rows r2 on r2.id = m.row_id
       join import_rows r1 on r1.import_id = $2 and r1.source_line = r2.source_line
      where r1.institution_id is distinct from m.institution_id
         or m.institution_name is distinct from r1.mapped->>'name'`, [second, first]);
  assert.equal(wrong, 0);
  assert.ok(matches.length >= 329);
});

test("decisions on unheld same-name rows are accepted and honoured; a separate institution only when chosen", async () => {
  const waiting = (await db.query(
    `select m.row_id, m.institution_id from import_name_matches($1) m join import_rows r on r.id = m.row_id
      where not r.held order by r.source_line limit 3`, [second])).rows;
  const [link, separate, skip] = waiting;
  const before = await count("select count(*) from institutions");

  await rejects(as(EDITOR, "select decide_import_row($1, 'match_existing', $2, 'Same institution')", [link.row_id, link.institution_id]), "42501");
  await as(ADMIN, "select decide_import_row($1, 'match_existing', $2, 'Same institution: name matches')", [link.row_id, link.institution_id]);
  await as(ADMIN, "select decide_import_row($1, 'create_new', null, 'A different campus with the same name')", [separate.row_id]);
  await as(ADMIN, "select decide_import_row($1, 'skip', null, 'Not needed')", [skip.row_id]);

  const listed = new Set((await as(ADMIN, "select row_id from import_name_matches($1)", [second])).map((r) => r.row_id));
  assert.ok(![link, separate, skip].some((r) => listed.has(r.row_id)), "decided rows leave the waiting list");

  const res = await one(ADMIN, "select commit_import($1)", [second]);
  assert.equal(res.created, 1);
  assert.equal(res.needs_match, 326);
  assert.equal(res.skipped, 1);
  assert.equal(res.already_committed, 1);
  assert.equal(await count("select count(*) from institutions"), before + 1);
  const linked = (await db.query("select institution_id, revision_id from import_rows where id = $1", [link.row_id])).rows[0];
  assert.deepEqual(linked, { institution_id: link.institution_id, revision_id: null });
  const created = await one(ADMIN, "select institution_id from import_rows where id = $1", [separate.row_id]);
  assert.notEqual(created, separate.institution_id);

  // Committing again without further decisions creates nothing.
  const again = await one(ADMIN, "select commit_import($1)", [second]);
  assert.equal(again.created, 0);
  assert.equal(again.needs_match, 326);
});

test("a match or skip saved while a commit runs wins: the draft function re-checks the row under its lock", async () => {
  // commit_import reads its rows before locking each one; simulate it reaching rows decided meanwhile.
  const matched = await count(`select count(*) from import_rows where import_id = $1 and institution_id is not null and revision_id is null`, [second]);
  assert.equal(matched, 1);
  const [linked] = (await db.query(`select id, institution_id from import_rows where import_id = $1 and institution_id is not null and revision_id is null`, [second])).rows;
  const [skipped] = (await db.query(`select id from import_rows where import_id = $1 and decision = 'skip'`, [second])).rows;
  const before = await count("select count(*) from institutions");
  for (const id of [linked.id, skipped.id]) {
    await rejects(db.query("select create_draft_from_import_row($1, $2)", [id, ADMIN]), "55000");
  }
  await rejects(db.query("select create_draft_from_import_row(gen_random_uuid(), $1)", [ADMIN]), "P0002");
  assert.equal(await count("select count(*) from institutions"), before);
  const after = (await db.query("select institution_id, revision_id from import_rows where id = $1", [linked.id])).rows[0];
  assert.deepEqual(after, { institution_id: linked.institution_id, revision_id: null }, "the match is not overwritten");
});

test("import_name_matches is for team members who may read imports, nobody else", async () => {
  await rejects(as(null, "select * from import_name_matches($1)", [second]), "42501");
  await rejects(as("nut_worker", "select * from import_name_matches($1)", [second]), "42501");
  await rejects(as("nut_system", "select * from import_name_matches($1)", [second]), "42501");
  assert.ok((await as(EDITOR, "select * from import_name_matches($1)", [second])).length > 0);
  const priv = (await db.query(`select r.rolname,
      has_function_privilege(r.rolname, 'import_name_matches(uuid)', 'execute') as matches,
      has_function_privilege(r.rolname, 'create_draft_from_import_row(uuid, uuid)', 'execute') as draft
    from pg_roles r where r.rolname in ('nut_anon', 'nut_member', 'nut_system', 'nut_worker') order by 1`)).rows;
  assert.deepEqual(priv, [
    { rolname: "nut_anon", matches: false, draft: false },
    { rolname: "nut_member", matches: true, draft: false },
    { rolname: "nut_system", matches: false, draft: false },
    { rolname: "nut_worker", matches: false, draft: false },
  ]);
  await rejects(as(ADMIN, "select create_draft_from_import_row(gen_random_uuid(), $1)", [ADMIN]), "42501");
});

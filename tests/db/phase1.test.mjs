// Phase 1 database checks against real Postgres (PGlite) with a minimal Supabase auth stub.
// Run: npm run test:db
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const EDITOR = "00000000-0000-0000-0000-00000000000e";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const WORKER = "00000000-0000-0000-0000-00000000000f";
const OUTSIDER = "00000000-0000-0000-0000-000000000099";

const db = new PGlite();

await db.exec(readFileSync(new URL("../../db/migrations/0000_platform.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../../db/migrations/0001_phase1_core.sql", import.meta.url), "utf8"));
await db.exec(`
  insert into team_memberships (user_id, role, display_name) values
    ('${EDITOR}', 'editor', 'Fixture editor'), ('${REVIEWER}', 'reviewer', 'Fixture reviewer'),
    ('${ADMIN}', 'admin', 'Fixture admin'), ('${WORKER}', 'worker', 'Fixture worker');
`);

/** Run SQL as a client role, the way PostgREST does. */
async function as(user, sql, params = []) {
  const role = user ? "nut_member" : "nut_anon";
  await db.exec(`select set_config('nut.user_id', '${user ?? ""}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}
const one = async (user, sql, params) => Object.values((await as(user, sql, params))[0])[0];
const rejects = (p, code) => assert.rejects(p, (e) => (code ? e.code === code : true));

let rev1, rev2, lock;

test("editor drafts, cannot submit unsupported published indicator, then submits", async () => {
  rev1 = await one(EDITOR, "select create_institution('fixture-university', 'Fixture University (TEST DATA)', 'federal', 'university')");
  lock = await one(EDITOR, `select save_profile($1, 1, '{"state":"Fixture State","website_url":"https://example.org"}')`, [rev1]);
  lock = await one(EDITOR, `select save_indicator($1, $2, 'budget_capital',
      '{"state":"published","period_type":"financial_year","period_label":"2024","value_amount":"0","value_scale":"millions","value_currency":"NGN","internal_note":"private note"}')`, [rev1, lock]);
  await rejects(as(EDITOR, "select submit_revision($1, $2)", [rev1, lock]), "23514");
  await one(EDITOR, `select add_evidence($1, $2, '{"indicator_key":"budget_capital","url":"https://example.org/budget.pdf","locator":"p. 4, table 2"}')`, [rev1, lock]);
  lock += 1;
  await rejects(as(EDITOR, "select save_profile($1, 1, '{}')", [rev1]), "40001"); // stale lock
  const hash = await one(EDITOR, "select submit_revision($1, $2)", [rev1, lock]);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("nobody can mutate a submitted revision, even directly", async () => {
  await rejects(as(EDITOR, "update revisions set name = 'x' where id = $1", [rev1]), "42501");
  await rejects(db.query("update revisions set name = 'x' where id = $1", [rev1]), "55000");
  await rejects(db.query("update revision_indicators set state = 'not_found' where revision_id = $1", [rev1]), "55000");
});

test("editor, worker, outsider and anon cannot review or publish", async () => {
  for (const u of [EDITOR, WORKER, OUTSIDER]) {
    await rejects(as(u, "select review_revision($1, 'approved')", [rev1]), "42501");
    await rejects(as(u, "select publish_revision($1)", [rev1]), "42501");
  }
  await rejects(as(null, "select publish_revision($1)", [rev1]), "42501");
  await rejects(as(EDITOR, "insert into published_snapshots (institution_id, revision_id, approval_id, release_number, slug, methodology_version_id, payload, published_by) select institution_id, id, gen_random_uuid(), 1, 'x', 'v1-draft', '{}', $2 from revisions where id = $1", [rev1, EDITOR]), "42501");
});

test("reviewer approves the exact revision and publishes it", async () => {
  await rejects(as(REVIEWER, "select publish_revision($1)", [rev1]), "55000"); // not yet approved
  await as(REVIEWER, "select review_revision($1, 'approved', 'Evidence checked')", [rev1]);
  await as(REVIEWER, "select publish_revision($1)", [rev1]);
  const rows = await as(null, "select payload from published_snapshots where is_current");
  assert.equal(rows.length, 1);
  const p = rows[0].payload;
  assert.equal(p.profile.name, "Fixture University (TEST DATA)");
  const cap = p.indicators.find((i) => i.key === "budget_capital");
  assert.equal(cap.value_amount, 0);          // published zero stays zero
  assert.equal(cap.value_scale, "millions");  // scale explicit
  assert.equal(cap.internal_note, null);      // private note not published
  assert.equal(p.indicators.find((i) => i.key === "grants_domestic").value_amount, null); // unknown stays null
  assert.equal(p.summary.label, "assessment_incomplete");
  assert.equal(p.summary.published, 1);
});

test("anon cannot read drafts, revisions or audit history", async () => {
  for (const t of ["revisions", "institutions", "revision_indicators", "evidence_links", "approvals", "audit_events"]) {
    await rejects(as(null, `select * from ${t}`), "42501");
  }
  assert.equal((await as(WORKER, "select * from revisions")).length, 0); // worker sees no team data
});

test("a later draft does not change the public snapshot", async () => {
  rev2 = await one(EDITOR, "select create_revision(id) from institutions where slug = 'fixture-university'");
  await rejects(as(EDITOR, "select create_revision(id) from institutions where slug = 'fixture-university'"), "55000");
  const l = await one(EDITOR, "select lock_version from revisions where id = $1", [rev2]);
  await as(EDITOR, `select save_profile($1, $2, '{"name":"Draft Name Must Not Leak","bursar_name":"Draft Bursar"}')`, [rev2, l]);
  const p = (await as(null, "select payload from published_snapshots where is_current"))[0].payload;
  assert.equal(p.profile.name, "Fixture University (TEST DATA)");
  assert.equal(p.profile.bursar_name, null);
});

test("self-review is refused; admin override needs a recorded reason", async () => {
  const l = await one(EDITOR, "select lock_version from revisions where id = $1", [rev2]);
  await db.query("update revisions set submitted_by = null where id = $1", [rev2]); // draft, allowed
  await as(ADMIN, "select submit_revision($1, $2)", [rev2, l]);
  await rejects(as(ADMIN, "select review_revision($1, 'approved')", [rev2]), "42501");
  await as(ADMIN, "select review_revision($1, 'approved', null, 'Two-person team this week')", [rev2]);
  const a = await as(REVIEWER, "select self_review_override_reason from approvals where revision_id = $1", [rev2]);
  assert.equal(a[0].self_review_override_reason, "Two-person team this week");
  await as(REVIEWER, "select publish_revision($1)", [rev2]);
  const rows = await as(null, "select release_number, is_current, payload->'profile'->>'name' as name from published_snapshots order by release_number");
  assert.deepEqual(rows.map((r) => [r.release_number, r.is_current]), [[1, false], [2, true]]);
});

test("snapshots and approvals are immutable; withdrawal hides from public", async () => {
  await rejects(db.query("update published_snapshots set payload = '{}'"), "55000");
  await rejects(db.query("delete from approvals"), "55000");
  await rejects(as(EDITOR, "select withdraw_publication(id, 'x') from institutions"), "42501");
  await as(REVIEWER, "select withdraw_publication(id, 'Source misattributed') from institutions");
  const rows = await as(null, "select * from published_snapshots where is_current");
  assert.equal(rows.length, 0);
});

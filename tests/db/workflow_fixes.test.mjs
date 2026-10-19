// Workflow fixes (db/migrations/0008_workflow_fixes.sql): editors limited to their assigned
// institutions, authorship through edits, whole-institution withdrawal, publishing after a
// withdrawal, reopening, period-aware summaries and time-zone-independent hashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { summarise } from "../../src/lib/editorRules.ts";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const EDITOR = "00000000-0000-0000-0000-00000000000e";
const EDITOR2 = "00000000-0000-0000-0000-0000000000e2";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const REVIEWER2 = "00000000-0000-0000-0000-0000000000b2";
const WORKER = "worker-test:1";
const dir = new URL("../../db/migrations/", import.meta.url);
const migrations = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

async function fixtures(db) {
  await db.exec(`insert into app_users (id, email, display_name, is_fixture) values
    ('${ADMIN}', 'admin@example.test', 'Fixture admin', true), ('${EDITOR}', 'editor@example.test', 'Fixture editor', true),
    ('${EDITOR2}', 'editor2@example.test', 'Fixture editor two', true), ('${REVIEWER}', 'reviewer@example.test', 'Fixture reviewer', true),
    ('${REVIEWER2}', 'reviewer2@example.test', 'Fixture reviewer two', true);`);
  await db.exec(`insert into team_memberships (user_id, role, display_name) values
    ('${ADMIN}', 'admin', 'Fixture admin'), ('${EDITOR}', 'editor', 'Fixture editor'),
    ('${EDITOR2}', 'editor', 'Fixture editor two'), ('${REVIEWER}', 'reviewer', 'Fixture reviewer'),
    ('${REVIEWER2}', 'reviewer', 'Fixture reviewer two');`);
}

/** Request helpers bound to one database, run as a client role like the app does. */
function client(db) {
  async function as(who, q, params = []) {
    const role = who === "worker" ? "nut_worker" : who === "system" ? "nut_system" : who ? "nut_member" : "nut_anon";
    const uid = who && who !== "worker" && who !== "system" ? who : "";
    await db.exec(`select set_config('nut.user_id', '${uid}', false); set role ${role};`);
    try { return (await db.query(q, params)).rows; } finally { await db.exec("reset role;"); }
  }
  const one = async (who, q, params) => Object.values((await as(who, q, params))[0])[0];
  const lockOf = (rev) => one(ADMIN, "select lock_version from revisions where id = $1", [rev]);
  return {
    as, one, lockOf,
    async institution(who, slug) {
      const rev = await one(who, "select create_institution($1, $2)", [slug, `${slug} (TEST DATA)`]);
      return { rev, inst: await one(who, "select institution_id from revisions where id = $1", [rev]) };
    },
    async indicator(who, rev, key, p) {
      return one(who, "select save_indicator($1, $2, $3, $4)", [rev, await lockOf(rev), key, JSON.stringify(p)]);
    },
    async profile(who, rev, p) {
      return one(who, "select save_profile($1, $2, $3)", [rev, await lockOf(rev), JSON.stringify(p)]);
    },
    async submit(who, rev) {
      return one(who, "select submit_revision($1, $2)", [rev, await lockOf(rev)]);
    },
    async publish(rev, editor = EDITOR) {
      await one(editor, "select submit_revision($1, $2)", [rev, await lockOf(rev)]);
      await one(REVIEWER, "select review_revision($1, 'approved', 'Fixture review')", [rev]);
      return one(REVIEWER, "select publish_revision($1)", [rev]);
    },
  };
}

const db = new PGlite();
for (const f of migrations) await db.exec(readFileSync(new URL(f, dir), "utf8"));
await fixtures(db);
const { as, one, lockOf, institution, indicator, profile, submit, publish } = client(db);

const rejects = (p, code, message) =>
  assert.rejects(p, (e) => (code ? e.code === code : true) && (message ? message.test(e.message) : true));
const ASSIGNED = /assigned to another editor/;

// ---------------------------------------------------------------------------
// 1. Editors work on their assigned institutions
// ---------------------------------------------------------------------------

test("an editor may only change drafts of institutions assigned to them", async () => {
  const { rev, inst } = await institution(EDITOR, "assigned-university");
  // No assignment yet: any editor may work on it.
  await profile(EDITOR2, rev, { city: "Before assignment" });
  await as(REVIEWER, "select assign_institution($1, $2, $3, null)", [inst, EDITOR, REVIEWER]);

  const lock = await lockOf(rev);
  await rejects(as(EDITOR2, "select save_profile($1, $2, '{\"city\":\"x\"}')", [rev, lock]), "42501", ASSIGNED);
  await rejects(as(EDITOR2, "select save_indicator($1, $2, 'budget_capital', '{\"state\":\"not_found\"}')", [rev, lock]), "42501", ASSIGNED);
  await rejects(as(EDITOR2, "select add_evidence($1, $2, '{\"url\":\"https://example.org/a\"}')", [rev, lock]), "42501", ASSIGNED);
  await rejects(as(EDITOR2, "select remove_evidence($1, $2, gen_random_uuid())", [rev, lock]), "42501", ASSIGNED);
  await rejects(as(EDITOR2, "select submit_revision($1, $2)", [rev, lock]), "42501", ASSIGNED);
  assert.equal(await lockOf(rev), lock, "nothing was written");

  // The assigned editor, any reviewer and any administrator may.
  await profile(EDITOR, rev, { city: "Assigned editor" });
  const eid = await one(REVIEWER2, "select add_evidence($1, $2, '{\"url\":\"https://example.org/a\",\"locator\":\"p. 1\"}')", [rev, await lockOf(rev)]);
  await one(ADMIN, "select remove_evidence($1, $2, $3)", [rev, await lockOf(rev), eid]);
  await publish(rev);

  // Publishing closed the assignment. A new one again limits who may start the next draft.
  await as(REVIEWER, "select assign_institution($1, $2, $3, null)", [inst, EDITOR, REVIEWER]);
  await rejects(as(EDITOR2, "select create_revision($1)", [inst]), "42501", ASSIGNED);
  const next = await one(EDITOR, "select create_revision($1)", [inst]);
  assert.ok(next);

  // An assignment that names only a reviewer leaves the institution open to every editor.
  await as(REVIEWER, "select assign_institution($1, null, $2, null)", [inst, REVIEWER]);
  await profile(EDITOR2, next, { city: "Unassigned editor" });
});

test("scans and proposals follow the same assignment rule", async () => {
  const { rev, inst } = await institution(EDITOR, "assigned-research-university");
  await as(ADMIN, "select add_source_host($1, 'www.assigned.example.edu.ng')", [inst]);
  await as(REVIEWER, "select assign_institution($1, $2, $3, null)", [inst, EDITOR, REVIEWER]);
  await rejects(as(EDITOR2, "select request_scan($1)", [inst]), "42501", ASSIGNED);
  const job = await one(EDITOR, "select request_scan($1)", [inst]);

  await one("worker", "select worker_claim_job($1, 120)", [WORKER]);
  const text = "Approved Budget 2025. Personnel costs: N12,345,678,000. Capital expenditure was not stated.";
  const source = await one("worker", "select worker_record_source($1, $2, $3)", [job, WORKER, JSON.stringify({
    requested_url: "https://www.assigned.example.edu.ng/budget", final_url: "https://www.assigned.example.edu.ng/budget",
    http_status: 200, content_type: "text/html", content_hash: "b".repeat(64), byte_length: 100, title: "Budget", text_content: text })]);
  const propose = (key) => one("worker", "select worker_add_proposal($1, $2, $3)", [job, WORKER, JSON.stringify({
    field_key: key, candidate_state: "uncertain", source_version_id: source, excerpt: "Capital expenditure was not stated", proposed: {} })]);
  const p1 = await propose("budget_capital");
  const p2 = await propose("budget_overhead");

  const lock = await lockOf(rev);
  await rejects(as(EDITOR2, "select accept_proposal($1, $2, $3)", [p1, rev, lock]), "42501", ASSIGNED);
  await rejects(as(EDITOR2, "select reject_proposal($1, 'Not the right table')", [p1]), "42501", ASSIGNED);
  assert.equal(await one(EDITOR, "select status from agent_proposals where id = $1", [p1]), "pending");
  // Even the stale path, which writes nothing to the draft, is refused.
  await indicator(EDITOR, rev, "budget_overhead", { state: "not_found" });
  await rejects(as(EDITOR2, "select accept_proposal($1, $2, $3)", [p2, rev, await lockOf(rev)]), "42501", ASSIGNED);
  assert.equal(await one(EDITOR, "select status from agent_proposals where id = $1", [p2]), "pending");

  await as(EDITOR, "select reject_proposal($1, 'Not the right table')", [p1]);
  assert.deepEqual(await one(EDITOR, "select accept_proposal($1, $2, $3)", [p2, rev, await lockOf(rev)]), { stale: true });

  // Stopping a scan is work on the institution as well.
  await rejects(as(EDITOR2, "select cancel_scan($1)", [job]), "42501", ASSIGNED);
  assert.equal(await one(EDITOR, "select cancel_requested_at from crawl_jobs where id = $1", [job]), null);
  await as(EDITOR, "select cancel_scan($1)", [job]);
  assert.notEqual(await one(EDITOR, "select cancel_requested_by from crawl_jobs where id = $1", [job]), null);
});

test("the writer check and the period helpers are not callable directly", async () => {
  await rejects(as(EDITOR, "select require_institution_writer(gen_random_uuid())"), "42501");
  await rejects(as(null, "select require_institution_writer(gen_random_uuid())"), "42501");
  await rejects(as(EDITOR, "select period_coverage('2024', 'FY 2025')"), "42501");
  await rejects(as(null, "select * from period_years('FY 2025')"), "42501");
  await rejects(as("worker", "select reopen_revision(gen_random_uuid(), 'Not a team member')"), "42501");
});

// ---------------------------------------------------------------------------
// 2. Self-review through edits
// ---------------------------------------------------------------------------

test("a reviewer who edited a revision cannot review it; an administrator needs a recorded reason", async () => {
  const { rev } = await institution(EDITOR, "self-review-university");
  await indicator(REVIEWER, rev, "budget_capital", { state: "not_found", reason: "Checked the bursary pages." });
  await indicator(ADMIN, rev, "budget_overhead", { state: "not_found" });
  await submit(EDITOR, rev);

  await rejects(as(REVIEWER, "select review_revision($1, 'approved')", [rev]), "42501");
  await rejects(as(ADMIN, "select review_revision($1, 'approved')", [rev]), "42501");
  await rejects(as(ADMIN, "select review_revision($1, 'approved', null, '  ')", [rev]), "42501");
  await as(ADMIN, "select review_revision($1, 'approved', null, 'Only administrator available this week')", [rev]);
  const [a] = await as(REVIEWER, "select self_review_override_reason from approvals where revision_id = $1", [rev]);
  assert.equal(a.self_review_override_reason, "Only administrator available this week");
  const [ev] = await as(ADMIN, "select details from audit_events where action = 'revision.reviewed' and entity_id = $1", [rev]);
  assert.equal(ev.details.self_review_override, true);
});

test("evidence edits and accepted proposals count as authorship; starting a draft does not", async () => {
  const { rev } = await institution(EDITOR, "evidence-author-university");
  const eid = await one(REVIEWER, "select add_evidence($1, $2, '{\"url\":\"https://example.org/e\"}')", [rev, await lockOf(rev)]);
  await one(EDITOR, "select remove_evidence($1, $2, $3)", [rev, await lockOf(rev), eid]);
  await submit(EDITOR, rev);
  await rejects(as(REVIEWER, "select review_revision($1, 'approved')", [rev]), "42501");
  // An accepted proposal recorded against this revision also makes REVIEWER2 an author.
  await db.query(`insert into audit_events (actor_id, action, entity_type, entity_id, details)
                  values ($1, 'proposal.accepted', 'proposal', gen_random_uuid(), jsonb_build_object('revision_id', $2::uuid))`,
                 [REVIEWER2, rev]);
  await rejects(as(REVIEWER2, "select review_revision($1, 'approved')", [rev]), "42501");
  // Another member's override is not recorded as one.
  await one(ADMIN, "select review_revision($1, 'changes_requested', 'Please add the budget evidence')", [rev]);
  const [a] = await as(ADMIN, "select self_review_override_reason from approvals where revision_id = $1", [rev]);
  assert.equal(a.self_review_override_reason, null);

  // A reviewer who only returned the work and started the next draft has not edited it.
  const other = await institution(EDITOR, "draft-starter-university");
  await profile(EDITOR, other.rev, { city: "Edited by the editor" });
  await submit(EDITOR, other.rev);
  await as(REVIEWER, "select review_revision($1, 'changes_requested', 'Add the city source')", [other.rev]);
  const next = await one(REVIEWER, "select create_revision($1)", [other.inst]);
  await profile(EDITOR, next, { city: "Edited again by the editor" });
  await submit(EDITOR, next);
  await as(REVIEWER, "select review_revision($1, 'approved')", [next]);
});

test("edits carried over from a returned revision still make the reviewer an author", async () => {
  const { rev, inst } = await institution(EDITOR, "carried-edits-university");
  await indicator(REVIEWER, rev, "budget_capital", { state: "not_found", reason: "Checked by the reviewer." });
  await submit(EDITOR, rev);
  await rejects(as(REVIEWER, "select review_revision($1, 'approved')", [rev]), "42501");
  // Reopening sends the work back; the editor resubmits the same content as a new revision.
  await as(REVIEWER, "select reopen_revision($1, 'Sending back for another look')", [rev]);
  const r2 = await one(EDITOR, "select create_revision($1)", [inst]);
  await submit(EDITOR, r2);
  await rejects(as(REVIEWER, "select review_revision($1, 'approved')", [r2]), "42501");
  // Two returns deep is still the same unapproved content.
  await as(REVIEWER2, "select review_revision($1, 'changes_requested', 'One more check')", [r2]);
  const r3 = await one(EDITOR, "select create_revision($1)", [inst]);
  await submit(EDITOR, r3);
  await rejects(as(REVIEWER, "select review_revision($1, 'approved')", [r3]), "42501");
  await as(REVIEWER2, "select review_revision($1, 'approved')", [r3]);
  await as(REVIEWER2, "select publish_revision($1)", [r3]);

  // Once another reviewer approved and published that content, it no longer counts against REVIEWER.
  const r4 = await one(EDITOR, "select create_revision($1)", [inst]);
  await profile(EDITOR, r4, { city: "Edited after publication" });
  await submit(EDITOR, r4);
  await as(REVIEWER, "select review_revision($1, 'approved')", [r4]);
});

// ---------------------------------------------------------------------------
// 3 and 4. Withdrawal, and publishing afterwards
// ---------------------------------------------------------------------------

test("withdrawal takes every release of the institution off the public site", async () => {
  const { rev, inst } = await institution(EDITOR, "withdrawn-everywhere-university");
  await publish(rev);
  const r2 = await one(EDITOR, "select create_revision($1)", [inst]);
  await publish(r2);
  const publicCount = async () => Number(await one(null, "select count(*) from published_snapshots where institution_id = $1", [inst]));
  assert.equal(await publicCount(), 2);

  await as(REVIEWER, "select withdraw_publication($1, 'Evidence attributed to the wrong institution')", [inst]);
  assert.equal(await publicCount(), 0, "no release, current or earlier, stays public");
  const rows = await as(REVIEWER, "select release_number, is_current, withdrawn_by, withdrawn_reason from published_snapshots where institution_id = $1 order by release_number", [inst]);
  assert.deepEqual(rows.map((r) => [r.release_number, r.is_current, r.withdrawn_by, r.withdrawn_reason]), [
    [1, false, REVIEWER, "Evidence attributed to the wrong institution"],
    [2, false, REVIEWER, "Evidence attributed to the wrong institution"],
  ]);
  assert.equal(await one(EDITOR, "select status from revisions where id = $1", [r2]), "withdrawn");
  assert.equal(await one(EDITOR, "select status from revisions where id = $1", [rev]), "superseded");
  assert.equal(await one(EDITOR, "select current_published_revision from institutions where id = $1", [inst]), null);
  const [ev] = await as(ADMIN, "select details from audit_events where action = 'publication.withdrawn' and entity_id = $1", [inst]);
  assert.equal(ev.details.withdrawn_snapshot_ids.length, 2);
  await rejects(as(REVIEWER, "select withdraw_publication($1, 'Again')", [inst]), "P0002");
});

test("a draft started from a release that was then withdrawn can still be published", async () => {
  const { rev, inst } = await institution(EDITOR, "republished-university");
  await publish(rev);
  const r2 = await one(EDITOR, "select create_revision($1)", [inst]);
  assert.equal(await one(EDITOR, "select base_revision_id from revisions where id = $1", [r2]), rev);
  await as(REVIEWER, "select withdraw_publication($1, 'Figures under correction')", [inst]);

  await profile(EDITOR, r2, { city: "Corrected" });
  await publish(r2);
  const pub = await as(null, "select release_number, payload->'profile'->>'city' as city from published_snapshots where institution_id = $1", [inst]);
  assert.deepEqual(pub, [{ release_number: 2, city: "Corrected" }], "only the new release is public");
  assert.equal(await one(EDITOR, "select current_published_revision from institutions where id = $1", [inst]), r2);
  assert.equal(await one(EDITOR, "select status from revisions where id = $1", [rev]), "withdrawn");
});

test("the publish conflict check still refuses drafts started from anything else", async () => {
  // Base no longer current while something else is published.
  const { rev, inst } = await institution(EDITOR, "conflict-university");
  await publish(rev);
  const r2 = await one(EDITOR, "select create_revision($1)", [inst]);
  await publish(r2);
  const r3 = await one(EDITOR, "select create_revision($1)", [inst]);
  await db.query("update revisions set base_revision_id = $2 where id = $1", [r3, rev]); // draft: allowed
  await submit(EDITOR, r3);
  await as(REVIEWER, "select review_revision($1, 'approved')", [r3]);
  await rejects(as(REVIEWER, "select publish_revision($1)", [r3]), "40001");

  // After a withdrawal, only the withdrawn latest release counts as an up-to-date base.
  await as(REVIEWER, "select reopen_revision($1, 'Rebase onto the latest release')", [r3]);
  await as(REVIEWER, "select withdraw_publication($1, 'Withdrawn for correction')", [inst]);
  const r4 = await one(EDITOR, "select create_revision($1)", [inst]);
  assert.equal(await one(EDITOR, "select base_revision_id from revisions where id = $1", [r4]), null);
  await db.query("update revisions set base_revision_id = $2 where id = $1", [r4, rev]); // release 1, not the latest
  await submit(EDITOR, r4);
  await as(REVIEWER, "select review_revision($1, 'approved')", [r4]);
  await rejects(as(REVIEWER, "select publish_revision($1)", [r4]), "40001");
});

// ---------------------------------------------------------------------------
// 5. Reopening
// ---------------------------------------------------------------------------

test("a reviewer can reopen a submitted or approved revision with a reason", async () => {
  const { rev, inst } = await institution(EDITOR, "reopened-university");
  await indicator(EDITOR, rev, "budget_capital", { state: "not_found" });
  const hash = await submit(EDITOR, rev);

  await rejects(as(EDITOR, "select reopen_revision($1, 'Wrong period')", [rev]), "42501");
  await rejects(as(null, "select reopen_revision($1, 'Wrong period')", [rev]), "42501");
  await rejects(as("system", "select reopen_revision($1, 'Wrong period')", [rev]), "42501");
  await rejects(as("worker", "select reopen_revision($1, 'Wrong period')", [rev]), "42501");
  for (const bad of [null, "", "  ab  ", "\t\n \r\n\t", "x".repeat(1001)]) {
    await rejects(as(REVIEWER, "select reopen_revision($1, $2)", [rev, bad]), "22023");
  }
  await as(REVIEWER, "select reopen_revision($1, '  The period label should be 2025  ')", [rev]);
  assert.equal(await one(EDITOR, "select status from revisions where id = $1", [rev]), "changes_requested");
  const [a] = await as(EDITOR, "select decision, notes, content_hash, decided_by from approvals where revision_id = $1", [rev]);
  assert.deepEqual(a, { decision: "changes_requested", notes: "The period label should be 2025", content_hash: hash, decided_by: REVIEWER });
  const [ev] = await as(ADMIN, "select details from audit_events where action = 'revision.reopened' and entity_id = $1", [rev]);
  assert.equal(ev.details.previous_status, "submitted");

  // An approval is voided the same way; a corrected draft follows.
  const r2 = await one(EDITOR, "select create_revision($1)", [inst]);
  assert.equal(await one(EDITOR, "select review_cycle from revisions where id = $1", [r2]), 1);
  await submit(EDITOR, r2);
  await as(REVIEWER, "select review_revision($1, 'approved', 'Checked')", [r2]);
  await as(ADMIN, "select reopen_revision($1, 'A newer budget was released today')", [r2]);
  await rejects(as(REVIEWER, "select publish_revision($1)", [r2]), "55000");
  const decisions = await as(EDITOR, "select decision from approvals where revision_id = $1 order by decided_at, id", [r2]);
  assert.deepEqual(decisions.map((d) => d.decision).sort(), ["approved", "changes_requested"]);
  const r3 = await one(EDITOR, "select create_revision($1)", [inst]);
  assert.equal(await one(EDITOR, "select status from revisions where id = $1", [r3]), "draft");
  // Drafts, published and returned revisions cannot be reopened.
  await rejects(as(REVIEWER, "select reopen_revision($1, 'Not open for review')", [r3]), "55000");
  await rejects(as(REVIEWER, "select reopen_revision($1, 'Not open for review')", [r2]), "55000");
  await rejects(as(REVIEWER, "select reopen_revision(gen_random_uuid(), 'No such revision')"), "P0002");
});

// ---------------------------------------------------------------------------
// 6 and 8. Summaries
// ---------------------------------------------------------------------------

const KEYS = ["budget_personnel", "budget_overhead", "budget_capital", "grants_domestic", "grants_international",
  "tetfund_allocation", "endowment_fund", "students_undergraduate", "students_postgraduate"];

/** Sets every indicator of a fresh draft and returns the SQL summary next to the TypeScript one. */
async function summaries(slug, assessment, states) {
  const { rev } = await institution(EDITOR, slug);
  await profile(EDITOR, rev, { assessment_period: assessment });
  for (const [i, key] of KEYS.entries()) {
    const s = states[i];
    await indicator(EDITOR, rev, key, typeof s === "string"
      ? { state: s, reason: s === "not_applicable" ? "Fixture methodology rule." : null }
      : { state: s.state, period_type: "financial_year", period_label: s.period_label });
  }
  const sql = (await one(EDITOR, "select preview_revision($1)", [rev])).summary;
  return { sql, ts: summarise(states, assessment) };
}

const pub = (period_label) => ({ state: "published", period_label });

test("prior-year evidence is counted as historical and does not make every indicator published", async () => {
  const cases = [
    ["summary-current", "FY 2025", [...Array(8).fill(pub("2025")), pub("2024/2025")], "all_applicable_published", 0],
    ["summary-historical", "FY 2025", [...Array(8).fill(pub("2025")), pub("2023")], "partial_disclosure", 1],
    ["summary-later", "FY 2025", [...Array(8).fill(pub("2025")), pub("FY 2026")], "partial_disclosure", 0],
    ["summary-unplaced", "FY 2025", [...Array(8).fill(pub("2025")), pub("Latest accounts")], "all_applicable_published", 0],
    ["summary-no-assessment-period", null, Array(9).fill(pub("2019")), "all_applicable_published", 0],
    ["summary-all-historical", "FY 2025", [...Array(8).fill(pub("2022")), "not_applicable"], "partial_disclosure", 8],
  ];
  for (const [slug, assessment, states, label, historical] of cases) {
    const { sql, ts } = await summaries(slug, assessment, states);
    assert.equal(sql.label, label, slug);
    assert.equal(sql.historical, historical, slug);
    assert.equal(sql.published, states.filter((s) => s.state === "published").length, slug);
    assert.deepEqual([ts.label, ts.historical, ts.published, ts.applicable, ts.excluded],
      [sql.label, sql.historical, sql.published, sql.applicable, sql.excluded], `${slug}: TypeScript agrees with SQL`);
  }
});

test("every indicator excluded gives the neutral label, not 'no disclosures found'", async () => {
  const { sql, ts } = await summaries("summary-all-excluded", "FY 2025", Array(9).fill("not_applicable"));
  assert.equal(sql.label, "no_applicable_indicators");
  assert.equal(ts.label, "no_applicable_indicators");
  assert.deepEqual([sql.applicable, sql.excluded, sql.published], [0, 9, 0]);
  const nf = await summaries("summary-none-found", "FY 2025", [...Array(8).fill("not_found"), "not_applicable"]);
  assert.equal(nf.sql.label, "no_disclosures_found");
  assert.equal(nf.ts.label, "no_disclosures_found");
});

test("published releases carry the period-aware summary", async () => {
  const { rev } = await institution(EDITOR, "summary-published-university");
  await profile(EDITOR, rev, { assessment_period: "FY 2025" });
  for (const key of KEYS) {
    await indicator(EDITOR, rev, key, { state: "published", period_type: "financial_year", period_label: key === "endowment_fund" ? "2023" : "2025" });
    await one(EDITOR, "select add_evidence($1, $2, $3)", [rev, await lockOf(rev),
      JSON.stringify({ indicator_key: key, url: "https://example.org/fixture", locator: "p. 1" })]);
  }
  await publish(rev);
  const [{ summary }] = await as(null, "select payload->'summary' as summary from published_snapshots where revision_id = $1", [rev]);
  assert.equal(summary.label, "partial_disclosure");
  assert.equal(summary.historical, 1);
  assert.equal(summary.published, 9);
});

// ---------------------------------------------------------------------------
// 7. Hashes do not depend on the session time zone
// ---------------------------------------------------------------------------

test("the content hash is the same in every session time zone", async () => {
  const { rev } = await institution(EDITOR, "time-zone-university");
  await profile(EDITOR, rev, { last_verified_at: "2025-06-01T09:00:00Z" });
  await one(EDITOR, "select add_evidence($1, $2, $3)", [rev, await lockOf(rev),
    JSON.stringify({ indicator_key: "budget_capital", url: "https://example.org/tz", locator: "p. 2", captured_at: "2026-10-01T23:30:00Z" })]);
  const hashIn = async (tz) => {
    await db.exec(`set timezone to '${tz}'`);
    return (await db.query("select revision_hash($1) as h", [rev])).rows[0].h;
  };
  try {
    const utc = await hashIn("UTC");
    assert.equal(await hashIn("Africa/Lagos"), utc);
    assert.equal(await hashIn("Pacific/Auckland"), utc);
    const content = (await db.query("select revision_content($1, false) as c", [rev])).rows[0].c;
    assert.match(content.profile.last_verified_at, /\+00:00$/);

    // Submitted in one zone, reviewed and published in another.
    await db.exec("set timezone to 'Asia/Tokyo'");
    await submit(EDITOR, rev);
    await db.exec("set timezone to 'America/New_York'");
    await as(REVIEWER, "select review_revision($1, 'approved')", [rev]);
    await db.exec("set timezone to 'Africa/Lagos'");
    await as(REVIEWER, "select publish_revision($1)", [rev]);
  } finally {
    await db.exec("reset timezone");
  }
});

// ---------------------------------------------------------------------------
// 3 (existing data). Earlier releases left public by an older withdrawal
// ---------------------------------------------------------------------------

test("the migration withdraws earlier releases that an older withdrawal left public", async () => {
  const old = new PGlite();
  const before = migrations.filter((f) => f < "0008");
  for (const f of before) await old.exec(readFileSync(new URL(f, dir), "utf8"));
  await fixtures(old);
  const c = client(old);
  const { rev, inst } = await c.institution(EDITOR, "legacy-withdrawn-university");
  await c.publish(rev);
  const r2 = await c.one(EDITOR, "select create_revision($1)", [inst]);
  await c.publish(r2);
  await c.as(REVIEWER, "select withdraw_publication($1, 'Legacy withdrawal')", [inst]);
  // The old function left release 1 readable.
  assert.equal((await c.as(null, "select 1 from published_snapshots where institution_id = $1", [inst])).length, 1);

  for (const f of migrations.filter((f) => f >= "0008")) await old.exec(readFileSync(new URL(f, dir), "utf8"));
  assert.equal((await c.as(null, "select 1 from published_snapshots where institution_id = $1", [inst])).length, 0);
  const rows = await c.as(REVIEWER, "select release_number, withdrawn_by, withdrawn_reason from published_snapshots where institution_id = $1 order by release_number", [inst]);
  assert.deepEqual(rows.map((r) => [r.release_number, r.withdrawn_by, r.withdrawn_reason]),
    [[1, REVIEWER, "Legacy withdrawal"], [2, REVIEWER, "Legacy withdrawal"]]);
  const audit = await c.as(ADMIN, "select details from audit_events where action = 'publication.withdrawn' and entity_id = $1 and actor_id is null", [inst]);
  assert.equal(audit.length, 1);
  await old.close();
});

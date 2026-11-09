// The register screen's reads against a real database: the record being edited (with its linked
// institution), link-check runs, history in plain words, earlier versions, filters across every
// category, and the refusal messages the screen shows.
// Run with: node --conditions=react-server --test tests/server/reportAdmin.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LOCAL_DB_DIR = mkdtempSync(join(tmpdir(), "nut-report-"));
delete process.env.DATABASE_URL;

const { asPublic, asUser } = await import("../../src/server/db/index.ts");
const report = await import("../../src/server/data/cms/report.ts");
const { dbErrorMessage } = await import("../../src/server/actions/result.ts");
const text = await import("../../src/app/admin/(app)/report/_lib/registerText.ts");
const { INDICATORS } = await import("../../src/lib/indicators.ts");

const ADMIN = { userId: "00000000-0000-4000-8000-00000000000a", role: "admin" };
const EDITOR = { userId: "00000000-0000-4000-8000-00000000000e", role: "editor" };
const REVIEWER = { userId: "00000000-0000-4000-8000-00000000000b", role: "reviewer" };

await asPublic((tx) => tx.query("select 1")); // opens the local database and applies the migrations
const driver = await globalThis.__nutDriver;
const owner = (sql, params) => driver.transaction((tx) => tx.query(sql, params));
await owner(`insert into app_users (id, email, display_name) values
  ('${ADMIN.userId}', 'a@example.test', 'Chi Admin'), ('${EDITOR.userId}', 'e@example.test', 'Ada Editor'),
  ('${REVIEWER.userId}', 'r@example.test', 'Bola Reviewer')`);
await owner(`insert into team_memberships (user_id, role, display_name) values
  ('${ADMIN.userId}', 'admin', 'Chi Admin'), ('${EDITOR.userId}', 'editor', 'Ada Editor'), ('${REVIEWER.userId}', 'reviewer', 'Bola Reviewer')`);

const sql = (who, q, params = []) => asUser(who.userId, (tx) => tx.query(q, params));
const refusal = async (p) => { try { await p; } catch (err) { return dbErrorMessage(err); } assert.fail("expected a refusal"); };
const hashOf = async (id) => (await owner("select register_hash(e) as h from report_entries e where id = $1", [id]))[0].h;

const payload = (changes = {}) => ({
  section: "federal_university", name: "Federal University Testtown", state: "Lagos", head_name: "Prof. A", bursar_name: null,
  people_source_url: "https://fut.edu.ng/management", homepage_url: "https://fut.edu.ng/", disclosure_url: "https://fut.edu.ng/disclosure",
  extra_links: [{ label: "Budget", url: "https://fut.edu.ng/budget.pdf" }],
  assessments: Object.fromEntries(INDICATORS.map((d) => [d.key, { status: "published", year: "2026", evidence_url: null, checked_on: "2026-11-02", note: null }])),
  ...changes,
});

let id;
let instId;

test("a saved record reads back with its linked institution, history and team", async () => {
  await sql(ADMIN, "select set_report_settings($1::date, $2::int, $3::int)", ["2026-11-01", 2026, 180]);
  [{ id }] = await sql(ADMIN, "select save_report_entry(null, $1::jsonb, null) as id", [JSON.stringify(payload())]);
  [{ id: instId }] = await owner("insert into institutions (slug) values ('federal-university-testtown') returning id");
  await owner("update report_entries set institution_id = $1 where id = $2", [instId, id]);
  const data = await report.getReportAdmin(ADMIN, "federal_university", "", id, "all");
  assert.equal(data.editing.id, id);
  assert.equal(data.editing.institutionId, instId);
  assert.equal(data.entries.find((e) => e.id === id).institutionId, instId);
  assert.equal(data.assessmentYear, 2026);
  assert.equal(data.editing.peopleSourceUrl, "https://fut.edu.ng/management");
  assert.equal(data.editing.state_, "awaiting");
  assert.deepEqual(data.linkRuns, []);
  assert.deepEqual(data.versions, []);
  assert.deepEqual(data.team.map((t) => t.name), ["Ada Editor", "Bola Reviewer", "Chi Admin"]);
  assert.deepEqual(data.history.map((h) => h.action), ["report.entry_added"]);
});

test("a stale save is refused with the conflict message; the current hash saves", async () => {
  const opened = await hashOf(id);
  await sql(EDITOR, "select save_report_entry($1, $2::jsonb, $3)", [id, JSON.stringify(payload({ bursar_name: "Mr B" })), opened]);
  const msg = await refusal(sql(ADMIN, "select save_report_entry($1, $2::jsonb, $3)", [id, JSON.stringify(payload({ state: "Ogun" })), opened]));
  assert.equal(msg, "Someone else saved this record after you opened it. Reload to see their version, then reapply your change.");
  assert.match(await refusal(sql(EDITOR, "select save_report_entry($1, $2::jsonb)", [id, JSON.stringify(payload())])), /^The site was updated/);
  assert.match(await refusal(sql(REVIEWER, "select verify_report_entry($1, $2)", [id, opened])), /^This record changed since you opened it/);
  // The update reads back in plain words, with both values.
  const data = await report.getReportAdmin(REVIEWER, "federal_university", "", id, "all");
  const saved = text.describeEvent(data.history.find((h) => h.action === "report.entry_updated"), () => null);
  assert.equal(saved.title, "Saved 1 change");
  assert.deepEqual(saved.details, ["Bursar: Not recorded → Mr B"]);
});

test("link-check runs are counted, and the record shows its link problems", async () => {
  await sql(EDITOR, "select save_link_checks($1, $2::jsonb)", [id, JSON.stringify([
    { url: "https://fut.edu.ng/", kind: "homepage", result: "ok", http_status: 200 },
    { url: "https://fut.edu.ng/budget.pdf", kind: "extra", result: "not_found", http_status: 404 },
  ])]);
  const data = await report.getReportAdmin(EDITOR, "federal_university", "", id, "links");
  assert.deepEqual(data.linkRuns.map((r) => [r.checkedByName, r.scheduled, r.total, r.problems]), [["Ada Editor", false, 2, 1]]);
  assert.equal(data.editing.linkProblems, 1);
  assert.ok(data.editing.lastLinkCheckAt);
  assert.deepEqual(data.entries.map((e) => e.id), [id], "the links filter lists it");
  assert.deepEqual(data.history, [], "editors do not read the audit history");
});

test("verify, withdraw, archive and restore: versions keep the rule and year, filters look everywhere", async () => {
  // A reviewer who did not edit it verifies; the record is then public.
  assert.equal(report.mayVerify(REVIEWER, (await report.getReportAdmin(REVIEWER, "federal_university", "", id, "all")).editing), true);
  assert.equal(report.mayVerify(ADMIN, (await report.getReportAdmin(ADMIN, "federal_university", "", id, "all")).editing), false, "the admin edited it");
  await sql(REVIEWER, "select verify_report_entry($1, $2)", [id, await hashOf(id)]);
  let data = await report.getReportAdmin(ADMIN, "federal_university", "", id, "verified");
  assert.equal(data.editing.state_, "verified");
  assert.equal(data.editing.verifiedMethod, "2026.1");
  assert.equal(data.editing.verifiedAssessmentYear, 2026);
  const verified = text.describeEvent(data.history.find((h) => h.action === "report.entry_verified"), () => null);
  assert.deepEqual(verified.details, ["Checked under scoring rule 2026.1, for the 2026 assessment year."]);
  assert.deepEqual(text.diffContent(data.editing.verified, data.editing.verified), []);

  // Withdrawing keeps the verified version, with the rule and year, and returns the record.
  assert.match(await refusal(sql(EDITOR, "select withdraw_report_verification($1, $2)", [id, "Wrong budget year"])), /permission/);
  await sql(REVIEWER, "select withdraw_report_verification($1, $2)", [id, "The budget is for 2025, not 2026"]);
  data = await report.getReportAdmin(EDITOR, "federal_university", "", id, "returned");
  assert.equal(data.editing.state_, "returned");
  assert.deepEqual(data.versions.map((v) => [v.verifiedMethod, v.assessmentYear, v.reason, v.supersededByName]),
    [["2026.1", 2026, "The budget is for 2025, not 2026", "Bola Reviewer"]]);
  assert.equal(text.describeVersion(data.versions[0]).title, "Verification withdrawn");
  // "Returned" looks across every category, whichever one is chosen.
  assert.equal(report.looksEverywhere("state_university", "", "returned"), true);
  assert.equal(report.looksEverywhere("state_university", "", "verified"), false);
  assert.deepEqual((await report.getReportAdmin(EDITOR, "state_university", "", null, "returned")).entries.map((e) => e.id), [id]);
  assert.deepEqual((await report.getReportAdmin(EDITOR, "state_university", "", null, "all")).entries, []);

  // Assignment, shown with names and a due date.
  const [{ n }] = await sql(REVIEWER, "select assign_report_entries($1::uuid[], $2::uuid, $3::uuid, $4::date) as n",
    [[id], EDITOR.userId, REVIEWER.userId, "2026-12-01"]);
  assert.equal(n, 1);
  data = await report.getReportAdmin(EDITOR, "state_university", "", id, "mine");
  assert.deepEqual([data.editing.assignedEditorName, data.editing.assignedReviewerName, data.editing.dueOn], ["Ada Editor", "Bola Reviewer", "2026-12-01"]);
  assert.deepEqual(data.entries.map((e) => e.id), [id], "assigned to me, from another category");

  // Removing archives with a reason; only the archived filter lists it; restoring brings it back.
  assert.match(await refusal(sql(ADMIN, "select archive_report_entry($1, $2)", [id, "no"])), /reason/i);
  await sql(ADMIN, "select archive_report_entry($1, $2)", [id, "Duplicate of another record"]);
  data = await report.getReportAdmin(ADMIN, "federal_university", "", id, "all");
  assert.deepEqual(data.entries, []);
  assert.equal(data.editing.archiveReason, "Duplicate of another record");
  assert.equal(report.mayVerify(REVIEWER, data.editing), false);
  assert.deepEqual((await report.getReportAdmin(ADMIN, "federal_university", "", null, "archived")).entries.map((e) => e.id), [id]);
  assert.match(await refusal(sql(EDITOR, "select save_report_entry($1, $2::jsonb, $3)", [id, JSON.stringify(payload()), await hashOf(id)])), /removed from the register/);
  await sql(ADMIN, "select restore_report_entry($1)", [id]);
  data = await report.getReportAdmin(ADMIN, "federal_university", "", id, "all");
  assert.deepEqual(data.entries.map((e) => e.id), [id]);
  const lines = text.buildHistory(data.history, data.linkRuns, (uid) => data.team.find((t) => t.userId === uid)?.name ?? null);
  assert.deepEqual(lines.slice(0, 4).map((l) => l.title),
    ["Restored to the register", "Removed from the register", "Assignment changed", "Verification withdrawn (taken off the public site)"]);
  assert.deepEqual(lines[2].details, ["Editor: Ada Editor.", "Reviewer: Bola Reviewer.", "Due 1 Dec 2026."]);
  assert.ok(lines.some((l) => l.title === "Checked 2 links"));
});

test("settings and visibility refuse what the database refuses, in plain words", async () => {
  assert.match(await refusal(sql(ADMIN, "select set_report_settings($1, $2::date)", [true, "2026-11-01"])), /^The site was updated/);
  assert.match(await refusal(sql(REVIEWER, "select set_register_visibility(false, 'Testing the hidden state')")), /permission/);
  await sql(ADMIN, "select set_register_visibility(false, 'Testing the hidden state')");
  assert.equal((await report.getReportAdmin(ADMIN, "federal_university", "", null, "all")).visible, false);
  assert.match(await refusal(sql(ADMIN, "select assign_report_entries($1::uuid[], $2::uuid, $3::uuid, null)", [[id], EDITOR.userId, EDITOR.userId])),
    /reviewer must be an active reviewer/i);
});

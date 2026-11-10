// The register's research suggestions panel against a real database: what it reads for a record's
// linked institution (sources, scans, pending proposals, the worker's status), the conflict message
// a stale "Apply" gets, and the applied suggestion in the record's history.
// Run with: node --conditions=react-server --test tests/server/registerResearch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LOCAL_DB_DIR = mkdtempSync(join(tmpdir(), "nut-register-research-"));
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

const { asPublic, asUser } = await import("../../src/server/db/index.ts");
const { runAs } = await import("../../src/server/db/core.ts");
const research = await import("../../src/server/data/cms/research.ts");
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
const worker = (sql, params) => runAs(driver, { kind: "worker" }, (tx) => tx.query(sql, params));
await owner(`insert into app_users (id, email, display_name) values
  ('${ADMIN.userId}', 'a@example.test', 'Chi Admin'), ('${EDITOR.userId}', 'e@example.test', 'Ada Editor'),
  ('${REVIEWER.userId}', 'r@example.test', 'Bola Reviewer')`);
await owner(`insert into team_memberships (user_id, role, display_name) values
  ('${ADMIN.userId}', 'admin', 'Chi Admin'), ('${EDITOR.userId}', 'editor', 'Ada Editor'), ('${REVIEWER.userId}', 'reviewer', 'Bola Reviewer')`);

const sql = (who, q, params = []) => asUser(who.userId, (tx) => tx.query(q, params));
const refusal = async (p) => { try { await p; } catch (err) { return dbErrorMessage(err); } assert.fail("expected a refusal"); };
const hashOf = async (id) => (await owner("select register_hash(e) as h from report_entries e where id = $1", [id]))[0].h;

const payload = {
  section: "federal_university", name: "Federal University Researchtown", state: "Lagos",
  homepage_url: "https://www.fur.edu.ng/", disclosure_url: "https://fur.edu.ng/disclosure",
  assessments: Object.fromEntries(INDICATORS.map((d) => [d.key, { status: "not_found", year: null, evidence_url: null, checked_on: "2026-11-02", note: null }])),
};

let id;
let inst;

test("an unlinked record says so; a linked one offers its homepage as a research source", async () => {
  [{ id }] = await sql(ADMIN, "select save_report_entry(null, $1::jsonb, null) as id", [JSON.stringify(payload)]);
  let r = await research.getRegisterResearch(EDITOR, id);
  assert.equal(r.institutionId, null);
  assert.deepEqual(r.suggestions, []);
  const [{ id: rev }] = await sql(ADMIN, "select create_institution('federal-university-researchtown', 'Federal University Researchtown') as id");
  [{ institution_id: inst }] = await sql(ADMIN, "select institution_id from revisions where id = $1", [rev]);
  await owner("update report_entries set institution_id = $1 where id = $2", [inst, id]);
  r = await research.getRegisterResearch(EDITOR, id);
  assert.equal(r.institutionId, inst);
  assert.equal(r.homepageHost, "fur.edu.ng", "without the www., so subdomains are covered");
  assert.deepEqual(r.approvedHosts, []);
  assert.equal(r.current.budget_personnel.status, "not_found");
  // An editor suggests it; it waits for an administrator.
  await sql(EDITOR, "select add_source_host($1, register_research_host($2), 'The homepage recorded in the register')", [inst, payload.homepage_url]);
  r = await research.getRegisterResearch(EDITOR, id);
  assert.equal(r.homepagePending, true);
  assert.deepEqual(r.approvedHosts, []);
  const [{ hid }] = await owner("select id as hid from source_hosts where institution_id = $1", [inst]);
  await sql(ADMIN, "select decide_source_host($1, true)", [hid]);
  r = await research.getRegisterResearch(EDITOR, id);
  assert.deepEqual(r.approvedHosts, ["fur.edu.ng"]);
  assert.equal(r.homepagePending, false);
});

test("pending indicator proposals are listed with what applying them would set", async () => {
  const [{ job }] = await sql(EDITOR, "select request_register_scan($1) as job", [id]);
  assert.equal((await research.getRegisterResearch(EDITOR, id)).activeScan.id, job);
  await worker("select worker_report_status('panel-worker:1', true, '2026.11.10')");
  const [{ c }] = await worker("select worker_claim_job('panel-worker:1', 60) as c");
  assert.equal(c.job_id, job);
  const [{ src }] = await worker("select worker_record_source($1, 'panel-worker:1', $2) as src", [job, JSON.stringify({
    requested_url: "https://fur.edu.ng/docs/budget-2026.pdf", final_url: "https://fur.edu.ng/docs/budget-2026.pdf", http_status: 200,
    content_type: "application/pdf", content_hash: "d".repeat(64), byte_length: 1000, title: "budget-2026.pdf", extraction_method: "pdf_text",
    page_count: 2, text_content: "[Page 1]\nApproved Budget 2026\n\n[Page 2]\nCapital expenditure: N1,200,000,000\nVice-Chancellor: Prof. Ada Obi" })]);
  const add = (p) => worker("select worker_add_proposal($1, 'panel-worker:1', $2)", [job, JSON.stringify({
    source_version_id: src, uncertainty: [], confidence: "high", extraction_method: "pdf_text", ...p })]);
  await add({ field_key: "budget_capital", candidate_state: "published", excerpt: "Capital expenditure: N1,200,000,000", locator: "Budget 2026, page 2",
    proposed: { register_status: "partial", period_label: "2026", value_literal: "N1,200,000,000" }, uncertainty: ["Only the total is shown."] });
  await add({ field_key: "head_name", candidate_state: null, excerpt: "Vice-Chancellor: Prof. Ada Obi", locator: "page 2", proposed: { value: "Prof. Ada Obi" } });
  await worker("select worker_finish_job($1, 'panel-worker:1', 'succeeded', $2)", [job, JSON.stringify({ pagesFetched: 1, documentsFetched: 1 })]);

  const r = await research.getRegisterResearch(EDITOR, id);
  assert.equal(r.activeScan, null);
  assert.equal(r.lastScan.status, "succeeded");
  assert.equal(r.suggestions.length, 1, "profile proposals are not register suggestions");
  const [s] = r.suggestions;
  assert.deepEqual([s.fieldKey, s.registerStatus, s.candidateState, s.periodLabel, s.valueLiteral, s.locator, s.extractionMethod],
    ["budget_capital", "partial", "published", "2026", "N1,200,000,000", "Budget 2026, page 2", "pdf_text"]);
  assert.deepEqual(s.uncertainty, ["Only the total is shown."]);
  assert.equal(s.source.url, "https://fur.edu.ng/docs/budget-2026.pdf");
  assert.ok(s.source.fetchedAt);

  // The worker's own report decides the status line, not this server's environment (no key here).
  const line = await research.getWorkerLine(EDITOR);
  assert.equal(line.state, "running");
  assert.equal(line.version, "2026.11.10");
});

test("a stale Apply gets the conflict message; applying shows in the record's history", async () => {
  const [s] = (await research.getRegisterResearch(EDITOR, id)).suggestions;
  const opened = await hashOf(id);
  await sql(ADMIN, "select save_report_entry($1, $2::jsonb, $3)", [id, JSON.stringify({ ...payload, state: "Ogun" }), opened]);
  assert.equal(await refusal(sql(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [s.id, id, opened])),
    "Someone else saved this record after you opened it. Reload to see their version, then reapply your change.");
  await sql(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [s.id, id, await hashOf(id)]);
  assert.deepEqual((await research.getRegisterResearch(EDITOR, id)).suggestions, []);
  const data = await report.getReportAdmin(REVIEWER, "federal_university", "", id, "all");
  assert.equal(data.editing.assessments.budget_capital.status, "partial");
  assert.equal(data.editing.assessments.budget_capital.evidence_url, "https://fur.edu.ng/docs/budget-2026.pdf");
  assert.deepEqual(data.editing.editorIds.sort(), [ADMIN.userId, EDITOR.userId].sort());
  const line = text.describeEvent(data.history.find((h) => h.action === "report.proposal_applied"), () => null);
  assert.equal(line.title, "Research suggestion applied");
  assert.equal(line.who, "Ada Editor");
  assert.match(line.details[0], /^Budget: Capital expenditure: Not found · checked 2 Nov 2026 → Partially published · 2026 · checked .* · https:\/\/fur\.edu\.ng\/docs\/budget-2026\.pdf · “Budget 2026, page 2”$/);
  assert.equal(line.details[1], "Evidence: https://fur.edu.ng/docs/budget-2026.pdf");
  assert.ok(data.history.some((h) => h.action === "report.scan_requested"));
  assert.equal(text.describeEvent({ at: "", action: "report.scan_requested", actorName: null, details: {} }, () => null).title, "Research scan requested");
});

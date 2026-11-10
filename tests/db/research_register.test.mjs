// Migration 0018: the research worker's recovery and status, PDF captures, and the research
// assistant feeding the verified register.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const EDITOR = "00000000-0000-0000-0000-00000000000e";
const EDITOR2 = "00000000-0000-0000-0000-0000000000e2";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const dir = new URL("../../db/migrations/", import.meta.url);

const db = new PGlite();
for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  await db.exec(readFileSync(new URL(f, dir), "utf8"));
}
await db.exec(`insert into app_users (id, email, display_name, is_fixture) values
  ('${ADMIN}', 'admin@example.test', 'Fixture admin', true), ('${EDITOR}', 'editor@example.test', 'Fixture editor', true),
  ('${EDITOR2}', 'editor2@example.test', 'Second editor', true), ('${REVIEWER}', 'reviewer@example.test', 'Fixture reviewer', true);`);
await db.exec(`insert into team_memberships (user_id, role, display_name) values
  ('${ADMIN}', 'admin', 'Fixture admin'), ('${EDITOR}', 'editor', 'Fixture editor'),
  ('${EDITOR2}', 'editor', 'Second editor'), ('${REVIEWER}', 'reviewer', 'Fixture reviewer');`);

async function as(who, q, params = []) {
  const role = who === "worker" ? "nut_worker" : who === "cron" ? "nut_cron" : who ? "nut_member" : "nut_anon";
  const uid = who && who !== "worker" && who !== "cron" ? who : "";
  await db.exec(`select set_config('nut.user_id', '${uid}', false); set role ${role};`);
  try { return (await db.query(q, params)).rows; } finally { await db.exec("reset role;"); }
}
const one = async (who, q, params) => Object.values((await as(who, q, params))[0] ?? {})[0];
const owner = async (q, params = []) => (await db.query(q, params)).rows;
const rejects = (p, code, re) => assert.rejects(p, (e) => (code ? e.code === code : true) && (re ? re.test(e.message) : true));
/** Makes the job's lease run out, as if its worker died. */
const expire = (job) => owner("update crawl_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [job]);

const draft = await one(ADMIN, "select create_institution('research-uni', 'Research University (TEST DATA)')");
const inst = await one(ADMIN, "select institution_id from revisions where id = $1", [draft]);
await as(ADMIN, "select add_source_host($1, 'research.example.edu.ng')", [inst]);

// ---------------------------------------------------------------------------
// 1. Worker recovery
// ---------------------------------------------------------------------------

test("a scan whose worker died is taken over by the next worker, with the restart logged", async () => {
  const job = await one(EDITOR, "select request_scan($1)", [inst]);
  const first = await one("worker", "select worker_claim_job('worker-a:1', 60)");
  assert.equal(first.job_id, job);
  // While the lease is live, nobody else takes it.
  assert.equal(await one("worker", "select worker_claim_job('worker-b:1', 60)"), null);
  await expire(job);
  const second = await one("worker", "select worker_claim_job('worker-b:1', 60)");
  assert.equal(second.job_id, job);
  const [row] = await owner("select status::text, lease_owner, attempts from crawl_jobs where id = $1", [job]);
  assert.deepEqual(row, { status: "running", lease_owner: "worker-b:1", attempts: 2 });
  // The dead worker's lease is gone: if it wakes up, it can record nothing.
  await rejects(as("worker", "select worker_heartbeat($1, 'worker-a:1', 60)", [job]), "55000");
  const events = await owner("select level, message from crawl_events where job_id = $1 order by id", [job]);
  assert.ok(events.some((e) => e.level === "warn" && /previous worker stopped responding/.test(e.message)));
  await as("worker", "select worker_finish_job($1, 'worker-b:1', 'succeeded', '{}')", [job]);
});

test("after three attempts a scan is failed visibly and the institution can be scanned again", async () => {
  const job = await one(EDITOR, "select request_scan($1)", [inst]);
  for (const w of ["worker-a:2", "worker-b:2", "worker-c:2"]) {
    assert.equal((await one("worker", "select worker_claim_job($1, 60)", [w])).job_id, job);
    await expire(job);
  }
  assert.equal(await one("worker", "select worker_claim_job('worker-d:2', 60)"), null);
  const [row] = await owner("select status::text, error, lease_owner, finished_at is not null as finished from crawl_jobs where id = $1", [job]);
  assert.equal(row.status, "failed");
  assert.match(row.error, /stopped responding three times/);
  assert.equal(row.lease_owner, null);
  assert.equal(row.finished, true);
  assert.ok((await owner("select message from crawl_events where job_id = $1 and level = 'error'", [job])).length === 1);
  assert.notEqual(await one(EDITOR, "select request_scan($1)", [inst]), job);
  const next = await one("worker", "select worker_claim_job('worker-e:2', 60)");
  await as("worker", "select worker_finish_job($1, 'worker-e:2', 'succeeded', '{}')", [next.job_id]);
});

test("a cancelled scan whose worker died is closed as cancelled, not left running forever", async () => {
  const job = await one(EDITOR, "select request_scan($1)", [inst]);
  assert.equal((await one("worker", "select worker_claim_job('worker-a:3', 60)")).job_id, job);
  await as(EDITOR, "select cancel_scan($1)", [job]);
  // While the worker is alive it is told to stop; nothing is closed behind its back.
  assert.equal(await one("worker", "select worker_claim_job('worker-b:3', 60)"), null);
  assert.equal(await one(EDITOR, "select status::text from crawl_jobs where id = $1", [job]), "running");
  // The worker dies before it sees the cancel request.
  await expire(job);
  assert.equal(await one("worker", "select worker_claim_job('worker-b:3', 60)"), null, "a cancelled scan is never restarted");
  const [row] = await owner("select status::text, lease_owner, finished_at is not null as finished, coverage from crawl_jobs where id = $1", [job]);
  assert.equal(row.status, "cancelled");
  assert.equal(row.lease_owner, null);
  assert.equal(row.finished, true);
  assert.match(row.coverage.note, /worker stopped before it could finish/);
  assert.ok((await owner("select 1 from crawl_events where job_id = $1 and message like 'Scan closed as cancelled%'", [job])).length === 1);
  // The institution is free for a new scan.
  const again = await one(EDITOR, "select request_scan($1)", [inst]);
  assert.notEqual(again, job);
  await as(EDITOR, "select cancel_scan($1)", [again]);
});

test("claims are validated and only the worker role may claim", async () => {
  await rejects(as("worker", "select worker_claim_job('x', 60)"), "22023");
  await rejects(as("worker", "select worker_claim_job('worker-ok:1', 5)"), "22023");
  await rejects(as(ADMIN, "select worker_claim_job('worker-ok:1', 60)"), "42501");
  await rejects(as(null, "select worker_claim_job('worker-ok:1', 60)"), "42501");
  await rejects(as("cron", "select worker_claim_job('worker-ok:1', 60)"), "42501");
});

// ---------------------------------------------------------------------------
// 2. Worker status
// ---------------------------------------------------------------------------

test("the worker reports its status; members read only when, whether configured, and the version", async () => {
  assert.deepEqual(await as(EDITOR, "select * from research_worker_status()"), [], "nothing before any worker ran");
  await as("worker", "select worker_report_status('status-worker:1', false, '2026.11.10')");
  await as("worker", "select worker_report_status('status-worker:2', true, '2026.11.10+abc1234')");
  const [row] = await as(REVIEWER, "select * from research_worker_status()");
  assert.deepEqual(Object.keys(row).sort(), ["configured", "last_seen_at", "version"]);
  assert.equal(row.configured, true);
  assert.equal(row.version, "2026.11.10+abc1234");
  // An older worker that wakes up again becomes the latest one seen.
  await owner("update worker_status set last_seen_at = now() - interval '10 minutes' where worker_id = 'status-worker:2'");
  await as("worker", "select worker_report_status('status-worker:1', false, null)");
  assert.equal((await as(ADMIN, "select * from research_worker_status()"))[0].configured, false);
  // Bad input is refused; nobody else reads or writes the table.
  await rejects(as("worker", "select worker_report_status('bad id!', true, null)"), "22023");
  await rejects(as("worker", "select worker_report_status('status-worker:3', true, 'v1; drop')"), "22023");
  await rejects(as("worker", "select worker_report_status('status-worker:3', null, null)"), "22023");
  await rejects(as(EDITOR, "select worker_report_status('status-worker:3', true, null)"), "42501");
  await rejects(as(null, "select * from research_worker_status()"), "42501");
  await rejects(as("worker", "select * from research_worker_status()"), "42501");
  await rejects(as("cron", "select * from research_worker_status()"), "42501");
  await rejects(as(EDITOR, "select * from worker_status"), "42501");
  await rejects(as("worker", "select * from worker_status"), "42501");
  // A worker not seen for a month is forgotten.
  await owner("update worker_status set last_seen_at = now() - interval '31 days' where worker_id = 'status-worker:2'");
  await as("worker", "select worker_report_status('status-worker:1', true, null)");
  assert.deepEqual((await owner("select worker_id from worker_status order by worker_id")).map((r) => r.worker_id), ["status-worker:1"]);
});

test("claims and heartbeats count as being seen, so a long scan does not look like a missing worker", async () => {
  await as("worker", "select worker_report_status('busy-worker:1', true, null)");
  await owner("update worker_status set last_seen_at = now() - interval '20 minutes' where worker_id = 'busy-worker:1'");
  const job = await one(EDITOR, "select request_scan($1)", [inst]);
  assert.equal((await one("worker", "select worker_claim_job('busy-worker:1', 60)")).job_id, job);
  const seen = async () => (await owner("select extract(epoch from now() - last_seen_at) as s from worker_status where worker_id = 'busy-worker:1'"))[0].s;
  assert.ok(Number(await seen()) < 60);
  await owner("update worker_status set last_seen_at = now() - interval '20 minutes' where worker_id = 'busy-worker:1'");
  await as("worker", "select worker_heartbeat($1, 'busy-worker:1', 60)", [job]);
  assert.ok(Number(await seen()) < 60);
  await as("worker", "select worker_finish_job($1, 'busy-worker:1', 'succeeded', '{}')", [job]);
});

// ---------------------------------------------------------------------------
// 3. Captures record how their text was read
// ---------------------------------------------------------------------------

test("captures keep their extraction method and page count; unknown methods are not stored", async () => {
  const job = await one(EDITOR, "select request_scan($1)", [inst]);
  assert.equal((await one("worker", "select worker_claim_job('pdf-db-worker:1', 60)")).job_id, job);
  const src = (over) => JSON.stringify({ requested_url: "https://research.example.edu.ng/b.pdf", final_url: "https://research.example.edu.ng/b.pdf",
    http_status: 200, content_type: "application/pdf", content_hash: "b".repeat(64), byte_length: 900, title: "b.pdf",
    text_content: "[Page 1]\nApproved budget 2026\n\n[Page 2]\nPersonnel costs: N12,000,000", ...over });
  const pdf = await one("worker", "select worker_record_source($1, 'pdf-db-worker:1', $2)", [job, src({ extraction_method: "pdf_text", page_count: 2 })]);
  const odd = await one("worker", "select worker_record_source($1, 'pdf-db-worker:1', $2)", [job, src({ extraction_method: "ocr<script>", page_count: "2; drop" })]);
  const rows = await owner("select id, extraction_method, page_count from source_versions where id = any($1) order by extraction_method nulls last", [[pdf, odd]]);
  assert.deepEqual(rows.map((r) => [r.extraction_method, r.page_count]), [["pdf_text", 2], [null, null]]);
  const prop = (method) => JSON.stringify({ field_key: "budget_personnel", candidate_state: "published", source_version_id: pdf,
    excerpt: "Personnel costs: N12,000,000", locator: "Budget, page 2", extraction_method: method,
    proposed: { period_type: "financial_year", period_label: "2026" }, uncertainty: [], confidence: "high" });
  const a = await one("worker", "select worker_add_proposal($1, 'pdf-db-worker:1', $2)", [job, prop("pdf_text")]);
  const b = await one("worker", "select worker_add_proposal($1, 'pdf-db-worker:1', $2)", [job, prop("made_up")]);
  const methods = await owner("select id, extraction_method from agent_proposals where id = any($1)", [[a, b]]);
  assert.equal(methods.find((m) => m.id === a).extraction_method, "pdf_text");
  assert.equal(methods.find((m) => m.id === b).extraction_method, "html_text");
  // An excerpt not in the captured text is still refused (the verbatim check).
  await rejects(as("worker", "select worker_add_proposal($1, 'pdf-db-worker:1', $2)",
    [job, prop("pdf_text").replace("N12,000,000", "N99,000,000")]), "22023");
  await owner("update agent_proposals set status = 'rejected', decision_note = 'test cleanup' where job_id = $1", [job]);
  await as("worker", "select worker_finish_job($1, 'pdf-db-worker:1', 'succeeded', '{}')", [job]);
});

// ---------------------------------------------------------------------------
// 5. Feeding the register
// ---------------------------------------------------------------------------

const entryPayload = (over = {}) => JSON.stringify({ section: "federal_university", name: "Research University", state: "Lagos",
  homepage_url: "https://www.research.example.edu.ng/", disclosure_url: "https://research.example.edu.ng/disclosure", ...over });
const hashOf = async (id) => (await owner("select register_hash(e) as h from report_entries e where id = $1", [id]))[0].h;
const entryRow = async (id) => (await owner("select * from report_entries where id = $1", [id]))[0];

/** One finished scan of the institution with a captured budget page and the given proposals. */
async function scanWithProposals(institution, worker, proposals) {
  const job = await one(ADMIN, "select request_scan($1)", [institution]);
  assert.equal((await one("worker", "select worker_claim_job($1, 60)", [worker])).job_id, job);
  const host = (await owner("select host from source_hosts where institution_id = $1 and approved limit 1", [institution]))[0].host;
  const source = await one("worker", "select worker_record_source($1, $2, $3)", [job, worker, JSON.stringify({
    requested_url: `https://${host}/bursary/budget-2026.pdf`, final_url: `https://${host}/bursary/budget-2026.pdf`, http_status: 200,
    content_type: "application/pdf", content_hash: "c".repeat(64), byte_length: 2000, title: "budget-2026.pdf", extraction_method: "pdf_text",
    page_count: 3, text_content: "[Page 1]\nApproved Budget 2026\n\n[Page 3]\nPersonnel costs: N4,250,500,000.00\nOverhead costs: summary only, see annex\nVice-Chancellor: Prof. Ada Obi" })]);
  const ids = [];
  for (const p of proposals) {
    ids.push(await one("worker", "select worker_add_proposal($1, $2, $3)", [job, worker, JSON.stringify({
      source_version_id: source, uncertainty: [], confidence: "high", extraction_method: "pdf_text", ...p })]));
  }
  await as("worker", "select worker_finish_job($1, $2, 'succeeded', '{}')", [job, worker]);
  return { job, source, ids };
}

// Set up inside a test: tests run while the module is still loading, and they share one connection.
let entry, otherInst, props;
test("proposals can say a disclosure is partial; nothing else is accepted as a register status", async () => {
  entry = await one(ADMIN, "select save_report_entry(null, $1::jsonb, null)", [entryPayload()]);
  await owner("update report_entries set institution_id = $1, assigned_editor = $2 where id = $3", [inst, EDITOR, entry]);
  const otherDraft = await one(ADMIN, "select create_institution('other-uni', 'Other University (TEST DATA)')");
  otherInst = await one(ADMIN, "select institution_id from revisions where id = $1", [otherDraft]);
  await as(ADMIN, "select add_source_host($1, 'other.example.edu.ng')", [otherInst]);
  props = await scanWithProposals(inst, "register-worker:1", [
    { field_key: "budget_personnel", candidate_state: "published", excerpt: "Personnel costs: N4,250,500,000.00", locator: "Recurrent budget, page 3",
      proposed: { register_status: "published", period_type: "financial_year", period_label: "2026", value_literal: "N4,250,500,000.00" } },
    { field_key: "budget_overhead", candidate_state: "published", excerpt: "Overhead costs: summary only, see annex", locator: "page 3",
      proposed: { register_status: "partial", period_label: "2026" }, uncertainty: ["Only a summary line is shown."] },
    { field_key: "head_name", candidate_state: null, excerpt: "Vice-Chancellor: Prof. Ada Obi", locator: "page 3", proposed: { value: "Prof. Ada Obi" } },
  ]);
  const rows = await owner("select field_key, proposed->>'register_status' as rs from agent_proposals where id = any($1) order by field_key", [props.ids]);
  assert.deepEqual(rows, [{ field_key: "budget_overhead", rs: "partial" }, { field_key: "budget_personnel", rs: "published" }, { field_key: "head_name", rs: null }]);
  const job = await one(ADMIN, "select request_scan($1)", [inst]);
  await one("worker", "select worker_claim_job('register-worker:2', 60)");
  await rejects(as("worker", "select worker_add_proposal($1, 'register-worker:2', $2)", [job, JSON.stringify({
    field_key: "budget_capital", candidate_state: "uncertain", source_version_id: props.source, excerpt: "Approved Budget 2026",
    proposed: { register_status: "verified" } })]), "22023", /published or partial/);
  await as("worker", "select worker_finish_job($1, 'register-worker:2', 'succeeded', '{}')", [job]);
});

test("applying a proposal is refused without the right role, scope, version, institution or state", async () => {
  const [personnel, , head] = props.ids;
  const h = await hashOf(entry);
  await rejects(as(null, "select apply_proposal_to_register($1, $2, $3)", [personnel, entry, h]), "42501");
  await rejects(as("worker", "select apply_proposal_to_register($1, $2, $3)", [personnel, entry, h]), "42501");
  await rejects(as("cron", "select apply_proposal_to_register($1, $2, $3)", [personnel, entry, h]), "42501");
  // The record is assigned to EDITOR: another editor may not apply to it.
  await rejects(as(EDITOR2, "select apply_proposal_to_register($1, $2, $3)", [personnel, entry, h]), "42501", /assigned to another editor/);
  await rejects(as(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [personnel, entry, "0".repeat(64)]), "40001", /^conflict: /);
  await rejects(as(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [personnel, entry, null]), "40001");
  await rejects(as(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [head, entry, h]), "22023", /only indicator suggestions/);
  // A proposal about another institution cannot be applied to this record.
  const other = await scanWithProposals(otherInst, "register-worker:3", [{ field_key: "budget_personnel", candidate_state: "published",
    excerpt: "Personnel costs: N4,250,500,000.00", locator: "page 3", proposed: { period_label: "2026" } }]);
  await rejects(as(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [other.ids[0], entry, h]), "22023", /different institution/);
  await rejects(as(EDITOR, "select apply_proposal_to_register($1, $2, $3)", ["00000000-0000-4000-8000-000000000999", entry, h]), "P0002");
  assert.equal(await hashOf(entry), h, "nothing changed");
});

test("applying fills the indicator from the capture; the record still needs a second person", async () => {
  const [personnel, overhead] = props.ids;
  const [captured] = await owner("select (fetched_at at time zone 'Africa/Lagos')::date::text as d, final_url from source_versions where id = $1", [props.source]);
  await as(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [personnel, entry, await hashOf(entry)]);
  let e = await entryRow(entry);
  assert.deepEqual(e.assessments.budget_personnel, { status: "published", year: "2026", evidence_url: captured.final_url,
    checked_on: captured.d, note: "Recurrent budget, page 3" });
  assert.equal(e.assessments.budget_capital.status, "not_assessed", "other indicators are untouched");
  assert.ok(e.editors.includes(EDITOR));
  assert.equal(e.pending, true);
  assert.equal(e.verified, null, "nothing is public");
  const [p] = await owner("select status::text, applied_entry_id, decided_by, accepted_value from agent_proposals where id = $1", [personnel]);
  assert.equal(p.status, "applied_to_register");
  assert.equal(p.applied_entry_id, entry);
  assert.equal(p.decided_by, EDITOR);
  assert.equal(p.accepted_value.status, "published");
  const [audit] = await owner("select actor_id, details from audit_events where action = 'report.proposal_applied' and entity_id = $1", [entry]);
  assert.equal(audit.actor_id, EDITOR);
  assert.equal(audit.details.indicator, "budget_personnel");
  assert.equal(audit.details.before.status, "not_assessed");
  assert.equal(audit.details.after.status, "published");
  // Applied once only.
  await rejects(as(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [personnel, entry, await hashOf(entry)]), "55000", /already applied to register/);
  // A partial disclosure becomes "partially published"; a reviewer who applies it becomes an editor of the record.
  await as(REVIEWER, "select apply_proposal_to_register($1, $2, $3)", [overhead, entry, await hashOf(entry)]);
  e = await entryRow(entry);
  assert.equal(e.assessments.budget_overhead.status, "partial");
  assert.equal(e.assessments.budget_overhead.note, "page 3");
  await rejects(as(REVIEWER, "select verify_report_entry($1, $2)", [entry, await hashOf(entry)]), "42501", /another reviewer must verify/);
  assert.equal((await as(null, "select verified from public_register() where id = $1", [entry]))[0]?.verified ?? null, null);
});

test("a suggestion the assistant was not sure about cannot be applied; a person records it instead", async () => {
  const u = await scanWithProposals(inst, "register-worker:6", [{ field_key: "budget_capital", candidate_state: "uncertain",
    excerpt: "Personnel costs: N4,250,500,000.00", locator: "page 3", proposed: { period_label: "2026" }, uncertainty: ["The year is not stated."] }]);
  const h = await hashOf(entry);
  await rejects(as(EDITOR, "select apply_proposal_to_register($1, $2, $3)", [u.ids[0], entry, h]), "22023", /was not sure/);
  assert.equal(await hashOf(entry), h, "nothing changed");
});

test("a suggestion from a website an administrator has since withdrawn cannot be applied", async () => {
  const wDraft = await one(ADMIN, "select create_institution('withdrawn-uni', 'Withdrawn University (TEST DATA)')");
  const wInst = await one(ADMIN, "select institution_id from revisions where id = $1", [wDraft]);
  const wHost = await one(ADMIN, "select add_source_host($1, 'withdrawn.example.edu.ng')", [wInst]);
  const wEntry = await one(ADMIN, "select save_report_entry(null, $1::jsonb, null)",
    [entryPayload({ name: "Withdrawn University", homepage_url: "https://withdrawn.example.edu.ng/" })]);
  await owner("update report_entries set institution_id = $1 where id = $2", [wInst, wEntry]);
  const w = await scanWithProposals(wInst, "register-worker:5", [{ field_key: "budget_personnel", candidate_state: "published",
    excerpt: "Personnel costs: N4,250,500,000.00", locator: "page 3", proposed: { period_label: "2026" } }]);
  await as(ADMIN, "select decide_source_host($1, false)", [wHost]);
  const h = await hashOf(wEntry);
  await rejects(as(ADMIN, "select apply_proposal_to_register($1, $2, $3)", [w.ids[0], wEntry, h]), "22023", /no longer an approved research source/);
  assert.equal(await hashOf(wEntry), h, "nothing changed");
  assert.equal(await one(ADMIN, "select status::text from agent_proposals where id = $1", [w.ids[0]]), "pending");
  await as(ADMIN, "select reject_proposal($1, 'The website was withdrawn as a source')", [w.ids[0]]);
  await as(ADMIN, "select archive_report_entry($1, 'Test record no longer needed')", [wEntry]); // keeps later counts exact
});

test("dismissing reuses the proposal rejection and needs a reason", async () => {
  const [, , head] = props.ids;
  await rejects(as(EDITOR, "select reject_proposal($1, '')", [head]), "22023");
  await as(EDITOR, "select reject_proposal($1, 'The head is recorded from the management page')", [head]);
  assert.equal(await one(EDITOR, "select status::text from agent_proposals where id = $1", [head]), "rejected");
});

test("archived records refuse suggestions and scan requests", async () => {
  const extra = await scanWithProposals(inst, "register-worker:4", [{ field_key: "budget_capital", candidate_state: "published",
    excerpt: "Approved Budget 2026", locator: "page 1", proposed: { period_label: "2026" } }]);
  await as(ADMIN, "select archive_report_entry($1, 'Testing the archived record')", [entry]);
  await rejects(as(ADMIN, "select apply_proposal_to_register($1, $2, $3)", [extra.ids[0], entry, await hashOf(entry)]), "22023", /removed from the register/);
  await rejects(as(ADMIN, "select request_register_scan($1)", [entry]), "22023", /removed from the register/);
  await as(ADMIN, "select restore_report_entry($1)", [entry]);
  await as(EDITOR, "select reject_proposal($1, 'test cleanup')", [extra.ids[0]]);
});

test("a scan can be requested from a linked record with an approved website", async () => {
  const unlinked = await one(ADMIN, "select save_report_entry(null, $1::jsonb, null)",
    [entryPayload({ name: "Unlinked Polytechnic", homepage_url: "https://www.bare.example.edu.ng/" })]);
  await rejects(as(EDITOR, "select request_register_scan($1)", [unlinked]), "22023", /not linked to a research institution/);
  await rejects(as(EDITOR2, "select request_register_scan($1)", [entry]), "42501", /assigned to another editor/);
  await rejects(as(null, "select request_register_scan($1)", [entry]), "42501");
  // A linked institution without an approved website needs source confirmation first.
  const bareDraft = await one(ADMIN, "select create_institution('bare-uni', 'Bare University (TEST DATA)')");
  const bare = await one(ADMIN, "select institution_id from revisions where id = $1", [bareDraft]);
  await owner("update report_entries set institution_id = $1 where id = $2", [bare, unlinked]);
  await rejects(as(EDITOR, "select request_register_scan($1)", [unlinked]), "55000", /needs source confirmation/);
  const job = await one(EDITOR, "select request_register_scan($1)", [entry]);
  assert.equal(await one(EDITOR, "select institution_id from crawl_jobs where id = $1", [job]), inst);
  assert.equal(await one(REVIEWER, "select request_register_scan($1)", [entry]), job, "one active scan per institution");
  const audits = await owner("select details from audit_events where action = 'report.scan_requested' and entity_id = $1", [entry]);
  assert.ok(audits.length >= 1 && audits[0].details.job_id === job);
  await as(EDITOR, "select cancel_scan($1)", [job]);
});

test("the research host of a homepage drops www. but never becomes a public suffix or a private name", async () => {
  const host = async (u) => one(EDITOR, "select register_research_host($1)", [u]);
  assert.equal(await host("https://www.unilag.edu.ng/"), "unilag.edu.ng");
  assert.equal(await host("https://WWW.Example.COM/about?x=1"), "example.com");
  assert.equal(await host("https://bursary.fupre.edu.ng/"), "bursary.fupre.edu.ng");
  for (const u of ["https://www.edu.ng/", "https://edu.ng", "https://www.gov.ng", "https://www.com/", "http://localhost/", "https://intranet.local/",
    "https://10.0.0.1/", "javascript:alert(1)", "", null, "https://user@unilag.edu.ng/"]) {
    assert.equal(await host(u), null, String(u));
  }
  // Social networks and shared hosting services are never one institution's website...
  for (const u of ["https://www.facebook.com/unilag", "https://m.facebook.com/unilag", "https://x.com/unilag", "https://sites.google.com/view/unilag",
    "https://drive.google.com/file/d/1", "https://wordpress.com/", "https://www.blogspot.com/", "https://unilag.github.com/", "https://linktr.ee/unilag"]) {
    assert.equal(await host(u), null, u);
  }
  // ...but an institution's own subdomain of a hosting service is its own site, and look-alike names are not caught.
  assert.equal(await host("https://www.fupre.wordpress.com/"), "fupre.wordpress.com");
  assert.equal(await host("https://unilag.blogspot.com/"), "unilag.blogspot.com");
  assert.equal(await host("https://www.box.com.ng/"), "box.com.ng");
  assert.equal(await host("https://smart.me/"), "smart.me");
});

test("administrators approve every linked record's homepage at once; refusals stand", async () => {
  await rejects(as(EDITOR, "select approve_register_homepages()"), "42501");
  await rejects(as(REVIEWER, "select approve_register_homepages()"), "42501");
  await rejects(as(null, "select approve_register_homepages()"), "42501");
  // Another linked record whose homepage host an administrator refused before.
  const refusedDraft = await one(ADMIN, "select create_institution('refused-uni', 'Refused University (TEST DATA)')");
  const refusedInst = await one(ADMIN, "select institution_id from revisions where id = $1", [refusedDraft]);
  const refusedHost = await one(EDITOR, "select add_source_host($1, 'refused.example.edu.ng')", [refusedInst]);
  await as(ADMIN, "select decide_source_host($1, false)", [refusedHost]);
  const refusedEntry = await one(ADMIN, "select save_report_entry(null, $1::jsonb, null)",
    [entryPayload({ name: "Refused University", homepage_url: "https://www.refused.example.edu.ng/" })]);
  await owner("update report_entries set institution_id = $1 where id = $2", [refusedInst, refusedEntry]);
  // A linked record whose homepage was recorded as a social media page.
  const socialDraft = await one(ADMIN, "select create_institution('social-uni', 'Social University (TEST DATA)')");
  const socialInst = await one(ADMIN, "select institution_id from revisions where id = $1", [socialDraft]);
  const socialEntry = await one(ADMIN, "select save_report_entry(null, $1::jsonb, null)",
    [entryPayload({ name: "Social University", homepage_url: "https://www.facebook.com/socialuni" })]);
  await owner("update report_entries set institution_id = $1 where id = $2", [socialInst, socialEntry]);
  const notLinked = await one(ADMIN, "select save_report_entry(null, $1::jsonb, null)",
    [entryPayload({ name: "Never Linked College", homepage_url: "https://nlc.example.edu.ng/" })]);
  const before = (await owner("select count(*)::int as n from report_entries where archived_at is null and homepage_url is not null and institution_id is null"))[0].n;
  assert.ok(before >= 1 && notLinked);

  const r = await one(ADMIN, "select approve_register_homepages()");
  assert.equal(r.not_linked, before);
  assert.equal(r.previously_refused, 1);
  assert.equal(r.approved, 1, "bare.example.edu.ng for the record linked in the last test");
  assert.equal(r.already_approved, 1, "the main record's homepage host was approved before");
  assert.equal(r.unusable, 1, "the social media homepage is skipped");
  assert.deepEqual(await owner("select host from source_hosts where institution_id = $1", [socialInst]), [], "facebook.com was not approved");
  assert.equal(await one(ADMIN, "select approved from source_hosts where id = $1", [refusedHost]), false, "a refusal stands");
  const bareInst = await one(ADMIN, "select institution_id from report_entries where name = 'Unlinked Polytechnic'");
  assert.equal(await one(ADMIN, "select approved from source_hosts where institution_id = $1 and host = 'bare.example.edu.ng'", [bareInst]), true);
  const [audit] = await owner("select actor_id, details from audit_events where action = 'research.homepages_approved' order by at desc limit 1");
  assert.equal(audit.actor_id, ADMIN);
  assert.equal(audit.details.approved, r.approved);
  // Running it again approves nothing new.
  const again = await one(ADMIN, "select approve_register_homepages()");
  assert.equal(again.approved, 0);
  assert.equal(again.already_approved, r.already_approved + r.approved);
});

// ---------------------------------------------------------------------------
// 6. Crawling: start pages from the record, and captures the model already read
// ---------------------------------------------------------------------------

const KEYS = ["budget_personnel", "budget_overhead", "budget_capital", "grants_domestic", "grants_international",
  "tetfund_allocation", "endowment_fund", "students_undergraduate", "students_postgraduate"];

test("a scan requested from a record starts from its own links on approved hosts, at most 10", async () => {
  const evidence = Object.fromEntries(KEYS.map((k, i) => [k, {
    status: "published", year: "2026", checked_on: "2026-11-01", note: null,
    evidence_url: i === 0 ? "https://elsewhere.example.com/budget" : `https://bursary.research.example.edu.ng/evidence-${i}`,
  }]));
  await as(ADMIN, "select save_report_entry($1, $2::jsonb, $3)", [entry, entryPayload({
    extra_links: [{ label: "Budget 2026", url: "https://research.example.edu.ng/budget-2026.pdf" },
                  { label: "Mirror", url: "https://mirror.example.com/budget-2026.pdf" }],
    assessments: evidence,
  }), await hashOf(entry)]);
  const job = await one(EDITOR, "select request_register_scan($1)", [entry]);
  const urls = await one(EDITOR, "select start_urls from crawl_jobs where id = $1", [job]);
  assert.equal(urls.length, 10);
  assert.equal(urls[0], "https://research.example.edu.ng/disclosure", "the disclosure page first");
  assert.equal(urls[1], "https://research.example.edu.ng/budget-2026.pdf", "then the extra documents");
  assert.ok(urls.slice(2).every((u) => u.startsWith("https://bursary.research.example.edu.ng/evidence-")), "then evidence links");
  assert.ok(!urls.some((u) => /elsewhere|mirror/.test(u)), "links on other websites are never start pages");
  const [audit] = await owner("select details from audit_events where action = 'report.scan_requested' and details->>'job_id' = $1", [job]);
  assert.equal(audit.details.start_pages, 10);
  await as(EDITOR, "select cancel_scan($1)", [job]);
});

test("captures the model read are marked, and the next scan is told about them", async () => {
  const job = await one(EDITOR, "select request_scan($1)", [inst]);
  assert.equal((await one("worker", "select worker_claim_job('mark-worker:1', 60)")).job_id, job);
  const page = (path, hash) => JSON.stringify({ requested_url: `https://research.example.edu.ng${path}`, final_url: `https://research.example.edu.ng${path}`,
    http_status: 200, content_type: "text/html", content_hash: hash, byte_length: 10, title: path, text_content: "Approved budget 2026 for the whole university." });
  const read = await one("worker", "select worker_record_source($1, 'mark-worker:1', $2)", [job, page("/read", "1".repeat(64))]);
  const skipped = await one("worker", "select worker_record_source($1, 'mark-worker:1', $2)", [job, page("/skipped", "2".repeat(64))]);
  await rejects(as("worker", "select worker_mark_sent($1, 'other-worker:1', $2::uuid[])", [job, [read]]), "55000");
  await rejects(as("worker", "select worker_mark_sent($1, 'mark-worker:1', $2::uuid[])",
    [job, Array.from({ length: 101 }, () => read)]), "22023");
  await rejects(as(EDITOR, "select worker_mark_sent($1, 'mark-worker:1', $2::uuid[])", [job, [read]]), "42501");
  // A source of another scan is never marked through this one.
  const [{ id: foreign }] = await owner("select id from source_versions where job_id <> $1 limit 1", [job]);
  await as("worker", "select worker_mark_sent($1, 'mark-worker:1', $2::uuid[])", [job, [read, foreign]]);
  const marked = await owner("select id, sent_to_model from source_versions where id = any($1)", [[read, skipped, foreign]]);
  assert.deepEqual(Object.fromEntries(marked.map((m) => [m.id, m.sent_to_model])), { [read]: true, [skipped]: false, [foreign]: false });
  await as("worker", "select worker_finish_job($1, 'mark-worker:1', 'succeeded', '{}')", [job]);

  const next = await one(EDITOR, "select request_scan($1)", [inst]);
  const claim = await one("worker", "select worker_claim_job('mark-worker:2', 60)");
  assert.equal(claim.job_id, next);
  assert.ok(claim.previous.some((p) => p.final_url === "https://research.example.edu.ng/read" && p.content_hash === "1".repeat(64)));
  assert.ok(!claim.previous.some((p) => p.final_url === "https://research.example.edu.ng/skipped"), "a capture the model never read is not skipped later");
  await as("worker", "select worker_finish_job($1, 'mark-worker:2', 'succeeded', '{}')", [next]);
});

// Phase 3 database checks: approved sources, scan jobs, worker boundaries, evidence-bound proposals,
// per-field acceptance and stale protection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const EDITOR = "00000000-0000-0000-0000-00000000000e";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const WORKER = "worker-test:1";
const dir = new URL("../../db/migrations/", import.meta.url);

const db = new PGlite();
for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  await db.exec(readFileSync(new URL(f, dir), "utf8"));
}
await db.exec(`insert into app_users (id, email, display_name, is_fixture) values
  ('${ADMIN}', 'admin@example.test', 'Fixture admin', true), ('${EDITOR}', 'editor@example.test', 'Fixture editor', true),
  ('${REVIEWER}', 'reviewer@example.test', 'Fixture reviewer', true);`);
await db.exec(`insert into team_memberships (user_id, role, display_name) values
  ('${ADMIN}', 'admin', 'Fixture admin'), ('${EDITOR}', 'editor', 'Fixture editor'),
  ('${REVIEWER}', 'reviewer', 'Fixture reviewer');`);

async function as(who, q, params = []) {
  const role = who === "worker" ? "nut_worker" : who ? "nut_member" : "nut_anon";
  const uid = who && who !== "worker" ? who : "";
  await db.exec(`select set_config('nut.user_id', '${uid}', false); set role ${role};`);
  try { return (await db.query(q, params)).rows; } finally { await db.exec("reset role;"); }
}
const one = async (who, q, params) => Object.values((await as(who, q, params))[0])[0];
const rejects = (p, code) => assert.rejects(p, (e) => (code ? e.code === code : true));

const SOURCE_TEXT = "Approved Budget 2024. Personnel costs: N12,345,678,000. Capital expenditure was not stated.";
let inst, draft, job, source;

test("a scan needs an administrator-approved official host", async () => {
  draft = await one(EDITOR, "select create_institution('test-university', 'Test University (TEST DATA)')");
  inst = await one(EDITOR, "select institution_id from revisions where id = $1", [draft]);
  await rejects(as(EDITOR, "select request_scan($1)", [inst]), "55000");
  // An editor's suggestion is not approved; an administrator approves it.
  const hostId = await one(EDITOR, "select add_source_host($1, 'https://www.TestUni.example.edu.ng/about')", [inst]);
  assert.equal(await one(EDITOR, "select approved from source_hosts where id = $1", [hostId]), false);
  await rejects(as(EDITOR, "select request_scan($1)", [inst]), "55000");
  await rejects(as(EDITOR, "select decide_source_host($1, true)", [hostId]), "42501");
  await as(ADMIN, "select decide_source_host($1, true)", [hostId]);
  await rejects(as(EDITOR, "select add_source_host($1, 'localhost')", [inst]), "22023");
  await rejects(as(EDITOR, "select add_source_host($1, '10.0.0.1')", [inst]), "23514");
});

test("start pages must be on approved hosts; one active scan per institution", async () => {
  await rejects(as(EDITOR, "select request_scan($1, $2)", [inst, ["https://evil.example.com/"]]), "22023");
  await rejects(as(EDITOR, "select request_scan($1, $2)", [inst, ["https://user@www.testuni.example.edu.ng/"]]), "22023");
  job = await one(EDITOR, "select request_scan($1, $2)", [inst, ["https://bursary.www.testuni.example.edu.ng/budget"]]);
  assert.equal(await one(REVIEWER, "select request_scan($1)", [inst]), job);
  await rejects(as(null, "select request_scan($1)", [inst]), "42501");
});

test("the worker role reads no tables and cannot use team or publication functions", async () => {
  await rejects(as("worker", "select * from revisions"), "42501");
  await rejects(as("worker", "select * from agent_proposals"), "42501");
  await rejects(as("worker", "select * from source_hosts"), "42501");
  await rejects(as("worker", "select publish_revision($1)", [draft]), "42501");
  await rejects(as("worker", "select submit_revision($1, 1)", [draft]), "42501");
  await rejects(as("worker", "select accept_proposal($1, $2, 1)", [draft, draft]), "42501");
  await rejects(as("worker", "select request_scan($1)", [inst]), "42501");
  // ...and team members cannot pose as the worker.
  await rejects(as(ADMIN, "select worker_claim_job('x-worker', 60)"), "42501");
});

test("the worker claims the job, then may only record sources on approved hosts", async () => {
  const claim = await one("worker", "select worker_claim_job($1, 120)", [WORKER]);
  assert.equal(claim.job_id, job);
  assert.deepEqual(claim.hosts, ["www.testuni.example.edu.ng"]);
  assert.equal(await one("worker", "select worker_claim_job('other-worker', 120)"), null);
  const src = (url) => JSON.stringify({ requested_url: url, final_url: url, http_status: 200, content_type: "text/html",
    content_hash: "a".repeat(64), byte_length: 100, title: "Budget", text_content: SOURCE_TEXT });
  await rejects(as("worker", "select worker_record_source($1, $2, $3)", [job, WORKER, src("https://evil.example.com/")]), "42501");
  await rejects(as("worker", "select worker_record_source($1, $2, $3)", [job, "other-worker", src("https://www.testuni.example.edu.ng/")]), "55000");
  source = await one("worker", "select worker_record_source($1, $2, $3)", [job, WORKER, src("https://www.testuni.example.edu.ng/budget")]);
  assert.ok(source);
});

const proposal = (over) => JSON.stringify({
  field_key: "budget_personnel", candidate_state: "published", source_version_id: source,
  excerpt: "Personnel costs: N12,345,678,000", locator: "Approved Budget 2024, page text",
  proposed: { period_type: "financial_year", period_label: "2024", value_amount: "12345678000", value_scale: "units",
              value_currency: "ngn", value_literal: "N12,345,678,000" },
  uncertainty: [], confidence: "high", ...over,
});
const add = (over) => one("worker", "select worker_add_proposal($1, $2, $3)", [job, WORKER, proposal(over)]);

test("proposals must cite the job's sources verbatim and stay within the assistant's limits", async () => {
  await rejects(add({ excerpt: "Personnel costs: N99,000,000,000" }), "22023");
  await rejects(add({ candidate_state: "not_found" }), "22023");
  await rejects(add({ candidate_state: "not_applicable" }), "22023");
  await rejects(add({ locator: "" }), "22023");
  await rejects(add({ field_key: "is_public" }), "22023");
  await rejects(add({ proposed: { value_amount: "5", value_scale: "units", value_currency: "NGN" } }), "22023");
  const id = await add({});
  const row = (await as(EDITOR, "select * from agent_proposals where id = $1", [id]))[0];
  assert.equal(row.proposed.value_currency, "NGN");
  assert.equal(row.existing_value.state, "not_assessed"); // set by the server from the job baseline
  assert.equal((await as(null, "select * from published_snapshots")).length, 0);
  await rejects(as(null, "select * from agent_proposals"), "42501");
});

test("accepting writes the field and its evidence into the open draft", async () => {
  const id = (await as(EDITOR, "select id from agent_proposals where status = 'pending' limit 1"))[0].id;
  const lock = await one(EDITOR, "select lock_version from revisions where id = $1", [draft]);
  const res = await one(EDITOR, "select accept_proposal($1, $2, $3)", [id, draft, lock]);
  assert.equal(res.lock_version, lock + 2);
  const ri = (await as(EDITOR, "select * from revision_indicators where revision_id = $1 and indicator_key = 'budget_personnel'", [draft]))[0];
  assert.equal(ri.state, "published");
  assert.equal(String(ri.value_amount), "12345678000");
  const ev = await as(EDITOR, "select * from evidence_links where revision_id = $1", [draft]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].url, "https://www.testuni.example.edu.ng/budget");
  await rejects(as(EDITOR, "select accept_proposal($1, $2, $3)", [id, draft, res.lock_version]), "55000");
});

test("a proposal for a field edited after the scan started is marked stale, not applied", async () => {
  const id = await add({ field_key: "budget_capital", candidate_state: "uncertain", locator: null,
    excerpt: "Capital expenditure was not stated", proposed: {} });
  let lock = await one(EDITOR, "select lock_version from revisions where id = $1", [draft]);
  // A person edits the same field while the scan is running.
  lock = await one(EDITOR, "select save_indicator($1, $2, 'budget_capital', $3)", [draft, lock, JSON.stringify({ state: "uncertain", period_label: "2023" })]);
  const res = await one(EDITOR, "select accept_proposal($1, $2, $3)", [id, draft, lock]);
  assert.deepEqual(res, { stale: true });
  assert.equal(await one(EDITOR, "select status from agent_proposals where id = $1", [id]), "stale");
  assert.equal(await one(EDITOR, "select period_label from revision_indicators where revision_id = $1 and indicator_key = 'budget_capital'", [draft]), "2023");
});

test("edited acceptance needs a reason; rejection needs a reason", async () => {
  const id = await add({ field_key: "students_undergraduate", candidate_state: "uncertain", locator: null,
    excerpt: "Approved Budget 2024", proposed: {} });
  const lock = await one(EDITOR, "select lock_version from revisions where id = $1", [draft]);
  await rejects(as(EDITOR, "select accept_proposal($1, $2, $3, $4)", [id, draft, lock, JSON.stringify({ state: "uncertain" })]), "22023");
  await rejects(as(EDITOR, "select reject_proposal($1, '')", [id]), "22023");
  await as(EDITOR, "select reject_proposal($1, 'Budget heading is not a student count')", [id]);
  assert.equal(await one(EDITOR, "select status from agent_proposals where id = $1", [id]), "rejected");
});

test("cancellation reaches the worker, and finishing releases the lease", async () => {
  await as(EDITOR, "select cancel_scan($1)", [job]);
  assert.equal(await one("worker", "select worker_heartbeat($1, $2, 120)", [job, WORKER]), "cancel");
  await as("worker", "select worker_finish_job($1, $2, 'cancelled', $3)", [job, WORKER, JSON.stringify({ pages: 1 })]);
  assert.equal(await one(EDITOR, "select status from crawl_jobs where id = $1", [job]), "cancelled");
  await rejects(add({}), "55000");
  // A new scan can be requested once the last one finished.
  assert.notEqual(await one(EDITOR, "select request_scan($1)", [inst]), job);
});

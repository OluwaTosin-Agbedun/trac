// The research worker against a real (in-memory) database, with a fake website and a fake model:
// the lease is renewed while the model reads, and a cancel or a lost lease during the call aborts it
// and stores nothing. No network, no API key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { runNextJob } from "../../src/server/research/worker.ts";
import { checkUrl } from "../../src/server/research/safeFetch.ts";
import { openPglite, runAs } from "../../src/server/db/core.ts";

const HOST = "workeruni.example.edu.ng";
const BUDGET = "<title>2026 Approved Budget</title><table><tr><td>Personnel costs</td><td>N4,250,500,000.00</td></tr></table><p>Approved by the Governing Council for the 2026 financial year.</p>";
/** The site as of one edition: another edition has different bytes (and hashes) but the same text. */
const siteEdition = (edition, budget = BUDGET) => ({
  "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
  "/": { type: "text/html", body: `<title>Worker University</title><!-- ${edition} --><p>Welcome to Worker University, a federal university in Lagos State.</p><a href="/bursary/budget-2026">2026 budget</a>` },
  "/bursary/budget-2026": { type: "text/html", body: `${budget}<!-- ${edition} -->` },
});
const SITE = siteEdition("first");

function fakeFetch(site = SITE) {
  return async (url, approvedHosts) => {
    const u = checkUrl(url, approvedHosts);
    const page = site[u.pathname];
    const body = Buffer.from(page?.body ?? "");
    return { requestedUrl: url, finalUrl: u.toString(), status: page ? 200 : 404, contentType: page?.type ?? "text/html", body,
      sha256: createHash("sha256").update(body).digest("hex"), truncated: false };
  };
}

const PROPOSAL = {
  field_key: "budget_personnel", candidate_state: "published", source_id: "S1", excerpt: "Personnel costs | N4,250,500,000.00",
  locator: "2026 Approved Budget table", period_type: "financial_year", period_label: "2026", value_literal: "N4,250,500,000.00",
  value_amount: "4250500000.00", value_scale: "units", value_currency: "NGN", value_count: null, profile_value: null,
  uncertainty: [], confidence: "high",
};

/** A model that answers only when the test says so, and honours the abort signal like the SDK. */
function slowClaude() {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  return {
    calls,
    release: () => release(),
    beta: { messages: { parse: (params, options) => new Promise((resolve, reject) => {
      calls.push({ params, options });
      const signal = options?.signal;
      if (signal?.aborted) return reject(Object.assign(new Error("Request was aborted."), { name: "AbortError" }));
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("Request was aborted."), { name: "AbortError" })));
      gate.then(() => {
        const best = params.messages[0].content.match(/<source id="(S\d+)"[^>]*budget-2026/);
        resolve({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 200 },
          parsed_output: { proposals: [{ ...PROPOSAL, source_id: best?.[1] ?? "S1" }], scan_note: "Budget found." } });
      });
    }) } },
  };
}

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const dir = new URL("../../db/migrations/", import.meta.url);
const db = await openPglite(null);
for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  await db.transaction((tx) => tx.exec(readFileSync(new URL(f, dir), "utf8")));
}
await db.transaction(async (tx) => {
  await tx.query("insert into app_users (id, email, display_name) values ($1, 'admin@example.test', 'Admin')", [ADMIN]);
  await tx.query("insert into team_memberships (user_id, role, display_name) values ($1, 'admin', 'Admin')", [ADMIN]);
});
const asAdmin = (q, p = []) => runAs(db, { kind: "user", userId: ADMIN }, (tx) => tx.query(q, p));
const owner = (q, p = []) => db.transaction((tx) => tx.query(q, p));
const heartbeats = [];
const worker = (fn) => runAs(db, { kind: "worker" }, (tx) => fn({
  query: (sql, params) => {
    if (sql.includes("worker_heartbeat")) heartbeats.push(Date.now());
    return tx.query(sql, params);
  },
  exec: (sql) => tx.exec(sql),
}));
const rev = (await asAdmin("select create_institution('worker-university', 'Worker University') as id"))[0].id;
const inst = (await asAdmin("select institution_id from revisions where id = $1", [rev]))[0].institution_id;
await asAdmin("select add_source_host($1, $2)", [inst, HOST]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Resolves once fn() is true (polling), so a test can act while the model call is in flight. */
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await wait(10);
  }
}
// Each worker sees its own edition of the site, so no scan is skipped as unchanged unless a test means it.
const deps = (claude, workerId) => ({ run: worker, workerId, fetch: fakeFetch(siteEdition(workerId)), sleep: async () => {}, claude: () => claude, heartbeatMs: 20 });

test("the lease is renewed while the model reads, and the result is stored", async () => {
  const job = (await asAdmin("select request_scan($1) as id", [inst]))[0].id;
  const claude = slowClaude();
  heartbeats.length = 0;
  const running = runNextJob(deps(claude, "renew-worker:1"));
  await until(() => claude.calls.length === 1);
  const [before] = await owner("select lease_expires_at from crawl_jobs where id = $1", [job]);
  await until(() => heartbeats.length >= 3);
  const [during] = await owner("select lease_expires_at from crawl_jobs where id = $1", [job]);
  assert.ok(new Date(during.lease_expires_at) > new Date(before.lease_expires_at), "the lease moved forward during the call");
  assert.ok(claude.calls[0].options.signal instanceof AbortSignal, "the call can be aborted");
  claude.release();
  const res = await running;
  assert.equal(res.status, "succeeded");
  const props = await asAdmin("select field_key, status::text from agent_proposals where job_id = $1", [job]);
  assert.deepEqual(props, [{ field_key: "budget_personnel", status: "pending" }]);
  // The timer is cleared when the call ends: no renewals after the scan finished.
  const count = heartbeats.length;
  await wait(100);
  assert.equal(heartbeats.length, count);
});

test("a cancel during the model call aborts it and stores nothing", async () => {
  const job = (await asAdmin("select request_scan($1) as id", [inst]))[0].id;
  const claude = slowClaude();
  const running = runNextJob(deps(claude, "cancel-worker:1"));
  await until(() => claude.calls.length === 1);
  await asAdmin("select cancel_scan($1)", [job]);
  const res = await running; // returns without the model ever answering
  assert.equal(res.status, "cancelled");
  claude.release();
  const [row] = await owner("select status::text, coverage, lease_owner from crawl_jobs where id = $1", [job]);
  assert.equal(row.status, "cancelled");
  assert.equal(row.lease_owner, null);
  assert.match(row.coverage.note, /Cancelled while the model was reading/);
  assert.equal((await owner("select count(*)::int as n from agent_proposals where job_id = $1", [job]))[0].n, 0);
  assert.equal(claude.calls[0].options.signal.aborted, true);
});

test("a lost lease during the model call aborts it, stores nothing and leaves the scan to its new worker", async () => {
  const job = (await asAdmin("select request_scan($1) as id", [inst]))[0].id;
  const claude = slowClaude();
  heartbeats.length = 0;
  const running = runNextJob(deps(claude, "slow-worker:1"));
  await until(() => claude.calls.length === 1);
  // The lease runs out and another worker takes the scan over.
  await owner("update crawl_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [job]);
  const taken = await runAs(db, { kind: "worker" }, (tx) => tx.query("select worker_claim_job('new-worker:1', 60) as c"));
  assert.equal(taken[0].c.job_id, job);
  const res = await running;
  assert.equal(res.status, "lost");
  claude.release();
  const [row] = await owner("select status::text, lease_owner from crawl_jobs where id = $1", [job]);
  assert.deepEqual(row, { status: "running", lease_owner: "new-worker:1" });
  assert.equal((await owner("select count(*)::int as n from agent_proposals where job_id = $1", [job]))[0].n, 0);
  const count = heartbeats.length;
  await wait(100);
  assert.equal(heartbeats.length, count, "no renewals after the call was abandoned");
  await runAs(db, { kind: "worker" }, (tx) => tx.query("select worker_finish_job($1, 'new-worker:1', 'cancelled', '{}')", [job]));
});

test("one failed renewal (a database blip) does not abort the model call; the result is stored", async () => {
  const job = (await asAdmin("select request_scan($1) as id", [inst]))[0].id;
  const claude = slowClaude();
  let failed = 0;
  // Fails the first renewal after the model call began with an ordinary connection error.
  const flakyRun = (fn) => runAs(db, { kind: "worker" }, (tx) => fn({
    query: (sql, params) => {
      if (sql.includes("worker_heartbeat") && claude.calls.length && failed === 0) {
        failed++;
        return Promise.reject(Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" }));
      }
      if (sql.includes("worker_heartbeat")) heartbeats.push(Date.now());
      return tx.query(sql, params);
    },
    exec: (sql) => tx.exec(sql),
  }));
  heartbeats.length = 0;
  const logs = [];
  const running = runNextJob({ ...deps(claude, "blip-worker:1"), run: flakyRun, log: (m) => logs.push(m) });
  await until(() => failed === 1 && heartbeats.length >= 2);
  assert.equal(claude.calls[0].options.signal.aborted, false, "the call goes on");
  claude.release();
  const res = await running;
  assert.equal(res.status, "succeeded");
  assert.equal((await owner("select count(*)::int as n from agent_proposals where job_id = $1", [job]))[0].n, 1);
  assert.ok(logs.some((m) => /could not renew the lease, trying again/.test(m)));
  await owner("update agent_proposals set status = 'rejected', decision_note = 'test cleanup' where job_id = $1", [job]);
});

test("text the database cannot hold (a NUL byte) is removed before storing, and quotes are checked against what is stored", async () => {
  const { storableText } = await import("../../src/server/research/worker.ts");
  assert.equal(storableText("a\u0000b\u0001c\nd\te\r", 100), "abc\nd\te\r");
  assert.equal(storableText("x💰", 2), "x", "a cut never splits a character");
  assert.equal(storableText("lone \uDC00 half", 100), "lone  half");
  const site = siteEdition("nul-edition", BUDGET.replace("Personnel costs", "Personnel\u0000 costs"));
  const job = (await asAdmin("select request_scan($1) as id", [inst]))[0].id;
  const claude = { beta: { messages: { parse: async (params) => {
    const id = params.messages[0].content.match(/<source id="(S\d+)"[^>]*budget-2026/)?.[1];
    // Text written by the model can carry a NUL too; it must not stop the scan's end from being recorded.
    return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
      parsed_output: { scan_note: "Read.\u0000 Budget found.", proposals: [{ ...PROPOSAL, source_id: id, locator: "2026 Approved\u0000 Budget table" }] } };
  } } } };
  const res = await runNextJob({ run: worker, workerId: "nul-worker:1", fetch: fakeFetch(site), sleep: async () => {}, claude: () => claude });
  assert.equal(res.status, "succeeded");
  const [job_] = await owner("select status::text, coverage->>'note' as note from crawl_jobs where id = $1", [job]);
  assert.deepEqual(job_, { status: "succeeded", note: "Read. Budget found." });
  assert.equal((await owner("select locator from agent_proposals where job_id = $1", [job]))[0].locator, "2026 Approved Budget table");
  const [budget] = await owner("select text_content from source_versions where job_id = $1 and final_url like '%budget-2026'", [job]);
  assert.ok(budget, "the page with a NUL byte was recorded");
  assert.ok(!budget.text_content.includes("\u0000"));
  assert.match(budget.text_content, /Personnel costs \| N4,250,500,000\.00/);
  assert.equal((await owner("select count(*)::int as n from agent_proposals where job_id = $1", [job]))[0].n, 1);
  await owner("update agent_proposals set status = 'rejected', decision_note = 'test cleanup' where job_id = $1", [job]);
});

test("every poll reports the worker's status, with or without a model key", async () => {
  assert.equal(await runNextJob({ run: worker, workerId: "idle-worker:1", configured: false, version: "test-1" }), null);
  let [row] = await owner("select configured, version from worker_status where worker_id = 'idle-worker:1'");
  assert.deepEqual(row, { configured: false, version: "test-1" });
  await runNextJob({ run: worker, workerId: "idle-worker:1", configured: true });
  [row] = await owner("select configured, version from worker_status where worker_id = 'idle-worker:1'");
  assert.equal(row.configured, true);
  assert.match(row.version, /^\d{4}\.\d{2}\.\d{2}$/);
});

test("the reported version adds the deployed commit when the host provides one", async () => {
  const { workerVersion, WORKER_VERSION } = await import("../../src/server/research/worker.ts");
  assert.equal(workerVersion({}), WORKER_VERSION);
  assert.equal(workerVersion({ RENDER_GIT_COMMIT: "ABCDEF1234567890" }), `${WORKER_VERSION}+abcdef1`);
  assert.equal(workerVersion({ RAILWAY_GIT_COMMIT_SHA: "not a sha; drop table" }), WORKER_VERSION);
});

// ---------------------------------------------------------------------------
// PDF text through a full scan
// ---------------------------------------------------------------------------

test("a PDF's text is captured with its pages; a scanned PDF is recorded as unreadable and sent nowhere", async () => {
  const { makePdf } = await import("./pdfFixture.mjs");
  const site = {
    "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
    "/": { type: "text/html", body: `<title>Worker University</title><a href="/docs/budget-2026.pdf">Approved budget 2026</a> <a href="/docs/audited-accounts-2025.pdf">Audited accounts 2025</a>` },
    "/docs/budget-2026.pdf": { type: "application/pdf", body: makePdf([
      ["Worker University", "Approved Budget for the 2026 financial year"],
      ["Summary of recurrent expenditure", "Personnel costs: N4,250,500,000.00", "Overhead costs: N812,000,000.00"],
    ]) },
    "/docs/audited-accounts-2025.pdf": { type: "application/pdf", body: makePdf([[], [], []]) },
  };
  const pdfFetch = async (url, approvedHosts) => {
    const u = checkUrl(url, approvedHosts);
    const page = site[u.pathname];
    const body = page ? (Buffer.isBuffer(page.body) ? page.body : Buffer.from(page.body)) : Buffer.from("");
    return { requestedUrl: url, finalUrl: u.toString(), status: page ? 200 : 404, contentType: page?.type ?? "text/html", body,
      sha256: createHash("sha256").update(body).digest("hex"), truncated: false };
  };
  const calls = [];
  const claude = { beta: { messages: { parse: async (params) => {
    calls.push(params);
    const id = params.messages[0].content.match(/<source id="(S\d+)"[^>]*budget-2026\.pdf[^>]*>/)?.[1];
    return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 700, output_tokens: 150 },
      parsed_output: { scan_note: "Budget PDF found.", proposals: [{ ...PROPOSAL, source_id: id, excerpt: "Personnel costs: N4,250,500,000.00",
        locator: "Summary of recurrent expenditure" }] } };
  } } } };
  const job = (await asAdmin("select request_scan($1) as id", [inst]))[0].id;
  const res = await runNextJob({ run: worker, workerId: "pdf-worker:1", fetch: pdfFetch, sleep: async () => {}, claude: () => claude });
  assert.equal(res.status, "succeeded");

  const sources = await owner("select final_url, text_content, extraction_method, page_count from source_versions where job_id = $1 order by final_url", [job]);
  const budget = sources.find((s) => s.final_url.endsWith("budget-2026.pdf"));
  const scanned = sources.find((s) => s.final_url.endsWith("audited-accounts-2025.pdf"));
  assert.equal(budget.extraction_method, "pdf_text");
  assert.equal(budget.page_count, 2);
  assert.match(budget.text_content, /\[Page 2\]\nSummary of recurrent expenditure\nPersonnel costs: N4,250,500,000\.00/);
  assert.equal(scanned.text_content, "");
  assert.equal(scanned.page_count, 3);
  assert.equal(sources.find((s) => s.final_url.endsWith("/")).extraction_method, "html_text");

  const [p] = await owner("select extraction_method, locator, excerpt from agent_proposals where job_id = $1", [job]);
  assert.deepEqual(p, { extraction_method: "pdf_text", locator: "Summary of recurrent expenditure, page 2", excerpt: "Personnel costs: N4,250,500,000.00" });

  const [row] = await owner("select coverage from crawl_jobs where id = $1", [job]);
  assert.deepEqual(row.coverage.unreadableDocuments, [{ url: `https://${HOST}/docs/audited-accounts-2025.pdf`, reason: "unreadable (scanned or image-only)" }]);
  assert.equal(row.coverage.documentsFetched, 2);
  // The scanned document was never offered to the model.
  assert.ok(!calls[0].messages[0].content.includes("audited-accounts-2025.pdf"));
  assert.match(calls[0].messages[0].content, /<source id="S\d+" url="[^"]*budget-2026\.pdf" title="budget-2026\.pdf" type="pdf">/);
});

// ---------------------------------------------------------------------------
// Unchanged pages are not sent to the model again
// ---------------------------------------------------------------------------

test("pages the model already read, unchanged, are not sent again; changed pages are", async () => {
  const quickClaude = (stop_reason = "end_turn") => {
    const calls = [];
    return { calls, beta: { messages: { parse: async (params) => {
      calls.push(params);
      const id = params.messages[0].content.match(/<source id="(S\d+)"[^>]*budget-2026/)?.[1];
      return { model: "claude-opus-5-5", stop_reason, usage: { input_tokens: 500, output_tokens: 100 },
        parsed_output: stop_reason === "refusal" ? null : { scan_note: "Read.", proposals: id ? [{ ...PROPOSAL, source_id: id }] : [] } };
    } } } };
  };
  const scan = async (site, claude) => {
    const job = (await asAdmin("select request_scan($1) as id", [inst]))[0].id;
    const res = await runNextJob({ run: worker, workerId: "repeat-worker:1", fetch: fakeFetch(site), sleep: async () => {}, claude: () => claude });
    const [row] = await owner("select coverage from crawl_jobs where id = $1", [job]);
    await owner("update agent_proposals set status = 'rejected', decision_note = 'test cleanup' where job_id = $1 and status = 'pending'", [job]);
    return { res, coverage: row.coverage, job };
  };

  // First scan of this edition: both pages are read and marked.
  const edition = siteEdition("repeat");
  const first = quickClaude();
  const a = await scan(edition, first);
  assert.equal(a.res.status, "succeeded");
  assert.equal(first.calls.length, 1);
  assert.equal(a.coverage.sourcesUnchanged, 0);
  assert.equal((await owner("select count(*)::int as n from source_versions where job_id = $1 and sent_to_model", [a.job]))[0].n, 2);

  // Nothing changed: the pages are captured again but the model is not called.
  const second = quickClaude();
  const b = await scan(edition, second);
  assert.equal(b.res.status, "succeeded");
  assert.equal(second.calls.length, 0);
  assert.equal(b.coverage.sourcesUnchanged, 2);
  assert.equal(b.coverage.sourcesSentToModel, 0);
  assert.match(b.coverage.note, /^Nothing new/);
  assert.equal((await owner("select count(*)::int as n from source_versions where job_id = $1", [b.job]))[0].n, 2, "still recorded as checked");

  // The budget page changed: only it is sent.
  const changed = siteEdition("repeat", BUDGET.replace("Governing Council", "Governing Council on 3 March 2026"));
  changed["/"] = edition["/"];
  const third = quickClaude();
  const c = await scan(changed, third);
  assert.equal(third.calls.length, 1);
  assert.equal(c.coverage.sourcesUnchanged, 1);
  assert.equal(c.coverage.sourcesSentToModel, 1);
  const prompt = third.calls[0].messages[0].content;
  assert.match(prompt, /budget-2026/);
  assert.ok(!prompt.includes(`url="https://${HOST}/"`), "the unchanged homepage was not sent");

  // A reply that was refused does not count as read: the next scan sends the pages again.
  const fresh = siteEdition("refused-edition");
  const refusing = quickClaude("refusal");
  await scan(fresh, refusing);
  assert.equal(refusing.calls.length, 1);
  const retry = quickClaude();
  const d = await scan(fresh, retry);
  assert.equal(retry.calls.length, 1);
  assert.equal(d.coverage.sourcesUnchanged, 0);
});

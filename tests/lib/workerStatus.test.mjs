// The research worker status line. Run: node --test tests/lib/workerStatus.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeWorker, queuedMessage, WORKER_STALE_MINUTES } from "../../src/lib/workerStatus.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const seen = (minutesAgo, configured = true) => ({ lastSeenAt: new Date(NOW - minutesAgo * 60_000).toISOString(), configured, version: "2026.11.10" });

test("a worker seen recently with a key is running", () => {
  const line = describeWorker(seen(1), { now: NOW });
  assert.deepEqual(line, { state: "running", tone: "ok", text: "The research worker is running." });
  assert.match(queuedMessage(line), /^Scan queued\. The research worker is running/);
});

test("no worker, or one not seen for a while, means scans stay queued", () => {
  assert.equal(describeWorker(null, { now: NOW }).text, "No research worker has been seen yet – scans stay queued until it runs.");
  assert.equal(describeWorker(seen(WORKER_STALE_MINUTES), { now: NOW }).text,
    `No research worker has been seen for ${WORKER_STALE_MINUTES} minutes – scans stay queued until it runs.`);
  assert.match(describeWorker(seen(180), { now: NOW }).text, /for 3 hours/);
  assert.match(describeWorker(seen(60 * 24 * 3), { now: NOW }).text, /for 3 days/);
  const missing = describeWorker(seen(30), { now: NOW });
  assert.equal(missing.tone, "warn");
  assert.equal(queuedMessage(missing), "Scan queued. No research worker has been seen for 30 minutes – scans stay queued until it runs.");
  // The web server's own key is irrelevant in production: only what the worker reported counts.
  assert.equal(describeWorker(null, { now: NOW, local: false, localConfigured: true }).state, "missing");
});

test("a running worker without a key says scans will end as Configuration required", () => {
  const line = describeWorker(seen(2, false), { now: NOW });
  assert.equal(line.state, "unconfigured");
  assert.equal(line.text, "The worker has no Anthropic API key – scans will end as Configuration required.");
  assert.match(queuedMessage(line), /will end as Configuration required/);
});

test("with the local database, scans run on this computer and its own key decides", () => {
  assert.equal(describeWorker(null, { now: NOW, local: true, localConfigured: true }).state, "local");
  assert.equal(describeWorker(null, { now: NOW, local: true, localConfigured: false }).state, "unconfigured");
  assert.match(queuedMessage(describeWorker(null, { now: NOW, local: true, localConfigured: true })), /Run queued scans now/);
  // Once the in-process worker has reported, its report is used.
  assert.equal(describeWorker(seen(1, true), { now: NOW, local: true, localConfigured: false }).state, "running");
});

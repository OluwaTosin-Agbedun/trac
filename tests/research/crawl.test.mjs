// The crawler's retries and its User-Agent contact. A fake website; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { crawlInstitution, CRAWL_DEFAULTS, isTransientFailure } from "../../src/server/research/crawl.ts";
import { checkUrl, FetchRefused, userAgent } from "../../src/server/research/safeFetch.ts";

const HOST = "retryuni.example.edu.ng";
const PAGES = {
  "/robots.txt": "User-agent: *\nAllow: /\n",
  "/": `<title>Retry University</title><a href="/bursary/budget">Budget</a>`,
  "/bursary/budget": "<p>Approved budget 2026: personnel costs N1,000,000,000.</p>",
};

/** A fake fetch that answers from PAGES, after the given failures for each path (one per call). */
function flaky(failures) {
  const calls = [];
  const fetch = async (url, approvedHosts) => {
    const u = checkUrl(url, approvedHosts);
    calls.push(u.pathname);
    const next = failures[u.pathname]?.shift();
    if (next instanceof Error) throw next;
    const status = typeof next === "number" ? next : PAGES[u.pathname] ? 200 : 404;
    const body = Buffer.from(status === 200 ? PAGES[u.pathname] : "");
    return { requestedUrl: url, finalUrl: u.toString(), status, contentType: u.pathname === "/robots.txt" ? "text/plain" : "text/html", body,
      sha256: createHash("sha256").update(body).digest("hex"), truncated: false };
  };
  return { fetch, calls };
}

const run = (fetch, sleeps = []) => crawlInstitution({ hosts: [HOST], startUrls: [], pageBudget: 10, docBudget: 0 },
  { fetch, sleep: async (ms) => { sleeps.push(ms); }, shouldStop: async () => false, hostDelayMs: 0 });

test("a timeout or a dropped connection is tried once more after a pause", async () => {
  const dropped = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  const { fetch, calls } = flaky({ "/": [new FetchRefused("The website took too long to respond.", "timeout")], "/bursary/budget": [dropped] });
  const sleeps = [];
  const r = await run(fetch, sleeps);
  assert.deepEqual(r.sources.map((s) => new URL(s.finalUrl).pathname).sort(), ["/", "/bursary/budget"]);
  assert.equal(r.coverage.retried, 2);
  assert.deepEqual(r.coverage.failures, []);
  assert.equal(calls.filter((p) => p === "/").length, 2);
  assert.equal(sleeps.filter((ms) => ms === CRAWL_DEFAULTS.retryDelayMs).length, 2, "each retry waits first");
});

test("a busy server (429, 502, 503, 504) gets one more try; a second failure is reported", async () => {
  const { fetch } = flaky({ "/": [503], "/bursary/budget": [429, 502] });
  const r = await run(fetch);
  assert.ok(r.sources.some((s) => s.finalUrl.endsWith("/")), "the homepage worked the second time");
  assert.deepEqual(r.coverage.failures, [{ url: `https://${HOST}/bursary/budget`, reason: "HTTP 502" }]);
  assert.equal(r.coverage.retried, 2);
});

test("refusals by the safety rules and ordinary errors are not retried", async () => {
  const { fetch, calls } = flaky({ "/": [new FetchRefused("Content type image/png is not collected.", "content_type")] });
  const r = await run(fetch);
  assert.equal(calls.filter((p) => p === "/").length, 1);
  assert.equal(r.coverage.retried, 0);
  assert.equal(r.coverage.failures.length, 1);
  const notFound = flaky({ "/": [404] });
  const r2 = await run(notFound.fetch);
  assert.equal(notFound.calls.filter((p) => p === "/").length, 1);
  assert.equal(r2.coverage.retried, 0);
  for (const reason of ["host_not_approved", "blocked_address", "protocol", "redirects", "dns"]) {
    assert.equal(isTransientFailure(new FetchRefused("x", reason)), false, reason);
  }
  assert.equal(isTransientFailure(Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" })), true);
  assert.equal(isTransientFailure(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" })), false);
  assert.equal(isTransientFailure(new Error("socket hang up")), true);
});

test("the crawler names the public site as its contact when SITE_URL is set", () => {
  assert.equal(userAgent({ SITE_URL: "https://tracker.example.org/" }), "NigerianInstitutionComplianceResearch/1.0 (+https://tracker.example.org)");
  assert.equal(userAgent({ SITE_URL: "https://example.org/tracker" }), "NigerianInstitutionComplianceResearch/1.0 (+https://example.org/tracker)");
  for (const bad of [undefined, "", "not a url", "https://evil.example\r\nX-Injected: 1", "javascript:alert(1)", "https://x.org/a b"]) {
    assert.match(userAgent({ SITE_URL: bad }), /^NigerianInstitutionComplianceResearch\/1\.0 \(\+https:\/\/github\.com\//, String(bad));
  }
  // The robots.txt token is unchanged, so rules written for the crawler still apply.
  assert.match(userAgent({}), /^NigerianInstitutionComplianceResearch\//);
});

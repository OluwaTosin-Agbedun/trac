// Link checks: wrong-institution links, homepage-only links, redirects to the homepage, dead links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLink, linkTargets, sameSite } from "../../src/server/research/linkCheck.ts";
import { FetchRefused } from "../../src/server/research/safeFetch.ts";

const ok = (finalUrl, status = 200) => async () => ({ requestedUrl: finalUrl, finalUrl, status, contentType: "text/html", body: Buffer.from(""), sha256: "0".repeat(64), truncated: false });

test("same site: www and subdomains count, other institutions do not", () => {
  assert.equal(sameSite("www.uniben.edu.ng", "uniben.edu.ng"), true);
  assert.equal(sameSite("news.uniben.edu.ng", "www.uniben.edu.ng"), true);
  assert.equal(sameSite("fupre.edu.ng", "pti.edu.ng"), false);
});

test("a disclosure link on another institution's website is flagged before fetching", async () => {
  let fetched = false;
  const r = await checkLink({ url: "https://fupre.edu.ng/data-disclosure/", kind: "disclosure" }, "https://pti.edu.ng/", async () => { fetched = true; throw new Error("no"); });
  assert.equal(r.result, "other_site");
  assert.equal(fetched, false);
  assert.match(r.detail, /fupre\.edu\.ng.*pti\.edu\.ng/);
});

test("homepage-only links, redirects to the homepage and dead links are reported", async () => {
  assert.equal((await checkLink({ url: "https://www.unn.edu.ng/", kind: "disclosure" }, "https://www.unn.edu.ng/", ok("https://www.unn.edu.ng/"))).result, "homepage");
  assert.equal((await checkLink({ url: "https://naub.edu.ng/data", kind: "disclosure" }, "https://naub.edu.ng/", ok("https://naub.edu.ng/"))).result, "redirects_to_homepage");
  assert.equal((await checkLink({ url: "https://unizik.edu.ng/fund-allocation/", kind: "disclosure" }, "https://unizik.edu.ng/", ok("https://unizik.edu.ng/fund-allocation/", 404))).result, "not_found");
  assert.equal((await checkLink({ url: "https://naub.edu.ng/key-institutional-information/", kind: "disclosure" }, "https://naub.edu.ng/", ok("https://naub.edu.ng/key-institutional-information/"))).result, "ok");
  assert.equal((await checkLink({ url: "https://naub.edu.ng/", kind: "homepage" }, "https://naub.edu.ng/", ok("https://naub.edu.ng/"))).result, "ok");
});

test("off-site redirects, unsafe addresses and documents are classified", async () => {
  const refuse = (reason) => async () => { throw new FetchRefused("x", reason); };
  assert.equal((await checkLink({ url: "https://a.edu.ng/x", kind: "disclosure" }, null, refuse("host_not_approved"))).result, "other_site");
  assert.equal((await checkLink({ url: "https://a.edu.ng/x", kind: "disclosure" }, null, refuse("blocked_address"))).result, "blocked");
  assert.equal((await checkLink({ url: "https://a.edu.ng/b.xlsx", kind: "disclosure" }, null, refuse("content_type"))).result, "ok");
  assert.equal((await checkLink({ url: "not a url", kind: "disclosure" }, null)).result, "error");
});

test("each address of a record is checked once", () => {
  const t = linkTargets({ homepage_url: "https://a.edu.ng/", disclosure_url: "https://a.edu.ng/data", extra_links: [{ label: "x", url: "https://a.edu.ng/data" }],
    assessments: { budget_personnel: { evidence_url: "https://a.edu.ng/budget.pdf" }, budget_overhead: { evidence_url: "https://a.edu.ng/budget.pdf" } } });
  assert.deepEqual(t.map((x) => x.kind), ["homepage", "disclosure", "evidence:budget_personnel"]);
});

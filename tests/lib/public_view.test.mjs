// Public register page helpers: reporting-year notes, the list's search and sort, the comparison's
// basis check, and the site address and contact settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPARE_MAX, compareDifferences, compareHref, countBySection, filterRows, findingYear, hostOf, httpUrl, listHref,
  parseListParams, periodWords, scoreRow, statesIn,
} from "../../src/components/register/view.ts";
import { absoluteUrl, parseBasePath, parseEmail, parseOrigin, siteConfig } from "../../src/components/site/siteConfig.ts";
import { REPORT_SECTIONS, reportSection } from "../../src/lib/report.ts";
import { INDICATORS } from "../../src/lib/indicators.ts";

const all = (status, year = "2026") => Object.fromEntries(INDICATORS.map((d) => [d.key, { status, year }]));
const row = (over) => ({
  id: over.slug, slug: "x", section: "federal_university", name: "X", state: null, verified: null, verifiedAt: null,
  verifiedMethod: "2026.1", verifiedAssessmentYear: 2026, ...over,
});

test("every category has a singular label (no more 'Federal universitie')", () => {
  for (const s of REPORT_SECTIONS) {
    assert.ok(s.singular && !s.singular.endsWith("ie"), s.key);
    assert.ok(s.label.toLowerCase().startsWith(s.singular.toLowerCase().slice(0, -1)), s.key);
  }
  assert.equal(reportSection("federal_university").singular, "Federal university");
  assert.equal(reportSection("nope"), undefined);
});

test("an outdated finding says which year it covers and which year it should", () => {
  const f = findingYear("budget_capital", { status: "published", year: "2024" }, 2026);
  assert.equal(f.outdated, true);
  assert.equal(f.expected, 2026);
  assert.equal(f.note, "Published for 2024; the period is 2026");
  // Previous-year indicators expect the year before.
  assert.equal(findingYear("endowment_fund", { status: "nil", year: "2025" }, 2026).outdated, false);
  assert.equal(findingYear("endowment_fund", { status: "partial", year: "2023/2024" }, 2026).note, "Partially published for 2023/2024; the period is 2025");
  // Not found is never outdated; no assessment year, no freshness rule.
  assert.equal(findingYear("budget_capital", { status: "not_found", year: "2020" }, 2026).outdated, false);
  assert.equal(findingYear("budget_capital", { status: "published", year: "2020" }, null).outdated, false);
  assert.equal(periodWords("budget_capital"), "Current year");
  assert.equal(periodWords("students_postgraduate"), "Previous year");
});

test("each record is scored under its own assessment year", () => {
  const assessments = all("published", "2025");
  // Budget and TETFund need 2026 under a 2026 assessment: four outdated findings.
  const under2026 = scoreRow(row({ verified: { assessments }, verifiedAssessmentYear: 2026 }));
  assert.equal(under2026.outdated, 4);
  assert.equal(under2026.points, INDICATORS.length - 4);
  const under2025 = scoreRow(row({ verified: { assessments }, verifiedAssessmentYear: 2025 }));
  assert.equal(under2025.outdated, 0);
  assert.equal(under2025.label, "fully_disclosed");
  assert.equal(scoreRow(row({ verified: null })), null);
});

test("links are rendered only for http(s) addresses", () => {
  assert.equal(httpUrl("https://unilag.edu.ng/budget.pdf"), "https://unilag.edu.ng/budget.pdf");
  assert.equal(httpUrl(" http://a.ng "), "http://a.ng");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "https://a.ng/\"onmouseover=x", "ftp://a.ng", "", null, undefined]) {
    assert.equal(httpUrl(bad), null, String(bad));
  }
  assert.equal(hostOf("https://www.unilag.edu.ng/x"), "unilag.edu.ng");
  assert.equal(hostOf("javascript:alert(1)"), null);
});

test("list params are narrowed: unknown values fall back, text is capped", () => {
  const p = parseListParams({ section: "state_polytechnic", q: "  Lagos  ", state: "Lagos", verified: "1", sort: "state" });
  assert.deepEqual(p, { section: "state_polytechnic", q: "lagos", qRaw: "Lagos", state: "Lagos", verifiedOnly: true, sort: "state" });
  const d = parseListParams({ section: "<script>", sort: "score", q: ["a".repeat(500)] });
  assert.equal(d.section, "federal_university");
  assert.equal(d.sort, "name");
  assert.equal(d.qRaw.length, 100);
});

test("search matches every word across name, state and head; sort by name or state", () => {
  const rows = [
    row({ slug: "b", name: "Bayero University", state: "Kano", section: "federal_university" }),
    row({ slug: "a", name: "Abia State University", state: "Abia", section: "state_university", verified: { head_name: "Prof. Okoro", assessments: {} } }),
    row({ slug: "c", name: "Akanu Ibiam Polytechnic", state: "Ebonyi", section: "federal_polytechnic" }),
  ];
  const base = { q: "", state: "", verifiedOnly: false, sort: "name" };
  assert.deepEqual(filterRows(rows, base).map((r) => r.slug), ["a", "c", "b"]);
  assert.deepEqual(filterRows(rows, { ...base, sort: "state" }).map((r) => r.slug), ["a", "c", "b"]);
  assert.deepEqual(filterRows(rows, { ...base, q: "university kano" }).map((r) => r.slug), ["b"]);
  assert.deepEqual(filterRows(rows, { ...base, q: "okoro" }).map((r) => r.slug), ["a"]);
  assert.deepEqual(filterRows(rows, { ...base, verifiedOnly: true }).map((r) => r.slug), ["a"]);
  assert.deepEqual(filterRows(rows, { ...base, state: "Ebonyi" }).map((r) => r.slug), ["c"]);
  const counts = countBySection(filterRows(rows, { ...base, q: "university" }));
  assert.equal(counts.federal_university, 1);
  assert.equal(counts.state_university, 1);
  assert.equal(counts.federal_polytechnic, 0);
  assert.deepEqual(statesIn(rows), ["Abia", "Ebonyi", "Kano"]);
  // Filtering never reorders the caller's array.
  assert.deepEqual(rows.map((r) => r.slug), ["b", "a", "c"]);
});

test("list and compare addresses carry only what is set", () => {
  assert.equal(listHref({}), "/institutions");
  assert.equal(listHref({ section: "state_university", sort: "name" }), "/institutions?section=state_university");
  assert.equal(listHref({ q: "a b", state: "Kano", verified: true, sort: "state" }), "/institutions?q=a+b&state=Kano&verified=1&sort=state");
  assert.equal(compareHref([]), "/compare");
  assert.equal(compareHref(["a-uni", "b-poly"]), "/compare?i=a-uni,b-poly");
  assert.equal(COMPARE_MAX, 4);
});

test("comparison states differences in assessment year and rule version first", () => {
  const a = { name: "A", verifiedAssessmentYear: 2026, verifiedMethod: "2026.1" };
  assert.deepEqual(compareDifferences([a, { ...a, name: "B" }]), []);
  const msgs = compareDifferences([a, { name: "B", verifiedAssessmentYear: 2025, verifiedMethod: "2025.1" }]);
  assert.equal(msgs.length, 2);
  assert.match(msgs[0], /different assessment years: A \(2026\), B \(2025\)/);
  assert.match(msgs[1], /different versions of the scoring rule: A \(rule 2026\.1\), B \(rule 2025\.1\)/);
});

test("site settings: SITE_URL is an origin, the base path is a path, the email is an email", () => {
  assert.equal(parseOrigin("https://tracker.example.org/"), "https://tracker.example.org");
  assert.equal(parseOrigin("https://tracker.example.org/path"), null);
  assert.equal(parseOrigin("javascript:alert(1)"), null);
  assert.equal(parseOrigin(undefined), null);
  assert.equal(parseBasePath("/tracker/"), "/tracker");
  assert.equal(parseBasePath("tracker"), "");
  assert.equal(parseBasePath("/a b"), "");
  assert.equal(parseEmail(" research@athena.org.ng "), "research@athena.org.ng");
  assert.equal(parseEmail("not an email"), null);
  assert.equal(parseEmail("a@b.ng?bcc=x@y.ng"), null);
  const cfg = siteConfig({ SITE_URL: "https://x.org", NEXT_PUBLIC_BASE_PATH: "/tracker", CONTACT_EMAIL: "" });
  assert.deepEqual(cfg, { origin: "https://x.org", basePath: "/tracker", contactEmail: null });
  assert.equal(absoluteUrl("/", cfg), "https://x.org/tracker");
  assert.equal(absoluteUrl("/institutions/abc", cfg), "https://x.org/tracker/institutions/abc");
  assert.equal(absoluteUrl("/", { ...cfg, basePath: "" }), "https://x.org/");
  assert.equal(absoluteUrl("/x", { ...cfg, origin: null }), null);
});

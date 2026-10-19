// Comparison basis checks and period placement. Run: node --test tests/lib/compare.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareCompatibility,
  describePeriod,
  normalisePeriodLabel,
  parseCompareSelection,
  periodCoverage,
  periodYears,
} from "../../src/lib/compare.ts";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isSlug = (s) => SLUG_RE.test(s) && s.length <= 120;

const FY = (y) => ({ period_type: "financial_year", period_label: String(y), period_start: `${y}-01-01`, period_end: `${y}-12-31` });
const SESSION = (a) => ({ period_type: "academic_session", period_label: `${a}/${a + 1}`, period_start: `${a}-09-01`, period_end: `${a + 1}-08-31` });
const NONE = { period_type: null, period_label: null, period_start: null, period_end: null };

const KEYS = [
  ["budget_personnel", "Personnel costs"],
  ["budget_overhead", "Overhead costs"],
  ["students_postgraduate", "Postgraduates"],
];

function inst(name, { period = "FY 2025", methodology = "v1-draft", overrides = {} } = {}) {
  return {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    assessmentPeriod: period,
    methodologyVersionId: methodology,
    indicators: KEYS.map(([key, label]) => ({ key, label, state: "published", ...FY(2025), ...(overrides[key] ?? {}) })),
  };
}

test("period labels normalise without changing their meaning", () => {
  assert.equal(normalisePeriodLabel("  FY   2025 "), "fy 2025");
  assert.equal(normalisePeriodLabel("2024-25"), "2024/2025");
  assert.equal(normalisePeriodLabel("2024–2025"), "2024/2025");
  assert.equal(normalisePeriodLabel("2099/00"), "2099/2100");
  assert.equal(normalisePeriodLabel(""), null);
  assert.equal(normalisePeriodLabel(null), null);
});

test("periodYears reads years, sessions and multi-year spans", () => {
  assert.deepEqual(periodYears("FY 2025"), { from: 2025, to: 2025 });
  assert.deepEqual(periodYears("2024/2025"), { from: 2024, to: 2025 });
  assert.deepEqual(periodYears("2024/25 session"), { from: 2024, to: 2025 });
  assert.deepEqual(periodYears("2020–2024 strategic plan"), { from: 2020, to: 2024 });
  assert.equal(periodYears("current year"), null);
  assert.equal(periodYears(null), null);
});

test("periodCoverage keeps prior-year evidence historical and unknown stays unknown", () => {
  assert.equal(periodCoverage("2023", "FY 2025"), "historical");
  assert.equal(periodCoverage("2025", "FY 2025"), "in_period");
  assert.equal(periodCoverage("2024/2025", "FY 2025"), "in_period");
  assert.equal(periodCoverage("2026", "FY 2025"), "later");
  assert.equal(periodCoverage(null, "FY 2025"), "unknown");
  assert.equal(periodCoverage("2025", null), "unknown");
  assert.equal(periodCoverage("undated circular", "FY 2025"), "unknown");
});

test("describePeriod states type and, when asked, boundaries", () => {
  assert.equal(describePeriod(FY(2025)), "2025 (Financial year)");
  assert.equal(describePeriod(FY(2025), true), "2025 (Financial year, 1 Jan 2025 to 31 Dec 2025)");
  assert.equal(describePeriod(NONE), "period not stated");
  assert.equal(describePeriod({ ...NONE, period_type: "unknown" }), "period not stated");
});

test("parseCompareSelection accepts comma lists and repeated params, drops invalid and duplicates", () => {
  assert.deepEqual(parseCompareSelection("a-uni,b-poly", 4, isSlug), { slugs: ["a-uni", "b-poly"], truncated: false, invalid: 0 });
  assert.deepEqual(parseCompareSelection(["a-uni", "", "b-poly,a-uni"], 4, isSlug), { slugs: ["a-uni", "b-poly"], truncated: false, invalid: 0 });
  assert.deepEqual(parseCompareSelection(["A-Uni", "../etc", "<script>"], 4, isSlug), { slugs: ["a-uni"], truncated: false, invalid: 2 });
  assert.deepEqual(parseCompareSelection("a,b,c,d,e", 4, isSlug), { slugs: ["a", "b", "c", "d"], truncated: true, invalid: 0 });
  assert.deepEqual(parseCompareSelection(undefined, 4, isSlug), { slugs: [], truncated: false, invalid: 0 });
});

test("one institution or identical bases produce no warnings", () => {
  assert.deepEqual(compareCompatibility([inst("Alpha")]).warnings, []);
  const r = compareCompatibility([inst("Alpha"), inst("Beta")]);
  assert.equal(r.sameBasis, true);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.indicatorFlags, {});
});

test("mixed and missing assessment periods are flagged", () => {
  const r = compareCompatibility([inst("Alpha", { period: "FY 2024" }), inst("Beta"), inst("Gamma", { period: null })]);
  assert.equal(r.sameBasis, false);
  const kinds = r.warnings.map((w) => w.kind);
  assert.ok(kinds.includes("assessment_period_mixed"));
  assert.ok(kinds.includes("assessment_period_unknown"));
  assert.match(r.warnings.find((w) => w.kind === "assessment_period_unknown").message, /Gamma/);
  // Case and spacing differences alone are not a different period.
  assert.deepEqual(compareCompatibility([inst("Alpha", { period: "fy  2025" }), inst("Beta")]).warnings, []);
});

test("different methodology versions are flagged", () => {
  const r = compareCompatibility([inst("Alpha"), inst("Beta", { methodology: "v2" })]);
  assert.deepEqual(r.warnings.map((w) => w.kind), ["methodology_differs"]);
  assert.match(r.warnings[0].message, /Beta \(v2\)/);
});

test("an indicator whose period differs between institutions is flagged on that indicator", () => {
  const r = compareCompatibility([
    inst("Alpha"),
    inst("Beta", { overrides: { budget_personnel: FY(2023) } }),
  ]);
  assert.deepEqual(r.warnings.map((w) => [w.kind, w.indicatorKey]), [["indicator_period_differs", "budget_personnel"]]);
  assert.deepEqual(r.indicatorFlags, { budget_personnel: ["period_differs"] });
  assert.match(r.warnings[0].message, /Personnel costs: reporting periods differ: Alpha, 2025 \(Financial year\); Beta, 2023 \(Financial year\)/);
});

test("same label but different period boundaries or types still differ", () => {
  const aprToMar = { period_type: "financial_year", period_label: "2025", period_start: "2025-04-01", period_end: "2026-03-31" };
  const r = compareCompatibility([inst("Alpha"), inst("Beta", { overrides: { budget_overhead: aprToMar } })]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].message, /1 Apr 2025 to 31 Mar 2026/);

  const r2 = compareCompatibility([inst("Alpha"), inst("Beta", { overrides: { budget_overhead: SESSION(2024) } })]);
  assert.deepEqual(r2.indicatorFlags, { budget_overhead: ["period_differs"] });
});

test("an evidenced finding with no stated period is flagged; unassessed blanks are not", () => {
  const r = compareCompatibility([
    inst("Alpha"),
    inst("Beta", { overrides: { budget_personnel: { ...NONE, state: "uncertain" }, budget_overhead: { ...NONE, state: "not_assessed" } } }),
  ]);
  assert.deepEqual(r.warnings.map((w) => [w.kind, w.indicatorKey]), [["indicator_period_unknown", "budget_personnel"]]);
  assert.deepEqual(r.indicatorFlags, { budget_personnel: ["period_unknown"] });
});

test("applicability that differs between institutions is flagged", () => {
  const r = compareCompatibility([
    inst("Alpha"),
    inst("Beta", { overrides: { students_postgraduate: { ...NONE, state: "not_applicable" } } }),
  ]);
  assert.deepEqual(r.warnings.map((w) => [w.kind, w.indicatorKey]), [["applicability_differs", "students_postgraduate"]]);
  assert.match(r.warnings[0].message, /excluded as not applicable for Beta, but treated as applicable for Alpha/);
  // Excluded everywhere is the same basis for that indicator.
  const all = compareCompatibility([
    inst("Alpha", { overrides: { students_postgraduate: { ...NONE, state: "not_applicable" } } }),
    inst("Beta", { overrides: { students_postgraduate: { ...NONE, state: "not_applicable" } } }),
  ]);
  assert.deepEqual(all.warnings, []);
});

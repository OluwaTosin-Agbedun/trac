// CSV quoting, formula-injection protection and the current-release column layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  csvCell, toCsv, neutraliseFormula, currentReleaseHeader, currentReleaseRow, currentReleaseTable,
  RELEASE_COLUMNS, INDICATOR_COLUMNS, CSV_BOM, CURRENT_RELEASE_FILENAME,
} from "../../src/lib/csv.ts";

test("plain values pass through unquoted", () => {
  assert.equal(csvCell("Oyo"), "Oyo");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell(true), "true");
  assert.equal(csvCell(10n), "10");
  assert.equal(csvCell(new Date("2026-10-10T09:30:00Z")), "2026-10-10T09:30:00.000Z");
});

test("null, undefined and unusable values become empty cells", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(""), "");
  assert.equal(csvCell(Number.NaN), "");
  assert.equal(csvCell(Number.POSITIVE_INFINITY), "");
  assert.equal(csvCell(new Date("not a date")), "");
  assert.equal(toCsv([["a", null, undefined, "b"]]), "a,,,b\r\n");
});

test("commas, quotes and line breaks are quoted per RFC 4180", () => {
  assert.equal(csvCell("Published, evidence checked"), '"Published, evidence checked"');
  assert.equal(csvCell('The "Federal" University'), '"The ""Federal"" University"');
  assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
  assert.equal(csvCell("line one\r\nline two"), '"line one\r\nline two"');
  assert.equal(csvCell("₦4,250.5 million"), '"₦4,250.5 million"');
  // Quotes alone also force quoting, and are doubled.
  assert.equal(csvCell('"'), '""""');
});

test("records end with CRLF and an empty table is an empty string", () => {
  assert.equal(toCsv([]), "");
  assert.equal(toCsv([["slug", "name"], ["a-b", "A, B"]]), 'slug,name\r\na-b,"A, B"\r\n');
  // A multi-line cell stays one record.
  const csv = toCsv([["x"], ["one\ntwo"], ["y"]]);
  assert.equal(csv, 'x\r\n"one\ntwo"\r\ny\r\n');
});

test("formula-like cells are prefixed with a single quote", () => {
  assert.equal(csvCell("=SUM(A1:A9)"), "'=SUM(A1:A9)");
  assert.equal(csvCell("+2348000000000"), "'+2348000000000");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("\tleading tab"), "'\tleading tab");
  assert.equal(csvCell("\rleading return"), '"\'\rleading return"');
  assert.equal(csvCell("  =1+1"), "'  =1+1");
  assert.equal(csvCell("＝1+1"), "'＝1+1");
  // Neutralise first, then quote: the quote prefix sits inside the quoted field.
  assert.equal(csvCell('=HYPERLINK("http://x.test","click")'), '"\'=HYPERLINK(""http://x.test"",""click"")"');
  assert.equal(csvCell("=1,2"), "\"'=1,2\"");
  // Any cell starting with a trigger character, numbers included.
  assert.equal(csvCell(-5), "'-5");
});

test("ordinary text containing trigger characters later is left alone", () => {
  assert.equal(neutraliseFormula("A=B"), "A=B");
  assert.equal(neutraliseFormula("info@example.org"), "info@example.org");
  assert.equal(neutraliseFormula("2024/2025"), "2024/2025");
  assert.equal(neutraliseFormula("₦-5"), "₦-5");
  assert.equal(csvCell("https://example.org/a?b=c"), "https://example.org/a?b=c");
});

const ind = (key, extra = {}) => ({
  key, group: "", label: "", state: "not_assessed", period_type: null, period_label: null, period_start: null, period_end: null,
  value_amount: null, value_scale: null, value_currency: null, value_count: null, value_literal: null, reason: null, evidence: [],
  ...extra,
});

const snapshot = {
  id: "s1",
  institutionId: "i1",
  slug: "demo-university-test-data",
  releaseNumber: 2,
  publishedAt: "2026-10-12T08:00:00.000Z",
  methodologyVersionId: "v1-draft",
  isCurrent: true,
  payload: {
    profile: {
      name: "=Demo University (TEST DATA)", short_name: null, ownership: "federal", institution_type: "university",
      state: "Oyo", city: "Example Town", head_name: null, head_title: null, bursar_name: null,
      website_url: "javascript:alert(1)", assessment_period: "FY 2025", methodology_version_id: "v1-draft",
      last_verified_at: "2026-10-11T10:15:00+01:00",
    },
    indicators: [
      ind("budget_personnel", {
        state: "published", period_label: "2025", value_amount: "4250.5", value_scale: "millions", value_currency: "NGN",
        value_literal: "₦4,250.5m",
        evidence: [
          { id: "e0", url: "javascript:alert(1)", title: null, excerpt: null, locator: null, captured_at: null },
          { id: "e1", url: "https://example.org/budget.pdf", title: null, excerpt: null, locator: "p. 4", captured_at: null },
        ],
      }),
      ind("budget_capital", { state: "published", period_label: "2025", value_literal: "₦1.2bn" }),
      // A value carried over from an earlier release onto an indicator now marked not found.
      ind("grants_domestic", { state: "not_found", period_label: "2024", value_amount: "0", value_scale: "units", value_currency: "NGN" }),
      ind("grants_international", { state: "published", period_label: "2025", value_amount: "0", value_scale: "units", value_currency: "NGN" }),
      ind("tetfund_allocation", { state: "not_found" }),
      ind("endowment_fund", { state: "not_applicable", reason: "No endowment fund (fixture)." }),
      ind("students_undergraduate", { state: "published", period_start: "2024-09-01", period_end: "2025-08-31", value_count: 18450 }),
      ind("students_postgraduate", { state: "uncertain", value_literal: "about 2,000" }),
    ],
    profile_evidence: [],
    summary: { published: 3, applicable: 8, assessed: 5, excluded: 1, uncertain: 1, total: 9, label: "assessment_incomplete" },
  },
};

test("the header lists the institution columns then four columns per indicator", () => {
  const header = currentReleaseHeader();
  assert.equal(header.length, RELEASE_COLUMNS.length + 9 * INDICATOR_COLUMNS.length);
  assert.deepEqual(header.slice(0, 17), [
    "slug", "name", "ownership", "institution_type", "state", "city", "website_url", "assessment_period",
    "methodology_version", "release_number", "published_at", "last_verified_at", "summary_label",
    "published_count", "applicable_count", "assessed_count", "excluded_count",
  ]);
  assert.deepEqual(header.slice(17, 21), [
    "budget_personnel_state", "budget_personnel_period", "budget_personnel_value", "budget_personnel_evidence_url",
  ]);
  assert.equal(header.at(-1), "students_postgraduate_evidence_url");
  assert.equal(CURRENT_RELEASE_FILENAME, "compliance-monitoring-portal-current-release.csv");
  assert.equal(CSV_BOM, "﻿");
});

test("a release row keeps public wording, explicit scales, zeros and unknowns", () => {
  const header = currentReleaseHeader();
  const row = currentReleaseRow(snapshot);
  assert.equal(row.length, header.length);
  const get = (name) => row[header.indexOf(name)];
  assert.equal(get("ownership"), "Federal");
  assert.equal(get("institution_type"), "University");
  assert.equal(get("website_url"), "", "non-http website addresses are dropped");
  assert.equal(get("published_at"), "2026-10-12T08:00:00.000Z");
  assert.equal(get("last_verified_at"), "2026-10-11T09:15:00.000Z", "verification date normalised to UTC");
  assert.equal(get("summary_label"), "Assessment incomplete");
  assert.equal(get("published_count"), 3);
  assert.equal(get("excluded_count"), 1);
  assert.equal(get("budget_personnel_state"), "Published, evidence checked");
  assert.equal(get("budget_personnel_value"), "₦4,250.5 million");
  assert.equal(get("budget_personnel_evidence_url"), "https://example.org/budget.pdf", "first http(s) evidence link");
  assert.equal(get("grants_international_value"), "₦0", "a published zero is not empty");
  assert.equal(get("tetfund_allocation_state"), "Not found in the sources reviewed");
  assert.equal(get("tetfund_allocation_value"), "");
  assert.equal(get("tetfund_allocation_period"), "");
  assert.equal(get("endowment_fund_state"), "Not applicable, with reason");
  assert.equal(get("students_undergraduate_period"), "2024-09-01 to 2025-08-31");
  assert.equal(get("students_undergraduate_value"), "18450");
  assert.equal(get("budget_capital_value"), "₦1.2bn", "literal used when no structured value");
  assert.equal(get("grants_domestic_state"), "Not found in the sources reviewed");
  assert.equal(get("grants_domestic_value"), "", "values are written only for published findings");
  assert.equal(get("students_postgraduate_state"), "Evidence uncertain");
  assert.equal(get("students_postgraduate_value"), "", "an uncertain figure is not reported as a value");
  // Indicators missing from the release stay empty rather than being given a status.
  assert.equal(get("budget_overhead_state"), null);
  assert.equal(get("budget_overhead_evidence_url"), null);
});

test("the whole table is safe to open in a spreadsheet", () => {
  const csv = toCsv(currentReleaseTable([snapshot]));
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3, "header, one record, trailing CRLF");
  assert.equal(lines[2], "");
  assert.match(lines[1], /^demo-university-test-data,'=Demo University \(TEST DATA\),Federal,/);
  assert.ok(!/(^|,)=/.test(lines[1]), "no cell starts with =");
  assert.equal(toCsv(currentReleaseTable([])).split("\r\n").length, 2, "header only when nothing is published");
});

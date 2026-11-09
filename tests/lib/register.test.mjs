// The published scoring rule: every figure on the public site comes from scoreRecord().
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { REGISTER_METHOD, expectedYear, formatPoints, isOutdated, latestYear, scoreRecord } from "../../src/lib/register.ts";
import { INDICATORS } from "../../src/lib/indicators.ts";

const all = (status) => Object.fromEntries(INDICATORS.map((d) => [d.key, { status }]));
const keys = INDICATORS.map((d) => d.key);

test("every indicator published or explicitly nil is fully disclosed", () => {
  const a = all("published");
  a[keys[0]] = { status: "nil" };
  const s = scoreRecord(a);
  assert.equal(s.label, "fully_disclosed");
  assert.equal(s.points, INDICATORS.length);
  assert.equal(s.available, INDICATORS.length);
});

test("partial counts half and gives a partial label", () => {
  const a = all("published");
  a[keys[0]] = { status: "partial" };
  a[keys[1]] = { status: "not_found" };
  const s = scoreRecord(a);
  assert.equal(s.label, "partially_disclosed");
  assert.equal(s.points, INDICATORS.length - 1.5);
  assert.equal(formatPoints(s.points), (INDICATORS.length - 1.5).toFixed(1));
});

test("not applicable is excluded from the available points", () => {
  const a = all("published");
  a[keys[0]] = { status: "not_applicable" };
  const s = scoreRecord(a);
  assert.equal(s.label, "fully_disclosed");
  assert.equal(s.available, INDICATORS.length - 1);
});

test("no overall label while anything is unassessed or inaccessible", () => {
  assert.equal(scoreRecord({}).label, "incomplete");
  const a = all("published");
  a[keys[2]] = { status: "inaccessible" };
  const s = scoreRecord(a);
  assert.equal(s.label, "incomplete");
  assert.equal(s.available, INDICATORS.length - 1);
});

test("all not found, and all not applicable, get their own labels", () => {
  assert.equal(scoreRecord(all("not_found")).label, "none_found");
  assert.equal(scoreRecord(all("not_applicable")).label, "no_applicable");
});

test("evidence for an earlier year than the indicator's period counts 0", () => {
  const a = Object.fromEntries(INDICATORS.map((d) => [d.key, { status: "published", year: "2026" }]));
  assert.equal(scoreRecord(a, 2026).label, "fully_disclosed");
  a.budget_personnel = { status: "published", year: "2025" }; // budget must be the current year
  a.grants_domestic = { status: "published", year: "2025" }; // grants may be the previous year
  a.students_undergraduate = { status: "partial", year: "2024/2025" }; // session ending in the previous year
  const s = scoreRecord(a, 2026);
  assert.equal(s.outdated, 1);
  assert.equal(s.points, INDICATORS.length - 1 - 0.5);
  assert.equal(s.label, "partially_disclosed");
  assert.equal(isOutdated("budget_personnel", { status: "published", year: "2025" }, 2026), true);
  assert.equal(isOutdated("budget_personnel", { status: "published", year: "2025" }, null), false, "no assessment year, no freshness rule");
  assert.equal(isOutdated("budget_personnel", { status: "not_found", year: "2019" }, 2026), false);
  assert.equal(latestYear("2023/2024"), 2024);
  assert.equal(latestYear("last year"), null);
  assert.equal(expectedYear("endowment_fund", 2026), 2025);
});

test("the code's scoring-rule version is the one the database records", () => {
  const sql = readdirSync(new URL("../../db/migrations/", import.meta.url)).sort()
    .map((f) => readFileSync(new URL(`../../db/migrations/${f}`, import.meta.url), "utf8")).join("\n");
  assert.ok(sql.includes(`('${REGISTER_METHOD.version}', date '${REGISTER_METHOD.effectiveOn}'`),
    "REGISTER_METHOD must match a row inserted into register_methods");
});

test("unknown statuses count as not assessed", () => {
  const a = all("published");
  a[keys[0]] = { status: "yes" };
  assert.equal(scoreRecord(a).label, "incomplete");
});

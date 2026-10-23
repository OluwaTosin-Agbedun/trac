// The published scoring rule: every figure on the public site comes from scoreRecord().
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRecord, formatPoints } from "../../src/lib/register.ts";
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

test("unknown statuses count as not assessed", () => {
  const a = all("published");
  a[keys[0]] = { status: "yes" };
  assert.equal(scoreRecord(a).label, "incomplete");
});

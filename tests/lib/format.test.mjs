// Display formatting. Run: node --test tests/lib/format.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount, groupDecimal } from "../../src/lib/format.ts";

test("amounts are shown exactly as stored, digit for digit", () => {
  assert.equal(formatAmount("4250.5", "millions", "NGN"), "₦4,250.5 million");
  assert.equal(formatAmount("4250.50", "millions", "NGN"), "₦4,250.50 million", "stored fraction digits are kept");
  assert.equal(formatAmount("1234567.1234567891", "units", "NGN"), "₦1,234,567.1234567891", "no rounding to six places");
  // Beyond the precision of a float: Number() would print 12345678901234567000.
  assert.equal(formatAmount("12345678901234567890", "units", "NGN"), "₦12,345,678,901,234,567,890");
  assert.equal(formatAmount("0.1", "billions", "USD"), "USD 0.1 billion");
  assert.equal(formatAmount("612", "millions", null), "612 million");
});

test("a published zero is zero, and unknown stays unknown", () => {
  assert.equal(formatAmount("0", "units", "NGN"), "₦0");
  assert.equal(formatAmount("0.00", "units", "NGN"), "₦0.00");
  assert.equal(formatAmount(0, "units", "NGN"), "₦0");
  assert.equal(formatAmount(null, "units", "NGN"), "Not stated");
  assert.equal(formatAmount(undefined, null, null), "Not stated");
  assert.equal(formatAmount("", "units", "NGN"), "Not stated");
});

test("negative amounts and digit grouping", () => {
  assert.equal(formatAmount("-1500.25", "thousands", "NGN"), "₦-1,500.25 thousand");
  assert.equal(groupDecimal("-0.5"), "-0.5");
  assert.equal(groupDecimal("100"), "100");
  assert.equal(groupDecimal("1000"), "1,000");
  assert.equal(groupDecimal("999999"), "999,999");
  assert.equal(groupDecimal("1000000"), "1,000,000");
  assert.equal(groupDecimal(" 007.50 "), "7.50");
});

test("numbers that already passed through a float are written out in full", () => {
  assert.equal(groupDecimal(4250.5), "4,250.5");
  assert.equal(groupDecimal(1e21), "1,000,000,000,000,000,000,000");
  assert.equal(groupDecimal(1e-7), "0.0000001");
  assert.equal(groupDecimal(Number.NaN), null);
  assert.equal(groupDecimal(Infinity), null);
});

test("anything that is not a plain decimal is shown as it is", () => {
  assert.equal(formatAmount("NaN", "units", "NGN"), "NaN");
  assert.equal(formatAmount("1e5", "units", "NGN"), "1e5");
  assert.equal(formatAmount("4,250", "units", "NGN"), "4,250");
  assert.equal(groupDecimal("12.5.1"), null);
  assert.equal(groupDecimal("+5"), null);
});

// Institution editor rules. Run: node --test tests/lib/editorRules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalDecimal,
  countsText,
  indicatorChanges,
  indicatorProblems,
  indicatorWarnings,
  isCalendarDate,
  isHttpUrl,
  lagosDate,
  parseEvidence,
  parseIndicator,
  parseLockVersion,
  parseProfile,
  profileChanges,
  summarise,
  toDateInput,
} from "../../src/lib/editorRules.ts";

const PROFILE = {
  name: "Demonstration Federal University (TEST DATA)",
  short_name: "",
  ownership: "federal",
  institution_type: "university",
  state: "Oyo",
  city: "Example Town",
  head_name: "",
  head_title: "Vice-Chancellor",
  bursar_name: "",
  website_url: "https://example.org/dfu",
  assessment_period: "FY 2025",
};

test("lock versions must be positive integers", () => {
  assert.equal(parseLockVersion("1"), 1);
  assert.equal(parseLockVersion(" 42 "), 42);
  for (const bad of ["0", "-1", "1.5", "abc", "", "99999999999", undefined, null, 3]) {
    assert.equal(parseLockVersion(bad), null, String(bad));
  }
});

test("calendar dates and URLs", () => {
  assert.ok(isCalendarDate("2024-02-29"));
  assert.ok(!isCalendarDate("2023-02-29"));
  assert.ok(!isCalendarDate("2024-13-01"));
  assert.ok(!isCalendarDate("24-01-01"));
  assert.ok(isHttpUrl("https://example.org/report.pdf"));
  assert.ok(isHttpUrl("HTTP://example.org"));
  for (const bad of ["javascript:alert(1)", "ftp://example.org", "example.org", "https://", "https://exa mple.org", `https://e.org/${"a".repeat(2000)}`]) {
    assert.ok(!isHttpUrl(bad), bad);
  }
});

test("Lagos dates for date inputs", () => {
  // 23:30 UTC on 16 Oct is 00:30 on 17 Oct in Lagos (UTC+1).
  assert.equal(lagosDate(new Date("2026-10-16T23:30:00Z")), "2026-10-17");
  assert.equal(toDateInput(new Date("2026-10-01T09:00:00Z")), "2026-10-01");
  assert.equal(toDateInput("2025-12-31"), "2025-12-31");
  assert.equal(toDateInput(null), "");
  assert.equal(toDateInput("not a date"), "");
});

test("profile: valid input becomes a payload with nulls for empty fields", () => {
  const r = parseProfile(PROFILE);
  assert.ok(r.ok);
  assert.equal(r.data.short_name, null);
  assert.equal(r.data.head_name, null);
  assert.equal(r.data.state, "Oyo");
  assert.equal(r.data.website_url, "https://example.org/dfu");
});

test("profile: name, enums, state and website are checked", () => {
  const r = parseProfile({ ...PROFILE, name: " ", ownership: "church", institution_type: "x", state: "Atlantis", website_url: "www.example.org" });
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), ["institution_type", "name", "ownership", "state", "website_url"]);
  // "Not recorded" is the empty value.
  const empty = parseProfile({ ...PROFILE, state: "" });
  assert.ok(empty.ok && empty.data.state === null);
  // A recorded value outside the list may be kept as it is, but not replaced by another.
  assert.ok(parseProfile({ ...PROFILE, state: "Otuoke" }, { currentState: "Otuoke" }).ok);
  assert.ok(!parseProfile({ ...PROFILE, state: "Elsewhere" }, { currentState: "Otuoke" }).ok);
});

test("indicator: money values keep scale and currency explicit; empty stays null", () => {
  const r = parseIndicator("money", {
    state: "published", period_type: "financial_year", period_label: "2025", period_start: "2025-01-01", period_end: "2025-12-31",
    value_amount: "4,250.50", value_scale: "millions", value_currency: "", value_literal: "₦4,250.5m", reason: "", internal_note: "check",
  });
  assert.ok(r.ok);
  assert.equal(r.data.value_amount, "4250.50");
  assert.equal(r.data.value_scale, "millions");
  assert.equal(r.data.value_currency, "NGN");
  assert.equal(r.data.value_count, null);
  assert.equal(r.data.reason, null);
  assert.equal(r.data.internal_note, "check");

  const empty = parseIndicator("money", { state: "not_assessed", value_amount: "", value_scale: "millions" });
  assert.ok(empty.ok);
  assert.equal(empty.data.value_amount, null, "an empty amount is unknown, never 0");
  assert.equal(empty.data.value_scale, null);
  assert.equal(empty.data.value_currency, null);
  assert.equal(empty.data.period_type, null);
});

test("indicator: a published zero is kept as zero", () => {
  const r = parseIndicator("money", { state: "published", value_amount: "0", value_scale: "units", value_currency: "NGN" });
  assert.ok(r.ok);
  assert.equal(r.data.value_amount, "0");
});

test("indicator: bad amounts, missing scale, bad dates and reversed periods are rejected", () => {
  const r = parseIndicator("money", { state: "published", value_amount: "4.2m", value_scale: "", period_start: "2025-02-30", period_end: "2025-01-01" });
  assert.ok(!r.ok);
  assert.ok(r.errors.value_amount);
  assert.ok(r.errors.value_scale);
  assert.ok(r.errors.period_start);
  const rev = parseIndicator("money", { state: "uncertain", period_start: "2025-12-31", period_end: "2025-01-01" });
  assert.ok(!rev.ok && rev.errors.period_end);
  const long = parseIndicator("money", { state: "published", value_amount: "1".repeat(31), value_scale: "units" });
  assert.ok(!long.ok && long.errors.value_amount);
  const cur = parseIndicator("money", { state: "published", value_amount: "1", value_scale: "units", value_currency: "naira" });
  assert.ok(!cur.ok && cur.errors.value_currency);
});

test("indicator: counts are non-negative integers", () => {
  const ok = parseIndicator("count", { state: "published", value_count: "18,450", value_amount: "99" });
  assert.ok(ok.ok);
  assert.equal(ok.data.value_count, 18450);
  assert.equal(ok.data.value_amount, null, "count indicators never carry an amount");
  for (const bad of ["-1", "12.5", "lots", "3000000000"]) {
    const r = parseIndicator("count", { state: "published", value_count: bad });
    assert.ok(!r.ok && r.errors.value_count, bad);
  }
});

test("indicator: not applicable needs a public reason; not found/not applicable carry no value", () => {
  const na = parseIndicator("count", { state: "not_applicable", reason: "" });
  assert.ok(!na.ok && na.errors.reason);
  assert.ok(parseIndicator("count", { state: "not_applicable", reason: "No postgraduate programmes." }).ok);
  const nf = parseIndicator("money", { state: "not_found", value_amount: "10", value_scale: "units" });
  assert.ok(!nf.ok && nf.errors.value_amount);
  assert.ok(!parseIndicator("money", { state: "maybe" }).ok);
  assert.ok(!parseIndicator("money", { state: "published", period_type: "calendar" }).ok);
});

test("indicator: a value on a not-assessed indicator asks for the assessment first", () => {
  const money = parseIndicator("money", { state: "not_assessed", value_amount: "10", value_scale: "units" });
  assert.ok(!money.ok);
  assert.match(money.errors.value_amount[0], /Choose the assessment first/);
  const count = parseIndicator("count", { state: "not_assessed", value_count: "120" });
  assert.ok(!count.ok && /Choose the assessment first/.test(count.errors.value_count[0]));
  // Without a value it is fine, and the value is accepted once an assessment is chosen.
  assert.ok(parseIndicator("money", { state: "not_assessed", value_amount: "" }).ok);
  assert.ok(parseIndicator("money", { state: "uncertain", value_amount: "10", value_scale: "units" }).ok);
});

test("evidence: http(s) only, capture date required and not in the future", () => {
  const base = { indicator_key: "budget_capital", url: "https://example.org/b.pdf", title: "Budget", excerpt: "", locator: "p. 4",
    document_period: "2025", source_published_on: "", captured_on: "2026-10-17", is_public: "on" };
  const r = parseEvidence(base, "2026-10-17");
  assert.ok(r.ok);
  assert.equal(r.data.captured_at, "2026-10-17T12:00:00+01:00");
  assert.equal(r.data.is_public, true);
  assert.equal(r.data.excerpt, null);
  assert.equal(r.data.source_published_on, null);

  const priv = parseEvidence({ ...base, is_public: undefined, indicator_key: "general" }, "2026-10-17");
  assert.ok(priv.ok && priv.data.is_public === false && priv.data.indicator_key === null);

  const bad = parseEvidence({ ...base, url: "javascript:alert(1)", captured_on: "2026-10-18", indicator_key: "made_up", source_published_on: "2026-02-31" }, "2026-10-17");
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["captured_on", "indicator_key", "source_published_on", "url"]);
  assert.ok(!parseEvidence({ ...base, captured_on: "" }, "2026-10-17").ok);
});

test("summary counts follow the SQL rules and never produce a score", () => {
  const all = summarise(["published", "published", "not_applicable"]);
  assert.equal(all.label, "all_applicable_published");
  assert.equal(countsText(all), "2 of 2 applicable indicators published · 2 assessed · 1 excluded");
  assert.equal(summarise(Array(9).fill("not_assessed")).label, "not_assessed");
  assert.equal(summarise(["published", "not_assessed"]).label, "assessment_incomplete");
  assert.equal(summarise(["published", "uncertain"]).label, "evidence_uncertain");
  assert.equal(summarise(["not_found", "not_found"]).label, "no_disclosures_found");
  assert.equal(summarise(["published", "not_found"]).label, "partial_disclosure");
  assert.equal(countsText({ published: 1, applicable: 1, assessed: 1, excluded: 0 }), "1 of 1 applicable indicator published · 1 assessed · 0 excluded");
});

test("summary: prior-year evidence is historical and does not satisfy a current-period finding", () => {
  const pub = (period_label) => ({ state: "published", period_label });
  const current = summarise([pub("2025"), pub("2024/2025"), "not_applicable"], "FY 2025");
  assert.equal(current.label, "all_applicable_published");
  assert.equal(current.historical, 0);
  const old = summarise([pub("2025"), pub("2023")], "FY 2025");
  assert.equal(old.label, "partial_disclosure");
  assert.equal(old.historical, 1);
  assert.equal(old.published, 2, "the published count is unchanged");
  // A later period is not historical, but it does not cover the assessment period either.
  const later = summarise([pub("2025"), pub("2026")], "FY 2025");
  assert.deepEqual([later.label, later.historical], ["partial_disclosure", 0]);
  // A period that cannot be placed, or no assessment period, is not held against the finding.
  assert.equal(summarise([pub("2025"), pub("Latest accounts")], "FY 2025").label, "all_applicable_published");
  assert.equal(summarise([pub("2019"), pub("2020")], null).label, "all_applicable_published");
  assert.equal(summarise(["published", "published"], "FY 2025").label, "all_applicable_published");
});

test("summary: every indicator excluded is neutral, not 'no disclosures found'", () => {
  const s = summarise(Array(9).fill("not_applicable"));
  assert.equal(s.label, "no_applicable_indicators");
  assert.deepEqual([s.applicable, s.excluded, s.published], [0, 9, 0]);
  assert.equal(summarise(["not_found", "not_applicable"]).label, "no_disclosures_found");
  assert.equal(summarise([]).label, "not_assessed");
});

test("requirements mirror submit_revision", () => {
  const pub = { state: "published", period_type: null, period_label: null, reason: null };
  assert.equal(indicatorProblems(pub, []).length, 3);
  const ready = { state: "published", period_type: "financial_year", period_label: "2025", reason: null };
  assert.deepEqual(indicatorProblems(ready, [{ indicator_key: "x", locator: "p. 3", excerpt: null, is_public: true }]), []);
  assert.equal(indicatorProblems(ready, [{ indicator_key: "x", locator: null, excerpt: "  ", is_public: true }]).length, 1);
  assert.equal(indicatorProblems({ state: "not_applicable", period_type: null, period_label: null, reason: " " }, []).length, 1);
  assert.deepEqual(indicatorProblems({ state: "not_found", period_type: null, period_label: null, reason: null }, []), []);
  const warn = indicatorWarnings(ready, [{ indicator_key: "x", locator: "p. 3", excerpt: null, is_public: false }]);
  assert.equal(warn.length, 1);
});

test("changes against the published release", () => {
  const base = { state: "published", period_type: "financial_year", period_label: "2025", period_start: "2025-01-01", period_end: "2025-12-31",
    value_amount: "4250.50", value_scale: "millions", value_currency: "NGN", value_count: null, value_literal: "₦4,250.5m", reason: null };
  const ev = [{ url: "https://example.org/a.pdf", title: "A", excerpt: null, locator: "p. 3" }];
  assert.deepEqual(indicatorChanges(base, ev, { ...base, value_amount: 4250.5 }, ev), []);
  assert.deepEqual(indicatorChanges(base, ev, null, []), []);
  assert.deepEqual(indicatorChanges({ ...base, value_amount: "0" }, ev, { ...base, value_amount: null }, ev), ["value"]);
  assert.deepEqual(indicatorChanges({ ...base, state: "uncertain", reason: "Table unclear" }, [], base, ev), ["assessment", "reason", "public evidence"]);
  assert.deepEqual(indicatorChanges({ ...base, period_label: "2024/2025" }, ev, base, ev), ["period"]);
  assert.equal(canonicalDecimal("007.500"), "7.5");
  assert.equal(canonicalDecimal("-0.0"), "0");
  assert.equal(canonicalDecimal(null), null);
  assert.deepEqual(profileChanges({ name: "A", city: "" }, { name: "A ", city: null }), []);
  assert.deepEqual(profileChanges({ name: "B", bursar_name: "X" }, { name: "A" }), ["name", "bursar_name"]);
  assert.deepEqual(profileChanges({ name: "B" }, null), []);
});

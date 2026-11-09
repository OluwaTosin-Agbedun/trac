// Reading the register forms: every value is checked and capped, and a refused form gives back all
// that was typed. Run with: node --conditions=react-server --test tests/server/reportForms.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entryValues, isDate, parseAssign, parseDates, parseEntry, parseReason, parseVisibility,
} from "../../src/app/admin/(app)/report/_lib/forms.ts";
import { INDICATORS } from "../../src/lib/indicators.ts";

const form = (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

const full = () => ({
  section: "federal_university", name: "  Federal University Example ", state: "Lagos", head_name: "Prof. A", bursar_name: "Mr B",
  people_source_url: "https://fue.edu.ng/management", homepage_url: "https://fue.edu.ng/", disclosure_url: "https://fue.edu.ng/disclosure",
  checked_all: "2026-11-01", extra_label_0: "2026 budget", extra_url_0: "https://fue.edu.ng/budget.pdf", extra_label_1: "", extra_url_1: "",
  ...Object.fromEntries(INDICATORS.flatMap((d, i) => [
    [`st_${d.key}`, i === 0 ? "partial" : "published"], [`yr_${d.key}`, "2026"], [`ev_${d.key}`, i === 1 ? "https://fue.edu.ng/b.pdf" : ""],
    [`ck_${d.key}`, i === 2 ? "2026-11-03" : ""], [`nt_${d.key}`, i === 0 ? "Personnel only in part" : ""],
  ])),
});

test("a complete record becomes the payload for save_report_entry", () => {
  const { value, error } = parseEntry(form(full()));
  assert.equal(error, undefined);
  assert.equal(value.name, "Federal University Example");
  assert.equal(value.people_source_url, "https://fue.edu.ng/management");
  assert.deepEqual(value.extra_links, [{ label: "2026 budget", url: "https://fue.edu.ng/budget.pdf" }]);
  assert.deepEqual(Object.keys(value.assessments), INDICATORS.map((d) => d.key));
  const [a0, a1, a2] = INDICATORS.map((d) => value.assessments[d.key]);
  assert.deepEqual(a0, { status: "partial", year: "2026", evidence_url: null, checked_on: "2026-11-01", note: "Personnel only in part" });
  assert.equal(a1.evidence_url, "https://fue.edu.ng/b.pdf");
  assert.equal(a2.checked_on, "2026-11-03", "an indicator's own date wins over the shared date");
  // A missing status is "not yet assessed" and takes no shared date.
  const f = full();
  delete f[`st_${INDICATORS[3].key}`];
  assert.deepEqual(parseEntry(form(f)).value.assessments[INDICATORS[3].key].status, "not_assessed");
  assert.equal(parseEntry(form(f)).value.assessments[INDICATORS[3].key].checked_on, null);
});

test("a refused record gives back every typed value, all nine indicators included", () => {
  const f = { ...full(), homepage_url: "fue.edu.ng" };
  const r = parseEntry(form(f));
  assert.match(r.error, /homepage as a full address/);
  for (const d of INDICATORS) {
    for (const p of ["st", "yr", "ev", "ck", "nt"]) assert.equal(r.values[`${p}_${d.key}`], String(f[`${p}_${d.key}`] ?? "").trim(), `${p}_${d.key} kept`);
  }
  for (const k of ["people_source_url", "extra_label_0", "extra_url_0", "checked_all", "homepage_url", "state", "head_name", "bursar_name"]) {
    assert.equal(r.values[k], f[k].trim(), `${k} kept`);
  }
  // entryValues alone (the expired-session path) reads the same fields.
  assert.deepEqual(entryValues(form(f)), r.values);
});

test("each field is checked and length-limited", () => {
  const bad = (change, re) => assert.match(parseEntry(form({ ...full(), ...change })).error ?? "", re);
  bad({ section: "private_university" }, /category/);
  bad({ name: " " }, /name/);
  bad({ name: "x".repeat(301) }, /Shorten the name/);
  bad({ people_source_url: "javascript:alert(1)" }, /source for the head and bursar/);
  bad({ disclosure_url: `https://fue.edu.ng/${"a".repeat(500)}` }, /disclosure page/);
  bad({ checked_all: "2026-02-30" }, /valid date/);
  bad({ extra_url_1: "ftp://x" }, /Extra document 2/);
  bad({ extra_label_1: "Orphan title" }, /address of extra document 2/);
  bad({ [`st_${INDICATORS[0].key}`]: "verified" }, /valid status for Personnel costs/);
  bad({ [`yr_${INDICATORS[0].key}`]: "2".repeat(21) }, /reporting year/);
  bad({ [`ev_${INDICATORS[4].key}`]: "www.example.org" }, /evidence link for International sources/);
  bad({ [`ck_${INDICATORS[5].key}`]: "01/11/2026" }, /checked date for TETFund allocation/);
  bad({ [`nt_${INDICATORS[6].key}`]: "n".repeat(301) }, /note for Endowment fund/);
  // Over-long text is refused, never silently cut.
  assert.equal(parseEntry(form({ ...full(), name: "y".repeat(5000) })).values.name.length, 301);
  assert.equal(isDate("2024-02-29"), true);
  assert.equal(isDate("2026-13-01"), false);
});

test("reasons need a minimum length and are capped", () => {
  assert.match(parseReason(form({ reason: "bad" }), 5, 900, "for withdrawing").error, /at least 5 characters/);
  assert.match(parseReason(form({ reason: "r".repeat(901) }), 5, 900, "for withdrawing").error, /900 characters at most/);
  assert.equal(parseReason(form({ reason: "r".repeat(901) }), 5, 900, "x").values.reason.length, 900);
  assert.deepEqual(parseReason(form({ reason: "  Wrong budget year  " }), 5, 900, "x").value, "Wrong budget year");
});

test("assignments take the ticked rows or the listed ones, with valid ids only", () => {
  const ok = parseAssign(form({ scope: "selected", ids: [ID1, ID2, ID1.toUpperCase()], editor: ID1, reviewer: ID2, due_on: "2026-12-01", shown: [ID2] }));
  assert.deepEqual(ok.value, { ids: [ID1, ID2], editor: ID1, reviewer: ID2, dueOn: "2026-12-01" });
  assert.deepEqual(parseAssign(form({ scope: "shown", shown: [ID2], ids: [ID1] })).value, { ids: [ID2], editor: null, reviewer: null, dueOn: null });
  assert.match(parseAssign(form({ scope: "selected", shown: [ID1] })).error, /Tick at least one record/);
  assert.match(parseAssign(form({ scope: "everything", ids: [ID1] })).error, /Choose which records/);
  assert.match(parseAssign(form({ ids: [ID1, "1 or 1=1"] })).error, /could not be found/);
  assert.match(parseAssign(form({ ids: Array.from({ length: 501 }, () => ID1) })).error, /at most 500/);
  assert.match(parseAssign(form({ ids: [ID1], editor: "admin" })).error, /Choose the editor/);
  const same = parseAssign(form({ ids: [ID1], editor: ID1, reviewer: ID1, due_on: "2026-12-01" }));
  assert.match(same.error, /different people/);
  assert.deepEqual(same.values, { scope: "selected", editor: ID1, reviewer: ID1, due_on: "2026-12-01" }, "choices come back after a refusal");
  assert.match(parseAssign(form({ ids: [ID1], due_on: "tomorrow" })).error, /due date/);
});

test("settings: dates in range, and visibility only with a reason and a ticked confirmation", () => {
  assert.deepEqual(parseDates(form({ reported_as_of: "2026-11-01", assessment_year: "2026", recheck_days: "180" }), 2026).value,
    { reportedAsOf: "2026-11-01", assessmentYear: 2026, recheckDays: 180 });
  assert.deepEqual(parseDates(form({ reported_as_of: "", assessment_year: "", recheck_days: "90" }), 2026).value,
    { reportedAsOf: null, assessmentYear: null, recheckDays: 90 });
  assert.match(parseDates(form({ assessment_year: "2028", recheck_days: "180" }), 2026).error, /between 2000 and 2027/);
  assert.match(parseDates(form({ assessment_year: "26", recheck_days: "180" }), 2026).error, /four digits/);
  assert.match(parseDates(form({ recheck_days: "10" }), 2026).error, /between 30 and 1,095/);
  assert.match(parseDates(form({ recheck_days: "" }), 2026).error, /number of days/);
  assert.deepEqual(parseDates(form({ reported_as_of: "2026-02-30", assessment_year: "2026", recheck_days: "180" }), 2026).values,
    { reported_as_of: "2026-02-30", assessment_year: "2026", recheck_days: "180" });

  assert.deepEqual(parseVisibility(form({ visible: "no", reason: "Correcting a published error", confirm: "yes" })).value,
    { visible: false, reason: "Correcting a published error" });
  assert.match(parseVisibility(form({ visible: "no", reason: "Correcting a published error" })).error, /Tick the box/);
  assert.match(parseVisibility(form({ visible: "yes", reason: "ok", confirm: "yes" })).error, /reason for showing/);
  assert.match(parseVisibility(form({ visible: "maybe", reason: "Correcting a published error", confirm: "yes" })).error, /Reload/);
  assert.equal(parseVisibility(form({ visible: "no", reason: "Correcting a published error" })).values.reason, "Correcting a published error");
});

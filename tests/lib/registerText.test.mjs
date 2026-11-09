// Plain words on the register screen: import hold reasons, expected periods, side-by-side changes and
// the history of a record. Run: node --test tests/lib/registerText.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessmentText, buildHistory, describeEvent, describeLinkRun, describeVersion, diffContent, expectedPeriodText, importFlagText,
  indicatorLabel, isOverdue, outdatedText,
} from "../../src/app/admin/(app)/report/_lib/registerText.ts";
import { INDICATORS } from "../../src/lib/indicators.ts";

const names = new Map([["00000000-0000-0000-0000-00000000000e", "Ada Editor"], ["00000000-0000-0000-0000-00000000000b", "Bola Reviewer"]]);
const nameOf = (id) => names.get(id) ?? null;

test("the importer's hold reasons read as plain sentences, unknown codes included", () => {
  assert.equal(importFlagText("potential_duplicate"), "Possible duplicate of another row - check before verifying");
  assert.equal(importFlagText("website_not_url"), "The spreadsheet's website was not a usable address");
  assert.match(importFlagText("state_conflict"), /^The state in the spreadsheet contradicted the name/);
  for (const code of ["missing_name", "website_share_link", "website_third_party", "website_merged_status"]) {
    assert.doesNotMatch(importFlagText(code), /_/, `${code} has a plain-word explanation`);
  }
  assert.match(importFlagText("brand_new_code"), /brand new code/);
  assert.doesNotMatch(importFlagText("<script>"), /[<>]/);
});

test("each indicator shows the period it should cover for the assessment year", () => {
  assert.equal(expectedPeriodText("budget_personnel", 2026), "For 2026: this year's budget (2026 or later)");
  assert.equal(expectedPeriodText("tetfund_allocation", 2026), "For 2026: this year's allocation (2026 or later)");
  assert.equal(expectedPeriodText("grants_domestic", 2026), "For 2026: last year's grants (2025 or later)");
  assert.equal(expectedPeriodText("students_postgraduate", 2026), "For 2026: last session's student numbers (2024/2025 or later)");
  for (const d of INDICATORS) assert.ok(expectedPeriodText(d.key, 2026), `${d.key} has a period`);
  assert.equal(expectedPeriodText("budget_personnel", null), null, "no assessment year: nothing to show");
  assert.equal(expectedPeriodText("unknown_key", 2026), null);
  assert.match(outdatedText("budget_capital", 2026), /earlier than 2026, so it counts 0 points/);
  assert.match(outdatedText("students_undergraduate", 2026), /earlier than 2024\/2025/);
  assert.equal(outdatedText("budget_capital", null), null);
});

test("a due date is overdue only once passed and only while the record is not verified", () => {
  const today = "2026-11-09";
  assert.equal(isOverdue({ dueOn: "2026-11-08", state_: "awaiting" }, today), true);
  assert.equal(isOverdue({ dueOn: "2026-11-09", state_: "awaiting" }, today), false, "due today is not overdue");
  assert.equal(isOverdue({ dueOn: "2026-11-01", state_: "verified" }, today), false);
  assert.equal(isOverdue({ dueOn: "2026-11-01", state_: "not_started", archivedAt: "2026-11-02T00:00:00Z" }, today), false);
  assert.equal(isOverdue({ dueOn: null, state_: "returned" }, today), false);
});

const verified = {
  name: "Federal University Example", section: "federal_university", state: "Lagos", head_name: "Prof. A", bursar_name: null,
  people_source_url: null, homepage_url: "https://fue.edu.ng/", disclosure_url: "https://fue.edu.ng/disclosure",
  extra_links: [{ label: "Budget", url: "https://fue.edu.ng/budget.pdf" }],
  assessments: { budget_personnel: { status: "published", year: "2026", evidence_url: null, checked_on: "2026-11-01", note: null } },
};

test("changes list each field with the verified and the working value side by side", () => {
  assert.deepEqual(diffContent(verified, structuredClone(verified)), []);
  // Blank, null and missing are the same; a missing indicator is "not yet assessed".
  assert.deepEqual(diffContent({ ...verified, bursar_name: "" }, { ...verified, bursar_name: null }), []);
  assert.deepEqual(diffContent({ assessments: {} }, { assessments: { budget_overhead: { status: "not_assessed", year: "" } } }), []);

  const working = structuredClone(verified);
  working.section = "federal_polytechnic";
  working.people_source_url = "https://fue.edu.ng/management";
  working.extra_links = [];
  working.assessments.budget_personnel = { status: "partial", year: "2025", evidence_url: "https://fue.edu.ng/b.pdf", checked_on: "2026-11-05", note: "Part only" };
  const changes = diffContent(verified, working);
  assert.deepEqual(changes.map((c) => c.key), ["section", "people_source_url", "extra_links", "budget_personnel"]);
  const byKey = Object.fromEntries(changes.map((c) => [c.key, c]));
  assert.deepEqual([byKey.section.before, byKey.section.after], ["Federal universities", "Federal polytechnics"]);
  assert.deepEqual([byKey.people_source_url.label, byKey.people_source_url.before], ["Source for the head and bursar", "Not recorded"]);
  assert.deepEqual([byKey.extra_links.before, byKey.extra_links.after], ["Budget: https://fue.edu.ng/budget.pdf", "None"]);
  assert.equal(byKey.budget_personnel.label, "Budget: Personnel costs");
  assert.equal(byKey.budget_personnel.before, "Published · 2026 · checked 1 Nov 2026");
  assert.equal(byKey.budget_personnel.after, "Partially published · 2025 · checked 5 Nov 2026 · https://fue.edu.ng/b.pdf · “Part only”");
});

test("indicator labels carry their group only when the label alone is unclear", () => {
  assert.equal(indicatorLabel("grants_international"), "Grants: International sources");
  assert.equal(indicatorLabel("tetfund_allocation"), "TETFund allocation");
  assert.equal(indicatorLabel("endowment_fund"), "Endowment fund");
  assert.equal(assessmentText(undefined), "Not yet assessed");
});

test("history events read as plain words, with what changed and why", () => {
  const at = "2026-11-08T10:00:00.000Z";
  const ev = (action, details = {}, actorName = "Chi Admin") => describeEvent({ at, action, actorName, details }, nameOf);
  assert.equal(ev("report.entry_added", { name: "FUE" }).title, "Added to the register");
  const saved = ev("report.entry_updated", { before: verified, after: { ...verified, homepage_url: "https://www.fue.edu.ng/" } });
  assert.equal(saved.title, "Saved 1 change");
  assert.deepEqual(saved.details, ["Homepage: https://fue.edu.ng/ → https://www.fue.edu.ng/"]);
  assert.equal(ev("report.entry_updated", { before: verified, after: verified }).title, "Saved without visible changes");
  const returned = ev("report.entry_returned", { note: "The evidence is the homepage." });
  assert.deepEqual([returned.title, returned.details, returned.tone], ["Returned for fixes", ["Note: The evidence is the homepage."], "danger"]);
  assert.deepEqual(ev("report.entry_verified", { hash: "x", method: "2026.1", assessment_year: 2026 }).details,
    ["Checked under scoring rule 2026.1, for the 2026 assessment year."]);
  assert.deepEqual(ev("report.entry_verified", { hash: "x" }).details, [], "older verifications had no rule version");
  assert.deepEqual(ev("report.verification_withdrawn", { reason: "Wrong budget year" }).details, ["Reason: Wrong budget year"]);
  assert.deepEqual(ev("report.entry_archived", { reason: "Duplicate record" }).details, ["Reason: Duplicate record"]);
  assert.equal(ev("report.entry_restored").title, "Restored to the register");
  assert.deepEqual(ev("report.entry_assigned", { editor_id: "00000000-0000-0000-0000-00000000000e", reviewer_id: null, due_on: "2026-12-01" }).details,
    ["Editor: Ada Editor.", "Reviewer: nobody.", "Due 1 Dec 2026."]);
  assert.deepEqual(ev("report.entry_assigned", { editor_id: "00000000-0000-0000-0000-0000000000ff", reviewer_id: null, due_on: null }).details,
    ["Editor: a former team member.", "Reviewer: nobody.", "No due date."]);
  assert.equal(ev("report.something_new").title, "Something new");
  assert.equal(ev("report.entry_added", {}, null).who, "The system");
  // Many changes are summarised.
  const many = structuredClone(verified);
  for (const d of INDICATORS) many.assessments[d.key] = { status: "not_found", checked_on: "2026-11-02" };
  const big = ev("report.entry_updated", { before: verified, after: many });
  assert.equal(big.title, `Saved ${INDICATORS.length} changes`);
  assert.equal(big.details.length, 7);
  assert.match(big.details[6], /^and 3 more changes\.$/);
});

test("link-check runs and earlier versions join the history, newest first", () => {
  const run = describeLinkRun({ at: "2026-11-07T09:00:00.000Z", checkedByName: null, scheduled: true, total: 5, problems: 2 });
  assert.deepEqual([run.who, run.title, run.details[0], run.tone], ["The scheduled check", "Checked 5 links", "2 links needed attention.", "warn"]);
  assert.equal(describeLinkRun({ at: "2026-11-07T09:00:00.000Z", checkedByName: "Ada", scheduled: false, total: 1, problems: 0 }).title, "Checked 1 link");
  const lines = buildHistory(
    [{ at: "2026-11-06T09:00:00.000Z", action: "report.entry_added", actorName: "Ada", details: {} },
      { at: "2026-11-08T09:00:00.000Z", action: "report.entry_restored", actorName: "Chi", details: {} }],
    [{ at: "2026-11-07T09:00:00.000Z", checkedByName: "Ada", scheduled: false, total: 3, problems: 0 }], nameOf);
  assert.deepEqual(lines.map((l) => l.title), ["Restored to the register", "Checked 3 links", "Added to the register"]);

  const base = { verifiedAt: "2026-10-01T09:00:00.000Z", verifiedByName: "Bola", verifiedMethod: "2026.1", assessmentYear: 2026,
    supersededAt: "2026-11-01T09:00:00.000Z", supersededByName: "Chi" };
  const replaced = describeVersion({ ...base, reason: "replaced by a newer verification" });
  assert.equal(replaced.title, "Replaced by a newer verification");
  assert.equal(replaced.details.length, 2);
  assert.match(replaced.details[0], /^This version was verified 1 Oct 2026, .* by Bola\.$/);
  const withdrawn = describeVersion({ ...base, verifiedMethod: null, assessmentYear: null, reason: "Evidence was for 2023" });
  assert.equal(withdrawn.title, "Verification withdrawn");
  assert.deepEqual(withdrawn.details.slice(1), ["Reason: Evidence was for 2023"]);
});

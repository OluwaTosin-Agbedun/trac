// Parser checks against the real 10 October 2026 export (Phase 2 completion check, parser half).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTrackerTsv, summarise, splitTsv, analyseWebsite, isHeld } from "../../src/lib/import/trackerTsv.ts";

const text = readFileSync(new URL("../../data/source/tracker-export-2026-10-10.tsv", import.meta.url), "utf8");
const result = parseTrackerTsv(text);
const s = summarise(result);
const find = (section, re) => result.rows.filter((r) => r.section === section && re.test(r.mapped.name ?? ""));

test("accounts for 399 candidate rows by category and ignores the template row", () => {
  assert.equal(s.candidates, 399);
  assert.deepEqual(result.totals, {
    federal_university: 63, federal_polytechnic: 41, federal_monotechnic: 90,
    state_university: 63, state_polytechnic: 52, state_monotechnic: 90,
  });
  assert.equal(s.ignoredTemplate, 1);
  assert.equal(result.reportedAsOf, "2026-10-10");
});

test("keeps #REF! serials as provenance and finds the four unnamed rows", () => {
  assert.equal(s.refSerials, 45);
  const unnamed = result.rows.filter((r) => !r.mapped.name);
  assert.equal(unnamed.length, 4);
  assert.ok(unnamed.every(isHeld));
  assert.deepEqual(unnamed.map((r) => r.mapped.stateRaw), ["Edo", "Nasarawa", "kebbi", "Nguru"]);
});

test("preserves the six blank indicator cells in their own column", () => {
  assert.equal(s.blankIndicatorCells, 6);
  const blanks = result.rows.flatMap((r) =>
    Object.entries(r.legacyIndicators).filter(([, v]) => v === null).map(([k]) => `${r.mapped.name}:${k}`));
  assert.deepEqual(blanks.sort(), [
    "Federal Training Centre, Maiduguri:budget_personnel",
    "Gombe State Univeristy:students_undergraduate",
    "Lagos State University of Education:students_undergraduate",
    "Niger State Polytechnic, Zungeru:budget_personnel",
    "Tai Solarin University of Education:endowment_fund",
    "Yobe State University:endowment_fund",
  ]);
  // Neighbouring answers did not shift left.
  const ftc = find("federal_monotechnic", /Federal Training Centre, Maiduguri/)[0];
  assert.equal(ftc.legacyIndicators.budget_overhead, false);
  assert.equal(ftc.legacyIndicators.students_postgraduate, false);
});

test("federal monotechnics take the name from the state column and have no state", () => {
  const r = find("federal_monotechnic", /^ABUTH, Zaria College of Nursing Sciences$/)[0];
  assert.equal(r.mapped.stateRaw, null);
  assert.equal(r.mapped.head, "Dr. Alkali");
  assert.equal(r.mapped.institutionType, "monotechnic");
});

test("flags AFIT as a potential duplicate without merging it", () => {
  const afit = result.rows.filter((r) => /Air Force Institute of Technology/.test(r.mapped.name ?? ""));
  assert.equal(afit.length, 2);
  for (const r of afit) assert.ok(r.issues.some((i) => i.code === "potential_duplicate" && i.holds));
});

test("a shared domain alone is not treated as a duplicate", () => {
  const abuth = result.rows.filter((r) => /ABUTH/.test(r.mapped.name ?? "") && r.mapped.websiteCandidates[0] === "https://abuth.gov.ng/");
  assert.ok(abuth.length >= 2);
  assert.ok(abuth.every((r) => r.issues.some((i) => i.code === "shared_domain" && !i.holds)));
});

test("flags state conflicts such as Otuoke without correcting them", () => {
  const otuoke = find("federal_university", /Otuoke/)[0];
  assert.equal(otuoke.mapped.stateRaw, "Anambra");
  assert.ok(otuoke.issues.some((i) => i.code === "state_conflict" && /Bayelsa/.test(i.detail)));
  // "Niger Delta University" is in Bayelsa; "Niger Delta" must not read as Niger State.
  assert.ok(!find("state_university", /Niger Delta University/)[0].issues.some((i) => i.code === "state_conflict"));
});

test("keeps legacy report status verbatim and separate from indicators", () => {
  const rsu = find("state_university", /^Rivers State University$/)[0];
  assert.equal(rsu.mapped.legacyStatus, "no");
  assert.ok(rsu.issues.some((i) => i.code === "website_merged_status"));
  assert.match(rsu.mapped.websiteRaw, /NO$/); // original preserved
  const fcc = find("federal_monotechnic", /Federal Cooperative College, Ibadan/)[0];
  assert.equal(fcc.mapped.legacyStatus, "under_maintenance");
  assert.equal(fcc.mapped.legacyStatusRaw, "Page under maintainance");
  // YES does not imply all nine indicators.
  const unn = find("federal_university", /University of Nigeria, Nsukka/)[0];
  assert.equal(unn.mapped.legacyStatus, "yes");
  assert.equal(unn.legacyIndicators.budget_personnel, false);
});

test("handles quoted multi-line cells and website repairs as proposals", () => {
  const unimaid = find("federal_university", /University of Maiduguri/)[0];
  assert.match(unimaid.mapped.websiteRaw, /\n/);
  assert.deepEqual(unimaid.mapped.websiteCandidates, [
    "https://www.unimaid.edu.ng/tetfund-record#", "https://www.unimaid.edu.ng/budget-plan"]);
  assert.match(find("federal_university", /Police Academy/)[0].mapped.head, /The Commandant/);
  assert.deepEqual(analyseWebsite("dsustportal.ng").candidates, ["https://dsustportal.ng"]);
  assert.ok(analyseWebsite("https://share.google/abc").issues.some((i) => i.code === "website_share_link" && i.holds));
  assert.ok(analyseWebsite("Key Institutional Data | NOUN").issues.some((i) => i.code === "website_not_url"));
  assert.deepEqual(analyseWebsite("[www.x.edu.ng](https://www.x.edu.ng)").candidates, ["https://www.x.edu.ng"]);
});

test("only an address written as exactly one valid URL is confirmed for a draft; repairs stay proposals", () => {
  const byName = (re) => result.rows.find((r) => re.test(r.mapped.name ?? ""));
  assert.equal(byName(/University of Nigeria, Nsukka/).mapped.websiteConfirmed, true);
  // Missing protocol: https:// is proposed, not confirmed, and the row is still not held.
  const forestry = byName(/Federal College of Forestry Resources Management, Maiduguri/);
  assert.equal(forestry.mapped.websiteRaw, "fcfrmmaiduguri.com.ng/contact/");
  assert.deepEqual(forestry.mapped.websiteCandidates, ["https://fcfrmmaiduguri.com.ng/contact/"]);
  assert.equal(forestry.mapped.websiteConfirmed, false);
  assert.ok(!isHeld(forestry));
  // Several URLs in one cell, a Markdown link, and a domain shared with other rows.
  assert.equal(byName(/University of Maiduguri/).mapped.websiteConfirmed, false);
  assert.equal(byName(/Abdu Gusau Polytechnic/).mapped.websiteConfirmed, false);
  const shared = result.rows.filter((r) => r.issues.some((i) => i.code === "shared_domain"));
  assert.equal(shared.length, 71);
  assert.ok(shared.every((r) => !r.mapped.websiteConfirmed && !r.issues.find((i) => i.code === "shared_domain").holds));
  // Holds and totals are unchanged; 240 of the 329 unheld rows carry an address confirmed as written.
  assert.equal(s.held, 70);
  assert.equal(s.ready, 329);
  assert.equal(result.rows.filter((r) => !isHeld(r) && r.mapped.websiteConfirmed).length, 240);
  assert.equal(s.websiteToConfirm, 122);
  assert.equal(analyseWebsite("www.x.edu.ng").issues[0].holds, false);
});

test("a location cell naming a town gives no state and does not hold the row", () => {
  const lautech = find("state_university", /Ladoke Akintola University of Technology/)[0];
  assert.equal(lautech.mapped.stateRaw, "Ogbomoso");
  assert.equal(lautech.mapped.stateCanonical, null);
  assert.ok(lautech.issues.some((i) => i.code === "location_not_state" && !i.holds));
  assert.ok(!isHeld(lautech));
});

test("splitTsv honours doubled quotes inside quoted cells", () => {
  const rows = splitTsv('a\t"say ""hi""\nthere"\tc\nd\te\tf\n');
  assert.deepEqual(rows.map((r) => r.cells), [["a", 'say "hi"\nthere', "c"], ["d", "e", "f"]]);
  assert.deepEqual(rows.map((r) => r.line), [1, 3]);
});

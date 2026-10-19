// Test-only fixture data. The application never loads this file: the site and CMS start empty and
// the team uploads the real tracker through the Import centre. Tests use it to prove privacy rules
// against a realistic database.
//
// Two kinds of data, kept clearly apart:
//   1. The real 10 Oct 2026 tracker export, staged and committed through the import functions.
//      That produces private drafts and held rows for the CMS only. Nothing is published.
//   2. Fictional "(TEST DATA)" institutions with example.org evidence, pushed through the real
//      draft → submit → approve → publish functions so the public site has something to show.
//      None of it describes a real institution.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTrackerTsv, summarise } from "../../src/lib/import/trackerTsv.ts";
import { runAs, type Actor, type Driver } from "../../src/server/db/core.ts";

export const FIXTURE_USERS = {
  admin: { id: "00000000-0000-4000-8000-0000000000a1", name: "Fixture Admin", email: "fixture.admin@example.org", role: "admin" },
  reviewer: { id: "00000000-0000-4000-8000-0000000000b1", name: "Fixture Reviewer", email: "fixture.reviewer@example.org", role: "reviewer" },
  editor: { id: "00000000-0000-4000-8000-0000000000e1", name: "Fixture Editor", email: "fixture.editor@example.org", role: "editor" },
  editor2: { id: "00000000-0000-4000-8000-0000000000e2", name: "Fixture Editor Two", email: "fixture.editor2@example.org", role: "editor" },
} as const;

type Key = keyof typeof FIXTURE_USERS;
const actor = (k: Key): Actor => ({ kind: "user", userId: FIXTURE_USERS[k].id });

type Ind = {
  state: "published" | "not_found" | "uncertain" | "not_assessed" | "not_applicable";
  period?: { type: "financial_year" | "academic_session" | "multi_year" | "unknown"; label: string; start?: string; end?: string };
  amount?: string; scale?: "units" | "thousands" | "millions" | "billions"; literal?: string; count?: number;
  reason?: string; note?: string;
  evidence?: { title: string; locator: string; excerpt: string; period?: string; path: string };
};

const FY = (y: number) => ({ type: "financial_year" as const, label: String(y), start: `${y}-01-01`, end: `${y}-12-31` });
const SESSION = (a: number) => ({ type: "academic_session" as const, label: `${a}/${a + 1}`, start: `${a}-09-01`, end: `${a + 1}-08-31` });
const ev = (slug: string, title: string, locator: string, period: string) => ({
  title: `[TEST DATA] ${title}`,
  locator,
  excerpt: "Fixture excerpt for local testing. This text is not taken from any real document.",
  period,
  path: `https://example.org/fixtures/${slug}`,
});
const NF = (reason = "Not found in the homepage, bursary pages and documents listed for this review (fixture).") =>
  ({ state: "not_found", reason }) as Ind;

async function q(driver: Driver, who: Key, sql: string, params: unknown[] = []) {
  return runAs(driver, actor(who), (tx) => tx.query(sql, params));
}
async function one<T = unknown>(driver: Driver, who: Key, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await q(driver, who, sql, params);
  return Object.values(rows[0] ?? {})[0] as T;
}
const lockOf = (d: Driver, rev: string) => one<number>(d, "admin", "select lock_version from revisions where id = $1", [rev]);

async function fillRevision(d: Driver, who: Key, rev: string, profile: Record<string, unknown>, inds: Partial<Record<string, Ind>>) {
  await one(d, who, "select save_profile($1, $2, $3)", [rev, await lockOf(d, rev), JSON.stringify(profile)]);
  for (const [key, ind] of Object.entries(inds)) {
    if (!ind) continue;
    // A reassessed indicator starts from fresh evidence; copied links from the last release go.
    const old = await q(d, who, "select id from evidence_links where revision_id = $1 and indicator_key = $2", [rev, key]);
    for (const e of old) {
      await one(d, who, "select remove_evidence($1, $2, $3)", [rev, await lockOf(d, rev), e.id]);
    }
    const payload: Record<string, unknown> = { state: ind.state };
    if (ind.period) {
      Object.assign(payload, { period_type: ind.period.type, period_label: ind.period.label,
        period_start: ind.period.start ?? null, period_end: ind.period.end ?? null });
    }
    if (ind.amount !== undefined) Object.assign(payload, { value_amount: ind.amount, value_scale: ind.scale, value_currency: "NGN" });
    if (ind.literal !== undefined) payload.value_literal = ind.literal;
    if (ind.count !== undefined) payload.value_count = ind.count;
    if (ind.reason !== undefined) payload.reason = ind.reason;
    if (ind.note !== undefined) payload.internal_note = ind.note;
    await one(d, who, "select save_indicator($1, $2, $3, $4)", [rev, await lockOf(d, rev), key, JSON.stringify(payload)]);
    if (ind.evidence) {
      await one(d, who, "select add_evidence($1, $2, $3)", [rev, await lockOf(d, rev), JSON.stringify({
        indicator_key: key, url: ind.evidence.path, title: ind.evidence.title, excerpt: ind.evidence.excerpt,
        locator: ind.evidence.locator, document_period: ind.evidence.period, captured_at: "2026-10-01T09:00:00Z",
      })]);
    }
  }
}

async function submitApprovePublish(d: Driver, rev: string, submitter: Key = "editor") {
  await one(d, submitter, "select submit_revision($1, $2)", [rev, await lockOf(d, rev)]);
  await one(d, "reviewer", "select review_revision($1, 'approved', 'Fixture review: evidence checked against example.org placeholders.')", [rev]);
  await one(d, "reviewer", "select publish_revision($1)", [rev]);
}

const BUDGET = (y: number, slug: string): Partial<Record<string, Ind>> => ({
  budget_personnel: { state: "published", period: FY(y), amount: "4250.5", scale: "millions", literal: "₦4,250.5m",
    evidence: ev(`${slug}/budget-${y}.pdf`, `Approved budget ${y}`, "p. 3, table 1", String(y)) },
  budget_overhead: { state: "published", period: FY(y), amount: "612", scale: "millions", literal: "₦612m",
    evidence: ev(`${slug}/budget-${y}.pdf`, `Approved budget ${y}`, "p. 3, table 1", String(y)) },
  budget_capital: { state: "published", period: FY(y), amount: "1.2", scale: "billions", literal: "₦1.2bn",
    evidence: ev(`${slug}/budget-${y}.pdf`, `Approved budget ${y}`, "p. 4, table 2", String(y)) },
});

export async function seedLocalFixtures(driver: Driver, projectRoot: string): Promise<void> {
  const seeded = await driver.transaction((tx) => tx.query("select 1 from app_settings where key = 'fixtures_seeded'"));
  if (seeded.length) return;

  // Accounts. Fixture users have no password: they can only be used through the local-only
  // fixture sign-in, which the server refuses outside local fixture mode.
  await driver.transaction(async (tx) => {
    for (const u of Object.values(FIXTURE_USERS)) {
      await tx.query("insert into app_users (id, email, display_name, is_fixture) values ($1, $2, $3, true)", [u.id, u.email, u.name]);
      await tx.query("insert into team_memberships (user_id, role, display_name) values ($1, $2, $3)", [u.id, u.role, u.name]);
    }
    await tx.query("insert into app_settings (key, value) values ('setup_completed', $1)",
      [JSON.stringify({ by: "local-fixtures", note: "Local fixture data only" })]);
  });

  // 1. The real export, staged and committed as private drafts.
  const file = join(projectRoot, "data", "source", "tracker-export-2026-10-10.tsv");
  const text = readFileSync(file, "utf8");
  const parsed = parseTrackerTsv(text);
  const importId = await one<string>(driver, "admin", "select stage_import($1, $2, $3, $4, $5, $6)", [
    "tracker-export-2026-10-10.tsv", text, parsed.reportedAsOf, "trackerTsv@1",
    JSON.stringify({ ...summarise(parsed), ignored: parsed.ignored }), JSON.stringify(parsed.rows),
  ]);
  await one(driver, "admin", "select commit_import($1)", [importId]);

  // 2. Fictional institutions, published through the real workflow.
  // A: two releases, then a private draft that must never leak.
  const aSlug = "demonstration-federal-university-test-data";
  let rev = await one<string>(driver, "editor", "select create_institution($1, $2, 'federal', 'university')",
    [aSlug, "Demonstration Federal University (TEST DATA)"]);
  const aProfile = { state: "Oyo", city: "Example Town", head_name: "Prof. A. Example (fixture)", head_title: "Vice-Chancellor",
    bursar_name: "Mr. B. Sample (fixture)", website_url: "https://example.org/demonstration-federal-university" };
  await fillRevision(driver, "editor", rev, { ...aProfile, assessment_period: "FY 2024" }, {
    ...BUDGET(2024, aSlug),
    grants_domestic: NF(),
    grants_international: { state: "published", period: FY(2024), amount: "0", scale: "units", literal: "₦0.00",
      reason: "The report states no international grant revenue for the year (a published zero).",
      evidence: ev(`${aSlug}/research-2024.pdf`, "Research income statement 2024", "p. 2, line 7", "2024") },
    tetfund_allocation: NF(), endowment_fund: NF(), students_undergraduate: NF(), students_postgraduate: NF(),
  });
  await submitApprovePublish(driver, rev);
  const aId = await one<string>(driver, "admin", "select id from institutions where slug = $1", [aSlug]);

  rev = await one<string>(driver, "editor", "select create_revision($1)", [aId]);
  await fillRevision(driver, "editor", rev, { assessment_period: "FY 2025" }, {
    ...BUDGET(2025, aSlug),
    grants_domestic: { state: "published", period: FY(2025), amount: "86.4", scale: "millions", literal: "₦86.4m",
      evidence: ev(`${aSlug}/research-2025.pdf`, "Research income statement 2025", "p. 2, table 3", "2025") },
    grants_international: { ...NF(), period: FY(2025) },
    tetfund_allocation: { state: "published", period: FY(2025), amount: "1.75", scale: "billions", literal: "₦1.75bn",
      evidence: ev(`${aSlug}/tetfund-2025`, "TETFund interventions 2025", "Section 2, table", "2025") },
    endowment_fund: { state: "uncertain", period: FY(2025),
      reason: "A table headed 'Endowment' may report a single award rather than the fund balance.",
      note: "Ask the bursary which figure the table shows (fixture note, never published).",
      evidence: ev(`${aSlug}/annual-report-2025.pdf`, "Annual report 2025", "p. 18", "2025") },
    students_undergraduate: { state: "published", period: SESSION(2024), count: 18450,
      evidence: ev(`${aSlug}/statistics-2024-2025`, "Student statistics 2024/2025", "Table 1, total row", "2024/2025") },
    students_postgraduate: { state: "published", period: SESSION(2024), count: 2210,
      evidence: ev(`${aSlug}/statistics-2024-2025`, "Student statistics 2024/2025", "Table 2, total row", "2024/2025") },
  });
  await submitApprovePublish(driver, rev);

  rev = await one<string>(driver, "editor", "select create_revision($1)", [aId]);
  await fillRevision(driver, "editor", rev,
    { name: "Draft Name Must Not Leak (TEST DATA)", bursar_name: "Draft Bursar Must Not Leak (fixture)" }, {});

  // B: all applicable published, one indicator excluded with a reason.
  const bSlug = "sample-state-polytechnic-test-data";
  rev = await one<string>(driver, "editor2", "select create_institution($1, $2, 'state', 'polytechnic')",
    [bSlug, "Sample State Polytechnic (TEST DATA)"]);
  await fillRevision(driver, "editor2", rev, { state: "Kano", city: "Sample City", head_name: "Dr. C. Placeholder (fixture)",
    head_title: "Rector", website_url: "https://example.org/sample-state-polytechnic", assessment_period: "FY 2025" }, {
    ...BUDGET(2025, bSlug),
    grants_domestic: { state: "published", period: FY(2025), amount: "12.5", scale: "millions", literal: "₦12.5m",
      evidence: ev(`${bSlug}/grants-2025`, "Grants received 2025", "Table 4", "2025") },
    grants_international: { state: "published", period: FY(2025), amount: "3.1", scale: "millions", literal: "₦3.1m",
      evidence: ev(`${bSlug}/grants-2025`, "Grants received 2025", "Table 5", "2025") },
    tetfund_allocation: { state: "published", period: FY(2025), amount: "640", scale: "millions", literal: "₦640m",
      evidence: ev(`${bSlug}/tetfund-2025`, "TETFund allocation 2025", "Page body, paragraph 2", "2025") },
    endowment_fund: { state: "published", period: FY(2025), amount: "45", scale: "millions", literal: "₦45m",
      evidence: ev(`${bSlug}/endowment-2025.pdf`, "Endowment fund statement 2025", "p. 1", "2025") },
    students_undergraduate: { state: "published", period: SESSION(2024), count: 7320,
      evidence: ev(`${bSlug}/enrolment-2024-2025`, "Enrolment 2024/2025", "Summary table", "2024/2025") },
    students_postgraduate: { state: "not_applicable",
      reason: "The institution ran no postgraduate programmes in the 2024/2025 session (fixture methodology rule)." },
  });
  await submitApprovePublish(driver, rev, "editor2");

  // C: reviewed, nothing found.
  const cSlug = "example-college-of-health-technology-test-data";
  rev = await one<string>(driver, "editor", "select create_institution($1, $2, 'state', 'monotechnic')",
    [cSlug, "Example College of Health Technology (TEST DATA)"]);
  const allNF = Object.fromEntries(["budget_personnel", "budget_overhead", "budget_capital", "grants_domestic",
    "grants_international", "tetfund_allocation", "endowment_fund", "students_undergraduate", "students_postgraduate"].map((k) => [k, NF()]));
  await fillRevision(driver, "editor", rev, { state: "Enugu", city: "Example Village", head_title: "Provost",
    website_url: "https://example.org/example-college", assessment_period: "FY 2025" }, allNF);
  await submitApprovePublish(driver, rev);

  // D: incomplete assessment with historical evidence, then a revision waiting for review.
  const dSlug = "placeholder-federal-polytechnic-test-data";
  rev = await one<string>(driver, "editor", "select create_institution($1, $2, 'federal', 'polytechnic')",
    [dSlug, "Placeholder Federal Polytechnic (TEST DATA)"]);
  await fillRevision(driver, "editor", rev, { state: "Kaduna", city: "Placeholder Town", head_name: "Engr. D. Demo (fixture)",
    head_title: "Rector", website_url: "https://example.org/placeholder-federal-polytechnic", assessment_period: "FY 2025" }, {
    budget_personnel: { state: "published", period: FY(2023), amount: "980", scale: "millions", literal: "₦980m",
      reason: "Only the 2023 audited accounts were found. This is historical evidence, not the 2025 period.",
      evidence: ev(`${dSlug}/audited-accounts-2023.pdf`, "Audited accounts 2023", "p. 11, note 6", "2023") },
    tetfund_allocation: { state: "published", period: FY(2025), amount: "510", scale: "millions", literal: "₦510m",
      evidence: ev(`${dSlug}/tetfund-2025`, "TETFund 2025", "Table 1", "2025") },
    students_undergraduate: { state: "published", period: SESSION(2024), count: 9105,
      evidence: ev(`${dSlug}/statistics`, "Institutional statistics", "Enrolment table", "2024/2025") },
  });
  await submitApprovePublish(driver, rev);
  const dId = await one<string>(driver, "admin", "select id from institutions where slug = $1", [dSlug]);
  rev = await one<string>(driver, "editor", "select create_revision($1)", [dId]);
  await fillRevision(driver, "editor", rev, {}, {
    budget_overhead: { state: "published", period: FY(2025), amount: "140", scale: "millions", literal: "₦140m",
      evidence: ev(`${dSlug}/budget-2025.pdf`, "Budget 2025", "p. 2", "2025") },
    endowment_fund: { ...NF(), period: FY(2025) },
  });
  await one(driver, "editor", "select submit_revision($1, $2)", [rev, await lockOf(driver, rev)]);

  // E: published, then withdrawn. Never visible to the public afterwards.
  const eSlug = "withdrawn-example-university-test-data";
  rev = await one<string>(driver, "editor2", "select create_institution($1, $2, 'state', 'university')",
    [eSlug, "Withdrawn Example University (TEST DATA)"]);
  await fillRevision(driver, "editor2", rev, { state: "Lagos", assessment_period: "FY 2025" }, BUDGET(2025, eSlug));
  await submitApprovePublish(driver, rev, "editor2");
  const eId = await one<string>(driver, "admin", "select id from institutions where slug = $1", [eSlug]);
  await one(driver, "reviewer", "select withdraw_publication($1, $2)", [eId, "Fixture: evidence was attributed to the wrong institution."]);

  // F: a private draft that has never been published.
  rev = await one<string>(driver, "editor2", "select create_institution($1, $2, 'federal', 'monotechnic')",
    ["unpublished-draft-institute-test-data", "Unpublished Draft Institute (TEST DATA)"]);

  // Work assignments.
  await one(driver, "reviewer", "select assign_institution($1, $2, $3, $4)", [aId, FIXTURE_USERS.editor.id, FIXTURE_USERS.reviewer.id, "2026-11-14"]);
  await one(driver, "reviewer", "select assign_institution($1, $2, $3, $4)", [dId, FIXTURE_USERS.editor.id, FIXTURE_USERS.reviewer.id, "2026-10-24"]);

  await driver.transaction((tx) =>
    tx.query("insert into app_settings (key, value) values ('fixtures_seeded', $1)", [JSON.stringify({ at: "local" })]));
}

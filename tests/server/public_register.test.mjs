// The public register readers (src/server/data/publicRegister.ts): what the anon role reads and how
// it is shaped for the pages. Run with: node --conditions=react-server --test tests/server/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LOCAL_DB_DIR = mkdtempSync(join(tmpdir(), "nut-public-"));
delete process.env.DATABASE_URL;

const reg = await import("../../src/server/data/publicRegister.ts");
const { openPglite } = await import("../../src/server/db/core.ts");

// The first read opens and migrates the local database; the same instance then seeds it as owner.
const hiddenStatus = await reg.readRegisterStatus();
const owner = await openPglite(process.env.LOCAL_DB_DIR);
const sql = (q, params) => owner.transaction((tx) => tx.query(q, params));

const VERIFIED = "11111111-1111-4111-8111-111111111111";
const LISTED = "22222222-2222-4222-8222-222222222222";
const ARCHIVED = "33333333-3333-4333-8333-333333333333";
const content = {
  name: "University of Testing", section: "federal_university", state: "Lagos", head_name: "Prof. A. Head", bursar_name: "B. Bursar",
  people_source_url: "https://test.edu.ng/management", homepage_url: "https://test.edu.ng", disclosure_url: "https://test.edu.ng/finance",
  extra_links: [], assessments: { budget_capital: { status: "published", year: "2024", evidence_url: "https://test.edu.ng/b.pdf", checked_on: "2026-10-01", note: null } },
};

await sql(`insert into report_entries (id, section, name, slug, listed_name, listed_section, listed_state, verified, verified_at, verified_method,
                                       verified_assessment_year, sort_order)
           values ($1, 'federal_university', 'University of Testing', 'university-of-testing', 'University of Testing', 'federal_university', 'Lagos ',
                   $2, '2026-11-02T09:30:00Z', '2026.1', 2026, 1),
                  ($3, 'state_polytechnic', 'Listed Polytechnic', 'listed-polytechnic', 'Listed Polytechnic', 'state_polytechnic', null, null, null, null, null, 2),
                  ($4, 'federal_monotechnic', 'Archived College', 'archived-college', 'Archived College', 'federal_monotechnic', null, null, null, null, null, 3)`,
  [VERIFIED, JSON.stringify(content), LISTED, ARCHIVED]);
await sql("update report_entries set archived_at = now(), archive_reason = 'Duplicate of another record' where id = $1", [ARCHIVED]);
await sql(`insert into report_entry_versions (entry_id, content, verified_at, verified_method, assessment_year, superseded_at, reason)
           values ($1, $2, '2026-10-01T08:00:00Z', '2026.1', 2025, '2026-11-02T09:30:00Z', 'Internal reason, never public')`,
  [VERIFIED, JSON.stringify({ ...content, state: "Ogun" })]);

test("a hidden register reads as hidden, with no counts", () => {
  assert.equal(hiddenStatus.visible, false);
  assert.equal(hiddenStatus.listed, 0);
});

test("the register lists verified and imported records, never archived ones, with dates as plain text", async () => {
  await sql("update report_settings set visible = true, reported_as_of = '2026-11-01', assessment_year = 2026");
  const r = await reg.readRegister();
  assert.deepEqual(r.rows.map((x) => x.slug), ["university-of-testing", "listed-polytechnic"]);
  assert.equal(r.reportedAsOf, "2026-11-01");
  assert.equal(r.assessmentYear, 2026);
  const [v, listed] = r.rows;
  assert.equal(v.verifiedAt, "2026-11-02T09:30:00.000Z");
  assert.equal(v.verifiedMethod, "2026.1");
  assert.equal(v.verifiedAssessmentYear, 2026);
  assert.equal(v.verified.people_source_url, "https://test.edu.ng/management");
  assert.equal(listed.verified, null);
  assert.equal(listed.state, null);
  const status = await reg.readRegisterStatus();
  assert.deepEqual({ ...status, lastVerifiedAt: status.lastVerifiedAt?.slice(0, 10) },
    { visible: true, listed: 2, verified: 1, lastVerifiedAt: "2026-11-02", reportedAsOf: "2026-11-01", assessmentYear: 2026 });
});

test("one record is read by id; unknown, archived and malformed ids give null", async () => {
  const one = await reg.readRegisterRecord(VERIFIED.toUpperCase());
  assert.equal(one.row.slug, "university-of-testing");
  assert.equal(one.row.state, "Lagos");
  assert.equal(one.assessmentYear, 2026);
  assert.equal(await reg.readRegisterRecord(ARCHIVED), null);
  assert.equal(await reg.readRegisterRecord("44444444-4444-4444-8444-444444444444"), null);
  assert.equal(await reg.readRegisterRecord("1; drop table report_entries"), null);
});

test("addresses resolve by slug or id; anything else is null without a query", async () => {
  assert.deepEqual(await reg.readResolve("university-of-testing"), { id: VERIFIED, slug: "university-of-testing" });
  assert.deepEqual(await reg.readResolve(LISTED), { id: LISTED, slug: "listed-polytechnic" });
  assert.equal(await reg.readResolve("archived-college"), null);
  assert.equal(await reg.readResolve("no-such-place"), null);
  assert.equal(await reg.readResolve("../etc/passwd"), null);
  assert.equal(reg.isSlug("Upper-Case"), false);
  assert.equal(reg.isUuid(VERIFIED), true);
});

test("earlier versions carry content and their own assessment year, never the reason", async () => {
  const versions = await reg.readRegisterVersions(VERIFIED);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].assessmentYear, 2025);
  assert.equal(versions[0].content.state, "Ogun");
  assert.equal(versions[0].supersededAt, "2026-11-02T09:30:00.000Z");
  assert.ok(!JSON.stringify(versions).includes("Internal reason"));
  assert.deepEqual(await reg.readRegisterVersions("not-an-id"), []);
});

test("the rule versions are listed with calendar dates", async () => {
  const methods = await reg.readRegisterMethods();
  assert.ok(methods.length >= 1);
  assert.match(methods[0].effectiveOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(methods.some((m) => m.version === "2026.1"));
});

test("a hidden register hides records, versions and addresses too", async () => {
  await sql("update report_settings set visible = false");
  assert.equal((await reg.readRegister()).rows.length, 0);
  assert.equal(await reg.readRegisterRecord(VERIFIED), null);
  assert.equal(await reg.readResolve("university-of-testing"), null);
  assert.deepEqual(await reg.readRegisterVersions(VERIFIED), []);
  await owner.close();
});

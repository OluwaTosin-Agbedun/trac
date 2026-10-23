// The public compliance report: only an administrator can show or hide it, the public reads only
// the shown import's federal rows, and nothing else about imports becomes readable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { federalOnly, parseTrackerTsv, summarise } from "../../src/lib/import/trackerTsv.ts";
const all = parseTrackerTsv(readFileSync(new URL("../../data/source/tracker-export-2026-10-10.tsv", import.meta.url), "utf8"));

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const EDITOR = "00000000-0000-0000-0000-00000000000e";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const dir = new URL("../../db/migrations/", import.meta.url);
const db = new PGlite();
for (const f of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));
await db.exec(`insert into app_users (id, email, display_name) values ('${ADMIN}', 'a@example.test', 'Admin'), ('${EDITOR}', 'e@example.test', 'Editor'), ('${REVIEWER}', 'r@example.test', 'Reviewer');
  insert into team_memberships (user_id, role, display_name) values ('${ADMIN}', 'admin', 'Admin'), ('${EDITOR}', 'editor', 'Editor'), ('${REVIEWER}', 'reviewer', 'Reviewer');`);

async function as(user, q, params = []) {
  await db.exec(`select set_config('nut.user_id', '${user ?? ""}', false); set role ${user ? "nut_member" : "nut_anon"};`);
  try { return (await db.query(q, params)).rows; } finally { await db.exec("reset role;"); }
}
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);

const text = readFileSync(new URL("../../data/source/tracker-export-2026-10-10.tsv", import.meta.url), "utf8");
const fed = federalOnly(parseTrackerTsv(text));

test("federalOnly keeps the three federal sections only", () => {
  assert.equal(fed.rows.length, 194);
  assert.ok(fed.rows.every((r) => r.section.startsWith("federal_")));
  assert.equal(fed.excludedStateRows, 205);
});

test("only an administrator shows the report; the public reads federal rows and nothing else", async () => {
  const [{ id }] = await as(ADMIN, "select stage_import($1,$2,$3,$4,$5,$6) as id", ["t.tsv", text, fed.reportedAsOf, "trackerTsv@2",
    JSON.stringify(summarise(fed)), JSON.stringify(fed.rows)]);
  assert.equal((await as(null, "select * from tracker_report()")).length, 0);
  await rejects(as(EDITOR, "select publish_tracker_report($1)", [id]), "42501");
  await rejects(as(null, "select publish_tracker_report($1)", [id]), "42501");
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  const rows = await as(null, "select * from tracker_report()");
  assert.ok(rows.length > 150);
  assert.ok(rows.every((r) => r.section.startsWith("federal_")));
  assert.ok(rows.every((r) => r.website_url === null || /^https?:\/\//i.test(r.website_url)));
  // Raw import tables stay private.
  await rejects(as(null, "select * from import_rows"), "42501");
  await rejects(as(null, "select * from public_reports"), "42501");
  await rejects(as(EDITOR, "select hide_tracker_report()"), "42501");
  await as(ADMIN, "select hide_tracker_report()");
  assert.equal((await as(null, "select * from tracker_report()")).length, 0);
});

test("the register: edits stay private until a different reviewer verifies complete evidence", async () => {
  const [{ id }] = await as(ADMIN, "select id from imports order by uploaded_at limit 1");
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  // Nothing is public until verified: no ticks, no statuses.
  const before = await as(null, "select * from public_register()");
  assert.ok(before.length > 0 && before.every((r) => r.verified === null));
  const legacy = await as(null, "select * from public_report() limit 5");
  assert.ok(legacy.every((r) => Object.values(r.indicators).every((v) => v === null) && r.report_status === "not_recorded"));

  const [first] = await as(EDITOR, "select * from report_entries where section = 'federal_university' order by sort_order limit 1");
  const full = (status) => Object.fromEntries(["budget_personnel", "budget_overhead", "budget_capital", "grants_domestic", "grants_international",
    "tetfund_allocation", "endowment_fund", "students_undergraduate", "students_postgraduate"].map((k) => [k,
    { status, year: "2025", evidence_url: "https://example.edu.ng/disclosure", checked_on: "2026-10-20", note: null }]));
  const payload = { section: "federal_university", name: first.name, state: "Lagos", homepage_url: "https://example.edu.ng/",
    disclosure_url: "https://example.edu.ng/disclosure", extra_links: [{ label: "Budget 2025", url: "https://example.edu.ng/budget.pdf" }],
    assessments: { ...full("published"), endowment_fund: { status: "nil", year: null, evidence_url: null, checked_on: "2026-10-20", note: "Declared nil" } } };
  const save = (who, p) => as(who, "select save_report_entry($1, $2) as id", [first.id, JSON.stringify(p)]);
  await rejects(save(null, payload), "42501");
  await rejects(save(EDITOR, { ...payload, assessments: { budget_personnel: { status: "compliant" } } }), "22023");
  await rejects(save(EDITOR, { ...payload, homepage_url: "javascript:alert(1)" }), "22023");
  await save(EDITOR, { ...payload, assessments: { budget_personnel: { status: "published" } } }); // incomplete first
  assert.equal((await as(null, "select verified from public_register() where id = $1", [first.id]))[0].verified, null);

  const hashOf = async () => (await as(REVIEWER, "select register_hash(e) as h from report_entries e where id = $1", [first.id]))[0].h;
  await rejects(as(EDITOR, "select verify_report_entry($1, $2)", [first.id, await hashOf()]), "42501"); // editors do not verify
  await rejects(as(REVIEWER, "select verify_report_entry($1, $2)", [first.id, "0".repeat(64)]), "40001");
  await rejects(as(REVIEWER, "select verify_report_entry($1, $2)", [first.id, await hashOf()]), "22023"); // not ready
  await save(EDITOR, payload);
  await as(REVIEWER, "select verify_report_entry($1, $2)", [first.id, await hashOf()]);
  const [pub] = await as(null, "select * from public_register() where id = $1", [first.id]);
  assert.equal(pub.verified.assessments.budget_personnel.status, "published");
  assert.equal(pub.verified.assessments.endowment_fund.status, "nil");
  assert.equal(pub.verified.disclosure_url, "https://example.edu.ng/disclosure");

  // A reviewer who edits cannot verify their own change; another person must.
  await as(REVIEWER, "select save_report_entry($1, $2)", [first.id, JSON.stringify({ ...payload, state: "Ogun" })]);
  await rejects(as(REVIEWER, "select verify_report_entry($1, $2)", [first.id, await hashOf()]), "42501");
  assert.equal((await as(null, "select state from public_register() where id = $1", [first.id]))[0].state, "Lagos", "public keeps the verified copy");
  await as(ADMIN, "select return_report_entry($1, 'Check the state')", [first.id]);
  await as(ADMIN, "select verify_report_entry($1, $2)", [first.id, await hashOf()]);
  assert.equal((await as(null, "select state from public_register() where id = $1", [first.id]))[0].state, "Ogun");

  // Loading the spreadsheet again never removes or overwrites a record already in the register.
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  assert.ok((await as(null, "select verified from public_register() where id = $1", [first.id]))[0].verified);

  // Link checks are team-only.
  await as(EDITOR, "select save_link_checks($1, $2)", [first.id, JSON.stringify([{ url: "https://example.edu.ng/", kind: "homepage", result: "ok", http_status: 200 }])]);
  await rejects(as(null, "select * from report_link_checks"), "42501");
  assert.equal((await as(EDITOR, "select count(*)::int as n from report_link_checks where entry_id = $1", [first.id]))[0].n, 1);

  // Evidence must belong to the institution: another institution's website, a homepage, or a link
  // whose latest check found it dead is refused, with the reason.
  const verify = async (p) => { await save(EDITOR, p); return as(REVIEWER, "select verify_report_entry($1, $2)", [first.id, await hashOf()]); };
  const refused = (p, re) => assert.rejects(verify(p), (e) => e.code === "22023" && re.test(e.message));
  await refused({ ...payload, disclosure_url: "https://fupre.edu.ng/data-disclosure/" }, /another website \(fupre\.edu\.ng\), not the institution's \(example\.edu\.ng\)/);
  await refused({ ...payload, disclosure_url: "https://www.example.edu.ng/" }, /disclosure page is the homepage/);
  const evidence = (url) => ({ ...payload, assessments: { ...payload.assessments, budget_personnel: { ...payload.assessments.budget_personnel, evidence_url: url } } });
  await refused(evidence("https://pti.edu.ng/budget.pdf"), /Personnel costs evidence is on another website \(pti\.edu\.ng\)/);
  await refused(evidence("https://news.example.edu.ng"), /Personnel costs evidence is the homepage/);
  const check = (result) => as(EDITOR, "select save_link_checks($1, $2)", [first.id, JSON.stringify([{ url: "https://example.edu.ng/disclosure", kind: "disclosure", result }])]);
  await check("not_found");
  await refused({ ...payload, state: "Lagos" }, /last link check of https:\/\/example\.edu\.ng\/disclosure found a dead link/);
  await check("ok");
  await as(REVIEWER, "select verify_report_entry($1, $2)", [first.id, await hashOf()]);
  assert.equal((await as(null, "select state from public_register() where id = $1", [first.id]))[0].state, "Lagos");
  // Subdomains of the institution's own site are accepted.
  await verify(evidence("https://portal.example.edu.ng/budget-2025.pdf"));
});

test("state institutions load again, and flagged addresses and contradictory states are not shown", async () => {
  const fullText = `${text}\n`; // different bytes, so a new import
  const [{ id }] = await as(ADMIN, "select stage_import($1,$2,$3,$4,$5,$6) as id", ["full.tsv", fullText, all.reportedAsOf, "trackerTsv@2",
    JSON.stringify(summarise(all)), JSON.stringify(all.rows)]);
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  const rows = await as(null, "select * from public_report()");
  const sections = new Set(rows.map((r) => r.section));
  for (const s of ["state_university", "state_polytechnic", "state_monotechnic"]) assert.ok(sections.has(s), s);
  const pti = rows.find((r) => r.name.startsWith("Petroleum Training Institute"));
  assert.ok(pti, "PTI present");
  assert.equal(pti.website_url, null, "a shared, possibly duplicate address is not linked");
  const otuoke = rows.find((r) => r.name.includes("Otuoke"));
  assert.equal(otuoke.state, null, "a state that contradicts the name is left blank");
  assert.ok(rows.every((r) => r.website_url === null || /^https?:\/\/\S+$/i.test(r.website_url)));
});

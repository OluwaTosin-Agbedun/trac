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
  // Hiding the register is an administrator's explained decision, not an Import centre button.
  await rejects(as(EDITOR, "select hide_tracker_report()"), "42501");
  await rejects(as(ADMIN, "select hide_tracker_report()"), "22023");
  await rejects(as(EDITOR, "select set_register_visibility(false, 'Testing the hidden state')"), "42501");
  await rejects(as(ADMIN, "select set_register_visibility(false, '')"), "22023");
  await as(ADMIN, "select set_register_visibility(false, 'Testing the hidden state')");
  assert.equal((await as(null, "select * from tracker_report()")).length, 0);
  const [status] = await as(null, "select * from public_register_status()");
  assert.equal(status.visible, false);
  assert.equal(status.listed, 0, "a hidden register exposes no counts");
  // A later load does not switch it back on.
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  assert.equal((await as(null, "select * from public_register_status()"))[0].visible, false);
});

test("the register: edits stay private until a different reviewer verifies complete evidence", async () => {
  const [{ id }] = await as(ADMIN, "select id from imports order by uploaded_at limit 1");
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  await as(ADMIN, "select set_register_visibility(true, 'Back on for the register tests')");
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
  const hashOf = async (id = first.id) => (await as(REVIEWER, "select register_hash(e) as h from report_entries e where id = $1", [id]))[0].h;
  const save = async (who, p) => as(who, "select save_report_entry($1, $2, $3) as id", [first.id, JSON.stringify(p), await hashOf()]);
  await rejects(save(null, payload), "42501");
  await rejects(save(EDITOR, { ...payload, assessments: { budget_personnel: { status: "compliant" } } }), "22023");
  await rejects(save(EDITOR, { ...payload, homepage_url: "javascript:alert(1)" }), "22023");
  await save(EDITOR, { ...payload, assessments: { budget_personnel: { status: "published" } } }); // incomplete first
  assert.equal((await as(null, "select verified from public_register() where id = $1", [first.id]))[0].verified, null);

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
  await save(REVIEWER, { ...payload, state: "Ogun" });
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

  // Every earlier verified version is kept, and the scoring rule version is recorded.
  assert.ok((await as(null, "select * from public_register_versions($1)", [first.id])).length >= 3, "earlier verified versions are kept");
  assert.equal((await as(null, "select verified_method from public_register() where id = $1", [first.id]))[0].verified_method, "2026.1");
  // A published finding needs a four-digit reporting year.
  const badYear = { ...payload, assessments: { ...payload.assessments, budget_overhead: { ...payload.assessments.budget_overhead, year: "last year" } } };
  await refused(badYear, /Overhead costs reporting year must include a four-digit year/);
});

test("register completion: conflicts, frozen listing, assignments, withdrawal, removal and the scheduled link check", async () => {
  const EDITOR2 = "00000000-0000-0000-0000-0000000000e2";
  await db.exec(`insert into app_users (id, email, display_name) values ('${EDITOR2}', 'e2@example.test', 'Editor Two') on conflict do nothing;
    insert into team_memberships (user_id, role, display_name) values ('${EDITOR2}', 'editor', 'Editor Two') on conflict do nothing;`);
  const [rec] = await as(EDITOR, "select * from report_entries where verified is null and listed_name is not null order by sort_order limit 1");
  const hash = async (id) => (await as(EDITOR, "select register_hash(e) as h from report_entries e where id = $1", [id]))[0].h;
  const body = { section: rec.section, name: `${rec.name} (renamed)`, state: rec.state, assessments: {} };

  // A page from an older build (two-argument save) and a stale version are both refused as conflicts.
  await rejects(as(EDITOR, "select save_report_entry($1, $2)", [rec.id, JSON.stringify(body)]), "40001");
  await rejects(as(EDITOR, "select save_report_entry($1, $2, $3)", [rec.id, JSON.stringify(body), "0".repeat(64)]), "40001");
  await as(EDITOR, "select save_report_entry($1, $2, $3)", [rec.id, JSON.stringify(body), await hash(rec.id)]);
  // The public listing keeps the imported name until the record is verified.
  assert.equal((await as(null, "select name from public_register() where id = $1", [rec.id]))[0].name, rec.name);

  // A record added by hand is not listed publicly until it is verified.
  const [{ id: added }] = await as(EDITOR, "select save_report_entry(null, $1, null) as id",
    [JSON.stringify({ section: "federal_university", name: "Hand Added University" })]);
  assert.equal((await as(null, "select count(*)::int as n from public_register() where id = $1", [added]))[0].n, 0);

  // Assignments: an editor may change only records assigned to them or to nobody.
  await rejects(as(EDITOR, "select assign_report_entries($1, $2, null, null)", [[rec.id], EDITOR2]), "42501");
  await rejects(as(REVIEWER, "select assign_report_entries($1, $2, $2, null)", [[rec.id], REVIEWER]), "23514");
  assert.equal((await as(REVIEWER, "select assign_report_entries($1, $2, $3, current_date + 7) as n", [[rec.id], EDITOR2, REVIEWER]))[0].n, 1);
  await rejects(as(EDITOR, "select save_report_entry($1, $2, $3)", [rec.id, JSON.stringify(body), await hash(rec.id)]), "42501");
  await as(EDITOR2, "select save_report_entry($1, $2, $3)", [rec.id, JSON.stringify({ ...body, state: "Lagos" }), await hash(rec.id)]);

  // Withdrawal needs a reason, keeps the verified copy and sends the reason back to the editor.
  const [ver] = await as(REVIEWER, "select id from report_entries where verified is not null limit 1");
  await rejects(as(REVIEWER, "select withdraw_report_verification($1, '')", [ver.id]), "22023");
  await rejects(as(EDITOR, "select withdraw_report_verification($1, 'Wrong disclosure page')", [ver.id]), "42501");
  await as(REVIEWER, "select withdraw_report_verification($1, 'Wrong disclosure page')", [ver.id]);
  const [after] = await as(REVIEWER, "select verified, return_note from report_entries where id = $1", [ver.id]);
  assert.equal(after.verified, null);
  assert.match(after.return_note, /Verification withdrawn: Wrong disclosure page/);
  assert.equal((await as(null, "select verified from public_register() where id = $1", [ver.id]))[0].verified, null);
  assert.ok((await as(null, "select * from public_register_versions($1)", [ver.id])).length >= 1);
  await rejects(as(REVIEWER, "select withdraw_report_verification($1, 'Again please')", [ver.id]), "22023");

  // Removing archives the record with a reason (administrators only); it leaves the public site, keeps
  // its history and can be restored. The older one-argument call is refused.
  await rejects(as(ADMIN, "select delete_report_entry($1)", [ver.id]), "40001");
  await rejects(as(ADMIN, "select archive_report_entry($1, '')", [ver.id]), "22023");
  await rejects(as(REVIEWER, "select archive_report_entry($1, 'Duplicate of another record')", [ver.id]), "42501");
  await as(ADMIN, "select archive_report_entry($1, 'Duplicate of another record')", [ver.id]);
  assert.equal((await as(null, "select count(*)::int as n from public_register() where id = $1", [ver.id]))[0].n, 0);
  assert.equal((await as(null, "select count(*)::int as n from public_register_versions($1)", [ver.id]))[0].n, 0);
  assert.ok((await as(REVIEWER, "select count(*)::int as n from report_entry_versions where entry_id = $1", [ver.id]))[0].n >= 1, "history kept");
  await rejects(as(EDITOR, "select save_report_entry($1, $2, $3)", [ver.id, JSON.stringify(body), await hash(ver.id)]), "22023");
  await rejects(as(REVIEWER, "select restore_report_entry($1)", [ver.id]), "42501");
  await as(ADMIN, "select restore_report_entry($1)", [ver.id]);
  assert.equal((await as(null, "select count(*)::int as n from public_register() where id = $1", [ver.id]))[0].n, 1);

  // Stable addresses: every record has a unique slug, and old keys resolve to it.
  const [listed] = await as(null, "select id, slug from public_register() limit 1");
  assert.match(listed.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal((await as(null, "select slug from public_register_resolve($1)", [listed.slug]))[0].slug, listed.slug);
  assert.equal((await as(null, "select slug from public_register_resolve($1)", [listed.id]))[0].slug, listed.slug);
  assert.equal((await as(null, "select count(*)::int as n from public_register_resolve('no-such-institution')"))[0].n, 0);
  assert.equal((await as(null, "select count(*)::int as n from public_register_resolve($1)", [added]))[0].n, 0, "unlisted records do not resolve");
  const dupes = await as(EDITOR, "select slug, count(*)::int as n from report_entries group by slug having count(*) > 1");
  assert.equal(dupes.length, 0);

  // Names need a source before verification.
  const [named] = await as(EDITOR, "select * from report_entries where id = $1", [added]);
  await as(EDITOR, "select save_report_entry($1, $2, $3)", [added, JSON.stringify({ section: named.section, name: named.name,
    head_name: "Prof. A. Example" }), await hash(added)]);
  await assert.rejects(as(REVIEWER, "select verify_report_entry($1, $2)", [added, await hash(added)]),
    (e) => e.code === "22023" && /page that names the head and bursar/.test(e.message));

  // Settings: administrators only, with checked values.
  await rejects(as(EDITOR, "select set_report_settings(null, 2026, 180)"), "42501");
  await rejects(as(ADMIN, "select set_report_settings(null, 2026, 5)"), "22023");
  await rejects(as(ADMIN, "select set_report_settings(true, null::date)"), "40001");
  await as(ADMIN, "select set_report_settings(null, 2026, 120)");
  assert.equal((await as(null, "select assessment_year from public_register() limit 1"))[0].assessment_year, 2026);

  // The scheduled link check runs only as nut_cron; members, visitors and the account service cannot call it.
  await rejects(as(null, "select * from system_register_links_due(5)"), "42501");
  await rejects(as(EDITOR, "select * from system_register_links_due(5)"), "42501");
  await rejects(as(EDITOR, "select system_save_link_checks($1, '[]')", [rec.id]), "42501");
  for (const role of ["nut_system", "nut_worker"]) {
    await db.exec(`set role ${role};`);
    try {
      await assert.rejects(db.query("select * from system_register_links_due(5)"), (e) => e.code === "42501", role);
    } finally { await db.exec("reset role;"); }
  }
  await db.exec("set role nut_cron;");
  try {
    assert.ok((await db.query("select * from system_register_links_due(5)")).rows.length <= 5);
    await assert.rejects(db.query("select * from report_entries limit 1"), (e) => e.code === "42501", "nut_cron reads no tables");
  } finally { await db.exec("reset role;"); }

  // Rows held as possible duplicates wait for a decision; rows held for other reasons load with their reasons.
  assert.equal((await as(EDITOR, "select count(*)::int as n from report_entries where name ilike 'Air Force Institute of Technology%'"))[0].n, 0);
  const [jos] = await as(EDITOR, "select import_flags from report_entries where name = 'University of Jos'");
  assert.deepEqual(jos.import_flags, ["website_not_url"]);
});

test("state institutions load again, and flagged addresses and contradictory states are not shown", async () => {
  const fullText = `${text}\n`; // different bytes, so a new import
  const [{ id }] = await as(ADMIN, "select stage_import($1,$2,$3,$4,$5,$6) as id", ["full.tsv", fullText, all.reportedAsOf, "trackerTsv@2",
    JSON.stringify(summarise(all)), JSON.stringify(all.rows)]);
  // PTI is held as a possible duplicate (it shares FUPRE's address): it waits until someone decides.
  const [ptiRow] = await as(ADMIN, "select id from import_rows where import_id = $1 and mapped->>'name' like 'Petroleum Training Institute%'", [id]);
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  assert.equal((await as(null, "select count(*)::int as n from public_report() where name like 'Petroleum Training Institute%'"))[0].n, 0);
  await as(ADMIN, "select decide_import_row($1, 'create_new')", [ptiRow.id]);
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  const again = await as(ADMIN, "select count(*)::int as n from report_entries");
  await as(ADMIN, "select publish_tracker_report($1)", [id]);
  assert.equal((await as(ADMIN, "select count(*)::int as n from report_entries"))[0].n, again[0].n, "loading again adds nothing");
  // Every website reason travels with the record, not only the reasons that held the row (0017).
  const [why] = await as(ADMIN, `select count(*) filter (where r.issues @> '[{"code": "shared_domain"}]'::jsonb)::int as shared,
      count(*) filter (where r.issues @> '[{"code": "shared_domain"}]'::jsonb and not ('shared_domain' = any (e.import_flags)))::int as unflagged
      from report_entries e join import_rows r on r.id = e.source_row_id`);
  assert.ok(why.shared > 0, "the export has rows sharing a website");
  assert.equal(why.unflagged, 0);
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

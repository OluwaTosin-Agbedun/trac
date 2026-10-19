// Platform checks: roles, account-table isolation, one-way setup, migration integrity, and privacy
// against the test-only fixture data (tests/fixtures/seed.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, appendFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openPglite, migrate, runAs } from "../../src/server/db/core.ts";
import { seedLocalFixtures, FIXTURE_USERS } from "../fixtures/seed.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const migrations = join(root, "db", "migrations");
const db = await openPglite(null);
const first = await migrate(db, migrations);
await seedLocalFixtures(db, root);

const sys = (q, p = []) => runAs(db, { kind: "system" }, (tx) => tx.query(q, p));
const anon = (q, p = []) => runAs(db, { kind: "anon" }, (tx) => tx.query(q, p));
const member = (id, q, p = []) => runAs(db, { kind: "user", userId: id }, (tx) => tx.query(q, p));
const owner = (q, p = []) => db.transaction((tx) => tx.query(q, p));
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);

test("migrations apply once and refuse edited files", async () => {
  assert.equal(first.applied.length, readdirSync(migrations).filter((f) => f.endsWith(".sql")).length);
  const again = await migrate(db, migrations);
  assert.equal(again.applied.length, 0);
  const dir = mkdtempSync(join(tmpdir(), "nut-mig-"));
  cpSync(migrations, dir, { recursive: true });
  appendFileSync(join(dir, "0001_phase1_core.sql"), "\n-- edited\n");
  await assert.rejects(migrate(db, dir), /changed after it was applied/);
});

test("the account service reaches account tables and nothing else", async () => {
  assert.ok((await sys("select id from app_users")).length >= 4);
  await rejects(sys("select * from revisions"), "42501");
  await rejects(sys("select * from import_rows"), "42501");
  await rejects(sys("select * from published_snapshots"), "42501");
  await rejects(sys("select publish_revision(gen_random_uuid())"), "42501");
  await rejects(sys("delete from app_sessions"), "42501");
  // Audit inserts work (identity column) but must name an actor.
  await sys("insert into audit_events (actor_id, action, entity_type) values ($1, 'test.event', 'test')", [FIXTURE_USERS.admin.id]);
  await rejects(sys("insert into audit_events (action, entity_type) values ('test.event', 'test')"), "42501");
});

test("public and team roles can never read credentials", async () => {
  for (const t of ["app_users", "app_sessions", "app_invites", "app_settings", "app_login_attempts"]) {
    await rejects(anon(`select * from ${t}`), "42501");
    await rejects(member(FIXTURE_USERS.admin.id, `select * from ${t}`), "42501");
  }
});

test("team directory shows names to team members only", async () => {
  const rows = await member(FIXTURE_USERS.editor.id, "select display_name, role from team_directory order by display_name");
  assert.ok(rows.some((r) => r.display_name === "Fixture Reviewer"));
  assert.ok(!("email" in rows[0]));
  await rejects(anon("select * from team_directory"), "42501");
  assert.equal((await member("00000000-0000-4000-8000-00000000dead", "select * from team_directory")).length, 0);
});

test("the setup flag is permanent", async () => {
  await rejects(sys("update app_settings set value = '{}' where key = 'setup_completed'"), "42501");
  await rejects(owner("update app_settings set value = '{}' where key = 'setup_completed'"), "55000");
  await rejects(owner("delete from app_settings where key = 'setup_completed'"), "55000");
  await rejects(sys("insert into app_settings (key, value) values ('setup_completed', '{}')"), "23505");
});

test("test fixtures: real import stays private, fictional releases are public and labelled", async () => {
  const pub = await anon("select slug, payload->'profile'->>'name' as name, payload->'summary'->>'label' as label from published_snapshots where is_current order by slug");
  assert.equal(pub.length, 4);
  assert.ok(pub.every((r) => r.name.endsWith("(TEST DATA)")));
  assert.deepEqual(pub.map((r) => r.label).sort(),
    ["all_applicable_published", "assessment_incomplete", "evidence_uncertain", "no_disclosures_found"]);
  // Withdrawn and draft-only institutions are invisible; the later private draft does not leak.
  assert.equal((await anon("select 1 from published_snapshots where slug like 'withdrawn-%' or slug like 'unpublished-%'")).length, 0);
  assert.equal((await anon("select 1 from published_snapshots where payload::text like '%Must Not Leak%'")).length, 0);
  // The imported real rows are drafts only.
  const [{ n }] = await owner("select count(*)::int as n from import_rows where revision_id is not null");
  assert.equal(n, 329);
  // Evidence in public payloads points only at example.org placeholders.
  const urls = await anon(`select e->>'url' as url from published_snapshots s, jsonb_array_elements(s.payload->'indicators') i,
                           jsonb_array_elements(i->'evidence') e`);
  assert.ok(urls.length > 0 && urls.every((r) => r.url.startsWith("https://example.org/")));
  // Internal notes never reach a public payload.
  assert.equal((await anon("select 1 from published_snapshots where payload::text like '%never published%'")).length, 0);
});

test("a finding reassessed as not found carries no stale value from the earlier release", async () => {
  const [row] = await anon(`select i from published_snapshots s, jsonb_array_elements(s.payload->'indicators') i
                             where s.slug = 'demonstration-federal-university-test-data' and s.is_current
                               and i->>'key' = 'grants_international'`);
  assert.equal(row.i.state, "not_found");
  assert.equal(row.i.value_amount, null);
  assert.equal(row.i.value_literal, null);
  assert.equal(row.i.period_label, "2025");
  // Release 1 still shows its published zero, as history.
  const [old] = await anon(`select i from published_snapshots s, jsonb_array_elements(s.payload->'indicators') i
                             where s.slug = 'demonstration-federal-university-test-data' and s.release_number = 1
                               and i->>'key' = 'grants_international'`);
  assert.equal(Number(old.i.value_amount), 0);
});

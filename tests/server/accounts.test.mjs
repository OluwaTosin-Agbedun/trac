// Account service: one-time setup, sign-in and lockout, sessions, invitations, team rules.
// Run with: node --conditions=react-server --test tests/server/*.test.mjs  (server-only resolves empty)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.LOCAL_DB_DIR = mkdtempSync(join(tmpdir(), "nut-accounts-"));
delete process.env.DATABASE_URL;

const acc = await import("../../src/server/auth/accounts.ts");
const { asSystem } = await import("../../src/server/db/index.ts");

const OWNER = { email: "Owner@Example.org", name: "Owner Person", pw: "a long owner passphrase" };
let ownerId;
const ownerViewer = () => ({ userId: ownerId, displayName: OWNER.name, email: "owner@example.org", role: "admin", isFixture: false });

test("outside the local database, setup needs the deployment's SETUP_TOKEN", async () => {
  const saved = { env: process.env.NODE_ENV, token: process.env.SETUP_TOKEN };
  process.env.NODE_ENV = "production"; // no DATABASE_URL: the server is not in local mode
  try {
    assert.equal(acc.setupTokenRequired(), true);
    delete process.env.SETUP_TOKEN;
    await assert.rejects(acc.completeSetup("a@example.org", "A", "a long enough passphrase", "anything"), /Configuration required: set SETUP_TOKEN/);
    process.env.SETUP_TOKEN = "s".repeat(40);
    await assert.rejects(acc.completeSetup("a@example.org", "A", "a long enough passphrase", "wrong"), /setup token is not correct/);
    await assert.rejects(acc.completeSetup("a@example.org", "A", "a long enough passphrase"), /setup token is not correct/);
  } finally {
    process.env.NODE_ENV = saved.env;
    if (saved.token === undefined) delete process.env.SETUP_TOKEN; else process.env.SETUP_TOKEN = saved.token;
  }
  assert.equal(acc.setupTokenRequired(), false);
});

test("setup is open once, then closed for good", async () => {
  assert.equal(await acc.isSetupComplete(), false);
  await assert.rejects(acc.completeSetup("x@example.org", "X", "short"), acc.AccountError);
  // Two simultaneous setups: exactly one wins.
  const results = await Promise.allSettled([
    acc.completeSetup(OWNER.email, OWNER.name, OWNER.pw),
    acc.completeSetup("intruder@example.org", "Intruder", "another long passphrase"),
  ]);
  const won = results.filter((r) => r.status === "fulfilled");
  assert.equal(won.length, 1);
  ownerId = won[0].value;
  assert.equal(await acc.isSetupComplete(), true);
  await assert.rejects(acc.completeSetup("late@example.org", "Late", "yet another passphrase"), /already been completed/);
});

let winnerEmail, winnerPw;

test("sign-in accepts the right password and locks an address after repeated failures, without locking the member out elsewhere", async () => {
  winnerEmail = (await asSystem((tx) => tx.query("select email from app_users where id = $1", [ownerId])))[0].email;
  winnerPw = winnerEmail === "owner@example.org" ? OWNER.pw : "another long passphrase";
  const ok = await acc.passwordSignIn(winnerEmail.toUpperCase(), winnerPw, "10.0.0.1");
  assert.deepEqual(ok, { ok: true, userId: ownerId });
  for (let i = 0; i < 8; i++) {
    const r = await acc.passwordSignIn(winnerEmail, "wrong password attempt", "10.0.0.2");
    assert.equal(r.ok, false);
  }
  // The guessing address is locked, even with the right password...
  assert.deepEqual(await acc.passwordSignIn(winnerEmail, winnerPw, "10.0.0.2"), { ok: false, reason: "locked" });
  // ...but the member can still sign in from their own address.
  assert.deepEqual(await acc.passwordSignIn(winnerEmail, winnerPw, "10.0.0.3"), { ok: true, userId: ownerId });
  assert.deepEqual(await acc.passwordSignIn("nobody@example.org", "whatever password", "10.0.0.4"), { ok: false, reason: "invalid" });
});

test("a burst of parallel guesses cannot exceed the limit", async () => {
  const results = await Promise.all(Array.from({ length: 40 }, () =>
    acc.passwordSignIn(winnerEmail, "parallel wrong guess", "10.0.0.9")));
  const checked = results.filter((r) => r.reason === "invalid").length;
  assert.ok(checked <= 8, `${checked} guesses were checked`);
  assert.ok(results.every((r) => !r.ok && ["invalid", "locked", "busy"].includes(r.reason)));
  const [{ n }] = await asSystem((tx) => tx.query(
    "select count(*)::int as n from app_login_attempts where ip = '10.0.0.9' and not succeeded and not cleared"));
  assert.ok(n <= 8);
});

test("an administrator can clear a sign-in lock", async () => {
  assert.deepEqual(await acc.passwordSignIn(winnerEmail, winnerPw, "10.0.0.2"), { ok: false, reason: "locked" });
  const viewer = { userId: ownerId, displayName: "x", email: winnerEmail, role: "admin", isFixture: false };
  assert.ok((await acc.clearSignInLock(viewer, winnerEmail)) > 0);
  assert.deepEqual(await acc.passwordSignIn(winnerEmail, winnerPw, "10.0.0.2"), { ok: true, userId: ownerId });
  await assert.rejects(acc.clearSignInLock({ ...viewer, role: "editor" }, winnerEmail), /Only administrators/);
});

test("sessions resolve to an active member; revoked and expired sessions do not", async () => {
  const s = await acc.createSession(ownerId);
  const v = await acc.viewerForToken(s.token);
  assert.equal(v.userId, ownerId);
  assert.equal(v.role, "admin");
  assert.equal(await acc.viewerForToken("not-a-token"), null);
  await acc.revokeSession(s.token);
  assert.equal(await acc.viewerForToken(s.token), null);
  const s2 = await acc.createSession(ownerId);
  await asSystem((tx) => tx.query("update app_sessions set expires_at = now() - interval '1 minute' where user_id = $1 and revoked_at is null", [ownerId]));
  assert.equal(await acc.viewerForToken(s2.token), null);
});

test("invitations are admin-only, single-use and create the invited role", async () => {
  const editorViewer = { ...ownerViewer(), role: "editor" };
  await assert.rejects(acc.createInvite(editorViewer, "e@example.org", "editor"), /Only administrators/);
  const token = await acc.createInvite(ownerViewer(), "New.Editor@Example.org", "editor");
  assert.deepEqual(await acc.inviteForToken(token), { email: "new.editor@example.org", role: "editor" });
  const newId = await acc.acceptInvite(token, "New Editor", "editor long passphrase");
  await assert.rejects(acc.acceptInvite(token, "Again", "editor long passphrase"), /expired or was already used/);
  assert.equal(await acc.inviteForToken(token), null);
  const r = await acc.passwordSignIn("new.editor@example.org", "editor long passphrase", null);
  assert.deepEqual(r, { ok: true, userId: newId });
  await assert.rejects(acc.createInvite(ownerViewer(), "new.editor@example.org", "editor"), /already exists/);
});

test("an administrator can revoke a pending invitation", async () => {
  const token = await acc.createInvite(ownerViewer(), "revoke.me@example.org", "reviewer");
  const pending = await acc.listPendingInvites(ownerViewer());
  const inv = pending.find((i) => i.email === "revoke.me@example.org");
  assert.ok(inv?.id);
  assert.equal("token_hash" in inv, false);
  await acc.revokeInvite(ownerViewer(), inv.id);
  assert.equal(await acc.inviteForToken(token), null);
  await assert.rejects(acc.acceptInvite(token, "Late", "reviewer long passphrase"), /expired or was already used/);
  await assert.rejects(acc.revokeInvite(ownerViewer(), inv.id), /already used, revoked/);
});

test("team rules: no self-changes, at least one admin, deactivation revokes sessions", async () => {
  await assert.rejects(acc.updateMember(ownerViewer(), ownerId, { role: "editor" }), /your own/);
  const team = await acc.listTeam(ownerViewer());
  const editor = team.find((m) => m.role === "editor");
  const s = await acc.createSession(editor.userId);
  await acc.updateMember(ownerViewer(), editor.userId, { active: false });
  assert.equal(await acc.viewerForToken(s.token), null);
  // Promote the editor back as an admin, then demoting the original owner is allowed only while another admin remains.
  await acc.updateMember(ownerViewer(), editor.userId, { active: true, role: "admin" });
  const otherAdmin = { userId: editor.userId, displayName: "x", email: "x", role: "admin", isFixture: false };
  const ownersInvite = await acc.createInvite(ownerViewer(), "pending.from.owner@example.org", "admin");
  await acc.updateMember(otherAdmin, ownerId, { role: "reviewer" });
  // Demoting an administrator cancels the invitations they sent.
  assert.equal(await acc.inviteForToken(ownersInvite), null);
  await assert.rejects(acc.acceptInvite(ownersInvite, "Too Late", "admin long passphrase"), /expired or was already used/);
  // The demoted owner's stale viewer object still says "admin": the database re-check refuses it.
  await assert.rejects(acc.updateMember(ownerViewer(), editor.userId, { role: "editor" }), /Only administrators/);
  await assert.rejects(acc.createInvite(ownerViewer(), "sneaky@example.org", "admin"), /Only administrators/);
  await assert.rejects(acc.listTeam(ownerViewer()), /Only administrators/);
  // The last remaining admin cannot be removed.
  await assert.rejects(acc.updateMember(otherAdmin, otherAdmin.userId, { active: false }), /your own/);
  await assert.rejects(acc.updateMember(otherAdmin, ownerId, { role: "superuser" }), /valid role/);
});

test("concurrent demotions cannot leave the team without an administrator", async () => {
  const team = await acc.listTeam({ userId: (await adminIds())[0], displayName: "x", email: "x", role: "admin", isFixture: false });
  const reviewer = team.find((m) => m.role === "reviewer" && m.active);
  const [a] = await adminIds();
  await acc.updateMember({ userId: a, displayName: "x", email: "x", role: "admin", isFixture: false }, reviewer.userId, { role: "admin" });
  const [x, y] = await adminIds();
  const as = (id) => ({ userId: id, displayName: "x", email: "x", role: "admin", isFixture: false });
  // Each admin demotes the other at the same moment: at most one change can succeed.
  const results = await Promise.allSettled([
    acc.updateMember(as(x), y, { role: "editor" }),
    acc.updateMember(as(y), x, { role: "editor" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await adminIds()).length, 1);
});

async function adminIds() {
  const rows = await asSystem((tx) => tx.query("select user_id from team_memberships where role = 'admin' and active order by user_id"));
  return rows.map((r) => r.user_id);
}

test("fixture accounts cannot sign in with a password", async () => {
  await asSystem((tx) => tx.query(
    "insert into app_users (email, display_name, is_fixture) values ('fixture.x@example.org', 'Fixture X', true)"));
  assert.deepEqual(await acc.passwordSignIn("fixture.x@example.org", "anything at all here", null), { ok: false, reason: "invalid" });
});

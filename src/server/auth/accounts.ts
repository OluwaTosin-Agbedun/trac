import "server-only";
// Accounts, sessions, setup and invitations. Runs as the owner role through asSystem() because
// the request roles cannot see credential tables at all. Every function validates its inputs.
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { asSystem, dataMode } from "../db/index.ts";
import { hashPassword, isUuid, newToken, sha256Hex, verifyPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./crypto.ts";

export const SESSION_TTL_HOURS = 12;
export const INVITE_TTL_DAYS = 7;
// Sign-in limits per 15 minutes. The tight limit is per (email, address), so an attacker elsewhere
// cannot lock a member out; the per-email limit across all addresses is high and only stops a
// distributed guessing run. An administrator can clear a lock (Team page, or db.ts clear-signin-lock).
const MAX_FAILED_PER_EMAIL_AND_IP = 8;
const MAX_FAILED_PER_IP = 30;
const MAX_FAILED_PER_EMAIL = 100;
const LOCK_WINDOW_MINUTES = 15;
// Password checks are deliberately expensive; cap how many run at once so a flood cannot starve
// the server. Past the cap, attempts are refused without hashing.
const MAX_CONCURRENT_PASSWORD_CHECKS = 8;
let passwordChecksRunning = 0;

export type TeamRole = "editor" | "reviewer" | "admin";
export interface Viewer {
  userId: string;
  displayName: string;
  email: string;
  role: TeamRole;
  isFixture: boolean;
}

export class AccountError extends Error {}

/** Session-signing secret. Production requires SESSION_SECRET; locally a generated file beside the local database. */
export function sessionSecret(): string {
  const env = process.env.SESSION_SECRET;
  if (env) {
    if (env.length < 32) throw new AccountError("SESSION_SECRET must be at least 32 characters.");
    return env;
  }
  if (dataMode() !== "local") {
    throw new AccountError("Configuration required: set SESSION_SECRET (32+ random characters).");
  }
  const dir = join(homedir(), ".nigerian-university-tracker");
  const file = join(dir, "session-secret");
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, newToken() + newToken(), { mode: 0o600 });
  }
  return readFileSync(file, "utf8").trim();
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validatePassword(pw: string): string | null {
  if (pw.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (pw.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Creates a session row and returns the raw token for the cookie. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  if (!isUuid(userId)) throw new AccountError("invalid user");
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);
  await asSystem((tx) =>
    tx.query("insert into app_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)",
      [sha256Hex(token), userId, expiresAt.toISOString()]));
  return { token, expiresAt };
}

/** Resolves a raw session token to an active team member, or null. */
export async function viewerForToken(token: string): Promise<Viewer | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await asSystem((tx) =>
    tx.query<{ user_id: string; display_name: string; email: string; role: TeamRole; is_fixture: boolean }>(
      `select u.id as user_id, u.display_name, u.email, m.role, u.is_fixture
         from app_sessions s
         join app_users u on u.id = s.user_id and u.disabled_at is null
         join team_memberships m on m.user_id = u.id and m.active and m.role in ('editor', 'reviewer', 'admin')
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`,
      [sha256Hex(token)]));
  const r = rows[0];
  if (!r) return null;
  // Accounts flagged as fixtures (tests only) never work outside the local database.
  if (r.is_fixture && dataMode() !== "local") return null;
  return { userId: r.user_id, displayName: r.display_name, email: r.email, role: r.role, isFixture: r.is_fixture };
}

export async function revokeSession(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await asSystem((tx) =>
    tx.query("update app_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256Hex(token)]));
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export type SignInResult = { ok: true; userId: string } | { ok: false; reason: "invalid" | "locked" | "busy" };

export async function passwordSignIn(emailRaw: string, password: string, ip: string | null): Promise<SignInResult> {
  const email = normaliseEmail(emailRaw).slice(0, 254);
  if (passwordChecksRunning >= MAX_CONCURRENT_PASSWORD_CHECKS) return { ok: false, reason: "busy" };
  passwordChecksRunning++;
  try {
    // Count and record in one transaction under a per-email lock, before any password check: parallel
    // attempts for the same email queue here and each sees the ones before it.
    const attemptId = await asSystem(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtextextended('nut-signin:' || $1, 0))", [email]);
      const [c] = await tx.query<{ pair: number; by_email: number; by_ip: number }>(
        `select count(*) filter (where email_lower = $1 and ip is not distinct from $2::text)::int as pair,
                count(*) filter (where email_lower = $1)::int as by_email,
                count(*) filter (where $2::text is not null and ip = $2::text)::int as by_ip
           from app_login_attempts
          where not succeeded and not cleared and at > now() - make_interval(mins => $3)
            and (email_lower = $1 or ($2::text is not null and ip = $2::text))`, [email, ip, LOCK_WINDOW_MINUTES]);
      if (c.pair >= MAX_FAILED_PER_EMAIL_AND_IP || c.by_ip >= MAX_FAILED_PER_IP || c.by_email >= MAX_FAILED_PER_EMAIL) return null;
      const [row] = await tx.query<{ id: string }>(
        "insert into app_login_attempts (email_lower, ip, succeeded) values ($1, $2, false) returning id", [email, ip]);
      return row.id;
    });
    if (attemptId === null) return { ok: false, reason: "locked" };
    const [user] = await asSystem((tx) =>
      tx.query<{ id: string; password_hash: string | null }>(
        `select u.id, u.password_hash from app_users u
          where lower(u.email) = $1 and u.disabled_at is null and not u.is_fixture`, [email]));
    const ok = await verifyPassword(password, user?.password_hash ?? null);
    if (!ok || !user) return { ok: false, reason: "invalid" };
    await asSystem(async (tx) => {
      await tx.query("update app_login_attempts set succeeded = true where id = $1", [attemptId]);
      // A correct password from this address wipes its earlier mistakes.
      await tx.query(`update app_login_attempts set cleared = true
                       where email_lower = $1 and ip is not distinct from $2::text and not succeeded and not cleared`, [email, ip]);
    });
    return { ok: true, userId: user.id };
  } finally {
    passwordChecksRunning--;
  }
}

/** Lift a sign-in lock for one email address (administrators only). */
export async function clearSignInLock(admin: Viewer, emailRaw: string): Promise<number> {
  const email = normaliseEmail(emailRaw).slice(0, 254);
  return asSystem(async (tx) => {
    await assertAdmin(tx, admin);
    const rows = await tx.query(`update app_login_attempts set cleared = true
                                  where email_lower = $1 and not succeeded and not cleared returning id`, [email]);
    await tx.query(`insert into audit_events (actor_id, action, entity_type, details)
                    values ($1, 'account.signin_lock_cleared', 'app_user', $2)`, [admin.userId, JSON.stringify({ email })]);
    return rows.length;
  });
}

// ---------------------------------------------------------------------------
// One-time setup
// ---------------------------------------------------------------------------

/**
 * Outside the local database, the one-time setup needs SETUP_TOKEN: without it, whoever reached a
 * freshly deployed site first could make themselves the permanent administrator.
 */
export function setupTokenRequired(): boolean {
  return dataMode() !== "local";
}

function checkSetupToken(given: string): void {
  if (!setupTokenRequired()) return;
  const expected = process.env.SETUP_TOKEN ?? "";
  if (expected.length < 32) {
    throw new AccountError("Configuration required: set SETUP_TOKEN (32 or more random characters) on the server, then reload this page.");
  }
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  if (!timingSafeEqual(a, b)) throw new AccountError("The setup token is not correct. Nothing was saved.");
}

export async function isSetupComplete(): Promise<boolean> {
  const rows = await asSystem((tx) => tx.query("select 1 from app_settings where key = 'setup_completed'"));
  return rows.length > 0;
}

/**
 * Creates the owner account. The permanent setup flag is written first in the same transaction,
 * so two simultaneous submissions cannot both succeed and the screen can never reopen.
 */
export async function completeSetup(emailRaw: string, displayName: string, password: string, setupToken = ""): Promise<string> {
  checkSetupToken(setupToken);
  const email = normaliseEmail(emailRaw);
  const pwError = validatePassword(password);
  if (pwError) throw new AccountError(pwError);
  const hash = await hashPassword(password);
  return asSystem(async (tx) => {
    const inserted = await tx.query(
      `insert into app_settings (key, value) values ('setup_completed', $1)
       on conflict (key) do nothing returning key`, [JSON.stringify({ by: "setup" })]);
    if (!inserted.length) throw new AccountError("Setup has already been completed.");
    const [u] = await tx.query<{ id: string }>(
      "insert into app_users (email, display_name, password_hash) values ($1, $2, $3) returning id",
      [email, displayName.trim(), hash]);
    await tx.query("insert into team_memberships (user_id, role, display_name, created_by) values ($1, 'admin', $2, $1)",
      [u.id, displayName.trim()]);
    await tx.query(`insert into audit_events (actor_id, action, entity_type, entity_id, details)
                    values ($1, 'account.setup_completed', 'app_user', $1, '{}')`, [u.id]);
    return u.id;
  });
}

// ---------------------------------------------------------------------------
// Invitations and team management. Each operation re-checks, inside its own transaction, that the
// caller is still an active administrator; the Viewer object passed in is never trusted alone.
// ---------------------------------------------------------------------------

const TEAM_ROLES: readonly TeamRole[] = ["editor", "reviewer", "admin"];
type Tx = Parameters<Parameters<typeof asSystem>[0]>[0];

/** Team changes (roles, invites) run one at a time, so concurrent edits cannot remove every admin. */
async function lockTeam(tx: Tx): Promise<void> {
  await tx.query("select pg_advisory_xact_lock(hashtextextended('nut-team-changes', 0))");
}

async function assertAdmin(tx: Tx, admin: Viewer): Promise<void> {
  if (!admin || admin.role !== "admin" || !isUuid(admin.userId)) throw new AccountError("Only administrators can manage the team.");
  const [m] = await tx.query<{ ok: boolean }>(
    `select true as ok from team_memberships m join app_users u on u.id = m.user_id
      where m.user_id = $1 and m.role = 'admin' and m.active and u.disabled_at is null`, [admin.userId]);
  if (!m) throw new AccountError("Only administrators can manage the team.");
}

export async function createInvite(admin: Viewer, emailRaw: string, role: TeamRole): Promise<string> {
  if (!TEAM_ROLES.includes(role)) throw new AccountError("Choose a valid role.");
  const email = normaliseEmail(emailRaw);
  const token = newToken();
  await asSystem(async (tx) => {
    await lockTeam(tx);
    await assertAdmin(tx, admin);
    const existing = await tx.query("select 1 from app_users where lower(email) = $1", [email]);
    if (existing.length) throw new AccountError("An account with that email already exists.");
    await tx.query(
      `insert into app_invites (token_hash, email, role, invited_by, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [sha256Hex(token), email, role, admin.userId, INVITE_TTL_DAYS]);
    await tx.query(`insert into audit_events (actor_id, action, entity_type, details)
                    values ($1, 'account.invited', 'app_invite', $2)`, [admin.userId, JSON.stringify({ email, role })]);
  });
  return token;
}

export async function inviteForToken(token: string): Promise<{ email: string; role: TeamRole } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await asSystem((tx) =>
    tx.query<{ email: string; role: TeamRole }>(
      `select email, role from app_invites
        where token_hash = $1 and used_at is null and revoked_at is null and expires_at > now()`, [sha256Hex(token)]));
  return row ?? null;
}

/**
 * Single use: the invite row is claimed atomically before the account is created, and only while
 * the administrator who sent it is still an active administrator.
 */
export async function acceptInvite(token: string, displayName: string, password: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccountError("This invitation link is not valid.");
  const pwError = validatePassword(password);
  if (pwError) throw new AccountError(pwError);
  const hash = await hashPassword(password);
  return asSystem(async (tx) => {
    await lockTeam(tx);
    const [inv] = await tx.query<{ email: string; role: TeamRole; invited_by: string }>(
      `update app_invites i set used_at = now()
        where i.token_hash = $1 and i.used_at is null and i.revoked_at is null and i.expires_at > now()
          and exists (select 1 from team_memberships m join app_users u on u.id = m.user_id
                       where m.user_id = i.invited_by and m.role = 'admin' and m.active and u.disabled_at is null)
        returning i.email, i.role, i.invited_by`, [sha256Hex(token)]);
    if (!inv) throw new AccountError("This invitation link has expired or was already used.");
    const [u] = await tx.query<{ id: string }>(
      "insert into app_users (email, display_name, password_hash) values ($1, $2, $3) returning id",
      [inv.email, displayName.trim(), hash]);
    await tx.query("update app_invites set used_by = $1 where token_hash = $2", [u.id, sha256Hex(token)]);
    await tx.query("insert into team_memberships (user_id, role, display_name, created_by) values ($1, $2, $3, $4)",
      [u.id, inv.role, displayName.trim(), inv.invited_by]);
    await tx.query(`insert into audit_events (actor_id, action, entity_type, entity_id, details)
                    values ($1, 'account.invite_accepted', 'app_user', $1, $2)`, [u.id, JSON.stringify({ role: inv.role })]);
    return u.id;
  });
}

export interface TeamMember {
  userId: string; displayName: string; email: string; role: TeamRole; active: boolean; isFixture: boolean;
}

export async function listTeam(admin: Viewer): Promise<TeamMember[]> {
  const rows = await asSystem(async (tx) => {
    await assertAdmin(tx, admin);
    return tx.query<{ user_id: string; display_name: string; email: string; role: TeamRole; active: boolean; is_fixture: boolean }>(
      `select m.user_id, u.display_name, u.email, m.role, m.active and u.disabled_at is null as active, u.is_fixture
         from team_memberships m join app_users u on u.id = m.user_id
        where m.role in ('editor', 'reviewer', 'admin') order by u.display_name`);
  });
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, email: r.email, role: r.role,
    active: r.active, isFixture: r.is_fixture }));
}

export async function listPendingInvites(admin: Viewer) {
  return asSystem(async (tx) => {
    await assertAdmin(tx, admin);
    return tx.query<{ id: string; email: string; role: TeamRole; created_at: string; expires_at: string; invited_by_name: string | null }>(
      `select i.id, i.email, i.role, i.created_at, i.expires_at, u.display_name as invited_by_name
         from app_invites i left join app_users u on u.id = i.invited_by
        where i.used_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc`);
  });
}

export async function revokeInvite(admin: Viewer, inviteId: string): Promise<void> {
  if (!isUuid(inviteId)) throw new AccountError("That invitation could not be found.");
  await asSystem(async (tx) => {
    await lockTeam(tx);
    await assertAdmin(tx, admin);
    const rows = await tx.query<{ email: string }>(
      `update app_invites set revoked_at = now()
        where id = $1 and used_at is null and revoked_at is null returning email`, [inviteId]);
    if (!rows.length) throw new AccountError("That invitation was already used, revoked or has expired.");
    await tx.query(`insert into audit_events (actor_id, action, entity_type, details)
                    values ($1, 'account.invite_revoked', 'app_invite', $2)`, [admin.userId, JSON.stringify({ email: rows[0].email })]);
  });
}

/** Change a member's role or active flag. Keeps at least one active administrator. */
export async function updateMember(admin: Viewer, userId: string, change: { role?: TeamRole; active?: boolean }): Promise<void> {
  if (!isUuid(userId)) throw new AccountError("Unknown member.");
  if (change.role !== undefined && !TEAM_ROLES.includes(change.role)) throw new AccountError("Choose a valid role.");
  if (userId === admin.userId) throw new AccountError("You cannot change your own role or access.");
  await asSystem(async (tx) => {
    await lockTeam(tx);
    await assertAdmin(tx, admin);
    const [m] = await tx.query<{ role: TeamRole; active: boolean }>(
      "select role, active from team_memberships where user_id = $1 for update", [userId]);
    if (!m) throw new AccountError("Unknown member.");
    const role = change.role ?? m.role;
    const active = change.active ?? m.active;
    if (m.role === "admin" && m.active && (role !== "admin" || !active)) {
      const [n] = await tx.query<{ n: number }>(
        "select count(*)::int as n from team_memberships where role = 'admin' and active and user_id <> $1", [userId]);
      if (n.n < 1) throw new AccountError("At least one active administrator must remain.");
    }
    await tx.query("update team_memberships set role = $2, active = $3 where user_id = $1", [userId, role, active]);
    if (!active) await tx.query("update app_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
    // Someone who can no longer administer the team cannot leave working invitations behind.
    if (!active || role !== "admin") {
      await tx.query("update app_invites set revoked_at = now() where invited_by = $1 and used_at is null and revoked_at is null", [userId]);
    }
    await tx.query(`insert into audit_events (actor_id, action, entity_type, entity_id, details)
                    values ($1, 'account.member_updated', 'app_user', $2, $3)`,
      [admin.userId, userId, JSON.stringify({ role, active })]);
  });
}

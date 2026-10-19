"use server";
// Team management (administrators only). The account service re-checks, in the database, that the
// caller is still an active administrator; these actions validate every input first.
import { headers } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { AccountError, clearSignInLock, createInvite, listTeam, revokeInvite, updateMember, type TeamRole } from "@/server/auth/accounts";
import { fail, field, ok } from "@/server/actions/result";
import type { FormState } from "@/components/ui/Form";

const ROLES = ["editor", "reviewer", "admin"] as const;
const ADMIN_ONLY = "Only administrators can manage the team.";

export type InviteState = (NonNullable<FormState> & { link?: string }) | undefined;

async function origin(): Promise<string> {
  // SITE_URL (e.g. https://tracker.example.org) is preferred: request headers can be forged.
  const configured = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(configured)) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  // Only a plain host[:port] is accepted, so a forged header cannot inject a different URL shape.
  return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? `${proto === "http" ? "http" : "https"}://${host}` : "http://localhost:3000";
}

export async function inviteAction(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  const email = z.string().trim().toLowerCase().email().max(254).safeParse(field(fd, "email", 254));
  const role = field(fd, "role", 20);
  const values = { email: field(fd, "email", 254), role };
  if (!email.success) return fail("Enter a valid email address.", { email: ["Enter a valid email address."] }, values);
  if (!(ROLES as readonly string[]).includes(role)) return fail("Choose a role.", { role: ["Choose a role."] }, values);
  try {
    const token = await createInvite(viewer, email.data, role as TeamRole);
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    refresh();
    return { ok: true, message: `Invitation created for ${email.data}. Copy the link below now: it is shown only once and expires in 7 days.`,
      link: `${await origin()}${base}/admin/invite/${token}` };
  } catch (err) {
    if (err instanceof AccountError) return fail(err.message, undefined, values);
    console.error("[team] invite failed", err);
    return fail("The invitation could not be created. Nothing was saved.", undefined, values);
  }
}

export async function revokeInviteAction(inviteId: string): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  if (!isUuid(inviteId)) return fail("That invitation could not be found.");
  try {
    await revokeInvite(viewer, inviteId);
  } catch (err) {
    if (err instanceof AccountError) return fail(err.message);
    console.error("[team] revoke failed", err);
    return fail("The invitation could not be revoked.");
  }
  refresh();
  return ok("Invitation revoked. The link no longer works.");
}

export async function clearLockAction(userId: string): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  if (!isUuid(userId)) return fail("Unknown member.");
  try {
    const email = (await listTeam(viewer)).find((m) => m.userId === userId)?.email;
    if (!email) return fail("Unknown member.");
    const n = await clearSignInLock(viewer, email);
    return ok(n ? "Sign-in lock cleared." : "There was no sign-in lock to clear.");
  } catch (err) {
    if (err instanceof AccountError) return fail(err.message);
    console.error("[team] clear lock failed", err);
    return fail("The lock could not be cleared.");
  }
}


export async function updateMemberAction(userId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  if (!isUuid(userId)) return fail("Unknown member.");
  const role = field(fd, "role", 20);
  const active = field(fd, "active", 5);
  if (!(ROLES as readonly string[]).includes(role)) return fail("Choose a role.");
  if (active !== "true" && active !== "false") return fail("Choose whether the member is active.");
  try {
    await updateMember(viewer, userId, { role: role as TeamRole, active: active === "true" });
  } catch (err) {
    if (err instanceof AccountError) return fail(err.message);
    console.error("[team] update failed", err);
    return fail("The change could not be saved.");
  }
  refresh();
  return ok("Saved.");
}

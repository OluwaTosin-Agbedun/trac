import "server-only";
// Data Access Layer for identity. Pages call getViewer()/requireViewer() inside <Suspense>;
// every server action calls requireViewer() itself, because actions are public POST endpoints.
import { cache } from "react";
import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { signValue, unsignValue } from "./crypto.ts";
import { createSession, revokeSession, sessionSecret, viewerForToken, type TeamRole, type Viewer } from "./accounts.ts";

export type { TeamRole, Viewer } from "./accounts.ts";

const PRODUCTION = process.env.NODE_ENV === "production";
/** __Host- binds the cookie to this exact origin over HTTPS; plain name for http://localhost. */
export const SESSION_COOKIE = PRODUCTION ? "__Host-nut_session" : "nut_session";

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function tokenFromCookie(): Promise<string | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  return unsignValue(raw, sessionSecret());
}

/** The signed-in, active team member for this request, or null. Deduplicated per render. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  await connection(); // request-time only: never evaluated while prerendering
  const token = await tokenFromCookie();
  return token ? viewerForToken(token) : null;
});

/** Redirects to sign-in when signed out; throws ForbiddenError when the role is not allowed. */
export async function requireViewer(roles?: readonly TeamRole[]): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/admin/sign-in");
  if (roles && !roles.includes(viewer.role)) throw new ForbiddenError();
  return viewer;
}

/** For server actions: returns the viewer or null without redirecting, so actions can respond. */
export async function viewerForAction(roles?: readonly TeamRole[]): Promise<Viewer | null> {
  const token = await tokenFromCookie();
  const viewer = token ? await viewerForToken(token) : null;
  if (!viewer) return null;
  if (roles && !roles.includes(viewer.role)) return null;
  return viewer;
}

export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(SESSION_COOKIE, signValue(token, sessionSecret()), {
    httpOnly: true,
    secure: PRODUCTION,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const token = await tokenFromCookie();
  if (token) await revokeSession(token);
  (await cookies()).delete(SESSION_COOKIE);
}

/** Best-effort client address for rate limiting only; never used for authorisation. */
/**
 * The visitor's address, for sign-in limits. A visitor can put anything at the start of
 * X-Forwarded-For, so this uses CLIENT_IP_HEADER when the host names a header it sets itself
 * (for example x-vercel-forwarded-for or cf-connecting-ip), otherwise the last X-Forwarded-For
 * entry, which the proxy in front of the app appended.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const named = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  let ip = named && /^[a-z0-9-]{1,64}$/.test(named) ? h.get(named)?.split(",")[0] : undefined;
  if (!ip) ip = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  ip = ip?.trim().replace(/^\[|\]$/g, "").slice(0, 64);
  return ip && isIP(ip) ? ip : null;
}

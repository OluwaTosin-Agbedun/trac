import "server-only";
// Public data access: the verified register, the site's single public truth. Every read runs as the
// anon role through the public_register*() functions (see ./publicRegister.ts), so drafts, imports,
// notes and team names are unreachable by construction.
//
// Caching: each reader below is a "use cache" function tagged "register". Server actions that change
// what the public sees (verify, withdraw, archive, restore, visibility, settings) call
// updateTag("register"), so the change shows at once; otherwise an entry is reused for at most a
// minute. Pages still call `await connection()` before these readers: the register is never read at
// build time (the build has no database), only per request, from this cache. Arguments are plain
// strings and the database client is reached inside each function, never captured or passed in.
import { cacheLife, cacheTag } from "next/cache";
import {
  isSlug, isUuid, readRegister, readRegisterMethods, readRegisterRecord, readRegisterStatus, readRegisterVersions, readResolve,
  type PublicRegister, type RegisterMethod, type RegisterRecord, type RegisterStatus, type RegisterVersion,
} from "./publicRegister.ts";

export { isSlug, isUuid };
export type { PublicContent, PublicRegister, RegisterMethod, RegisterRecord, RegisterRow, RegisterStatus, RegisterVersion } from "./publicRegister.ts";
export type { ReportSection } from "../../lib/report.ts";

/** Every listed record, in report order. */
export async function getRegister(): Promise<PublicRegister> {
  "use cache";
  cacheTag("register");
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  return readRegister();
}

/** Whether the register is shown, and its headline facts. */
export async function getRegisterStatus(): Promise<RegisterStatus> {
  "use cache";
  cacheTag("register");
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  return readRegisterStatus();
}

async function cachedRecord(id: string): Promise<RegisterRecord | null> {
  "use cache";
  cacheTag("register");
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  return readRegisterRecord(id);
}

/** One listed record by id (null when unknown, archived or the register is hidden). */
export async function getRegisterRecord(id: string): Promise<RegisterRecord | null> {
  return isUuid(id) ? cachedRecord(id.toLowerCase()) : null;
}

async function cachedVersions(id: string): Promise<RegisterVersion[]> {
  "use cache";
  cacheTag("register");
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  return readRegisterVersions(id);
}

/** Earlier verified versions of one public record, newest first. */
export async function getRegisterVersions(id: string): Promise<RegisterVersion[]> {
  return isUuid(id) ? cachedVersions(id.toLowerCase()) : [];
}

/** Every version of the scoring rule, newest first. */
export async function getRegisterMethods(): Promise<RegisterMethod[]> {
  "use cache";
  cacheTag("register");
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  return readRegisterMethods();
}

async function cachedResolve(key: string): Promise<{ id: string; slug: string } | null> {
  "use cache";
  cacheTag("register");
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  return readResolve(key);
}

/**
 * The public register record for an address key: its own slug, an old profile slug
 * (/institutions/<institution slug>) or its id (the earlier /institutions/record/<id> address).
 * Keys are checked before the cache, so junk addresses never create cache entries.
 */
export async function resolveRegister(key: string): Promise<{ id: string; slug: string } | null> {
  const k = String(key).toLowerCase();
  return isSlug(k) || isUuid(k) ? cachedResolve(k) : null;
}

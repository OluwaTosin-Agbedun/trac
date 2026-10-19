// Pure helpers for the team-side institution directory: slug rules, GET filter parsing and the
// links that carry filters. No framework imports, no "@/" paths and only erasable TypeScript, so
// node:test can load this file directly (tests/lib/cmsDirectory.test.mjs). Safe for client code.
import { INSTITUTION_TYPES, OWNERSHIP, type InstitutionType, type Ownership } from "./indicators.ts";

/** Version-level editorial states, as in the revision_status enum. Not disclosure findings. */
export const REVISION_STATUSES = [
  "draft", "submitted", "changes_requested", "approved", "published", "superseded", "withdrawn",
] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const CMS_SORTS = ["name", "updated"] as const;
export type CmsSort = (typeof CMS_SORTS)[number];
export const CMS_SORT_LABEL: Record<CmsSort, string> = { name: "Name (A–Z)", updated: "Last updated (newest first)" };

export const CMS_PAGE_SIZE = 25;
export const CMS_PATH = "/admin/institutions";

/** Published institutions whose human verification is older than this are listed as stale. */
export const STALE_REVIEW_DAYS = 30;

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

export const SLUG_MAX = 80;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Same rule as the database check: lower-case words joined by single hyphens, at most 80 chars. */
export function isValidSlug(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= SLUG_MAX && SLUG_RE.test(s);
}

/** A suggested slug from a name: accents dropped, "&" read as "and", punctuation to hyphens. */
export function suggestSlug(name: string): string {
  const base = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, SLUG_MAX).replace(/-+$/g, "");
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** A real calendar date written YYYY-MM-DD, between 2000 and 2100. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// Directory filters (GET parameters)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "me", "none" (no editor assigned) or a team member's id. */
export type AssigneeFilter = "me" | "none" | string;

export interface CmsInstitutionFilters {
  q?: string;
  status?: RevisionStatus;
  ownership?: Ownership;
  type?: InstitutionType;
  /** A state name, or "none" for institutions whose state is not stated. */
  state?: string;
  assignee?: AssigneeFilter;
  published?: "yes" | "no";
  sort: CmsSort;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Narrow untrusted search params. Unknown values are dropped, never passed on. */
export function parseCmsInstitutionFilters(sp: SearchParams): CmsInstitutionFilters {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.trim() ? s.trim() : undefined;
  };
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined =>
    v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

  const assigneeRaw = one("assignee");
  const assignee = assigneeRaw === "me" || assigneeRaw === "none" || (assigneeRaw && UUID_RE.test(assigneeRaw))
    ? assigneeRaw.toLowerCase()
    : undefined;
  const stateRaw = one("state");
  const pageRaw = Number.parseInt(one("page") ?? "1", 10);

  return {
    q: one("q")?.slice(0, 100),
    status: pick(one("status"), REVISION_STATUSES),
    ownership: pick(one("ownership"), OWNERSHIP),
    type: pick(one("type"), INSTITUTION_TYPES),
    state: stateRaw && stateRaw.length <= 40 ? stateRaw : undefined,
    assignee,
    published: pick(one("published"), ["yes", "no"] as const),
    sort: pick(one("sort"), CMS_SORTS) ?? "name",
    page: Number.isFinite(pageRaw) && pageRaw > 0 && pageRaw < 10_000 ? pageRaw : 1,
  };
}

/** URL for the CMS directory with `change` applied over `filters`. Defaults stay out of the URL. */
export function cmsInstitutionsHref(filters: CmsInstitutionFilters, change: Partial<CmsInstitutionFilters> = {}): string {
  const f = { ...filters, ...change };
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.status) sp.set("status", f.status);
  if (f.ownership) sp.set("ownership", f.ownership);
  if (f.type) sp.set("type", f.type);
  if (f.state) sp.set("state", f.state);
  if (f.assignee) sp.set("assignee", f.assignee);
  if (f.published) sp.set("published", f.published);
  if (f.sort && f.sort !== "name") sp.set("sort", f.sort);
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  const qs = sp.toString();
  return qs ? `${CMS_PATH}?${qs}` : CMS_PATH;
}

/** True when anything narrows the list. Sort and page do not. */
export function hasCmsFilters(f: CmsInstitutionFilters): boolean {
  return Boolean(f.q || f.status || f.ownership || f.type || f.state || f.assignee || f.published);
}

/** "1–25 of 112" style range for a page of results. */
export function pageRange(page: number, pageSize: number, shown: number, total: number): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = shown === 0 ? 0 : (page - 1) * pageSize + 1;
  return { from, to: shown === 0 ? 0 : from + shown - 1, pages };
}

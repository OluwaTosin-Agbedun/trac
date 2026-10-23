import "server-only";
// Public data access. Every query runs as the anon role, which can read published_snapshots
// (non-withdrawn) and nothing else: drafts, imports and notes are unreachable by construction.
import { asPublic } from "../db/index.ts";
import type { ReportSection } from "../../lib/report.ts";
import type { RegisterContent } from "../../lib/register.ts";
import {
  ASSESSMENT_STATES, INDICATOR_KEYS, INSTITUTION_TYPES, OWNERSHIP, SUMMARY_LABELS,
  type AssessmentState, type IndicatorKey, type InstitutionType, type Ownership, type SummaryLabel,
} from "@/lib/indicators";
import type { PublishedSnapshot, SnapshotPayload } from "@/lib/snapshot";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isSlug = (s: unknown): s is string => typeof s === "string" && s.length <= 120 && SLUG_RE.test(s);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = {
  id: string; institution_id: string; slug: string; release_number: number; published_at: Date | string;
  methodology_version_id: string; is_current: boolean; payload: SnapshotPayload;
};

const COLS = "id, institution_id, slug, release_number, published_at, methodology_version_id, is_current, payload";

function toDto(r: Raw): PublishedSnapshot {
  return {
    id: r.id,
    institutionId: r.institution_id,
    slug: r.slug,
    releaseNumber: Number(r.release_number),
    publishedAt: r.published_at instanceof Date ? r.published_at.toISOString() : String(r.published_at),
    methodologyVersionId: r.methodology_version_id,
    isCurrent: r.is_current,
    payload: r.payload,
  };
}

// No sort by number of published indicators: it would read as a ranking, which the methodology rules out.
export const SORTS = ["name", "state", "recent"] as const;
export type Sort = (typeof SORTS)[number];
export const PAGE_SIZE = 25;

export interface DirectoryFilters {
  q?: string;
  ownership?: Ownership;
  type?: InstitutionType;
  state?: string;
  indicator?: IndicatorKey;
  indicatorState?: AssessmentState;
  summary?: SummaryLabel;
  sort?: Sort;
  page?: number;
}

/** Narrow untrusted search params into filters. Unknown values are dropped, never passed on. */
export function parseDirectoryFilters(sp: Record<string, string | string[] | undefined>): DirectoryFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
    v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
  const page = Number.parseInt(one("page") ?? "1", 10);
  return {
    q: one("q")?.slice(0, 100),
    ownership: pick(one("ownership"), OWNERSHIP),
    type: pick(one("type"), INSTITUTION_TYPES),
    state: one("state")?.slice(0, 40),
    indicator: pick(one("indicator"), INDICATOR_KEYS),
    indicatorState: pick(one("indicatorState"), ASSESSMENT_STATES),
    summary: pick(one("summary"), SUMMARY_LABELS),
    sort: pick(one("sort"), SORTS) ?? "name",
    page: Number.isFinite(page) && page > 0 && page < 10_000 ? page : 1,
  };
}

export async function listDirectory(f: DirectoryFilters): Promise<{ rows: PublishedSnapshot[]; total: number; page: number; pageSize: number }> {
  const where: string[] = ["is_current"];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.q) {
    const like = p(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(payload->'profile'->>'name' ilike ${like} or payload->'profile'->>'head_name' ilike ${like}
                 or payload->'profile'->>'bursar_name' ilike ${like} or payload->'profile'->>'city' ilike ${like})`);
  }
  if (f.ownership) where.push(`payload->'profile'->>'ownership' = ${p(f.ownership)}`);
  if (f.type) where.push(`payload->'profile'->>'institution_type' = ${p(f.type)}`);
  if (f.state) where.push(`payload->'profile'->>'state' = ${p(f.state)}`);
  if (f.summary) where.push(`payload->'summary'->>'label' = ${p(f.summary)}`);
  if (f.indicator) {
    where.push(`exists (select 1 from jsonb_array_elements(payload->'indicators') i
                        where i->>'key' = ${p(f.indicator)} and i->>'state' = ${p(f.indicatorState ?? "published")})`);
  }
  const order = {
    name: "payload->'profile'->>'name' asc",
    state: "payload->'profile'->>'state' asc nulls last, payload->'profile'->>'name' asc",
    recent: "published_at desc",
  }[f.sort ?? "name"];
  const page = f.page ?? 1;
  return asPublic(async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>(`select count(*)::int as n from published_snapshots where ${where.join(" and ")}`, params);
    const rows = await tx.query<Raw>(
      `select ${COLS} from published_snapshots where ${where.join(" and ")} order by ${order}
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`, params);
    return { rows: rows.map(toDto), total: n, page, pageSize: PAGE_SIZE };
  });
}

export async function getCurrentBySlug(slug: string): Promise<PublishedSnapshot | null> {
  if (!isSlug(slug)) return null;
  const rows = await asPublic((tx) => tx.query<Raw>(`select ${COLS} from published_snapshots where slug = $1 and is_current`, [slug]));
  return rows[0] ? toDto(rows[0]) : null;
}

/** All public (non-withdrawn) releases for an institution, newest first. */
export async function getHistory(institutionId: string): Promise<PublishedSnapshot[]> {
  if (!UUID_RE.test(institutionId)) return [];
  const rows = await asPublic((tx) =>
    tx.query<Raw>(`select ${COLS} from published_snapshots where institution_id = $1 order by release_number desc`, [institutionId]));
  return rows.map(toDto);
}

export async function getRelease(slug: string, releaseNumber: number): Promise<PublishedSnapshot | null> {
  if (!isSlug(slug) || !Number.isInteger(releaseNumber) || releaseNumber < 1) return null;
  const rows = await asPublic((tx) =>
    tx.query<Raw>(`select ${COLS} from published_snapshots where slug = $1 and release_number = $2`, [slug, releaseNumber]));
  return rows[0] ? toDto(rows[0]) : null;
}

export const COMPARE_MAX = 4;

export async function getCurrentBySlugs(slugs: string[]): Promise<PublishedSnapshot[]> {
  const clean = Array.from(new Set(slugs.filter(isSlug))).slice(0, COMPARE_MAX);
  if (!clean.length) return [];
  const rows = await asPublic((tx) =>
    tx.query<Raw>(`select ${COLS} from published_snapshots where is_current and slug = any($1::text[])`, [clean]));
  const bySlug = new Map(rows.map((r) => [r.slug, toDto(r)]));
  return clean.map((s) => bySlug.get(s)).filter((x): x is PublishedSnapshot => Boolean(x));
}

/** Lightweight list for pickers (compare). */
export async function listPublishedNames(): Promise<{ slug: string; name: string; state: string | null }[]> {
  return asPublic((tx) =>
    tx.query<{ slug: string; name: string; state: string | null }>(
      `select slug, payload->'profile'->>'name' as name, payload->'profile'->>'state' as state
         from published_snapshots where is_current order by 2`));
}

export async function listStatesInRelease(): Promise<string[]> {
  const rows = await asPublic((tx) =>
    tx.query<{ s: string }>(`select distinct payload->'profile'->>'state' as s from published_snapshots
                              where is_current and payload->'profile'->>'state' is not null order by 1`));
  return rows.map((r) => r.s);
}

export interface OverviewStats {
  institutions: number;
  indicatorsPublished: number;
  incomplete: number;
  lastPublishedAt: string | null;
  periods: string[];
  byCategory: { ownership: string; type: string; count: number }[];
  byLabel: { label: SummaryLabel; count: number }[];
}

/** Headline counts from current, non-withdrawn releases only. */
export async function getOverviewStats(): Promise<OverviewStats> {
  return asPublic(async (tx) => {
    const [t] = await tx.query<{ institutions: number; published: number; incomplete: number; last: Date | string | null; periods: string[] | null }>(
      `select count(*)::int as institutions,
              coalesce(sum((payload->'summary'->>'published')::int), 0)::int as published,
              count(*) filter (where payload->'summary'->>'label' in ('not_assessed', 'assessment_incomplete'))::int as incomplete,
              max(published_at) as last,
              array_remove(array_agg(distinct payload->'profile'->>'assessment_period'), null) as periods
         from published_snapshots where is_current`);
    const byCategory = await tx.query<{ ownership: string; type: string; count: number }>(
      `select payload->'profile'->>'ownership' as ownership, payload->'profile'->>'institution_type' as type, count(*)::int as count
         from published_snapshots where is_current group by 1, 2 order by 1, 2`);
    const byLabel = await tx.query<{ label: SummaryLabel; count: number }>(
      `select payload->'summary'->>'label' as label, count(*)::int as count
         from published_snapshots where is_current group by 1 order by 2 desc`);
    return {
      institutions: t.institutions,
      indicatorsPublished: t.published,
      incomplete: t.incomplete,
      lastPublishedAt: t.last ? (t.last instanceof Date ? t.last.toISOString() : String(t.last)) : null,
      periods: t.periods ?? [],
      byCategory,
      byLabel,
    };
  });
}

/** Every current release, for the public CSV. */
export async function listAllCurrent(): Promise<PublishedSnapshot[]> {
  const rows = await asPublic((tx) =>
    tx.query<Raw>(`select ${COLS} from published_snapshots where is_current order by payload->'profile'->>'name'`));
  return rows.map(toDto);
}

// ---------------------------------------------------------------------------
// The public compliance report: the spreadsheet an administrator chose to show (federal rows only)
// ---------------------------------------------------------------------------


export type { ReportSection };

// ---------------------------------------------------------------------------
// The verified register: what the public report shows. Only a second person's verified copy of a
// record is public; until then a record has verified = null ("Verification in progress").
// ---------------------------------------------------------------------------

export interface RegisterRow {
  id: string;
  section: ReportSection;
  name: string;
  state: string | null;
  verified: RegisterContent | null;
  verifiedAt: string | null;
}

export interface PublicRegister {
  rows: RegisterRow[];
  reportedAsOf: string | null;
}

export async function getRegister(): Promise<PublicRegister> {
  const rows = await asPublic((tx) => tx.query<{
    id: string; section: ReportSection; name: string; state: string | null; verified: RegisterContent | null;
    verified_at: Date | string | null; reported_as_of: Date | string | null;
  }>("select id, section, name, state, verified, verified_at, reported_as_of from public_register()"));
  const iso = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.toISOString() : String(v));
  return {
    rows: rows.map((r) => ({
      id: r.id, section: r.section, name: r.name, state: r.state?.trim() || null, verified: r.verified, verifiedAt: iso(r.verified_at),
    })),
    reportedAsOf: iso(rows[0]?.reported_as_of ?? null)?.slice(0, 10) ?? null,
  };
}

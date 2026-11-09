import "server-only";
// The verified register as anyone may read it: plain, uncached reads. Every query runs as the anon
// role, which can execute only the public_register*() functions (db/migrations/0016). They return a
// record's verified copy (or, before its first verification, the name, state and category it was
// imported with), never a working copy, a note or a member's name; archived records and a hidden
// register return nothing.
//
// Pages use the cached readers in ./public.ts. This file has no Next imports so the tests can run it.
import { asPublic } from "../db/index.ts";
import type { ReportSection } from "../../lib/report.ts";
import type { RegisterContent } from "../../lib/register.ts";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A record's readable address part: lower-case words joined by single hyphens. */
export const isSlug = (s: unknown): s is string => typeof s === "string" && s.length <= 120 && SLUG_RE.test(s);
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** The verified content the public sees, including where the head and bursar names were found. */
export type PublicContent = RegisterContent & { people_source_url?: string | null };

export interface RegisterRow {
  id: string;
  /** Stable, readable address: /institutions/<slug>. */
  slug: string;
  section: ReportSection;
  name: string;
  state: string | null;
  /** The second person's verified copy, or null while verification is in progress. */
  verified: PublicContent | null;
  verifiedAt: string | null;
  /** The scoring-rule version and assessment year the record was verified under (score it with these). */
  verifiedMethod: string | null;
  verifiedAssessmentYear: number | null;
}

export interface PublicRegister {
  rows: RegisterRow[];
  reportedAsOf: string | null;
  /** The current assessment year (records are scored with their own verifiedAssessmentYear). */
  assessmentYear: number | null;
}

export interface RegisterRecord {
  row: RegisterRow;
  /** The current assessment year in the register settings. */
  assessmentYear: number | null;
}

export interface RegisterStatus {
  /** False when an administrator has hidden the register: say so, never show zeros. */
  visible: boolean;
  listed: number;
  verified: number;
  lastVerifiedAt: string | null;
  reportedAsOf: string | null;
  assessmentYear: number | null;
}

export interface RegisterVersion {
  verifiedAt: string;
  supersededAt: string;
  verifiedMethod: string | null;
  assessmentYear: number | null;
  content: PublicContent;
}

export interface RegisterMethod {
  version: string;
  effectiveOn: string;
  summary: string;
}

type RawRow = {
  id: string; slug: string; section: ReportSection; name: string; state: string | null; verified: PublicContent | null;
  verified_at: Date | string | null; verified_method: string | null; verified_assessment_year: number | null;
  reported_as_of: Date | string | null; assessment_year: number | null;
};

// Calendar dates are read as text: drivers turn a date into a midnight timestamp in different zones.
const ROW_COLS = `id, slug, section, name, state, verified, verified_at, verified_method, verified_assessment_year,
                  reported_as_of::text as reported_as_of, assessment_year`;

const isoOrNull = (v: Date | string | null | undefined) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const dateOrNull = (v: Date | string | null | undefined) => isoOrNull(v)?.slice(0, 10) ?? null;
const yearOrNull = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

function toRow(r: RawRow): RegisterRow {
  return {
    id: r.id, slug: r.slug, section: r.section, name: r.name, state: r.state?.trim() || null, verified: r.verified,
    verifiedAt: isoOrNull(r.verified_at), verifiedMethod: r.verified_method, verifiedAssessmentYear: yearOrNull(r.verified_assessment_year),
  };
}

/** Every listed record, in report order. */
export async function readRegister(): Promise<PublicRegister> {
  const rows = await asPublic((tx) => tx.query<RawRow>(`select ${ROW_COLS} from public_register()`));
  return {
    rows: rows.map(toRow),
    reportedAsOf: dateOrNull(rows[0]?.reported_as_of),
    assessmentYear: yearOrNull(rows[0]?.assessment_year),
  };
}

/** One listed record by id, without sending the whole register over the wire. */
export async function readRegisterRecord(id: string): Promise<RegisterRecord | null> {
  if (!isUuid(id)) return null;
  const [r] = await asPublic((tx) => tx.query<RawRow>(`select ${ROW_COLS} from public_register() where id = $1`, [id.toLowerCase()]));
  return r ? { row: toRow(r), assessmentYear: yearOrNull(r.assessment_year) } : null;
}

/**
 * The public record for an address key: its own slug, an old profile slug (/institutions/<institution
 * slug>) or its id (the earlier /institutions/record/<id> address). Null for anything else.
 */
export async function readResolve(key: string): Promise<{ id: string; slug: string } | null> {
  if (!isSlug(key) && !isUuid(key)) return null;
  const [row] = await asPublic((tx) => tx.query<{ id: string; slug: string }>("select id, slug from public_register_resolve($1)", [key]));
  return row ?? null;
}

export async function readRegisterStatus(): Promise<RegisterStatus> {
  const [r] = await asPublic((tx) => tx.query<{
    visible: boolean; listed: number; verified: number; last_verified_at: Date | string | null; reported_as_of: Date | string | null;
    assessment_year: number | null;
  }>(`select visible, listed, verified, last_verified_at, reported_as_of::text as reported_as_of, assessment_year
     from public_register_status()`));
  return {
    visible: Boolean(r?.visible), listed: Number(r?.listed ?? 0), verified: Number(r?.verified ?? 0),
    lastVerifiedAt: isoOrNull(r?.last_verified_at), reportedAsOf: dateOrNull(r?.reported_as_of),
    assessmentYear: yearOrNull(r?.assessment_year),
  };
}

/** Earlier verified versions of one public record, newest first (content only, never the reasons). */
export async function readRegisterVersions(id: string): Promise<RegisterVersion[]> {
  if (!isUuid(id)) return [];
  const rows = await asPublic((tx) => tx.query<{
    verified_at: Date | string; superseded_at: Date | string; verified_method: string | null; assessment_year: number | null; content: PublicContent;
  }>("select verified_at, superseded_at, verified_method, assessment_year, content from public_register_versions($1)", [id.toLowerCase()]));
  return rows.map((r) => ({ verifiedAt: isoOrNull(r.verified_at)!, supersededAt: isoOrNull(r.superseded_at)!,
    verifiedMethod: r.verified_method, assessmentYear: yearOrNull(r.assessment_year), content: r.content }));
}

/** Every version of the scoring rule, newest first. */
export async function readRegisterMethods(): Promise<RegisterMethod[]> {
  const rows = await asPublic((tx) => tx.query<{ version: string; effective_on: Date | string; summary: string }>(
    "select version, effective_on::text as effective_on, summary from public_register_methods()"));
  return rows.map((r) => ({ version: r.version, effectiveOn: dateOrNull(r.effective_on)!, summary: r.summary }));
}

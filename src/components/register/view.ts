// Pure helpers shared by the public register pages: reporting-year notes, the list's search and
// sort, and the comparison's basis check. Relative imports only, so tests/lib can run this file.
import { INDICATORS } from "../../lib/indicators.ts";
import { REPORT_SECTIONS, type ReportSection } from "../../lib/report.ts";
import {
  INDICATOR_LAG, expectedYear, isOutdated, scoreRecord, statusInfo,
  type Assessment, type RecordScore, type RegisterContent,
} from "../../lib/register.ts";

/** The parts of a register row these helpers read (RegisterRow from the data layer fits). */
export interface RowLike {
  id: string;
  slug: string;
  section: ReportSection;
  name: string;
  state: string | null;
  verified: RegisterContent | null;
  verifiedAt: string | null;
  verifiedMethod: string | null;
  verifiedAssessmentYear: number | null;
}

/** A link we are willing to render: http(s) only, no spaces or markup characters. */
export function httpUrl(u: string | null | undefined): string | null {
  const s = (u ?? "").trim();
  return s.length <= 2000 && /^https?:\/\/[^\s<>"'`]+$/i.test(s) ? s : null;
}

export function hostOf(u: string | null | undefined): string | null {
  const s = httpUrl(u);
  if (!s) return null;
  try {
    return new URL(s).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** One record's score under the rule and assessment year it was verified with. */
export function scoreRow(row: Pick<RowLike, "verified" | "verifiedAssessmentYear">): RecordScore | null {
  return row.verified ? scoreRecord(row.verified.assessments, row.verifiedAssessmentYear) : null;
}

/** The period an indicator's evidence should cover, in words. */
export function periodWords(key: string): string {
  return key in INDICATOR_LAG && INDICATOR_LAG[key as keyof typeof INDICATOR_LAG] === 1 ? "Previous year" : "Current year";
}

export interface FindingYear {
  /** The reporting year as recorded ("2025", "2024/2025"), or null. */
  year: string | null;
  /** True when the evidence covers a year before the indicator's period: it counts 0. */
  outdated: boolean;
  /** The earliest year the evidence may cover, or null when no assessment year applies. */
  expected: number | null;
  /** Plain words for an outdated finding: "Published for 2024; the period is 2026". */
  note: string | null;
}

export function findingYear(key: string, a: Partial<Assessment> | null | undefined, assessmentYear: number | null | undefined): FindingYear {
  const year = a?.year?.trim() || null;
  const expected = expectedYear(key, assessmentYear);
  const outdated = isOutdated(key, a, assessmentYear);
  return {
    year,
    outdated,
    expected,
    note: outdated && year && expected !== null ? `${statusInfo(a?.status).label} for ${year}; the period is ${expected}` : null,
  };
}

// ---------------------------------------------------------------------------
// The institutions list
// ---------------------------------------------------------------------------

export const LIST_SORTS = [
  { value: "name", label: "Name (A to Z)" },
  { value: "state", label: "State (A to Z)" },
] as const;
export type ListSort = (typeof LIST_SORTS)[number]["value"];

export interface ListParams {
  /** The category tab (used when there is no search). */
  section: ReportSection;
  /** Lower-cased search text; a search covers every category. */
  q: string;
  /** The search text as typed, for the input. */
  qRaw: string;
  state: string;
  verifiedOnly: boolean;
  sort: ListSort;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

/** Narrow untrusted search params. Unknown values fall back to defaults, never pass through. */
export function parseListParams(sp: Params): ListParams {
  const qRaw = one(sp.q).slice(0, 100);
  const sort = one(sp.sort);
  return {
    section: (REPORT_SECTIONS.find((s) => s.key === one(sp.section))?.key ?? REPORT_SECTIONS[0].key),
    q: qRaw.toLowerCase(),
    qRaw,
    state: one(sp.state).slice(0, 60),
    verifiedOnly: one(sp.verified) === "1",
    sort: LIST_SORTS.some((s) => s.value === sort) ? (sort as ListSort) : "name",
  };
}

/** The rows a list view shows: search and filters, then the chosen order. Section is applied by the caller. */
export function filterRows<T extends RowLike>(rows: T[], p: Pick<ListParams, "q" | "state" | "verifiedOnly" | "sort">): T[] {
  const words = p.q.split(/\s+/).filter(Boolean);
  const matches = (r: T) => {
    const hay = `${r.name} ${r.state ?? ""} ${r.verified?.head_name ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const out = rows.filter((r) => (!words.length || matches(r)) && (!p.state || r.state === p.state) && (!p.verifiedOnly || r.verified));
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "en");
  return out.sort(p.sort === "state"
    ? (a, b) => (a.state ?? "￿").localeCompare(b.state ?? "￿", "en") || byName(a, b)
    : byName);
}

export function countBySection<T extends Pick<RowLike, "section">>(rows: T[]): Record<ReportSection, number> {
  const counts = Object.fromEntries(REPORT_SECTIONS.map((s) => [s.key, 0])) as Record<ReportSection, number>;
  for (const r of rows) if (r.section in counts) counts[r.section]++;
  return counts;
}

export function statesIn<T extends Pick<RowLike, "state">>(rows: T[]): string[] {
  return [...new Set(rows.map((r) => r.state).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b, "en"));
}

/** The list's address with the given params; empty values are left out. */
export function listHref(p: Partial<{ section: string; q: string; state: string; verified: boolean; sort: string }>, hash = ""): string {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.section) qs.set("section", p.section);
  if (p.state) qs.set("state", p.state);
  if (p.verified) qs.set("verified", "1");
  if (p.sort && p.sort !== "name") qs.set("sort", p.sort);
  const s = qs.toString();
  return `/institutions${s ? `?${s}` : ""}${hash}`;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export const COMPARE_MAX = 4;

export function compareHref(slugs: string[]): string {
  return slugs.length ? `/compare?i=${slugs.map(encodeURIComponent).join(",")}` : "/compare";
}

/**
 * Differences in basis between verified records, stated before the table: a different assessment
 * year moves every indicator's expected period; a different rule version may score differently.
 */
export function compareDifferences(rows: Pick<RowLike, "name" | "verifiedAssessmentYear" | "verifiedMethod">[]): string[] {
  const out: string[] = [];
  const list = (pick: (r: (typeof rows)[number]) => string) => rows.map((r) => `${r.name} (${pick(r)})`).join(", ");
  const years = new Set(rows.map((r) => r.verifiedAssessmentYear ?? null));
  if (years.size > 1) {
    out.push(`They were checked for different assessment years: ${list((r) => (r.verifiedAssessmentYear ? String(r.verifiedAssessmentYear) : "no year set"))}. The year each indicator should cover differs with it.`);
  }
  const methods = new Set(rows.map((r) => r.verifiedMethod ?? null));
  if (methods.size > 1) {
    out.push(`They were scored under different versions of the scoring rule: ${list((r) => (r.verifiedMethod ? `rule ${r.verifiedMethod}` : "version not recorded"))}. See How we score for what changed.`);
  }
  return out;
}

/** Indicators in their published groups, for tables that show a heading per group. */
export const INDICATOR_GROUPS_IN_ORDER = INDICATORS.reduce<{ group: string; items: (typeof INDICATORS)[number][] }[]>((acc, ind) => {
  const last = acc[acc.length - 1];
  if (last && last.group === ind.group) last.items.push(ind);
  else acc.push({ group: ind.group, items: [ind] });
  return acc;
}, []);

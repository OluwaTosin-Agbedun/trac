// Pure helpers for comparing published releases and for placing evidence against an assessment
// period. No framework imports, no "@/" paths and only erasable TypeScript, so node:test can load
// this file directly (tests/lib/compare.test.mjs).
//
// The rule throughout: never imply that two findings are equivalent. When a basis cannot be shown
// to be the same (different or unstated periods, methodology, applicability), say so.
import { PERIOD_TYPE_LABEL, type PeriodType } from "./indicators.ts";
import { formatCalendarDate } from "./format.ts";

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** Lower-cased, trimmed, single-spaced; "2024-2025" and "2024–25" become "2024/2025". */
export function normalisePeriodLabel(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null;
  const s = String(label)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(19|20)(\d{2})\s*[/\-–—]\s*(\d{2,4})\b/g, (_m, c: string, y: string, second: string) => {
      const first = Number(`${c}${y}`);
      const end = expandSecondYear(first, second);
      return end === null ? `${c}${y}/${second}` : `${first}/${end}`;
    });
  return s || null;
}

function expandSecondYear(first: number, second: string): number | null {
  if (second.length === 4) return Number(second);
  if (second.length === 2) {
    const century = Math.floor(first / 100) * 100;
    let y = century + Number(second);
    if (y < first) y += 100;
    return y;
  }
  return null;
}

export interface YearSpan {
  from: number;
  to: number;
}

/**
 * The calendar years a period label mentions, as a span. "FY 2025" → 2025–2025,
 * "2024/2025" or "2024/25" → 2024–2025, "2020–2024 plan" → 2020–2024. No year → null.
 */
export function periodYears(label: string | null | undefined): YearSpan | null {
  if (!label) return null;
  const years: number[] = [];
  const re = /\b((?:19|20)\d{2})(?:\s*[/\-–—]\s*(\d{4}|\d{2})\b)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(label))) !== null) {
    const first = Number(m[1]);
    years.push(first);
    if (m[2]) {
      const end = expandSecondYear(first, m[2]);
      if (end !== null && end >= first && end - first <= 50) years.push(end);
    }
  }
  if (!years.length) return null;
  return { from: Math.min(...years), to: Math.max(...years) };
}

export type PeriodCoverage = "in_period" | "historical" | "later" | "unknown";

/**
 * Where a document or indicator period sits against the assessment period, by the years each
 * label states. Overlapping years count as in period (a 2024/2025 session overlaps FY 2025);
 * entirely earlier years are historical; anything without a readable year is unknown.
 */
export function periodCoverage(period: string | null | undefined, assessmentPeriod: string | null | undefined): PeriodCoverage {
  const p = periodYears(period);
  const a = periodYears(assessmentPeriod);
  if (!p || !a) return "unknown";
  if (p.to < a.from) return "historical";
  if (p.from > a.to) return "later";
  return "in_period";
}

export interface PeriodParts {
  period_type: string | null;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
}

/** True when nothing usable about the period is recorded. */
export function periodIsUnknown(p: PeriodParts): boolean {
  const label = normalisePeriodLabel(p.period_label);
  return !label && (!p.period_type || p.period_type === "unknown") && !p.period_start && !p.period_end;
}

const typeLabel = (t: string | null) =>
  t && t in PERIOD_TYPE_LABEL ? PERIOD_TYPE_LABEL[t as PeriodType] : null;

/** Human description, e.g. "2025 (Financial year)" or "2025 (Financial year, 1 Jan 2025 to 31 Dec 2025)". */
export function describePeriod(p: PeriodParts, withDates = false): string {
  if (periodIsUnknown(p)) return "period not stated";
  const label = p.period_label?.trim() || null;
  const kind = typeLabel(p.period_type);
  const dates =
    withDates && (p.period_start || p.period_end)
      ? `${p.period_start ? formatCalendarDate(p.period_start) : "start not stated"} to ${p.period_end ? formatCalendarDate(p.period_end) : "end not stated"}`
      : null;
  const extra = [kind, dates].filter(Boolean).join(", ");
  if (label) return extra ? `${label} (${extra})` : label;
  return extra || "period not stated";
}

const periodBasisKey = (p: PeriodParts) =>
  `${p.period_type ?? "?"}|${normalisePeriodLabel(p.period_label) ?? "?"}`;
const periodFullKey = (p: PeriodParts) =>
  `${periodBasisKey(p)}|${p.period_start ?? ""}|${p.period_end ?? ""}`;

// ---------------------------------------------------------------------------
// Selection (?i=a,b or ?i=a&i=b)
// ---------------------------------------------------------------------------

export interface CompareSelection {
  slugs: string[];
  /** More valid institutions were asked for than can be compared at once. */
  truncated: boolean;
  /** Entries that were not valid slugs (dropped, never echoed). */
  invalid: number;
}

export function parseCompareSelection(
  raw: string | string[] | undefined | null,
  max: number,
  isValid: (s: string) => boolean,
): CompareSelection {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalid = 0;
  for (const p of parts) {
    if (!isValid(p)) {
      invalid += 1;
      continue;
    }
    if (seen.has(p)) continue;
    seen.add(p);
    valid.push(p);
  }
  return { slugs: valid.slice(0, Math.max(0, max)), truncated: valid.length > max, invalid };
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

export interface CompareIndicatorInput extends PeriodParts {
  key: string;
  label: string;
  state: string;
}

export interface CompareInstitutionInput {
  slug: string;
  name: string;
  assessmentPeriod: string | null;
  methodologyVersionId: string;
  indicators: CompareIndicatorInput[];
}

export type CompatibilityKind =
  | "assessment_period_mixed"
  | "assessment_period_unknown"
  | "methodology_differs"
  | "indicator_period_differs"
  | "indicator_period_unknown"
  | "applicability_differs";

export interface CompatibilityWarning {
  kind: CompatibilityKind;
  /** Set for indicator-level warnings. */
  indicatorKey?: string;
  message: string;
}

export type IndicatorFlag = "period_differs" | "period_unknown" | "applicability_differs";

export interface CompatibilityReport {
  /** True only when no basis problem was detected; still not a claim of equivalence. */
  sameBasis: boolean;
  warnings: CompatibilityWarning[];
  indicatorFlags: Record<string, IndicatorFlag[]>;
}

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** States whose finding rests on dated evidence, so an unstated period matters. */
const EVIDENCED_STATES = new Set(["published", "uncertain"]);

/**
 * Every reason the selected releases are not being compared on the same basis.
 * Fewer than two institutions → nothing to compare, no warnings.
 */
export function compareCompatibility(items: CompareInstitutionInput[]): CompatibilityReport {
  const warnings: CompatibilityWarning[] = [];
  const indicatorFlags: Record<string, IndicatorFlag[]> = {};
  const flag = (key: string, f: IndicatorFlag) => {
    const list = (indicatorFlags[key] ??= []);
    if (!list.includes(f)) list.push(f);
  };
  if (items.length < 2) return { sameBasis: true, warnings, indicatorFlags };

  // Assessment periods.
  const unstated = items.filter((i) => !normalisePeriodLabel(i.assessmentPeriod));
  if (unstated.length) {
    warnings.push({
      kind: "assessment_period_unknown",
      message: `No assessment period is stated for ${listNames(unstated.map((i) => i.name))}.`,
    });
  }
  const stated = items.filter((i) => normalisePeriodLabel(i.assessmentPeriod));
  if (new Set(stated.map((i) => normalisePeriodLabel(i.assessmentPeriod))).size > 1) {
    warnings.push({
      kind: "assessment_period_mixed",
      message: `Assessment periods differ: ${stated.map((i) => `${i.name} (${String(i.assessmentPeriod).trim()})`).join("; ")}.`,
    });
  }

  // Methodology versions.
  if (new Set(items.map((i) => i.methodologyVersionId)).size > 1) {
    warnings.push({
      kind: "methodology_differs",
      message: `Different methodology versions were used: ${items.map((i) => `${i.name} (${i.methodologyVersionId})`).join("; ")}.`,
    });
  }

  // Indicator by indicator, in the order of the first institution's indicators plus any others.
  const keys: { key: string; label: string }[] = [];
  for (const inst of items) {
    for (const ind of inst.indicators) {
      if (!keys.some((k) => k.key === ind.key)) keys.push({ key: ind.key, label: ind.label });
    }
  }

  for (const { key, label } of keys) {
    const rows = items.map((inst) => ({ inst, ind: inst.indicators.find((x) => x.key === key) ?? null }));

    // Applicability: excluded for some, not for others (a missing indicator is not "applicable").
    const excluded = rows.filter((r) => r.ind?.state === "not_applicable").map((r) => r.inst.name);
    const included = rows.filter((r) => r.ind && r.ind.state !== "not_applicable").map((r) => r.inst.name);
    if (excluded.length && included.length) {
      flag(key, "applicability_differs");
      warnings.push({
        kind: "applicability_differs",
        indicatorKey: key,
        message: `${label}: excluded as not applicable for ${listNames(excluded)}, but treated as applicable for ${listNames(included)}.`,
      });
    }

    // Periods: compare every finding that states a period; flag evidenced findings that do not.
    const dated = rows.filter((r): r is { inst: CompareInstitutionInput; ind: CompareIndicatorInput } =>
      Boolean(r.ind) && r.ind?.state !== "not_applicable" && !periodIsUnknown(r.ind as CompareIndicatorInput));
    const undated = rows.filter((r) => r.ind && EVIDENCED_STATES.has(r.ind.state) && periodIsUnknown(r.ind));
    if (undated.length) {
      flag(key, "period_unknown");
      warnings.push({
        kind: "indicator_period_unknown",
        indicatorKey: key,
        message: `${label}: the reporting period is not stated for ${listNames(undated.map((r) => r.inst.name))}.`,
      });
    }
    const fullKeys = new Set(dated.map((r) => periodFullKey(r.ind)));
    if (fullKeys.size > 1) {
      const basisKeys = new Set(dated.map((r) => periodBasisKey(r.ind)));
      const withDates = basisKeys.size < fullKeys.size;
      flag(key, "period_differs");
      warnings.push({
        kind: "indicator_period_differs",
        indicatorKey: key,
        message: `${label}: reporting periods differ: ${dated.map((r) => `${r.inst.name}, ${describePeriod(r.ind, withDates)}`).join("; ")}.`,
      });
    }
  }

  return { sameBasis: warnings.length === 0, warnings, indicatorFlags };
}

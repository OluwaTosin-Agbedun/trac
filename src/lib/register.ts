// The verified register: assessment statuses and the one scoring rule. Every figure on the public
// site and in the CMS (each institution's label and score, and the headline totals) comes from
// scoreRecord(), and the "How we score" page is generated from these same constants.
import { INDICATORS, type IndicatorKey } from "./indicators.ts";

export type AssessmentStatus = "published" | "partial" | "not_found" | "inaccessible" | "nil" | "not_applicable" | "not_assessed";

export interface StatusInfo {
  value: AssessmentStatus;
  label: string;
  /** What the status means, shown in the key and on the scoring page. */
  meaning: string;
  /** Points towards the score; null when the indicator does not count (excluded or not yet decided). */
  credit: number | null;
  tone: "ok" | "partial" | "danger" | "muted" | "warn";
}

export const ASSESSMENT_STATUSES: StatusInfo[] = [
  { value: "published", label: "Published", meaning: "The institution publishes this information on its official website for the stated year.", credit: 1, tone: "ok" },
  { value: "nil", label: "Explicitly nil", meaning: "The institution states the amount is nil (for example, no endowment fund). A stated nil is a disclosure, not a gap.", credit: 1, tone: "ok" },
  { value: "partial", label: "Partially published", meaning: "Some of the information is published, but it is incomplete (for example, one year or part of the budget only).", credit: 0.5, tone: "partial" },
  { value: "not_found", label: "Not found", meaning: "The research team checked the official website and documents on the date shown and did not find it.", credit: 0, tone: "danger" },
  { value: "inaccessible", label: "Temporarily inaccessible", meaning: "The website or document could not be reached when checked. It is checked again; it does not count for or against the institution.", credit: null, tone: "warn" },
  { value: "not_applicable", label: "Not applicable", meaning: "The indicator does not apply to this institution, with a stated reason (for example, no postgraduate programmes).", credit: null, tone: "muted" },
  { value: "not_assessed", label: "Not yet assessed", meaning: "The research team has not completed this check.", credit: null, tone: "muted" },
];

export const statusInfo = (s: string | null | undefined): StatusInfo =>
  ASSESSMENT_STATUSES.find((x) => x.value === s) ?? ASSESSMENT_STATUSES[ASSESSMENT_STATUSES.length - 1];

export interface Assessment {
  status: AssessmentStatus;
  year: string | null;
  evidence_url: string | null;
  checked_on: string | null;
  note: string | null;
}

export interface RegisterContent {
  name: string;
  section: string;
  state: string | null;
  head_name: string | null;
  bursar_name: string | null;
  homepage_url: string | null;
  disclosure_url: string | null;
  extra_links: { label: string; url: string }[];
  assessments: Record<string, Assessment>;
}

export type RecordLabel = "fully_disclosed" | "partially_disclosed" | "none_found" | "incomplete" | "no_applicable";

export const RECORD_LABELS: { value: RecordLabel; label: string; rule: string; className: string }[] = [
  { value: "fully_disclosed", label: "Fully disclosed", rule: "Every applicable indicator is published or explicitly nil, for the year it should cover.", className: "border-[#b7dcc5] bg-ok-bg text-ok" },
  { value: "partially_disclosed", label: "Partially disclosed", rule: "Some, but not all, applicable indicators are published, partially published or explicitly nil.", className: "border-warn-rule bg-warn-bg text-warn-text" },
  { value: "none_found", label: "No disclosures found", rule: "Every applicable indicator was checked and nothing was found for the year it should cover.", className: "border-[#e8b4b4] bg-danger-bg text-danger" },
  { value: "incomplete", label: "Assessment incomplete", rule: "At least one indicator is not yet assessed or was temporarily inaccessible, so no overall label is given yet.", className: "border-rule bg-surface text-muted" },
  { value: "no_applicable", label: "No applicable indicators", rule: "Every indicator was excluded as not applicable, each with a reason.", className: "border-rule bg-surface text-muted" },
];

export const recordLabel = (v: RecordLabel) => RECORD_LABELS.find((l) => l.value === v)!;

/**
 * The scoring rule's version. It must equal the latest row of register_methods (migration 0016):
 * each verification stores the version it was checked under. Change the rule, change the version.
 */
export const REGISTER_METHOD = { version: "2026.1", effectiveOn: "2026-11-06" } as const;

/**
 * How many years before the assessment year an indicator's evidence may cover, from the directive:
 * the budget and TETFund allocation for the current year, research grants and the endowment for the
 * previous year. Student numbers follow the academic session, so the previous year also counts.
 */
export const INDICATOR_LAG: Record<IndicatorKey, 0 | 1> = {
  budget_personnel: 0, budget_overhead: 0, budget_capital: 0,
  grants_domestic: 1, grants_international: 1,
  tetfund_allocation: 0, endowment_fund: 1,
  students_undergraduate: 1, students_postgraduate: 1,
};

/** The earliest year an indicator's evidence may cover, or null when no assessment year is set. */
export function expectedYear(key: string, assessmentYear: number | null | undefined): number | null {
  if (!assessmentYear || !(key in INDICATOR_LAG)) return null;
  return assessmentYear - INDICATOR_LAG[key as IndicatorKey];
}

/** The latest four-digit year in a reporting year such as "2025" or "2024/2025". */
export function latestYear(text: string | null | undefined): number | null {
  const years = (text ?? "").match(/(?:19|20)\d{2}/g);
  return years ? Math.max(...years.map(Number)) : null;
}

/** True when a disclosure covers a year earlier than the indicator's period: it then counts 0. */
export function isOutdated(key: string, a: Partial<Assessment> | null | undefined, assessmentYear: number | null | undefined): boolean {
  const status = statusInfo(a?.status).value;
  if (status !== "published" && status !== "partial" && status !== "nil") return false;
  const expected = expectedYear(key, assessmentYear);
  const year = latestYear(a?.year);
  return expected !== null && year !== null && year < expected;
}

export interface RecordScore {
  label: RecordLabel;
  /** Points earned and available (applicable indicators); score is shown as points / available. */
  points: number;
  available: number;
  counts: Record<AssessmentStatus, number>;
  /** Disclosures for an earlier year than their period (they count 0). */
  outdated: number;
}

/** The scoring rule. See the "How we score" page, which is built from the same constants. */
export function scoreRecord(assessments: Record<string, Partial<Assessment>> | null | undefined,
  assessmentYear: number | null = null): RecordScore {
  const counts = Object.fromEntries(ASSESSMENT_STATUSES.map((s) => [s.value, 0])) as Record<AssessmentStatus, number>;
  let points = 0;
  let outdated = 0;
  for (const ind of INDICATORS) {
    const a = assessments?.[ind.key];
    counts[statusInfo(a?.status).value]++;
    if (isOutdated(ind.key, a, assessmentYear)) outdated++;
    else points += statusInfo(a?.status).credit ?? 0;
  }
  const available = INDICATORS.length - counts.not_applicable - counts.inaccessible - counts.not_assessed;
  let label: RecordLabel;
  if (counts.not_assessed > 0 || counts.inaccessible > 0) label = "incomplete";
  else if (available === 0) label = "no_applicable";
  else if (points === available) label = "fully_disclosed";
  else if (points === 0) label = "none_found";
  else label = "partially_disclosed";
  return { label, points, available, counts, outdated };
}

export const formatPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

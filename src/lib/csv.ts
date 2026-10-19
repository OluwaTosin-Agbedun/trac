// CSV for public downloads: RFC 4180 quoting plus spreadsheet formula-injection protection, and
// the column layout of the current-release file. Pure and framework-free (relative imports, only
// erasable TypeScript) so the route handler, the /data page and node:test all share it.
import {
  INDICATORS,
  INSTITUTION_TYPE_LABEL,
  OWNERSHIP_LABEL,
  STATE_LABEL,
  SUMMARY_TEXT,
  type AssessmentState,
  type InstitutionType,
  type Ownership,
  type SummaryLabel,
} from "./indicators.ts";
import { formatAmount } from "./format.ts";
import { safeHttpUrl, type PublishedSnapshot, type SnapshotIndicator } from "./snapshot.ts";

export type CsvValue = string | number | bigint | boolean | Date | null | undefined;

/** Byte order mark so spreadsheet programs open the file as UTF-8 (₦, accented names). */
export const CSV_BOM = "﻿";

/**
 * A cell a spreadsheet could read as a formula or command: one starting with =, +, -, @, tab or
 * carriage return, the same after leading whitespace, or the full-width forms some locales accept.
 */
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@＝＋－＠])/;

/** Prefix a single quote so the cell is shown as text and never evaluated. */
export function neutraliseFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function toText(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

/** One field: null → empty, formula-like text neutralised, then quoted when RFC 4180 requires it. */
export function csvCell(value: CsvValue): string {
  const text = neutraliseFormula(toText(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Records joined with CRLF, each record ending in CRLF (RFC 4180). An empty list gives "". */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvValue>>): string {
  return rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}

// ---- The current-release file ---------------------------------------------------------------

export const CURRENT_RELEASE_FILENAME = "compliance-monitoring-portal-current-release.csv";

export interface CsvColumn {
  name: string;
  description: string;
}

/** Institution-level columns, in file order. Descriptions are shown on the /data page. */
export const RELEASE_COLUMNS: readonly CsvColumn[] = [
  { name: "slug", description: "Stable identifier used in the institution's web address on this site." },
  { name: "name", description: "Institution name as published." },
  { name: "ownership", description: "Federal, State, Private or Ownership unknown." },
  { name: "institution_type", description: "University, Polytechnic, Monotechnic, College or Other." },
  { name: "state", description: "State where the institution is located. Empty when not stated." },
  { name: "city", description: "City or town. Empty when not stated." },
  { name: "website_url", description: "Official website reviewed. Empty when not stated." },
  { name: "assessment_period", description: "The reporting period this assessment was made against, for example FY 2025." },
  { name: "methodology_version", description: "Version of the assessment method used for this release." },
  { name: "release_number", description: "Public release number for this institution. Earlier releases stay on its history page." },
  { name: "published_at", description: "Public release date and time (ISO 8601, UTC)." },
  { name: "last_verified_at", description: "When a person last verified the findings (ISO 8601, UTC). Separate from the release date. Empty when not recorded." },
  { name: "summary_label", description: "Descriptive summary, for example Partial disclosure. It is not a score or a ranking." },
  { name: "published_count", description: "Indicators published with evidence checked." },
  { name: "applicable_count", description: "Indicators that apply to this institution (nine, less any excluded)." },
  { name: "assessed_count", description: "Indicators with a completed review, excluding those not applicable." },
  { name: "excluded_count", description: "Indicators marked not applicable, each with a published reason." },
];

/** Four columns per indicator, named <indicator key>_<suffix>. */
export const INDICATOR_COLUMNS: readonly { suffix: string; description: string }[] = [
  { suffix: "state", description: "Assessment status in the site's wording, for example Not found in the sources reviewed." },
  { suffix: "period", description: "Reporting period the finding covers, for example 2025 or 2024/2025. Empty when unknown." },
  {
    suffix: "value",
    description:
      "Published value: an amount with its currency and scale kept explicit (₦4,250.5 million; a published zero is ₦0), a whole-number count, or the figure as printed in the source. Filled only when the status is published; empty otherwise or when no value was recorded.",
  },
  { suffix: "evidence_url", description: "Address of the first public source checked for this indicator. Empty when none is public." },
];

export function currentReleaseHeader(): string[] {
  return [
    ...RELEASE_COLUMNS.map((c) => c.name),
    ...INDICATORS.flatMap((i) => INDICATOR_COLUMNS.map((c) => `${i.key}_${c.suffix}`)),
  ];
}

function lookup<K extends string>(labels: Record<K, string>, value: string | null | undefined): string {
  if (!value) return "";
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value as K] : value;
}

function isoOrText(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function count(value: unknown): number | null {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}

function periodText(ind: SnapshotIndicator): string {
  if (ind.period_label) return ind.period_label;
  if (ind.period_start && ind.period_end) return `${ind.period_start} to ${ind.period_end}`;
  return "";
}

function valueText(ind: SnapshotIndicator): string {
  // Only a published finding has a value to report. A value left on an indicator now marked not
  // found, uncertain or not applicable (for example carried over from an earlier release) is not
  // a published figure, so it is never written out.
  if (ind.state !== "published") return "";
  const amount = ind.value_amount;
  if (amount !== null && amount !== undefined && amount !== "") return formatAmount(amount, ind.value_scale, ind.value_currency);
  if (ind.value_count !== null && ind.value_count !== undefined && Number.isFinite(Number(ind.value_count))) {
    return String(Number(ind.value_count));
  }
  return ind.value_literal ?? "";
}

function firstEvidenceUrl(ind: SnapshotIndicator): string {
  for (const e of ind.evidence ?? []) {
    const url = safeHttpUrl(e.url);
    if (url) return url;
  }
  return "";
}

/** One institution's current release as a CSV record, in currentReleaseHeader() order. */
export function currentReleaseRow(s: PublishedSnapshot): CsvValue[] {
  const p = s.payload.profile;
  const sum = s.payload.summary;
  const byKey = new Map((s.payload.indicators ?? []).map((i) => [i.key, i]));
  const cells: CsvValue[] = [
    s.slug,
    p.name,
    lookup<Ownership>(OWNERSHIP_LABEL, p.ownership),
    lookup<InstitutionType>(INSTITUTION_TYPE_LABEL, p.institution_type),
    p.state,
    p.city,
    safeHttpUrl(p.website_url) ?? "",
    p.assessment_period,
    s.methodologyVersionId || p.methodology_version_id,
    s.releaseNumber,
    isoOrText(s.publishedAt),
    isoOrText(p.last_verified_at),
    lookup<SummaryLabel>(SUMMARY_TEXT, sum?.label),
    count(sum?.published),
    count(sum?.applicable),
    count(sum?.assessed),
    count(sum?.excluded),
  ];
  for (const def of INDICATORS) {
    const ind = byKey.get(def.key);
    if (!ind) {
      // Unknown stays unknown: no status is invented for an indicator missing from the release.
      cells.push(null, null, null, null);
      continue;
    }
    cells.push(lookup<AssessmentState>(STATE_LABEL, ind.state), periodText(ind), valueText(ind), firstEvidenceUrl(ind));
  }
  return cells;
}

/** Header plus one record per snapshot. */
export function currentReleaseTable(snapshots: readonly PublishedSnapshot[]): CsvValue[][] {
  return [currentReleaseHeader(), ...snapshots.map(currentReleaseRow)];
}

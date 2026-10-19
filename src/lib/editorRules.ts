// Pure rules for the CMS institution editor: input parsing for the profile, indicator and evidence
// forms, the descriptive draft counts, submission requirement hints and "changed since published"
// comparison. No framework imports, no "@/" paths and only erasable TypeScript, so node:test can
// load this file directly (tests/lib/editorRules.test.mjs).
//
// The database is the authority (its functions re-check roles, states and constraints). These
// checks exist so people get clear, field-level messages before anything reaches SQL, and so
// unknown stays null: an empty field is never turned into 0.
import {
  ASSESSMENT_STATES, INDICATOR_KEYS, INSTITUTION_TYPES, NIGERIAN_STATES, OWNERSHIP, PERIOD_TYPES, VALUE_SCALES,
  type AssessmentState, type InstitutionType, type Ownership, type PeriodType, type SummaryLabel, type ValueScale,
} from "./indicators.ts";
import { periodCoverage } from "./compare.ts";

export type FieldErrors = Record<string, string[]>;
export type Parsed<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };
export type RawValues = Record<string, string | null | undefined>;

export const LIMITS = {
  name: 300,
  shortName: 80,
  text: 200,
  url: 2000,
  period: 80,
  literal: 200,
  reason: 2000,
  note: 4000,
  title: 300,
  excerpt: 2000,
  locator: 300,
  amount: 30,
} as const;

const AMOUNT_RE = /^-?\d+(\.\d+)?$/;
const COUNT_RE = /^\d+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_INT = 2147483647;

function str(raw: RawValues, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v.trim() : "";
}

function orNull(s: string): string | null {
  return s === "" ? null : s;
}

function oneOf<T extends string>(v: string, list: readonly T[]): v is T {
  return (list as readonly string[]).includes(v);
}

function collector() {
  const errors: FieldErrors = {};
  return {
    errors,
    add(key: string, message: string) {
      (errors[key] ??= []).push(message);
    },
    get any() {
      return Object.keys(errors).length > 0;
    },
  };
}

function tooLong(c: ReturnType<typeof collector>, key: string, value: string, max: number, what: string) {
  if (value.length > max) c.add(key, `${what} must be ${max} characters or fewer.`);
}

// ---------------------------------------------------------------------------
// Small validators
// ---------------------------------------------------------------------------

/** A real calendar date written yyyy-mm-dd (what <input type="date"> submits). */
export function isCalendarDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** http(s) only, with a host, no spaces; matches the database check `~* '^https?://'`. */
export function isHttpUrl(s: string): boolean {
  if (s.length > LIMITS.url || /\s/.test(s) || !/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The optimistic-lock counter echoed by every form: a positive 32-bit integer, or null. */
export function parseLockVersion(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_INT ? n : null;
}

/** Today's calendar date in Lagos, yyyy-mm-dd. */
export function lagosDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Value for a date input: Date → its Lagos calendar date; "yyyy-mm-dd…" strings pass through. */
export function toDateInput(v: Date | string | null | undefined): string {
  if (!v) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : lagosDate(v);
  const s = String(v);
  if (DATE_RE.test(s.slice(0, 10)) && s.length === 10) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : lagosDate(d);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const PROFILE_FIELDS = [
  "name", "short_name", "ownership", "institution_type", "state", "city", "head_name", "head_title",
  "bursar_name", "website_url", "assessment_period",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface ProfilePayload {
  name: string;
  short_name: string | null;
  ownership: Ownership;
  institution_type: InstitutionType;
  state: string | null;
  city: string | null;
  head_name: string | null;
  head_title: string | null;
  bursar_name: string | null;
  website_url: string | null;
  assessment_period: string | null;
}

/**
 * State must be one of the 36 states or FCT, or empty ("Not recorded"). A value already on the
 * record that is not in the list (e.g. from an older import) may be kept as it is, never invented.
 */
export function parseProfile(raw: RawValues, opts: { currentState?: string | null } = {}): Parsed<ProfilePayload> {
  const c = collector();
  const name = str(raw, "name");
  const shortName = str(raw, "short_name");
  const ownership = str(raw, "ownership");
  const type = str(raw, "institution_type");
  const state = str(raw, "state");
  const city = str(raw, "city");
  const headName = str(raw, "head_name");
  const headTitle = str(raw, "head_title");
  const bursar = str(raw, "bursar_name");
  const website = str(raw, "website_url");
  const period = str(raw, "assessment_period");

  if (!name) c.add("name", "Enter the institution's name.");
  tooLong(c, "name", name, LIMITS.name, "The name");
  tooLong(c, "short_name", shortName, LIMITS.shortName, "The short name");
  if (!oneOf(ownership, OWNERSHIP)) c.add("ownership", "Choose an ownership.");
  if (!oneOf(type, INSTITUTION_TYPES)) c.add("institution_type", "Choose an institution type.");
  if (state && !oneOf(state, NIGERIAN_STATES) && state !== (opts.currentState ?? "").trim()) {
    c.add("state", "Choose a state from the list, or Not recorded.");
  }
  tooLong(c, "city", city, LIMITS.text, "The city or town");
  tooLong(c, "head_name", headName, LIMITS.text, "The head's name");
  tooLong(c, "head_title", headTitle, LIMITS.text, "The head's title");
  tooLong(c, "bursar_name", bursar, LIMITS.text, "The bursar's name");
  if (website && !isHttpUrl(website)) {
    c.add("website_url", "Enter a full web address starting with https:// or http://.");
  }
  tooLong(c, "assessment_period", period, LIMITS.period, "The assessment period");

  if (c.any) return { ok: false, errors: c.errors };
  return {
    ok: true,
    data: {
      name,
      short_name: orNull(shortName),
      ownership: ownership as Ownership,
      institution_type: type as InstitutionType,
      state: orNull(state),
      city: orNull(city),
      head_name: orNull(headName),
      head_title: orNull(headTitle),
      bursar_name: orNull(bursar),
      website_url: orNull(website),
      assessment_period: orNull(period),
    },
  };
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

export type ValueKind = "money" | "count";

export interface IndicatorPayload {
  state: AssessmentState;
  period_type: PeriodType | null;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  value_amount: string | null;
  value_scale: ValueScale | null;
  value_currency: string | null;
  value_count: number | null;
  value_literal: string | null;
  reason: string | null;
  internal_note: string | null;
}

/** Every key is always present, so saving also clears fields the editor emptied. */
export function parseIndicator(kind: ValueKind, raw: RawValues): Parsed<IndicatorPayload> {
  const c = collector();
  const state = str(raw, "state");
  const periodType = str(raw, "period_type");
  const periodLabel = str(raw, "period_label");
  const start = str(raw, "period_start");
  const end = str(raw, "period_end");
  const literal = str(raw, "value_literal");
  const reason = str(raw, "reason");
  const note = str(raw, "internal_note");

  if (!oneOf(state, ASSESSMENT_STATES)) c.add("state", "Choose an assessment.");
  if (periodType && !oneOf(periodType, PERIOD_TYPES)) c.add("period_type", "Choose a period type from the list.");
  tooLong(c, "period_label", periodLabel, LIMITS.period, "The period label");
  if (start && !isCalendarDate(start)) c.add("period_start", "Enter a real date.");
  if (end && !isCalendarDate(end)) c.add("period_end", "Enter a real date.");
  if (start && end && isCalendarDate(start) && isCalendarDate(end) && start > end) {
    c.add("period_end", "The period cannot end before it starts.");
  }

  let amount: string | null = null;
  let scale: ValueScale | null = null;
  let currency: string | null = null;
  let count: number | null = null;

  if (kind === "money") {
    // Thousands separators and spaces are tolerated; anything else must be a plain decimal.
    const rawAmount = str(raw, "value_amount");
    const a = rawAmount.replace(/[\s,]/g, "");
    const s = str(raw, "value_scale");
    const cur = str(raw, "value_currency").toUpperCase();
    if (a) {
      if (a.length > LIMITS.amount || !AMOUNT_RE.test(a)) {
        c.add("value_amount", "Enter the amount as digits, e.g. 4250.5. Use the scale for thousands, millions or billions.");
      } else {
        amount = a;
      }
      if (!oneOf(s, VALUE_SCALES)) c.add("value_scale", "Choose the scale the amount is written in.");
      else scale = s;
      const cc = cur || "NGN";
      if (!CURRENCY_RE.test(cc)) c.add("value_currency", "Use a three-letter currency code, e.g. NGN.");
      else currency = cc;
    } else {
      if (s && !oneOf(s, VALUE_SCALES)) c.add("value_scale", "Choose a scale from the list.");
      if (cur && !CURRENCY_RE.test(cur)) c.add("value_currency", "Use a three-letter currency code, e.g. NGN.");
    }
  } else {
    const n = str(raw, "value_count").replace(/[\s,]/g, "");
    if (n) {
      if (!COUNT_RE.test(n) || Number(n) > MAX_INT) {
        c.add("value_count", "Enter a whole number of students (0 or more), digits only.");
      } else {
        count = Number(n);
      }
    }
  }

  tooLong(c, "value_literal", literal, LIMITS.literal, "The figure as printed");
  tooLong(c, "reason", reason, LIMITS.reason, "The public reason");
  tooLong(c, "internal_note", note, LIMITS.note, "The internal note");

  if (state === "not_applicable" && !reason) {
    c.add("reason", "Explain why this indicator does not apply. The reason is shown publicly.");
  }
  const hasValue = (kind === "money" ? str(raw, "value_amount") : str(raw, "value_count")) !== "";
  if (hasValue && (state === "not_found" || state === "not_applicable")) {
    c.add(kind === "money" ? "value_amount" : "value_count",
      "Remove the value or change the assessment: no value is recorded when the indicator is not found or not applicable.");
  }
  // Saving clears any value left on a not-assessed indicator, so say so instead of losing it silently.
  if (hasValue && state === "not_assessed") {
    c.add(kind === "money" ? "value_amount" : "value_count",
      "Choose the assessment first: a value can only be recorded when the indicator is published or uncertain.");
  }

  if (c.any) return { ok: false, errors: c.errors };
  return {
    ok: true,
    data: {
      state: state as AssessmentState,
      period_type: periodType ? (periodType as PeriodType) : null,
      period_label: orNull(periodLabel),
      period_start: orNull(start),
      period_end: orNull(end),
      value_amount: amount,
      value_scale: scale,
      value_currency: currency,
      value_count: count,
      value_literal: orNull(literal),
      reason: orNull(reason),
      internal_note: orNull(note),
    },
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface EvidencePayload {
  indicator_key: string | null;
  url: string;
  title: string | null;
  excerpt: string | null;
  locator: string | null;
  document_period: string | null;
  source_published_on: string | null;
  /** Midday in Lagos on the capture date, so the calendar date survives any display time zone. */
  captured_at: string;
  is_public: boolean;
}

/** `today` is the current Lagos date (yyyy-mm-dd); a capture date cannot be in the future. */
export function parseEvidence(raw: RawValues, today: string): Parsed<EvidencePayload> {
  const c = collector();
  const key = str(raw, "indicator_key");
  const url = str(raw, "url");
  const title = str(raw, "title");
  const excerpt = str(raw, "excerpt");
  const locator = str(raw, "locator");
  const docPeriod = str(raw, "document_period");
  const published = str(raw, "source_published_on");
  const captured = str(raw, "captured_on");
  const pub = str(raw, "is_public");

  if (key && key !== "general" && !oneOf(key, INDICATOR_KEYS)) c.add("indicator_key", "Choose an indicator from the list.");
  if (!url) c.add("url", "Enter the address of the official source.");
  else if (!isHttpUrl(url)) c.add("url", "Enter a full web address starting with https:// or http:// (2,000 characters at most).");
  tooLong(c, "title", title, LIMITS.title, "The title");
  tooLong(c, "excerpt", excerpt, LIMITS.excerpt, "The excerpt");
  tooLong(c, "locator", locator, LIMITS.locator, "The locator");
  tooLong(c, "document_period", docPeriod, LIMITS.period, "The document period");
  if (published && !isCalendarDate(published)) c.add("source_published_on", "Enter a real date, or leave it empty.");
  if (!captured) c.add("captured_on", "Enter the date the source was captured.");
  else if (!isCalendarDate(captured)) c.add("captured_on", "Enter a real date.");
  else if (captured > today) c.add("captured_on", "The capture date cannot be in the future.");

  if (c.any) return { ok: false, errors: c.errors };
  return {
    ok: true,
    data: {
      indicator_key: key && key !== "general" ? key : null,
      url,
      title: orNull(title),
      excerpt: orNull(excerpt),
      locator: orNull(locator),
      document_period: orNull(docPeriod),
      source_published_on: orNull(published),
      captured_at: `${captured}T12:00:00+01:00`,
      is_public: pub === "on" || pub === "true" || pub === "1",
    },
  };
}

// ---------------------------------------------------------------------------
// Descriptive counts (same rules as revision_summary in SQL; no score, no ranking)
// ---------------------------------------------------------------------------

export interface DraftSummary {
  published: number;
  applicable: number;
  assessed: number;
  excluded: number;
  uncertain: number;
  notAssessed: number;
  /** Published findings whose reporting period lies entirely before the assessment period. */
  historical: number;
  total: number;
  label: SummaryLabel;
}

/** One indicator for the summary. A bare state string stands for an indicator with no period. */
export type SummaryIndicator = string | { state: string; period_label?: string | null };

/**
 * A published finding counts towards "all applicable published" only when its reporting period
 * overlaps the assessment period or cannot be placed (periodCoverage in_period or unknown).
 * Prior-year evidence is counted as historical and never satisfies a current-period finding.
 */
export function summarise(items: readonly SummaryIndicator[], assessmentPeriod: string | null = null): DraftSummary {
  const rows = items.map((i) => (typeof i === "string" ? { state: i, period_label: null } : i));
  const states = rows.map((r) => r.state);
  const coverage = rows.filter((r) => r.state === "published").map((r) => periodCoverage(r.period_label ?? null, assessmentPeriod));
  const n = (f: (s: string) => boolean) => states.filter(f).length;
  const published = n((s) => s === "published");
  const currentPublished = coverage.filter((c) => c === "in_period" || c === "unknown").length;
  const historical = coverage.filter((c) => c === "historical").length;
  const applicable = n((s) => s !== "not_applicable");
  const assessed = n((s) => s !== "not_assessed" && s !== "not_applicable");
  const excluded = n((s) => s === "not_applicable");
  const notAssessed = n((s) => s === "not_assessed");
  const uncertain = n((s) => s === "uncertain");
  let label: SummaryLabel;
  if (assessed === 0 && excluded === 0) label = "not_assessed";
  else if (notAssessed > 0) label = "assessment_incomplete";
  else if (uncertain > 0) label = "evidence_uncertain";
  else if (applicable > 0 && currentPublished === applicable) label = "all_applicable_published";
  else if (applicable === 0 && excluded > 0) label = "no_applicable_indicators";
  else if (published === 0) label = "no_disclosures_found";
  else label = "partial_disclosure";
  return { published, applicable, assessed, excluded, uncertain, notAssessed, historical, total: states.length, label };
}

/** "7 of 9 applicable indicators published · 9 assessed · 0 excluded" */
export function countsText(s: { published: number; applicable: number; assessed: number; excluded: number }): string {
  return `${s.published} of ${s.applicable} applicable indicator${s.applicable === 1 ? "" : "s"} published · ${s.assessed} assessed · ${s.excluded} excluded`;
}

// ---------------------------------------------------------------------------
// Submission requirements (mirror submit_revision; the server check is the authority)
// ---------------------------------------------------------------------------

export interface RequirementIndicator {
  state: string;
  period_type: string | null;
  period_label: string | null;
  reason: string | null;
}

export interface RequirementEvidence {
  indicator_key: string | null;
  locator: string | null;
  excerpt: string | null;
  is_public: boolean;
}

function hasLocatorOrExcerpt(e: RequirementEvidence): boolean {
  // Same expression as SQL: nullif(trim(coalesce(locator, excerpt, '')), '') is not null
  const v = e.locator ?? e.excerpt ?? "";
  return v.trim() !== "";
}

/** Problems that will stop submission. `evidence` is this indicator's evidence only. */
export function indicatorProblems(ind: RequirementIndicator, evidence: readonly RequirementEvidence[]): string[] {
  const out: string[] = [];
  if (ind.state === "published") {
    if (ind.period_type === null || ind.period_type === "") out.push("Choose a period type.");
    if (ind.period_label === null || ind.period_label === "") out.push("Add a period label, e.g. 2025 or 2024/2025.");
    if (!evidence.some(hasLocatorOrExcerpt)) out.push("Add at least one evidence item with a locator or an excerpt.");
  }
  if (ind.state === "not_applicable" && !(ind.reason ?? "").trim()) {
    out.push("Give the public reason this indicator does not apply.");
  }
  return out;
}

/** Things a reviewer is likely to question; they do not block submission. */
export function indicatorWarnings(ind: RequirementIndicator, evidence: readonly RequirementEvidence[]): string[] {
  const out: string[] = [];
  if (ind.state === "published") {
    if (ind.period_type === "unknown") out.push("The period type is unknown. Reviewers may return this.");
    if (evidence.length > 0 && !evidence.some((e) => e.is_public)) {
      out.push("All evidence is private, so the public page will show no evidence for this indicator.");
    }
  }
  if (ind.state === "not_found" && !(ind.reason ?? "").trim()) {
    out.push("Consider recording which sources were reviewed (shown publicly as the reason).");
  }
  if (ind.state === "uncertain" && !(ind.reason ?? "").trim()) {
    out.push("Explain what is uncertain (shown publicly as the reason).");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Changed since published
// ---------------------------------------------------------------------------

type Scalar = string | number | boolean | null | undefined;

function norm(v: Scalar): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** "4250.50" and 4250.5 are the same amount; unknown (null) differs from zero. */
export function canonicalDecimal(v: Scalar): string | null {
  const s = norm(v);
  if (s === null) return null;
  if (!AMOUNT_RE.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? String(n) : s;
  }
  const neg = s.startsWith("-");
  let [int, frac = ""] = (neg ? s.slice(1) : s).split(".");
  int = int.replace(/^0+(?=\d)/, "");
  frac = frac.replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return neg && out !== "0" ? `-${out}` : out;
}

export interface ComparableIndicator {
  state: string;
  period_type: string | null;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  value_amount: string | number | null;
  value_scale: string | null;
  value_currency: string | null;
  value_count: number | string | null;
  value_literal: string | null;
  reason: string | null;
}

export interface ComparableEvidence {
  url: string;
  title: string | null;
  excerpt: string | null;
  locator: string | null;
}

export type IndicatorChange = "assessment" | "period" | "value" | "reason" | "public evidence";

/**
 * Which parts of a draft indicator differ from the current published release. Only public
 * evidence is compared (the release holds nothing else). Returns [] when nothing is published.
 */
export function indicatorChanges(
  draft: ComparableIndicator,
  draftPublicEvidence: readonly ComparableEvidence[],
  published: ComparableIndicator | null,
  publishedEvidence: readonly ComparableEvidence[],
): IndicatorChange[] {
  if (!published) return [];
  const out: IndicatorChange[] = [];
  if (norm(draft.state) !== norm(published.state)) out.push("assessment");
  const day = (v: Scalar) => norm(v)?.slice(0, 10) ?? null;
  if (norm(draft.period_type) !== norm(published.period_type) || norm(draft.period_label) !== norm(published.period_label)
      || day(draft.period_start) !== day(published.period_start) || day(draft.period_end) !== day(published.period_end)) {
    out.push("period");
  }
  if (canonicalDecimal(draft.value_amount) !== canonicalDecimal(published.value_amount)
      || norm(draft.value_scale) !== norm(published.value_scale)
      || norm(draft.value_currency) !== norm(published.value_currency)
      || norm(draft.value_count) !== norm(published.value_count)
      || norm(draft.value_literal) !== norm(published.value_literal)) {
    out.push("value");
  }
  if (norm(draft.reason) !== norm(published.reason)) out.push("reason");
  const sig = (list: readonly ComparableEvidence[]) =>
    list.map((e) => [e.url, e.title, e.excerpt, e.locator].map((x) => norm(x) ?? "").join("\u0001")).sort().join("\u0002");
  if (sig(draftPublicEvidence) !== sig(publishedEvidence)) out.push("public evidence");
  return out;
}

export type ComparableProfile = Partial<Record<ProfileField, string | null | undefined>>;

/** Profile fields whose draft value differs from the published release. [] when nothing is published. */
export function profileChanges(draft: ComparableProfile, published: ComparableProfile | null): ProfileField[] {
  if (!published) return [];
  return PROFILE_FIELDS.filter((f) => norm(draft[f]) !== norm(published[f]));
}

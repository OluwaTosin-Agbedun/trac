// Plain words for the register screen: why the importer held a record, what changed between the
// verified copy and the working copy, which period each indicator should cover, and the history of
// a record. Pure and safe for client code.
//
// Relative imports (no "@/") keep this loadable by node for the tests in tests/lib.
import { INDICATORS, type IndicatorKey } from "../../../../../lib/indicators.ts";
import { REPORT_SECTIONS } from "../../../../../lib/report.ts";
import { expectedYear, statusInfo, type Assessment } from "../../../../../lib/register.ts";
import { formatCalendarDate, formatDateTime } from "../../../../../lib/format.ts";

// ---------------------------------------------------------------------------
// Import hold reasons
// ---------------------------------------------------------------------------

export const IMPORT_FLAG_TEXT: Record<string, string> = {
  potential_duplicate: "Possible duplicate of another row - check before verifying",
  missing_name: "The spreadsheet row had no name - confirm which institution this is",
  website_not_url: "The spreadsheet's website was not a usable address",
  website_share_link: "The spreadsheet's website was a Google share link, not the institution's own site",
  website_third_party: "The spreadsheet's website belongs to another organisation, not the institution",
  website_merged_status: "The spreadsheet's website cell also held a status note - check the address",
  state_conflict: "The state in the spreadsheet contradicted the name - confirm the state",
  shared_domain: "Another row in the spreadsheet uses the same website, so the address was not copied - confirm this institution's own site",
  website_multiple_urls: "The spreadsheet's website cell held several addresses, so none was copied - choose the right one",
  website_missing_protocol: "The spreadsheet's address had no https:// and was not copied - check it opens, then enter it in full",
  website_markdown_link: "The spreadsheet's website cell held a formatted link - check the real address",
  location_not_state: "The state column held a town, not a state - confirm the state",
};

/** Why the importer held or doubted a row, in plain words. Unknown codes still read as a sentence. */
export function importFlagText(code: string): string {
  return IMPORT_FLAG_TEXT[code] ?? `The importer flagged this row (${code.replace(/[^a-z0-9]+/gi, " ").trim() || "unknown reason"}) - check before verifying`;
}

// ---------------------------------------------------------------------------
// Expected periods
// ---------------------------------------------------------------------------

const PERIOD_WHAT: Record<IndicatorKey, string> = {
  budget_personnel: "this year's budget",
  budget_overhead: "this year's budget",
  budget_capital: "this year's budget",
  grants_domestic: "last year's grants",
  grants_international: "last year's grants",
  tetfund_allocation: "this year's allocation",
  endowment_fund: "last year's endowment figure",
  students_undergraduate: "last session's student numbers",
  students_postgraduate: "last session's student numbers",
};

/** The earliest year an indicator may cover, written as a reader expects ("2025", or "2024/2025" for a session). */
function periodLabel(key: string, year: number): string {
  return key.startsWith("students_") ? `${year - 1}/${year}` : String(year);
}

/** "For 2026: this year's budget (2026 or later)", or null when no assessment year is set. */
export function expectedPeriodText(key: string, assessmentYear: number | null | undefined): string | null {
  const year = expectedYear(key, assessmentYear);
  if (year === null || !(key in PERIOD_WHAT)) return null;
  return `For ${assessmentYear}: ${PERIOD_WHAT[key as IndicatorKey]} (${periodLabel(key, year)} or later)`;
}

/** The warning shown when the year entered is earlier than the indicator's period. */
export function outdatedText(key: string, assessmentYear: number | null | undefined): string | null {
  const year = expectedYear(key, assessmentYear);
  if (year === null) return null;
  return `This is earlier than ${periodLabel(key, year)}, so it counts 0 points. Look for a newer document.`;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** A due date has passed and the record is not verified in its current form. dates are yyyy-mm-dd. */
export function isOverdue(e: { dueOn: string | null; state_: string; archivedAt?: string | null }, today: string): boolean {
  return Boolean(e.dueOn) && e.dueOn! < today && e.state_ !== "verified" && !e.archivedAt;
}

// ---------------------------------------------------------------------------
// Differences between two versions of a record
// ---------------------------------------------------------------------------

/** The content of a record as verified and as saved (register_content in the database). */
export interface ContentLike {
  name?: string | null;
  section?: string | null;
  state?: string | null;
  head_name?: string | null;
  bursar_name?: string | null;
  people_source_url?: string | null;
  homepage_url?: string | null;
  disclosure_url?: string | null;
  extra_links?: { label: string; url: string }[] | null;
  assessments?: Record<string, Partial<Assessment> | null | undefined> | null;
}

export interface FieldChange {
  key: string;
  label: string;
  /** The older (verified) value, written out. */
  before: string;
  /** The newer (working) value, written out. */
  after: string;
}

/** "Budget: Personnel costs", "TETFund allocation": the indicator with its group when the label alone is unclear. */
export function indicatorLabel(key: string): string {
  const d = INDICATORS.find((i) => i.key === key);
  if (!d) return key;
  return d.label.toLowerCase().startsWith(d.groupShort.toLowerCase()) ? d.label : `${d.groupShort}: ${d.label}`;
}

const NOTHING = "Not recorded";

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const textOf = (v: unknown) => (blank(v) ? NOTHING : String(v).trim());

function sectionText(v: unknown): string {
  return blank(v) ? NOTHING : REPORT_SECTIONS.find((s) => s.key === v)?.label ?? String(v);
}

function linksKey(v: ContentLike["extra_links"]): string {
  return JSON.stringify((v ?? []).map((l) => [String(l?.label ?? "").trim(), String(l?.url ?? "").trim()]));
}

function linksText(v: ContentLike["extra_links"]): string {
  const list = (v ?? []).filter((l) => l && !blank(l.url));
  return list.length ? list.map((l) => `${String(l.label ?? "").trim() || "Document"}: ${l.url}`).join("; ") : "None";
}

/** One indicator's finding, normalised so missing and blank compare equal. */
function normal(a: Partial<Assessment> | null | undefined) {
  const s = (v: unknown) => (blank(v) ? null : String(v).trim());
  return { status: statusInfo(a?.status).value, year: s(a?.year), evidence_url: s(a?.evidence_url), checked_on: s(a?.checked_on), note: s(a?.note) };
}

/** "Published · 2025 · checked 20 Oct 2026 · https://… · “note”". */
export function assessmentText(a: Partial<Assessment> | null | undefined): string {
  const n = normal(a);
  const parts = [statusInfo(n.status).label];
  if (n.year) parts.push(n.year);
  if (n.checked_on) parts.push(`checked ${formatCalendarDate(n.checked_on)}`);
  if (n.evidence_url) parts.push(n.evidence_url);
  if (n.note) parts.push(`“${n.note}”`);
  return parts.join(" · ");
}

const SIMPLE_FIELDS: { key: keyof ContentLike; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "section", label: "Category" },
  { key: "state", label: "State" },
  { key: "head_name", label: "Head" },
  { key: "bursar_name", label: "Bursar" },
  { key: "people_source_url", label: "Source for the head and bursar" },
  { key: "homepage_url", label: "Homepage" },
  { key: "disclosure_url", label: "Disclosure page" },
];

/** Every field that differs between two versions, with both values written out. */
export function diffContent(before: ContentLike | null | undefined, after: ContentLike | null | undefined): FieldChange[] {
  const b = before ?? {};
  const a = after ?? {};
  const out: FieldChange[] = [];
  for (const f of SIMPLE_FIELDS) {
    const x = blank(b[f.key]) ? null : String(b[f.key]).trim();
    const y = blank(a[f.key]) ? null : String(a[f.key]).trim();
    if (x === y) continue;
    const show = f.key === "section" ? sectionText : textOf;
    out.push({ key: f.key, label: f.label, before: show(x), after: show(y) });
  }
  if (linksKey(b.extra_links) !== linksKey(a.extra_links)) {
    out.push({ key: "extra_links", label: "Extra documents", before: linksText(b.extra_links), after: linksText(a.extra_links) });
  }
  for (const d of INDICATORS) {
    const x = b.assessments?.[d.key];
    const y = a.assessments?.[d.key];
    if (JSON.stringify(normal(x)) === JSON.stringify(normal(y))) continue;
    out.push({ key: d.key, label: indicatorLabel(d.key), before: assessmentText(x), after: assessmentText(y) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryLine {
  at: string;
  who: string;
  title: string;
  details: string[];
  tone: "ok" | "warn" | "danger" | "muted";
}

interface EventLike { at: string; action: string; actorName: string | null; details: Record<string, unknown> }
interface RunLike { at: string; checkedByName: string | null; scheduled: boolean; total: number; problems: number }
interface VersionLike {
  verifiedAt: string; verifiedByName: string | null; verifiedMethod: string | null; assessmentYear: number | null;
  supersededAt: string; supersededByName: string | null; reason: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ruleText(method: unknown, year: unknown): string | null {
  const m = str(method);
  const y = typeof year === "number" || (typeof year === "string" && /^\d{4}$/.test(year)) ? String(year) : null;
  if (m && y) return `Checked under scoring rule ${m}, for the ${y} assessment year.`;
  if (m) return `Checked under scoring rule ${m}; no assessment year was set.`;
  if (y) return `Checked for the ${y} assessment year.`;
  return null;
}

/**
 * One audit event in plain words. nameOf turns a team member's id into a name (assignments store
 * ids). Unknown actions still read as a sentence.
 */
export function describeEvent(ev: EventLike, nameOf: (id: string) => string | null): HistoryLine {
  const who = ev.actorName ?? "The system";
  const d = ev.details ?? {};
  const line = (title: string, details: string[] = [], tone: HistoryLine["tone"] = "muted"): HistoryLine => ({ at: ev.at, who, title, details, tone });
  switch (ev.action) {
    case "report.entry_added":
      return line("Added to the register", str(d.name) ? [`As “${str(d.name)}”.`] : []);
    case "report.entry_updated": {
      const changes = diffContent(d.before as ContentLike, d.after as ContentLike);
      if (!changes.length) return line("Saved without visible changes");
      const shown = changes.slice(0, 6).map((c) => `${c.label}: ${c.before} → ${c.after}`);
      if (changes.length > 6) shown.push(`and ${plural(changes.length - 6, "more change")}.`);
      return line(`Saved ${plural(changes.length, "change")}`, shown);
    }
    case "report.entry_returned":
      return line("Returned for fixes", str(d.note) ? [`Note: ${str(d.note)}`] : [], "danger");
    case "report.entry_verified": {
      const rule = ruleText(d.method, d.assessment_year);
      return line("Verified and published", rule ? [rule] : [], "ok");
    }
    case "report.verification_withdrawn":
      return line("Verification withdrawn (taken off the public site)", str(d.reason) ? [`Reason: ${str(d.reason)}`] : [], "danger");
    case "report.entry_archived":
      return line("Removed from the register", str(d.reason) ? [`Reason: ${str(d.reason)}`] : [], "danger");
    case "report.entry_restored":
      return line("Restored to the register", [], "ok");
    case "report.entry_removed":
      return line("Deleted from the report (before records were kept when removed)", [], "danger");
    case "report.entry_assigned": {
      const person = (id: unknown, none: string) => (str(id) ? nameOf(String(id)) ?? "a former team member" : none);
      const due = str(d.due_on);
      return line("Assignment changed", [
        `Editor: ${person(d.editor_id, "nobody")}.`,
        `Reviewer: ${person(d.reviewer_id, "nobody")}.`,
        due ? `Due ${formatCalendarDate(due)}.` : "No due date.",
      ]);
    }
    default: {
      const words = ev.action.replace(/^report\./, "").replace(/[^a-z0-9]+/gi, " ").trim();
      return line(words ? words[0].toUpperCase() + words.slice(1) : "Change recorded");
    }
  }
}

/** A run of the link checker in plain words. */
export function describeLinkRun(run: RunLike): HistoryLine {
  return {
    at: run.at,
    who: run.scheduled ? "The scheduled check" : run.checkedByName ?? "A former team member",
    title: `Checked ${plural(run.total, "link")}`,
    details: [run.problems ? `${plural(run.problems, "link")} needed attention.` : "Every link worked and pointed to this institution."],
    tone: run.problems ? "warn" : "muted",
  };
}

/** An earlier verified version in plain words. */
export function describeVersion(v: VersionLike): HistoryLine {
  const rule = ruleText(v.verifiedMethod, v.assessmentYear);
  const replaced = v.reason === "replaced by a newer verification";
  return {
    at: v.supersededAt,
    who: v.supersededByName ?? "A former team member",
    title: replaced ? "Replaced by a newer verification" : "Verification withdrawn",
    details: [
      `This version was verified ${formatDateTime(v.verifiedAt)}${v.verifiedByName ? ` by ${v.verifiedByName}` : ""}.`,
      ...(rule ? [rule] : []),
      ...(!replaced && v.reason ? [`Reason: ${v.reason}`] : []),
    ],
    tone: replaced ? "muted" : "danger",
  };
}

/** Audit events and link-check runs together, newest first. */
export function buildHistory(events: EventLike[], runs: RunLike[], nameOf: (id: string) => string | null): HistoryLine[] {
  return [...events.map((e) => describeEvent(e, nameOf)), ...runs.map(describeLinkRun)]
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
}

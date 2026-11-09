import "server-only";
// Reading the register forms. Every value is trimmed and length-capped; anything that fails a check
// is refused with a message for the person, and every typed value is returned so the form can show
// it again (a rejected save never loses work). The database checks everything again.
//
// Relative imports (no "@/") keep this loadable by node for the tests in tests/server.
import { field } from "../../../../../server/actions/result.ts";
import { INDICATORS } from "../../../../../lib/indicators.ts";
import { REPORT_SECTIONS } from "../../../../../lib/report.ts";
import { ASSESSMENT_STATUSES } from "../../../../../lib/register.ts";

export const URL_RE = /^https?:\/\/[^\s<>"]+$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Values = Record<string, string>;
type Parsed<T> = { value?: T; error?: string; values: Values };

/** A real calendar date (rejects 2026-02-30). */
export function isDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// ---------------------------------------------------------------------------
// The record form
// ---------------------------------------------------------------------------

/** Every field of the record form with its cap: one more than allowed, so too-long text is caught, not cut. */
const ENTRY_CAPS: [string, number][] = [
  ["section", 40], ["name", 301], ["state", 61], ["head_name", 201], ["bursar_name", 201],
  ["people_source_url", 501], ["homepage_url", 501], ["disclosure_url", 501], ["checked_all", 10],
  ...[0, 1, 2].flatMap((i): [string, number][] => [[`extra_label_${i}`, 121], [`extra_url_${i}`, 501]]),
  ...INDICATORS.flatMap((d): [string, number][] => [
    [`st_${d.key}`, 20], [`yr_${d.key}`, 21], [`ev_${d.key}`, 501], [`ck_${d.key}`, 10], [`nt_${d.key}`, 301],
  ]),
];

/** Everything typed into the record form, capped, to give back when a save is refused. */
export function entryValues(fd: FormData): Values {
  return Object.fromEntries(ENTRY_CAPS.map(([k, max]) => [k, field(fd, k, max)]));
}

export interface EntryPayload {
  section: string; name: string; state: string; head_name: string; bursar_name: string; people_source_url: string;
  homepage_url: string; disclosure_url: string; extra_links: { label: string; url: string }[];
  assessments: Record<string, { status: string; year: string | null; evidence_url: string | null; checked_on: string | null; note: string | null }>;
}

/** The record form as the payload for save_report_entry, or the first problem in plain words. */
export function parseEntry(fd: FormData): Parsed<EntryPayload> {
  const values = entryValues(fd);
  const bad = (error: string): Parsed<EntryPayload> => ({ error, values });
  if (!REPORT_SECTIONS.some((s) => s.key === values.section)) return bad("Choose the category.");
  if (!values.name) return bad("Enter the institution's name.");
  if (values.name.length > 300) return bad("Shorten the name (300 characters at most).");
  if (values.state.length > 60) return bad("Shorten the state (60 characters at most).");
  if (values.head_name.length > 200 || values.bursar_name.length > 200) return bad("Shorten the head or bursar (200 characters at most).");
  const urls: [string, string][] = [
    ["people_source_url", "source for the head and bursar"], ["homepage_url", "homepage"], ["disclosure_url", "disclosure page"],
  ];
  for (const [k, label] of urls) {
    if (values[k] && (!URL_RE.test(values[k]) || values[k].length > 500)) return bad(`Enter the ${label} as a full address starting with https://`);
  }
  if (values.checked_all && !isDate(values.checked_all)) return bad("Choose a valid date for when you checked the sources.");
  const extra: { label: string; url: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const url = values[`extra_url_${i}`];
    const label = values[`extra_label_${i}`];
    if (label.length > 120) return bad(`Shorten the title of extra document ${i + 1} (120 characters at most).`);
    if (!url) {
      if (label) return bad(`Add the address of extra document ${i + 1}, or clear its title.`);
      continue;
    }
    if (!URL_RE.test(url) || url.length > 500) return bad(`Extra document ${i + 1} must be a full address starting with https://`);
    extra.push({ label: label || "Document", url });
  }
  const assessments: EntryPayload["assessments"] = {};
  for (const d of INDICATORS) {
    const status = values[`st_${d.key}`] || "not_assessed";
    const year = values[`yr_${d.key}`];
    const evidence = values[`ev_${d.key}`];
    let checked = values[`ck_${d.key}`];
    const note = values[`nt_${d.key}`];
    if (!ASSESSMENT_STATUSES.some((s) => s.value === status)) return bad(`Choose a valid status for ${d.label}.`);
    if (year.length > 20) return bad(`Shorten the reporting year for ${d.label} (20 characters at most).`);
    if (evidence && (!URL_RE.test(evidence) || evidence.length > 500)) return bad(`The evidence link for ${d.label} must be a full address starting with https://`);
    if (checked && !isDate(checked)) return bad(`Choose a valid checked date for ${d.label}.`);
    if (note.length > 300) return bad(`Shorten the note for ${d.label} (300 characters at most).`);
    if (!checked && status !== "not_assessed" && values.checked_all) checked = values.checked_all;
    assessments[d.key] = { status, year: year || null, evidence_url: evidence || null, checked_on: checked || null, note: note || null };
  }
  return {
    value: {
      section: values.section, name: values.name, state: values.state, head_name: values.head_name, bursar_name: values.bursar_name,
      people_source_url: values.people_source_url, homepage_url: values.homepage_url, disclosure_url: values.disclosure_url,
      extra_links: extra, assessments,
    },
    values,
  };
}

// ---------------------------------------------------------------------------
// Reasons (withdraw, remove, visibility)
// ---------------------------------------------------------------------------

/** A required reason of min to max characters; values echo it back. */
export function parseReason(fd: FormData, min: number, max: number, what: string): Parsed<string> {
  const reason = field(fd, "reason", max + 1);
  const values = { reason: reason.slice(0, max) };
  if (reason.length < min) return { error: `Give the reason ${what} (at least ${min} characters).`, values };
  if (reason.length > max) return { error: `Shorten the reason (${max.toLocaleString("en-GB")} characters at most).`, values };
  return { value: reason, values };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export interface AssignInput { ids: string[]; editor: string | null; reviewer: string | null; dueOn: string | null }

/**
 * The assignment form. scope "shown" takes the ids of every record listed (hidden "shown" fields),
 * "selected" the ticked rows ("ids"). At most 500 records; every id must be a record id.
 */
export function parseAssign(fd: FormData): Parsed<AssignInput> {
  const scope = field(fd, "scope", 10) || "selected";
  const values: Values = { scope, editor: field(fd, "editor", 40), reviewer: field(fd, "reviewer", 40), due_on: field(fd, "due_on", 10) };
  const bad = (error: string): Parsed<AssignInput> => ({ error, values });
  if (scope !== "selected" && scope !== "shown") return bad("Choose which records to assign.");
  const raw = fd.getAll(scope === "shown" ? "shown" : "ids");
  if (raw.length > 500) return bad("Assign at most 500 records at a time. Narrow the list first.");
  if (raw.some((v) => typeof v !== "string" || !UUID_RE.test(v))) return bad("Some of those records could not be found. Reload the page and try again.");
  const ids = Array.from(new Set(raw.map((v) => String(v).toLowerCase())));
  if (!ids.length) return bad(scope === "shown" ? "There are no records in the list to assign." : "Tick at least one record in the table, or choose every record shown.");
  for (const k of ["editor", "reviewer"] as const) {
    if (values[k] && !UUID_RE.test(values[k])) return bad(`Choose the ${k} from the list.`);
  }
  if (values.editor && values.editor.toLowerCase() === values.reviewer.toLowerCase()) return bad("The editor and the reviewer must be different people.");
  if (values.due_on && !isDate(values.due_on)) return bad("Choose a valid due date.");
  return { value: { ids, editor: values.editor || null, reviewer: values.reviewer || null, dueOn: values.due_on || null }, values };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface DatesInput { reportedAsOf: string | null; assessmentYear: number | null; recheckDays: number }

/** Report date, assessment year and re-check interval. The database checks the ranges again. */
export function parseDates(fd: FormData, currentYear: number): Parsed<DatesInput> {
  const values: Values = { reported_as_of: field(fd, "reported_as_of", 10), assessment_year: field(fd, "assessment_year", 4), recheck_days: field(fd, "recheck_days", 5) };
  const bad = (error: string): Parsed<DatesInput> => ({ error, values });
  if (values.reported_as_of && !isDate(values.reported_as_of)) return bad("Choose a valid report date.");
  if (values.assessment_year && !/^\d{4}$/.test(values.assessment_year)) return bad("Enter the assessment year as four digits, for example 2026.");
  const year = values.assessment_year ? Number(values.assessment_year) : null;
  if (year !== null && (year < 2000 || year > currentYear + 1)) return bad(`Choose an assessment year between 2000 and ${currentYear + 1}.`);
  if (!/^\d{1,4}$/.test(values.recheck_days)) return bad("Enter the re-check interval as a number of days.");
  const days = Number(values.recheck_days);
  if (days < 30 || days > 1095) return bad("Choose a re-check interval between 30 and 1,095 days.");
  return { value: { reportedAsOf: values.reported_as_of || null, assessmentYear: year, recheckDays: days }, values };
}

/** Show or hide the public register: the choice, a reason and a ticked confirmation. */
export function parseVisibility(fd: FormData): Parsed<{ visible: boolean; reason: string }> {
  const choice = field(fd, "visible", 3);
  const r = parseReason(fd, 5, 500, choice === "yes" ? "for showing the register" : "for hiding the register");
  const values = { ...r.values, visible: choice };
  if (choice !== "yes" && choice !== "no") return { error: "Reload the page and try again.", values };
  if (r.error || r.value === undefined) return { error: r.error, values };
  if (fd.get("confirm") !== "yes") return { error: "Tick the box to confirm.", values };
  return { value: { visible: choice === "yes", reason: r.value }, values };
}

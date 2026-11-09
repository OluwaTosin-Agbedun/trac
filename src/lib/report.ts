// The six categories of the compliance report, in report order. Safe for client code.
export type ReportSection =
  | "federal_university" | "federal_polytechnic" | "federal_monotechnic"
  | "state_university" | "state_polytechnic" | "state_monotechnic";

export interface ReportSectionInfo {
  key: ReportSection;
  /** Plural, for lists and tabs: "Federal universities". */
  label: string;
  /** One institution's category: "Federal university". */
  singular: string;
  /** The tab text inside its ownership group: "Universities". */
  short: string;
  ownership: "Federal" | "State";
  /** The title of the institution's head. */
  head: string;
}

export const REPORT_SECTIONS: ReportSectionInfo[] = [
  { key: "federal_university", label: "Federal universities", singular: "Federal university", short: "Universities", ownership: "Federal", head: "Vice-Chancellor" },
  { key: "federal_polytechnic", label: "Federal polytechnics", singular: "Federal polytechnic", short: "Polytechnics", ownership: "Federal", head: "Rector" },
  { key: "federal_monotechnic", label: "Federal monotechnics", singular: "Federal monotechnic", short: "Monotechnics", ownership: "Federal", head: "Rector / Provost" },
  { key: "state_university", label: "State universities", singular: "State university", short: "Universities", ownership: "State", head: "Vice-Chancellor" },
  { key: "state_polytechnic", label: "State polytechnics", singular: "State polytechnic", short: "Polytechnics", ownership: "State", head: "Rector" },
  { key: "state_monotechnic", label: "State monotechnics", singular: "State monotechnic", short: "Monotechnics", ownership: "State", head: "Rector / Provost" },
];

/** The category for a stored section key, or undefined for an unknown key. */
export const reportSection = (key: string | null | undefined): ReportSectionInfo | undefined =>
  REPORT_SECTIONS.find((s) => s.key === key);

export type ReportStatus = "updated" | "partial" | "not_updated" | "not_yet_updated" | "not_recorded";

/** Financial report update status: label and badge colours, in the order offered in the CMS. */
export const REPORT_STATUSES: { value: ReportStatus; label: string; className: string }[] = [
  { value: "updated", label: "Updated", className: "border-[#b7dcc5] bg-ok-bg text-ok" },
  { value: "partial", label: "Partially updated", className: "border-warn-rule bg-warn-bg text-warn-text" },
  { value: "not_updated", label: "Not updated", className: "border-[#e8b4b4] bg-danger-bg text-danger" },
  { value: "not_yet_updated", label: "Not yet updated", className: "border-[#e8b4b4] bg-danger-bg text-danger" },
  { value: "not_recorded", label: "Not recorded", className: "border-rule bg-surface text-muted" },
];

export function reportStatus(value: string | null | undefined) {
  return REPORT_STATUSES.find((s) => s.value === value) ?? REPORT_STATUSES[REPORT_STATUSES.length - 1];
}

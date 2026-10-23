// The six categories of the compliance report, in report order. Safe for client code.
export type ReportSection =
  | "federal_university" | "federal_polytechnic" | "federal_monotechnic"
  | "state_university" | "state_polytechnic" | "state_monotechnic";

export const REPORT_SECTIONS: { key: ReportSection; label: string; ownership: "Federal" | "State"; head: string }[] = [
  { key: "federal_university", label: "Federal universities", ownership: "Federal", head: "Vice-Chancellor" },
  { key: "federal_polytechnic", label: "Federal polytechnics", ownership: "Federal", head: "Rector" },
  { key: "federal_monotechnic", label: "Federal monotechnics", ownership: "Federal", head: "Rector / Provost" },
  { key: "state_university", label: "State universities", ownership: "State", head: "Vice-Chancellor" },
  { key: "state_polytechnic", label: "State polytechnics", ownership: "State", head: "Rector" },
  { key: "state_monotechnic", label: "State monotechnics", ownership: "State", head: "Rector / Provost" },
];

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

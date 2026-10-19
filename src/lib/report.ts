// The three federal categories of the compliance report, in report order. Safe for client code.
export type ReportSection = "federal_university" | "federal_polytechnic" | "federal_monotechnic";

export const REPORT_SECTIONS: { key: ReportSection; label: string; head: string }[] = [
  { key: "federal_university", label: "Federal universities", head: "Vice-Chancellor" },
  { key: "federal_polytechnic", label: "Federal polytechnics", head: "Rector" },
  { key: "federal_monotechnic", label: "Federal monotechnics", head: "Rector / Provost" },
];

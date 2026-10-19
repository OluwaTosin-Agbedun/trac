// The nine disclosure indicators and the words used for every status. Safe for client code.

export const INDICATORS = [
  { key: "budget_personnel", group: "Annual budgetary allocation", groupShort: "Budget", label: "Personnel costs", short: "Pers.", kind: "money" },
  { key: "budget_overhead", group: "Annual budgetary allocation", groupShort: "Budget", label: "Overhead costs", short: "Ovhd.", kind: "money" },
  { key: "budget_capital", group: "Annual budgetary allocation", groupShort: "Budget", label: "Capital expenditure", short: "Cap.", kind: "money" },
  { key: "grants_domestic", group: "Research grant revenue", groupShort: "Grants", label: "Domestic sources", short: "Dom.", kind: "money" },
  { key: "grants_international", group: "Research grant revenue", groupShort: "Grants", label: "International sources", short: "Intl.", kind: "money" },
  { key: "tetfund_allocation", group: "Intervention funding", groupShort: "TETFund", label: "TETFund allocation", short: "TETFund", kind: "money" },
  { key: "endowment_fund", group: "Endowment", groupShort: "Endowment", label: "Endowment fund", short: "Endow.", kind: "money" },
  { key: "students_undergraduate", group: "Student population", groupShort: "Students", label: "Undergraduates", short: "UG", kind: "count" },
  { key: "students_postgraduate", group: "Student population", groupShort: "Students", label: "Postgraduates", short: "PG", kind: "count" },
] as const;

export type IndicatorKey = (typeof INDICATORS)[number]["key"];
export const INDICATOR_KEYS = INDICATORS.map((i) => i.key) as IndicatorKey[];
export const indicatorByKey = (k: string) => INDICATORS.find((i) => i.key === k);
export const isIndicatorKey = (k: unknown): k is IndicatorKey => typeof k === "string" && INDICATOR_KEYS.includes(k as IndicatorKey);

export const INDICATOR_GROUPS = Array.from(new Set(INDICATORS.map((i) => i.group)));

export const ASSESSMENT_STATES = ["published", "not_found", "uncertain", "not_assessed", "not_applicable"] as const;
export type AssessmentState = (typeof ASSESSMENT_STATES)[number];

/** Public wording. "Not found" always says where we looked. */
export const STATE_LABEL: Record<AssessmentState, string> = {
  published: "Published, evidence checked",
  not_found: "Not found in the sources reviewed",
  uncertain: "Evidence uncertain",
  not_assessed: "Not yet assessed",
  not_applicable: "Not applicable, with reason",
};

export const STATE_SHORT: Record<AssessmentState, string> = {
  published: "Published",
  not_found: "Not found",
  uncertain: "Uncertain",
  not_assessed: "Not assessed",
  not_applicable: "Not applicable",
};

export const SUMMARY_LABELS = [
  "not_assessed",
  "assessment_incomplete",
  "evidence_uncertain",
  "all_applicable_published",
  "no_disclosures_found",
  "partial_disclosure",
  "no_applicable_indicators",
] as const;
export type SummaryLabel = (typeof SUMMARY_LABELS)[number];

export const SUMMARY_TEXT: Record<SummaryLabel, string> = {
  not_assessed: "Not assessed",
  assessment_incomplete: "Assessment incomplete",
  evidence_uncertain: "Evidence uncertain",
  all_applicable_published: "All applicable indicators published",
  no_disclosures_found: "No disclosures found in reviewed sources",
  partial_disclosure: "Partial disclosure",
  // Every indicator excluded with a reason. Neutral: it says nothing about what is disclosed.
  no_applicable_indicators: "No applicable indicators",
};

export const PERIOD_TYPES = ["financial_year", "academic_session", "multi_year", "unknown"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];
export const PERIOD_TYPE_LABEL: Record<PeriodType, string> = {
  financial_year: "Financial year",
  academic_session: "Academic session",
  multi_year: "Multi-year document",
  unknown: "Period unknown",
};

export const VALUE_SCALES = ["units", "thousands", "millions", "billions"] as const;
export type ValueScale = (typeof VALUE_SCALES)[number];

export const OWNERSHIP = ["federal", "state", "private", "unknown"] as const;
export type Ownership = (typeof OWNERSHIP)[number];
export const OWNERSHIP_LABEL: Record<Ownership, string> = { federal: "Federal", state: "State", private: "Private", unknown: "Ownership unknown" };

export const INSTITUTION_TYPES = ["university", "polytechnic", "monotechnic", "college", "other"] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];
export const INSTITUTION_TYPE_LABEL: Record<InstitutionType, string> = {
  university: "University", polytechnic: "Polytechnic", monotechnic: "Monotechnic", college: "College", other: "Other",
};

export const REVISION_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted for review",
  changes_requested: "Changes requested",
  approved: "Approved, not yet published",
  published: "Published",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
};

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
] as const;

// Display wording for the institution editor. Pure functions, safe for server and client code.
// Unknown stays unknown ("Not stated", "—"); a recorded zero is shown as zero.
import {
  INDICATORS, INSTITUTION_TYPE_LABEL, OWNERSHIP_LABEL, PERIOD_TYPE_LABEL,
  type InstitutionType, type Ownership, type PeriodType, type ValueScale,
} from "@/lib/indicators";
import { formatAmount, formatCalendarDate, formatCount } from "@/lib/format";

export const NOT_STATED = "Not stated";
export const NOT_RECORDED = "Not recorded";

export function ownershipText(v: string | null | undefined): string {
  return OWNERSHIP_LABEL[v as Ownership] ?? OWNERSHIP_LABEL.unknown;
}

export function typeText(v: string | null | undefined): string {
  return INSTITUTION_TYPE_LABEL[v as InstitutionType] ?? INSTITUTION_TYPE_LABEL.other;
}

type PeriodLike = {
  period_type?: string | null;
  period_label?: string | null;
  period_start?: string | null;
  period_end?: string | null;
};

/** "2025 · Financial year (1 Jan 2025 – 31 Dec 2025)" or "Not stated". */
export function periodText(p: PeriodLike): string {
  const label = p.period_label?.trim() || null;
  const type = p.period_type && p.period_type in PERIOD_TYPE_LABEL ? PERIOD_TYPE_LABEL[p.period_type as PeriodType] : null;
  let out: string;
  if (label && type) out = `${label} · ${type}`;
  else if (label) out = `${label} · period type not stated`;
  else if (type) out = `${type} · no label`;
  else return NOT_STATED;
  const start = p.period_start ? formatCalendarDate(p.period_start) : null;
  const end = p.period_end ? formatCalendarDate(p.period_end) : null;
  if (start || end) out += ` (${start ?? "start not stated"} – ${end ?? "end not stated"})`;
  return out;
}

type ValueLike = {
  key: string;
  value_amount?: string | number | null;
  value_scale?: string | null;
  value_currency?: string | null;
  value_count?: number | string | null;
};

/** The recorded value with scale and currency explicit, or "Not stated". */
export function valueText(v: ValueLike): string {
  const kind = INDICATORS.find((i) => i.key === v.key)?.kind ?? "money";
  const hasAmount = v.value_amount !== null && v.value_amount !== undefined && v.value_amount !== "";
  const hasCount = v.value_count !== null && v.value_count !== undefined && v.value_count !== "";
  if (kind === "count") return hasCount ? `${formatCount(v.value_count)} students` : NOT_STATED;
  return hasAmount ? formatAmount(v.value_amount, (v.value_scale as ValueScale | null) ?? null, v.value_currency ?? null) : NOT_STATED;
}

export function orDash(v: string | null | undefined): string {
  return v && v.trim() ? v : "—";
}

export function personName(team: { userId: string; displayName: string }[], id: string | null | undefined): string {
  if (!id) return "—";
  return team.find((t) => t.userId === id)?.displayName ?? "Former or unknown team member";
}

export const PROFILE_LABEL: Record<string, string> = {
  name: "Name",
  short_name: "Short name",
  ownership: "Ownership",
  institution_type: "Type",
  state: "State",
  city: "City or town",
  head_name: "Head of institution",
  head_title: "Head's title",
  bursar_name: "Bursar",
  website_url: "Official website",
  assessment_period: "Assessment period",
};

export const DECISION_LABEL: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected and returned",
};

export const SECTION_LABEL: Record<string, string> = {
  federal_university: "Federal universities",
  federal_polytechnic: "Federal polytechnics",
  federal_monotechnic: "Federal monotechnics",
  state_university: "State universities",
  state_polytechnic: "State polytechnics",
  state_monotechnic: "State monotechnics",
};

export const IMPORT_DECISION_LABEL: Record<string, string> = {
  pending: "No identity decision recorded",
  create_new: "Created as a new institution",
  match_existing: "Matched to this existing institution",
  skip: "Skipped",
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "institution.created": "Institution created",
  "institution.assigned": "Assignment changed",
  "revision.created": "Draft started",
  "revision.profile_saved": "Profile saved",
  "revision.indicator_saved": "Indicator saved",
  "revision.evidence_added": "Evidence added",
  "revision.evidence_removed": "Evidence removed",
  "revision.submitted": "Submitted for review",
  "revision.reviewed": "Review decision recorded",
  "revision.published": "Published",
  "publication.withdrawn": "Publication withdrawn",
  "revision.reopened": "Returned for changes after review",
  "source_host.suggested": "Official website suggested",
  "source_host.approved": "Official website approved",
  "source_host.revoked": "Official website approval revoked",
  "scan.requested": "Research scan requested",
  "scan.cancel_requested": "Research scan cancelled",
  "proposal.accepted": "Research proposal accepted into the draft",
  "proposal.rejected": "Research proposal rejected",
  "proposal.stale": "Research proposal out of date",
};

/** A short, safe description of an audit event's details (never a raw dump). */
export function auditDetail(action: string, d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof d.indicator === "string") {
    const def = INDICATORS.find((i) => i.key === d.indicator);
    parts.push(def ? `${def.group}: ${def.label}` : d.indicator);
    if (typeof d.state === "string") parts.push(`assessment set to ${d.state.replace(/_/g, " ")}`);
  }
  if (typeof d.decision === "string") parts.push(DECISION_LABEL[d.decision] ?? d.decision);
  if (d.self_review_override === true) parts.push("self-review override recorded");
  if (typeof d.release_number === "number") parts.push(`release ${d.release_number}`);
  if (action === "publication.withdrawn" && typeof d.reason === "string") parts.push(`reason: ${d.reason}`);
  if (action === "institution.assigned" && typeof d.due_on === "string") parts.push(`due ${formatCalendarDate(d.due_on)}`);
  return parts.join(" · ");
}

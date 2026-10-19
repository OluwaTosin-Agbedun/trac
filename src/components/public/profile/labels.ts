// Display wording for published snapshots. Pure functions; unknown stays unknown.
import {
  ASSESSMENT_STATES, INDICATORS, INSTITUTION_TYPE_LABEL, OWNERSHIP_LABEL, PERIOD_TYPE_LABEL, SUMMARY_LABELS,
  type AssessmentState, type InstitutionType, type Ownership, type PeriodType,
} from "@/lib/indicators";
import { summarise } from "@/lib/editorRules";
import { formatAmount, formatCount } from "@/lib/format";
import type { SnapshotIndicator, SnapshotPayload, SnapshotProfile, SnapshotSummary } from "@/lib/snapshot";

export const NOT_RECORDED = "Not recorded";

export function institutionName(profile: SnapshotProfile): string {
  return profile.name?.trim() || "Unnamed institution";
}

/** "Federal · University" */
export function eyebrowText(profile: SnapshotProfile): string {
  const own = OWNERSHIP_LABEL[profile.ownership as Ownership] ?? OWNERSHIP_LABEL.unknown;
  const type = INSTITUTION_TYPE_LABEL[profile.institution_type as InstitutionType] ?? INSTITUTION_TYPE_LABEL.other;
  return `${own} · ${type}`;
}

export function locationText(profile: SnapshotProfile): string | null {
  // Shown exactly as recorded; the state is never appended to or "corrected".
  const parts = [profile.city?.trim(), profile.state?.trim()].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function isState(v: unknown): v is AssessmentState {
  return typeof v === "string" && (ASSESSMENT_STATES as readonly string[]).includes(v);
}

export function stateOf(ind: Pick<SnapshotIndicator, "state"> | null | undefined): AssessmentState {
  return ind && isState(ind.state) ? ind.state : "not_assessed";
}

/** "2025 · Financial year", "Period unknown", or "Not stated". */
export function periodText(ind: Pick<SnapshotIndicator, "period_type" | "period_label">): string {
  const label = ind.period_label?.trim() || null;
  const type = ind.period_type && ind.period_type in PERIOD_TYPE_LABEL ? PERIOD_TYPE_LABEL[ind.period_type as PeriodType] : null;
  if (label && type && ind.period_type !== "unknown") return `${label} · ${type}`;
  if (label) return ind.period_type === "unknown" ? `${label} · Period type unknown` : label;
  if (ind.period_type === "unknown") return PERIOD_TYPE_LABEL.unknown;
  return "Not stated";
}

export function hasPeriod(ind: Pick<SnapshotIndicator, "period_type" | "period_label">): boolean {
  return Boolean(ind.period_label?.trim()) || Boolean(ind.period_type && ind.period_type !== "unknown");
}

/**
 * The extracted value, with scale and currency explicit. A published zero is shown as ₦0.
 * null → no value recorded (the caller decides whether to say "Not extracted").
 */
export function valueText(ind: SnapshotIndicator): string | null {
  const def = INDICATORS.find((i) => i.key === ind.key);
  const hasAmount = ind.value_amount !== null && ind.value_amount !== undefined && ind.value_amount !== "";
  const hasCount = ind.value_count !== null && ind.value_count !== undefined;
  if (def?.kind === "count" && hasCount) return formatCount(ind.value_count);
  if (hasAmount) return formatAmount(ind.value_amount, ind.value_scale, ind.value_currency);
  if (hasCount) return formatCount(ind.value_count);
  return null;
}

export function literalText(ind: SnapshotIndicator): string | null {
  return ind.value_literal?.trim() || null;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A release summary; releases published before the historical count was recorded lack it. */
export type DisplaySummary = SnapshotSummary & { historical?: number };

/**
 * The stored summary when present; otherwise the same counts derived from the indicators, by the
 * rules revision_summary uses in SQL (shared with the CMS through summarise()).
 */
export function summaryOf(payload: SnapshotPayload): DisplaySummary {
  const s = payload.summary;
  if (s && (SUMMARY_LABELS as readonly string[]).includes(s.label)) return s;
  const d = summarise(
    (payload.indicators ?? []).map((i) => ({ state: stateOf(i), period_label: i.period_label ?? null })),
    payload.profile?.assessment_period ?? null,
  );
  return {
    published: d.published, applicable: d.applicable, assessed: d.assessed, excluded: d.excluded,
    uncertain: d.uncertain, historical: d.historical, total: d.total, label: d.label,
  };
}

/** "7 of 9 applicable indicators published · 9 assessed · 0 excluded" */
export function countsText(s: SnapshotSummary): string {
  return `${s.published} of ${s.applicable} applicable indicator${s.applicable === 1 ? "" : "s"} published · ${s.assessed} assessed · ${s.excluded} excluded`;
}

/** Indicators in methodology order; anything missing from a release shows as not assessed. */
export function orderedIndicators(payload: SnapshotPayload): { group: string; items: SnapshotIndicator[] }[] {
  const byKey = new Map((payload.indicators ?? []).map((i) => [i.key as string, i]));
  const groups: { group: string; items: SnapshotIndicator[] }[] = [];
  for (const def of INDICATORS) {
    const ind: SnapshotIndicator = byKey.get(def.key) ?? {
      key: def.key, group: def.group, label: def.label, state: "not_assessed",
      period_type: null, period_label: null, period_start: null, period_end: null,
      value_amount: null, value_scale: null, value_currency: null, value_count: null, value_literal: null,
      reason: "No assessment of this indicator is recorded in this release.", evidence: [],
    };
    let g = groups.find((x) => x.group === def.group);
    if (!g) {
      g = { group: def.group, items: [] };
      groups.push(g);
    }
    g.items.push({ ...ind, label: def.label, group: def.group });
  }
  return groups;
}

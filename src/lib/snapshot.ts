// Shape of a published snapshot payload, as produced by revision_content(rev, true) plus the
// summary added by publish_revision. The database is the source; this narrows it for display.
import type { AssessmentState, IndicatorKey, PeriodType, SummaryLabel, ValueScale } from "./indicators";

export interface SnapshotEvidence {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  locator: string | null;
  document_period?: string | null;
  source_published_on?: string | null;
  captured_at: string | null;
}

export interface SnapshotIndicator {
  key: IndicatorKey;
  group: string;
  label: string;
  state: AssessmentState;
  period_type: PeriodType | null;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  value_amount: string | number | null;
  value_scale: ValueScale | null;
  value_currency: string | null;
  value_count: number | null;
  value_literal: string | null;
  reason: string | null;
  evidence: SnapshotEvidence[];
}

export interface SnapshotProfile {
  name: string | null;
  short_name: string | null;
  ownership: string;
  institution_type: string;
  state: string | null;
  city: string | null;
  head_name: string | null;
  head_title: string | null;
  bursar_name: string | null;
  website_url: string | null;
  assessment_period: string | null;
  methodology_version_id: string;
  last_verified_at: string | null;
}

export interface SnapshotSummary {
  published: number;
  applicable: number;
  assessed: number;
  excluded: number;
  uncertain: number;
  total: number;
  label: SummaryLabel;
}

export interface SnapshotPayload {
  profile: SnapshotProfile;
  indicators: SnapshotIndicator[];
  profile_evidence: SnapshotEvidence[];
  summary: SnapshotSummary;
  parent_institution_id?: string | null;
}

export interface PublishedSnapshot {
  id: string;
  institutionId: string;
  slug: string;
  releaseNumber: number;
  publishedAt: string;
  methodologyVersionId: string;
  isCurrent: boolean;
  payload: SnapshotPayload;
}

/** Only http(s) links are ever rendered as links; anything else is shown as text. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

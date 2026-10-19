import "server-only";
// Review queue and review detail. Every query runs as the signed-in member through asUser(), so
// RLS and the workflow functions decide access. Parameterised SQL only; DTOs, never raw rows.
import { asUser } from "../../db/index.ts";
import type { Viewer } from "../../auth/accounts.ts";
import type { AssessmentState, IndicatorKey, PeriodType, ValueScale } from "../../../lib/indicators.ts";
import type { SnapshotPayload } from "../../../lib/snapshot.ts";

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const day = (v: unknown): string | null => {
  const s = iso(v);
  return s ? s.slice(0, 10) : null;
};

export interface QueueItem {
  revisionId: string;
  institutionId: string;
  slug: string;
  name: string | null;
  revisionNumber: number;
  status: string;
  reviewCycle: number;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  reviewerName: string | null;
  waitingDays: number | null;
  mine: boolean;
  decidedAt: string | null;
  decidedByName: string | null;
  notes: string | null;
}

export interface RecentRelease {
  slug: string;
  name: string | null;
  releaseNumber: number;
  publishedAt: string;
  publishedByName: string | null;
  withdrawn: boolean;
}

export interface ReviewQueue {
  waiting: QueueItem[];
  approved: QueueItem[];
  returned: QueueItem[];
  published: RecentRelease[];
}

type QueueRaw = {
  revision_id: string; institution_id: string; slug: string; name: string | null; revision_number: number;
  status: string; review_cycle: number; submitted_at: Date | string | null; submitted_by: string | null;
  submitted_by_name: string | null; reviewer_name: string | null; waiting_days: number | null;
  decided_at: Date | string | null; decided_by_name: string | null; notes: string | null;
};

const QUEUE_SQL = `
  select r.id as revision_id, r.institution_id, i.slug, r.name, r.revision_number, r.status::text as status,
         r.review_cycle, r.submitted_at, r.submitted_by, sd.display_name as submitted_by_name,
         rd.display_name as reviewer_name,
         case when r.submitted_at is null then null
              else floor(extract(epoch from (now() - r.submitted_at)) / 86400)::int end as waiting_days,
         la.decided_at, ad.display_name as decided_by_name, la.notes
    from revisions r
    join institutions i on i.id = r.institution_id
    left join team_directory sd on sd.user_id = r.submitted_by
    left join assignments a on a.institution_id = r.institution_id and a.closed_at is null
    left join team_directory rd on rd.user_id = a.reviewer_id
    left join lateral (select decided_at, decided_by, notes from approvals ap
                        where ap.revision_id = r.id order by decided_at desc, id desc limit 1) la on true
    left join team_directory ad on ad.user_id = la.decided_by`;

function toItem(r: QueueRaw, viewer: Pick<Viewer, "userId">): QueueItem {
  return {
    revisionId: r.revision_id,
    institutionId: r.institution_id,
    slug: r.slug,
    name: txt(r.name),
    revisionNumber: Number(r.revision_number),
    status: r.status,
    reviewCycle: Number(r.review_cycle),
    submittedAt: iso(r.submitted_at),
    submittedBy: txt(r.submitted_by),
    submittedByName: txt(r.submitted_by_name),
    reviewerName: txt(r.reviewer_name),
    waitingDays: r.waiting_days === null ? null : Number(r.waiting_days),
    mine: r.submitted_by === viewer.userId,
    decidedAt: iso(r.decided_at),
    decidedByName: txt(r.decided_by_name),
    notes: txt(r.notes),
  };
}

export async function getReviewQueue(viewer: Pick<Viewer, "userId">): Promise<ReviewQueue> {
  return asUser(viewer.userId, async (tx) => {
    const waiting = await tx.query<QueueRaw>(`${QUEUE_SQL} where r.status = 'submitted' order by r.submitted_at asc nulls last`);
    const approved = await tx.query<QueueRaw>(`${QUEUE_SQL} where r.status = 'approved' order by la.decided_at asc nulls last`);
    const returned = await tx.query<QueueRaw>(
      `${QUEUE_SQL} where r.status = 'changes_requested' and la.decided_at > now() - interval '30 days'
       order by la.decided_at desc limit 25`);
    const published = await tx.query<{
      slug: string; name: string | null; release_number: number; published_at: Date | string;
      published_by_name: string | null; withdrawn_at: Date | string | null;
    }>(
      `select s.slug, s.payload->'profile'->>'name' as name, s.release_number, s.published_at,
              d.display_name as published_by_name, s.withdrawn_at
         from published_snapshots s left join team_directory d on d.user_id = s.published_by
        order by s.published_at desc limit 10`);
    return {
      waiting: waiting.map((r) => toItem(r, viewer)),
      approved: approved.map((r) => toItem(r, viewer)),
      returned: returned.map((r) => toItem(r, viewer)),
      published: published.map((p) => ({
        slug: p.slug, name: txt(p.name), releaseNumber: Number(p.release_number),
        publishedAt: iso(p.published_at) as string, publishedByName: txt(p.published_by_name), withdrawn: p.withdrawn_at !== null,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Review detail
// ---------------------------------------------------------------------------

export interface ReviewIndicator {
  key: IndicatorKey;
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

export interface ReviewEvidence {
  id: string;
  indicator_key: string | null;
  url: string;
  title: string | null;
  excerpt: string | null;
  locator: string | null;
  document_period: string | null;
  is_public: boolean;
}

export interface ReviewApproval {
  decision: string;
  decidedByName: string | null;
  decidedAt: string;
  notes: string | null;
  overrideReason: string | null;
  contentHash: string;
}

export interface ReviewDetail {
  revisionId: string;
  institutionId: string;
  slug: string;
  number: number;
  status: string;
  reviewCycle: number;
  contentHash: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  waitingDays: number | null;
  baseRevisionId: string | null;
  isLatest: boolean;
  profile: Record<string, string | null>;
  indicators: ReviewIndicator[];
  evidence: ReviewEvidence[];
  approvals: ReviewApproval[];
  published: { releaseNumber: number; publishedAt: string; payload: SnapshotPayload } | null;
  hasCurrentRelease: boolean;
}

export const PROFILE_KEYS = [
  "name", "short_name", "ownership", "institution_type", "state", "city", "head_name", "head_title",
  "bursar_name", "website_url", "assessment_period", "last_verified_at",
] as const;

export async function getReviewDetail(viewer: Pick<Viewer, "userId">, revisionId: string): Promise<ReviewDetail | null> {
  return asUser(viewer.userId, async (tx) => {
    const [r] = await tx.query<Record<string, unknown>>(
      `select r.*, r.status::text as status_text, r.ownership::text as ownership_text,
              r.institution_type::text as type_text, i.slug, sd.display_name as submitted_by_name,
              case when r.submitted_at is null then null
                   else floor(extract(epoch from (now() - r.submitted_at)) / 86400)::int end as waiting_days,
              (select max(revision_number) from revisions x where x.institution_id = r.institution_id) as max_number
         from revisions r join institutions i on i.id = r.institution_id
         left join team_directory sd on sd.user_id = r.submitted_by
        where r.id = $1`, [revisionId]);
    if (!r) return null;
    const indicators = await tx.query<Record<string, unknown>>(
      `select ri.*, ri.state::text as state_text, ri.period_type::text as period_type_text, ri.value_scale::text as scale_text
         from revision_indicators ri join indicator_definitions d on d.key = ri.indicator_key
        where ri.revision_id = $1 order by d.sort_order`, [revisionId]);
    const evidence = await tx.query<Record<string, unknown>>(
      `select id, indicator_key, url, title, excerpt, locator, document_period, is_public
         from evidence_links where revision_id = $1 order by created_at, id`, [revisionId]);
    const approvals = await tx.query<Record<string, unknown>>(
      `select a.decision::text as decision, d.display_name, a.decided_at, a.notes, a.self_review_override_reason, a.content_hash
         from approvals a left join team_directory d on d.user_id = a.decided_by
        where a.revision_id = $1 order by a.decided_at desc, a.id desc`, [revisionId]);
    const [pub] = await tx.query<{ release_number: number; published_at: Date | string; payload: SnapshotPayload }>(
      `select release_number, published_at, payload from published_snapshots
        where institution_id = $1 and is_current`, [r.institution_id]);
    const profile: Record<string, string | null> = {};
    for (const k of PROFILE_KEYS) {
      const raw = k === "ownership" ? r.ownership_text : k === "institution_type" ? r.type_text : r[k];
      profile[k] = k === "last_verified_at" ? day(raw) : txt(raw);
    }
    return {
      revisionId: String(r.id),
      institutionId: String(r.institution_id),
      slug: String(r.slug),
      number: Number(r.revision_number),
      status: String(r.status_text),
      reviewCycle: Number(r.review_cycle),
      contentHash: txt(r.content_hash),
      submittedAt: iso(r.submitted_at),
      submittedBy: txt(r.submitted_by),
      submittedByName: txt(r.submitted_by_name),
      waitingDays: r.waiting_days === null || r.waiting_days === undefined ? null : Number(r.waiting_days),
      baseRevisionId: txt(r.base_revision_id),
      isLatest: Number(r.max_number) === Number(r.revision_number),
      profile,
      indicators: indicators.map((i) => ({
        key: String(i.indicator_key) as IndicatorKey,
        state: String(i.state_text) as AssessmentState,
        period_type: (txt(i.period_type_text) as PeriodType | null),
        period_label: txt(i.period_label),
        period_start: day(i.period_start),
        period_end: day(i.period_end),
        value_amount: txt(i.value_amount),
        value_scale: (txt(i.scale_text) as ValueScale | null),
        value_currency: txt(i.value_currency),
        value_count: i.value_count === null || i.value_count === undefined ? null : Number(i.value_count),
        value_literal: txt(i.value_literal),
        reason: txt(i.reason),
        internal_note: txt(i.internal_note),
      })),
      evidence: evidence.map((e) => ({
        id: String(e.id), indicator_key: txt(e.indicator_key), url: String(e.url), title: txt(e.title),
        excerpt: txt(e.excerpt), locator: txt(e.locator), document_period: txt(e.document_period), is_public: Boolean(e.is_public),
      })),
      approvals: approvals.map((a) => ({
        decision: String(a.decision), decidedByName: txt(a.display_name), decidedAt: iso(a.decided_at) as string,
        notes: txt(a.notes), overrideReason: txt(a.self_review_override_reason), contentHash: String(a.content_hash),
      })),
      published: pub ? { releaseNumber: Number(pub.release_number), publishedAt: iso(pub.published_at) as string, payload: pub.payload } : null,
      hasCurrentRelease: Boolean(pub),
    };
  });
}

/** The exact public payload this revision would publish (built by the database). */
export async function getPreview(viewer: Pick<Viewer, "userId">, revisionId: string): Promise<{
  payload: SnapshotPayload; slug: string; institutionId: string; number: number; status: string; nextRelease: number;
} | null> {
  return asUser(viewer.userId, async (tx) => {
    const [r] = await tx.query<{ institution_id: string; slug: string; revision_number: number; status: string; next_release: number }>(
      `select r.institution_id, i.slug, r.revision_number, r.status::text as status,
              coalesce((select max(release_number) from published_snapshots s where s.institution_id = r.institution_id), 0) + 1 as next_release
         from revisions r join institutions i on i.id = r.institution_id where r.id = $1`, [revisionId]);
    if (!r) return null;
    const [p] = await tx.query<{ payload: SnapshotPayload }>("select preview_revision($1) as payload", [revisionId]);
    return { payload: p.payload, slug: r.slug, institutionId: r.institution_id, number: Number(r.revision_number), status: r.status, nextRelease: Number(r.next_release) };
  });
}

export async function slugForRevision(viewer: Pick<Viewer, "userId">, revisionId: string): Promise<string | null> {
  return asUser(viewer.userId, async (tx) => {
    const [r] = await tx.query<{ slug: string }>(
      "select i.slug from revisions r join institutions i on i.id = r.institution_id where r.id = $1", [revisionId]);
    return r?.slug ?? null;
  });
}

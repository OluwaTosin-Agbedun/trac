import "server-only";
// Data for the CMS institution editor. Every query runs as the signed-in team member (asUser), so
// grants and RLS decide what is visible: editors get no audit events, nobody gets credentials.
// Calendar dates are converted to yyyy-mm-dd text in SQL (drivers otherwise turn them into
// local-midnight Date objects); numerics come back as text so amounts are never rounded.
import { asUser, type Queryable } from "@/server/db";
import type { Viewer } from "@/server/auth/session";
import {
  ASSESSMENT_STATES, INDICATOR_KEYS, PERIOD_TYPES, VALUE_SCALES,
  type AssessmentState, type IndicatorKey, type PeriodType, type ValueScale,
} from "@/lib/indicators";
import type { SnapshotPayload } from "@/lib/snapshot";
import { toDateInput } from "@/lib/editorRules";

export type RevisionStatus =
  | "draft" | "submitted" | "changes_requested" | "approved" | "published" | "superseded" | "withdrawn";

export interface TeamPerson {
  userId: string;
  displayName: string;
  role: string;
  active: boolean;
}

export interface EditorProfile {
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
}

export interface EditorRevision {
  id: string;
  number: number;
  status: RevisionStatus;
  lockVersion: number;
  reviewCycle: number;
  baseRevisionId: string | null;
  methodologyVersionId: string;
  profile: EditorProfile;
  legacyReportStatus: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
}

export interface EditorIndicator {
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

export interface EditorEvidence {
  id: string;
  indicator_key: string | null;
  url: string;
  title: string | null;
  excerpt: string | null;
  locator: string | null;
  document_period: string | null;
  source_published_on: string | null;
  captured_at: string | null;
  /** Capture date in Lagos, yyyy-mm-dd. */
  captured_on: string | null;
  is_public: boolean;
  created_at: string;
  created_by: string | null;
}

export interface PublishedRelease {
  snapshotId: string;
  revisionId: string;
  releaseNumber: number;
  publishedAt: string;
  slug: string;
  methodologyVersionId: string;
  payload: SnapshotPayload;
}

export interface WithdrawnRelease {
  releaseNumber: number;
  withdrawnAt: string;
  reason: string | null;
  withdrawnBy: string | null;
}

export interface CurrentAssignment {
  editorId: string | null;
  reviewerId: string | null;
  dueOn: string | null;
  assignedAt: string;
  assignedBy: string | null;
}

export interface ReviewDecision {
  id: string;
  revisionId: string;
  revisionNumber: number;
  decision: string;
  decidedBy: string;
  decidedAt: string;
  notes: string | null;
  overrideReason: string | null;
}

export interface LegacyIssue {
  code: string;
  detail: string;
  holds: boolean;
}

export interface LegacyImportRow {
  id: string;
  fileName: string;
  reportedAsOf: string | null;
  uploadedAt: string;
  section: string;
  sourceLine: number;
  serialRaw: string;
  nameRaw: string | null;
  stateRaw: string | null;
  websiteRaw: string | null;
  legacyStatusRaw: string | null;
  /** Unverified legacy claims: true / false / null (blank). Never findings. */
  legacy: Partial<Record<IndicatorKey, boolean | null>>;
  issues: LegacyIssue[];
  held: boolean;
  decision: string;
  decisionNote: string | null;
}

export interface EditorData {
  institution: { id: string; slug: string; createdAt: string; archivedAt: string | null };
  latest: EditorRevision | null;
  indicators: EditorIndicator[];
  evidence: EditorEvidence[];
  published: PublishedRelease | null;
  withdrawn: WithdrawnRelease | null;
  assignment: CurrentAssignment | null;
  team: TeamPerson[];
  /** Review decisions on the latest revision, newest first (return notes live here). */
  latestReviews: ReviewDecision[];
  legacy: LegacyImportRow[];
}

export interface RevisionHistoryRow {
  id: string;
  number: number;
  status: RevisionStatus;
  reviewCycle: number;
  createdAt: string;
  createdBy: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
}

export interface AuditRow {
  id: string;
  at: string;
  actorId: string | null;
  action: string;
  entityType: string;
  details: Record<string, unknown>;
}

export interface EditorHistory {
  revisions: RevisionHistoryRow[];
  approvals: ReviewDecision[];
  audit: AuditRow[];
  team: TeamPerson[];
}

// ---------------------------------------------------------------------------
// Narrowing helpers (rows are typed loosely; never trust their shape blindly)
// ---------------------------------------------------------------------------

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}

function isoOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : iso(v);
}

function text(v: unknown): string | null {
  return typeof v === "string" ? v : v === null || v === undefined ? null : String(v);
}

function pick<T extends string>(v: unknown, list: readonly T[]): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}

function obj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v) as unknown;
      return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v) as unknown;
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function teamDirectory(tx: Queryable): Promise<TeamPerson[]> {
  const rows = await tx.query<{ user_id: string; display_name: string; role: string; active: boolean }>(
    "select user_id, display_name, role::text as role, active from team_directory order by display_name",
  );
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, role: r.role, active: r.active }));
}

const REVIEW_COLS = `a.id, a.revision_id, r.revision_number, a.decision::text as decision, a.decided_by, a.decided_at,
  a.notes, a.self_review_override_reason`;

type ReviewRaw = {
  id: string; revision_id: string; revision_number: number; decision: string; decided_by: string; decided_at: Date | string;
  notes: string | null; self_review_override_reason: string | null;
};

function toReview(r: ReviewRaw): ReviewDecision {
  return {
    id: r.id,
    revisionId: r.revision_id,
    revisionNumber: Number(r.revision_number),
    decision: r.decision,
    decidedBy: r.decided_by,
    decidedAt: iso(r.decided_at),
    notes: r.notes,
    overrideReason: r.self_review_override_reason,
  };
}

// ---------------------------------------------------------------------------
// Editor data
// ---------------------------------------------------------------------------

/** Everything the editor screen needs, in one transaction. null when the institution is not visible. */
export async function getEditorData(viewer: Viewer, institutionId: string): Promise<EditorData | null> {
  return asUser(viewer.userId, async (tx) => {
    const inst = await tx.query<{ id: string; slug: string; created_at: Date | string; archived_at: Date | string | null }>(
      "select id, slug, created_at, archived_at from institutions where id = $1",
      [institutionId],
    );
    if (!inst.length) return null;

    const revRows = await tx.query<Record<string, unknown>>(
      `select r.id, r.revision_number, r.status::text as status, r.lock_version, r.review_cycle, r.base_revision_id,
              r.methodology_version_id, r.name, r.short_name, r.ownership::text as ownership,
              r.institution_type::text as institution_type, r.state, r.city, r.head_name, r.head_title, r.bursar_name,
              r.website_url, r.assessment_period, r.legacy_report_status, r.last_verified_at, r.created_at, r.created_by,
              r.updated_at, r.updated_by, r.submitted_at, r.submitted_by
         from revisions r
        where r.institution_id = $1
        order by r.revision_number desc
        limit 1`,
      [institutionId],
    );
    const r = revRows[0];
    const latest: EditorRevision | null = r
      ? {
          id: String(r.id),
          number: Number(r.revision_number),
          status: String(r.status) as RevisionStatus,
          lockVersion: Number(r.lock_version),
          reviewCycle: Number(r.review_cycle),
          baseRevisionId: text(r.base_revision_id),
          methodologyVersionId: String(r.methodology_version_id),
          profile: {
            name: text(r.name),
            short_name: text(r.short_name),
            ownership: String(r.ownership),
            institution_type: String(r.institution_type),
            state: text(r.state),
            city: text(r.city),
            head_name: text(r.head_name),
            head_title: text(r.head_title),
            bursar_name: text(r.bursar_name),
            website_url: text(r.website_url),
            assessment_period: text(r.assessment_period),
          },
          legacyReportStatus: text(r.legacy_report_status),
          lastVerifiedAt: isoOrNull(r.last_verified_at),
          createdAt: iso(r.created_at),
          createdBy: text(r.created_by),
          updatedAt: iso(r.updated_at),
          updatedBy: text(r.updated_by),
          submittedAt: isoOrNull(r.submitted_at),
          submittedBy: text(r.submitted_by),
        }
      : null;

    let indicators: EditorIndicator[] = [];
    let evidence: EditorEvidence[] = [];
    let latestReviews: ReviewDecision[] = [];
    if (latest) {
      const indRows = await tx.query<Record<string, unknown>>(
        `select ri.indicator_key as key, ri.state::text as state, ri.period_type::text as period_type, ri.period_label,
                to_char(ri.period_start, 'YYYY-MM-DD') as period_start, to_char(ri.period_end, 'YYYY-MM-DD') as period_end,
                ri.value_amount::text as value_amount, ri.value_scale::text as value_scale, ri.value_currency,
                ri.value_count, ri.value_literal, ri.reason, ri.internal_note
           from revision_indicators ri
           join indicator_definitions d on d.key = ri.indicator_key
          where ri.revision_id = $1
          order by d.sort_order`,
        [latest.id],
      );
      indicators = indRows
        .filter((x) => pick(x.key, INDICATOR_KEYS))
        .map((x) => ({
          key: x.key as IndicatorKey,
          state: pick(x.state, ASSESSMENT_STATES) ?? "not_assessed",
          period_type: pick(x.period_type, PERIOD_TYPES),
          period_label: text(x.period_label),
          period_start: text(x.period_start),
          period_end: text(x.period_end),
          value_amount: text(x.value_amount),
          value_scale: pick(x.value_scale, VALUE_SCALES),
          value_currency: text(x.value_currency)?.trim() || null,
          value_count: x.value_count === null || x.value_count === undefined ? null : Number(x.value_count),
          value_literal: text(x.value_literal),
          reason: text(x.reason),
          internal_note: text(x.internal_note),
        }));

      const evRows = await tx.query<Record<string, unknown>>(
        `select e.id, e.indicator_key, e.url, e.title, e.excerpt, e.locator, e.document_period,
                to_char(e.source_published_on, 'YYYY-MM-DD') as source_published_on, e.captured_at, e.is_public,
                e.created_at, e.created_by
           from evidence_links e
          where e.revision_id = $1
          order by e.created_at, e.id`,
        [latest.id],
      );
      evidence = evRows.map((e) => {
        const captured = isoOrNull(e.captured_at);
        return {
          id: String(e.id),
          indicator_key: text(e.indicator_key),
          url: String(e.url),
          title: text(e.title),
          excerpt: text(e.excerpt),
          locator: text(e.locator),
          document_period: text(e.document_period),
          source_published_on: text(e.source_published_on),
          captured_at: captured,
          captured_on: captured ? toDateInput(captured) || null : null,
          is_public: e.is_public === true,
          created_at: iso(e.created_at),
          created_by: text(e.created_by),
        };
      });

      const reviews = await tx.query<ReviewRaw>(
        `select ${REVIEW_COLS}
           from approvals a join revisions r on r.id = a.revision_id
          where a.revision_id = $1
          order by a.decided_at desc, a.id desc`,
        [latest.id],
      );
      latestReviews = reviews.map(toReview);
    }

    const snap = await tx.query<{
      id: string; revision_id: string; release_number: number; published_at: Date | string; slug: string;
      methodology_version_id: string; payload: unknown;
    }>(
      `select id, revision_id, release_number, published_at, slug, methodology_version_id, payload
         from published_snapshots
        where institution_id = $1 and is_current and withdrawn_at is null
        limit 1`,
      [institutionId],
    );
    const published: PublishedRelease | null = snap[0]
      ? {
          snapshotId: snap[0].id,
          revisionId: snap[0].revision_id,
          releaseNumber: Number(snap[0].release_number),
          publishedAt: iso(snap[0].published_at),
          slug: snap[0].slug,
          methodologyVersionId: snap[0].methodology_version_id,
          payload: obj(snap[0].payload) as unknown as SnapshotPayload,
        }
      : null;

    let withdrawn: WithdrawnRelease | null = null;
    if (!published) {
      const w = await tx.query<{ release_number: number; withdrawn_at: Date | string; withdrawn_reason: string | null; withdrawn_by: string | null }>(
        `select release_number, withdrawn_at, withdrawn_reason, withdrawn_by
           from published_snapshots
          where institution_id = $1 and withdrawn_at is not null
          order by withdrawn_at desc
          limit 1`,
        [institutionId],
      );
      if (w[0]) {
        withdrawn = {
          releaseNumber: Number(w[0].release_number),
          withdrawnAt: iso(w[0].withdrawn_at),
          reason: w[0].withdrawn_reason,
          withdrawnBy: w[0].withdrawn_by,
        };
      }
    }

    const asg = await tx.query<{ editor_id: string | null; reviewer_id: string | null; due_on: string | null; assigned_at: Date | string; assigned_by: string | null }>(
      `select editor_id, reviewer_id, to_char(due_on, 'YYYY-MM-DD') as due_on, assigned_at, assigned_by
         from assignments
        where institution_id = $1 and closed_at is null
        order by assigned_at desc
        limit 1`,
      [institutionId],
    );
    const assignment: CurrentAssignment | null = asg[0]
      ? {
          editorId: asg[0].editor_id,
          reviewerId: asg[0].reviewer_id,
          dueOn: asg[0].due_on,
          assignedAt: iso(asg[0].assigned_at),
          assignedBy: asg[0].assigned_by,
        }
      : null;

    const legacyRows = await tx.query<Record<string, unknown>>(
      `select ir.id, i.file_name, to_char(i.source_reported_as_of, 'YYYY-MM-DD') as reported_as_of, i.uploaded_at,
              ir.section, ir.source_line, ir.serial_raw, ir.mapped, ir.legacy_indicators, ir.issues, ir.held,
              ir.decision::text as decision, ir.decision_note
         from import_rows ir
         join imports i on i.id = ir.import_id
        where ir.institution_id = $1
        order by i.uploaded_at, ir.source_line`,
      [institutionId],
    );
    const legacy: LegacyImportRow[] = legacyRows.map((x) => {
      const mapped = obj(x.mapped);
      const claims = obj(x.legacy_indicators);
      const legacyClaims: Partial<Record<IndicatorKey, boolean | null>> = {};
      for (const k of INDICATOR_KEYS) {
        if (k in claims) {
          const v = claims[k];
          legacyClaims[k] = typeof v === "boolean" ? v : null;
        }
      }
      return {
        id: String(x.id),
        fileName: String(x.file_name),
        reportedAsOf: text(x.reported_as_of),
        uploadedAt: iso(x.uploaded_at),
        section: String(x.section),
        sourceLine: Number(x.source_line),
        serialRaw: String(x.serial_raw ?? ""),
        nameRaw: text(mapped.name),
        stateRaw: text(mapped.stateRaw),
        websiteRaw: text(mapped.websiteRaw),
        legacyStatusRaw: text(mapped.legacyStatusRaw),
        legacy: legacyClaims,
        issues: arr(x.issues).map((i) => {
          const o = obj(i);
          return { code: String(o.code ?? ""), detail: String(o.detail ?? ""), holds: o.holds === true };
        }),
        held: x.held === true,
        decision: String(x.decision ?? "pending"),
        decisionNote: text(x.decision_note),
      };
    });

    return {
      institution: {
        id: inst[0].id,
        slug: inst[0].slug,
        createdAt: iso(inst[0].created_at),
        archivedAt: isoOrNull(inst[0].archived_at),
      },
      latest,
      indicators,
      evidence,
      published,
      withdrawn,
      assignment,
      team: await teamDirectory(tx),
      latestReviews,
      legacy,
    };
  });
}

/**
 * Revisions, review decisions and the last 20 audit events for one institution. Audit events are
 * readable by reviewers and administrators only; for editors RLS returns no rows.
 */
export async function getEditorHistory(viewer: Viewer, institutionId: string): Promise<EditorHistory> {
  return asUser(viewer.userId, async (tx) => {
    const revs = await tx.query<{
      id: string; revision_number: number; status: string; review_cycle: number; created_at: Date | string;
      created_by: string | null; submitted_at: Date | string | null; submitted_by: string | null;
    }>(
      `select id, revision_number, status::text as status, review_cycle, created_at, created_by, submitted_at, submitted_by
         from revisions
        where institution_id = $1
        order by revision_number desc`,
      [institutionId],
    );
    const approvals = await tx.query<ReviewRaw>(
      `select ${REVIEW_COLS}
         from approvals a join revisions r on r.id = a.revision_id
        where r.institution_id = $1
        order by a.decided_at desc, a.id desc`,
      [institutionId],
    );
    let audit: AuditRow[] = [];
    if (viewer.role === "reviewer" || viewer.role === "admin") {
      const rows = await tx.query<{
        id: string | number; at: Date | string; actor_id: string | null; action: string; entity_type: string; details: unknown;
      }>(
        `select ae.id::text as id, ae.at, ae.actor_id, ae.action, ae.entity_type, ae.details
           from audit_events ae
          where (ae.entity_type = 'revision'
                 and ae.entity_id in (select id from revisions where institution_id = $1))
             or (ae.entity_type = 'institution' and ae.entity_id = $1)
          order by ae.at desc, ae.id desc
          limit 20`,
        [institutionId],
      );
      audit = rows.map((a) => ({
        id: String(a.id),
        at: iso(a.at),
        actorId: a.actor_id,
        action: a.action,
        entityType: a.entity_type,
        details: obj(a.details),
      }));
    }
    return {
      revisions: revs.map((x) => ({
        id: x.id,
        number: Number(x.revision_number),
        status: x.status as RevisionStatus,
        reviewCycle: Number(x.review_cycle),
        createdAt: iso(x.created_at),
        createdBy: x.created_by,
        submittedAt: isoOrNull(x.submitted_at),
        submittedBy: x.submitted_by,
      })),
      approvals: approvals.map(toReview),
      audit,
      team: await teamDirectory(tx),
    };
  });
}

/** Minimal facts an action needs before validating (state outside the list may be kept). */
export async function getRevisionState(viewer: Viewer, revisionId: string): Promise<{ state: string | null } | null> {
  return asUser(viewer.userId, async (tx) => {
    const rows = await tx.query<{ state: string | null }>("select state from revisions where id = $1", [revisionId]);
    return rows[0] ? { state: rows[0].state } : null;
  });
}

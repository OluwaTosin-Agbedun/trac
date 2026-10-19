import "server-only";
// Team-side data access for the CMS dashboard and institution directory. Every query runs through
// asUser(), i.e. as nut_member with the verified user id, so RLS and the workflow functions' own
// role checks decide what each team member can see and do. Parameterised SQL only.
//
// Relative imports (no "@/") keep this loadable by node for local checks.
import { asUser, type Queryable } from "../../db/index.ts";
import type { Viewer } from "../../auth/accounts.ts";
import {
  CMS_PAGE_SIZE, STALE_REVIEW_DAYS, type CmsInstitutionFilters, type RevisionStatus,
} from "../../../lib/cmsDirectory.ts";
import { NIGERIAN_STATES, type InstitutionType, type Ownership } from "../../../lib/indicators.ts";

type Who = Pick<Viewer, "userId" | "role">;

/** Calendar "today" in Nigeria (WAT, UTC+1, no daylight saving). Due dates are compared to it. */
const TODAY_SQL = "(now() at time zone 'Africa/Lagos')::date";

/** The latest revision of every institution (highest revision_number). Enum columns as text. */
const LATEST_CTE = `latest as (
  select distinct on (r.institution_id)
         r.id, r.institution_id, r.revision_number, r.status::text as status, r.name,
         r.ownership::text as ownership, r.institution_type::text as institution_type, r.state,
         r.last_verified_at, r.updated_at, r.created_by, r.submitted_at, r.submitted_by, r.review_cycle
    from revisions r
   order by r.institution_id, r.revision_number desc)`;

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ---------------------------------------------------------------------------
// Team directory
// ---------------------------------------------------------------------------

export interface TeamMember {
  userId: string;
  displayName: string;
  role: "editor" | "reviewer" | "admin";
  active: boolean;
}

/** Editors, reviewers and administrators (names only; never emails or credentials). */
export async function listTeam(viewer: Who): Promise<TeamMember[]> {
  const rows = await asUser(viewer.userId, (tx) =>
    tx.query<{ user_id: string; display_name: string; role: TeamMember["role"]; active: boolean }>(
      `select user_id, display_name, role::text as role, active
         from team_directory
        where role in ('editor', 'reviewer', 'admin')
        order by active desc, lower(display_name), user_id`));
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, role: r.role, active: r.active }));
}

// ---------------------------------------------------------------------------
// Institution directory
// ---------------------------------------------------------------------------

export interface CmsInstitutionRow {
  id: string;
  slug: string;
  archived: boolean;
  revisionId: string;
  revisionNumber: number;
  status: RevisionStatus;
  name: string | null;
  ownership: Ownership;
  institutionType: InstitutionType;
  state: string | null;
  lastVerifiedAt: string | null;
  updatedAt: string | null;
  releaseNumber: number | null;
  releasedAt: string | null;
  /** Name in the current public release, when one exists (may differ from a newer draft). */
  publishedName: string | null;
  /** Latest withdrawn release, shown when nothing is currently published. */
  withdrawnRelease: number | null;
  editorId: string | null;
  editorName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  dueOn: string | null;
  overdue: boolean;
}

type RawRow = {
  id: string; slug: string; archived_at: Date | string | null; revision_id: string; revision_number: number;
  status: RevisionStatus; name: string | null; ownership: Ownership; institution_type: InstitutionType;
  state: string | null; last_verified_at: Date | string | null; updated_at: Date | string | null;
  release_number: number | null; published_at: Date | string | null; published_name: string | null;
  withdrawn_release: number | null;
  editor_id: string | null; reviewer_id: string | null; due_on: string | null;
  editor_name: string | null; reviewer_name: string | null; overdue: boolean;
};

const DIRECTORY_FROM = `
  from institutions i
  join latest l on l.institution_id = i.id
  left join (select institution_id, release_number, published_at, payload->'profile'->>'name' as published_name
               from published_snapshots where is_current) cur on cur.institution_id = i.id
  left join (select institution_id, max(release_number) as release_number
               from published_snapshots where withdrawn_at is not null
              group by institution_id) gone on gone.institution_id = i.id
  left join (select institution_id, editor_id, reviewer_id, due_on
               from assignments where closed_at is null) a on a.institution_id = i.id`;

export async function listCmsInstitutions(viewer: Who, f: CmsInstitutionFilters): Promise<{
  rows: CmsInstitutionRow[]; total: number; page: number; pageSize: number;
}> {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = ["true"];
  if (f.q) {
    const like = p(`%${escapeLike(f.q)}%`);
    where.push(`(l.name ilike ${like} or i.slug ilike ${like})`);
  }
  if (f.status) where.push(`l.status = ${p(f.status)}`);
  if (f.ownership) where.push(`l.ownership = ${p(f.ownership)}`);
  if (f.type) where.push(`l.institution_type = ${p(f.type)}`);
  if (f.state === "none") where.push("l.state is null");
  else if (f.state) where.push(`l.state = ${p(f.state)}`);
  if (f.assignee === "none") where.push("a.editor_id is null");
  else if (f.assignee) {
    const who = p(f.assignee === "me" ? viewer.userId : f.assignee);
    where.push(`(a.editor_id = ${who}::uuid or a.reviewer_id = ${who}::uuid)`);
  }
  if (f.published === "yes") where.push("cur.release_number is not null");
  else if (f.published === "no") where.push("cur.release_number is null");

  const order = f.sort === "updated"
    ? "l.updated_at desc, i.id"
    : "lower(coalesce(l.name, i.slug)) asc, i.id";
  const page = f.page > 0 ? f.page : 1;
  const offset = (page - 1) * CMS_PAGE_SIZE;
  const whereSql = where.join(" and ");

  return asUser(viewer.userId, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>(
      `with ${LATEST_CTE} select count(*)::int as n ${DIRECTORY_FROM} where ${whereSql}`, params);
    const rows = await tx.query<RawRow>(
      `with ${LATEST_CTE}
       select i.id, i.slug, i.archived_at, l.id as revision_id, l.revision_number, l.status, l.name,
              l.ownership, l.institution_type, l.state, l.last_verified_at, l.updated_at,
              cur.release_number, cur.published_at, cur.published_name, gone.release_number as withdrawn_release,
              a.editor_id, a.reviewer_id, a.due_on::text as due_on,
              ed.display_name as editor_name, rv.display_name as reviewer_name,
              coalesce(a.due_on < ${TODAY_SQL}, false) as overdue
       ${DIRECTORY_FROM}
       left join team_directory ed on ed.user_id = a.editor_id
       left join team_directory rv on rv.user_id = a.reviewer_id
       where ${whereSql}
       order by ${order}
       limit ${CMS_PAGE_SIZE} offset ${offset}`, params);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        archived: r.archived_at !== null,
        revisionId: r.revision_id,
        revisionNumber: num(r.revision_number),
        status: r.status,
        name: r.name,
        ownership: r.ownership,
        institutionType: r.institution_type,
        state: r.state,
        lastVerifiedAt: iso(r.last_verified_at),
        updatedAt: iso(r.updated_at),
        releaseNumber: numOrNull(r.release_number),
        releasedAt: iso(r.published_at),
        publishedName: r.published_name,
        withdrawnRelease: numOrNull(r.withdrawn_release),
        editorId: r.editor_id,
        editorName: r.editor_name,
        reviewerId: r.reviewer_id,
        reviewerName: r.reviewer_name,
        dueOn: r.due_on,
        overdue: Boolean(r.overdue),
      })),
      total: n,
      page,
      pageSize: CMS_PAGE_SIZE,
    };
  });
}

/** Nigerian states plus any other value present on a latest revision, for the state filter. */
export async function listStateOptions(viewer: Who): Promise<string[]> {
  const rows = await asUser(viewer.userId, (tx) =>
    tx.query<{ state: string }>(
      `with ${LATEST_CTE} select distinct state from latest where state is not null`));
  const all = new Set<string>(NIGERIAN_STATES);
  for (const r of rows) if (r.state.length <= 40) all.add(r.state);
  return Array.from(all).sort((a, b) => a.localeCompare(b, "en"));
}

// ---------------------------------------------------------------------------
// Create and assign (called by server actions after their own checks)
// ---------------------------------------------------------------------------

/** Institutions whose latest name matches, ignoring case and punctuation. */
export async function findInstitutionsNamed(viewer: Who, name: string): Promise<{ id: string; name: string }[]> {
  return asUser(viewer.userId, (tx) =>
    tx.query<{ id: string; name: string }>(
      `with ${LATEST_CTE}
       select l.institution_id as id, l.name
         from latest l
        where btrim(regexp_replace(lower(coalesce(l.name, '')), '[^a-z0-9]+', ' ', 'g'))
            = btrim(regexp_replace(lower($1::text), '[^a-z0-9]+', ' ', 'g'))
          and btrim(regexp_replace(lower($1::text), '[^a-z0-9]+', ' ', 'g')) <> ''
        order by l.name
        limit 3`, [name]));
}

/** create_institution(), then the new institution's id. Throws database errors to the caller. */
export async function createInstitution(viewer: Who, input: {
  slug: string; name: string; ownership: Ownership; type: InstitutionType;
}): Promise<string> {
  return asUser(viewer.userId, async (tx) => {
    const [{ rev }] = await tx.query<{ rev: string }>(
      "select create_institution($1, $2, $3::ownership_type, $4::institution_type) as rev",
      [input.slug, input.name, input.ownership, input.type]);
    const [{ institution_id }] = await tx.query<{ institution_id: string }>(
      "select institution_id from revisions where id = $1", [rev]);
    return institution_id;
  });
}

/** assign_institution(): closes the open assignment and records the new one. */
export async function assignInstitution(viewer: Who, input: {
  institutionId: string; editorId: string | null; reviewerId: string | null; dueOn: string | null;
}): Promise<void> {
  await asUser(viewer.userId, (tx) =>
    tx.query("select assign_institution($1::uuid, $2::uuid, $3::uuid, $4::date)",
      [input.institutionId, input.editorId, input.reviewerId, input.dueOn]));
}

export interface OpenAssignment {
  editorId: string | null;
  editorName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  dueOn: string | null;
  overdue: boolean;
  assignedAt: string | null;
  assignedByName: string | null;
}

/** The open assignment for one institution, or null. */
export async function getOpenAssignment(viewer: Who, institutionId: string): Promise<OpenAssignment | null> {
  const rows = await asUser(viewer.userId, (tx) =>
    tx.query<{
      editor_id: string | null; reviewer_id: string | null; due_on: string | null; overdue: boolean;
      assigned_at: Date | string | null; editor_name: string | null; reviewer_name: string | null; assigned_by_name: string | null;
    }>(
      `select a.editor_id, a.reviewer_id, a.due_on::text as due_on, coalesce(a.due_on < ${TODAY_SQL}, false) as overdue,
              a.assigned_at, ed.display_name as editor_name, rv.display_name as reviewer_name,
              ab.display_name as assigned_by_name
         from assignments a
         left join team_directory ed on ed.user_id = a.editor_id
         left join team_directory rv on rv.user_id = a.reviewer_id
         left join team_directory ab on ab.user_id = a.assigned_by
        where a.institution_id = $1 and a.closed_at is null`, [institutionId]));
  const r = rows[0];
  if (!r) return null;
  return {
    editorId: r.editor_id,
    editorName: r.editor_name,
    reviewerId: r.reviewer_id,
    reviewerName: r.reviewer_name,
    dueOn: r.due_on,
    overdue: Boolean(r.overdue),
    assignedAt: iso(r.assigned_at),
    assignedByName: r.assigned_by_name,
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const DASHBOARD_LIST = 6;

export interface WorkItem {
  institutionId: string;
  slug: string;
  name: string | null;
  revisionId: string;
  revisionNumber: number;
  status: RevisionStatus;
}

export interface AssignmentItem extends WorkItem {
  myRole: "editor" | "reviewer";
  dueOn: string | null;
  overdue: boolean;
  editorName: string | null;
  reviewerName: string | null;
}

export interface DraftItem extends WorkItem {
  updatedAt: string | null;
}

export interface SubmissionItem extends WorkItem {
  submittedAt: string | null;
  submittedByName: string | null;
  reviewCycle: number;
}

export interface ReturnedItem extends WorkItem {
  decision: "changes_requested" | "rejected" | null;
  notes: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
}

export interface ReleaseItem {
  institutionId: string;
  slug: string;
  name: string | null;
  releaseNumber: number;
  publishedAt: string | null;
  publishedByName: string | null;
  isCurrent: boolean;
  withdrawnAt: string | null;
}

export interface StaleItem {
  institutionId: string;
  slug: string;
  name: string | null;
  lastVerifiedAt: string | null;
  releaseNumber: number | null;
  publishedAt: string | null;
}

export interface Listing<T> {
  items: T[];
  total: number;
}

export interface DashboardData {
  assignments: Listing<AssignmentItem> & { overdue: number };
  changesRequested: Listing<ReturnedItem>;
  drafts: Listing<DraftItem>;
  mySubmissions: Listing<SubmissionItem>;
  /** Reviewers and administrators only; null for editors. */
  awaitingReview: Listing<SubmissionItem> | null;
  approvedUnpublished: number | null;
  heldImportRows: { rows: number; imports: number } | null;
  recentReleases: ReleaseItem[];
  stale: Listing<StaleItem> & { thresholdDays: number };
}

type WorkRaw = {
  institution_id: string; slug: string; name: string | null; revision_id: string; revision_number: number;
  status: RevisionStatus; total: number;
};

const work = (r: WorkRaw): WorkItem => ({
  institutionId: r.institution_id,
  slug: r.slug,
  name: r.name,
  revisionId: r.revision_id,
  revisionNumber: num(r.revision_number),
  status: r.status,
});

const listing = <R extends { total: number }, T>(rows: R[], map: (r: R) => T): Listing<T> => ({
  items: rows.map(map),
  total: rows.length ? num(rows[0].total) : 0,
});

async function submissions(tx: Queryable, whereSql: string, params: unknown[], order: string): Promise<Listing<SubmissionItem>> {
  const rows = await tx.query<WorkRaw & { submitted_at: Date | string | null; submitted_by_name: string | null; review_cycle: number }>(
    `with ${LATEST_CTE}
     select l.institution_id, i.slug, l.name, l.id as revision_id, l.revision_number, l.status,
            l.submitted_at, sb.display_name as submitted_by_name, l.review_cycle, count(*) over ()::int as total
       from latest l
       join institutions i on i.id = l.institution_id
       left join team_directory sb on sb.user_id = l.submitted_by
      where ${whereSql}
      order by ${order}
      limit ${DASHBOARD_LIST}`, params);
  return listing(rows, (r) => ({
    ...work(r),
    submittedAt: iso(r.submitted_at),
    submittedByName: r.submitted_by_name,
    reviewCycle: num(r.review_cycle),
  }));
}

export async function getDashboard(viewer: Who): Promise<DashboardData> {
  const me = viewer.userId;
  const reviewer = viewer.role === "reviewer" || viewer.role === "admin";

  return asUser(me, async (tx) => {
    // Open assignments where I am the editor or the reviewer.
    const asg = await tx.query<WorkRaw & {
      my_role: "editor" | "reviewer"; due_on: string | null; overdue: boolean;
      editor_name: string | null; reviewer_name: string | null; overdue_total: number;
    }>(
      `with ${LATEST_CTE}
       select a.institution_id, i.slug, l.name, l.id as revision_id, l.revision_number, l.status,
              case when a.editor_id = $1 then 'editor' else 'reviewer' end as my_role,
              a.due_on::text as due_on, coalesce(a.due_on < ${TODAY_SQL}, false) as overdue,
              ed.display_name as editor_name, rv.display_name as reviewer_name,
              count(*) over ()::int as total,
              (count(*) filter (where a.due_on < ${TODAY_SQL}) over ())::int as overdue_total
         from assignments a
         join institutions i on i.id = a.institution_id
         join latest l on l.institution_id = a.institution_id
         left join team_directory ed on ed.user_id = a.editor_id
         left join team_directory rv on rv.user_id = a.reviewer_id
        where a.closed_at is null and (a.editor_id = $1 or a.reviewer_id = $1)
        order by a.due_on asc nulls last, lower(coalesce(l.name, i.slug)), a.institution_id
        limit ${DASHBOARD_LIST}`, [me]);
    const assignments = {
      ...listing(asg, (r) => ({
        ...work(r),
        myRole: r.my_role,
        dueOn: r.due_on,
        overdue: Boolean(r.overdue),
        editorName: r.editor_name,
        reviewerName: r.reviewer_name,
      })),
      overdue: asg.length ? num(asg[0].overdue_total) : 0,
    };

    // Returned work on institutions assigned to me, or that I submitted.
    const ret = await tx.query<WorkRaw & {
      decision: ReturnedItem["decision"]; notes: string | null; decided_at: Date | string | null; decided_by_name: string | null;
    }>(
      `with ${LATEST_CTE}
       select l.institution_id, i.slug, l.name, l.id as revision_id, l.revision_number, l.status,
              ap.decision::text as decision, ap.notes, ap.decided_at, dd.display_name as decided_by_name,
              count(*) over ()::int as total
         from latest l
         join institutions i on i.id = l.institution_id
         left join assignments a on a.institution_id = l.institution_id and a.closed_at is null
         left join lateral (
           select decision, notes, decided_at, decided_by from approvals
            where revision_id = l.id order by decided_at desc, id desc limit 1) ap on true
         left join team_directory dd on dd.user_id = ap.decided_by
        where l.status = 'changes_requested'
          and (a.editor_id = $1 or a.reviewer_id = $1 or l.submitted_by = $1)
        order by ap.decided_at desc nulls last, l.institution_id
        limit ${DASHBOARD_LIST}`, [me]);
    const changesRequested = listing(ret, (r) => ({
      ...work(r),
      decision: r.decision,
      notes: r.notes,
      decidedAt: iso(r.decided_at),
      decidedByName: r.decided_by_name,
    }));

    // My open drafts (the latest revision is a draft I started).
    const dr = await tx.query<WorkRaw & { updated_at: Date | string | null }>(
      `with ${LATEST_CTE}
       select l.institution_id, i.slug, l.name, l.id as revision_id, l.revision_number, l.status, l.updated_at,
              count(*) over ()::int as total
         from latest l
         join institutions i on i.id = l.institution_id
        where l.status = 'draft' and l.created_by = $1
        order by l.updated_at desc, l.institution_id
        limit ${DASHBOARD_LIST}`, [me]);
    const drafts = listing(dr, (r) => ({ ...work(r), updatedAt: iso(r.updated_at) }));

    const mySubmissions = await submissions(tx, "l.status = 'submitted' and l.submitted_by = $1", [me],
      "l.submitted_at desc nulls last, l.institution_id");

    let awaitingReview: Listing<SubmissionItem> | null = null;
    let approvedUnpublished: number | null = null;
    let heldImportRows: DashboardData["heldImportRows"] = null;
    if (reviewer) {
      // Oldest first: a review queue is worked in arrival order. Own submissions are excluded
      // because a reviewer cannot review their own work (an admin override is recorded elsewhere).
      awaitingReview = await submissions(tx,
        "l.status = 'submitted' and l.submitted_by is distinct from $1", [me],
        "l.submitted_at asc nulls last, l.institution_id");
      const [ap] = await tx.query<{ n: number }>(
        `with ${LATEST_CTE} select count(*)::int as n from latest l where l.status = 'approved'`);
      approvedUnpublished = num(ap?.n);
      const [held] = await tx.query<{ rows: number; imports: number }>(
        // Held rows, plus unheld rows whose name already belongs to an institution (commit skips
        // those until someone matches, creates or skips them).
        `with waiting as (
           select id, import_id from import_rows where held and decision = 'pending' and institution_id is null
           union
           select m.row_id, i.id from imports i cross join lateral import_name_matches(i.id) m)
         select count(*)::int as rows, count(distinct import_id)::int as imports from waiting`);
      heldImportRows = { rows: num(held?.rows), imports: num(held?.imports) };
    }

    // Latest releases, withdrawn ones included and marked.
    const rel = await tx.query<{
      institution_id: string; slug: string; name: string | null; release_number: number;
      published_at: Date | string | null; published_by_name: string | null; is_current: boolean; withdrawn_at: Date | string | null;
    }>(
      `select s.institution_id, s.slug, s.payload->'profile'->>'name' as name, s.release_number,
              s.published_at, pb.display_name as published_by_name, s.is_current, s.withdrawn_at
         from published_snapshots s
         left join team_directory pb on pb.user_id = s.published_by
        order by s.published_at desc, s.id
        limit 5`);
    const recentReleases = rel.map((r) => ({
      institutionId: r.institution_id,
      slug: r.slug,
      name: r.name,
      releaseNumber: num(r.release_number),
      publishedAt: iso(r.published_at),
      publishedByName: r.published_by_name,
      isCurrent: Boolean(r.is_current),
      withdrawnAt: iso(r.withdrawn_at),
    }));

    // Published institutions whose current revision was never human-verified, or not recently.
    const st = await tx.query<{
      institution_id: string; slug: string; name: string | null; last_verified_at: Date | string | null;
      release_number: number | null; published_at: Date | string | null; total: number;
    }>(
      `select i.id as institution_id, i.slug, r.name, r.last_verified_at, s.release_number, s.published_at,
              count(*) over ()::int as total
         from institutions i
         join revisions r on r.id = i.current_published_revision
         left join published_snapshots s on s.revision_id = r.id
        where r.last_verified_at is null or r.last_verified_at < now() - make_interval(days => $1::int)
        order by r.last_verified_at asc nulls first, lower(coalesce(r.name, i.slug)), i.id
        limit ${DASHBOARD_LIST}`, [STALE_REVIEW_DAYS]);
    const stale = {
      ...listing(st, (r) => ({
        institutionId: r.institution_id,
        slug: r.slug,
        name: r.name,
        lastVerifiedAt: iso(r.last_verified_at),
        releaseNumber: numOrNull(r.release_number),
        publishedAt: iso(r.published_at),
      })),
      thresholdDays: STALE_REVIEW_DAYS,
    };

    return {
      assignments, changesRequested, drafts, mySubmissions, awaitingReview, approvedUnpublished,
      heldImportRows, recentReleases, stale,
    };
  });
}

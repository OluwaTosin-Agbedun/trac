import "server-only";
// CMS reads for the verified register (the public report). Runs as the signed-in member; RLS limits
// it to editors, reviewers and administrators (the history of audit events to reviewers and admins).
//
// Relative imports (no "@/") keep this loadable by node for local checks.
import { asUser } from "../../db/index.ts";
import type { Viewer } from "../../auth/accounts.ts";
import { REPORT_SECTIONS, type ReportSection } from "../../../lib/report.ts";
import type { Assessment, RegisterContent } from "../../../lib/register.ts";

type Who = Pick<Viewer, "userId" | "role">;

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export type VerificationState = "verified" | "awaiting" | "returned" | "not_started";

export type LinkResult = "ok" | "homepage" | "redirects_to_homepage" | "other_site" | "not_found" | "error" | "blocked";
/** Link-check results that block verification or need an editor's attention. */
export const PROBLEM_LINK_RESULTS: LinkResult[] = ["homepage", "redirects_to_homepage", "other_site", "not_found"];

export interface LinkCheck {
  url: string;
  kind: string;
  result: LinkResult;
  httpStatus: number | null;
  finalUrl: string | null;
  detail: string | null;
  checkedAt: string;
}

export interface ReportEntry {
  id: string;
  /** Public address: /institutions/<slug>. */
  slug: string;
  /** The institution the research assistant works on (report_entries.institution_id), if linked. */
  institutionId: string | null;
  section: ReportSection;
  name: string;
  state: string | null;
  head: string | null;
  bursar: string | null;
  /** The official page naming the head and bursar (required before verification when names are given). */
  peopleSourceUrl: string | null;
  homepageUrl: string | null;
  disclosureUrl: string | null;
  extraLinks: { label: string; url: string }[];
  assessments: Record<string, Assessment>;
  /** The spreadsheet's unverified claims, shown to editors as hints only. */
  trackerClaims: Record<string, boolean | null>;
  trackerStatus: string | null;
  websiteText: string | null;
  /** Why the importer held the spreadsheet row (possible duplicate, unusable website, state conflict). */
  importFlags: string[];
  /** The name, state and category shown publicly until the first verification (null: added by hand). */
  listedName: string | null;
  verified: RegisterContent | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  verifiedMethod: string | null;
  verifiedAssessmentYear: number | null;
  /** Removed from the register (archived) by an administrator, with the reason; restorable. */
  archivedAt: string | null;
  archiveReason: string | null;
  pending: boolean;
  returnNote: string | null;
  editorIds: string[];
  editorNames: string[];
  assignedEditorId: string | null;
  assignedEditorName: string | null;
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
  dueOn: string | null;
  /** Failing results among the latest check of each address. */
  linkProblems: number;
  lastLinkCheckAt: string | null;
  hash: string;
  updatedAt: string | null;
  updatedByName: string | null;
  state_: VerificationState;
}

export interface TeamOption {
  userId: string;
  name: string;
  role: string;
}

export interface HistoryEvent {
  at: string;
  action: string;
  actorName: string | null;
  details: Record<string, unknown>;
}

export interface EntryVersion {
  verifiedAt: string;
  verifiedByName: string | null;
  verifiedMethod: string | null;
  assessmentYear: number | null;
  supersededAt: string;
  supersededByName: string | null;
  reason: string | null;
}

/** One run of the link checker on a record (results saved in the same minute by the same person). */
export interface LinkRun {
  at: string;
  /** null: the scheduled check. */
  checkedByName: string | null;
  scheduled: boolean;
  total: number;
  problems: number;
}

export interface ReportSettings {
  visible: boolean;
  reportedAsOf: string | null;
  assessmentYear: number | null;
  recheckDays: number;
}

export interface ReportAdmin extends ReportSettings {
  counts: Record<ReportSection, number>;
  /** Records the viewer may verify now (awaiting, not edited by them), across all categories. */
  awaitingForMe: number;
  entries: ReportEntry[];
  editing: ReportEntry | null;
  linkChecks: LinkCheck[];
  /** Link-check runs on the record being edited, newest first. */
  linkRuns: LinkRun[];
  history: HistoryEvent[];
  versions: EntryVersion[];
  team: TeamOption[];
}

type Row = {
  id: string; slug: string; institution_id: string | null; section: ReportSection; name: string; state: string | null; head_name: string | null; bursar_name: string | null;
  people_source_url: string | null; homepage_url: string | null; disclosure_url: string | null; extra_links: { label: string; url: string }[] | null;
  assessments: Record<string, Assessment> | null; tracker_claims: Record<string, boolean | null> | null; tracker_status: string | null;
  website_text: string | null; import_flags: string[] | null; listed_name: string | null; verified: RegisterContent | null;
  verified_at: unknown; verified_by_name: string | null; verified_method: string | null; verified_assessment_year: number | null;
  archived_at: unknown; archive_reason: string | null; pending: boolean; return_note: string | null;
  editors: string[] | null; editor_names: string[] | null; assigned_editor: string | null; assigned_editor_name: string | null;
  assigned_reviewer: string | null; assigned_reviewer_name: string | null; due_on: unknown; link_problems: number;
  last_link_check_at: unknown; hash: string; updated_at: unknown; updated_by_name: string | null;
};

const PROBLEMS_SQL = PROBLEM_LINK_RESULTS.map((r) => `'${r}'`).join(", ");

const SELECT = `select e.id, e.slug, e.institution_id, e.section, e.name, e.state, e.head_name, e.bursar_name, e.people_source_url, e.homepage_url, e.disclosure_url, e.extra_links,
                       e.assessments, e.tracker_claims, e.tracker_status, e.website_text, e.import_flags, e.listed_name,
                       e.verified, e.verified_at, vb.display_name as verified_by_name, e.verified_method, e.verified_assessment_year,
                       e.archived_at, e.archive_reason, e.pending, e.return_note, e.editors,
                       (select array_agg(d.display_name order by d.display_name) from team_directory d where d.user_id = any (e.editors)) as editor_names,
                       e.assigned_editor, ae.display_name as assigned_editor_name, e.assigned_reviewer, ar.display_name as assigned_reviewer_name,
                       e.due_on,
                       (select count(*)::int from (select distinct on (c.url) c.result from report_link_checks c
                                                    where c.entry_id = e.id order by c.url, c.checked_at desc) l
                         where l.result in (${PROBLEMS_SQL})) as link_problems,
                       (select max(c.checked_at) from report_link_checks c where c.entry_id = e.id) as last_link_check_at,
                       register_hash(e) as hash, e.updated_at, ub.display_name as updated_by_name
                  from report_entries e
                  left join team_directory vb on vb.user_id = e.verified_by
                  left join team_directory ub on ub.user_id = e.updated_by
                  left join team_directory ae on ae.user_id = e.assigned_editor
                  left join team_directory ar on ar.user_id = e.assigned_reviewer`;

function stateOf(r: Pick<Row, "return_note" | "verified" | "pending" | "editors">): VerificationState {
  if (r.return_note) return "returned";
  if (r.verified && !r.pending) return "verified";
  if (r.verified || r.editors?.length) return "awaiting";
  return "not_started";
}

function toEntry(r: Row): ReportEntry {
  return {
    id: r.id, slug: r.slug, institutionId: r.institution_id, section: r.section, name: r.name, state: r.state, head: r.head_name, bursar: r.bursar_name,
    peopleSourceUrl: r.people_source_url, homepageUrl: r.homepage_url, disclosureUrl: r.disclosure_url, extraLinks: r.extra_links ?? [], assessments: r.assessments ?? {},
    trackerClaims: r.tracker_claims ?? {}, trackerStatus: r.tracker_status, websiteText: r.website_text, importFlags: r.import_flags ?? [],
    listedName: r.listed_name, verified: r.verified, verifiedAt: iso(r.verified_at), verifiedByName: r.verified_by_name,
    verifiedMethod: r.verified_method, verifiedAssessmentYear: r.verified_assessment_year,
    archivedAt: iso(r.archived_at), archiveReason: r.archive_reason, pending: r.pending, returnNote: r.return_note, editorIds: r.editors ?? [],
    editorNames: r.editor_names ?? [], assignedEditorId: r.assigned_editor, assignedEditorName: r.assigned_editor_name,
    assignedReviewerId: r.assigned_reviewer, assignedReviewerName: r.assigned_reviewer_name, dueOn: iso(r.due_on)?.slice(0, 10) ?? null,
    linkProblems: Number(r.link_problems ?? 0), lastLinkCheckAt: iso(r.last_link_check_at), hash: r.hash, updatedAt: iso(r.updated_at),
    updatedByName: r.updated_by_name, state_: stateOf(r),
  };
}

export type RegisterFilter = "all" | "awaiting" | "verified" | "not_started" | "returned" | "mine" | "recheck" | "links" | "flagged" | "archived";

export const REGISTER_FILTERS: { value: RegisterFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Assigned to me" },
  { value: "awaiting", label: "Awaiting verification" },
  { value: "returned", label: "Returned for fixes" },
  { value: "verified", label: "Verified" },
  { value: "not_started", label: "Not started" },
  { value: "recheck", label: "Verified, due for re-checking" },
  { value: "links", label: "Links needing attention" },
  { value: "flagged", label: "Flagged by the importer" },
  { value: "archived", label: "Removed (archived)" },
];

/** Filters that look across every category, whichever category is chosen (searching does too). */
export const EVERYWHERE_FILTERS: readonly RegisterFilter[] = ["mine", "recheck", "links", "flagged", "awaiting", "returned", "archived"];

/** True when the list covers every category rather than the chosen one. */
export const looksEverywhere = (section: ReportSection | "all", q: string, filter: RegisterFilter) =>
  section === "all" || Boolean(q) || EVERYWHERE_FILTERS.includes(filter);

/** True when the viewer may verify this record now. */
export const mayVerify = (viewer: Who, e: Pick<ReportEntry, "state_" | "editorIds" | "archivedAt">) =>
  (viewer.role === "reviewer" || viewer.role === "admin") && e.state_ === "awaiting" && !e.editorIds.includes(viewer.userId) && !e.archivedAt;

function matches(e: ReportEntry, filter: RegisterFilter, viewer: Who, settings: ReportSettings): boolean {
  if (filter === "archived") return e.archivedAt !== null;
  if (e.archivedAt) return false;
  switch (filter) {
    case "all": return true;
    case "mine": return e.assignedEditorId === viewer.userId || e.assignedReviewerId === viewer.userId;
    case "recheck": return isDueForRecheck(e, settings.recheckDays);
    case "links": return e.linkProblems > 0;
    case "flagged": return e.importFlags.length > 0;
    default: return e.state_ === filter;
  }
}

/** A verified record whose verification is older than the re-check interval. */
export function isDueForRecheck(e: Pick<ReportEntry, "verifiedAt">, recheckDays: number, now = Date.now()): boolean {
  return Boolean(e.verifiedAt) && now - Date.parse(e.verifiedAt!) > recheckDays * 86_400_000;
}

export async function getReportAdmin(viewer: Who, section: ReportSection | "all", q: string, editId: string | null,
  filter: RegisterFilter): Promise<ReportAdmin> {
  return asUser(viewer.userId, async (tx) => {
    const [s] = await tx.query<{ visible: boolean; reported_as_of: unknown; assessment_year: number | null; recheck_days: number }>(
      "select visible, reported_as_of, assessment_year, recheck_days from report_settings limit 1");
    const settings: ReportSettings = {
      visible: Boolean(s?.visible), reportedAsOf: iso(s?.reported_as_of ?? null)?.slice(0, 10) ?? null,
      assessmentYear: s?.assessment_year ?? null, recheckDays: Number(s?.recheck_days ?? 180),
    };
    const counts = await tx.query<{ section: ReportSection; n: number }>("select section, count(*)::int as n from report_entries where archived_at is null group by section");
    const [aw] = await tx.query<{ n: number }>(
      `select count(*)::int as n from report_entries
        where archived_at is null and return_note is null and (verified is not null or cardinality(editors) > 0) and (pending or verified is null)
          and not ($1::uuid = any (editors))`, [viewer.userId]);
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    // Searching, "assigned to me" and the monitoring filters look across every category.
    const everywhere = looksEverywhere(section, q, filter);
    const entries = (await tx.query<Row>(
      `${SELECT} where ($1::text is null or e.section = $1) and ($2::text is null or e.name ilike $2 or e.state ilike $2)
        order by case e.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 when 'federal_monotechnic' then 3
                                when 'state_university' then 4 when 'state_polytechnic' then 5 else 6 end, e.sort_order, e.name`,
      [everywhere ? null : section, like])).map(toEntry);
    const editing = editId ? (await tx.query<Row>(`${SELECT} where e.id = $1`, [editId]))[0] ?? null : null;
    const checks = editId ? await tx.query<{
      url: string; kind: string; result: LinkResult; http_status: number | null; final_url: string | null; detail: string | null; checked_at: unknown;
    }>(`select distinct on (url, kind) url, kind, result, http_status, final_url, detail, checked_at
          from report_link_checks where entry_id = $1 order by url, kind, checked_at desc`, [editId]) : [];
    // audit_events is readable by reviewers and administrators only; editors get an empty history.
    const history = editId && (viewer.role === "reviewer" || viewer.role === "admin") ? await tx.query<{
      at: unknown; action: string; actor_name: string | null; details: Record<string, unknown>;
    }>(`select a.at, a.action, d.display_name as actor_name, a.details
          from audit_events a left join team_directory d on d.user_id = a.actor_id
         where a.entity_type = 'report_entry' and a.entity_id = $1
         order by a.at desc limit 40`, [editId]) : [];
    const runs = editId ? await tx.query<{ at: unknown; checked_by: string | null; checked_by_name: string | null; total: number; problems: number }>(
      `select date_trunc('minute', c.checked_at) as at, c.checked_by, d.display_name as checked_by_name, count(*)::int as total,
              count(*) filter (where c.result in (${PROBLEMS_SQL}))::int as problems
         from report_link_checks c left join team_directory d on d.user_id = c.checked_by
        where c.entry_id = $1
        group by 1, 2, 3 order by 1 desc limit 20`, [editId]) : [];
    const versions = editId ? await tx.query<{
      verified_at: unknown; verified_by_name: string | null; verified_method: string | null; assessment_year: number | null;
      superseded_at: unknown; superseded_by_name: string | null; reason: string | null;
    }>(`select v.verified_at, vb.display_name as verified_by_name, v.verified_method, v.assessment_year, v.superseded_at,
               sb.display_name as superseded_by_name, v.reason
          from report_entry_versions v
          left join team_directory vb on vb.user_id = v.verified_by
          left join team_directory sb on sb.user_id = v.superseded_by
         where v.entry_id = $1 order by v.verified_at desc limit 20`, [editId]) : [];
    const team = await tx.query<{ user_id: string; display_name: string; role: string }>(
      "select user_id, display_name, role::text from team_directory where active and role in ('editor', 'reviewer', 'admin') order by display_name");
    const byKey = Object.fromEntries(counts.map((c) => [c.section, c.n]));
    return {
      ...settings,
      counts: Object.fromEntries(REPORT_SECTIONS.map((x) => [x.key, byKey[x.key] ?? 0])) as Record<ReportSection, number>,
      awaitingForMe: viewer.role === "reviewer" || viewer.role === "admin" ? Number(aw?.n ?? 0) : 0,
      entries: entries.filter((e) => matches(e, filter, viewer, settings)),
      editing: editing ? toEntry(editing) : null,
      linkChecks: checks.map((c) => ({ url: c.url, kind: c.kind, result: c.result, httpStatus: c.http_status, finalUrl: c.final_url,
        detail: c.detail, checkedAt: iso(c.checked_at) ?? "" })),
      linkRuns: runs.map((r) => ({ at: iso(r.at) ?? "", checkedByName: r.checked_by_name, scheduled: r.checked_by === null,
        total: Number(r.total), problems: Number(r.problems) })),
      history: history.map((h) => ({ at: iso(h.at) ?? "", action: h.action, actorName: h.actor_name, details: h.details ?? {} })),
      versions: versions.map((v) => ({ verifiedAt: iso(v.verified_at) ?? "", verifiedByName: v.verified_by_name, verifiedMethod: v.verified_method,
        assessmentYear: v.assessment_year === null ? null : Number(v.assessment_year),
        supersededAt: iso(v.superseded_at) ?? "", supersededByName: v.superseded_by_name, reason: v.reason })),
      team: team.map((t) => ({ userId: t.user_id, name: t.display_name, role: t.role })),
    };
  });
}

/** Counts for the dashboard: work waiting on the viewer and the state of the register. */
export interface RegisterSummary {
  total: number;
  verified: number;
  notStarted: number;
  awaitingForMe: number;
  returnedToMe: number;
  assignedToMe: number;
  overdueForMe: number;
  dueForRecheck: number;
  linkProblems: number;
  recentlyVerified: { id: string; name: string; section: ReportSection; verifiedAt: string }[];
}

export async function getRegisterSummary(viewer: Who): Promise<RegisterSummary> {
  return asUser(viewer.userId, async (tx) => {
    const [r] = await tx.query<{
      total: number; verified: number; not_started: number; awaiting_for_me: number; returned_to_me: number; assigned_to_me: number;
      overdue_for_me: number; due_for_recheck: number; link_problems: number;
    }>(`select count(*)::int as total,
               count(*) filter (where verified is not null)::int as verified,
               count(*) filter (where verified is null and cardinality(editors) = 0 and return_note is null)::int as not_started,
               count(*) filter (where return_note is null and (verified is not null or cardinality(editors) > 0)
                                  and (pending or verified is null) and not ($1::uuid = any (editors)))::int as awaiting_for_me,
               count(*) filter (where return_note is not null and ($1::uuid = any (editors) or assigned_editor = $1))::int as returned_to_me,
               count(*) filter (where assigned_editor = $1 or assigned_reviewer = $1)::int as assigned_to_me,
               count(*) filter (where (assigned_editor = $1 or assigned_reviewer = $1) and due_on < current_date
                                  and (verified is null or pending))::int as overdue_for_me,
               count(*) filter (where verified_at < now() - make_interval(days => (select recheck_days from report_settings limit 1)))::int as due_for_recheck,
               count(*) filter (where exists (select 1 from (select distinct on (c.url) c.result from report_link_checks c
                                                             where c.entry_id = report_entries.id order by c.url, c.checked_at desc) l
                                              where l.result in (${PROBLEMS_SQL})))::int as link_problems
          from report_entries where archived_at is null`, [viewer.userId]);
    const recent = await tx.query<{ id: string; name: string; section: ReportSection; verified_at: unknown }>(
      `select id, coalesce(verified->>'name', name) as name, section, verified_at from report_entries
        where verified_at is not null and archived_at is null order by verified_at desc limit 5`);
    const canVerify = viewer.role === "reviewer" || viewer.role === "admin";
    return {
      total: Number(r?.total ?? 0), verified: Number(r?.verified ?? 0), notStarted: Number(r?.not_started ?? 0),
      awaitingForMe: canVerify ? Number(r?.awaiting_for_me ?? 0) : 0, returnedToMe: Number(r?.returned_to_me ?? 0),
      assignedToMe: Number(r?.assigned_to_me ?? 0), overdueForMe: Number(r?.overdue_for_me ?? 0),
      dueForRecheck: Number(r?.due_for_recheck ?? 0), linkProblems: Number(r?.link_problems ?? 0),
      recentlyVerified: recent.map((x) => ({ id: x.id, name: x.name, section: x.section, verifiedAt: iso(x.verified_at) ?? "" })),
    };
  });
}

/** The URLs of one record, for the link checker. */
export async function getEntryLinks(viewer: Who, entryId: string) {
  const [row] = await asUser(viewer.userId, (tx) => tx.query<{
    homepage_url: string | null; disclosure_url: string | null; extra_links: { label: string; url: string }[] | null;
    assessments: Record<string, Assessment> | null;
  }>("select homepage_url, disclosure_url, extra_links, assessments from report_entries where id = $1", [entryId]));
  return row ?? null;
}

/** Records in a category whose links were checked longest ago (or never), for a batch check. */
export async function entriesDueForLinkCheck(viewer: Who, section: ReportSection, limit: number): Promise<string[]> {
  const rows = await asUser(viewer.userId, (tx) => tx.query<{ id: string }>(
    `select e.id from report_entries e
      where e.section = $1 and e.archived_at is null and (e.homepage_url is not null or e.disclosure_url is not null)
      order by (select max(checked_at) from report_link_checks c where c.entry_id = e.id) nulls first, e.sort_order
      limit $2`, [section, limit]));
  return rows.map((r) => r.id);
}

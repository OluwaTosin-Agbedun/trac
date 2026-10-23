import "server-only";
// CMS reads for the verified register (the public report). Runs as the signed-in member; RLS limits
// it to editors, reviewers and administrators.
//
// Relative imports (no "@/") keep this loadable by node for local checks.
import { asUser } from "../../db/index.ts";
import type { Viewer } from "../../auth/accounts.ts";
import { REPORT_SECTIONS, type ReportSection } from "../../../lib/report.ts";
import type { Assessment, RegisterContent } from "../../../lib/register.ts";

type Who = Pick<Viewer, "userId" | "role">;

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export type VerificationState = "verified" | "awaiting" | "returned" | "not_started";

export interface LinkCheck {
  url: string;
  kind: string;
  result: "ok" | "homepage" | "redirects_to_homepage" | "other_site" | "not_found" | "error" | "blocked";
  httpStatus: number | null;
  finalUrl: string | null;
  detail: string | null;
  checkedAt: string;
}

export interface ReportEntry {
  id: string;
  section: ReportSection;
  name: string;
  state: string | null;
  head: string | null;
  bursar: string | null;
  homepageUrl: string | null;
  disclosureUrl: string | null;
  extraLinks: { label: string; url: string }[];
  assessments: Record<string, Assessment>;
  /** The spreadsheet's unverified claims, shown to editors as hints only. */
  trackerClaims: Record<string, boolean | null>;
  trackerStatus: string | null;
  websiteText: string | null;
  verified: RegisterContent | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  pending: boolean;
  returnNote: string | null;
  editorIds: string[];
  editorNames: string[];
  hash: string;
  updatedAt: string | null;
  updatedByName: string | null;
  state_: VerificationState;
}

export interface ReportAdmin {
  visible: boolean;
  reportedAsOf: string | null;
  counts: Record<ReportSection, number>;
  awaiting: number;
  entries: ReportEntry[];
  editing: ReportEntry | null;
  linkChecks: LinkCheck[];
}

type Row = {
  id: string; section: ReportSection; name: string; state: string | null; head_name: string | null; bursar_name: string | null;
  homepage_url: string | null; disclosure_url: string | null; extra_links: { label: string; url: string }[] | null;
  assessments: Record<string, Assessment> | null; tracker_claims: Record<string, boolean | null> | null; tracker_status: string | null;
  website_text: string | null; verified: RegisterContent | null; verified_at: unknown; verified_by_name: string | null;
  pending: boolean; return_note: string | null; editors: string[] | null; editor_names: string[] | null; hash: string;
  updated_at: unknown; updated_by_name: string | null;
};

const SELECT = `select e.id, e.section, e.name, e.state, e.head_name, e.bursar_name, e.homepage_url, e.disclosure_url, e.extra_links,
                       e.assessments, e.tracker_claims, e.tracker_status, e.website_text, e.verified, e.verified_at,
                       vb.display_name as verified_by_name, e.pending, e.return_note, e.editors,
                       (select array_agg(d.display_name order by d.display_name) from team_directory d where d.user_id = any (e.editors)) as editor_names,
                       register_hash(e) as hash, e.updated_at, ub.display_name as updated_by_name
                  from report_entries e
                  left join team_directory vb on vb.user_id = e.verified_by
                  left join team_directory ub on ub.user_id = e.updated_by`;

function toEntry(r: Row): ReportEntry {
  const state_: VerificationState = r.return_note ? "returned" : r.verified && !r.pending ? "verified" : r.verified || r.editors?.length ? "awaiting" : "not_started";
  return {
    id: r.id, section: r.section, name: r.name, state: r.state, head: r.head_name, bursar: r.bursar_name,
    homepageUrl: r.homepage_url, disclosureUrl: r.disclosure_url, extraLinks: r.extra_links ?? [], assessments: r.assessments ?? {},
    trackerClaims: r.tracker_claims ?? {}, trackerStatus: r.tracker_status, websiteText: r.website_text, verified: r.verified,
    verifiedAt: iso(r.verified_at), verifiedByName: r.verified_by_name, pending: r.pending, returnNote: r.return_note,
    editorIds: r.editors ?? [], editorNames: r.editor_names ?? [], hash: r.hash, updatedAt: iso(r.updated_at),
    updatedByName: r.updated_by_name, state_,
  };
}

export type RegisterFilter = "all" | "awaiting" | "verified" | "not_started" | "returned";

export async function getReportAdmin(viewer: Who, section: ReportSection, q: string, editId: string | null, filter: RegisterFilter): Promise<ReportAdmin> {
  return asUser(viewer.userId, async (tx) => {
    const [settings] = await tx.query<{ visible: boolean; reported_as_of: unknown }>("select visible, reported_as_of from report_settings limit 1");
    const counts = await tx.query<{ section: ReportSection; n: number }>("select section, count(*)::int as n from report_entries group by section");
    const [aw] = await tx.query<{ n: number }>(
      "select count(*)::int as n from report_entries where cardinality(editors) > 0 and return_note is null and (pending or verified is null)");
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const entries = (await tx.query<Row>(
      `${SELECT} where e.section = $1 and ($2::text is null or e.name ilike $2 or e.state ilike $2)
        order by e.sort_order, e.name`, [section, like])).map(toEntry);
    const editing = editId ? (await tx.query<Row>(`${SELECT} where e.id = $1`, [editId]))[0] ?? null : null;
    const checks = editId ? await tx.query<{
      url: string; kind: string; result: LinkCheck["result"]; http_status: number | null; final_url: string | null; detail: string | null; checked_at: unknown;
    }>(`select distinct on (url, kind) url, kind, result, http_status, final_url, detail, checked_at
          from report_link_checks where entry_id = $1 order by url, kind, checked_at desc`, [editId]) : [];
    const byKey = Object.fromEntries(counts.map((c) => [c.section, c.n]));
    return {
      visible: Boolean(settings?.visible),
      reportedAsOf: iso(settings?.reported_as_of ?? null)?.slice(0, 10) ?? null,
      counts: Object.fromEntries(REPORT_SECTIONS.map((s) => [s.key, byKey[s.key] ?? 0])) as Record<ReportSection, number>,
      awaiting: Number(aw?.n ?? 0),
      entries: filter === "all" ? entries : entries.filter((e) => e.state_ === filter),
      editing: editing ? toEntry(editing) : null,
      linkChecks: checks.map((c) => ({ url: c.url, kind: c.kind, result: c.result, httpStatus: c.http_status, finalUrl: c.final_url,
        detail: c.detail, checkedAt: iso(c.checked_at) ?? "" })),
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
      where e.section = $1 and (e.homepage_url is not null or e.disclosure_url is not null)
      order by (select max(checked_at) from report_link_checks c where c.entry_id = e.id) nulls first, e.sort_order
      limit $2`, [section, limit]));
  return rows.map((r) => r.id);
}

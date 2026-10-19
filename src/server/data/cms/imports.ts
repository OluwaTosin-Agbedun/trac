import "server-only";
// Import centre data. Runs as the signed-in member (RLS: team members may read imports; only
// administrators can stage, decide or commit, enforced by the SQL functions). Parameterised SQL only.
import { asUser } from "../../db/index.ts";
import type { Viewer } from "../../auth/accounts.ts";
import type { IndicatorKey } from "../../../lib/indicators.ts";

type Who = Pick<Viewer, "userId">;
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export interface ImportListItem {
  id: string;
  fileName: string;
  uploadedByName: string | null;
  uploadedAt: string;
  reportedAsOf: string | null;
  candidates: number;
  /** Held rows plus rows whose name matches an existing institution, all waiting on an administrator. */
  needsDecision: number;
  committed: number;
  lastCommittedAt: string | null;
}

export async function listImports(viewer: Who): Promise<ImportListItem[]> {
  const rows = await asUser(viewer.userId, (tx) => tx.query<{
    id: string; file_name: string; display_name: string | null; uploaded_at: Date | string; source_reported_as_of: Date | string | null;
    candidates: number; needs_decision: number; committed: number; last_committed_at: Date | string | null;
  }>(
    `select i.id, i.file_name, d.display_name, i.uploaded_at, i.source_reported_as_of, i.last_committed_at,
            (select count(*)::int from import_rows r where r.import_id = i.id) as candidates,
            (select count(*)::int from import_rows r where r.import_id = i.id and r.held and r.institution_id is null and r.decision = 'pending')
              + (select count(*)::int from import_name_matches(i.id) m join import_rows r on r.id = m.row_id where not r.held) as needs_decision,
            (select count(*)::int from import_rows r where r.import_id = i.id and r.institution_id is not null) as committed
       from imports i left join team_directory d on d.user_id = i.uploaded_by
      order by i.uploaded_at desc`));
  return rows.map((r) => ({
    id: r.id, fileName: r.file_name, uploadedByName: r.display_name, uploadedAt: iso(r.uploaded_at) as string,
    reportedAsOf: iso(r.source_reported_as_of)?.slice(0, 10) ?? null, candidates: r.candidates, needsDecision: r.needs_decision,
    committed: r.committed, lastCommittedAt: iso(r.last_committed_at),
  }));
}

export const ROW_FILTERS = ["needs_decision", "needs_match", "held", "ready", "committed", "skipped", "all"] as const;
export type RowFilter = (typeof ROW_FILTERS)[number];
export const ROW_PAGE_SIZE = 50;

export interface ImportIssue { code: string; detail: string; holds: boolean }

export interface ImportRowItem {
  id: string;
  section: string;
  sectionIndex: number;
  sourceLine: number;
  serialRaw: string;
  name: string | null;
  stateRaw: string | null;
  websiteRaw: string | null;
  /** Proposed addresses; only a confirmed one is copied into the draft. */
  websiteCandidates: string[];
  websiteConfirmed: boolean;
  legacyStatusRaw: string | null;
  legacyIndicators: Partial<Record<IndicatorKey, boolean | null>>;
  issues: ImportIssue[];
  held: boolean;
  decision: string;
  decisionNote: string | null;
  institutionId: string | null;
  /** For a row still waiting: the existing institution with the same name, which commit will not duplicate. */
  match: { id: string; name: string } | null;
}

export interface ImportDetail {
  id: string;
  fileName: string;
  contentHash: string;
  uploadedAt: string;
  uploadedByName: string | null;
  reportedAsOf: string | null;
  parserVersion: string;
  summary: Record<string, unknown>;
  counts: {
    candidates: number; held: number; heldPending: number; needsMatch: number; needsDecision: number;
    ready: number; committed: number; skipped: number;
  };
  bySection: { section: string; count: number }[];
  issueCounts: { code: string; count: number }[];
  rows: ImportRowItem[];
  total: number;
  page: number;
}

// Row queries join import_name_matches() as m: rows still waiting whose name matches an existing
// institution, by the same rule commit_import uses to send them to "needs matching".
const ROWS_FROM = "import_rows r left join import_name_matches($1) m on m.row_id = r.id";
const WAITING = "r.institution_id is null and r.decision = 'pending'";

/**
 * needs_decision = waiting on an administrator (held, or the name already exists);
 * needs_match = unheld but the name already exists, so commit skips it until someone decides;
 * ready = what the next commit creates (unheld new names, and rows decided as create_new).
 */
const FILTER_SQL: Record<RowFilter, string> = {
  needs_decision: `${WAITING} and (r.held or m.row_id is not null)`,
  needs_match: `${WAITING} and not r.held and m.row_id is not null`,
  held: "r.held",
  ready: `r.institution_id is null and ((r.decision = 'pending' and not r.held and m.row_id is null) or r.decision = 'create_new')`,
  committed: "r.institution_id is not null",
  skipped: "r.decision = 'skip'",
  all: "true",
};

export async function getImportDetail(viewer: Who, importId: string, filter: RowFilter, issue: string | null, page: number): Promise<ImportDetail | null> {
  return asUser(viewer.userId, async (tx) => {
    const [imp] = await tx.query<{
      id: string; file_name: string; content_hash: string; uploaded_at: Date | string; display_name: string | null;
      source_reported_as_of: Date | string | null; parser_version: string; summary: Record<string, unknown>;
    }>(
      `select i.id, i.file_name, i.content_hash, i.uploaded_at, d.display_name, i.source_reported_as_of, i.parser_version, i.summary
         from imports i left join team_directory d on d.user_id = i.uploaded_by where i.id = $1`, [importId]);
    if (!imp) return null;
    const [c] = await tx.query<Record<string, number>>(
      `select count(*)::int as candidates,
              count(*) filter (where r.held)::int as held,
              count(*) filter (where ${WAITING} and r.held)::int as held_pending,
              count(*) filter (where ${FILTER_SQL.needs_match})::int as needs_match,
              count(*) filter (where ${FILTER_SQL.needs_decision})::int as needs_decision,
              count(*) filter (where ${FILTER_SQL.ready})::int as ready,
              count(*) filter (where ${FILTER_SQL.committed})::int as committed,
              count(*) filter (where ${FILTER_SQL.skipped})::int as skipped
         from ${ROWS_FROM} where r.import_id = $1`, [importId]);
    const bySection = await tx.query<{ section: string; count: number }>(
      "select section, count(*)::int as count from import_rows where import_id = $1 group by section order by min(source_line)", [importId]);
    const issueCounts = await tx.query<{ code: string; count: number }>(
      `select i->>'code' as code, count(distinct r.id)::int as count
         from import_rows r, jsonb_array_elements(r.issues) i where r.import_id = $1 group by 1 order by 2 desc`, [importId]);
    const params: unknown[] = [importId];
    let where = `r.import_id = $1 and ${FILTER_SQL[filter]}`;
    if (issue) {
      params.push(issue);
      where += ` and exists (select 1 from jsonb_array_elements(r.issues) x where x->>'code' = $${params.length})`;
    }
    const [{ n }] = await tx.query<{ n: number }>(`select count(*)::int as n from ${ROWS_FROM} where ${where}`, params);
    const rows = await tx.query<Record<string, unknown>>(
      `select r.id, r.section, r.section_index, r.source_line, r.serial_raw, r.mapped, r.legacy_indicators, r.issues,
              r.held, r.decision::text as decision, r.decision_note, r.institution_id,
              m.institution_id as match_id, m.institution_name as match_name
         from ${ROWS_FROM} where ${where} order by r.source_line
        limit ${ROW_PAGE_SIZE} offset ${(page - 1) * ROW_PAGE_SIZE}`, params);
    return {
      id: imp.id, fileName: imp.file_name, contentHash: imp.content_hash, uploadedAt: iso(imp.uploaded_at) as string,
      uploadedByName: imp.display_name, reportedAsOf: iso(imp.source_reported_as_of)?.slice(0, 10) ?? null,
      parserVersion: imp.parser_version, summary: imp.summary ?? {},
      counts: {
        candidates: c.candidates, held: c.held, heldPending: c.held_pending, needsMatch: c.needs_match,
        needsDecision: c.needs_decision, ready: c.ready, committed: c.committed, skipped: c.skipped,
      },
      bySection, issueCounts, total: n, page,
      rows: rows.map((r) => {
        const m = (r.mapped ?? {}) as Record<string, unknown>;
        const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
        const candidates = Array.isArray(m.websiteCandidates) ? m.websiteCandidates.filter((u): u is string => typeof u === "string") : [];
        return {
          id: String(r.id), section: String(r.section), sectionIndex: Number(r.section_index), sourceLine: Number(r.source_line),
          serialRaw: String(r.serial_raw), name: s(m.name), stateRaw: s(m.stateRaw), websiteRaw: s(m.websiteRaw),
          websiteCandidates: candidates, websiteConfirmed: m.websiteConfirmed === true && candidates.length === 1,
          legacyStatusRaw: s(m.legacyStatusRaw), legacyIndicators: (r.legacy_indicators ?? {}) as ImportRowItem["legacyIndicators"],
          issues: (Array.isArray(r.issues) ? r.issues : []) as ImportIssue[], held: Boolean(r.held), decision: String(r.decision),
          decisionNote: s(r.decision_note), institutionId: r.institution_id ? String(r.institution_id) : null,
          match: r.match_id ? { id: String(r.match_id), name: s(r.match_name) ?? "(unnamed)" } : null,
        };
      }),
    };
  });
}

/** Institutions for the "match to existing" picker: latest revision name containing q. */
export async function searchInstitutions(viewer: Who, q: string): Promise<{ id: string; name: string }[]> {
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return [];
  return asUser(viewer.userId, (tx) => tx.query<{ id: string; name: string }>(
    `select distinct on (r.institution_id) r.institution_id as id, coalesce(r.name, '(unnamed)') as name
       from revisions r
      where r.name ilike $1
      order by r.institution_id, r.revision_number desc
      limit 30`, [`%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`]));
}

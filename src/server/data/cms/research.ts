import "server-only";
// Research centre reads: approved websites, scans, captured sources and the assistant's proposals.
// Every query runs as the signed-in member (RLS: editors, reviewers and administrators only).
// Captured text is returned as plain data and rendered as text, never as HTML.
//
// Relative imports (no "@/") keep this loadable by node for local checks.
import { asUser } from "../../db/index.ts";
import type { Viewer } from "../../auth/accounts.ts";

type Who = Pick<Viewer, "userId" | "role">;

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export type ScanStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "configuration_required";

export interface SourceHost {
  id: string;
  host: string;
  approved: boolean;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  decidedAt: string | null;
}

export interface ScanRow {
  id: string;
  institutionId: string;
  institutionName: string | null;
  status: ScanStatus;
  requestedAt: string;
  requestedByName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  error: string | null;
  coverage: Record<string, unknown>;
  usage: Record<string, unknown>;
  sources: number;
  pendingProposals: number;
}

export interface ProposalRow {
  id: string;
  jobId: string;
  fieldKey: string;
  fieldKind: "indicator" | "profile";
  existingValue: Record<string, unknown> | null;
  proposed: Record<string, unknown>;
  candidateState: "published" | "uncertain" | null;
  excerpt: string;
  locator: string | null;
  uncertainty: string[];
  confidence: "low" | "medium" | "high" | null;
  createdAt: string;
  source: { id: string; url: string; title: string | null; fetchedAt: string; truncated: boolean };
}

export interface ScanEvent {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

const SCAN_SELECT = `
  select j.id, j.institution_id, j.status::text as status, j.requested_at, j.started_at, j.finished_at,
         j.cancel_requested_at is not null as cancel_requested, j.error, j.coverage, j.usage,
         (select r.name from revisions r where r.institution_id = j.institution_id order by r.revision_number desc limit 1) as institution_name,
         rq.display_name as requested_by_name,
         (select count(*)::int from source_versions s where s.job_id = j.id) as sources,
         (select count(*)::int from agent_proposals p where p.job_id = j.id and p.status = 'pending') as pending_proposals
    from crawl_jobs j
    left join team_directory rq on rq.user_id = j.requested_by`;

type ScanDbRow = {
  id: string; institution_id: string; status: ScanStatus; requested_at: unknown; started_at: unknown; finished_at: unknown;
  cancel_requested: boolean; error: string | null; coverage: Record<string, unknown> | null; usage: Record<string, unknown> | null;
  institution_name: string | null; requested_by_name: string | null; sources: number; pending_proposals: number;
};

const toScan = (r: ScanDbRow): ScanRow => ({
  id: r.id, institutionId: r.institution_id, institutionName: r.institution_name, status: r.status,
  requestedAt: iso(r.requested_at) ?? "", requestedByName: r.requested_by_name, startedAt: iso(r.started_at),
  finishedAt: iso(r.finished_at), cancelRequested: r.cancel_requested, error: r.error,
  coverage: r.coverage ?? {}, usage: r.usage ?? {}, sources: Number(r.sources), pendingProposals: Number(r.pending_proposals),
});

export async function listScans(viewer: Who, limit = 50): Promise<ScanRow[]> {
  const rows = await asUser(viewer.userId, (tx) =>
    tx.query<ScanDbRow>(`${SCAN_SELECT} order by j.requested_at desc limit $1`, [Math.min(Math.max(limit, 1), 200)]));
  return rows.map(toScan);
}

export interface ResearchOverview {
  pendingHosts: (SourceHost & { institutionId: string; institutionName: string | null })[];
  proposalsByInstitution: { institutionId: string; institutionName: string | null; pending: number; latest: string | null }[];
  counts: { queued: number; running: number; failedRecently: number; pendingProposals: number };
}

export async function getResearchOverview(viewer: Who): Promise<ResearchOverview> {
  return asUser(viewer.userId, async (tx) => {
    const hosts = await tx.query<{
      id: string; host: string; approved: boolean; note: string | null; created_at: unknown; decided_at: unknown;
      created_by_name: string | null; institution_id: string; institution_name: string | null;
    }>(`select h.id, h.host, h.approved, h.note, h.created_at, h.decided_at, cb.display_name as created_by_name, h.institution_id,
               (select r.name from revisions r where r.institution_id = h.institution_id order by r.revision_number desc limit 1) as institution_name
          from source_hosts h left join team_directory cb on cb.user_id = h.created_by
         where not h.approved and h.decided_at is null
         order by h.created_at limit 100`);
    const props = await tx.query<{ institution_id: string; institution_name: string | null; pending: number; latest: unknown }>(
      `select p.institution_id, count(*)::int as pending, max(p.created_at) as latest,
              (select r.name from revisions r where r.institution_id = p.institution_id order by r.revision_number desc limit 1) as institution_name
         from agent_proposals p where p.status = 'pending'
        group by p.institution_id order by max(p.created_at) desc limit 100`);
    const [c] = await tx.query<{ queued: number; running: number; failed_recently: number; pending_proposals: number }>(
      `select count(*) filter (where status = 'queued')::int as queued,
              count(*) filter (where status = 'running')::int as running,
              count(*) filter (where status in ('failed', 'configuration_required') and finished_at > now() - interval '7 days')::int as failed_recently,
              (select count(*)::int from agent_proposals where status = 'pending') as pending_proposals
         from crawl_jobs`);
    return {
      pendingHosts: hosts.map((h) => ({
        id: h.id, host: h.host, approved: h.approved, note: h.note, createdAt: iso(h.created_at) ?? "",
        createdByName: h.created_by_name, decidedAt: iso(h.decided_at), institutionId: h.institution_id, institutionName: h.institution_name,
      })),
      proposalsByInstitution: props.map((p) => ({
        institutionId: p.institution_id, institutionName: p.institution_name, pending: Number(p.pending), latest: iso(p.latest),
      })),
      counts: {
        queued: Number(c?.queued ?? 0), running: Number(c?.running ?? 0),
        failedRecently: Number(c?.failed_recently ?? 0), pendingProposals: Number(c?.pending_proposals ?? 0),
      },
    };
  });
}

export interface InstitutionResearch {
  hosts: SourceHost[];
  scans: ScanRow[];
  activeScan: ScanRow | null;
  events: ScanEvent[];
  proposals: ProposalRow[];
  suggestedHost: string | null;
}

/** Everything the institution editor's research panel shows. */
export async function getInstitutionResearch(viewer: Who, institutionId: string): Promise<InstitutionResearch> {
  return asUser(viewer.userId, async (tx) => {
    const hosts = await tx.query<{
      id: string; host: string; approved: boolean; note: string | null; created_at: unknown; decided_at: unknown; created_by_name: string | null;
    }>(`select h.id, h.host, h.approved, h.note, h.created_at, h.decided_at, cb.display_name as created_by_name
          from source_hosts h left join team_directory cb on cb.user_id = h.created_by
         where h.institution_id = $1 order by h.approved desc, h.host`, [institutionId]);
    const scans = (await tx.query<ScanDbRow>(`${SCAN_SELECT} where j.institution_id = $1 order by j.requested_at desc limit 5`, [institutionId])).map(toScan);
    const active = scans.find((s) => s.status === "queued" || s.status === "running") ?? null;
    const latestId = active?.id ?? scans[0]?.id ?? null;
    const events = latestId
      ? await tx.query<{ at: unknown; level: ScanEvent["level"]; message: string }>(
          "select at, level, message from crawl_events where job_id = $1 order by id desc limit 12", [latestId])
      : [];
    const proposals = await tx.query<{
      id: string; job_id: string; field_key: string; field_kind: "indicator" | "profile"; existing_value: Record<string, unknown> | null;
      proposed: Record<string, unknown>; candidate_state: "published" | "uncertain" | null; excerpt: string; locator: string | null;
      uncertainty: string[] | null; confidence: ProposalRow["confidence"]; created_at: unknown;
      source_id: string; final_url: string; title: string | null; fetched_at: unknown; truncated: boolean;
    }>(`select p.id, p.job_id, p.field_key, p.field_kind, p.existing_value, p.proposed, p.candidate_state::text as candidate_state,
               p.excerpt, p.locator, p.uncertainty, p.confidence, p.created_at,
               s.id as source_id, s.final_url, s.title, s.fetched_at, s.truncated
          from agent_proposals p join source_versions s on s.id = p.source_version_id
         where p.institution_id = $1 and p.status = 'pending'
         order by p.created_at desc, p.field_key limit 200`, [institutionId]);
    const [site] = await tx.query<{ website_url: string | null }>(
      "select website_url from revisions where institution_id = $1 order by revision_number desc limit 1", [institutionId]);
    let suggestedHost: string | null = null;
    try {
      suggestedHost = site?.website_url ? new URL(site.website_url).hostname.toLowerCase().replace(/^www\./, "") : null;
    } catch {
      suggestedHost = null;
    }
    if (suggestedHost && hosts.some((h) => h.host === suggestedHost || suggestedHost!.endsWith(`.${h.host}`))) suggestedHost = null;
    return {
      hosts: hosts.map((h) => ({
        id: h.id, host: h.host, approved: h.approved, note: h.note, createdAt: iso(h.created_at) ?? "",
        createdByName: h.created_by_name, decidedAt: iso(h.decided_at),
      })),
      scans,
      activeScan: active,
      events: events.map((e) => ({ at: iso(e.at) ?? "", level: e.level, message: e.message })),
      proposals: proposals.map((p) => ({
        id: p.id, jobId: p.job_id, fieldKey: p.field_key, fieldKind: p.field_kind, existingValue: p.existing_value,
        proposed: p.proposed, candidateState: p.candidate_state, excerpt: p.excerpt, locator: p.locator,
        uncertainty: p.uncertainty ?? [], confidence: p.confidence, createdAt: iso(p.created_at) ?? "",
        source: { id: p.source_id, url: p.final_url, title: p.title, fetchedAt: iso(p.fetched_at) ?? "", truncated: p.truncated },
      })),
      suggestedHost,
    };
  });
}

/** A captured source's text, for the "Open captured text" view. Plain text only. */
export async function getSourceVersion(viewer: Who, sourceId: string) {
  const [row] = await asUser(viewer.userId, (tx) =>
    tx.query<{
      id: string; institution_id: string; requested_url: string; final_url: string; fetched_at: unknown; http_status: number;
      content_type: string | null; content_hash: string; byte_length: number; title: string | null; text_content: string;
      truncated: boolean; extraction_note: string | null;
    }>(`select id, institution_id, requested_url, final_url, fetched_at, http_status, content_type, content_hash, byte_length, title,
               text_content, truncated, extraction_note from source_versions where id = $1`, [sourceId]));
  if (!row) return null;
  return { ...row, fetched_at: iso(row.fetched_at) ?? "" };
}

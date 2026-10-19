// One research scan, start to finish: claim a queued job, crawl the approved websites, record what
// was captured, ask Claude for proposals, store the ones that pass validation, and report coverage.
// Framework-free: the worker script and (local fixtures only) the CMS both call runNextJob.
//
// The worker talks to the database only through the worker_* functions, as the nut_worker role.
import Anthropic from "@anthropic-ai/sdk";
import type { Queryable } from "../db/core.ts";
import { crawlInstitution, type CapturedSource, type CrawlDeps } from "./crawl.ts";
import { safeFetch } from "./safeFetch.ts";
import { ConfigurationRequired, createClaude, extractProposals, prepareSources, type ClaudeLike } from "./extract.ts";

export interface WorkerDeps {
  /** Runs fn in one transaction as the nut_worker role. */
  run: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  workerId: string;
  fetch?: CrawlDeps["fetch"];
  sleep?: (ms: number) => Promise<void>;
  claude?: () => ClaudeLike;
  hostDelayMs?: number;
  log?: (message: string) => void;
}

interface Claim {
  job_id: string;
  institution_id: string;
  institution_name: string | null;
  hosts: string[];
  start_urls: string[];
  page_budget: number;
  doc_budget: number;
  baseline: Record<string, unknown>;
}

const LEASE_SECONDS = 300;
const STORED_TEXT_CHARS = 200_000;

function friendlyModelError(err: unknown): { status: "failed" | "configuration_required"; message: string } {
  if (err instanceof ConfigurationRequired) return { status: "configuration_required", message: err.message };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { status: "configuration_required", message: "Configuration required: the research worker's API key was rejected." };
  }
  if (err instanceof Anthropic.RateLimitError) return { status: "failed", message: "The model service is busy (rate limited). Request the scan again later." };
  if (err instanceof Anthropic.APIConnectionError) return { status: "failed", message: "The model service could not be reached. Request the scan again later." };
  if (err instanceof Anthropic.BadRequestError) return { status: "failed", message: "The model service rejected the request. The sources were saved; ask an administrator to check the worker logs." };
  if (err instanceof Anthropic.APIError) return { status: "failed", message: `The model service returned an error (${err.status ?? "unknown"}). Request the scan again later.` };
  return { status: "failed", message: "The scan stopped because of an unexpected error. Captured sources were kept." };
}

export async function runNextJob(deps: WorkerDeps): Promise<{ jobId: string; status: string } | null> {
  const log = deps.log ?? (() => undefined);
  const claim = await deps.run(async (tx) => {
    const [row] = await tx.query<{ c: Claim | null }>("select worker_claim_job($1, $2) as c", [deps.workerId, LEASE_SECONDS]);
    return row?.c ?? null;
  });
  if (!claim) return null;
  const job = claim.job_id;
  const call = (sql: string, params: unknown[]) => deps.run((tx) => tx.query(sql, [job, deps.workerId, ...params]));
  const event = (level: "info" | "warn" | "error", message: string, details: Record<string, unknown> = {}) =>
    call("select worker_log($1, $2, $3, $4, $5)", [level, message, JSON.stringify(details)]).catch(() => undefined);
  const finish = async (status: string, coverage: Record<string, unknown>, usage: Record<string, unknown> = {}, error: string | null = null) => {
    await call("select worker_finish_job($1, $2, $3::crawl_status, $4, $5, $6)", [status, JSON.stringify(coverage), JSON.stringify(usage), error]).catch((err) => {
      log(`[worker] could not record the end of scan ${job}: ${err instanceof Error ? err.message : err}`);
    });
    log(`[worker] scan ${job} finished: ${status}`);
    return { jobId: job, status };
  };

  // No model key, no scan: say so plainly instead of collecting pages nobody can process.
  let claude: ClaudeLike;
  try {
    claude = (deps.claude ?? createClaude)();
  } catch (err) {
    const f = friendlyModelError(err);
    return finish(f.status, {}, {}, f.message);
  }

  let lastBeat = Date.now();
  let cancelled = false;
  const shouldStop = async () => {
    if (cancelled) return true;
    if (Date.now() - lastBeat < 30_000) return false;
    lastBeat = Date.now();
    try {
      const [row] = await call("select worker_heartbeat($1, $2, $3) as s", [LEASE_SECONDS]);
      cancelled = (row as { s?: string } | undefined)?.s === "cancel";
    } catch {
      cancelled = true; // lease lost: another worker owns the job now
    }
    return cancelled;
  };

  const captured: { versionId: string; source: CapturedSource }[] = [];
  const recordFailures: string[] = [];
  await event("info", `Crawling ${claim.hosts.join(", ")}`, { page_budget: claim.page_budget, doc_budget: claim.doc_budget });
  let crawl;
  try {
    crawl = await crawlInstitution(
      { hosts: claim.hosts, startUrls: claim.start_urls, pageBudget: claim.page_budget, docBudget: claim.doc_budget },
      {
        fetch: deps.fetch ?? ((url, approvedHosts, accept) => safeFetch(url, { approvedHosts, accept })),
        sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        shouldStop,
        hostDelayMs: deps.hostDelayMs,
        onSource: async (s) => {
          try {
            const [row] = await call("select worker_record_source($1, $2, $3) as id", [JSON.stringify({
              requested_url: s.requestedUrl, final_url: s.finalUrl, http_status: s.status, content_type: s.contentType,
              content_hash: s.sha256, byte_length: s.byteLength, title: s.title,
              text_content: s.text.slice(0, STORED_TEXT_CHARS), truncated: s.truncated || s.text.length > STORED_TEXT_CHARS,
              extraction_note: s.note,
            })]);
            captured.push({ versionId: (row as { id: string }).id, source: { ...s, text: s.text.slice(0, STORED_TEXT_CHARS) } });
          } catch (err) {
            recordFailures.push(`${s.finalUrl}: ${err instanceof Error ? err.message.slice(0, 120) : "not recorded"}`);
          }
        },
      },
    );
  } catch (err) {
    log(`[worker] crawl failed for ${job}: ${err instanceof Error ? err.stack : err}`);
    return finish("failed", { sources: captured.length }, {}, "The crawl stopped because of an unexpected error. Captured sources were kept.");
  }

  const coverage: Record<string, unknown> = { ...crawl.coverage, sourcesRecorded: captured.length, recordFailures };
  if (crawl.stopped) return finish("cancelled", coverage);
  await event("info", `Captured ${captured.length} sources`, { pages: crawl.coverage.pagesFetched, documents: crawl.coverage.documentsFetched });

  const prepared = prepareSources(captured);
  Object.assign(coverage, {
    sourcesSentToModel: prepared.included, sourcesTruncatedForModel: prepared.truncated,
    sourcesWithoutText: prepared.skippedEmpty, sourcesLeftOutForSpace: prepared.skippedForSpace,
  });
  if (prepared.included === 0) {
    const note = crawl.coverage.unavailableHosts.length === claim.hosts.length
      ? "The approved websites could not be reached. Previous findings are unchanged."
      : "No evidence found within this scan scope. A person decides whether anything is not found.";
    return finish("succeeded", { ...coverage, proposalsAdded: 0, note });
  }
  if (await shouldStop()) return finish("cancelled", coverage);

  let result;
  try {
    result = await extractProposals(claude, { institutionName: claim.institution_name ?? "Unknown institution", baseline: claim.baseline, prepared });
  } catch (err) {
    const f = friendlyModelError(err);
    log(`[worker] model call failed for ${job}: ${err instanceof Error ? err.message : err}`);
    return finish(f.status, coverage, {}, f.message);
  }

  let added = 0;
  const refusedByDatabase: string[] = [];
  for (const p of result.proposals) {
    try {
      await call("select worker_add_proposal($1, $2, $3)", [JSON.stringify({ ...p, extraction_method: "html_text" })]);
      added++;
    } catch (err) {
      refusedByDatabase.push(`${p.field_key}: ${err instanceof Error ? err.message.slice(0, 160) : "refused"}`);
    }
  }
  Object.assign(coverage, {
    proposalsAdded: added, proposalsDropped: result.dropped, proposalsRefusedByDatabase: refusedByDatabase,
    modelRefused: result.refused,
    note: added ? result.note : `${result.note} No evidence-backed proposals were made within this scan scope.`.trim(),
  });
  return finish("succeeded", coverage, result.usage);
}

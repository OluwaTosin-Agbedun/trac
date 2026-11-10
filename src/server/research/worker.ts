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
  pdfText?: CrawlDeps["pdfText"];
  sleep?: (ms: number) => Promise<void>;
  claude?: () => ClaudeLike;
  hostDelayMs?: number;
  /** How often the lease is renewed while the model reads the sources (default 60 s; tests use less). */
  heartbeatMs?: number;
  /** Whether this host has a model key, reported to the CMS (default: ANTHROPIC_API_KEY is set). */
  configured?: boolean;
  /** Reported to the CMS so the team can see which build is running (default WORKER_VERSION). */
  version?: string;
  log?: (message: string) => void;
}

/** Bump when the worker's behaviour changes; the Research centre shows it. */
export const WORKER_VERSION = "2026.11.10";

/** WORKER_VERSION plus the deployed commit when the host provides one (Render, Railway and others). */
export function workerVersion(env: Record<string, string | undefined> = process.env): string {
  const sha = [env.RENDER_GIT_COMMIT, env.RAILWAY_GIT_COMMIT_SHA, env.SOURCE_COMMIT, env.GIT_COMMIT]
    .find((v) => typeof v === "string" && /^[0-9a-f]{7,40}$/i.test(v.trim()))?.trim().slice(0, 7);
  return sha ? `${WORKER_VERSION}+${sha.toLowerCase()}` : WORKER_VERSION;
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
  /** The latest capture of each address an earlier scan sent to the model (0018). */
  previous?: { final_url: string; content_hash: string }[];
}

const LEASE_SECONDS = 300;
/** Well inside the lease, so a model call of several minutes never lets another worker take the scan. */
const MODEL_HEARTBEAT_MS = 60_000;
const STORED_TEXT_CHARS = 200_000;

/** Control characters (newline, carriage return and tab kept) and unpaired surrogates: Postgres cannot store them. */
const UNSTORABLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Captured text as it is stored, and as the verbatim check then sees it: characters the database
 * cannot hold are removed (a page with a stray NUL byte would otherwise not be recorded at all), and
 * the cut at max never splits a character in two.
 */
export function storableText(s: string, max: number): string {
  let t = s.replace(UNSTORABLE_RE, "");
  if (t.length > max) {
    t = t.slice(0, max);
    if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  }
  return t;
}

/**
 * JSON for the worker functions with every string made storable. Coverage notes, locators and other
 * text written by the model or taken from a website could otherwise carry a NUL character, which the
 * database refuses: the end of a scan would then never be recorded. A quoted excerpt is unaffected:
 * it has already been matched against the stored text, which holds no such characters.
 */
export function storableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "string" ? v.replace(UNSTORABLE_RE, "") : v));
}

/** True when the database said the lease is gone (another worker took the scan, or it ran out). */
function leaseLost(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "55000";
}

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
  // Tell the CMS this worker is alive and whether it can call the model. Its own transaction, so a
  // database without migration 0018 yet still hands out work.
  await deps.run((tx) => tx.query("select worker_report_status($1, $2, $3)", [
    deps.workerId, deps.configured ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim()), deps.version ?? WORKER_VERSION,
  ])).catch((err) => log(`[worker] could not report status: ${err instanceof Error ? err.message.slice(0, 160) : err}`));
  const claim = await deps.run(async (tx) => {
    const [row] = await tx.query<{ c: Claim | null }>("select worker_claim_job($1, $2) as c", [deps.workerId, LEASE_SECONDS]);
    return row?.c ?? null;
  });
  if (!claim) return null;
  const job = claim.job_id;
  const call = (sql: string, params: unknown[]) => deps.run((tx) => tx.query(sql, [job, deps.workerId, ...params]));
  const event = (level: "info" | "warn" | "error", message: string, details: Record<string, unknown> = {}) =>
    call("select worker_log($1, $2, $3, $4, $5)", [level, storableText(message, 500), storableJson(details)]).catch(() => undefined);
  const finish = async (status: string, coverage: Record<string, unknown>, usage: Record<string, unknown> = {}, error: string | null = null) => {
    await call("select worker_finish_job($1, $2, $3::crawl_status, $4, $5, $6)", [status, storableJson(coverage), storableJson(usage), error === null ? null : storableText(error, 1000)]).catch((err) => {
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
        pdfText: deps.pdfText,
        onSource: async (s) => {
          try {
            // Exactly this text is stored and later checked against each quoted excerpt.
            const full = storableText(s.text, Number.MAX_SAFE_INTEGER);
            const text = storableText(full, STORED_TEXT_CHARS);
            const title = s.title === null ? null : storableText(s.title, 300) || null;
            const [row] = await call("select worker_record_source($1, $2, $3) as id", [storableJson({
              requested_url: s.requestedUrl, final_url: s.finalUrl, http_status: s.status, content_type: s.contentType,
              content_hash: s.sha256, byte_length: s.byteLength, title,
              text_content: text, truncated: s.truncated || full.length > STORED_TEXT_CHARS,
              extraction_note: s.note, extraction_method: s.method, page_count: s.pageCount,
            })]);
            captured.push({ versionId: (row as { id: string }).id, source: { ...s, title, text } });
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

  // A page the model already read in an earlier scan, at the same address and with the same content
  // hash, is recorded again (so the capture shows it was checked) but not sent to the model again.
  const previous = new Map((claim.previous ?? []).map((p) => [p.final_url, p.content_hash]));
  const fresh = captured.filter((c) => previous.get(c.source.finalUrl) !== c.source.sha256);
  const unchanged = captured.length - fresh.length;
  const prepared = prepareSources(fresh);
  Object.assign(coverage, {
    sourcesSentToModel: prepared.included, sourcesTruncatedForModel: prepared.truncated,
    sourcesWithoutText: prepared.skippedEmpty, sourcesLeftOutForSpace: prepared.skippedForSpace, sourcesUnchanged: unchanged,
  });
  if (prepared.included === 0) {
    const unreadable = crawl.coverage.unreadableDocuments.length;
    const note = crawl.coverage.unavailableHosts.length === claim.hosts.length
      ? "The approved websites could not be reached. Previous findings are unchanged."
      : unchanged && fresh.every((c) => c.source.text.trim().length < 40)
        ? "Nothing new: the pages with text have not changed since a scan that already read them, so they were not sent to the model again."
        : `No evidence found within this scan scope. A person decides whether anything is not found.${unreadable
          ? ` ${unreadable} document${unreadable === 1 ? "" : "s"} could not be read (for example scanned or image-only); open ${unreadable === 1 ? "it" : "them"} to check by hand.` : ""}`;
    return finish("succeeded", { ...coverage, proposalsAdded: 0, note });
  }
  if (await shouldStop()) return finish("cancelled", coverage);

  // The model call can take minutes, longer than the crawl's own heartbeats allow for: renew the
  // lease on a timer while it runs. If a renewal says the scan was cancelled, or that the lease is
  // gone (another worker took the scan over), the call is aborted and nothing it returns is stored.
  const abort = new AbortController();
  const heartbeatMs = deps.heartbeatMs ?? MODEL_HEARTBEAT_MS;
  let interrupted: "cancel" | "lost" | null = null;
  let beating: Promise<void> | null = null;
  let renewedAt = lastBeat; // the last renewal (or the claim) before the call
  const beat = async () => {
    try {
      const [row] = await call("select worker_heartbeat($1, $2, $3) as s", [LEASE_SECONDS]);
      renewedAt = Date.now();
      if ((row as { s?: string } | undefined)?.s === "cancel") interrupted ??= "cancel";
    } catch (err) {
      // The database said the lease is gone, or renewals have failed for so long that it may run out
      // before the next one: stop. A single failed renewal (a database blip) is tried again next time.
      if (leaseLost(err) || Date.now() - renewedAt + heartbeatMs >= LEASE_SECONDS * 1000) interrupted ??= "lost";
      else log(`[worker] scan ${job}: could not renew the lease, trying again shortly: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    }
    if (interrupted) {
      cancelled = true;
      abort.abort();
    }
  };
  const timer = setInterval(() => {
    beating ??= beat().finally(() => { beating = null; });
  }, heartbeatMs);
  let result: Awaited<ReturnType<typeof extractProposals>> | null = null;
  let modelError: unknown = null;
  try {
    result = await extractProposals(claude, {
      institutionName: claim.institution_name ?? "Unknown institution", baseline: claim.baseline, prepared, signal: abort.signal,
    });
  } catch (err) {
    modelError = err;
  } finally {
    clearInterval(timer);
    if (beating) await beating; // a renewal in flight decides whether the result may be kept
  }
  if (interrupted === "lost") {
    log(`[worker] scan ${job}: lease lost during the model call; nothing from this attempt was stored`);
    return { jobId: job, status: "lost" };
  }
  if (interrupted === "cancel") {
    return finish("cancelled", { ...coverage, note: "Cancelled while the model was reading the sources; nothing it returned was stored." });
  }
  if (modelError || !result) {
    const f = friendlyModelError(modelError);
    log(`[worker] model call failed for ${job}: ${modelError instanceof Error ? modelError.message : modelError}`);
    return finish(f.status, coverage, {}, f.message);
  }
  // Only a reply read in full counts as the model having read these captures.
  if (result.completed) {
    const ids = [...prepared.idToVersion.values()].map((v) => v.versionId);
    await call("select worker_mark_sent($1, $2, $3::uuid[])", [ids]).catch((err) => {
      log(`[worker] could not mark the sources of scan ${job} as read: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    });
  }

  let added = 0;
  const refusedByDatabase: string[] = [];
  for (const p of result.proposals) {
    try {
      await call("select worker_add_proposal($1, $2, $3)", [storableJson(p)]);
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

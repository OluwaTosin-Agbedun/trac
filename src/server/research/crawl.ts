// A bounded crawl of an institution's approved websites: homepages and starting pages first, then
// same-site links that look like finance, budget, TETFund, endowment or student-statistics pages.
// Framework-free; network access goes through the injected fetch (safeFetch in production).
import { FetchRefused, parseRobots, robotsAllows, type FetchResult, type RobotsRules } from "./safeFetch.ts";
import { extractHtml, extractPlain } from "./extractText.ts";
import { extractPdfText, type PdfText } from "./pdfText.ts";

export const CRAWL_DEFAULTS = { hostDelayMs: 2000, maxDepth: 2, retryDelayMs: 5000 } as const;

const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ECONNABORTED", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"]);
/** Busy or briefly broken servers: worth one more try after a pause. */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

/**
 * True for a failure that may pass if tried again shortly (a timeout, a dropped connection, a DNS
 * hiccup). A refusal by the safety rules (wrong host, private address, content type) never is.
 */
export function isTransientFailure(err: unknown): boolean {
  if (err instanceof FetchRefused) return err.reason === "timeout";
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
  return err instanceof Error && /socket hang up/i.test(err.message);
}

const STRONG = /budget|financ|account|bursar|bursary|tetfund|endow|statistic|enrol|audit|appropriation|revenue|expenditure|transparen/i;
const WEAK = /report|grant|research|student|population|fact|about|publication|disclosure|foi|freedom-of-information|annual/i;
const DOC_EXT = /\.(pdf)(\?|$)/i;
const SKIP_EXT = /\.(jpe?g|png|gif|webp|svg|ico|css|js|mp4|mp3|zip|rar|docx?|xlsx?|pptx?)(\?|$)/i;

export function linkScore(url: string, text: string): number {
  let path: string;
  try {
    const u = new URL(url);
    path = decodeURIComponent(u.pathname + u.search);
  } catch {
    return 0;
  }
  const hay = `${path} ${text}`;
  return (STRONG.test(hay) ? 3 : 0) + (WEAK.test(hay) ? 1 : 0);
}

export interface CapturedSource {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  sha256: string;
  byteLength: number;
  title: string | null;
  text: string;
  truncated: boolean;
  kind: "page" | "document";
  /** How the text was read. PDF text carries a "[Page N]" line before each page. */
  method: "html_text" | "plain_text" | "pdf_text";
  /** Pages in a PDF (null for web pages). */
  pageCount: number | null;
  note: string | null;
}

export interface CrawlCoverage {
  hosts: string[];
  pagesFetched: number;
  documentsFetched: number;
  pageBudget: number;
  docBudget: number;
  budgetReached: boolean;
  skippedByRobots: string[];
  failures: { url: string; reason: string }[];
  unavailableHosts: string[];
  /** Documents captured but with no readable text, e.g. "unreadable (scanned or image-only)". */
  unreadableDocuments: { url: string; reason: string }[];
  /** Requests tried a second time after a timeout, a dropped connection or a busy server. */
  retried: number;
}

export interface CrawlInput {
  hosts: string[];
  startUrls: string[];
  pageBudget: number;
  docBudget: number;
}

export interface CrawlDeps {
  fetch: (url: string, approvedHosts: readonly string[], accept?: string) => Promise<FetchResult>;
  sleep: (ms: number) => Promise<void>;
  /** Called between requests; return true to stop (cancelled or lease lost). */
  shouldStop: () => Promise<boolean>;
  onSource?: (s: CapturedSource) => Promise<void>;
  hostDelayMs?: number;
  /** Pause before the one retry of a transient failure (default 5 s). */
  retryDelayMs?: number;
  /** PDF text extraction (default extractPdfText: a separate thread with page, size and time limits). */
  pdfText?: (bytes: Uint8Array, opts: { truncatedDownload: boolean }) => Promise<PdfText>;
}

export async function crawlInstitution(input: CrawlInput, deps: CrawlDeps): Promise<{ sources: CapturedSource[]; coverage: CrawlCoverage; stopped: boolean }> {
  const hosts = [...new Set(input.hosts.map((h) => h.toLowerCase()))];
  const coverage: CrawlCoverage = {
    hosts, pagesFetched: 0, documentsFetched: 0, pageBudget: input.pageBudget, docBudget: input.docBudget,
    budgetReached: false, skippedByRobots: [], failures: [], unavailableHosts: [], unreadableDocuments: [], retried: 0,
  };
  const sources: CapturedSource[] = [];
  const robots = new Map<string, RobotsRules | null>();
  const lastHit = new Map<string, number>();
  const queued = new Set<string>();
  const queue: { url: string; depth: number; score: number }[] = [];
  const push = (url: string, depth: number, score: number) => {
    if (queued.has(url) || queued.size > 2000) return;
    queued.add(url);
    queue.push({ url, depth, score });
  };
  for (const u of input.startUrls) push(u, 0, 100);
  for (const h of hosts) push(`https://${h}/`, 0, 50);

  const politeFetch = async (url: string, accept?: string) => {
    const host = new URL(url).hostname;
    const rules = robots.get(host);
    const delay = Math.max(deps.hostDelayMs ?? CRAWL_DEFAULTS.hostDelayMs, (rules?.crawlDelaySeconds ?? 0) * 1000);
    const wait = (lastHit.get(host) ?? 0) + delay - Date.now();
    if (wait > 0) await deps.sleep(Math.min(wait, 10_000));
    lastHit.set(host, Date.now());
    return deps.fetch(url, hosts, accept);
  };

  // One retry, after a pause, for a timeout, a dropped connection or a busy server (429, 502-504).
  const fetchWithRetry = async (url: string, accept?: string): Promise<FetchResult> => {
    try {
      const res = await politeFetch(url, accept);
      if (!RETRY_STATUSES.has(res.status)) return res;
    } catch (err) {
      if (!isTransientFailure(err)) throw err;
    }
    coverage.retried++;
    await deps.sleep(deps.retryDelayMs ?? CRAWL_DEFAULTS.retryDelayMs);
    return politeFetch(url, accept);
  };

  const robotsFor = async (host: string): Promise<RobotsRules | null> => {
    if (robots.has(host)) return robots.get(host) ?? null;
    let rules: RobotsRules | null;
    try {
      const res = await fetchWithRetry(`https://${host}/robots.txt`, "text/plain");
      rules = res.status >= 200 && res.status < 300 ? parseRobots(res.body.toString("utf8")) : { allow: [], disallow: [], crawlDelaySeconds: null };
    } catch (err) {
      // An unreachable site is reported, never treated as missing disclosure.
      rules = err instanceof FetchRefused && err.reason === "host_not_approved" ? { allow: [], disallow: [], crawlDelaySeconds: null } : null;
    }
    robots.set(host, rules);
    if (rules === null && !coverage.unavailableHosts.includes(host)) coverage.unavailableHosts.push(host);
    return rules;
  };

  while (queue.length) {
    if (await deps.shouldStop()) return { sources, coverage, stopped: true };
    if (coverage.pagesFetched >= input.pageBudget && coverage.documentsFetched >= input.docBudget) {
      coverage.budgetReached = true;
      break;
    }
    queue.sort((a, b) => b.score - a.score || a.depth - b.depth);
    const next = queue.shift()!;
    const isDoc = DOC_EXT.test(next.url);
    if (isDoc ? coverage.documentsFetched >= input.docBudget : coverage.pagesFetched >= input.pageBudget) {
      coverage.budgetReached = true;
      continue;
    }
    let url: URL;
    try {
      url = new URL(next.url);
    } catch {
      continue;
    }
    const rules = await robotsFor(url.hostname);
    if (rules === null) continue;
    if (!robotsAllows(rules, url.pathname + url.search)) {
      if (coverage.skippedByRobots.length < 100) coverage.skippedByRobots.push(next.url);
      continue;
    }
    let res: FetchResult;
    try {
      res = await fetchWithRetry(next.url);
    } catch (err) {
      coverage.failures.push({ url: next.url, reason: err instanceof Error ? err.message.slice(0, 200) : "failed" });
      continue;
    }
    if (res.contentType === "application/pdf") coverage.documentsFetched++;
    else coverage.pagesFetched++;
    if (res.status >= 400) {
      coverage.failures.push({ url: next.url, reason: `HTTP ${res.status}` });
      continue;
    }
    let source: CapturedSource;
    if (res.contentType === "application/pdf") {
      // Text only, read in a separate thread with page, size and time limits. A scanned PDF stores
      // no text, so it can produce no proposals; the coverage says why.
      const pdf = await (deps.pdfText ?? extractPdfText)(res.body, { truncatedDownload: res.truncated });
      let fileName = "";
      try {
        fileName = decodeURIComponent(new URL(res.finalUrl).pathname.split("/").pop() ?? "");
      } catch {
        fileName = new URL(res.finalUrl).pathname.split("/").pop() ?? "";
      }
      source = {
        requestedUrl: next.url, finalUrl: res.finalUrl, status: res.status, contentType: res.contentType, sha256: res.sha256,
        byteLength: res.body.length, title: fileName.slice(0, 300) || null,
        text: pdf.text, truncated: pdf.truncated || res.truncated, kind: "document", method: "pdf_text",
        pageCount: pdf.pageCount || null, note: pdf.note,
      };
      if (!pdf.readable && coverage.unreadableDocuments.length < 50) {
        coverage.unreadableDocuments.push({ url: res.finalUrl, reason: pdf.unreadableReason ?? "unreadable" });
      }
    } else {
      const body = res.body.toString("utf8");
      const page = res.contentType === "text/plain" ? extractPlain(body) : extractHtml(body, res.finalUrl);
      source = {
        requestedUrl: next.url, finalUrl: res.finalUrl, status: res.status, contentType: res.contentType, sha256: res.sha256,
        byteLength: res.body.length, title: page.title, text: page.text, truncated: page.truncated || res.truncated,
        kind: "page", method: res.contentType === "text/plain" ? "plain_text" : "html_text", pageCount: null,
        note: page.truncated || res.truncated ? "Only the first part of this page was kept." : null,
      };
      if (next.depth < CRAWL_DEFAULTS.maxDepth) {
        for (const link of page.links) {
          if (SKIP_EXT.test(link.url)) continue;
          let host: string;
          try {
            host = new URL(link.url).hostname.toLowerCase();
          } catch {
            continue;
          }
          if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) continue;
          const score = linkScore(link.url, link.text);
          if (score > 0) push(link.url, next.depth + 1, score);
        }
      }
    }
    sources.push(source);
    await deps.onSource?.(source);
  }
  if (queue.length) coverage.budgetReached = true;
  return { sources, coverage, stopped: false };
}

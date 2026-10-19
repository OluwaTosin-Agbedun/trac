// Fetching for the research worker, built so a hostile page, redirect or DNS answer cannot make it
// reach anything other than an approved public website. Framework-free (tests and the worker
// script import it directly).
//
//   - http and https only, default ports only, no credentials in URLs
//   - the host must be an approved host for the institution (or a subdomain of one)
//   - every DNS answer is checked against private, loopback, link-local and reserved ranges, and
//     the connection uses the checked address (no second lookup an attacker could rebind)
//   - redirects are followed by hand, at most five, each re-checked from the start
//   - response size, total time and content types are bounded
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";

export const FETCH_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 20_000,
  maxRedirects: 5,
} as const;

export const USER_AGENT = "NigerianInstitutionComplianceResearch/1.0 (+https://github.com/athenacenterpl-cmd/nigerian-university-tracker)";

const ALLOWED_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "application/pdf"];

export class FetchRefused extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "FetchRefused";
    this.reason = reason;
  }
}

// One list per family: a BlockList holding ::ffff:0:0/96 also matches every plain IPv4 address.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked6.addSubnet(net, prefix, "ipv6");

/** True for any address the worker must never connect to. Unknown formats are blocked. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked4.check(address, "ipv4");
  // IPv4-mapped forms (::ffff:a.b.c.d, ::ffff:7f00:1) fall in ::ffff:0:0/96: a public site never needs them.
  if (family === 6) return blocked6.check(address, "ipv6");
  return true;
}

/** True when host equals an approved host or is a subdomain of one. */
export function hostIsApproved(host: string, approvedHosts: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return approvedHosts.some((a) => h === a || h.endsWith(`.${a}`));
}

/** Parse and check a URL before any network activity. Throws FetchRefused. */
export function checkUrl(raw: string, approvedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused(`Not a valid address: ${raw.slice(0, 120)}`, "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchRefused("Only web addresses are fetched.", "protocol");
  if (url.username || url.password) throw new FetchRefused("Addresses with credentials are not fetched.", "credentials");
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) throw new FetchRefused("Only standard web ports are fetched.", "port");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) throw new FetchRefused("Addresses that are bare IP numbers are not fetched.", "ip_literal");
  if (!hostIsApproved(host, approvedHosts)) throw new FetchRefused(`${host} is not an approved website for this institution.`, "host_not_approved");
  if (raw.length > 2000) throw new FetchRefused("That address is too long.", "too_long");
  url.hash = "";
  return url;
}

type LookupFn = (hostname: string, cb: (err: Error | null, addresses: LookupAddress[]) => void) => void;

const systemLookup: LookupFn = (hostname, cb) => dnsLookup(hostname, { all: true, verbatim: true }, cb);

/** A lookup for http.request that refuses if any answer is a blocked address. */
export function guardedLookup(resolve: LookupFn = systemLookup) {
  return (hostname: string, options: unknown, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
    resolve(hostname, (err, addresses) => {
      if (err) return cb(err, "", 0);
      if (!addresses.length) return cb(new FetchRefused(`${hostname} has no address.`, "dns"), "", 0);
      const bad = addresses.find((a) => isBlockedAddress(a.address));
      if (bad) return cb(new FetchRefused(`${hostname} resolves to a private or reserved address.`, "blocked_address"), "", 0);
      const opts = (options ?? {}) as { all?: boolean };
      if (opts.all) return cb(null, addresses);
      cb(null, addresses[0].address, addresses[0].family);
    });
  };
}

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: Buffer;
  sha256: string;
  truncated: boolean;
}

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean };

export interface FetchOptions {
  approvedHosts: readonly string[];
  lookup?: LookupFn;
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  /** Tests only: replaces the network request (URL checks and redirect handling still apply). */
  transport?: (url: URL) => Promise<RawResponse>;
}

function decode(body: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const enc = (encoding ?? "identity").toLowerCase().trim();
  const opts = { maxOutputLength: maxBytes };
  if (enc === "identity" || enc === "") return body;
  if (enc === "gzip" || enc === "x-gzip") return gunzipSync(body, opts);
  if (enc === "deflate") return inflateSync(body, opts);
  if (enc === "br") return brotliDecompressSync(body, opts);
  throw new FetchRefused(`Unsupported content encoding ${enc.slice(0, 20)}.`, "encoding");
}

function requestOnce(url: URL, opts: Required<Pick<FetchOptions, "maxBytes" | "timeoutMs">> & FetchOptions, deadline: number) {
  return new Promise<RawResponse>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = lib.request(url, {
      method: "GET",
      lookup: guardedLookup(opts.lookup) as never,
      headers: {
        "user-agent": USER_AGENT,
        accept: opts.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8",
        "accept-encoding": "gzip, deflate, br",
      },
      timeout: remaining,
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      res.on("data", (chunk: Buffer) => {
        if (truncated) return;
        size += chunk.length;
        if (size > opts.maxBytes) {
          truncated = true;
          chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)));
          res.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated }));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new FetchRefused("The website took too long to respond.", "timeout")), remaining);
    req.on("timeout", () => req.destroy(new FetchRefused("The website took too long to respond.", "timeout")));
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

/** Fetch one URL safely, following redirects only to approved hosts. */
export async function safeFetch(rawUrl: string, options: FetchOptions): Promise<FetchResult> {
  const opts = { maxBytes: FETCH_LIMITS.maxBytes, timeoutMs: FETCH_LIMITS.timeoutMs, ...options };
  const deadline = Date.now() + opts.timeoutMs;
  let url = checkUrl(rawUrl, opts.approvedHosts);
  for (let hop = 0; hop <= FETCH_LIMITS.maxRedirects; hop++) {
    const res = opts.transport ? await opts.transport(url) : await requestOnce(url, opts, deadline);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop === FETCH_LIMITS.maxRedirects) throw new FetchRefused("Too many redirects.", "redirects");
      url = checkUrl(new URL(res.headers.location, url).toString(), opts.approvedHosts);
      continue;
    }
    const contentType = res.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? null;
    if (res.status < 400 && contentType && !ALLOWED_TYPES.includes(contentType)) {
      throw new FetchRefused(`Content type ${contentType.slice(0, 60)} is not collected.`, "content_type");
    }
    // A truncated compressed body cannot be decoded reliably; keep what decodes, mark truncated.
    let body: Buffer;
    try {
      body = decode(res.body, res.headers["content-encoding"], opts.maxBytes);
    } catch (err) {
      if (err instanceof FetchRefused) throw err;
      if (!res.truncated) throw new FetchRefused("The response could not be decoded.", "decode");
      body = Buffer.alloc(0);
    }
    return {
      requestedUrl: rawUrl,
      finalUrl: url.toString(),
      status: res.status,
      contentType,
      body,
      sha256: createHash("sha256").update(body).digest("hex"),
      truncated: res.truncated,
    };
  }
  throw new FetchRefused("Too many redirects.", "redirects");
}

// ---------------------------------------------------------------------------
// robots.txt (the subset that matters here: groups for our agent or *, Allow/Disallow prefixes)
// ---------------------------------------------------------------------------

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
}

export function parseRobots(text: string, agentToken = "nigerianinstitutioncomplianceresearch"): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay: number | null }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.allow.push(value);
    else if (field === "disallow" && value) current.disallow.push(value);
    else if (field === "crawl-delay") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n) && n >= 0) current.delay = Math.min(n, 60);
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
    crawlDelaySeconds: chosen.find((g) => g.delay !== null)?.delay ?? null,
  };
}

function ruleMatches(rule: string, path: string): number {
  // Supports * wildcards and a trailing $ anchor; returns the match length (longest wins) or -1.
  // Oversized or wildcard-heavy rules are ignored so a robots file cannot cause slow matching.
  if (rule.length > 300 || rule.split("*").length > 6) return -1;
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(`^${body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return re.test(path) ? rule.length : -1;
}

export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) {
    const n = ruleMatches(r, pathAndQuery);
    if (n > best) { best = n; allowed = false; }
  }
  for (const r of rules.allow) {
    const n = ruleMatches(r, pathAndQuery);
    if (n >= best && n >= 0) { best = n; allowed = true; }
  }
  return allowed;
}

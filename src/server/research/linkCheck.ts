// Link checks for the register: does each address work, and does it lead to the evidence for the
// right institution? Uses the SSRF-safe fetcher (private and internal addresses are refused;
// redirects off the address's own site are caught). Framework-free.
import { FetchRefused, safeFetch, type FetchResult } from "./safeFetch.ts";

export type LinkResult = "ok" | "homepage" | "redirects_to_homepage" | "other_site" | "not_found" | "error" | "blocked";

export interface LinkTarget {
  url: string;
  /** homepage | disclosure | extra | evidence:<indicator key> */
  kind: string;
}

export interface LinkCheckResult {
  url: string;
  kind: string;
  result: LinkResult;
  http_status: number | null;
  final_url: string | null;
  detail: string | null;
}

export const LINK_RESULT_LABEL: Record<LinkResult, string> = {
  ok: "Works",
  homepage: "Homepage only, not a disclosure page",
  redirects_to_homepage: "Redirects to the homepage",
  other_site: "Another website",
  not_found: "Not found (dead link)",
  error: "Could not be reached",
  blocked: "Refused by the safety rules",
};

/** The site an address belongs to: its host without a leading www. */
export function siteKey(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** True when two hosts belong to the same site (one equals or is a subdomain of the other). */
export function sameSite(a: string, b: string): boolean {
  const x = siteKey(a);
  const y = siteKey(b);
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

export function isHomepage(u: URL): boolean {
  return (u.pathname === "/" || u.pathname === "") && !u.search;
}

type Fetcher = (url: string, approvedHosts: readonly string[]) => Promise<FetchResult>;

const defaultFetch: Fetcher = (url, approvedHosts) =>
  safeFetch(url, { approvedHosts, maxBytes: 256 * 1024, timeoutMs: 8_000, accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" });

export async function checkLink(target: LinkTarget, homepageUrl: string | null, fetcher: Fetcher = defaultFetch): Promise<LinkCheckResult> {
  const base = { url: target.url, kind: target.kind, http_status: null, final_url: null };
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    return { ...base, result: "error", detail: "Not a valid web address." };
  }
  // Evidence must belong to the institution being assessed.
  if (target.kind !== "homepage" && homepageUrl) {
    try {
      const home = new URL(homepageUrl);
      if (!sameSite(url.hostname, home.hostname)) {
        return { ...base, result: "other_site", detail: `Points to ${siteKey(url.hostname)}, not the institution's website (${siteKey(home.hostname)}).` };
      }
    } catch {
      /* homepage invalid: checked on its own */
    }
  }
  let res: FetchResult;
  try {
    res = await fetcher(target.url, [siteKey(url.hostname)]);
  } catch (err) {
    if (err instanceof FetchRefused) {
      if (err.reason === "content_type") return { ...base, result: "ok", detail: "Opens a downloadable document." };
      if (err.reason === "host_not_approved") return { ...base, result: "other_site", detail: "Redirects to another website." };
      if (["blocked_address", "ip_literal", "credentials", "port", "protocol"].includes(err.reason)) {
        return { ...base, result: "blocked", detail: err.message.slice(0, 200) };
      }
      return { ...base, result: "error", detail: err.message.slice(0, 200) };
    }
    return { ...base, result: "error", detail: err instanceof Error ? err.message.slice(0, 200) : "Could not be reached." };
  }
  const final = new URL(res.finalUrl);
  const withStatus = { ...base, http_status: res.status, final_url: res.finalUrl };
  if (res.status === 404 || res.status === 410) return { ...withStatus, result: "not_found", detail: `The page returned ${res.status}.` };
  if (res.status >= 400) return { ...withStatus, result: "error", detail: `The page returned ${res.status}.` };
  if (target.kind !== "homepage" && isHomepage(url)) return { ...withStatus, result: "homepage", detail: "This is the homepage, not a disclosure page." };
  if (target.kind !== "homepage" && !isHomepage(url) && isHomepage(final)) {
    return { ...withStatus, result: "redirects_to_homepage", detail: "The address now redirects to the homepage; the page may have moved." };
  }
  return { ...withStatus, result: "ok", detail: null };
}

/** All addresses of one record, each once. */
export function linkTargets(entry: {
  homepage_url: string | null; disclosure_url: string | null; extra_links: { label: string; url: string }[] | null;
  assessments: Record<string, { evidence_url?: string | null }> | null;
}): LinkTarget[] {
  const out: LinkTarget[] = [];
  const add = (url: string | null | undefined, kind: string) => {
    if (url && !out.some((t) => t.url === url)) out.push({ url, kind });
  };
  add(entry.homepage_url, "homepage");
  add(entry.disclosure_url, "disclosure");
  for (const l of entry.extra_links ?? []) add(l.url, "extra");
  for (const [key, a] of Object.entries(entry.assessments ?? {})) add(a?.evidence_url, `evidence:${key}`);
  return out.slice(0, 20);
}

/** Check several addresses, a few at a time. */
export async function checkLinks(targets: LinkTarget[], homepageUrl: string | null, fetcher?: Fetcher, concurrency = 4): Promise<LinkCheckResult[]> {
  const results: LinkCheckResult[] = new Array(targets.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (next < targets.length) {
      const i = next++;
      results[i] = await checkLink(targets[i], homepageUrl, fetcher);
    }
  }));
  return results;
}

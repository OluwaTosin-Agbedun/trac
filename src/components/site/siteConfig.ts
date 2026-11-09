// Where the public site lives and who to contact, from environment settings. Read on the server
// (SITE_URL and CONTACT_EMAIL are not NEXT_PUBLIC_ values). Nothing here is secret: both are shown on
// the site. Every value is checked; a malformed one is treated as unset rather than passed on.

export interface SiteConfig {
  /** The public origin from SITE_URL, e.g. "https://tracker.example.org", or null when unset. */
  origin: string | null;
  /** NEXT_PUBLIC_BASE_PATH, e.g. "/tracker", or "" at the domain root. */
  basePath: string;
  /** CONTACT_EMAIL for "Report an error", or null when unset (then the line is not shown). */
  contactEmail: string | null;
}

/** SITE_URL is an origin only (scheme, host, optional port), as the invitation links expect. */
export function parseOrigin(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(s) ? s : null;
}

export function parseBasePath(raw: string | undefined): string {
  const s = (raw ?? "").trim().replace(/\/+$/, "");
  return /^(\/[A-Za-z0-9._~-]+)+$/.test(s) ? s : "";
}

export function parseEmail(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return s.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(s) ? s : null;
}

export function siteConfig(env: Record<string, string | undefined> = process.env): SiteConfig {
  return {
    origin: parseOrigin(env.SITE_URL),
    basePath: parseBasePath(env.NEXT_PUBLIC_BASE_PATH),
    contactEmail: parseEmail(env.CONTACT_EMAIL),
  };
}

/** An absolute address for a site path ("/institutions"), or null when SITE_URL is not set. */
export function absoluteUrl(path: string, cfg: SiteConfig = siteConfig()): string | null {
  if (!cfg.origin) return null;
  // The home page is "/tracker" under a base path (no trailing slash), "https://host/" at the root.
  if (path === "/" || path === "") return cfg.basePath ? `${cfg.origin}${cfg.basePath}` : `${cfg.origin}/`;
  return `${cfg.origin}${cfg.basePath}${path.startsWith("/") ? path : `/${path}`}`;
}

// Plain-text extraction from fetched HTML. The output is data for people and the model to read; it
// is never rendered as HTML. Framework-free.

export const TEXT_LIMITS = { maxHtmlChars: 2_000_000, maxTextChars: 200_000, maxLinks: 800 } as const;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘",
  rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", copy: "©", reg: "®", naira: "₦", bull: "•", middot: "·",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/[ \t\f\v ]+/g, " ").trim();

export interface ExtractedLink {
  url: string;
  text: string;
}

export interface ExtractedPage {
  title: string | null;
  text: string;
  links: ExtractedLink[];
  truncated: boolean;
}

export function extractHtml(html: string, baseUrl: string): ExtractedPage {
  let truncated = html.length > TEXT_LIMITS.maxHtmlChars;
  let src = truncated ? html.slice(0, TEXT_LIMITS.maxHtmlChars) : html;
  src = src.replace(/<!--[\s\S]*?-->/g, " ");
  const titleMatch = /<title[^>]*>([\s\S]{0,2000}?)<\/title>/i.exec(src);
  const title = titleMatch ? clean(titleMatch[1]).slice(0, 300) || null : null;
  src = src.replace(/<(script|style|noscript|svg|template|iframe|object|head)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\b([^>]{0,2000})>([\s\S]{0,3000}?)<\/a\s*>/gi;
  for (let m = linkRe.exec(src); m && links.length < TEXT_LIMITS.maxLinks; m = linkRe.exec(src)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[1]);
    const raw = href ? decodeEntities(href[1] ?? href[2] ?? href[3] ?? "").trim() : "";
    if (!raw || /^(javascript|mailto|tel|data):/i.test(raw)) continue;
    let url: URL;
    try {
      url = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ url: key, text: clean(m[2]).slice(0, 200) });
  }

  let text = src
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|tr|table|thead|tbody|tfoot|section|article|header|footer|main|nav|aside|h[1-6]|blockquote|pre|dl|dt|dd|figure|figcaption|caption|form|fieldset)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  text = decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim())
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
  if (text.length > TEXT_LIMITS.maxTextChars) {
    text = text.slice(0, TEXT_LIMITS.maxTextChars);
    truncated = true;
  }
  return { title, text, links, truncated };
}

/** Text from a text/plain response, bounded the same way. */
export function extractPlain(body: string): ExtractedPage {
  const truncated = body.length > TEXT_LIMITS.maxTextChars;
  return { title: null, text: (truncated ? body.slice(0, TEXT_LIMITS.maxTextChars) : body).trim(), links: [], truncated };
}

/** Whitespace- and case-insensitive containment, matching the database's own check. */
export function normText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function excerptAppearsIn(excerpt: string, text: string): boolean {
  const e = normText(excerpt);
  return e.length >= 12 && normText(text).includes(e);
}

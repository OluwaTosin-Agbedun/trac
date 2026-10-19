// Parser for the legacy "REPORT ON FINANCIAL TRANSPARENCY COMPLIANCE" tab-separated export.
// Pure and dependency-free so the import centre, scripts and tests share it. Nothing here
// decides identity or truth: it stages rows, maps fixed columns and raises issues for humans.
// Uses only erasable TypeScript so Node can run it directly (type stripping).

export const INDICATOR_KEYS = [
  "budget_personnel",
  "budget_overhead",
  "budget_capital",
  "grants_domestic",
  "grants_international",
  "tetfund_allocation",
  "endowment_fund",
  "students_undergraduate",
  "students_postgraduate",
] as const;

export type IndicatorKey = (typeof INDICATOR_KEYS)[number];
export type SectionKey =
  | "federal_university"
  | "federal_polytechnic"
  | "federal_monotechnic"
  | "state_university"
  | "state_polytechnic"
  | "state_monotechnic";

export type LegacyStatus =
  | "yes"
  | "no"
  | "partial"
  | "not_yet_updated"
  | "page_not_found"
  | "under_maintenance"
  | "blank"
  | "other";

export type IssueCode =
  | "ref_serial"
  | "missing_name"
  | "blank_indicator"
  | "state_conflict"
  | "location_not_state"
  | "website_missing"
  | "website_not_url"
  | "website_multiple_urls"
  | "website_missing_protocol"
  | "website_share_link"
  | "website_markdown_link"
  | "website_merged_status"
  | "website_third_party"
  | "potential_duplicate"
  | "shared_domain"
  | "website_hyperlink";

export interface Issue {
  code: IssueCode;
  detail: string;
  /** Holding issues keep the row out of automatic commit until a human resolves it. */
  holds: boolean;
}

export interface StagedRow {
  section: SectionKey;
  /** 1-based physical line where the row starts in the source file. */
  sourceLine: number;
  /** Position within its section, counting candidate rows only. */
  sectionIndex: number;
  serialRaw: string;
  cells: string[];
  mapped: {
    name: string | null;
    stateRaw: string | null;
    /** The state cell matched to a Nigerian state, or null when it names a town or is blank. */
    stateCanonical: string | null;
    head: string | null;
    bursar: string | null;
    websiteRaw: string | null;
    /** Proposed addresses, possibly repaired (protocol added, one of several). Never data on their own. */
    websiteCandidates: string[];
    /**
     * True only when the single candidate may go into a draft as it stands: the cell held exactly one
     * valid http(s) URL as written, or the address is the cell's real hyperlink and the cell shows no
     * other address, and nothing about it was inferred, held or shared with another row (SPEC §8.7).
     * Otherwise an editor confirms it.
     */
    websiteConfirmed: boolean;
    legacyStatusRaw: string | null;
    legacyStatus: LegacyStatus;
    ownership: "federal" | "state";
    institutionType: "university" | "polytechnic" | "monotechnic";
  };
  /** Legacy, unverified claims. true = recorded as disclosed, false = not recorded, null = blank. */
  legacyIndicators: Record<IndicatorKey, boolean | null>;
  issues: Issue[];
}

export interface IgnoredRow {
  sourceLine: number;
  reason: "title" | "header" | "subheader" | "section_heading" | "template" | "blank";
  section: SectionKey | null;
}

export interface ParseResult {
  title: string | null;
  reportedAsOf: string | null; // ISO date from the heading, e.g. 2026-10-10
  rows: StagedRow[];
  ignored: IgnoredRow[];
  totals: Record<SectionKey, number>;
}

const SECTION_BY_HEADER: Array<[RegExp, SectionKey]> = [
  [/^FEDERAL UNIVERSITY$/i, "federal_university"],
  [/^FEDERAL POLYTE(C)?H?NICS$/i, "federal_polytechnic"],
  [/^MONOTECHNIC$/i, "federal_monotechnic"],
  [/^STATE UNIVERSITY$/i, "state_university"],
  [/^STATE POLYTECHNICS$/i, "state_polytechnic"],
  [/^STATE MONOTECHNICS$/i, "state_monotechnic"],
];

/** Fixed columns. Indicators always occupy columns 8–16, whatever else is blank. */
const COL = { serial: 0, location: 2, name: 3, head: 4, bursar: 5, website: 6, status: 7, firstIndicator: 8 };

/** Federal monotechnics put the name where other sections put the state, and have no state. */
function mapIdentity(section: SectionKey, c: string[]) {
  if (section === "federal_monotechnic") {
    return { name: c[COL.location], stateRaw: null };
  }
  return { name: c[COL.name], stateRaw: c[COL.location] };
}

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River",
  "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
  "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau",
  "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT",
];

const STATE_ALIASES: Record<string, string> = {
  "cross-river": "Cross River", "akwa-ibom": "Akwa Ibom", "anmbra": "Anambra", "bornu": "Borno",
  "delta state": "Delta", "abuja": "FCT", "federal capital territory": "FCT",
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalState(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (STATE_ALIASES[k]) return STATE_ALIASES[k];
  return NIGERIAN_STATES.find((s) => s.toLowerCase() === k) ?? null;
}

/** States named inside an institution's name, e.g. "Federal University, Otuoke, Bayelsa". */
function statesInName(name: string): string[] {
  // "Niger Delta" is a region, not Niger or Delta State.
  const n = ` ${norm(name)} `.replace(/ niger delta /g, " ");
  return NIGERIAN_STATES.filter((s) => {
    if (s === "FCT") return false;
    const t = norm(s);
    // "Niger" is also part of "Nigeria"/"Nigerian"; word boundaries handle that.
    return n.includes(` ${t} `);
  });
}

/** One source row: its line (TSV/CSV) or row number (Excel), cell texts and any cell hyperlinks. */
export interface SourceRecord {
  line: number;
  cells: string[];
  /** Hyperlink targets by column, recovered from spreadsheet cells (Excel only). */
  links?: (string | null)[];
}

/** Split TSV honouring Excel-style quoted fields that may contain tabs, newlines and "". */
export function splitTsv(text: string): SourceRecord[] {
  return splitDelimited(text, "\t");
}

/** Split delimited text (tab or comma) honouring quoted fields with delimiters, newlines and "". */
export function splitDelimited(text: string, delim: "\t" | ","): SourceRecord[] {
  const out: SourceRecord[] = [];
  const src = text.replace(/\r\n?/g, "\n");
  let i = 0;
  let line = 1;
  while (i <= src.length) {
    const startLine = line;
    const cells: string[] = [];
    let cell = "";
    let atCellStart = true;
    let done = false;
    while (!done) {
      if (i >= src.length) { cells.push(cell); done = true; i++; break; }
      const ch = src[i];
      if (atCellStart && ch === '"') {
        // Quoted cell: read until a closing quote followed by tab, newline or end.
        i++;
        let q = "";
        for (;;) {
          if (i >= src.length) break;
          const c2 = src[i];
          if (c2 === '"') {
            if (src[i + 1] === '"') { q += '"'; i += 2; continue; }
            const next = src[i + 1];
            if (next === delim || next === "\n" || next === undefined) { i++; break; }
            q += '"'; i++; continue; // stray quote inside a quoted cell
          }
          if (c2 === "\n") line++;
          q += c2; i++;
        }
        cell = q;
        atCellStart = false;
        continue;
      }
      if (ch === delim) { cells.push(cell); cell = ""; atCellStart = true; i++; continue; }
      if (ch === "\n") { cells.push(cell); line++; i++; done = true; break; }
      cell += ch; atCellStart = false; i++;
    }
    out.push({ line: startLine, cells });
  }
  // Drop the phantom empty record produced by a trailing newline.
  if (out.length && out[out.length - 1].cells.every((c) => c === "")) out.pop();
  return out;
}

function clean(s: string | undefined): string | null {
  if (s === undefined) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

export function normaliseLegacyStatus(raw: string | null): LegacyStatus {
  if (!raw) return "blank";
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (k === "yes") return "yes";
  if (k === "no") return "no";
  if (k === "partial") return "partial";
  if (k === "not yet updated") return "not_yet_updated";
  if (k.includes("page not found") || k.includes("no page found")) return "page_not_found";
  if (k.includes("maintain") || k.includes("maintenance")) return "under_maintenance";
  return "other";
}

const THIRD_PARTY_HOSTS = ["nucis.ng", "myschool.ng", "campus.africa", "booking.page", "tetfund.gov.ng", "oyostate.gov.ng"];

/** Inspect a website cell. Never rewrites it: returns proposed URL candidates and issues. */
export function analyseWebsite(raw: string | null): { candidates: string[]; issues: Issue[]; mergedStatus: string | null } {
  const issues: Issue[] = [];
  if (!raw || /^not found$/i.test(raw.trim())) {
    issues.push({ code: "website_missing", detail: raw ? `Cell says "${raw.trim()}"` : "No website recorded", holds: false });
    return { candidates: [], issues, mergedStatus: null };
  }
  let text = raw.trim();
  let mergedStatus: string | null = null;
  const merged = text.match(/^(\S+)\s{2,}(YES|NO|PARTIAL)$/i);
  if (merged) {
    mergedStatus = merged[2];
    text = merged[1];
    issues.push({ code: "website_merged_status", detail: `Status "${merged[2]}" is merged into the website cell`, holds: true });
  }
  const md = text.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
  if (md) {
    issues.push({ code: "website_markdown_link", detail: "Markdown link syntax in cell", holds: false });
    text = md[1];
  }
  const urls = text.match(/(?:https?:\/\/|ttps:\/\/|www\.)[^\s"]+/gi) ?? [];
  const bareDomain = !urls.length && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text) ? [text] : [];
  const found = [...urls, ...bareDomain];
  if (!found.length) {
    issues.push({ code: "website_not_url", detail: `Cell holds text, not a URL: "${text}"`, holds: true });
    return { candidates: [], issues, mergedStatus };
  }
  if (found.length > 1) {
    issues.push({ code: "website_multiple_urls", detail: `${found.length} URLs in one cell`, holds: false });
  }
  const candidates = found.map((u) => {
    let v = u;
    if (/^ttps:\/\//i.test(v)) v = "h" + v;
    if (!/^https?:\/\//i.test(v)) {
      issues.push({ code: "website_missing_protocol", detail: `"${u}" has no protocol; proposed https://`, holds: false });
      v = "https://" + v.replace(/^\/\//, "");
    }
    return v;
  });
  for (const c of candidates) {
    const host = hostOf(c);
    if (host === "share.google") {
      issues.push({ code: "website_share_link", detail: "Google share link, not an official address", holds: true });
    } else if (host && THIRD_PARTY_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
      issues.push({ code: "website_third_party", detail: `${host} is a third-party site, not the institution's own`, holds: true });
    }
  }
  if (/managed via/i.test(text)) {
    issues.push({ code: "website_not_url", detail: `Cell mixes text with a URL: "${text}"`, holds: true });
  }
  return { candidates, issues, mergedStatus };
}

/** Issues meaning a proposed address was inferred, ambiguous or shared, so it needs a human decision. */
const UNCONFIRMED_WEBSITE: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "website_missing_protocol", "website_multiple_urls", "website_markdown_link", "website_merged_status", "shared_domain",
]);

function websiteIsConfirmed(asWritten: string, candidates: string[], issues: Issue[]): boolean {
  if (candidates.length !== 1 || candidates[0] !== asWritten || !/^https?:\/\/\S+$/i.test(asWritten)) return false;
  if (!hostOf(asWritten)?.includes(".")) return false;
  return !issues.some((i) => UNCONFIRMED_WEBSITE.has(i.code) || (i.holds && i.code.startsWith("website_")));
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Registrable-ish domain: last two labels, or three for *.edu.ng / *.gov.ng / *.com.ng / *.org.ng. */
export function baseDomain(host: string): string {
  const parts = host.split(".");
  const sld = parts.slice(-2).join(".");
  if (["edu.ng", "gov.ng", "com.ng", "org.ng", "net.ng"].includes(sld) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return sld;
}

const STOP = new Set(["of", "the", "and", "state", "federal", "university", "college", "school", "polytechnic", "institute", "technology", "sciences", "science", "health", "campus"]);
function nameTokens(name: string): Set<string> {
  return new Set(norm(name).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function parseTrackerTsv(text: string): ParseResult {
  return parseTrackerRecords(splitTsv(text));
}

/** The same layout saved as CSV. */
export function parseTrackerCsv(text: string): ParseResult {
  return parseTrackerRecords(splitDelimited(text.replace(/^﻿/, ""), ","));
}

/** Shared by TSV, CSV and Excel input: section detection, fixed-column mapping and issues. */
export function parseTrackerRecords(records: SourceRecord[]): ParseResult {
  const rows: StagedRow[] = [];
  const ignored: IgnoredRow[] = [];
  const totals = {
    federal_university: 0, federal_polytechnic: 0, federal_monotechnic: 0,
    state_university: 0, state_polytechnic: 0, state_monotechnic: 0,
  } as Record<SectionKey, number>;
  let section: SectionKey | null = null;
  let title: string | null = null;
  let reportedAsOf: string | null = null;

  for (const { line, cells, links } of records) {
    const c = cells;
    const joined = c.join(" ").trim();
    if (!joined) { ignored.push({ sourceLine: line, reason: "blank", section }); continue; }

    if (/REPORT ON FINANCIAL TRANSPARENCY COMPLIANCE/i.test(joined)) {
      title = "REPORT ON FINANCIAL TRANSPARENCY COMPLIANCE";
      const m = joined.match(/As at\s+([A-Z]+)\s+(\d{1,2}),\s*(\d{4})/i);
      if (m) {
        const month = ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(m[1].toLowerCase()) + 1;
        if (month > 0) reportedAsOf = `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      }
      ignored.push({ sourceLine: line, reason: "title", section });
      continue;
    }
    if (/^S\/N$/i.test((c[COL.serial] ?? "").trim())) {
      const label = (c[COL.name] ?? "").trim() || (c[COL.location] ?? "").trim();
      const hit = SECTION_BY_HEADER.find(([re]) => re.test(label));
      if (!hit) throw new Error(`Unrecognised section header at line ${line}: "${label}"`);
      section = hit[1];
      ignored.push({ sourceLine: line, reason: "header", section });
      continue;
    }
    // e.g. "FEDERAL POLYTECHNICS ... COMPLIANCE CHECKLIST": a heading, never an institution.
    if (/COMPLIANCE CHECKLIST/i.test(joined) && !c.slice(COL.firstIndicator).some((v) => /^(TRUE|FALSE)$/i.test(v.trim()))) {
      ignored.push({ sourceLine: line, reason: "section_heading", section });
      continue;
    }
    if (/^personnel costs$/i.test((c[COL.firstIndicator] ?? "").trim())) {
      ignored.push({ sourceLine: line, reason: "subheader", section });
      continue;
    }
    if (!section) throw new Error(`Data before any section header at line ${line}`);

    const identityCells = c.slice(0, COL.firstIndicator).map((v) => v.trim());
    if (identityCells.every((v) => v === "")) {
      ignored.push({ sourceLine: line, reason: "template", section });
      continue;
    }

    const id = mapIdentity(section, c);
    const name = clean(id.name);
    const stateRaw = clean(id.stateRaw ?? undefined);
    const websiteRaw = c[COL.website] === undefined ? null : (c[COL.website].trim() === "" ? null : c[COL.website]);
    const statusRaw = clean(c[COL.status]);
    const issues: Issue[] = [];

    const serialRaw = (c[COL.serial] ?? "").trim();
    if (serialRaw === "#REF!") issues.push({ code: "ref_serial", detail: "Serial cell is #REF!; kept as provenance only", holds: false });
    if (!name) issues.push({ code: "missing_name", detail: "No institution name; identify manually (do not infer from the domain)", holds: true });

    const legacyIndicators = {} as Record<IndicatorKey, boolean | null>;
    INDICATOR_KEYS.forEach((key, i) => {
      const v = (c[COL.firstIndicator + i] ?? "").trim().toUpperCase();
      legacyIndicators[key] = v === "TRUE" ? true : v === "FALSE" ? false : null;
      if (v !== "TRUE" && v !== "FALSE") {
        issues.push({ code: "blank_indicator", detail: `${key} is blank in column ${COL.firstIndicator + i + 1}; kept as unknown`, holds: false });
      }
    });

    if (stateRaw) {
      const canon = canonicalState(stateRaw);
      if (!canon) {
        issues.push({ code: "location_not_state", detail: `"${stateRaw}" is a place, not a state; state needs confirming`, holds: false });
      }
      if (name) {
        const named = statesInName(name);
        if (canon && named.length && !named.includes(canon)) {
          issues.push({ code: "state_conflict", detail: `State cell says ${canon} but the name mentions ${named.join(", ")}`, holds: true });
        }
      }
    }

    // Excel: a cell showing a page title may carry the real address as a hyperlink. Use it as the
    // proposed URL while keeping the display text verbatim.
    const link = links?.[COL.website] ?? null;
    const linkOk = typeof link === "string" && /^https?:\/\//i.test(link.trim());
    const web = linkOk ? analyseWebsite(link.trim()) : analyseWebsite(websiteRaw);
    if (linkOk) {
      web.issues.push({
        code: "website_hyperlink",
        detail: `Address recovered from the cell's hyperlink (the cell shows "${(websiteRaw ?? "").trim().slice(0, 80)}")`,
        holds: false,
      });
      // A cell that shows several addresses, or one on another site, leaves which is meant to a
      // human: the hyperlink stays the proposal but is not confirmed for the draft.
      const shown = analyseWebsite(websiteRaw).candidates;
      const linkHost = hostOf(link.trim());
      if (shown.length > 1 || (shown.length === 1 && hostOf(shown[0]) !== linkHost)) {
        web.issues.push({
          code: "website_multiple_urls",
          detail: shown.length > 1
            ? `The cell shows ${shown.length} URLs; only its hyperlink is proposed`
            : `The cell shows ${shown[0].slice(0, 80)} but its hyperlink goes to ${link.trim().slice(0, 80)}`,
          holds: false,
        });
      }
    }
    issues.push(...web.issues);
    let legacyStatusRaw = statusRaw;
    if (!legacyStatusRaw && web.mergedStatus) legacyStatusRaw = web.mergedStatus;

    const ownership = section.startsWith("federal") ? "federal" : "state";
    const institutionType = section.endsWith("university") ? "university" : section.endsWith("polytechnic") ? "polytechnic" : "monotechnic";

    totals[section]++;
    rows.push({
      section,
      sourceLine: line,
      sectionIndex: totals[section],
      serialRaw,
      cells: c,
      mapped: {
        name,
        stateRaw,
        stateCanonical: canonicalState(stateRaw),
        head: clean(c[COL.head]),
        bursar: clean(c[COL.bursar]),
        websiteRaw,
        websiteCandidates: web.candidates,
        websiteConfirmed: websiteIsConfirmed(linkOk ? link.trim() : (websiteRaw ?? "").trim(), web.candidates, issues),
        legacyStatusRaw,
        legacyStatus: normaliseLegacyStatus(legacyStatusRaw),
        ownership,
        institutionType,
      },
      legacyIndicators,
      issues,
    });
  }

  flagCrossRowIssues(rows);
  // A domain shared with other rows is only known now; such an address waits for an editor too.
  for (const r of rows) {
    if (r.mapped.websiteConfirmed && r.issues.some((i) => UNCONFIRMED_WEBSITE.has(i.code))) r.mapped.websiteConfirmed = false;
  }
  return { title, reportedAsOf, rows, ignored, totals };
}

/** Potential duplicates and shared domains. Flags only; never merges. */
function flagCrossRowIssues(rows: StagedRow[]): void {
  const byDomain = new Map<string, StagedRow[]>();
  const byName = new Map<string, StagedRow[]>();
  for (const r of rows) {
    if (r.mapped.name) {
      const k = norm(r.mapped.name);
      byName.set(k, [...(byName.get(k) ?? []), r]);
    }
    const domains = new Set(r.mapped.websiteCandidates.map(hostOf).filter((h): h is string => !!h).map(baseDomain));
    for (const d of domains) byDomain.set(d, [...(byDomain.get(d) ?? []), r]);
  }
  const ref = (r: StagedRow) => `${r.section} #${r.sectionIndex} (line ${r.sourceLine})`;
  const dupPairs = new Set<string>();
  const addDup = (a: StagedRow, b: StagedRow, why: string) => {
    const key = [a.sourceLine, b.sourceLine].sort((x, y) => x - y).join("-");
    if (dupPairs.has(key)) return;
    dupPairs.add(key);
    a.issues.push({ code: "potential_duplicate", detail: `${why} as ${ref(b)}`, holds: true });
    b.issues.push({ code: "potential_duplicate", detail: `${why} as ${ref(a)}`, holds: true });
  };
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) addDup(group[i], group[j], "Same name");
  }
  for (const [domain, group] of byDomain) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.mapped.name && b.mapped.name && jaccard(nameTokens(a.mapped.name), nameTokens(b.mapped.name)) >= 0.5) {
          addDup(a, b, `Same domain (${domain}) and similar name`);
        }
      }
    }
    for (const r of group) {
      if (!r.issues.some((x) => x.code === "shared_domain")) {
        r.issues.push({ code: "shared_domain", detail: `${domain} is also used by ${group.length - 1} other row(s); a shared domain alone is not a duplicate`, holds: false });
      }
    }
  }
}

/** A row can be committed automatically only when no issue holds it. */
export function isHeld(row: StagedRow): boolean {
  return row.issues.some((i) => i.holds);
}

export function summarise(result: ParseResult) {
  const count = (code: IssueCode) => result.rows.filter((r) => r.issues.some((i) => i.code === code)).length;
  return {
    reportedAsOf: result.reportedAsOf,
    candidates: result.rows.length,
    totals: result.totals,
    ignoredTemplate: result.ignored.filter((i) => i.reason === "template").length,
    held: result.rows.filter(isHeld).length,
    ready: result.rows.filter((r) => !isHeld(r)).length,
    refSerials: count("ref_serial"),
    missingName: count("missing_name"),
    blankIndicatorCells: result.rows.reduce((n, r) => n + r.issues.filter((i) => i.code === "blank_indicator").length, 0),
    stateConflicts: count("state_conflict"),
    potentialDuplicates: count("potential_duplicate"),
    sharedDomain: count("shared_domain"),
    websiteNeedsReview: result.rows.filter((r) => r.issues.some((i) => i.code.startsWith("website_") && i.holds)).length,
    /** Rows with a proposed address that is not copied into the draft until an editor confirms it. */
    websiteToConfirm: result.rows.filter((r) => r.mapped.websiteCandidates.length && !r.mapped.websiteConfirmed).length,
  };
}

export const FEDERAL_SECTIONS: readonly SectionKey[] = ["federal_university", "federal_polytechnic", "federal_monotechnic"];

/**
 * The tracker covers federal institutions only. Keeps the three federal sections, and drops
 * cross-row notes (possible duplicate, shared domain) that only point at a state row, so a
 * federal row is not held because of a row that is never imported.
 */
export function federalOnly(result: ParseResult): ParseResult & { excludedStateRows: number } {
  const federal = (s: string) => (FEDERAL_SECTIONS as readonly string[]).includes(s);
  const rows = result.rows
    .filter((r) => federal(r.section))
    .map((r) => ({
      ...r,
      issues: r.issues.filter((i) => !((i.code === "potential_duplicate" || i.code === "shared_domain") && /\bstate_(university|polytechnic|monotechnic)\b/.test(i.detail) && !/\bfederal_/.test(i.detail))),
    }));
  const totals = { ...result.totals };
  for (const k of Object.keys(totals) as SectionKey[]) if (!federal(k)) totals[k] = 0;
  return { ...result, rows, totals, excludedStateRows: result.rows.length - rows.length };
}

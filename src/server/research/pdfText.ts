// Text from a fetched PDF, for the research worker only (never in a web request). Framework-free.
//
// The PDF came from a website, so it is untrusted: it is parsed in a separate worker thread with a
// memory cap, at most PDF_LIMITS.maxPages pages are read, and the thread is terminated when the time
// limit passes (a timer alone cannot interrupt a parser that never yields). The serverless PDF.js
// build in unpdf runs no scripts and evaluates no code from the document.
//
// Each page's text is prefixed with a "[Page N]" line, so the model can cite the page and the server
// can work out which page an excerpt came from (pageOfExcerpt). The markers are part of the stored
// text, so the verbatim check still compares against exactly what is stored.
import { Worker } from "node:worker_threads";
import { normText } from "./extractText.ts";

export const PDF_LIMITS = { maxPages: 60, timeoutMs: 20_000, maxTextChars: 200_000, minTextChars: 40, memoryMb: 256 } as const;

/** Shown in the scan coverage for a PDF with no text layer. */
export const UNREADABLE_SCANNED = "unreadable (scanned or image-only)";

export interface PdfText {
  /** Page-marked text, or "" when nothing readable came out. */
  text: string;
  /** Pages in the document (0 when it could not be opened). */
  pageCount: number;
  pagesRead: number;
  truncated: boolean;
  /** False for a scanned or image-only PDF, or one that could not be opened. */
  readable: boolean;
  /** Plain words for editors: why text is missing or incomplete. Null when everything was read. */
  note: string | null;
  /** For the scan coverage when readable is false. */
  unreadableReason: string | null;
}

// Runs inside the worker thread as CommonJS. "unpdf" resolves from the working directory, which is
// the project folder for `npm run worker`, the dev server and the tests.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { getDocumentProxy } = await import("unpdf");
  // No font or CMap locations: the reader never opens a file or an address a document names.
  const pdf = await getDocumentProxy(new Uint8Array(workerData.bytes), {
    isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: false, verbosity: 0,
    cMapUrl: null, standardFontDataUrl: null,
  });
  const total = pdf.numPages;
  const pages = [];
  for (let i = 1; i <= Math.min(total, workerData.maxPages); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.filter((it) => typeof it.str === "string").map((it) => it.str + (it.hasEOL ? "\\n" : "")).join(""));
    page.cleanup();
  }
  await pdf.loadingTask.destroy();
  parentPort.postMessage({ total, pages });
})().catch((err) => parentPort.postMessage({ error: String(err && err.message || err).slice(0, 200) }));
`;

type WorkerReply = { total: number; pages: string[] } | { error: string } | { timedOut: true };

function runWorker(bytes: Uint8Array, maxPages: number, timeoutMs: number): Promise<WorkerReply> {
  return new Promise((resolve) => {
    // A fresh copy is transferred to the thread, so the caller's buffer (often a pooled Buffer) is untouched.
    const own = new Uint8Array(bytes.byteLength);
    own.set(bytes);
    const copy = own.buffer;
    let settled = false;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { bytes: copy, maxPages },
      transferList: [copy],
      resourceLimits: { maxOldGenerationSizeMb: PDF_LIMITS.memoryMb, maxYoungGenerationSizeMb: 32 },
      stdout: true,
      stderr: true,
    });
    const done = (reply: WorkerReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(reply);
    };
    const timer = setTimeout(() => done({ timedOut: true }), timeoutMs);
    worker.on("message", (m: WorkerReply) => done(m));
    worker.on("error", (err) => done({ error: err instanceof Error ? err.message.slice(0, 200) : "the reader stopped" }));
    worker.on("exit", () => done({ error: "the reader stopped" }));
  });
}

/**
 * Text that looks like our own page markers is neutralised so a document cannot fake a page number.
 * It runs after spacing is normalised, and allows any spacing inside the brackets, because the
 * verbatim check and pageOfExcerpt compare with all whitespace collapsed ("[Page\n9]" counts too).
 */
const MARKER_RE = /\[\s*page\s*(\d{1,4})\s*\]/gi;
/** Control characters (newline and tab kept) and unpaired surrogates, which Postgres cannot store. */
const UNSTORABLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** One page's text as stored: storable characters, single spaces, at most one blank line, no fake markers. */
export function cleanPdfPage(s: string): string {
  return s.replace(UNSTORABLE_RE, "").replace(/\r/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n")
    .replace(MARKER_RE, "(page $1)").trim();
}

export async function extractPdfText(
  bytes: Uint8Array,
  opts: { truncatedDownload?: boolean; maxPages?: number; timeoutMs?: number } = {},
): Promise<PdfText> {
  const unreadable = (note: string, reason: string, pageCount = 0): PdfText =>
    ({ text: "", pageCount, pagesRead: 0, truncated: false, readable: false, note, unreadableReason: reason });
  if (opts.truncatedDownload) {
    return unreadable("This PDF is larger than 5 MB, so only part of it was downloaded and its text could not be read. Open it to review it by hand.",
      "unreadable (larger than 5 MB)");
  }
  const maxPages = Math.min(opts.maxPages ?? PDF_LIMITS.maxPages, PDF_LIMITS.maxPages);
  let reply: WorkerReply;
  try {
    reply = await runWorker(bytes, maxPages, opts.timeoutMs ?? PDF_LIMITS.timeoutMs);
  } catch (err) {
    // The reader thread could not be started: this document is reported, the rest of the scan goes on.
    reply = { error: err instanceof Error ? err.message.slice(0, 200) : "the reader could not start" };
  }
  if ("timedOut" in reply) {
    return unreadable(`Reading this PDF took longer than ${Math.round((opts.timeoutMs ?? PDF_LIMITS.timeoutMs) / 1000)} seconds, so it was stopped. Open it to review it by hand.`,
      "unreadable (took too long to read)");
  }
  if ("error" in reply) return unreadable("This PDF could not be opened (it may be damaged or protected). Open it to review it by hand.", "unreadable (could not be opened)");

  const pages = reply.pages.map((p) => cleanPdfPage(typeof p === "string" ? p : ""));
  const readableChars = pages.reduce((n, p) => n + p.replace(/\s+/g, "").length, 0);
  if (readableChars < PDF_LIMITS.minTextChars) {
    return unreadable("No text could be read from this PDF: it looks scanned or image-only. Open it to review it by hand.", UNREADABLE_SCANNED, reply.total);
  }
  let text = pages.map((p, i) => `[Page ${i + 1}]\n${p}`).join("\n\n");
  let truncated = reply.total > pages.length;
  if (text.length > PDF_LIMITS.maxTextChars) {
    text = text.slice(0, PDF_LIMITS.maxTextChars);
    truncated = true;
  }
  const notes: string[] = [];
  if (reply.total > pages.length) notes.push(`Only the first ${pages.length} of ${reply.total} pages were read.`);
  else if (truncated) notes.push("Only the first part of this PDF's text was kept.");
  return { text, pageCount: reply.total, pagesRead: pages.length, truncated, readable: true, note: notes.join(" ") || null, unreadableReason: null };
}

/**
 * The page an excerpt sits on, from the "[Page N]" markers before it in the stored text (compared
 * the same way as the verbatim check), or null when the text has no markers or lacks the excerpt.
 */
export function pageOfExcerpt(excerpt: string, text: string): number | null {
  const hay = normText(text);
  const needle = normText(excerpt);
  const at = needle ? hay.indexOf(needle) : -1;
  if (at < 0) return null;
  const own = /^\[page (\d{1,4})\]/.exec(needle); // the excerpt starts with a page marker
  if (own) return Number(own[1]);
  let page: number | null = null;
  for (const m of hay.slice(0, at).matchAll(/\[page (\d{1,4})\]/g)) page = Number(m[1]);
  return page;
}

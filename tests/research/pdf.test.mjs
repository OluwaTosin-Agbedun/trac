// PDF text for the research worker: page-marked text from a hand-built PDF, scanned and broken
// documents, the page and time limits, page locators and the pages sent to the model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPdfPage, extractPdfText, pageOfExcerpt, PDF_LIMITS, UNREADABLE_SCANNED } from "../../src/server/research/pdfText.ts";
import { excerptAppearsIn } from "../../src/server/research/extractText.ts";
import { pdfLocator, textForModel } from "../../src/server/research/extract.ts";
import { makePdf } from "./pdfFixture.mjs";

const BUDGET_PDF = makePdf([
  ["Approved Budget 2026", "Summary of revenue and expenditure for the year"],
  ["Personnel costs: N4,250,500,000.00", "Capital expenditure: N1,200,000,000", "[Page 9] is not a real page marker"],
]);

test("a PDF's text is read page by page, with a marker before each page", async () => {
  const r = await extractPdfText(BUDGET_PDF);
  assert.equal(r.readable, true);
  assert.equal(r.pageCount, 2);
  assert.equal(r.pagesRead, 2);
  assert.equal(r.note, null);
  assert.match(r.text, /^\[Page 1\]\nApproved Budget 2026\n/);
  assert.match(r.text, /\n\n\[Page 2\]\nPersonnel costs: N4,250,500,000\.00\n/);
  // Text inside the document cannot pose as a page marker.
  assert.ok(!r.text.includes("[Page 9]"));
  assert.ok(r.text.includes("(page 9) is not a real page marker"));
  // What is stored is what the verbatim check compares against.
  assert.ok(excerptAppearsIn("Personnel costs: N4,250,500,000.00", r.text));
  assert.equal(pageOfExcerpt("Personnel costs: N4,250,500,000.00", r.text), 2);
  assert.equal(pageOfExcerpt("approved budget 2026", r.text), 1);
  assert.equal(pageOfExcerpt("[Page 2] Personnel costs", r.text), 2);
  assert.equal(pageOfExcerpt("not in the document at all", r.text), null);
  assert.equal(pageOfExcerpt("some text", "web page text without markers, some text"), null);
});

test("no spacing trick lets a document fake a page marker, and unstorable characters are removed", async () => {
  for (const fake of ["[Page  9]", "[page\n9]", "[ PAGE 12 ]", "[Page\t3]", "[page9]"]) {
    const out = cleanPdfPage(`Intro ${fake} Personnel costs: N1,000,000`);
    assert.ok(!/\[\s*page\s*\d+\s*\]/i.test(out), `${JSON.stringify(fake)} was neutralised: ${out}`);
    assert.match(out, /\(page \d+\)/);
  }
  // NUL and other control characters (which Postgres cannot store) and unpaired surrogates are dropped;
  // newlines stay, and a real character outside the basic plane is kept whole.
  assert.equal(cleanPdfPage("Budget\u0000 2026\u0007\nTotal \uD800N5 💰"), "Budget 2026\nTotal N5 💰");
  // Through a real document: the fake marker on page 2 does not move the excerpt to page 9.
  const pdf = makePdf([["Approved Budget 2026 for the whole university"], ["[Page  9]", "Capital expenditure: N1,200,000,000 for 2026"]]);
  const r = await extractPdfText(pdf);
  assert.equal(r.readable, true);
  assert.ok(!/\[\s*page\s*9\s*\]/i.test(r.text), r.text);
  assert.equal(pageOfExcerpt("Capital expenditure: N1,200,000,000", r.text), 2);
});

test("a scanned or image-only PDF stores no text and says why", async () => {
  const r = await extractPdfText(makePdf([[], []]));
  assert.equal(r.text, "");
  assert.equal(r.readable, false);
  assert.equal(r.pageCount, 2);
  assert.equal(r.unreadableReason, UNREADABLE_SCANNED);
  assert.match(r.note, /scanned or image-only/);
  // A few stray characters are not readable text either (the 40-character minimum).
  const stray = await extractPdfText(makePdf([["12"], ["Page 2"]]));
  assert.equal(stray.readable, false);
  assert.equal(stray.text, "");
});

test("broken, oversized and slow PDFs are refused with a reason, never half-read", async () => {
  const broken = await extractPdfText(Buffer.from("%PDF-1.4 this is not really a PDF"));
  assert.equal(broken.readable, false);
  assert.equal(broken.unreadableReason, "unreadable (could not be opened)");
  const cut = await extractPdfText(BUDGET_PDF, { truncatedDownload: true });
  assert.equal(cut.readable, false);
  assert.match(cut.note, /larger than 5 MB/);
  const slow = await extractPdfText(BUDGET_PDF, { timeoutMs: 1 });
  assert.equal(slow.readable, false);
  assert.equal(slow.unreadableReason, "unreadable (took too long to read)");
  assert.equal(slow.text, "");
});

test("at most 60 pages are read, and the note says so", async () => {
  const many = makePdf(Array.from({ length: PDF_LIMITS.maxPages + 5 }, (_, i) => [`Page body number ${i + 1} with enough words to read`]));
  const r = await extractPdfText(many);
  assert.equal(r.pageCount, 65);
  assert.equal(r.pagesRead, 60);
  assert.equal(r.truncated, true);
  assert.equal(r.note, "Only the first 60 of 65 pages were read.");
  assert.ok(r.text.includes("[Page 60]"));
  assert.ok(!r.text.includes("[Page 61]"));
});

const pdfSource = (text) => ({ requestedUrl: "https://u.edu.ng/b.pdf", finalUrl: "https://u.edu.ng/b.pdf", status: 200, contentType: "application/pdf",
  sha256: "a".repeat(64), byteLength: 10, title: "Budget 2026.pdf", text, truncated: false, kind: "document", method: "pdf_text", pageCount: 2, note: null });

test("a PDF proposal's locator names the page the server found", async () => {
  const { text } = await extractPdfText(BUDGET_PDF);
  const src = pdfSource(text);
  const quote = "Personnel costs: N4,250,500,000.00";
  assert.equal(pdfLocator("Budget summary table", quote, src), "Budget summary table, page 2");
  assert.equal(pdfLocator("Budget summary table, page 2", quote, src), "Budget summary table, page 2");
  assert.equal(pdfLocator("Budget summary table, page 7", quote, src), "Budget summary table, page 2", "a wrong page is corrected");
  assert.equal(pdfLocator(null, quote, src), "Budget 2026.pdf, page 2");
  // Web pages keep the model's locator as it is.
  assert.equal(pdfLocator("Budget table", quote, { ...src, method: "html_text" }), "Budget table");
});

test("a long PDF sends its most relevant whole pages to the model, in page order", () => {
  const filler = (n) => `[Page ${n}]\n${"Campus news and sports results. ".repeat(40)}`;
  const text = [filler(1), "[Page 2]\nApproved budget: personnel costs and capital allocation for 2026.", filler(3), "[Page 4]\nTETFund allocation and endowment summary."].join("\n\n");
  const room = 400;
  const r = textForModel(pdfSource(text), room);
  assert.equal(r.selected, true);
  assert.ok(r.text.length <= room);
  assert.match(r.text, /^\[Page 2\]\nApproved budget[\s\S]*\n\n\[Page 4\]\nTETFund/);
  // A web page that does not fit sends its start.
  const web = textForModel({ ...pdfSource("x".repeat(1000)), method: "html_text" }, 100);
  assert.deepEqual([web.text.length, web.cut, web.selected], [100, true, false]);
});

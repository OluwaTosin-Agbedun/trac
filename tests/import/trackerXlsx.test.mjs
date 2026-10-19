// Excel and CSV input produce the same staging result as TSV; hyperlinks behind display text are recovered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createDeflateRaw } from "node:zlib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { isHeld, parseTrackerRecords, parseTrackerTsv, parseTrackerCsv, splitTsv, summarise } from "../../src/lib/import/trackerTsv.ts";
import { readTrackerWorkbook, WorkbookError } from "../../src/lib/import/trackerXlsx.ts";

// JSZip's own copy of pako (not a direct dependency), so the byte counter patches the inflater the import really uses.
const pako = createRequire(fileURLToPath(import.meta.resolve("jszip")))("pako");

const text = readFileSync(new URL("../../data/source/tracker-export-2026-10-10.tsv", import.meta.url), "utf8");
const fromTsv = parseTrackerTsv(text);

async function workbookFromTsv() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Compliance");
  for (const rec of splitTsv(text)) {
    const row = ws.getRow(rec.line);
    rec.cells.forEach((v, i) => {
      if (v === "") return;
      if (v === "Key Institutional Data | NOUN") {
        row.getCell(i + 1).value = { text: v, hyperlink: "https://example.org/noun/key-institutional-data" };
      } else {
        row.getCell(i + 1).value = v;
      }
    });
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

test("an .xlsx copy of the export stages exactly like the TSV", async () => {
  const { records } = await readTrackerWorkbook(await workbookFromTsv());
  const fromXlsx = parseTrackerRecords(records);
  const a = summarise(fromTsv);
  const b = summarise(fromXlsx);
  assert.equal(b.candidates, 399);
  assert.deepEqual(b.totals, a.totals);
  assert.equal(b.refSerials, a.refSerials);
  assert.equal(b.missingName, a.missingName);
  assert.equal(b.blankIndicatorCells, a.blankIndicatorCells);
});

test("a hyperlink behind display text becomes the proposed website, display text kept", async () => {
  const { records } = await readTrackerWorkbook(await workbookFromTsv());
  const noun = parseTrackerRecords(records).rows.find((r) => /National Open University/.test(r.mapped.name ?? ""));
  assert.deepEqual(noun.mapped.websiteCandidates, ["https://example.org/noun/key-institutional-data"]);
  assert.equal(noun.mapped.websiteConfirmed, true, "the cell's real hyperlink is the address as written");
  assert.equal(noun.mapped.websiteRaw, "Key Institutional Data | NOUN");
  assert.ok(noun.issues.some((i) => i.code === "website_hyperlink" && !i.holds));
  assert.ok(!noun.issues.some((i) => i.code === "website_not_url"));
});

test("a hyperlink is confirmed only when the cell does not show a second or different address", () => {
  const records = splitTsv(text).map((r) => ({ ...r, links: [] }));
  const link = (name, url) => { records.find((r) => r.cells[3] === name).links[6] = url; };
  link("Modibbo Adama University of Technology, Yola", "https://mau.edu.ng/");
  link("University of Uyo", "https://www.uniuyo.edu.ng/disclosure-key-institutional-data/");
  link("Michael Okpara University of Agriculture,Umudike", "https://mouau.edu.ng/fund-allocation/");
  link("Federal University of Agriculture, Mubi", "https://elsewhere.example.org/");
  link("University of Maiduguri", "https://www.unimaid.edu.ng/tetfund-record#");
  const rows = parseTrackerRecords(records).rows;
  const row = (name) => rows.find((r) => r.mapped.name === name);
  const multiple = (r) => r.issues.some((i) => i.code === "website_multiple_urls" && !i.holds);

  // The cell shows the same site (www. aside), or a page title: the hyperlink is the address as written.
  for (const name of ["Modibbo Adama University of Technology, Yola", "University of Uyo", "Michael Okpara University of Agriculture,Umudike"]) {
    assert.equal(row(name).mapped.websiteConfirmed, true, name);
    assert.ok(!multiple(row(name)), name);
  }
  assert.deepEqual(row("Michael Okpara University of Agriculture,Umudike").mapped.websiteCandidates, ["https://mouau.edu.ng/fund-allocation/"]);
  assert.ok(!isHeld(row("Michael Okpara University of Agriculture,Umudike")), "a page title with a real link is not held");

  // The cell shows another site, or two addresses of which only one is linked: proposed, not confirmed, not held.
  const mubi = row("Federal University of Agriculture, Mubi");
  assert.deepEqual(mubi.mapped.websiteCandidates, ["https://elsewhere.example.org/"]);
  assert.equal(mubi.mapped.websiteRaw, "https://fuamb.edu.ng");
  assert.equal(mubi.mapped.websiteConfirmed, false);
  assert.ok(multiple(mubi) && !isHeld(mubi));
  const unimaid = row("University of Maiduguri");
  assert.deepEqual(unimaid.mapped.websiteCandidates, ["https://www.unimaid.edu.ng/tetfund-record#"]);
  assert.equal(unimaid.mapped.websiteConfirmed, false);
  assert.ok(multiple(unimaid) && !isHeld(unimaid));
});

test("a zip bomb or a non-workbook is refused before parsing", async () => {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", "<workbook/>");
  zip.file("xl/huge.xml", "a".repeat(61 * 1024 * 1024));
  const bomb = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  assert.ok(bomb.length < 1024 * 1024, "the bomb itself is small");
  await assert.rejects(readTrackerWorkbook(bomb), WorkbookError);
  await assert.rejects(readTrackerWorkbook(new TextEncoder().encode("not a zip")), WorkbookError);
});

// A hand-built zip, so a test can make the central directory lie about sizes. CRCs are not
// checked when loading (JSZip's default), so they are left as zero.
function rawZip(entries) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, e.method, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.declared, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, e.method, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.declared, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, e.data);
    centrals.push(central);
    offset += local.length + e.data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
}

const stored = (name, text) => ({ name, method: 0, data: new TextEncoder().encode(text), declared: Buffer.byteLength(text) });

/** Raw-deflates `mb` megabytes of zeros a megabyte at a time, so the test never holds them all. */
async function deflatedZeros(mb) {
  const d = createDeflateRaw({ level: 9 });
  const out = [];
  d.on("data", (c) => out.push(c));
  const done = once(d, "end");
  const zero = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < mb; i++) d.write(zero);
  d.end();
  await done;
  return new Uint8Array(Buffer.concat(out));
}

/** Counts every byte pako (JSZip's inflater) emits while `fn` runs. */
async function countInflated(fn) {
  const push = pako.Inflate.prototype.push;
  let bytes = 0;
  pako.Inflate.prototype.push = function (...args) {
    const onData = this.onData;
    this.onData = (chunk) => { bytes += chunk.length; return onData.call(this, chunk); };
    try { return push.apply(this, args); } finally { this.onData = onData; }
  };
  try { await fn(); } finally { pako.Inflate.prototype.push = push; }
  return bytes;
}

test("an entry that declares a small size but inflates to 80 MB is stopped early, before ExcelJS", async () => {
  const bomb = await deflatedZeros(80);
  assert.ok(bomb.length < 200 * 1024, "80 MB of zeros deflates to well under the 3 MB upload limit");
  const archive = rawZip([
    stored("[Content_Types].xml", "<Types/>"),
    stored("xl/workbook.xml", "<workbook/>"),
    { name: "xl/worksheets/sheet1.xml", method: 8, data: bomb, declared: 1000 },
  ]);
  const started = Date.now();
  const inflated = await countInflated(() =>
    assert.rejects(readTrackerWorkbook(archive), (e) => e instanceof WorkbookError && /do not match/.test(e.message)));
  assert.ok(Date.now() - started < 10000, "rejected quickly, even on a busy machine");
  // One 16 KB input block of zeros can inflate to ~16 MB before the stream pauses; never the full 80 MB.
  assert.ok(inflated > 0, "the counter saw the inflater run, so the bound below is meaningful");
  assert.ok(inflated < 20 * 1024 * 1024, `inflated ${inflated} bytes`);
});

test("an extreme declared ratio, too many entries, or a corrupt stream is refused", async () => {
  const bomb = await deflatedZeros(8);
  const ratio = rawZip([
    stored("xl/workbook.xml", "<workbook/>"),
    { name: "xl/sharedStrings.xml", method: 8, data: bomb, declared: 8 * 1024 * 1024 },
  ]);
  const inflated = await countInflated(() =>
    assert.rejects(readTrackerWorkbook(ratio), (e) => e instanceof WorkbookError && /too large/.test(e.message)));
  assert.equal(inflated, 0, "refused on the declared ratio without inflating anything");

  const many = new JSZip();
  many.file("xl/workbook.xml", "<workbook/>");
  for (let i = 0; i < 2001; i++) many.file(`xl/x${i}.xml`, "");
  await assert.rejects(readTrackerWorkbook(await many.generateAsync({ type: "uint8array" })), WorkbookError);

  const corrupt = rawZip([
    stored("xl/workbook.xml", "<workbook/>"),
    { name: "xl/styles.xml", method: 8, data: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x01]), declared: 5000 },
  ]);
  await assert.rejects(readTrackerWorkbook(corrupt), WorkbookError);
});

test("CSV of the same layout parses with quoted commas and newlines", () => {
  const csv = [
    "S/N,,STATE,FEDERAL UNIVERSITY,VICE CHANCELLOR,BURSAR,WEB ADDRESS,FINANCIAL REPORT UPDATE STATUS,ANNUAL BUDGETARY ALLOCATION,,,RESEARCH GRANT REVENUE,,TETFUND ALLOCATION,ENDOWMENT FUND,TOTAL STUDENT POPULATION",
    ",,,,,,,,Personnel Costs,Overheard Costs,Capital Expenditure,Domestic Sources,International Sources,,,Undergraduates,Post Graduates",
    '1,,Abia,"Test University, Umuahia","Prof. A ""B"" C",Mr. D,https://example.org,YES,TRUE,TRUE,TRUE,FALSE,FALSE,TRUE,TRUE,TRUE,TRUE',
  ].join("\r\n");
  const r = parseTrackerCsv("﻿" + csv);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].mapped.name, "Test University, Umuahia");
  assert.equal(r.rows[0].mapped.head, 'Prof. A "B" C');
  assert.equal(r.rows[0].legacyIndicators.grants_domestic, false);
});

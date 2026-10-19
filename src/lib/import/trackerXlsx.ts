// Reads the tracker workbook (.xlsx) into the same row records the TSV parser uses, keeping each
// cell's hyperlink target so display text such as "Key Institutional Data | NOUN" can be resolved
// to the real address. Defensive against hostile files: every entry is inflated once as a stream,
// counting the bytes that really come out, before ExcelJS sees the file; rows and columns are
// capped while parsing.
import type { SourceRecord } from "./trackerTsv.ts";

export const XLSX_LIMITS = {
  /** Bytes actually inflated across all entries (the sizes an archive declares can be forged). */
  maxUncompressedBytes: 60 * 1024 * 1024,
  /** Bytes actually inflated for any one entry. */
  maxEntryBytes: 40 * 1024 * 1024,
  maxEntries: 2000,
  /**
   * Inflated-to-compressed ratio refused once an entry passes ratioFloorBytes. Spreadsheet XML is
   * usually 5–100 (a sheet of empty styled cells runs high); repeated bytes, as in a bomb, reach ~1000.
   */
  maxRatio: 500,
  ratioFloorBytes: 1024 * 1024,
  maxRows: 6000,
  maxCols: 30,
};

export class WorkbookError extends Error {}

const TOO_LARGE = "That workbook is too large to import.";
const TAMPERED = "That workbook is damaged or its contents do not match what it declares, so it was not imported.";

/** The parts of a loaded JSZip entry used here. internalStream and _data are not in JSZip's types. */
interface ZipEntry {
  dir: boolean;
  internalStream(type: "uint8array"): {
    on(event: "data", cb: (chunk: Uint8Array) => void): unknown;
    on(event: "end", cb: () => void): unknown;
    on(event: "error", cb: (err: Error) => void): unknown;
    resume(): unknown;
    pause(): unknown;
  };
  _data?: { compressedSize?: unknown; uncompressedSize?: unknown };
}

/** What the central directory claims. Unknown sizes fall back to limits that only the real count can satisfy. */
function declaredSizes(entry: ZipEntry, archiveBytes: number): { declared: number; compressed: number } {
  const d = entry._data;
  const declared = typeof d?.uncompressedSize === "number" && d.uncompressedSize >= 0 ? d.uncompressedSize : Infinity;
  const compressed = typeof d?.compressedSize === "number" && d.compressedSize >= 0 ? d.compressedSize : archiveBytes;
  return { declared, compressed };
}

function ratioTooHigh(bytes: number, compressed: number): boolean {
  return bytes > XLSX_LIMITS.ratioFloorBytes && bytes > Math.max(compressed, 1) * XLSX_LIMITS.maxRatio;
}

/**
 * Inflates one entry as a stream, counting and discarding each chunk, and stops at the first chunk
 * that breaks a limit, so an oversized entry is never held in memory. Resolves with the real size.
 */
function measureEntry(entry: ZipEntry, archiveBytes: number, budget: number): Promise<number> {
  const { declared, compressed } = declaredSizes(entry, archiveBytes);
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const stream = entry.internalStream("uint8array");
    const stop = (message: string) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(new WorkbookError(message));
    };
    stream.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > XLSX_LIMITS.maxEntryBytes || bytes > budget || ratioTooHigh(bytes, compressed)) stop(TOO_LARGE);
      else if (bytes > declared) stop(TAMPERED); // inflating past the declared size: the header lies
    });
    stream.on("error", () => stop(TAMPERED));
    stream.on("end", () => {
      if (settled) return;
      if (declared !== Infinity && bytes !== declared) return stop(TAMPERED);
      settled = true;
      resolve(bytes);
    });
    stream.resume();
  });
}

type CellLike = { text?: string; hyperlink?: string; value?: unknown };

/** Plain text of an ExcelJS cell value: rich text runs, hyperlink text, formula results, dates. */
function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { richText?: { text?: unknown }[]; text?: unknown; result?: unknown; error?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((r) => (typeof r?.text === "string" ? r.text : "")).join("");
    if ("text" in o) return valueText(o.text);
    if ("result" in o) return valueText(o.result);
    if ("error" in o) return valueText(o.error);
  }
  return "";
}

function cellText(cell: CellLike): string {
  try {
    const fromValue = valueText(cell.value);
    if (fromValue) return fromValue;
    const t = cell.text;
    return typeof t === "string" && t !== "[object Object]" ? t : "";
  } catch {
    return "";
  }
}

function cellLink(cell: CellLike): string | null {
  const v = cell.value as { hyperlink?: unknown } | null | undefined;
  const h = cell.hyperlink ?? (v && typeof v === "object" ? v.hyperlink : undefined);
  return typeof h === "string" && h.trim() ? h.trim() : null;
}

/**
 * Throws WorkbookError when the archive would unpack to something unreasonable. The declared sizes
 * are checked first because it is cheap, but they are attacker-controlled, so every entry is then
 * inflated for real (the same JSZip parse ExcelJS uses) and the limits are applied to the bytes
 * that actually come out. Only an archive that passes is handed to ExcelJS.
 */
export async function checkArchive(data: Uint8Array): Promise<void> {
  const { default: JSZip } = await import("jszip");
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new WorkbookError("That file is not a valid Excel workbook.");
  }
  const entries = Object.values(zip.files) as unknown as ZipEntry[];
  if (entries.length > XLSX_LIMITS.maxEntries) throw new WorkbookError(TOO_LARGE);
  if (!zip.file("xl/workbook.xml")) throw new WorkbookError("That file is not an Excel workbook.");
  const files = entries.filter((e) => !e.dir);

  let declaredTotal = 0;
  for (const entry of files) {
    const { declared, compressed } = declaredSizes(entry, data.length);
    if (declared === Infinity) continue;
    declaredTotal += declared;
    if (declared > XLSX_LIMITS.maxEntryBytes || declaredTotal > XLSX_LIMITS.maxUncompressedBytes || ratioTooHigh(declared, compressed)) {
      throw new WorkbookError(TOO_LARGE);
    }
  }

  let inflated = 0;
  for (const entry of files) {
    inflated += await measureEntry(entry, data.length, XLSX_LIMITS.maxUncompressedBytes - inflated);
  }
}

export async function readTrackerWorkbook(data: Uint8Array): Promise<{ sheetName: string; records: SourceRecord[] }> {
  await checkArchive(data);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new WorkbookError("The workbook could not be read.");
  }
  if (!wb.worksheets.length) throw new WorkbookError("The workbook has no sheets.");
  // Prefer the sheet that carries the report heading or a section header.
  const sheet = wb.worksheets.find((ws) => {
    for (let r = 1; r <= Math.min(ws.rowCount, 6); r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= Math.min(ws.columnCount || XLSX_LIMITS.maxCols, XLSX_LIMITS.maxCols); c++) {
        const t = cellText(row.getCell(c) as CellLike);
        if (/REPORT ON FINANCIAL TRANSPARENCY|^\s*S\/N\s*$/i.test(t)) return true;
      }
    }
    return false;
  }) ?? wb.worksheets[0];

  if (sheet.rowCount > XLSX_LIMITS.maxRows) throw new WorkbookError("That sheet has too many rows to import.");
  const cols = Math.min(Math.max(sheet.columnCount, 17), XLSX_LIMITS.maxCols);
  const records: SourceRecord[] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    const links: (string | null)[] = [];
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c) as CellLike;
      cells.push(cellText(cell));
      links.push(cellLink(cell));
    }
    // Trim trailing empty cells, as the TSV export does.
    while (cells.length > 17 && cells[cells.length - 1] === "") {
      cells.pop();
      links.pop();
    }
    records.push({ line: r, cells, links });
  }
  return { sheetName: sheet.name, records };
}

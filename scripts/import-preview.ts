// Validation preview for a tracker export: prints the summary and writes the rows that need a
// human decision to a CSV for the team. Reads the file only; it never touches a database.
// Usage: node scripts/import-preview.ts data/source/tracker-export-2026-10-10.tsv
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseTrackerTsv, summarise, isHeld } from "../src/lib/import/trackerTsv.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-preview.ts <export.tsv>");
  process.exit(1);
}

const result = parseTrackerTsv(readFileSync(file, "utf8"));
console.log(JSON.stringify(summarise(result), null, 2));

// Neutralise spreadsheet formulas in exported text (=, +, -, @, tab, CR).
const cell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v).replace(/\r?\n/g, " ");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

const header = ["section", "row", "source_line", "serial", "name", "state_cell", "website_cell", "legacy_status", "holding_issues", "other_issues"];
const lines = [header.join(",")];
for (const r of result.rows.filter(isHeld)) {
  lines.push([
    r.section, r.sectionIndex, r.sourceLine, r.serialRaw, r.mapped.name, r.mapped.stateRaw,
    r.mapped.websiteRaw, r.mapped.legacyStatusRaw,
    r.issues.filter((i) => i.holds).map((i) => i.detail).join(" | "),
    r.issues.filter((i) => !i.holds).map((i) => i.detail).join(" | "),
  ].map(cell).join(","));
}

mkdirSync("data/reports", { recursive: true });
const out = join("data/reports", basename(file).replace(/\.tsv$/i, "") + ".held-rows.csv");
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`\n${lines.length - 1} rows need a decision → ${out}`);

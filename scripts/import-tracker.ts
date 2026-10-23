// Load a tracker spreadsheet and show it as the public compliance report, without the CMS.
//   node scripts/import-tracker.ts <file.xlsx|.csv|.tsv> [--no-commit] [--no-publish]
//
// Federal and state sections. It stages the file (idempotent by content), commits the safe rows as private
// drafts, and shows it on the public Institutions page. Held rows wait for a decision in the CMS.
//
// It acts as a "Spreadsheet import" service member that has no password (it cannot sign in) and is
// deactivated again at the end, so the CMS one-time setup is not used up. Every step is audited.
//
// Target: the local database (stop the dev server first), or Neon with MIGRATION_DATABASE_URL set to
// the owner's direct connection string.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultLocalDbDir, localDatabaseInUse, migrate, openPglite, openPostgres, runAs, type Driver } from "../src/server/db/core.ts";
import { parseTrackerCsv, parseTrackerRecords, parseTrackerTsv, summarise } from "../src/lib/import/trackerTsv.ts";
import { readTrackerWorkbook } from "../src/lib/import/trackerXlsx.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const file = process.argv[2];
const noCommit = process.argv.includes("--no-commit");
const noPublish = process.argv.includes("--no-publish");
if (!file) {
  console.error("Usage: node scripts/import-tracker.ts <file.xlsx|.csv|.tsv> [--no-commit] [--no-publish]");
  process.exit(1);
}

const IMPORTER = "00000000-0000-4000-8000-00000000f001";

async function open(): Promise<Driver> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (url) return openPostgres(url);
  const dir = defaultLocalDbDir();
  if (localDatabaseInUse(dir)) {
    console.error("The local database is in use. Stop the dev server, then run this again.");
    process.exit(1);
  }
  const driver = await openPglite(dir);
  await migrate(driver, join(root, "db", "migrations"));
  return driver;
}

const bytes = readFileSync(file);
const name = basename(file).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
const ext = /\.(xlsx|csv|tsv|txt)$/i.exec(name)?.[1]?.toLowerCase();
if (!ext) {
  console.error("Use an .xlsx, .csv, .tsv or .txt file.");
  process.exit(1);
}
let parsed;
let text: string;
let parser: string;
if (ext === "xlsx") {
  parsed = parseTrackerRecords((await readTrackerWorkbook(new Uint8Array(bytes))).records);
  text = `xlsx-base64:${bytes.toString("base64")}`;
  parser = "trackerXlsx@2";
} else {
  text = bytes.toString("utf8");
  parsed = ext === "csv" ? parseTrackerCsv(text) : parseTrackerTsv(text);
  parser = ext === "csv" ? "trackerCsv@2" : "trackerTsv@2";
}
const fed = parsed;
console.log(`Read ${fed.rows.length} institution rows.`);

const driver = await open();
try {
  await driver.transaction(async (tx) => {
    await tx.query(`insert into app_users (id, email, display_name, password_hash, is_fixture)
                    values ($1, 'spreadsheet.import@example.invalid', 'Spreadsheet import', null, false)
                    on conflict (id) do nothing`, [IMPORTER]);
    await tx.query(`insert into team_memberships (user_id, role, display_name, active) values ($1, 'admin', 'Spreadsheet import', true)
                    on conflict (user_id) do update set role = 'admin', active = true`, [IMPORTER]);
  });
  const as = (sql: string, params: unknown[] = []) => runAs(driver, { kind: "user", userId: IMPORTER }, (tx) => tx.query(sql, params));
  const [{ id }] = await as("select stage_import($1, $2, $3, $4, $5, $6) as id", [
    name, text, fed.reportedAsOf, parser,
    JSON.stringify({ ...summarise(fed), ignored: fed.ignored }), JSON.stringify(fed.rows),
  ]) as { id: string }[];
  console.log(`Staged as import ${id}.`);
  if (!noCommit) {
    const [{ r }] = await as("select commit_import($1) as r", [id]) as { r: Record<string, number> }[];
    console.log(`Committed: ${r.created} private drafts created, ${r.held} held for a decision, ${r.needs_match} need matching, ${r.already_committed} already committed.`);
  }
  if (!noPublish) {
    await as("select publish_tracker_report($1)", [id]);
    console.log("Shown on the public site as the compliance report.");
  }
} finally {
  await driver.transaction((tx) => tx.query("update team_memberships set active = false where user_id = $1", [IMPORTER])).catch(() => undefined);
  await driver.close();
}

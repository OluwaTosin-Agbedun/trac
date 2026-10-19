// Database maintenance. Run with Node 22.18+ (TypeScript type stripping):
//   node scripts/db.ts migrate        apply db/migrations to Neon (MIGRATION_DATABASE_URL or DATABASE_URL_UNPOOLED)
//   node scripts/db.ts status         list applied migrations on Neon
//   node scripts/db.ts reset-local    set the local PGlite database aside (~/.nigerian-university-tracker/pglite → pglite-old-<time>)
//   node scripts/db.ts init-local     create and migrate an empty local database now
//
// Migrations must use Neon's direct (unpooled) connection as the owner role. The running app uses
// a separate, unprivileged login role on the pooled connection (see db/migrations/0000_platform.sql).
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultLocalDbDir, localDatabaseInUse, migrate, openPglite, openPostgres } from "../src/server/db/core.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrations = join(root, "db", "migrations");
const localDir = defaultLocalDbDir();

function migrationUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.error("Set MIGRATION_DATABASE_URL (or DATABASE_URL_UNPOOLED) to Neon's direct owner connection string.");
    process.exit(1);
  }
  if (/-pooler\./.test(url)) {
    console.error("Refusing to migrate over a pooled (-pooler) endpoint. Use the direct connection string.");
    process.exit(1);
  }
  return url;
}

const cmd = process.argv[2];

if (cmd === "migrate") {
  const driver = await openPostgres(migrationUrl());
  try {
    const r = await migrate(driver, migrations);
    console.log(`Applied: ${r.applied.join(", ") || "none"}`);
    console.log(`Already applied: ${r.alreadyApplied.length}`);
  } finally {
    await driver.close();
  }
} else if (cmd === "status") {
  const driver = await openPostgres(migrationUrl());
  try {
    const rows = await driver.transaction((tx) =>
      tx.query<{ name: string; applied_at: Date }>("select name, applied_at from schema_migrations order by name"));
    for (const r of rows) console.log(`${r.name}  ${new Date(r.applied_at).toISOString()}`);
  } finally {
    await driver.close();
  }
} else if (cmd === "reset-local") {
  if (process.env.DATABASE_URL) {
    console.error("DATABASE_URL is set; reset-local only touches the local database. Unset it first.");
    process.exit(1);
  }
  if (localDatabaseInUse(localDir)) {
    console.error("The local database is in use (is the dev server running?). Stop it, then run this again.");
    process.exit(1);
  }
  if (existsSync(localDir)) {
    // Set aside, not deleted: stop the dev server first, and remove the old copy by hand when sure.
    const aside = `${localDir}-old-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    renameSync(localDir, aside);
    console.log(`Moved the local database to ${aside}. A new, empty one is created on the next request.`);
  } else {
    console.log("There is no local database yet. One is created, empty, on the next request.");
  }
} else if (cmd === "init-local") {
  const driver = await openPglite(localDir);
  try {
    const r = await migrate(driver, migrations);
    console.log(`Local database ready at ${localDir} (applied ${r.applied.length} migrations). Open /admin to set up the first administrator.`);
  } finally {
    await driver.close();
  }
} else {
  console.log("Usage: node scripts/db.ts <migrate|status|reset-local|init-local>");
  process.exit(cmd ? 1 : 0);
}

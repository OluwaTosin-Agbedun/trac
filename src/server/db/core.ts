// Database drivers and migration runner. Framework-free (no "server-only", relative imports)
// so scripts and tests share it; Next code goes through ./index.ts instead.
//
//   local  PGlite (Postgres compiled to WASM) persisted under .data/, for local fixtures
//   neon   any Postgres reachable by DATABASE_URL; production target is Neon
//
// Every request runs inside one transaction that first switches to a request role
// (anon | authenticated) and sets the verified user id, so grants and RLS apply.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

export interface Driver {
  mode: "local" | "neon";
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type Actor = { kind: "anon" } | { kind: "user"; userId: string } | { kind: "system" } | { kind: "worker" };

const ROLE: Record<Actor["kind"], string> = { anon: "nut_anon", user: "nut_member", system: "nut_system", worker: "nut_worker" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run fn in one transaction as a request role (see db/migrations/0000_platform.sql).
 * Role names are fixed literals; the user id is validated and passed as a bound parameter.
 * SET LOCAL and set_config(..., true) last only for this transaction, so they are safe on a
 * transaction-mode connection pooler.
 */
export async function runAs<T>(driver: Driver, actor: Actor, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (actor.kind === "user" && !UUID_RE.test(actor.userId)) throw new Error("invalid user id");
  const role = ROLE[actor.kind];
  return driver.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('nut.user_id', $1, true)", [actor.kind === "user" ? actor.userId : ""]);
    return fn(tx);
  });
}

// The process holding the local database refreshes its lock file every LOCK_REFRESH_MS. A lock not
// refreshed for LOCK_STALE_MS is abandoned (the holder crashed or was killed), even if the operating
// system has since given its process id to an unrelated program, as Windows often does.
const LOCK_REFRESH_MS = 10_000;
const LOCK_STALE_MS = 30_000;

/** True when another live process holds the local database lock. */
function lockHeldElsewhere(lockFile: string): boolean {
  if (!existsSync(lockFile)) return false;
  const pid = Number.parseInt(readFileSync(lockFile, "utf8").trim(), 10);
  if (!Number.isInteger(pid) || pid === process.pid) return false;
  if (Date.now() - statSync(lockFile).mtimeMs > LOCK_STALE_MS) return false;
  try {
    process.kill(pid, 0); // throws if the process no longer exists
    return true;
  } catch {
    return false;
  }
}

export class LocalDatabaseBusyError extends Error {}

/**
 * Where the local database lives: LOCAL_DB_DIR, or a folder in the user's home directory. Not inside
 * the project, because cloud-synced folders (OneDrive, Dropbox) lock and rewrite files while the
 * database writes them, which corrupts it.
 */
export function defaultLocalDbDir(): string {
  return process.env.LOCAL_DB_DIR ?? join(homedir(), ".nigerian-university-tracker", "pglite");
}

/** True while another live process (usually the dev server) has the local database open. */
export function localDatabaseInUse(dataDir: string): boolean {
  return lockHeldElsewhere(`${dataDir}.lock`);
}

// One PGlite instance per directory per process, kept on `process` so that every copy of this
// module (the dev server can load it more than once) shares it. Two instances writing one directory
// corrupt it, and the lock file cannot tell them apart because they share a process id.
type PgliteRegistry = Map<string, Promise<Driver>>;
const proc = process as typeof process & { __nutPglite?: PgliteRegistry };
const registry: PgliteRegistry = (proc.__nutPglite ??= new Map());

export async function openPglite(dataDir: string | null): Promise<Driver> {
  if (!dataDir) return openPgliteInstance(null);
  const key = resolve(dataDir).toLowerCase();
  const existing = registry.get(key);
  if (existing) return existing;
  const opening = openPgliteInstance(dataDir).then(
    (driver) => ({ ...driver, close: async () => { registry.delete(key); await driver.close(); } }),
    (err) => { registry.delete(key); throw err; },
  );
  registry.set(key, opening);
  return opening;
}

/** Local development only: report a transaction still running after 10 s, with its last statement. */
const SLOW_MS = 10_000;

async function openPgliteInstance(dataDir: string | null): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lockFile = dataDir ? `${dataDir}.lock` : null;
  if (dataDir && lockFile) {
    mkdirSync(dataDir, { recursive: true }); // PGlite only creates the last path segment
    // Two processes writing one PGlite directory corrupt it; refuse instead.
    if (lockHeldElsewhere(lockFile)) {
      throw new LocalDatabaseBusyError(`Another process is using the local database (${lockFile}). Stop it, then retry.`);
    }
    writeFileSync(lockFile, String(process.pid));
    // Keep the lock fresh while this process lives; a crashed holder's lock goes stale by itself.
    const refresh = setInterval(() => {
      try {
        if (readFileSync(lockFile, "utf8").trim() === String(process.pid)) utimesSync(lockFile, new Date(), new Date());
      } catch {
        /* best effort */
      }
    }, LOCK_REFRESH_MS);
    refresh.unref?.();
  }
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  try {
    await pg.waitReady;
  } catch (err) {
    // A failed start must not leave a half-started engine running beside the replacement.
    await pg.close().catch(() => undefined);
    throw err;
  }
  if (dataDir) console.info(`[local db] opened ${dataDir} (process ${process.pid}, open instances: ${registry.size})`);
  if (lockFile) {
    // Close cleanly on shutdown so the files are never left half-written.
    const release = () => {
      try {
        if (existsSync(lockFile) && readFileSync(lockFile, "utf8").trim() === String(process.pid)) unlinkSync(lockFile);
      } catch {
        /* best effort */
      }
    };
    const shutdown = (signal: NodeJS.Signals) => {
      void pg.close().catch(() => undefined).finally(() => {
        release();
        process.kill(process.pid, signal);
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("exit", release);
  }
  return {
    mode: "local",
    async transaction(fn) {
      let last = "(waiting for the database)";
      const started = Date.now();
      const watch = setInterval(() => {
        console.warn(`[local db] transaction still running after ${Math.round((Date.now() - started) / 1000)} s; last statement: ${last.replace(/\s+/g, " ").slice(0, 300)}`);
      }, SLOW_MS);
      watch.unref?.();
      try {
        return await pg.transaction(async (tx) =>
          fn({
            async query(sql, params) {
              last = sql;
              return (await tx.query(sql, params ?? [])).rows as never;
            },
            async exec(sql) {
              last = sql;
              await tx.exec(sql);
            },
          }),
        );
      } finally {
        clearInterval(watch);
        const ms = Date.now() - started;
        if (ms > 2000) console.warn(`[local db] slow transaction: ${ms} ms; last statement: ${last.replace(/\s+/g, " ").slice(0, 300)}`);
      }
    },
    async close() {
      await pg.close();
    },
  };
}

export async function openPostgres(connectionString: string): Promise<Driver> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return {
    mode: "neon",
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({
          async query(sql, params) {
            return (await client.query(sql, params ?? [])).rows as never;
          },
          async exec(sql) {
            await client.query(sql);
          },
        });
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/** Apply db/migrations/*.sql in name order, once each. Refuses if an applied file changed. */
export async function migrate(driver: Driver, dir: string): Promise<MigrationResult> {
  const files = readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  await driver.transaction(async (tx) => {
    await tx.exec(`create table if not exists schema_migrations (
      name text primary key, sha256 text not null, applied_at timestamptz not null default now())`);
  });
  const done = new Map(
    (await driver.transaction((tx) => tx.query<{ name: string; sha256: string }>("select name, sha256 from schema_migrations")))
      .map((r) => [r.name, r.sha256]),
  );
  const result: MigrationResult = { applied: [], alreadyApplied: [] };
  for (const name of files) {
    const sql = readFileSync(join(dir, name), "utf8");
    const hash = createHash("sha256").update(sql, "utf8").digest("hex");
    const prior = done.get(name);
    if (prior) {
      if (prior !== hash) {
        throw new Error(`Migration ${name} changed after it was applied. Add a new migration instead.`);
      }
      result.alreadyApplied.push(name);
      continue;
    }
    await driver.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into schema_migrations (name, sha256) values ($1, $2)", [name, hash]);
    });
    result.applied.push(name);
  }
  return result;
}

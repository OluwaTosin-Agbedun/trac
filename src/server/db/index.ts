import "server-only";
// The only way Next code reaches the database. Reads and writes run as a request role
// (anon or authenticated) so Postgres grants and RLS decide what each request can see.
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { defaultLocalDbDir, LocalDatabaseBusyError, migrate, openPglite, openPostgres, runAs, type Actor, type Driver, type Queryable } from "./core.ts";

export type { Actor, Queryable } from "./core.ts";

export type DataMode = "neon" | "local" | "unconfigured";

/**
 * neon            DATABASE_URL is set (production target: Neon Postgres).
 * local           No DATABASE_URL, and either not production or LOCAL_DATABASE=1 was set
 *                 explicitly. Uses PGlite under .data/. It starts empty: the first visit to /admin
 *                 opens the one-time setup, then the team uploads the tracker in the Import centre.
 * unconfigured    Production without DATABASE_URL: fail closed.
 */
export function dataMode(): DataMode {
  if (process.env.DATABASE_URL) return "neon";
  if (process.env.NODE_ENV !== "production" || process.env.LOCAL_DATABASE === "1") return "local";
  return "unconfigured";
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const g = globalThis as typeof globalThis & { __nutDriver?: Promise<Driver> };

async function init(): Promise<Driver> {
  const mode = dataMode();
  if (mode === "unconfigured") {
    throw new ConfigurationError("Configuration required: set DATABASE_URL to the Neon connection string.");
  }
  if (mode === "neon") {
    // Migrations are applied by `npm run db:migrate`, never at request time in production.
    return openPostgres(process.env.DATABASE_URL as string);
  }
  const root = process.cwd();
  const dir = defaultLocalDbDir();
  let driver: Driver;
  try {
    driver = await openPglite(dir);
  } catch (err) {
    // Local-only paths: the ignore comments stop the build from tracing the whole project.
    if (err instanceof LocalDatabaseBusyError || !existsSync(/*turbopackIgnore: true*/ dir)) throw err;
    // Local database only: a damaged directory (e.g. the dev server was killed mid-write) is moved
    // aside, never deleted, and a fresh database is built in its place.
    const aside = `${dir}-damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    renameSync(/*turbopackIgnore: true*/ dir, aside);
    console.warn(`[local db] The local database could not be opened and was moved to ${aside}. Starting a fresh one.`);
    driver = await openPglite(dir);
  }
  await migrate(driver, join(root, "db", "migrations"));
  return driver;
}

function driver(): Promise<Driver> {
  if (!g.__nutDriver) {
    g.__nutDriver = init().catch((err) => {
      g.__nutDriver = undefined;
      throw err;
    });
  }
  return g.__nutDriver;
}

/** Public reads: the anon role can see published, non-withdrawn snapshots and nothing else. */
export async function asPublic<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return runAs(await driver(), { kind: "anon" }, fn);
}

/** Team reads and writes, as a verified signed-in user. Callers get the user id from the DAL. */
export async function asUser<T>(userId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return runAs(await driver(), { kind: "user", userId } satisfies Actor, fn);
}

/**
 * The account service role (sign-in, sessions, setup, invites). It can read and write the account
 * tables and nothing about institutions, so it cannot be used to bypass the editorial workflow.
 */
export async function asSystem<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return runAs(await driver(), { kind: "system" }, fn);
}

/**
 * The research worker role, for running queued scans inside this server process. Only with the
 * local database: against Neon the worker is a separate service with its own login role, and the
 * web app's role is never granted nut_worker.
 */
export async function asWorker<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (dataMode() !== "local") {
    throw new ConfigurationError("Scans run in the separate research worker service when the Neon database is connected.");
  }
  return runAs(await driver(), { kind: "worker" }, fn);
}

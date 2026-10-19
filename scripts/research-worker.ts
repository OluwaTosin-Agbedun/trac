// The research worker service. Run it separately from the website (Node 22.18+):
//   node scripts/research-worker.ts           keep running: take queued scans one at a time
//   node scripts/research-worker.ts --once    run at most one scan, then exit
//
// Environment:
//   WORKER_DATABASE_URL   Neon connection string for the worker's own login role (nut_worker_app,
//                         see db/migrations/0006_research.sql). Never reuse the website's role.
//   ANTHROPIC_API_KEY     The model key. Without it every scan ends as "Configuration required".
//
// With no WORKER_DATABASE_URL (local development) it opens the local database, which only works
// while the dev server is stopped; with the dev server running, use "Run queued scans now" in the CMS.
import { hostname } from "node:os";
import { defaultLocalDbDir, openPglite, openPostgres, runAs, type Driver } from "../src/server/db/core.ts";
import { runNextJob } from "../src/server/research/worker.ts";

const once = process.argv.includes("--once");
const IDLE_MS = 15_000;

async function open(): Promise<Driver> {
  const url = process.env.WORKER_DATABASE_URL;
  if (url) return openPostgres(url);
  if (process.env.NODE_ENV === "production") {
    console.error("Set WORKER_DATABASE_URL to the worker role's connection string.");
    process.exit(1);
  }
  return openPglite(defaultLocalDbDir());
}

const driver = await open();
const workerId = `${hostname().replace(/[^A-Za-z0-9.-]/g, "-").slice(0, 40)}:${process.pid}`;
let stopping = false;
const stop = () => {
  stopping = true;
  console.log("[worker] stopping after the current scan…");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`[worker] ${workerId} started${process.env.ANTHROPIC_API_KEY ? "" : " (no ANTHROPIC_API_KEY: scans will report Configuration required)"}`);
try {
  while (!stopping) {
    const done = await runNextJob({
      run: (fn) => runAs(driver, { kind: "worker" }, fn),
      workerId,
      log: (m) => console.log(m),
    });
    if (once) break;
    if (!done) await new Promise((r) => setTimeout(r, IDLE_MS));
  }
} finally {
  await driver.close();
}

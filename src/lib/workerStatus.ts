// What the CMS says about the research worker, from what the worker itself last reported
// (research_worker_status(): when it was last seen, whether its host has a model key, its version).
// The web server never calls the model, so its own environment says nothing about scans.

export interface WorkerStatus {
  lastSeenAt: string;
  configured: boolean;
  version: string | null;
}

/** A worker polls every 15 s and renews its lease at least every minute during a scan. */
export const WORKER_STALE_MINUTES = 5;

export type WorkerState = "running" | "missing" | "unconfigured" | "local";

export interface WorkerLine {
  state: WorkerState;
  tone: "ok" | "warn";
  text: string;
}

function ago(minutes: number): string {
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * The one status line for the Research centre and the register's suggestions panel.
 * local: the local database, where scans run inside this server when someone presses
 * "Run queued scans now"; localConfigured is then this server's own key (it is the worker host).
 */
export function describeWorker(status: WorkerStatus | null, opts: { now?: number; local?: boolean; localConfigured?: boolean } = {}): WorkerLine {
  const now = opts.now ?? Date.now();
  const seen = status ? Date.parse(status.lastSeenAt) : Number.NaN;
  const minutes = Number.isFinite(seen) ? Math.max(0, Math.floor((now - seen) / 60_000)) : null;
  const fresh = minutes !== null && minutes < WORKER_STALE_MINUTES;
  const configured = fresh && status ? status.configured : opts.local ? Boolean(opts.localConfigured) : (status?.configured ?? false);
  if (!fresh && opts.local) {
    return configured
      ? { state: "local", tone: "ok", text: "Scans run on this computer when you press “Run queued scans now”." }
      : { state: "unconfigured", tone: "warn", text: "The worker has no Anthropic API key – scans will end as Configuration required." };
  }
  if (!fresh) {
    return {
      state: "missing", tone: "warn",
      text: minutes === null
        ? "No research worker has been seen yet – scans stay queued until it runs."
        : `No research worker has been seen for ${ago(minutes)} – scans stay queued until it runs.`,
    };
  }
  if (!configured) {
    return { state: "unconfigured", tone: "warn", text: "The worker has no Anthropic API key – scans will end as Configuration required." };
  }
  return { state: "running", tone: "ok", text: "The research worker is running." };
}

/** What to tell someone who has just queued a scan. */
export function queuedMessage(line: WorkerLine): string {
  switch (line.state) {
    case "running":
      return "Scan queued. The research worker is running, so it starts soon (scans run one at a time).";
    case "local":
      return "Scan queued. Press “Run queued scans now” on this page or in the Research centre to start it.";
    case "unconfigured":
      return "Scan queued, but the worker has no Anthropic API key – it will end as Configuration required.";
    default:
      return `Scan queued. ${line.text}`;
  }
}

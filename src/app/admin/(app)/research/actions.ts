"use server";
// Research assistant actions. Each one is a public POST endpoint: it re-checks the session and role,
// validates every input (bound ids included) and lets the database functions re-check the team role,
// the draft's lock and whether a proposal is still current. Nothing here can publish.
import { after } from "next/server";
import { refresh } from "next/cache";
import { asUser, asWorker, dataMode } from "@/server/db";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { dbErrorMessage, fail, field, ok } from "@/server/actions/result";
import { runNextJob } from "@/server/research/worker";
import { indicatorByKey, PERIOD_TYPES, VALUE_SCALES } from "@/lib/indicators";
import type { FormState } from "@/components/ui/Form";

const TEAM = ["editor", "reviewer", "admin"] as const;
const SIGNED_OUT = "Your session has ended or you do not have access. Sign in again, then retry.";
const NOT_FOUND = "That item could not be found. Reload the page.";

export async function addHostAction(institutionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(institutionId)) return fail(NOT_FOUND);
  const host = field(fd, "host", 300);
  const note = field(fd, "note", 500);
  if (!host) return fail("Enter the official website address, for example unilag.edu.ng.", { host: ["Required."] }, { host, note });
  try {
    await asUser(viewer.userId, (tx) => tx.query("select add_source_host($1, $2, $3)", [institutionId, host, note || null]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, { host, note });
  }
  refresh();
  return ok(viewer.role === "admin"
    ? "Website approved. The assistant may now read it."
    : "Website suggested. An administrator must approve it before the assistant reads it.");
}

export async function decideHostAction(hostId: string, approved: boolean): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail("Only administrators can approve websites.");
  if (!isUuid(hostId) || typeof approved !== "boolean") return fail(NOT_FOUND);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select decide_source_host($1, $2)", [hostId, approved]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok(approved ? "Website approved." : "Website not approved. The assistant will not read it.");
}

export async function requestScanAction(institutionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(institutionId)) return fail(NOT_FOUND);
  const raw = field(fd, "start_urls", 6000);
  const urls = raw.split(/\s+/).map((u) => u.trim()).filter(Boolean);
  if (urls.length > 10) return fail("Add at most 10 starting pages.", { start_urls: ["Too many."] }, { start_urls: raw });
  if (urls.some((u) => !/^https?:\/\/\S+$/i.test(u) || u.length > 500)) {
    return fail("Each starting page must be a full web address beginning with https://.", { start_urls: ["Check the addresses."] }, { start_urls: raw });
  }
  try {
    await asUser(viewer.userId, (tx) => tx.query("select request_scan($1, $2::text[])", [institutionId, urls]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, { start_urls: raw });
  }
  refresh();
  return ok(dataMode() === "local"
    ? "Scan queued. Press “Run queued scans now” on this page or in the Research centre to start it."
    : "Scan queued. The research worker picks it up shortly.");
}

export async function cancelScanAction(jobId: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select cancel_scan($1)", [jobId]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok("Cancellation requested. A running scan stops at its next checkpoint; nothing it found so far is lost.");
}

const g = globalThis as typeof globalThis & { __nutLocalWorker?: boolean };

/**
 * Local database only: run queued scans inside this server process, after the response is sent.
 * In production the separate worker service does this (scripts/research-worker.ts).
 */
export async function runQueuedScansAction(): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (dataMode() !== "local") return fail("Scans are run by the research worker service on this deployment.");
  if (g.__nutLocalWorker) return ok("Scans are already running. Reload in a minute to see progress.");
  g.__nutLocalWorker = true;
  after(async () => {
    try {
      for (let i = 0; i < 5; i++) {
        const done = await runNextJob({ run: asWorker, workerId: `local-${process.pid}`, log: (m) => console.log(m) });
        if (!done) break;
      }
    } catch (err) {
      console.error("[research] local worker stopped", err);
    } finally {
      g.__nutLocalWorker = false;
    }
  });
  return ok("Started. Scans visit each website politely (a few seconds between pages), so reload in a minute or two to see results.");
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

type DraftTarget = { revisionId: string; lock: number } | { error: string };

/** The open draft to accept into, starting one from the latest revision if none is open. */
async function draftFor(userId: string, institutionId: string): Promise<DraftTarget> {
  return asUser(userId, async (tx) => {
    const [latest] = await tx.query<{ id: string; status: string; lock_version: number }>(
      "select id, status::text as status, lock_version from revisions where institution_id = $1 order by revision_number desc limit 1",
      [institutionId]);
    if (latest?.status === "draft") return { revisionId: latest.id, lock: latest.lock_version };
    if (latest?.status === "submitted" || latest?.status === "approved") {
      return { error: "This institution's latest revision is with a reviewer. Accept proposals after it is returned or published." };
    }
    const [created] = await tx.query<{ id: string }>("select create_revision($1) as id", [institutionId]);
    const [row] = await tx.query<{ lock_version: number }>("select lock_version from revisions where id = $1", [created.id]);
    return { revisionId: created.id, lock: row.lock_version };
  });
}

const AMOUNT_RE = /^\d{1,18}(\.\d{1,6})?$/;

/** The editor's corrected values, validated; null when the form carries no edits. */
function parseEdit(fd: FormData, kind: "money" | "count" | "profile"): { edit: Record<string, unknown> | null; error?: string } {
  if (field(fd, "edited", 5) !== "1") return { edit: null };
  if (kind === "profile") {
    const value = field(fd, "profile_value", 201);
    if (!value || value.length > 200) return { edit: null, error: "Enter the corrected name or title (up to 200 characters)." };
    return { edit: { value } };
  }
  const state = field(fd, "state", 20);
  const periodType = field(fd, "period_type", 30);
  const periodLabel = field(fd, "period_label", 41);
  const literal = field(fd, "value_literal", 201);
  if (state !== "published" && state !== "uncertain") return { edit: null, error: "Choose published or uncertain." };
  if (periodType && !(PERIOD_TYPES as readonly string[]).includes(periodType)) return { edit: null, error: "Choose a valid period type." };
  if (periodLabel.length > 40 || literal.length > 200) return { edit: null, error: "Shorten the period or the printed figure." };
  const edit: Record<string, unknown> = {
    state, period_type: periodType || null, period_label: periodLabel || null, value_literal: literal || null,
    value_amount: null, value_scale: null, value_currency: null, value_count: null,
  };
  if (kind === "money") {
    const amount = field(fd, "value_amount", 40).replace(/[,\s]/g, "");
    const scale = field(fd, "value_scale", 20);
    const currency = field(fd, "value_currency", 3).toUpperCase();
    if (amount) {
      if (!AMOUNT_RE.test(amount)) return { edit: null, error: "Enter the amount as plain digits, for example 4250.5." };
      if (!(VALUE_SCALES as readonly string[]).includes(scale)) return { edit: null, error: "Choose the scale the source uses." };
      if (!/^[A-Z]{3}$/.test(currency)) return { edit: null, error: "Enter a three-letter currency code such as NGN." };
      if (!literal) return { edit: null, error: "Keep the figure exactly as printed as well." };
      Object.assign(edit, { value_amount: amount, value_scale: scale, value_currency: currency });
    }
  } else {
    const count = field(fd, "value_count", 12).replace(/[,\s]/g, "");
    if (count) {
      if (!/^\d{1,9}$/.test(count)) return { edit: null, error: "Enter the count as a whole number." };
      if (!literal) return { edit: null, error: "Keep the figure exactly as printed as well." };
      edit.value_count = Number(count);
    }
  }
  return { edit };
}

export async function acceptProposalAction(proposalId: string, institutionId: string, fieldKey: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(proposalId) || !isUuid(institutionId)) return fail(NOT_FOUND);
  const def = indicatorByKey(fieldKey);
  const kind = def ? def.kind : ["head_name", "head_title", "bursar_name"].includes(fieldKey) ? "profile" : null;
  if (!kind) return fail(NOT_FOUND);
  const { edit, error } = parseEdit(fd, kind);
  if (error) return fail(error);
  const note = field(fd, "note", 1001);
  if (edit && !note) return fail("Give a short reason for changing the proposed value.");
  if (note.length > 1000) return fail("Keep the reason under 1,000 characters.");
  try {
    const target = await draftFor(viewer.userId, institutionId);
    if ("error" in target) return fail(target.error);
    const [row] = await asUser(viewer.userId, (tx) => tx.query<{ r: { stale?: boolean; lock_version?: number } }>(
      "select accept_proposal($1, $2, $3, $4::jsonb, $5) as r",
      [proposalId, target.revisionId, target.lock, edit ? JSON.stringify(edit) : null, note || null]));
    refresh();
    if (row.r.stale) return fail("Not applied: this field was changed in the draft after the scan started, so the proposal is out of date. It has been marked stale.");
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  return ok(edit ? "Your corrected value was added to the draft with the source as evidence." : "Added to the draft with the source as evidence. Review it in the indicators below, then submit.");
}

export async function rejectProposalAction(proposalId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(proposalId)) return fail(NOT_FOUND);
  const note = field(fd, "note", 1001);
  if (!note) return fail("Give a short reason, for example “figure is a grant award, not revenue”.");
  if (note.length > 1000) return fail("Keep the reason under 1,000 characters.");
  try {
    await asUser(viewer.userId, (tx) => tx.query("select reject_proposal($1, $2)", [proposalId, note]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok("Rejected with your reason.");
}

/** Accept every pending proposal for an institution into its draft, one at a time. Never publishes. */
export async function acceptAllAction(institutionId: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(institutionId)) return fail(NOT_FOUND);
  let accepted = 0;
  let stale = 0;
  try {
    const ids = await asUser(viewer.userId, (tx) => tx.query<{ id: string }>(
      "select id from agent_proposals where institution_id = $1 and status = 'pending' order by created_at, field_key limit 100", [institutionId]));
    for (const { id } of ids) {
      const target = await draftFor(viewer.userId, institutionId);
      if ("error" in target) return fail(target.error);
      const [row] = await asUser(viewer.userId, (tx) => tx.query<{ r: { stale?: boolean } }>(
        "select accept_proposal($1, $2, $3) as r", [id, target.revisionId, target.lock]));
      if (row.r.stale) stale++;
      else accepted++;
    }
  } catch (err) {
    refresh();
    return fail(`${accepted} accepted before an error: ${dbErrorMessage(err)}`);
  }
  refresh();
  return ok(`${accepted} added to the draft${stale ? `, ${stale} skipped as out of date` : ""}. Check them in the indicators below before submitting.`);
}

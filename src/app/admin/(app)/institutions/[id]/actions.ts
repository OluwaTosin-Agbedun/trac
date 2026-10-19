"use server";
// Institution editor actions. Each one is a public POST endpoint, so each re-checks the session and
// role, validates every input (bound ids included: the browser sends them) and lets the database
// functions re-check team role, revision state and the optimistic lock. Results are small FormState
// objects; database rows and internal errors never reach the browser.
import { refresh } from "next/cache";
import { asUser } from "@/server/db";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { dbErrorMessage, fail, field, ok } from "@/server/actions/result";
import { getRevisionState } from "@/server/data/cms/editor";
import { INDICATORS, indicatorByKey, isIndicatorKey } from "@/lib/indicators";
import {
  PROFILE_FIELDS, isCalendarDate, lagosDate, parseEvidence, parseIndicator, parseLockVersion, parseProfile, type RawValues,
} from "@/lib/editorRules";
import type { FormState } from "@/components/ui/Form";

const TEAM = ["editor", "reviewer", "admin"] as const;

const SIGNED_OUT = "Your session has ended or you do not have access. Sign in again, then retry.";
const STALE_FORM = "This form is out of date. Reload the page and try again.";
const CONFLICT = "Someone else saved this draft since you opened it. Reload to see their changes, then reapply yours.";

const INDICATOR_FIELDS = [
  "state", "period_type", "period_label", "period_start", "period_end", "value_amount", "value_scale",
  "value_currency", "value_count", "value_literal", "reason", "internal_note",
] as const;

const EVIDENCE_FIELDS = [
  "indicator_key", "url", "title", "excerpt", "locator", "document_period", "source_published_on", "captured_on",
] as const;

/** Raw text values (generously capped; exact limits are checked by the parsers). */
function collect(fd: FormData, names: readonly string[], cap = 5000): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) out[n] = field(fd, n, cap);
  return out;
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** Map a database failure to a form result, keeping what the user typed. */
function failure(err: unknown, values?: Record<string, string>): FormState {
  if (errorCode(err) === "40001") return fail(CONFLICT, undefined, values);
  return fail(dbErrorMessage(err), undefined, values);
}

// ---------------------------------------------------------------------------

// Bound to the institution; the form has no fields, so the previous state and form data are not read.
export async function startDraftAction(institutionId: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(institutionId)) return fail("That institution could not be found.");
  try {
    await asUser(viewer.userId, (tx) => tx.query("select create_revision($1) as id", [institutionId]));
  } catch (err) {
    return failure(err);
  }
  refresh();
  return ok("A new draft was started from the latest revision. Edit it below, then submit it for review.");
}

export async function saveProfileAction(revisionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  const values = collect(fd, PROFILE_FIELDS);
  if (!isUuid(revisionId)) return fail(STALE_FORM, undefined, values);
  const lock = parseLockVersion(field(fd, "lock_version", 12));
  if (lock === null) return fail(STALE_FORM, undefined, values);

  let current: { state: string | null } | null;
  try {
    current = await getRevisionState(viewer, revisionId);
  } catch (err) {
    return failure(err, values);
  }
  if (!current) return fail("That revision could not be found. Reload the page.", undefined, values);

  const parsed = parseProfile(values as RawValues, { currentState: current.state });
  // Human verification date: optional calendar date, not in the future (Lagos time).
  const verifiedOn = field(fd, "last_verified_on", 10);
  values.last_verified_on = verifiedOn;
  const verifiedError = verifiedOn && (!isCalendarDate(verifiedOn) || verifiedOn > lagosDate())
    ? "Enter a real date that is not in the future." : null;
  if (!parsed.ok || verifiedError) {
    const errors = { ...(parsed.ok ? {} : parsed.errors), ...(verifiedError ? { last_verified_on: [verifiedError] } : {}) };
    return fail("Check the highlighted fields. Nothing was saved.", errors, values);
  }
  // Stored as midday in Lagos (11:00 UTC) so the calendar date reads the same everywhere.
  const payload = { ...parsed.data, last_verified_at: verifiedOn ? `${verifiedOn}T11:00:00Z` : null };
  try {
    await asUser(viewer.userId, (tx) =>
      tx.query("select save_profile($1, $2, $3::jsonb) as lock", [revisionId, lock, JSON.stringify(payload)]));
  } catch (err) {
    return failure(err, values);
  }
  refresh();
  return ok("Profile saved to the draft. The public page is unchanged until this revision is approved and published.");
}

export async function saveIndicatorAction(revisionId: string, indicatorKey: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  const values = collect(fd, INDICATOR_FIELDS);
  if (!isUuid(revisionId) || !isIndicatorKey(indicatorKey)) return fail(STALE_FORM, undefined, values);
  const def = indicatorByKey(indicatorKey);
  if (!def) return fail(STALE_FORM, undefined, values);
  const lock = parseLockVersion(field(fd, "lock_version", 12));
  if (lock === null) return fail(STALE_FORM, undefined, values);

  const parsed = parseIndicator(def.kind, values as RawValues);
  if (!parsed.ok) return fail("Check the highlighted fields. Nothing was saved.", parsed.errors, values);
  try {
    await asUser(viewer.userId, (tx) =>
      tx.query("select save_indicator($1, $2, $3, $4::jsonb) as lock",
        [revisionId, lock, indicatorKey, JSON.stringify(parsed.data)]));
  } catch (err) {
    return failure(err, values);
  }
  refresh();
  return ok(`${def.label} saved to the draft.`);
}

export async function addEvidenceAction(revisionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  const values = collect(fd, EVIDENCE_FIELDS);
  values.is_public = fd.get("is_public") === "on" ? "on" : "";
  if (!isUuid(revisionId)) return fail(STALE_FORM, undefined, values);
  const lock = parseLockVersion(field(fd, "lock_version", 12));
  if (lock === null) return fail(STALE_FORM, undefined, values);

  const parsed = parseEvidence(values as RawValues, lagosDate());
  if (!parsed.ok) return fail("Check the highlighted fields. The evidence was not added.", parsed.errors, values);
  try {
    await asUser(viewer.userId, (tx) =>
      tx.query("select add_evidence($1, $2, $3::jsonb) as id", [revisionId, lock, JSON.stringify(parsed.data)]));
  } catch (err) {
    return failure(err, values);
  }
  refresh();
  return ok(parsed.data.is_public
    ? "Evidence added. It will be public once this revision is published."
    : "Private evidence added. It will never be shown publicly.");
}

export async function removeEvidenceAction(revisionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  const evidenceId = field(fd, "evidence_id", 64);
  const lock = parseLockVersion(field(fd, "lock_version", 12));
  if (!isUuid(revisionId) || !isUuid(evidenceId) || lock === null) return fail(STALE_FORM);
  try {
    await asUser(viewer.userId, (tx) =>
      tx.query("select remove_evidence($1, $2, $3) as lock", [revisionId, lock, evidenceId]));
  } catch (err) {
    return failure(err);
  }
  refresh();
  return ok("Evidence removed from the draft.");
}

export async function submitRevisionAction(revisionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  const lock = parseLockVersion(field(fd, "lock_version", 12));
  if (!isUuid(revisionId) || lock === null) return fail(STALE_FORM);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select submit_revision($1, $2) as hash", [revisionId, lock]));
  } catch (err) {
    const result = failure(err);
    // The server names indicators by their keys; show their labels instead.
    if (result?.message && errorCode(err) === "23514") {
      let message = result.message;
      for (const i of INDICATORS) message = message.split(i.key).join(`${i.group}: ${i.label}`);
      return fail(message);
    }
    return result;
  }
  refresh();
  return ok("Submitted for review. This revision is now frozen; a reviewer will approve it or return it with notes.");
}

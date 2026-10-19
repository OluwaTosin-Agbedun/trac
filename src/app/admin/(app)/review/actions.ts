"use server";
// Review, publish and withdraw. Each action re-checks the session and role, validates every input
// (bound ids included) and leaves the final word to the database functions, which check the role,
// the exact approved content hash and the published base again.
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { asUser } from "@/server/db";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { dbErrorMessage, fail, field, ok } from "@/server/actions/result";
import { slugForRevision } from "@/server/data/cms/review";
import type { FormState } from "@/components/ui/Form";

const REVIEWERS = ["reviewer", "admin"] as const;
const DECISIONS = ["approved", "changes_requested", "rejected"] as const;
type Decision = (typeof DECISIONS)[number];
const SIGNED_OUT = "Your session has ended or your role cannot review. Sign in again, then retry.";

export async function reviewDecisionAction(revisionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(REVIEWERS);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(revisionId)) return fail("That revision could not be found.");
  const decision = field(fd, "decision", 30);
  const notes = field(fd, "notes", 2001);
  const override = field(fd, "override_reason", 1001);
  const values = { decision, notes, override_reason: override };
  const errors: Record<string, string[]> = {};
  if (!(DECISIONS as readonly string[]).includes(decision)) errors.decision = ["Choose a decision."];
  if (decision !== "approved" && !notes) errors.notes = ["Explain what needs to change. The editor will see this."];
  if (notes.length > 2000) errors.notes = ["Keep notes under 2,000 characters."];
  if (override.length > 1000) errors.override_reason = ["Keep the reason under 1,000 characters."];
  if (Object.keys(errors).length) return fail("Check the highlighted fields.", errors, values);
  try {
    await asUser(viewer.userId, (tx) =>
      tx.query("select review_revision($1, $2::review_decision, $3, $4) as id",
        [revisionId, decision as Decision, notes || null, override || null]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, values);
  }
  refresh();
  return ok(decision === "approved"
    ? "Approved. Check the public preview, then publish this exact revision."
    : "Returned to the editor with your notes. They will start a new draft from it.");
}

export async function publishAction(revisionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(REVIEWERS);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(revisionId)) return fail("That revision could not be found.");
  if (fd.get("confirm") !== "yes") {
    return fail("Confirm that you have checked the preview of this exact revision.", { confirm: ["Required before publishing."] });
  }
  let slug: string | null;
  try {
    await asUser(viewer.userId, (tx) => tx.query("select publish_revision($1) as id", [revisionId]));
    slug = await slugForRevision(viewer, revisionId);
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  if (!slug) {
    refresh();
    return ok("Published.");
  }
  redirect(`/institutions/${encodeURIComponent(slug)}`);
}

export async function withdrawAction(institutionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(REVIEWERS);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(institutionId)) return fail("That institution could not be found.");
  const reason = field(fd, "reason", 1001);
  const values = { reason };
  if (!reason) return fail("Give the reason for withdrawing. It is recorded in the audit history.", { reason: ["Required."] }, values);
  if (reason.length > 1000) return fail("Keep the reason under 1,000 characters.", { reason: ["Too long."] }, values);
  if (fd.get("confirm") !== "yes") {
    return fail("Confirm that you want to take this institution off the public site.", { confirm: ["Required."] }, values);
  }
  try {
    await asUser(viewer.userId, (tx) => tx.query("select withdraw_publication($1, $2)", [institutionId, reason]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, values);
  }
  refresh();
  return ok("Withdrawn. The institution and its earlier releases no longer appear on the public site; the audit history keeps the reason.");
}

/** Send a submitted or approved revision back for changes; its approval no longer counts. */
export async function reopenAction(revisionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(REVIEWERS);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(revisionId)) return fail("That revision could not be found.");
  const reason = field(fd, "reason", 1001);
  const values = { reason };
  if (reason.length < 3) return fail("Say what needs changing. The editor sees this note.", { reason: ["Required."] }, values);
  if (reason.length > 1000) return fail("Keep the note under 1,000 characters.", { reason: ["Too long."] }, values);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select reopen_revision($1, $2)", [revisionId, reason]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, values);
  }
  refresh();
  return ok("Returned for changes. The approval no longer counts; the editor can start a corrected draft.");
}

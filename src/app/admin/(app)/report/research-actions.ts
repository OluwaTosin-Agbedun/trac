"use server";
// The research assistant's suggestions on a register record. Each action is a public POST endpoint:
// it re-checks the session and role, validates every bound id and the record's content hash, and
// lets the database functions check the role, the editor's scope, the hash and the proposal again.
// Nothing here can verify or publish: an applied suggestion changes the private working copy, which
// a second person verifies as usual. The working copy is not public, so the public "register" cache
// is left alone.
import { refresh } from "next/cache";
import { asUser } from "@/server/db";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { dbErrorMessage, fail, field, ok } from "@/server/actions/result";
import { getWorkerLine } from "@/server/data/cms/research";
import { queuedMessage } from "@/lib/workerStatus";
import type { FormState } from "@/components/ui/Form";
import { HASH_RE } from "./_lib/forms";

const TEAM = ["editor", "reviewer", "admin"] as const;
const SIGNED_OUT = "Your session has ended or you do not have access. Sign in again, then retry.";
const NOT_FOUND = "That record or suggestion could not be found. Reload the page.";

export async function applySuggestionAction(proposalId: string, entryId: string, hash: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(proposalId) || !isUuid(entryId) || typeof hash !== "string" || !HASH_RE.test(hash)) return fail(NOT_FOUND);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select apply_proposal_to_register($1, $2, $3)", [proposalId, entryId, hash]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok("Applied to this record, with the captured page as evidence. Check it in the form above; a second person must verify it before the public sees it.");
}

export async function dismissSuggestionAction(proposalId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const note = field(fd, "note", 1001);
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT, undefined, { note });
  if (!isUuid(proposalId)) return fail(NOT_FOUND, undefined, { note });
  if (!note) return fail("Give a short reason, for example “this is a grant award, not the budget”.", undefined, { note });
  if (note.length > 1000) return fail("Shorten the reason (1,000 characters at most).", undefined, { note });
  try {
    // The same rejection the institution's research panel uses.
    await asUser(viewer.userId, (tx) => tx.query("select reject_proposal($1, $2)", [proposalId, note]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, { note });
  }
  refresh();
  return ok("Dismissed with your reason.");
}

export async function requestRecordScanAction(entryId: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(entryId)) return fail(NOT_FOUND);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select request_register_scan($1)", [entryId]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok(queuedMessage(await getWorkerLine(viewer)));
}

/**
 * Administrators approve the record's homepage as a research source; editors and reviewers suggest
 * it for an administrator to approve. Uses add_source_host and decide_source_host, which check the
 * role again; the host comes from the stored homepage, never from the form.
 */
export async function approveRecordHomepageAction(entryId: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(entryId)) return fail(NOT_FOUND);
  const admin = viewer.role === "admin";
  try {
    const host = await asUser(viewer.userId, async (tx) => {
      const [e] = await tx.query<{ institution_id: string | null; host: string | null }>(
        "select institution_id, register_research_host(homepage_url) as host from report_entries where id = $1 and archived_at is null", [entryId]);
      if (!e?.institution_id) return { error: "This record is not linked to a research institution yet." };
      if (!e.host) {
        return { error: "This record has no homepage that can be approved. Enter the institution’s own website address in the form above (not a social media page or a shared hosting service), save, then try again." };
      }
      const [row] = await tx.query<{ id: string }>("select add_source_host($1, $2, $3) as id",
        [e.institution_id, e.host, "The homepage recorded in the register"]);
      if (admin) {
        const [h] = await tx.query<{ approved: boolean }>("select approved from source_hosts where id = $1", [row.id]);
        if (!h?.approved) await tx.query("select decide_source_host($1, true)", [row.id]);
      }
      return { host: e.host };
    });
    if ("error" in host) return fail(host.error ?? NOT_FOUND);
    refresh();
    return ok(admin
      ? `${host.host} is approved as a research source. You can now request a scan.`
      : `${host.host} was suggested. An administrator must approve it before a scan can run.`);
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
}

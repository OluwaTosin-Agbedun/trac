"use server";
// Verified register actions. Each re-checks the session and role and validates every field; the
// database functions check the role again, enforce the second-person rule, and audit every change.
// Actions that change what the public sees also expire the "register" cache tag.
import { refresh, updateTag } from "next/cache";
import { asUser } from "@/server/db";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { dbErrorMessage, fail, field, ok } from "@/server/actions/result";
import { entriesDueForLinkCheck, getEntryLinks } from "@/server/data/cms/report";
import { checkLinks, linkTargets } from "@/server/research/linkCheck";
import { REPORT_SECTIONS, type ReportSection } from "@/lib/report";
import { lagosDate } from "@/lib/editorRules";
import type { FormState } from "@/components/ui/Form";
import { HASH_RE, entryValues, parseAssign, parseDates, parseEntry, parseReason, parseVisibility } from "./_lib/forms";

const TEAM = ["editor", "reviewer", "admin"] as const;
const SIGNED_OUT = "Your session has ended or you do not have access. Sign in again, then retry.";
/** For forms whose typed values come back: sign in again in another tab and nothing is lost. */
const SIGNED_OUT_KEEP = "Your session has ended or you do not have access. Sign in again in another tab, then press Save again: what you typed is still here.";
const NOT_FOUND = "That record could not be found. Reload the page.";
/** The public register's cache tag (see the public data layer). */
const REGISTER_TAG = "register";
/** A batch link check starts no new record after this long, so it ends inside the page's time limit. */
const BATCH_BUDGET_MS = 25_000;

/** After a change the public can see: expire the cached public register and refresh this page. */
function publicChanged() {
  updateTag(REGISTER_TAG);
  refresh();
}

export async function saveEntryAction(entryId: string | null, hash: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  // Read what was typed first, so even a refusal (an expired session included) gives it all back.
  const typed = entryValues(fd);
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT_KEEP, undefined, typed);
  if (entryId !== null && (!isUuid(entryId) || typeof hash !== "string" || !HASH_RE.test(hash))) return fail(NOT_FOUND, undefined, typed);
  if (entryId === null && hash !== null) return fail(NOT_FOUND, undefined, typed);
  const { value, error, values } = parseEntry(fd);
  if (error || !value) return fail(error ?? "Check the form.", undefined, values);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select save_report_entry($1, $2::jsonb, $3) as id", [entryId, JSON.stringify(value), hash]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, values);
  }
  refresh();
  return ok(entryId
    ? "Saved. The change is waiting for a second reviewer; the public site keeps the last verified version until then."
    : "Added. It appears publicly once a second reviewer verifies it.");
}

export async function verifyEntryAction(entryId: string, hash: string): Promise<FormState> {
  const viewer = await viewerForAction(["reviewer", "admin"]);
  if (!viewer) return fail("Only reviewers and administrators verify records. If you are one, sign in again.");
  if (!isUuid(entryId) || typeof hash !== "string" || !HASH_RE.test(hash)) return fail(NOT_FOUND);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select verify_report_entry($1, $2)", [entryId, hash]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  publicChanged();
  return ok("Verified. This record is now public.");
}

export async function returnEntryAction(entryId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const note = field(fd, "note", 1001);
  const viewer = await viewerForAction(["reviewer", "admin"]);
  if (!viewer) return fail("Only reviewers and administrators return records. If you are one, sign in again.", undefined, { note });
  if (!isUuid(entryId)) return fail(NOT_FOUND, undefined, { note });
  if (!note) return fail("Say what needs fixing, so the editor knows.", undefined, { note });
  if (note.length > 1000) return fail("Shorten the note (1,000 characters at most).", undefined, { note });
  try {
    await asUser(viewer.userId, (tx) => tx.query("select return_report_entry($1, $2)", [entryId, note]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, { note });
  }
  refresh();
  return ok("Returned to the editor with your note.");
}

export async function withdrawVerificationAction(entryId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const r = parseReason(fd, 5, 900, "for withdrawing the verification");
  const viewer = await viewerForAction(["reviewer", "admin"]);
  if (!viewer) return fail("Only reviewers and administrators withdraw a verification. If you are one, sign in again.", undefined, r.values);
  if (!isUuid(entryId)) return fail(NOT_FOUND, undefined, r.values);
  if (r.error || !r.value) return fail(r.error ?? "Give the reason.", undefined, r.values);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select withdraw_report_verification($1, $2)", [entryId, r.value]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, r.values);
  }
  publicChanged();
  return ok("Verification withdrawn. The public site shows “Verification in progress” for this record until it is verified again.");
}

export async function archiveEntryAction(entryId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const r = parseReason(fd, 5, 1000, "for removing this institution");
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail("Only administrators can remove an institution from the register. If you are one, sign in again.", undefined, r.values);
  if (!isUuid(entryId)) return fail(NOT_FOUND, undefined, r.values);
  if (r.error || !r.value) return fail(r.error ?? "Give the reason.", undefined, r.values);
  if (fd.get("confirm") !== "yes") return fail("Tick the box to confirm the removal.", undefined, r.values);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select archive_report_entry($1, $2)", [entryId, r.value]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, r.values);
  }
  publicChanged();
  return ok("Removed from the register. It is kept under “Removed (archived)”, where an administrator can restore it.");
}

export async function restoreEntryAction(entryId: string): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail("Only administrators can restore an institution. If you are one, sign in again.");
  if (!isUuid(entryId)) return fail(NOT_FOUND);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select restore_report_entry($1)", [entryId]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  publicChanged();
  return ok("Restored. The record is back in the register with its last verified version.");
}

export async function assignEntriesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { value, error, values } = parseAssign(fd);
  const viewer = await viewerForAction(["reviewer", "admin"]);
  if (!viewer) return fail("Only reviewers and administrators assign records. If you are one, sign in again.", undefined, values);
  if (error || !value) return fail(error ?? "Check the form.", undefined, values);
  let n: number;
  try {
    const [row] = await asUser(viewer.userId, (tx) => tx.query<{ n: number }>(
      "select assign_report_entries($1::uuid[], $2::uuid, $3::uuid, $4::date) as n", [value.ids, value.editor, value.reviewer, value.dueOn]));
    n = Number(row?.n ?? 0);
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, values);
  }
  refresh();
  const skipped = value.ids.length - n;
  const cleared = !value.editor && !value.reviewer && !value.dueOn;
  return ok(`${cleared ? "Cleared the assignment of" : "Assigned"} ${n} record${n === 1 ? "" : "s"}.${skipped > 0
    ? ` ${skipped} removed record${skipped === 1 ? " was" : "s were"} left out.` : ""}`);
}

async function runChecks(userId: string, entryId: string) {
  const entry = await getEntryLinks({ userId, role: "editor" }, entryId);
  if (!entry) return 0;
  const results = await checkLinks(linkTargets(entry), entry.homepage_url);
  if (results.length) {
    await asUser(userId, (tx) => tx.query("select save_link_checks($1, $2::jsonb)", [entryId, JSON.stringify(results)]));
  }
  return results.filter((r) => r.result !== "ok").length;
}

export async function checkLinksAction(entryId: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!isUuid(entryId)) return fail(NOT_FOUND);
  let problems: number;
  try {
    problems = await runChecks(viewer.userId, entryId);
  } catch (err) {
    console.error("[links] check failed", err);
    return fail("The links could not be checked just now. Try again.");
  }
  refresh();
  return ok(problems ? `Checked. ${problems} link${problems === 1 ? " needs" : "s need"} attention; see below.` : "Checked. Every link works and points to this institution.");
}

/**
 * Check the records in a category whose links were checked longest ago. No new record is started
 * after BATCH_BUDGET_MS, so the action ends inside the page's maxDuration even when sites are slow.
 */
export async function checkBatchAction(section: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!REPORT_SECTIONS.some((s) => s.key === section)) return fail("Choose a category.");
  const started = Date.now();
  let done = 0;
  let problems = 0;
  let left = 0;
  try {
    const ids = await entriesDueForLinkCheck(viewer, section as ReportSection, 8);
    for (const id of ids) {
      if (Date.now() - started > BATCH_BUDGET_MS) break;
      problems += await runChecks(viewer.userId, id);
      done++;
    }
    left = ids.length - done;
  } catch (err) {
    console.error("[links] batch failed", err);
    if (done) refresh();
    return fail(`The links could not all be checked just now${done ? ` (${done} record${done === 1 ? " was" : "s were"} checked first)` : ""}. Try again.`);
  }
  refresh();
  return ok(`Checked ${done} record${done === 1 ? "" : "s"}; ${problems} link${problems === 1 ? " needs" : "s need"} attention.${left
    ? " Some sites were slow, so the rest wait for the next press." : ""} Press again to continue with the next records.`);
}

export async function saveDatesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const year = Number(lagosDate().slice(0, 4));
  const { value, error, values } = parseDates(fd, year);
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail("Only administrators can change the report settings. If you are one, sign in again.", undefined, values);
  if (error || !value) return fail(error ?? "Check the form.", undefined, values);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select set_report_settings($1::date, $2::int, $3::int)",
      [value.reportedAsOf, value.assessmentYear, value.recheckDays]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, values);
  }
  publicChanged();
  return ok("Saved. New verifications use these dates; records verified earlier keep the year they were checked for.");
}

export async function setVisibilityAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { value, error, values } = parseVisibility(fd);
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail("Only administrators can show or hide the public register. If you are one, sign in again.", undefined, values);
  if (error || !value) return fail(error ?? "Check the form.", undefined, values);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select set_register_visibility($1, $2)", [value.visible, value.reason]));
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, values);
  }
  publicChanged();
  return ok(value.visible ? "The register is now shown on the public site." : "The register is now hidden from the public site.");
}

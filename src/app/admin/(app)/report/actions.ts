"use server";
// Verified register actions. Each re-checks the session and role and validates every field; the
// database functions check the role again, enforce the second-person rule, and audit every change.
import { refresh } from "next/cache";
import { asUser } from "@/server/db";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { dbErrorMessage, fail, field, ok } from "@/server/actions/result";
import { entriesDueForLinkCheck, getEntryLinks } from "@/server/data/cms/report";
import { checkLinks, linkTargets } from "@/server/research/linkCheck";
import { INDICATORS } from "@/lib/indicators";
import { REPORT_SECTIONS, type ReportSection } from "@/lib/report";
import { ASSESSMENT_STATUSES } from "@/lib/register";
import type { FormState } from "@/components/ui/Form";

const TEAM = ["editor", "reviewer", "admin"] as const;
const SIGNED_OUT = "Your session has ended or you do not have access. Sign in again, then retry.";
const URL_RE = /^https?:\/\/[^\s<>"]+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseEntry(fd: FormData): { payload?: Record<string, unknown>; error?: string; values: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const k of ["section", "name", "state", "head_name", "bursar_name", "homepage_url", "disclosure_url", "checked_all"]) values[k] = field(fd, k, 600);
  if (!REPORT_SECTIONS.some((s) => s.key === values.section)) return { error: "Choose the category.", values };
  if (!values.name || values.name.length > 300) return { error: "Enter the institution's name (300 characters at most).", values };
  if (values.state.length > 60 || values.head_name.length > 200 || values.bursar_name.length > 200) return { error: "Shorten the state, head or bursar.", values };
  for (const k of ["homepage_url", "disclosure_url"] as const) {
    if (values[k] && (!URL_RE.test(values[k]) || values[k].length > 500)) {
      return { error: `Enter the ${k === "homepage_url" ? "homepage" : "disclosure page"} as a full address starting with https://`, values };
    }
  }
  if (values.checked_all && !DATE_RE.test(values.checked_all)) return { error: "Choose a valid checked date.", values };
  const extra: { label: string; url: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const url = field(fd, `extra_url_${i}`, 501);
    const label = field(fd, `extra_label_${i}`, 121);
    if (!url) continue;
    if (!URL_RE.test(url) || url.length > 500) return { error: "Each extra document link must be a full address starting with https://", values };
    extra.push({ label: label.slice(0, 120) || "Document", url });
  }
  const assessments: Record<string, unknown> = {};
  for (const d of INDICATORS) {
    const status = field(fd, `st_${d.key}`, 20) || "not_assessed";
    if (!ASSESSMENT_STATUSES.some((s) => s.value === status)) return { error: `Choose a valid status for ${d.label}.`, values };
    const year = field(fd, `yr_${d.key}`, 21);
    const evidence = field(fd, `ev_${d.key}`, 501);
    let checked = field(fd, `ck_${d.key}`, 10);
    const note = field(fd, `nt_${d.key}`, 301);
    if (year.length > 20) return { error: `Shorten the reporting year for ${d.label}.`, values };
    if (evidence && (!URL_RE.test(evidence) || evidence.length > 500)) return { error: `The evidence link for ${d.label} must start with https://`, values };
    if (checked && !DATE_RE.test(checked)) return { error: `Choose a valid checked date for ${d.label}.`, values };
    if (note.length > 300) return { error: `Shorten the note for ${d.label} (300 characters).`, values };
    if (!checked && status !== "not_assessed" && values.checked_all) checked = values.checked_all;
    assessments[d.key] = { status, year: year || null, evidence_url: evidence || null, checked_on: checked || null, note: note || null };
  }
  return {
    payload: {
      section: values.section, name: values.name, state: values.state, head_name: values.head_name, bursar_name: values.bursar_name,
      homepage_url: values.homepage_url, disclosure_url: values.disclosure_url, extra_links: extra, assessments,
    },
    values,
  };
}

export async function saveEntryAction(entryId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (entryId !== null && !isUuid(entryId)) return fail("That institution could not be found. Reload the page.");
  const { payload, error, values } = parseEntry(fd);
  if (error || !payload) return fail(error ?? "Check the form.", undefined, values);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select save_report_entry($1, $2::jsonb) as id", [entryId, JSON.stringify(payload)]));
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
  if (!viewer) return fail("Only reviewers and administrators verify records.");
  if (!isUuid(entryId) || !/^[0-9a-f]{64}$/.test(hash)) return fail("That record could not be found. Reload the page.");
  try {
    await asUser(viewer.userId, (tx) => tx.query("select verify_report_entry($1, $2)", [entryId, hash]));
  } catch (err) {
    const msg = dbErrorMessage(err);
    return fail(msg);
  }
  refresh();
  return ok("Verified. This record is now public.");
}

export async function returnEntryAction(entryId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(["reviewer", "admin"]);
  if (!viewer) return fail("Only reviewers and administrators return records.");
  if (!isUuid(entryId)) return fail("That record could not be found. Reload the page.");
  const note = field(fd, "note", 1001);
  if (!note) return fail("Say what needs fixing, so the editor knows.");
  try {
    await asUser(viewer.userId, (tx) => tx.query("select return_report_entry($1, $2)", [entryId, note]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok("Returned to the editor with your note.");
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
  if (!isUuid(entryId)) return fail("That record could not be found. Reload the page.");
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

/** Check the records in a category whose links were checked longest ago, within a time budget. */
export async function checkBatchAction(section: string): Promise<FormState> {
  const viewer = await viewerForAction(TEAM);
  if (!viewer) return fail(SIGNED_OUT);
  if (!REPORT_SECTIONS.some((s) => s.key === section)) return fail("Choose a category.");
  const started = Date.now();
  let done = 0;
  let problems = 0;
  try {
    const ids = await entriesDueForLinkCheck(viewer, section as ReportSection, 8);
    for (const id of ids) {
      if (Date.now() - started > 40_000) break;
      problems += await runChecks(viewer.userId, id);
      done++;
    }
  } catch (err) {
    console.error("[links] batch failed", err);
    return fail("The links could not be checked just now. Try again.");
  }
  refresh();
  return ok(`Checked ${done} record${done === 1 ? "" : "s"}; ${problems} link${problems === 1 ? "" : "s"} need attention. Press again to continue.`);
}

export async function deleteEntryAction(entryId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail("Only administrators can remove an institution from the report.");
  if (!isUuid(entryId)) return fail("That institution could not be found. Reload the page.");
  if (fd.get("confirm") !== "yes") return fail("Tick the box to confirm the removal.");
  try {
    await asUser(viewer.userId, (tx) => tx.query("select delete_report_entry($1)", [entryId]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok("Removed from the report.");
}

export async function saveSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail("Only administrators can change the report settings.");
  const date = field(fd, "reported_as_of", 10);
  if (date && !DATE_RE.test(date)) return fail("Choose a valid date.");
  const visible = fd.get("visible") === "yes";
  try {
    await asUser(viewer.userId, (tx) => tx.query("select set_report_settings($1, $2::date)", [visible, date || null]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok(visible ? "Saved. The report is shown on the public site." : "Saved. The report is hidden from the public site.");
}

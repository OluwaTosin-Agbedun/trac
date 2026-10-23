"use server";
// Import centre actions (administrators only). The file is parsed on the server; the SQL functions
// stage it idempotently by content hash, record identity decisions and commit private drafts only.
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { asUser } from "@/server/db";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { dbErrorMessage, fail, field, ok } from "@/server/actions/result";
import { parseTrackerCsv, parseTrackerRecords, parseTrackerTsv, summarise } from "@/lib/import/trackerTsv";
import { readTrackerWorkbook, WorkbookError } from "@/lib/import/trackerXlsx";
import type { FormState } from "@/components/ui/Form";

const MAX_BYTES = 3 * 1024 * 1024;
const ADMIN_ONLY = "Only administrators can import data. Sign in as an administrator and retry.";

export async function stageImportAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.", { file: ["Required."] });
  if (file.size > MAX_BYTES) return fail("That file is larger than 3 MB.", { file: ["Too large."] });
  const name = (file.name || "upload.tsv").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const ext = /\.(tsv|txt|csv|xlsx)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext) {
    return fail("Upload the tracker as an Excel workbook (.xlsx), CSV, or tab-separated text (.tsv or .txt).", { file: ["Unsupported type."] });
  }
  // What is stored as the preserved original: the text itself, or the workbook's bytes as base64.
  let text: string;
  let parsed: ReturnType<typeof parseTrackerTsv>;
  // @2: staged rows carry mapped.websiteConfirmed (0009 copies only a confirmed address into a draft).
  let parser = "trackerTsv@2";
  try {
    if (ext === "xlsx") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return fail("That file is not an Excel workbook.", { file: ["Not .xlsx."] });
      const { records } = await readTrackerWorkbook(bytes);
      parsed = parseTrackerRecords(records);
      text = `xlsx-base64:${Buffer.from(bytes).toString("base64")}`;
      parser = "trackerXlsx@2";
    } else {
      text = await file.text();
      if (text.includes("\u0000")) return fail("That file is not a text export.", { file: ["Not text."] });
      parsed = ext === "csv" ? parseTrackerCsv(text) : parseTrackerTsv(text);
      if (ext === "csv") parser = "trackerCsv@2";
    }
  } catch (err) {
    if (err instanceof WorkbookError) return fail(err.message, { file: [err.message] });
    return fail(`The file could not be read as a tracker export: ${err instanceof Error ? err.message.slice(0, 200) : "unknown format"}.`);
  }
  if (!parsed.rows.length) return fail("No institution rows were found in that file.");
  let importId: string;
  let existed = false;
  try {
    const res = await asUser(viewer.userId, async (tx) => {
      const before = await tx.query("select id from imports where content_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [text]);
      const [row] = await tx.query<{ id: string }>("select stage_import($1, $2, $3, $4, $5, $6) as id", [
        name, text, parsed.reportedAsOf, parser,
        JSON.stringify({ ...summarise(parsed), ignored: parsed.ignored }), JSON.stringify(parsed.rows),
      ]);
      return { id: row.id, existed: before.length > 0 };
    });
    importId = res.id;
    existed = res.existed;
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  redirect(`/admin/imports/${importId}${existed ? "?existing=1" : ""}`);
}

const DECISIONS = ["create_new", "match_existing", "skip"] as const;

export async function decideRowAction(importId: string, rowId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  if (!isUuid(importId) || !isUuid(rowId)) return fail("That row could not be found. Reload the page.");
  const decision = field(fd, "decision", 30);
  const note = field(fd, "note", 1001);
  const institution = field(fd, "institution_id", 40);
  if (!(DECISIONS as readonly string[]).includes(decision)) return fail("Choose a decision.");
  if (note.length > 1000) return fail("Keep the reason under 1,000 characters.");
  if (decision === "match_existing" && !isUuid(institution)) return fail("Choose the existing institution to match.");
  try {
    await asUser(viewer.userId, (tx) =>
      tx.query("select decide_import_row($1, $2::import_row_decision, $3, $4)",
        [rowId, decision, decision === "match_existing" ? institution : null, note || null]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok(decision === "create_new"
    ? "Decision recorded. The draft is created when you commit."
    : decision === "match_existing" ? "Linked to the existing institution. Its data was not changed." : "Row skipped with your reason.");
}

export async function commitImportAction(importId: string): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  if (!isUuid(importId)) return fail("That import could not be found.");
  let r: Record<string, number>;
  try {
    const [row] = await asUser(viewer.userId, (tx) => tx.query<{ r: Record<string, number> }>("select commit_import($1) as r", [importId]));
    r = row.r;
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok(`Committed. ${r.created} private drafts created, ${r.held} held for a decision, ${r.needs_match} need matching to an existing institution, ${r.skipped} skipped, ${r.already_committed} already committed. Nothing was published.`);
}

/** Show this import's spreadsheet as the public compliance report (replaces any shown before). */
export async function showReportAction(importId: string): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  if (!isUuid(importId)) return fail("That import could not be found.");
  try {
    await asUser(viewer.userId, (tx) => tx.query("select publish_tracker_report($1)", [importId]));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok("Added. Each new institution is a record to verify; the public site shows “Verification in progress” until a second reviewer verifies it.");
}

export async function hideReportAction(): Promise<FormState> {
  const viewer = await viewerForAction(["admin"]);
  if (!viewer) return fail(ADMIN_ONLY);
  try {
    await asUser(viewer.userId, (tx) => tx.query("select hide_tracker_report()"));
  } catch (err) {
    return fail(dbErrorMessage(err));
  }
  refresh();
  return ok("The compliance report is no longer shown on the public site.");
}

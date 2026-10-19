"use server";
// Institution directory actions. Each is a public POST endpoint: it checks the signed-in viewer
// and role itself, validates every field, and leaves the final word to the database functions
// (create_institution, assign_institution), which check the caller's team role again.
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { viewerForAction } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { dbErrorMessage, fail, field, ok } from "@/server/actions/result";
import { INSTITUTION_TYPES, OWNERSHIP, type InstitutionType, type Ownership } from "@/lib/indicators";
import { SLUG_MAX, isIsoDate, isValidSlug, suggestSlug } from "@/lib/cmsDirectory";
import { assignInstitution, createInstitution, findInstitutionsNamed } from "@/server/data/cms/institutions";
import type { FormState } from "@/components/ui/Form";

const NAME_MIN = 3;
const NAME_MAX = 200;

const isOwnership = (v: string): v is Ownership => (OWNERSHIP as readonly string[]).includes(v);
const isType = (v: string): v is InstitutionType => (INSTITUTION_TYPES as readonly string[]).includes(v);
/** Whitespace runs become one space; other control characters are dropped. */
function cleanText(s: string): string {
  return Array.from(s.replace(/\s+/g, " "))
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n >= 32 && n !== 127;
    })
    .join("")
    .trim();
}

const pgCode = (err: unknown) => (err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "");

/** Adds an institution with a private first draft, then opens it in the editor. */
export async function createInstitutionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(["editor", "reviewer", "admin"]);
  if (!viewer) return fail("Your session has ended or your role cannot add institutions. Sign in again and retry.");

  // Control characters are dropped and runs of spaces collapsed; the cap is checked, not silently cut.
  const rawName = cleanText(field(fd, "name", NAME_MAX + 1));
  const rawSlug = field(fd, "slug", SLUG_MAX + 1).toLowerCase();
  const ownership = field(fd, "ownership", 20);
  const type = field(fd, "type", 20);
  const slug = rawSlug || suggestSlug(rawName);
  const values = { name: rawName, slug, ownership, type };

  const errors: Record<string, string[]> = {};
  if (rawName.length < NAME_MIN) errors.name = ["Enter the institution's full name."];
  else if (rawName.length > NAME_MAX) errors.name = [`Use at most ${NAME_MAX} characters.`];
  if (!isValidSlug(slug)) {
    errors.slug = [`Use lower-case letters, numbers and single hyphens, at most ${SLUG_MAX} characters (for example: university-of-lagos).`];
  }
  if (!isOwnership(ownership)) errors.ownership = ["Choose the ownership."];
  if (!isType(type)) errors.type = ["Choose the institution type."];
  if (Object.keys(errors).length || !isOwnership(ownership) || !isType(type)) {
    return fail("Check the highlighted fields.", errors, values);
  }

  const confirmedDifferent = fd.get("confirm_duplicate") === "yes";
  let institutionId: string;
  try {
    if (!confirmedDifferent) {
      const same = await findInstitutionsNamed(viewer, rawName);
      if (same.length) {
        return fail(
          `An institution named “${same[0].name}” is already in the directory. Search for it before adding another record.`,
          {
            name: ["An institution with this name already exists."],
            duplicate: ["Tick the box only if this is a different institution that shares the name."],
          },
          values,
        );
      }
    }
    institutionId = await createInstitution(viewer, { slug, name: rawName, ownership, type });
  } catch (err) {
    if (pgCode(err) === "23505") {
      return fail("That slug is already used by another institution. Choose a different one.",
        { slug: ["This slug is already in use."] }, values);
    }
    return fail(dbErrorMessage(err), undefined, values);
  }
  if (!isUuid(institutionId)) return fail("The institution was created, but it could not be opened. Find it in the directory.");
  redirect(`/admin/institutions/${institutionId}`);
}

/**
 * Sets who edits and who reviews an institution, with an optional due date. Replaces the open
 * assignment (the database closes the previous one). Bind the institution id:
 * assignInstitutionAction.bind(null, institutionId).
 */
export async function assignInstitutionAction(institutionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const viewer = await viewerForAction(["reviewer", "admin"]);
  if (!viewer) return fail("Only reviewers and administrators can change assignments. Sign in again if your session has ended.");
  if (!isUuid(institutionId)) return fail("That institution could not be found.");

  const editorId = field(fd, "editor_id", 64);
  const reviewerId = field(fd, "reviewer_id", 64);
  const dueOn = field(fd, "due_on", 20);
  const values = { editor_id: editorId, reviewer_id: reviewerId, due_on: dueOn };

  const errors: Record<string, string[]> = {};
  if (editorId && !isUuid(editorId)) errors.editor_id = ["Choose an editor from the list."];
  if (reviewerId && !isUuid(reviewerId)) errors.reviewer_id = ["Choose a reviewer from the list."];
  if (editorId && reviewerId && editorId.toLowerCase() === reviewerId.toLowerCase()) {
    errors.reviewer_id = ["The editor and the reviewer must be different people."];
  }
  if (dueOn && !isIsoDate(dueOn)) errors.due_on = ["Enter a real date, for example 2026-11-14."];
  if (Object.keys(errors).length) return fail("Check the highlighted fields.", errors, values);

  try {
    await assignInstitution(viewer, {
      institutionId,
      editorId: editorId || null,
      reviewerId: reviewerId || null,
      dueOn: dueOn || null,
    });
  } catch (err) {
    return fail(dbErrorMessage(err), undefined, values);
  }
  refresh();
  return ok(editorId || reviewerId || dueOn ? "Assignment saved." : "Assignment cleared.");
}

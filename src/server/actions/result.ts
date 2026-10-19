import "server-only";
// Helpers shared by server actions: consistent results and safe error messages.
import type { FormState } from "@/components/ui/Form";

export function fail(message: string, errors?: Record<string, string[]>, values?: Record<string, string>): FormState {
  return { ok: false, message, errors, values };
}

export function ok(message: string): FormState {
  return { ok: true, message };
}

/** Text fields from FormData, trimmed, with a hard length cap. Missing → "". */
export function field(fd: FormData, name: string, max = 2000): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function optionalField(fd: FormData, name: string, max = 2000): string | null {
  const v = field(fd, name, max);
  return v === "" ? null : v;
}

type PgError = { code?: string; message?: string };

// Permission refusals whose wording helps the person and reveals nothing internal.
const EXPLAINED_REFUSALS: Record<string, string> = {
  "this institution is assigned to another editor": "This institution is assigned to another editor. Ask a reviewer or administrator to reassign it if you should work on it.",
  "you cannot review a revision you submitted or edited": "You cannot review a revision you submitted or edited. Another reviewer must do it (an administrator can record an override with a reason).",
  "you cannot review your own submission": "You cannot review your own submission. Another reviewer must do it.",
};

/**
 * Maps Postgres errors raised by our workflow functions to messages for the user. Our functions
 * raise human-readable text with known codes; anything else becomes a generic message and is
 * logged on the server only, so internal details never reach the browser.
 */
export function dbErrorMessage(err: unknown): string {
  const e = (err ?? {}) as PgError;
  const msg = typeof e.message === "string" ? e.message : "";
  switch (e.code) {
    case "42501":
      return EXPLAINED_REFUSALS[msg] ?? "You do not have permission to do that.";
    case "40001":
      return msg.startsWith("conflict") ? capitalise(msg) + " Reload to see the latest version, then reapply your change." : "Someone else changed this record. Reload and try again.";
    case "55000":
    case "23514":
    case "P0002":
    case "22023":
      return capitalise(msg) || "That change is not allowed.";
    case "23505":
      return "That value is already in use.";
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
      return "One of the values is not in the expected format.";
    default:
      console.error("[action] unexpected database error", err);
      return "Something went wrong. Nothing was changed. Please try again.";
  }
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : s;
}

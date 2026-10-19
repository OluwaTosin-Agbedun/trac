// Small text badges for the team screens. Every badge carries its meaning in words, so colour is
// never the only signal. Server-safe (no hooks).
import { REVISION_STATUS_LABEL } from "@/lib/indicators";

export const ROLE_LABEL: Record<string, string> = {
  editor: "Data editor",
  reviewer: "Reviewer and publisher",
  admin: "Administrator",
};

const STATUS_TONE: Record<string, string> = {
  draft: "border-rule bg-white text-ink",
  submitted: "border-[#c5d3ea] bg-accent-soft text-accent",
  changes_requested: "border-warn-rule bg-warn-bg text-warn-text",
  approved: "border-[#b7dcc5] bg-ok-bg text-ok",
  published: "border-accent bg-accent-soft text-accent",
  superseded: "border-rule-soft bg-surface text-muted",
  withdrawn: "border-[#e8b4b4] bg-danger-bg text-danger",
};

const base = "inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-[12px] font-semibold leading-5";

/** Editorial state of a revision, e.g. "Submitted for review". Not a disclosure finding. */
export function RevisionStatusBadge({ status }: { status: string }) {
  const label = REVISION_STATUS_LABEL[status] ?? status;
  return <span className={`${base} ${STATUS_TONE[status] ?? STATUS_TONE.draft}`}>{label}</span>;
}

export function OverdueBadge() {
  return <span className={`${base} border-[#e8b4b4] bg-danger-bg text-danger`}>Overdue</span>;
}

export function WithdrawnBadge() {
  return <span className={`${base} border-[#e8b4b4] bg-danger-bg text-danger`}>Withdrawn</span>;
}

export function ArchivedBadge() {
  return <span className={`${base} border-rule-soft bg-surface text-muted`}>Archived</span>;
}

/** The institution name as stored on its latest revision, or a clear placeholder. */
export function displayName(name: string | null | undefined): string {
  const n = name?.trim();
  return n ? n : "Unnamed institution";
}

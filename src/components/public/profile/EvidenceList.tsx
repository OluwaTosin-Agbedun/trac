// Evidence links for one indicator (or general profile sources). Each item names the document,
// its host and locator, places its period against the assessment period, and links to the
// evidence detail page (current release only) and to the official source.
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { periodCoverage } from "@/lib/compare";
import type { SnapshotEvidence } from "@/lib/snapshot";
import { hostOf } from "./labels";
import { Badge, ExternalLink } from "./parts";

export function evidencePath(slug: string, evidenceId: string) {
  return `/institutions/${encodeURIComponent(slug)}/evidence/${encodeURIComponent(evidenceId)}`;
}

/** Badge text placing a document's period against the assessment period, or null when in period. */
export function coverageNote(documentPeriod: string | null | undefined, assessmentPeriod: string | null | undefined) {
  const period = documentPeriod?.trim();
  if (!period) return null;
  const c = periodCoverage(period, assessmentPeriod);
  if (c === "historical") return { tone: "warn" as const, text: `Historical evidence (period ${period})` };
  if (c === "later") return { tone: "warn" as const, text: `Evidence for a later period (period ${period})` };
  return null;
}

export function EvidenceList({
  items, slug, assessmentPeriod, linkDetail, showExcerpt = false,
}: {
  items: SnapshotEvidence[];
  slug: string;
  assessmentPeriod: string | null;
  /** Evidence detail pages exist for the current release only. */
  linkDetail: boolean;
  /** Show excerpts inline (used where no detail page exists). */
  showExcerpt?: boolean;
}) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((e) => {
        const host = hostOf(e.url);
        const title = e.title?.trim() || "Untitled source document";
        const note = coverageNote(e.document_period, assessmentPeriod);
        return (
          <li key={e.id} className="flex flex-col gap-1 rounded-md border border-rule-soft bg-white px-3 py-2.5">
            <p className="text-[15px] font-semibold text-ink">
              {linkDetail ? (
                <Link href={evidencePath(slug, e.id)} className="inline-flex min-h-11 items-center">
                  {title}
                </Link>
              ) : (
                title
              )}
            </p>
            <p className="text-[13px] text-muted">
              {[host, e.locator?.trim() ? `Location: ${e.locator.trim()}` : null,
                e.document_period?.trim() ? `Document period: ${e.document_period.trim()}` : "Document period not stated",
                e.captured_at ? `Captured ${formatDate(e.captured_at)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {note ? (
              <p>
                <Badge tone={note.tone}>{note.text}</Badge>
              </p>
            ) : null}
            {showExcerpt && e.excerpt?.trim() ? (
              <blockquote className="mt-1 rounded bg-surface px-3 py-2 text-[14px] italic text-muted">{e.excerpt.trim()}</blockquote>
            ) : null}
            <p className="text-[13px]">
              <ExternalLink href={e.url} className="inline-flex min-h-11 items-center">
                Open the source{host ? ` on ${host}` : ""}
              </ExternalLink>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

// Every public (non-withdrawn) release of an institution's record, newest first.
import Link from "next/link";
import { SUMMARY_TEXT } from "@/lib/indicators";
import { formatDate } from "@/lib/format";
import type { PublishedSnapshot } from "@/lib/snapshot";
import { countsText, summaryOf } from "./labels";
import { Badge } from "./parts";

export function releasePath(slug: string, n: number) {
  return `/institutions/${encodeURIComponent(slug)}/releases/${n}`;
}

export function HistoryTable({ history, viewingRelease, onReleasePage = false }: {
  history: PublishedSnapshot[];
  viewingRelease: number;
  /** True when the page URL is the release URL itself (aria-current="page"). */
  onReleasePage?: boolean;
}) {
  return (
    <section aria-labelledby="history-h" className="flex flex-col gap-3">
      <h2 id="history-h" className="font-serif text-[26px] font-semibold text-ink-strong">
        Published history
      </h2>
      <p className="max-w-[760px] text-[15px] leading-relaxed text-muted">
        Every release is an approved, unchangeable record of what the team verified at the time. A new release never edits an
        earlier one.
      </p>
      {history.length ? (
        <div className="overflow-x-auto rounded-md border border-rule">
          <table className="w-full min-w-[720px] border-collapse text-left text-[14px]">
            <caption className="sr-only">Public releases of this institution&apos;s record, newest first</caption>
            <thead className="bg-surface-2 text-[13px] text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Release</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Public release date</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Assessment period</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Summary</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Counts</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Methodology</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const s = summaryOf(h.payload);
                const viewing = h.releaseNumber === viewingRelease;
                return (
                  <tr key={h.id} className={`border-t border-rule-soft ${viewing ? "bg-accent-soft" : ""}`}>
                    <th scope="row" className="px-4 py-2 font-semibold">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link
                          href={releasePath(h.slug, h.releaseNumber)}
                          aria-current={viewing ? (onReleasePage ? "page" : "true") : undefined}
                          className="inline-flex min-h-11 items-center"
                        >
                          Release {h.releaseNumber}
                        </Link>
                        {h.isCurrent ? <Badge tone="accent">Current</Badge> : null}
                        {viewing && !h.isCurrent ? <Badge>Viewing</Badge> : null}
                      </span>
                    </th>
                    <td className="px-4 py-2">{formatDate(h.publishedAt)}</td>
                    <td className="px-4 py-2">{h.payload.profile.assessment_period?.trim() || "Not stated"}</td>
                    <td className="px-4 py-2">{SUMMARY_TEXT[s.label]}</td>
                    <td className="px-4 py-2 text-muted">{countsText(s)}</td>
                    <td className="px-4 py-2">{h.methodologyVersionId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[15px] text-muted">No other public releases are recorded.</p>
      )}
    </section>
  );
}

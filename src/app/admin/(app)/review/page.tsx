import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireViewer } from "@/server/auth/session";
import { getReviewQueue, type QueueItem } from "@/server/data/cms/review";
import { formatDate, plural } from "@/lib/format";
import { RevisionStatusBadge } from "../institutions/_components/badges";

export const metadata: Metadata = { title: "Review queue", robots: { index: false } };

function Card({ id, title, intro, children }: { id: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
      <div>
        <h2 id={id} className="font-serif text-xl font-semibold text-ink-strong">{title}</h2>
        <p className="mt-1 text-sm text-muted">{intro}</p>
      </div>
      {children}
    </section>
  );
}

function QueueTable({ items, caption, mode }: { items: QueueItem[]; caption: string; mode: "waiting" | "approved" | "returned" }) {
  if (!items.length) return <p className="rounded border border-dashed border-rule px-4 py-6 text-center text-sm text-muted">Nothing here right now.</p>;
  return (
    <div className="overflow-x-auto rounded border border-rule-soft">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
            <th scope="col" className="px-4 py-2.5">Institution</th>
            <th scope="col" className="px-4 py-2.5">Revision</th>
            <th scope="col" className="px-4 py-2.5">Submitted</th>
            <th scope="col" className="px-4 py-2.5">{mode === "waiting" ? "Waiting" : "Decision"}</th>
            <th scope="col" className="px-4 py-2.5">Reviewer</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.revisionId} className="border-t border-rule-soft align-top">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <Link href={`/admin/review/${it.revisionId}`} className="font-semibold text-ink-strong">{it.name ?? "Unnamed institution"}</Link>
                {it.mine ? <span className="ml-2 rounded border border-warn-rule bg-warn-bg px-1.5 py-0.5 text-[11px] font-semibold text-warn-text">Your submission</span> : null}
              </th>
              <td className="px-4 py-3">
                <span className="mr-2">No. {it.revisionNumber}</span>
                <RevisionStatusBadge status={it.status} />
                {it.reviewCycle > 0 ? <span className="mt-1 block text-[12px] text-muted">Review cycle {it.reviewCycle + 1}</span> : null}
              </td>
              <td className="px-4 py-3">{formatDate(it.submittedAt)}<span className="block text-[12px] text-muted">{it.submittedByName ?? "—"}</span></td>
              <td className="px-4 py-3">
                {mode === "waiting"
                  ? (it.waitingDays === null ? "—" : it.waitingDays === 0 ? "Today" : plural(it.waitingDays, "day"))
                  : <>{formatDate(it.decidedAt)}<span className="block text-[12px] text-muted">{it.decidedByName ?? "—"}</span></>}
                {mode === "returned" && it.notes ? <span className="mt-1 block max-w-[280px] text-[12px] text-ink">“{it.notes}”</span> : null}
              </td>
              <td className="px-4 py-3">{it.reviewerName ?? <span className="text-muted">Not assigned</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function QueueBody() {
  const viewer = await requireViewer();
  const q = await getReviewQueue(viewer);
  const canReview = viewer.role !== "editor";
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Editorial workflow</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-ink-strong">Review queue</h1>
        <p className="mt-2 max-w-[70ch] text-sm text-muted">
          {canReview
            ? "Open a revision to compare it with the published release, check its evidence, and approve, return or reject it. Approved revisions are previewed and then published."
            : "You can follow where your submissions are. Only reviewers and administrators can approve and publish."}
        </p>
      </div>
      <Card id="waiting-h" title={`Waiting for review (${q.waiting.length})`} intro="Oldest first. Nobody can review their own submission.">
        <QueueTable items={q.waiting} caption="Revisions waiting for review" mode="waiting" />
      </Card>
      <Card id="approved-h" title={`Approved, waiting to publish (${q.approved.length})`} intro="Preview each one before publishing. Publishing creates a new public release.">
        <QueueTable items={q.approved} caption="Approved revisions waiting to be published" mode="approved" />
      </Card>
      <Card id="returned-h" title="Recently returned" intro="Changes requested in the last 30 days.">
        <QueueTable items={q.returned} caption="Revisions returned to editors" mode="returned" />
      </Card>
      <Card id="published-h" title="Recently published" intro="The latest public releases, including any later withdrawn.">
        {q.published.length ? (
          <ul className="divide-y divide-rule-soft rounded border border-rule-soft text-sm">
            {q.published.map((p) => (
              <li key={`${p.slug}-${p.releaseNumber}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <Link href={`/institutions/${encodeURIComponent(p.slug)}`} className="font-semibold">{p.name ?? p.slug}</Link>
                  <span className="text-muted"> · release {p.releaseNumber}</span>
                  {p.withdrawn ? <span className="ml-2 rounded border border-[#e8b4b4] bg-danger-bg px-1.5 py-0.5 text-[11px] font-semibold text-danger">Withdrawn</span> : null}
                </span>
                <span className="text-[13px] text-muted">{formatDate(p.publishedAt)}{p.publishedByName ? ` · ${p.publishedByName}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Nothing has been published yet.</p>}
      </Card>
    </div>
  );
}

export default function ReviewQueuePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the review queue…</p>}>
      <QueueBody />
    </Suspense>
  );
}

// Research centre: what the assistant is doing across all institutions, websites waiting for an
// administrator's approval, and where proposals are waiting for an editor.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { requireViewer } from "@/server/auth/session";
import { dataMode } from "@/server/db";
import { getResearchOverview, listScans } from "@/server/data/cms/research";
import { Notice } from "@/components/ui/Form";
import { formatDateTime } from "@/lib/format";
import { SCAN_STATUS_LABEL, scanCoverageText } from "../institutions/[id]/_components/ResearchPanel";
import { CancelScanForm, HostDecisionForm, RunQueuedForm } from "../institutions/[id]/_components/ResearchForms";

export const metadata: Metadata = { title: "Research centre", robots: { index: false } };

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded-md border p-4 ${tone === "warn" && value ? "border-warn-rule bg-warn-bg" : "border-rule bg-white"}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</p>
      <p className="mt-1 font-serif text-3xl font-semibold text-ink-strong tabular-nums">{value}</p>
    </div>
  );
}

async function ResearchBody() {
  await connection();
  const viewer = await requireViewer();
  const [overview, scans] = await Promise.all([getResearchOverview(viewer), listScans(viewer, 50)]);
  // Read at request time; only whether it is set is shown, never any part of the value.
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  const local = dataMode() === "local";
  const isAdmin = viewer.role === "admin";

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Research assistant</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-ink-strong">Research centre</h1>
        <p className="mt-2 max-w-[80ch] text-sm text-muted">
          Scans are requested from each institution&apos;s page (section “Research assistant”). The assistant reads only approved
          official websites, proposes values with the exact text it relied on, and never publishes or marks anything “not found”.
        </p>
      </div>

      {!configured ? (
        <Notice tone="warn" title="Configuration required">
          Set ANTHROPIC_API_KEY on the server that runs scans (never in the browser or in the repository). Without it, scans stop
          immediately with this message. Everything else in the CMS works without it.
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Queued" value={overview.counts.queued} />
        <Stat label="Running" value={overview.counts.running} />
        <Stat label="Proposals waiting" value={overview.counts.pendingProposals} tone="warn" />
        <Stat label="Failed in the last 7 days" value={overview.counts.failedRecently} tone="warn" />
      </div>

      {local ? (
        <section className="flex flex-col gap-2 rounded-md border border-rule bg-white p-5">
          <h2 className="font-serif text-xl font-semibold text-ink-strong">Run scans on this computer</h2>
          <p className="text-sm text-muted">
            With the local database, queued scans run inside this server when you press the button. On the live site a separate
            worker service runs them automatically.
          </p>
          <div><RunQueuedForm /></div>
        </section>
      ) : null}

      {overview.pendingHosts.length ? (
        <section aria-labelledby="hosts-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
          <h2 id="hosts-h" className="font-serif text-xl font-semibold text-ink-strong">Websites waiting for approval</h2>
          <p className="text-sm text-muted">Approve a website only when you are sure it is the institution&apos;s official site.</p>
          <ul className="divide-y divide-rule-soft rounded border border-rule-soft text-sm">
            {overview.pendingHosts.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span>
                  <span className="font-semibold">{h.host}</span> for{" "}
                  <Link href={`/admin/institutions/${h.institutionId}#research-h`} className="font-semibold text-accent underline underline-offset-2">
                    {h.institutionName ?? "Unnamed institution"}
                  </Link>
                  <span className="block text-[12px] text-muted">
                    Suggested {formatDateTime(h.createdAt)}{h.createdByName ? ` by ${h.createdByName}` : ""}{h.note ? ` · ${h.note}` : ""}
                  </span>
                </span>
                {isAdmin ? <HostDecisionForm hostId={h.id} approved={false} /> : <span className="text-[12px] text-muted">An administrator decides</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overview.proposalsByInstitution.length ? (
        <section aria-labelledby="props-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
          <h2 id="props-h" className="font-serif text-xl font-semibold text-ink-strong">Proposals waiting for a decision</h2>
          <ul className="divide-y divide-rule-soft rounded border border-rule-soft text-sm">
            {overview.proposalsByInstitution.map((p) => (
              <li key={p.institutionId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <Link href={`/admin/institutions/${p.institutionId}#research-h`} className="font-semibold text-accent underline underline-offset-2">
                  {p.institutionName ?? "Unnamed institution"}
                </Link>
                <span className="text-[13px] text-muted">{p.pending} waiting{p.latest ? ` · latest ${formatDateTime(p.latest)}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="scans-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h2 id="scans-h" className="font-serif text-xl font-semibold text-ink-strong">Recent scans</h2>
        {scans.length ? (
          <div className="overflow-x-auto rounded border border-rule-soft">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <caption className="sr-only">Recent research scans</caption>
              <thead>
                <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
                  <th scope="col" className="px-4 py-2.5">Institution</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5">Requested</th>
                  <th scope="col" className="px-4 py-2.5">Result</th>
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => (
                  <tr key={s.id} className="border-t border-rule-soft align-top">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <Link href={`/admin/institutions/${s.institutionId}#research-h`} className="font-semibold text-accent underline underline-offset-2">
                        {s.institutionName ?? "Unnamed institution"}
                      </Link>
                    </th>
                    <td className="px-4 py-3">
                      <span className={s.status === "failed" || s.status === "configuration_required" ? "font-semibold text-danger" : "font-semibold"}>
                        {SCAN_STATUS_LABEL[s.status]}
                      </span>
                      {s.cancelRequested && (s.status === "running" || s.status === "queued") ? <span className="block text-[12px] text-muted">Cancellation requested</span> : null}
                    </td>
                    <td className="px-4 py-3 text-[13px]">
                      {formatDateTime(s.requestedAt)}
                      {s.requestedByName ? <span className="block text-muted">{s.requestedByName}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-[13px]">
                      {scanCoverageText(s) || (s.status === "queued" ? "Waiting to start" : "—")}
                      {s.pendingProposals ? <span className="block font-semibold text-warn-text">{s.pendingProposals} waiting for a decision</span> : null}
                      {s.error ? <span className="block text-danger">{s.error}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      {(s.status === "queued" || s.status === "running") && !s.cancelRequested ? <CancelScanForm jobId={s.id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No scans yet. Open an institution and use “Request a scan” in its Research assistant section.</p>
        )}
      </section>
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the research centre…</p>}>
      <ResearchBody />
    </Suspense>
  );
}

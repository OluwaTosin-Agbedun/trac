// Research panel for the institution editor: approved official websites, scans, and the assistant's
// proposals with Accept / Edit / Reject. Reads the session and database, so render it in <Suspense>.
// Website text is shown as plain text only; links go to approved hosts and open in a new tab.
import Link from "next/link";
import { requireViewer } from "@/server/auth/session";
import { dataMode } from "@/server/db";
import { getInstitutionResearch, type ProposalRow, type ScanRow } from "@/server/data/cms/research";
import { Notice } from "@/components/ui/Form";
import { indicatorByKey, STATE_LABEL, type AssessmentState } from "@/lib/indicators";
import { formatDateTime } from "@/lib/format";
import { periodText, PROFILE_LABEL, valueText } from "./labels";
import {
  AcceptAllForm, AddHostForm, CancelScanForm, HostDecisionForm, ProposalActions, RequestScanForm, RunQueuedForm,
} from "./ResearchForms";

export const SCAN_STATUS_LABEL: Record<ScanRow["status"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
  configuration_required: "Configuration required",
};

export function scanCoverageText(s: ScanRow): string {
  const c = s.coverage as { pagesFetched?: number; documentsFetched?: number; proposalsAdded?: number; failures?: unknown[]; budgetReached?: boolean };
  const parts: string[] = [];
  if (typeof c.pagesFetched === "number") parts.push(`${c.pagesFetched} pages`);
  if (typeof c.documentsFetched === "number" && c.documentsFetched) parts.push(`${c.documentsFetched} documents`);
  if (Array.isArray(c.failures) && c.failures.length) parts.push(`${c.failures.length} could not be read`);
  if (c.budgetReached) parts.push("page limit reached");
  if (typeof c.proposalsAdded === "number") parts.push(`${c.proposalsAdded} proposals`);
  return parts.join(" · ");
}

function fieldLabel(key: string): string {
  const def = indicatorByKey(key);
  return def ? `${def.group} · ${def.label}` : PROFILE_LABEL[key] ?? key;
}

function shownValue(p: ProposalRow, v: Record<string, unknown> | null): string {
  if (!v) return "Nothing recorded";
  if (p.fieldKind === "profile") return typeof v.value === "string" && v.value ? v.value : "Not stated";
  const state = typeof v.state === "string" ? STATE_LABEL[v.state as AssessmentState] ?? v.state : null;
  const literal = typeof v.value_literal === "string" && v.value_literal ? `“${v.value_literal}”` : null;
  const value = valueText({ key: p.fieldKey, ...(v as object) });
  const period = periodText(v as { period_type?: string | null; period_label?: string | null });
  return [state, literal ?? (value === "Not stated" ? null : value), period === "Not stated" ? null : period].filter(Boolean).join(" · ") || "Nothing recorded";
}

function ProposalCard({ p, institutionId }: { p: ProposalRow; institutionId: string }) {
  const kind = indicatorByKey(p.fieldKey)?.kind ?? "profile";
  return (
    <li className="flex flex-col gap-3 rounded-md border border-rule bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[15px] font-semibold text-ink-strong">{fieldLabel(p.fieldKey)}</h4>
        <span className="text-[12px] text-muted">
          {p.candidateState ? STATE_LABEL[p.candidateState] : "Profile change"}{p.confidence ? ` · ${p.confidence} confidence (guidance only)` : ""}
        </span>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded border border-rule-soft bg-surface-2 p-3">
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">When the scan started</dt>
          <dd className="mt-1">{shownValue(p, p.existingValue)}</dd>
        </div>
        <div className="rounded border border-accent/40 bg-accent-soft p-3">
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-accent">Proposed</dt>
          <dd className="mt-1 font-medium">{shownValue(p, { state: p.candidateState, ...p.proposed })}</dd>
        </div>
      </dl>
      <figure className="rounded border-l-4 border-rule bg-surface px-3 py-2 text-sm">
        <blockquote className="whitespace-pre-wrap break-words text-ink">{p.excerpt}</blockquote>
        <figcaption className="mt-1.5 text-[12px] text-muted">
          {p.locator ? <>{p.locator} · </> : null}
          <a href={p.source.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-semibold text-accent underline underline-offset-2">
            {p.source.title || p.source.url}
          </a>
          {" · captured "}{formatDateTime(p.source.fetchedAt)}
          {" · "}<Link href={`/admin/research/sources/${p.source.id}`} className="font-semibold text-accent underline underline-offset-2">captured text</Link>
        </figcaption>
      </figure>
      {p.uncertainty.length ? (
        <div className="text-[13px] text-warn-text">
          <p className="font-semibold">Check before accepting</p>
          <ul className="mt-1 list-disc pl-5">{p.uncertainty.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </div>
      ) : null}
      <ProposalActions proposalId={p.id} institutionId={institutionId} fieldKey={p.fieldKey}
        kind={kind === "money" || kind === "count" ? kind : "profile"} proposed={p.proposed} candidateState={p.candidateState} />
    </li>
  );
}

export async function ResearchPanel({ institutionId }: { institutionId: string }) {
  const viewer = await requireViewer();
  const r = await getInstitutionResearch(viewer, institutionId);
  const isAdmin = viewer.role === "admin";
  const approved = r.hosts.filter((h) => h.approved);
  const local = dataMode() === "local";
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  const lastFinished = r.scans.find((s) => s.status !== "queued" && s.status !== "running") ?? null;

  return (
    <section aria-labelledby="research-h" className="flex flex-col gap-5">
      <div>
        <h2 id="research-h" className="font-serif text-2xl font-semibold text-ink-strong">Research assistant</h2>
        <p className="mt-1 max-w-[80ch] text-sm text-muted">
          The assistant reads only the official websites approved below and proposes values with the exact text it relied on.
          Proposals are not findings: accept, correct or reject each one. Accepted values go into the private draft, which is
          reviewed and published as usual. It never marks anything “not found”.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
          <h3 className="text-base font-semibold text-ink-strong">Official websites</h3>
          {r.hosts.length ? (
            <ul className="divide-y divide-rule-soft rounded border border-rule-soft text-sm">
              {r.hosts.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span>
                    <span className="font-semibold">{h.host}</span>
                    <span className={`ml-2 text-[12px] ${h.approved ? "text-ok" : "text-warn-text"}`}>
                      {h.approved ? "Approved" : h.decidedAt ? "Not approved" : "Awaiting administrator approval"}
                    </span>
                    {h.note ? <span className="block text-[12px] text-muted">{h.note}</span> : null}
                  </span>
                  {isAdmin ? <HostDecisionForm hostId={h.id} approved={h.approved} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No official website has been recorded for research yet.</p>
          )}
          <AddHostForm institutionId={institutionId} suggested={r.suggestedHost} isAdmin={isAdmin} />
        </div>

        <div className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
          <h3 className="text-base font-semibold text-ink-strong">Scans</h3>
          {!configured ? (
            <Notice tone="warn" title="Configuration required">
              The research assistant needs an ANTHROPIC_API_KEY set on the server (never in the browser). Until then scans stop
              straight away with this message.
            </Notice>
          ) : null}
          {!approved.length ? (
            <Notice tone="info" title="Needs source confirmation">
              {isAdmin ? "Approve the institution's official website first." : "An administrator must approve the institution's official website first."}
            </Notice>
          ) : r.activeScan ? (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                <span className="font-semibold">{SCAN_STATUS_LABEL[r.activeScan.status]}</span>
                {" · requested "}{formatDateTime(r.activeScan.requestedAt)}{r.activeScan.requestedByName ? ` by ${r.activeScan.requestedByName}` : ""}
                {r.activeScan.cancelRequested ? " · cancellation requested" : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {local && r.activeScan.status === "queued" ? <RunQueuedForm /> : null}
                {!r.activeScan.cancelRequested ? <CancelScanForm jobId={r.activeScan.id} /> : null}
              </div>
            </div>
          ) : (
            <RequestScanForm institutionId={institutionId} />
          )}
          {lastFinished ? (
            <div className="rounded border border-rule-soft bg-surface-2 p-3 text-sm">
              <p>
                <span className="font-semibold">Last scan: {SCAN_STATUS_LABEL[lastFinished.status]}</span>
                {lastFinished.finishedAt ? ` · ${formatDateTime(lastFinished.finishedAt)}` : ""}
              </p>
              {scanCoverageText(lastFinished) ? <p className="mt-1 text-muted">{scanCoverageText(lastFinished)}</p> : null}
              {lastFinished.error ? <p className="mt-1 text-danger">{lastFinished.error}</p> : null}
              {typeof lastFinished.coverage.note === "string" ? <p className="mt-1 text-muted">{lastFinished.coverage.note}</p> : null}
            </div>
          ) : null}
          {r.events.length ? (
            <details className="text-[13px]">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-accent">Scan log</summary>
              <ul className="mt-1 flex flex-col gap-1 text-muted">
                {r.events.map((e, i) => <li key={i}><span className="tabular-nums">{formatDateTime(e.at)}</span> · {e.message}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-base font-semibold text-ink-strong">Proposals waiting for a decision ({r.proposals.length})</h3>
          {r.proposals.length > 1 ? <AcceptAllForm institutionId={institutionId} count={r.proposals.length} /> : null}
        </div>
        {r.proposals.length ? (
          <ul className="flex flex-col gap-3">
            {r.proposals.map((p) => <ProposalCard key={p.id} p={p} institutionId={institutionId} />)}
          </ul>
        ) : (
          <p className="text-sm text-muted">No proposals are waiting. Request a scan to look for evidence on the approved websites.</p>
        )}
      </div>
    </section>
  );
}

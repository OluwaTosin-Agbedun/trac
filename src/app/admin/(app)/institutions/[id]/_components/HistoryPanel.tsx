// Revision history, review decisions and the recent audit trail for one institution. Loads its own
// data, so the page renders it inside its own <Suspense>. Audit events are visible to reviewers and
// administrators only (RLS returns none for editors).
import type { Viewer } from "@/server/auth/session";
import { getEditorHistory } from "@/server/data/cms/editor";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "./EditorHeader";
import { AUDIT_ACTION_LABEL, DECISION_LABEL, auditDetail, personName } from "./labels";

const TH = "border border-rule px-3 py-2 text-left font-semibold";
const TD = "border border-rule px-3 py-2 align-top";

export async function HistoryPanel({ viewer, institutionId }: { viewer: Viewer; institutionId: string }) {
  const h = await getEditorHistory(viewer, institutionId);
  const canSeeAudit = viewer.role === "reviewer" || viewer.role === "admin";
  return (
    <section aria-labelledby="history-h" className="flex flex-col gap-6">
      <h2 id="history-h" className="font-serif text-2xl font-semibold text-ink-strong">History</h2>

      <div className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h3 className="text-base font-semibold text-ink-strong">Revisions</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">Revisions of this institution, newest first</caption>
            <thead>
              <tr className="bg-surface-2">
                <th scope="col" className={TH}>Revision</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Created</th>
                <th scope="col" className={TH}>Submitted</th>
                <th scope="col" className={TH}>Review cycle</th>
              </tr>
            </thead>
            <tbody>
              {h.revisions.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className={`${TD} text-left font-semibold`}>{r.number}</th>
                  <td className={TD}><StatusBadge status={r.status} /></td>
                  <td className={TD}>
                    {formatDateTime(r.createdAt)}
                    <span className="block text-[13px] text-muted">{personName(h.team, r.createdBy)}</span>
                  </td>
                  <td className={TD}>
                    {r.submittedAt ? (
                      <>
                        {formatDateTime(r.submittedAt)}
                        <span className="block text-[13px] text-muted">{personName(h.team, r.submittedBy)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={TD}>{r.reviewCycle + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h3 className="text-base font-semibold text-ink-strong">Review decisions</h3>
        {h.approvals.length === 0 ? (
          <p className="text-sm text-muted">No review decisions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <caption className="sr-only">Review decisions, newest first</caption>
              <thead>
                <tr className="bg-surface-2">
                  <th scope="col" className={TH}>Revision</th>
                  <th scope="col" className={TH}>Decision</th>
                  <th scope="col" className={TH}>Reviewer</th>
                  <th scope="col" className={TH}>When</th>
                  <th scope="col" className={TH}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {h.approvals.map((a) => (
                  <tr key={a.id}>
                    <th scope="row" className={`${TD} text-left font-semibold`}>{a.revisionNumber}</th>
                    <td className={TD}>{DECISION_LABEL[a.decision] ?? a.decision}</td>
                    <td className={TD}>{personName(h.team, a.decidedBy)}</td>
                    <td className={TD}>{formatDateTime(a.decidedAt)}</td>
                    <td className={`${TD} whitespace-pre-line`}>
                      {a.notes || "—"}
                      {a.overrideReason ? (
                        <span className="mt-1 block text-[13px] text-warn-text">Self-review override: {a.overrideReason}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h3 className="text-base font-semibold text-ink-strong">Audit trail (last 20 events)</h3>
        {!canSeeAudit ? (
          <p className="text-sm text-muted">The audit trail is visible to reviewers and administrators.</p>
        ) : h.audit.length === 0 ? (
          <p className="text-sm text-muted">No audit events recorded for this institution.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">Most recent audit events for this institution and its revisions</caption>
              <thead>
                <tr className="bg-surface-2">
                  <th scope="col" className={TH}>When</th>
                  <th scope="col" className={TH}>Who</th>
                  <th scope="col" className={TH}>Action</th>
                  <th scope="col" className={TH}>Details</th>
                </tr>
              </thead>
              <tbody>
                {h.audit.map((a) => (
                  <tr key={a.id}>
                    <td className={TD}>{formatDateTime(a.at)}</td>
                    <td className={TD}>{personName(h.team, a.actorId)}</td>
                    <td className={TD}>{AUDIT_ACTION_LABEL[a.action] ?? a.action}</td>
                    <td className={TD}>{auditDetail(a.action, a.details) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

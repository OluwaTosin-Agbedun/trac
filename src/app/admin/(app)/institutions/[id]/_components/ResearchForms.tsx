"use client";
// Forms for the research panel: websites, scans and proposal decisions. Every button that calls a
// server action is the shared SubmitButton (spinner, disabled while pending).
import { useActionState, useState } from "react";
import { Field, FormMessage, inputClass, textareaClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { PERIOD_TYPES, PERIOD_TYPE_LABEL, VALUE_SCALES } from "@/lib/indicators";
import {
  acceptAllAction, acceptProposalAction, addHostAction, cancelScanAction, decideHostAction, rejectProposalAction,
  requestScanAction, runQueuedScansAction,
} from "../../../research/actions";
import { boundAction } from "@/lib/boundAction";

function Inline({ state }: { state: FormState }) {
  if (!state?.message) return <span aria-live="polite" className="sr-only" />;
  return <span role="status" className={`text-[13px] ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</span>;
}

export function AddHostForm({ institutionId, suggested, isAdmin }: { institutionId: string; suggested: string | null; isAdmin: boolean }) {
  const [state, action] = useActionState(boundAction(addHostAction, institutionId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field id={`host-${institutionId}`} label="Official website" hint="The domain only, e.g. unilag.edu.ng. Its subdomains are included." error={state?.errors?.host}>
          <input id={`host-${institutionId}`} name="host" defaultValue={state?.values?.host ?? suggested ?? ""} placeholder="example.edu.ng"
            className={inputClass()} autoComplete="off" />
        </Field>
        <Field id={`host-note-${institutionId}`} label="How you know it is official (optional)">
          <input id={`host-note-${institutionId}`} name="note" defaultValue={state?.values?.note ?? ""} maxLength={500} className={inputClass()} />
        </Field>
      </div>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">{isAdmin ? "Approve this website" : "Suggest this website"}</SubmitButton>
      </div>
    </form>
  );
}

export function HostDecisionForm({ hostId, approved }: { hostId: string; approved: boolean }) {
  const [state, action] = useActionState(boundAction(decideHostAction, hostId, !approved), undefined as FormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <SubmitButton variant={approved ? "quiet" : "secondary"} pendingLabel="Saving…">{approved ? "Revoke approval" : "Approve"}</SubmitButton>
      <Inline state={state} />
    </form>
  );
}

export function RequestScanForm({ institutionId }: { institutionId: string }) {
  const [state, action] = useActionState(boundAction(requestScanAction, institutionId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <details className="rounded border border-rule-soft">
        <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold text-accent">Add specific pages to start from (optional)</summary>
        <div className="border-t border-rule-soft p-3">
          <Field id={`start-${institutionId}`} label="Starting pages" hint="One address per line, on the approved websites, e.g. the bursary or budget page. Up to 10." error={state?.errors?.start_urls}>
            <textarea id={`start-${institutionId}`} name="start_urls" rows={3} defaultValue={state?.values?.start_urls ?? ""} className={textareaClass("font-mono text-[13px]")} />
          </Field>
        </div>
      </details>
      <div>
        <SubmitButton pendingLabel="Queuing…">Request a scan</SubmitButton>
      </div>
    </form>
  );
}

export function RunQueuedForm() {
  const [state, action] = useActionState(runQueuedScansAction, undefined as FormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton variant="secondary" pendingLabel="Starting…">Run queued scans now</SubmitButton>
      <Inline state={state} />
    </form>
  );
}

export function CancelScanForm({ jobId }: { jobId: string }) {
  const [state, action] = useActionState(boundAction(cancelScanAction, jobId), undefined as FormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <SubmitButton variant="danger" pendingLabel="Cancelling…">Cancel scan</SubmitButton>
      <Inline state={state} />
    </form>
  );
}

export function AcceptAllForm({ institutionId, count }: { institutionId: string; count: number }) {
  const [state, action] = useActionState(boundAction(acceptAllAction, institutionId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Adding to the draft…">Accept all {count} into the draft</SubmitButton>
      </div>
    </form>
  );
}

type Proposed = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function ProposalActions({ proposalId, institutionId, fieldKey, kind, proposed, candidateState }: {
  proposalId: string; institutionId: string; fieldKey: string; kind: "money" | "count" | "profile";
  proposed: Proposed; candidateState: "published" | "uncertain" | null;
}) {
  const [acceptState, accept] = useActionState(boundAction(acceptProposalAction, proposalId, institutionId, fieldKey), undefined as FormState);
  const [editState, acceptEdited] = useActionState(boundAction(acceptProposalAction, proposalId, institutionId, fieldKey), undefined as FormState);
  const [rejectState, reject] = useActionState(boundAction(rejectProposalAction, proposalId), undefined as FormState);
  const [mode, setMode] = useState<"none" | "edit" | "reject">("none");
  const id = proposalId.slice(0, 8);
  return (
    <div className="flex flex-col gap-3">
      <FormMessage state={acceptState} />
      <div className="flex flex-wrap gap-2">
        <form action={accept}>
          <SubmitButton pendingLabel="Adding…">Accept into draft</SubmitButton>
        </form>
        <button type="button" onClick={() => setMode(mode === "edit" ? "none" : "edit")} aria-expanded={mode === "edit"}
          className="inline-flex min-h-11 items-center rounded border border-accent bg-white px-4 text-sm font-semibold text-accent hover:bg-accent-soft">
          Edit before accepting
        </button>
        <button type="button" onClick={() => setMode(mode === "reject" ? "none" : "reject")} aria-expanded={mode === "reject"}
          className="inline-flex min-h-11 items-center rounded border border-rule bg-white px-4 text-sm font-semibold text-ink hover:bg-surface">
          Reject
        </button>
      </div>

      {mode === "edit" ? (
        <form action={acceptEdited} className="flex flex-col gap-3 rounded border border-rule-soft bg-surface p-3" noValidate>
          <FormMessage state={editState} />
          <input type="hidden" name="edited" value="1" />
          {kind === "profile" ? (
            <Field id={`pv-${id}`} label="Corrected value">
              <input id={`pv-${id}`} name="profile_value" defaultValue={str(proposed.value)} maxLength={200} className={inputClass()} />
            </Field>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id={`st-${id}`} label="Assessment">
                  <select id={`st-${id}`} name="state" defaultValue={candidateState ?? "uncertain"} className={inputClass()}>
                    <option value="published">Published, evidence checked</option>
                    <option value="uncertain">Evidence uncertain</option>
                  </select>
                </Field>
                <Field id={`pt-${id}`} label="Period type">
                  <select id={`pt-${id}`} name="period_type" defaultValue={str(proposed.period_type)} className={inputClass()}>
                    <option value="">Not stated</option>
                    {PERIOD_TYPES.map((p) => <option key={p} value={p}>{PERIOD_TYPE_LABEL[p]}</option>)}
                  </select>
                </Field>
                <Field id={`pl-${id}`} label="Period as stated">
                  <input id={`pl-${id}`} name="period_label" defaultValue={str(proposed.period_label)} maxLength={40} placeholder="2024 or 2023/2024" className={inputClass()} />
                </Field>
              </div>
              <Field id={`vl-${id}`} label="Figure exactly as printed">
                <input id={`vl-${id}`} name="value_literal" defaultValue={str(proposed.value_literal)} maxLength={200} className={inputClass()} />
              </Field>
              {kind === "money" ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id={`va-${id}`} label="Amount (digits)">
                    <input id={`va-${id}`} name="value_amount" inputMode="decimal" defaultValue={str(proposed.value_amount)} className={inputClass()} />
                  </Field>
                  <Field id={`vs-${id}`} label="Scale">
                    <select id={`vs-${id}`} name="value_scale" defaultValue={str(proposed.value_scale) || "units"} className={inputClass()}>
                      {VALUE_SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field id={`vc-${id}`} label="Currency">
                    <input id={`vc-${id}`} name="value_currency" defaultValue={str(proposed.value_currency) || "NGN"} maxLength={3} className={inputClass("uppercase")} />
                  </Field>
                </div>
              ) : (
                <Field id={`vn-${id}`} label="Count (whole number)">
                  <input id={`vn-${id}`} name="value_count" inputMode="numeric" defaultValue={str(proposed.value_count)} className={inputClass()} />
                </Field>
              )}
            </>
          )}
          <Field id={`rn-${id}`} label="Why you changed it (required)" hint="Kept with the original proposal for the reviewer.">
            <textarea id={`rn-${id}`} name="note" rows={2} maxLength={1000} className={textareaClass()} />
          </Field>
          <div>
            <SubmitButton pendingLabel="Adding…">Accept my corrected value</SubmitButton>
          </div>
        </form>
      ) : null}

      {mode === "reject" ? (
        <form action={reject} className="flex flex-col gap-3 rounded border border-rule-soft bg-surface p-3" noValidate>
          <FormMessage state={rejectState} />
          <Field id={`rj-${id}`} label="Reason (required)" hint="For example: the figure is a grant award, not annual revenue.">
            <textarea id={`rj-${id}`} name="note" rows={2} maxLength={1000} className={textareaClass()} />
          </Field>
          <div>
            <SubmitButton variant="danger" pendingLabel="Rejecting…">Reject proposal</SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

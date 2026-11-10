"use client";
// Forms for the research suggestions on a register record. Every button that calls a server action
// is the shared SubmitButton (spinner, disabled while pending); bound actions use boundAction.
import { useActionState } from "react";
import { Field, FormMessage, textareaClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { boundAction } from "@/lib/boundAction";
import { approveRecordHomepageAction, applySuggestionAction, dismissSuggestionAction, requestRecordScanAction } from "../research-actions";

export function ApplySuggestionForm({ proposalId, entryId, hash }: { proposalId: string; entryId: string; hash: string }) {
  const [state, action] = useActionState(boundAction(applySuggestionAction, proposalId, entryId, hash), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Applying…">Apply to this record</SubmitButton>
      </div>
    </form>
  );
}

export function DismissSuggestionForm({ proposalId }: { proposalId: string }) {
  const [state, action] = useActionState(boundAction(dismissSuggestionAction, proposalId), undefined as FormState);
  const id = `dismiss-${proposalId.slice(0, 8)}`;
  return (
    <details className="rounded border border-rule-soft">
      <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold text-ink">Dismiss</summary>
      <form action={action} className="flex flex-col gap-3 border-t border-rule-soft p-3" noValidate>
        <FormMessage state={state} />
        <Field id={id} label="Why it does not belong in this record" hint="For example: the figure is a grant award, not the budget.">
          <textarea id={id} name="note" rows={2} maxLength={1000} defaultValue={state?.ok === false ? state.values?.note ?? "" : ""}
            aria-describedby={`${id}-hint`} className={textareaClass()} />
        </Field>
        <div>
          <SubmitButton variant="secondary" pendingLabel="Dismissing…">Dismiss this suggestion</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function RequestRecordScanForm({ entryId }: { entryId: string }) {
  const [state, action] = useActionState(boundAction(requestRecordScanAction, entryId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Queuing…">Request a scan</SubmitButton>
      </div>
    </form>
  );
}

export function ApproveHomepageForm({ entryId, host, isAdmin }: { entryId: string; host: string; isAdmin: boolean }) {
  const [state, action] = useActionState(boundAction(approveRecordHomepageAction, entryId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel={isAdmin ? "Approving…" : "Suggesting…"}>
          {isAdmin ? "Approve this homepage as a research source" : "Suggest this homepage as a research source"}
        </SubmitButton>
      </div>
      <p className="text-[12px] text-muted">{host}{" "}and its subdomains, such as bursary.{host}</p>
    </form>
  );
}

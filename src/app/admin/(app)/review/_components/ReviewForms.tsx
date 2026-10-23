"use client";
import { useActionState } from "react";
import { Field, FormMessage, describedBy, textareaClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { publishAction, reopenAction, reviewDecisionAction, withdrawAction } from "../actions";
import { boundAction } from "@/lib/boundAction";

export function DecisionForm({ revisionId, selfReview, isAdmin }: { revisionId: string; selfReview: boolean; isAdmin: boolean }) {
  const [state, action] = useActionState(boundAction(reviewDecisionAction, revisionId), undefined as FormState);
  const e = state?.errors ?? {};
  const v = state?.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-semibold text-ink">Decision</legend>
        {[
          ["approved", "Approve this exact revision", "Locks its content. It can then be previewed and published."],
          ["changes_requested", "Request changes", "Returns it to the editor with your notes."],
          ["rejected", "Reject", "Records that the findings are not supported. The editor starts again from it."],
        ].map(([value, label, hint]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded border border-rule-soft px-3 py-2.5 hover:bg-surface">
            <input type="radio" name="decision" value={value} defaultChecked={v.decision === value} className="mt-1 h-4 w-4" />
            <span>
              <span className="block text-sm font-semibold text-ink">{label}</span>
              <span className="block text-[13px] text-muted">{hint}</span>
            </span>
          </label>
        ))}
        {e.decision ? <p className="text-[13px] font-medium text-danger">{e.decision[0]}</p> : null}
      </fieldset>
      <Field id="review-notes" label="Notes for the editor" hint="Required when requesting changes or rejecting. Kept in the history." error={e.notes}>
        <textarea id="review-notes" name="notes" maxLength={2000} defaultValue={v.notes ?? ""} rows={4}
          aria-invalid={!!e.notes || undefined} aria-describedby={describedBy("review-notes", "hint", e.notes)} className={textareaClass()} />
      </Field>
      {selfReview && isAdmin ? (
        <Field id="override" label="Reason for reviewing your own submission" error={e.override_reason}
          hint="Administrators may review their own work only with a reason. It is recorded and visible in the audit history.">
          <textarea id="override" name="override_reason" maxLength={1000} defaultValue={v.override_reason ?? ""} rows={2}
            aria-describedby={describedBy("override", "hint", e.override_reason)} className={textareaClass()} />
        </Field>
      ) : null}
      <div>
        <SubmitButton pendingLabel="Recording decision…">Record decision</SubmitButton>
      </div>
    </form>
  );
}

export function PublishForm({ revisionId }: { revisionId: string }) {
  const [state, action] = useActionState(boundAction(publishAction, revisionId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="confirm" value="yes" className="mt-1 h-4 w-4" />
        <span>I have checked the public preview of this exact revision and want it to become the public release.</span>
      </label>
      {state?.errors?.confirm ? <p className="text-[13px] font-medium text-danger">{state.errors.confirm[0]}</p> : null}
      <div>
        <SubmitButton pendingLabel="Publishing…">Publish approved version</SubmitButton>
      </div>
    </form>
  );
}

export function WithdrawForm({ institutionId }: { institutionId: string }) {
  const [state, action] = useActionState(boundAction(withdrawAction, institutionId), undefined as FormState);
  const e = state?.errors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="withdraw-reason" label="Reason for withdrawal" hint="Recorded permanently in the audit history." error={e.reason}>
        <textarea id="withdraw-reason" name="reason" maxLength={1000} rows={2} defaultValue={state?.values?.reason ?? ""}
          aria-invalid={!!e.reason || undefined} aria-describedby={describedBy("withdraw-reason", "hint", e.reason)} className={textareaClass()} />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="confirm" value="yes" className="mt-1 h-4 w-4" />
        <span>Take this institution off the public site, including its earlier releases, until a corrected version is published.</span>
      </label>
      {e.confirm ? <p className="text-[13px] font-medium text-danger">{e.confirm[0]}</p> : null}
      <div>
        <SubmitButton variant="danger" pendingLabel="Withdrawing…">Withdraw from the public site</SubmitButton>
      </div>
    </form>
  );
}

export function ReopenForm({ revisionId }: { revisionId: string }) {
  const [state, action] = useActionState(boundAction(reopenAction, revisionId), undefined as FormState);
  const e = state?.errors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <Field id="reopen-reason" label="What needs changing" hint="The editor sees this note. The approval is cancelled." error={e.reason}>
        <textarea id="reopen-reason" name="reason" maxLength={1000} rows={2} defaultValue={state?.values?.reason ?? ""}
          aria-invalid={!!e.reason || undefined} aria-describedby={describedBy("reopen-reason", "hint", e.reason)} className={textareaClass()} />
      </Field>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Returning…">Return for changes</SubmitButton>
      </div>
    </form>
  );
}

"use client";
// Workflow buttons: start a new draft, and submit the draft for review.
import { useActionState } from "react";
import type { FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { startDraftAction, submitRevisionAction } from "../actions";
import { ActionMessage } from "./ActionMessage";

export function StartDraftForm({ institutionId, label = "Start a new draft" }: { institutionId: string; label?: string }) {
  const [state, action] = useActionState(startDraftAction.bind(null, institutionId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <ActionMessage state={state} keepsValues={false} />
      <div>
        <SubmitButton pendingLabel="Starting draft…">{label}</SubmitButton>
      </div>
    </form>
  );
}

export function SubmitRevisionForm({ revisionId, lockVersion, problemCount }: {
  revisionId: string;
  lockVersion: number;
  problemCount: number;
}) {
  const [state, action] = useActionState(submitRevisionAction.bind(null, revisionId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <ActionMessage state={state} keepsValues={false} />
      <input type="hidden" name="lock_version" value={lockVersion} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Submitting…">Submit for review</SubmitButton>
        <p className="text-[13px] text-muted">
          {problemCount > 0
            ? "The server will refuse submission until the items listed above are fixed."
            : "Submitting freezes this revision. Any later change needs a new draft."}
        </p>
      </div>
    </form>
  );
}

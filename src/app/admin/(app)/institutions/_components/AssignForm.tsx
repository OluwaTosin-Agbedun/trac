"use client";
// Assignment form for reviewers and administrators: editor, reviewer and due date. Saving replaces
// the open assignment; leaving every field empty clears it. The database re-checks the role and
// that both people are active team members in suitable roles.
import { useActionState } from "react";
import { Field, FormMessage, describedBy, inputClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { assignInstitutionAction } from "../actions";

export type AssignOption = { userId: string; displayName: string; role: string };

export function AssignForm({ institutionId, editors, reviewers, current }: {
  institutionId: string;
  /** Active editors, reviewers and administrators. */
  editors: AssignOption[];
  /** Active reviewers and administrators. */
  reviewers: AssignOption[];
  current: { editorId: string | null; reviewerId: string | null; dueOn: string | null } | null;
}) {
  const [state, action] = useActionState(assignInstitutionAction.bind(null, institutionId), undefined as FormState);
  const e = state?.errors ?? {};
  const failed = state?.ok === false;
  const editorValue = failed ? state?.values?.editor_id ?? "" : current?.editorId ?? "";
  const reviewerValue = failed ? state?.values?.reviewer_id ?? "" : current?.reviewerId ?? "";
  const dueValue = failed ? state?.values?.due_on ?? "" : current?.dueOn ?? "";

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`assign-editor-${institutionId}`} label="Editor" error={e.editor_id}>
          <select
            id={`assign-editor-${institutionId}`}
            name="editor_id"
            defaultValue={editorValue}
            aria-invalid={!!e.editor_id}
            aria-describedby={describedBy(`assign-editor-${institutionId}`, undefined, e.editor_id)}
            className={inputClass()}
          >
            <option value="">No editor</option>
            {withCurrent(editors, editorValue).map((m) => (
              <option key={m.userId} value={m.userId}>{optionLabel(m)}</option>
            ))}
          </select>
        </Field>
        <Field id={`assign-reviewer-${institutionId}`} label="Reviewer" error={e.reviewer_id}>
          <select
            id={`assign-reviewer-${institutionId}`}
            name="reviewer_id"
            defaultValue={reviewerValue}
            aria-invalid={!!e.reviewer_id}
            aria-describedby={describedBy(`assign-reviewer-${institutionId}`, undefined, e.reviewer_id)}
            className={inputClass()}
          >
            <option value="">No reviewer</option>
            {withCurrent(reviewers, reviewerValue).map((m) => (
              <option key={m.userId} value={m.userId}>{optionLabel(m)}</option>
            ))}
          </select>
        </Field>
        <Field id={`assign-due-${institutionId}`} label="Due date (optional)" error={e.due_on}>
          <input
            id={`assign-due-${institutionId}`}
            name="due_on"
            type="date"
            min="2000-01-01"
            max="2100-12-31"
            defaultValue={dueValue}
            aria-invalid={!!e.due_on}
            aria-describedby={describedBy(`assign-due-${institutionId}`, undefined, e.due_on)}
            className={inputClass()}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton variant="secondary" pendingLabel="Saving assignment…">Save assignment</SubmitButton>
        <p className="text-[13px] text-muted">The editor and the reviewer must be different people.</p>
      </div>
    </form>
  );
}

const ROLE_SHORT: Record<string, string> = {
  editor: "editor", reviewer: "reviewer", admin: "administrator", inactive: "inactive, choose someone else",
};

function optionLabel(m: AssignOption) {
  const role = ROLE_SHORT[m.role];
  return role ? `${m.displayName} (${role})` : m.displayName;
}

/** Keeps a currently assigned person visible even if they are no longer in the active list. */
function withCurrent(options: AssignOption[], currentId: string): AssignOption[] {
  if (!currentId || options.some((o) => o.userId === currentId)) return options;
  return [...options, { userId: currentId, displayName: "Current assignee", role: "inactive" }];
}

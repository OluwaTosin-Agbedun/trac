"use client";
import { useActionState } from "react";
import { Field, FormMessage, inputClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { clearLockAction, inviteAction, revokeInviteAction, updateMemberAction, type InviteState } from "../actions";
import { boundAction } from "@/lib/boundAction";

const ROLE_LABEL = { editor: "Data editor", reviewer: "Reviewer and publisher", admin: "Administrator" } as const;

export function InviteForm() {
  const [state, action] = useActionState(inviteAction, undefined as InviteState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {state?.link ? (
        <div className="flex flex-col gap-1.5 rounded border border-[#b7dcc5] bg-ok-bg p-3">
          <label htmlFor="invite-link" className="text-[13px] font-semibold text-ok">One-time invitation link</label>
          <input id="invite-link" readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} className={inputClass("font-mono text-[13px]")} />
          <p className="text-[12px] text-ok">Send it to the person directly. Email delivery is not configured yet.</p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field id="invite-email" label="Email address" error={state?.errors?.email}>
          <input id="invite-email" name="email" type="email" required defaultValue={state?.link ? "" : state?.values?.email ?? ""} className={inputClass()} />
        </Field>
        <Field id="invite-role" label="Role" error={state?.errors?.role}>
          <select id="invite-role" name="role" defaultValue={state?.values?.role ?? "editor"} className={inputClass()}>
            {(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Creating invitation…">Create invitation link</SubmitButton>
      </div>
    </form>
  );
}

export function RevokeInviteForm({ inviteId }: { inviteId: string }) {
  const [state, action] = useActionState(boundAction(revokeInviteAction, inviteId), undefined as FormState);
  return (
    <form action={action} className="flex items-center gap-2">
      <SubmitButton variant="quiet" pendingLabel="Revoking…">Revoke</SubmitButton>
      {state?.message ? <span role="status" className={`text-[13px] ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</span> : null}
    </form>
  );
}

export function ClearLockForm({ userId }: { userId: string }) {
  const [state, action] = useActionState(boundAction(clearLockAction, userId), undefined as FormState);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <SubmitButton variant="quiet" pendingLabel="Clearing…">Clear sign-in lock</SubmitButton>
      {state?.message ? <span role="status" className={`text-[13px] ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</span> : null}
    </form>
  );
}

export function MemberForm({ userId, role, active, self }: { userId: string; role: string; active: boolean; self: boolean }) {
  const [state, action] = useActionState(boundAction(updateMemberAction, userId), undefined as FormState);
  if (self) return <span className="text-[13px] text-muted">You cannot change your own access.</span>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
        Role
        <select name="role" defaultValue={role} className={inputClass("min-w-[190px]")}>
          {(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
        Access
        <select name="active" defaultValue={String(active)} className={inputClass("min-w-[130px]")}>
          <option value="true">Active</option>
          <option value="false">Deactivated</option>
        </select>
      </label>
      <SubmitButton variant="secondary" pendingLabel="Saving…">Save</SubmitButton>
      {state?.message ? <span role="status" className={`text-[13px] ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</span> : null}
    </form>
  );
}

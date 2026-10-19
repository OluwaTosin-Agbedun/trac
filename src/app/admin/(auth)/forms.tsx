"use client";
import { useActionState } from "react";
import { Field, FormMessage, describedBy, inputClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { acceptInviteAction, setupAction, signInAction } from "../auth-actions";

export function SignInForm() {
  const [state, action] = useActionState(signInAction, undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="email" label="Email address">
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.values?.email ?? ""} className={inputClass()} />
      </Field>
      <Field id="password" label="Password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass()} />
      </Field>
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

export function SetupForm({ needsToken }: { needsToken: boolean }) {
  const [state, action] = useActionState(setupAction, undefined as FormState);
  const e = state?.errors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {needsToken ? (
        <Field id="setupToken" label="Setup token" hint="The SETUP_TOKEN value set on the server for this deployment. It proves you are the person who deployed the site." error={e.setupToken}>
          <input id="setupToken" name="setupToken" type="password" autoComplete="off" required
            aria-describedby={describedBy("setupToken", "hint", e.setupToken)} className={inputClass()} />
        </Field>
      ) : null}
      <Field id="displayName" label="Your name" error={e.displayName}>
        <input id="displayName" name="displayName" autoComplete="name" required defaultValue={state?.values?.displayName ?? ""}
          aria-invalid={!!e.displayName} aria-describedby={describedBy("displayName", undefined, e.displayName)} className={inputClass()} />
      </Field>
      <Field id="email" label="Email address" error={e.email}>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.values?.email ?? ""}
          aria-invalid={!!e.email} aria-describedby={describedBy("email", undefined, e.email)} className={inputClass()} />
      </Field>
      <Field id="password" label="Password" hint="At least 12 characters. A short phrase is easier to remember." error={e.password}>
        <input id="password" name="password" type="password" autoComplete="new-password" required
          aria-invalid={!!e.password} aria-describedby={describedBy("password", "hint", e.password)} className={inputClass()} />
      </Field>
      <Field id="confirm" label="Confirm password" error={e.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required
          aria-invalid={!!e.confirm} aria-describedby={describedBy("confirm", undefined, e.confirm)} className={inputClass()} />
      </Field>
      <SubmitButton pendingLabel="Creating account…">Create owner account</SubmitButton>
    </form>
  );
}

export function InviteForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState(acceptInviteAction.bind(null, token), undefined as FormState);
  const e = state?.errors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="email" label="Email address">
        <input id="email" value={email} readOnly className={inputClass("bg-surface")} />
      </Field>
      <Field id="displayName" label="Your name" error={e.displayName}>
        <input id="displayName" name="displayName" autoComplete="name" required defaultValue={state?.values?.displayName ?? ""}
          aria-invalid={!!e.displayName} className={inputClass()} />
      </Field>
      <Field id="password" label="Choose a password" hint="At least 12 characters." error={e.password}>
        <input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!e.password} className={inputClass()} />
      </Field>
      <Field id="confirm" label="Confirm password" error={e.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={!!e.confirm} className={inputClass()} />
      </Field>
      <SubmitButton pendingLabel="Creating account…">Join the team</SubmitButton>
    </form>
  );
}

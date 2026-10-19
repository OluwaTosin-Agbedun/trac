"use client";
// Profile fields of the draft revision. Read-only (disabled) unless the revision is a draft.
import { useActionState } from "react";
import { Field, describedBy, inputClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  INSTITUTION_TYPES, INSTITUTION_TYPE_LABEL, NIGERIAN_STATES, OWNERSHIP, OWNERSHIP_LABEL,
} from "@/lib/indicators";
import type { EditorProfile } from "@/server/data/cms/editor";
import { saveProfileAction } from "../actions";
import { ActionMessage } from "./ActionMessage";
import { toDateInput } from "@/lib/editorRules";

type Key = keyof EditorProfile;

export function ProfileForm({ revisionId, lockVersion, profile, editable, lastVerifiedAt, today }: {
  revisionId: string;
  lockVersion: number;
  profile: EditorProfile;
  editable: boolean;
  /** When a person last checked the sources (ISO timestamp), or null. */
  lastVerifiedAt: string | null;
  /** Today's date in Lagos (yyyy-mm-dd), the latest allowed verification date. */
  today: string;
}) {
  const [state, action] = useActionState(saveProfileAction.bind(null, revisionId), undefined as FormState);
  const e = state?.errors ?? {};
  const v = (k: Key) => state?.values?.[k] ?? profile[k] ?? "";
  const recordedState = profile.state?.trim() || "";
  const stateOutsideList = recordedState !== "" && !(NIGERIAN_STATES as readonly string[]).includes(recordedState);

  const text = (k: Key, label: string, opts: { hint?: string; required?: boolean; type?: string; max?: number; autoComplete?: string } = {}) => {
    const id = `profile-${k}`;
    return (
      <Field id={id} label={label} hint={opts.hint} error={e[k]}>
        <input
          id={id}
          name={k}
          type={opts.type ?? "text"}
          required={opts.required}
          maxLength={opts.max ?? 200}
          autoComplete={opts.autoComplete ?? "off"}
          defaultValue={v(k)}
          aria-invalid={!!e[k] || undefined}
          aria-describedby={describedBy(id, opts.hint, e[k])}
          className={inputClass()}
        />
      </Field>
    );
  };

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <ActionMessage state={state} />
      <input type="hidden" name="lock_version" value={lockVersion} />
      <fieldset disabled={!editable} className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="sr-only">Institution profile</legend>
        <div className="sm:col-span-2">{text("name", "Name", { required: true, max: 300, hint: "The full official name, as the institution writes it." })}</div>
        {text("short_name", "Short name or acronym", { max: 80 })}
        <Field id="profile-ownership" label="Ownership" error={e.ownership}>
          <select id="profile-ownership" name="ownership" defaultValue={v("ownership") || "unknown"}
            aria-invalid={!!e.ownership || undefined} aria-describedby={describedBy("profile-ownership", undefined, e.ownership)} className={inputClass()}>
            {OWNERSHIP.map((o) => <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>)}
          </select>
        </Field>
        <Field id="profile-institution_type" label="Institution type" error={e.institution_type}>
          <select id="profile-institution_type" name="institution_type" defaultValue={v("institution_type") || "other"}
            aria-invalid={!!e.institution_type || undefined} aria-describedby={describedBy("profile-institution_type", undefined, e.institution_type)} className={inputClass()}>
            {INSTITUTION_TYPES.map((t) => <option key={t} value={t}>{INSTITUTION_TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field id="profile-state" label="State" hint={stateOutsideList ? `The recorded value "${recordedState}" is not a state name. Keep it, or choose the correct state.` : undefined} error={e.state}>
          <select id="profile-state" name="state" defaultValue={v("state")}
            aria-invalid={!!e.state || undefined}
            aria-describedby={describedBy("profile-state", stateOutsideList ? "hint" : undefined, e.state)} className={inputClass()}>
            <option value="">Not recorded</option>
            {stateOutsideList ? <option value={recordedState}>{recordedState} (as recorded, needs confirming)</option> : null}
            {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        {text("city", "City or town")}
        {text("head_name", "Head of institution", { hint: "Name as published by the institution." })}
        {text("head_title", "Head's title", { hint: "For example Vice-Chancellor, Rector or Provost." })}
        {text("bursar_name", "Bursar")}
        {text("website_url", "Official website", { type: "url", max: 2000, hint: "Must start with https:// or http://." })}
        <div className="sm:col-span-2">{text("assessment_period", "Assessment period", { max: 80, hint: "The period this assessment covers, e.g. FY 2025. Shown publicly." })}</div>
        <div className="sm:col-span-2">
          <Field id="profile-last_verified_on" label="Sources last checked by a person" error={e.last_verified_on}
            hint="The date a team member last checked the official sources for this revision. Shown publicly as the human verification date. A scan never changes it.">
            <input id="profile-last_verified_on" name="last_verified_on" type="date" max={today}
              defaultValue={state?.values?.last_verified_on ?? toDateInput(lastVerifiedAt)}
              aria-invalid={!!e.last_verified_on || undefined}
              aria-describedby={describedBy("profile-last_verified_on", "hint", e.last_verified_on)} className={inputClass("sm:max-w-xs")} />
          </Field>
        </div>
      </fieldset>
      {editable ? (
        <div>
          <SubmitButton pendingLabel="Saving profile…">Save profile</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

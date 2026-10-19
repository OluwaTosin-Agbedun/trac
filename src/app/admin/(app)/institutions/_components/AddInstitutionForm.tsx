"use client";
// "Add institution": name, slug, ownership and type. Creates revision 1 as a private draft and
// opens it in the editor. The slug is suggested from the name until the user edits it.
import { useActionState, useRef } from "react";
import { Field, FormMessage, describedBy, inputClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INSTITUTION_TYPES, INSTITUTION_TYPE_LABEL, OWNERSHIP, OWNERSHIP_LABEL } from "@/lib/indicators";
import { SLUG_MAX, suggestSlug } from "@/lib/cmsDirectory";
import { createInstitutionAction } from "../actions";

const SLUG_HINT = `Used in the public web address, /institutions/your-slug. Lower-case letters, numbers and single hyphens, at most ${SLUG_MAX} characters. Choose carefully: published links depend on it.`;

export function AddInstitutionForm() {
  const [state, action] = useActionState(createInstitutionAction, undefined as FormState);
  const e = state?.errors ?? {};
  const v = state?.values ?? {};
  const slugRef = useRef<HTMLInputElement>(null);
  // True once the user types their own slug; clearing the field hands it back to the suggestion.
  const slugEdited = useRef(false);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />

      <div className="grid gap-5 md:grid-cols-2">
        <Field id="add-name" label="Institution name" hint="The full official name, as the institution writes it." error={e.name}>
          <input
            id="add-name"
            name="name"
            required
            maxLength={200}
            autoComplete="off"
            defaultValue={v.name ?? ""}
            aria-invalid={!!e.name}
            aria-describedby={describedBy("add-name", "hint", e.name)}
            onChange={(ev) => {
              if (!slugEdited.current && slugRef.current) slugRef.current.value = suggestSlug(ev.currentTarget.value);
            }}
            className={inputClass()}
          />
        </Field>

        <Field id="add-slug" label="Slug" hint={SLUG_HINT} error={e.slug}>
          <input
            id="add-slug"
            ref={slugRef}
            name="slug"
            required
            maxLength={SLUG_MAX}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            defaultValue={v.slug ?? ""}
            aria-invalid={!!e.slug}
            aria-describedby={describedBy("add-slug", "hint", e.slug)}
            onChange={(ev) => {
              slugEdited.current = ev.currentTarget.value.trim() !== "";
            }}
            className={inputClass("font-mono text-[14px]")}
          />
        </Field>

        <Field id="add-ownership" label="Ownership" error={e.ownership}>
          <select
            id="add-ownership"
            name="ownership"
            required
            defaultValue={v.ownership ?? ""}
            aria-invalid={!!e.ownership}
            aria-describedby={describedBy("add-ownership", undefined, e.ownership)}
            className={inputClass()}
          >
            <option value="" disabled>Choose ownership</option>
            {OWNERSHIP.map((o) => (
              <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>
            ))}
          </select>
        </Field>

        <Field id="add-type" label="Institution type" error={e.type}>
          <select
            id="add-type"
            name="type"
            required
            defaultValue={v.type ?? ""}
            aria-invalid={!!e.type}
            aria-describedby={describedBy("add-type", undefined, e.type)}
            className={inputClass()}
          >
            <option value="" disabled>Choose type</option>
            {INSTITUTION_TYPES.map((t) => (
              <option key={t} value={t}>{INSTITUTION_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
      </div>

      {e.duplicate ? (
        <div className="rounded-md border border-warn-rule bg-warn-bg px-4 py-3">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-warn-text">
            <input type="checkbox" name="confirm_duplicate" value="yes" className="mt-1 size-5 shrink-0" aria-describedby="add-duplicate-hint" />
            <span>
              <span className="font-semibold">This is a different institution with the same name.</span>
              <span id="add-duplicate-hint" className="mt-1 block">{e.duplicate[0]}</span>
            </span>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton pendingLabel="Creating draft…">Create draft institution</SubmitButton>
        <p className="text-[13px] text-muted">
          This starts revision 1 as a private draft with all nine indicators not yet assessed. Nothing is public until it is
          reviewed, approved and published.
        </p>
      </div>
    </form>
  );
}

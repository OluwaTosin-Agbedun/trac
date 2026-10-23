"use client";
// Adding and removing evidence on a draft. Each change bumps the revision's lock version.
import { useActionState } from "react";
import { Field, describedBy, inputClass, textareaClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { INDICATORS } from "@/lib/indicators";
import { addEvidenceAction, removeEvidenceAction } from "../actions";
import { ActionMessage } from "./ActionMessage";
import { boundAction } from "@/lib/boundAction";

export function AddEvidenceForm({ revisionId, lockVersion, defaultIndicator, idPrefix, today }: {
  revisionId: string;
  lockVersion: number;
  /** Indicator key, or "general" for profile evidence. */
  defaultIndicator: string;
  idPrefix: string;
  /** Today's Lagos date (yyyy-mm-dd), computed on the server. */
  today: string;
}) {
  const [state, action] = useActionState(boundAction(addEvidenceAction, revisionId), undefined as FormState);
  const e = state?.errors ?? {};
  const v = (k: string, fallback = "") => state?.values?.[k] ?? fallback;
  const id = (k: string) => `${idPrefix}-ev-${k}`;
  const aria = (k: string, hint?: string) => ({
    "aria-invalid": !!e[k] || undefined,
    "aria-describedby": describedBy(id(k), hint, e[k]),
  });
  const isPublic = state?.values ? state.values.is_public === "on" : true;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate aria-label="Add evidence">
      <ActionMessage state={state} />
      <input type="hidden" name="lock_version" value={lockVersion} />
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field id={id("indicator_key")} label="Evidence for" error={e.indicator_key}>
          <select id={id("indicator_key")} name="indicator_key" defaultValue={v("indicator_key", defaultIndicator) || "general"}
            {...aria("indicator_key")} className={inputClass()}>
            <option value="general">General profile evidence (no indicator)</option>
            {INDICATORS.map((i) => <option key={i.key} value={i.key}>{i.group}: {i.label}</option>)}
          </select>
        </Field>
        <Field id={id("url")} label="Source address (URL)" hint="The official page or document, starting with https:// or http://." error={e.url}>
          <input id={id("url")} name="url" type="url" inputMode="url" required maxLength={2000} autoComplete="off"
            defaultValue={v("url")} {...aria("url", "hint")} className={inputClass()} />
        </Field>
        <div className="sm:col-span-2">
          <Field id={id("title")} label="Title (optional)" hint="The document or page title as shown at the source." error={e.title}>
            <input id={id("title")} name="title" maxLength={300} autoComplete="off" defaultValue={v("title")} {...aria("title", "hint")} className={inputClass()} />
          </Field>
        </div>
        <Field id={id("locator")} label="Locator" hint="Where in the source: page, table or section, e.g. p. 3, table 1." error={e.locator}>
          <input id={id("locator")} name="locator" maxLength={300} autoComplete="off" defaultValue={v("locator")} {...aria("locator", "hint")} className={inputClass()} />
        </Field>
        <Field id={id("document_period")} label="Document period (optional)" hint="The period the document covers, e.g. 2024/2025." error={e.document_period}>
          <input id={id("document_period")} name="document_period" maxLength={80} autoComplete="off" defaultValue={v("document_period")}
            {...aria("document_period", "hint")} className={inputClass()} />
        </Field>
        <div className="sm:col-span-2">
          <Field id={id("excerpt")} label="Excerpt" hint="The exact words or figures from the source. A locator or an excerpt is needed for a published indicator." error={e.excerpt}>
            <textarea id={id("excerpt")} name="excerpt" maxLength={2000} rows={3} defaultValue={v("excerpt")} {...aria("excerpt", "hint")} className={textareaClass()} />
          </Field>
        </div>
        <Field id={id("source_published_on")} label="Source published on (optional)" hint="Only if the source states its own date." error={e.source_published_on}>
          <input id={id("source_published_on")} name="source_published_on" type="date" defaultValue={v("source_published_on")}
            {...aria("source_published_on", "hint")} className={inputClass()} />
        </Field>
        <Field id={id("captured_on")} label="Captured on" hint="The date you viewed or saved the source." error={e.captured_on}>
          <input id={id("captured_on")} name="captured_on" type="date" required max={today} defaultValue={v("captured_on", today)}
            {...aria("captured_on", "hint")} className={inputClass()} />
        </Field>
      </div>
      <div className="flex min-h-11 items-start gap-3">
        <input id={id("is_public")} name="is_public" type="checkbox" defaultChecked={isPublic}
          aria-describedby={`${id("is_public")}-hint`} className="mt-1 size-5 shrink-0 accent-accent" />
        <div>
          <label htmlFor={id("is_public")} className="text-sm font-semibold text-ink">Public evidence</label>
          <p id={`${id("is_public")}-hint`} className="text-[13px] text-muted">
            Shown on the public page once this revision is published. Untick to keep it private to the team.
          </p>
        </div>
      </div>
      <div>
        <SubmitButton pendingLabel="Adding evidence…" variant="secondary">Add evidence</SubmitButton>
      </div>
    </form>
  );
}

export function RemoveEvidenceForm({ revisionId, lockVersion, evidenceId, label }: {
  revisionId: string;
  lockVersion: number;
  evidenceId: string;
  label: string;
}) {
  const [state, action] = useActionState(boundAction(removeEvidenceAction, revisionId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="lock_version" value={lockVersion} />
      <input type="hidden" name="evidence_id" value={evidenceId} />
      <div>
        <SubmitButton variant="danger" pendingLabel="Removing…">
          Remove<span className="sr-only"> evidence: {label}</span>
        </SubmitButton>
      </div>
      {state?.message && !state.ok ? <ActionMessage state={state} keepsValues={false} /> : null}
    </form>
  );
}

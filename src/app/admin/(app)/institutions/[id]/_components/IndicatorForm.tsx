"use client";
// One indicator's assessment in the draft: state, reporting period, optional value, public reason
// and private note. Saves with its own form and the revision's lock version.
import { useActionState } from "react";
import { Field, describedBy, inputClass, textareaClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  ASSESSMENT_STATES, PERIOD_TYPES, PERIOD_TYPE_LABEL, STATE_LABEL, VALUE_SCALES, type ValueScale,
} from "@/lib/indicators";
import type { EditorIndicator } from "@/server/data/cms/editor";
import { saveIndicatorAction } from "../actions";
import { ActionMessage } from "./ActionMessage";
import { boundAction } from "@/lib/boundAction";

const SCALE_LABEL: Record<ValueScale, string> = {
  units: "Units (amount written in full)",
  thousands: "Thousands",
  millions: "Millions",
  billions: "Billions",
};

type Key = Exclude<keyof EditorIndicator, "key">;

export function IndicatorForm({ revisionId, lockVersion, indicator, kind, label, editable }: {
  revisionId: string;
  lockVersion: number;
  indicator: EditorIndicator;
  kind: "money" | "count";
  label: string;
  editable: boolean;
}) {
  const [state, action] = useActionState(boundAction(saveIndicatorAction, revisionId, indicator.key), undefined as FormState);
  const e = state?.errors ?? {};
  const v = (k: Key): string => {
    const typed = state?.values?.[k];
    if (typed !== undefined) return typed;
    const stored = indicator[k];
    return stored === null || stored === undefined ? "" : String(stored);
  };
  const id = (k: string) => `${indicator.key}-${k}`;
  const aria = (k: Key, hint?: string) => ({
    "aria-invalid": !!e[k] || undefined,
    "aria-describedby": describedBy(id(k), hint, e[k]),
  });

  const stateHint = "Published needs a reporting period and at least one evidence item with a locator or excerpt. Not found means a person reviewed the recorded sources and did not find it.";
  const periodHint = "As written in the source, e.g. 2025 or 2024/2025. Keep sessions and multi-year documents as they are.";
  const reasonHint = "Shown on the public page. Required for not applicable; recommended for not found and uncertain.";
  const noteHint = "Private to the team. Never published.";

  return (
    <form action={action} className="flex flex-col gap-4" noValidate aria-label={`Assessment: ${label}`}>
      <ActionMessage state={state} />
      <input type="hidden" name="lock_version" value={lockVersion} />
      <fieldset disabled={!editable} className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="sr-only">Assessment of {label}</legend>
        <div className="sm:col-span-2">
          <Field id={id("state")} label="Assessment" hint={stateHint} error={e.state}>
            <select id={id("state")} name="state" defaultValue={v("state") || "not_assessed"} {...aria("state", stateHint)} className={inputClass()}>
              {ASSESSMENT_STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
            </select>
          </Field>
        </div>
        <Field id={id("period_type")} label="Period type" error={e.period_type}>
          <select id={id("period_type")} name="period_type" defaultValue={v("period_type")} {...aria("period_type")} className={inputClass()}>
            <option value="">Not stated</option>
            {PERIOD_TYPES.map((p) => <option key={p} value={p}>{PERIOD_TYPE_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field id={id("period_label")} label="Period label" hint={periodHint} error={e.period_label}>
          <input id={id("period_label")} name="period_label" maxLength={80} autoComplete="off" defaultValue={v("period_label")}
            {...aria("period_label", periodHint)} className={inputClass()} />
        </Field>
        <Field id={id("period_start")} label="Period start (optional)" error={e.period_start}>
          <input id={id("period_start")} name="period_start" type="date" defaultValue={v("period_start")} {...aria("period_start")} className={inputClass()} />
        </Field>
        <Field id={id("period_end")} label="Period end (optional)" error={e.period_end}>
          <input id={id("period_end")} name="period_end" type="date" defaultValue={v("period_end")} {...aria("period_end")} className={inputClass()} />
        </Field>

        {kind === "money" ? (
          <>
            <Field id={id("value_amount")} label="Amount (optional)" hint="Digits only, e.g. 4250.5. Leave empty if no figure is stated; a stated zero is 0." error={e.value_amount}>
              <input id={id("value_amount")} name="value_amount" inputMode="decimal" maxLength={40} autoComplete="off" defaultValue={v("value_amount")}
                {...aria("value_amount", "hint")} className={inputClass()} />
            </Field>
            <Field id={id("value_scale")} label="Scale" hint="Required with an amount." error={e.value_scale}>
              <select id={id("value_scale")} name="value_scale" defaultValue={v("value_scale")} {...aria("value_scale", "hint")} className={inputClass()}>
                <option value="">Not stated</option>
                {VALUE_SCALES.map((s) => <option key={s} value={s}>{SCALE_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field id={id("value_currency")} label="Currency" hint="Three-letter code. NGN unless the source says otherwise." error={e.value_currency}>
              <input id={id("value_currency")} name="value_currency" maxLength={3} autoComplete="off" defaultValue={v("value_currency") || "NGN"}
                {...aria("value_currency", "hint")} className={inputClass("uppercase")} />
            </Field>
          </>
        ) : (
          <Field id={id("value_count")} label="Number of students (optional)" hint="A whole number, 0 or more. Leave empty if not stated." error={e.value_count}>
            <input id={id("value_count")} name="value_count" inputMode="numeric" maxLength={14} autoComplete="off" defaultValue={v("value_count")}
              {...aria("value_count", "hint")} className={inputClass()} />
          </Field>
        )}
        <Field id={id("value_literal")} label="Figure as printed (optional)" hint="Exactly as the source prints it, e.g. ₦4,250.5m." error={e.value_literal}>
          <input id={id("value_literal")} name="value_literal" maxLength={200} autoComplete="off" defaultValue={v("value_literal")}
            {...aria("value_literal", "hint")} className={inputClass()} />
        </Field>

        <div className="sm:col-span-2">
          <Field id={id("reason")} label="Public reason" hint={reasonHint} error={e.reason}>
            <textarea id={id("reason")} name="reason" maxLength={2000} rows={3} defaultValue={v("reason")}
              {...aria("reason", reasonHint)} className={textareaClass()} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id={id("internal_note")} label="Internal note (private)" hint={noteHint} error={e.internal_note}>
            <textarea id={id("internal_note")} name="internal_note" maxLength={4000} rows={2} defaultValue={v("internal_note")}
              {...aria("internal_note", noteHint)} className={textareaClass("bg-surface-2")} />
          </Field>
        </div>
      </fieldset>
      {editable ? (
        <div>
          <SubmitButton pendingLabel="Saving…">
            Save indicator<span className="sr-only">: {label}</span>
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

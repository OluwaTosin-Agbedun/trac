"use client";
import { useActionState, useState } from "react";
import { Field, FormMessage, inputClass, textareaClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { commitImportAction, decideRowAction, hideReportAction, showReportAction, stageImportAction } from "../actions";
import { boundAction } from "@/lib/boundAction";

export function UploadForm() {
  const [state, action] = useActionState(stageImportAction, undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="file" label="Tracker spreadsheet" hint="Excel workbook (.xlsx), CSV, or tab-separated text (.tsv/.txt). Up to 3 MB. Excel files keep the real web addresses behind linked cells." error={state?.errors?.file}>
        <input id="file" name="file" type="file" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,text/plain" required
          className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded file:border file:border-accent file:bg-white file:px-4 file:text-sm file:font-semibold file:text-accent" />
      </Field>
      <div>
        <SubmitButton pendingLabel="Uploading and checking…">Upload and preview</SubmitButton>
      </div>
    </form>
  );
}

export function CommitForm({ importId, ready }: { importId: string; ready: number }) {
  const [state, action] = useActionState(boundAction(commitImportAction, importId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Committing…">Commit safe rows{ready ? ` (${ready} ready)` : ""}</SubmitButton>
      </div>
    </form>
  );
}

export function DecisionForm({ importId, rowId, unnamed, options, suggested = null }: {
  importId: string; rowId: string; unnamed: boolean; options: { id: string; name: string }[];
  /** An existing institution with the same name: offered first and preselected. */
  suggested?: { id: string; name: string } | null;
}) {
  const [state, action] = useActionState(boundAction(decideRowAction, importId, rowId), undefined as FormState);
  const [decision, setDecision] = useState(unnamed || suggested ? "match_existing" : "create_new");
  const choices = suggested ? [suggested, ...options.filter((o) => o.id !== suggested.id)] : options;
  return (
    <form action={action} className="flex flex-col gap-3 rounded border border-rule-soft bg-surface p-3">
      <FormMessage state={state} />
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2 border-0 p-0 text-sm">
        <legend className="sr-only">Decision for this row</legend>
        <label className={`flex min-h-11 items-center gap-2 ${unnamed ? "opacity-60" : ""}`}>
          <input type="radio" name="decision" value="create_new" checked={decision === "create_new"} disabled={unnamed}
            onChange={() => setDecision("create_new")} className="h-4 w-4" />
          {suggested ? "Create a separate new institution" : "Create as a new institution"}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="decision" value="match_existing" checked={decision === "match_existing"}
            onChange={() => setDecision("match_existing")} className="h-4 w-4" />
          Match to an existing institution
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="decision" value="skip" checked={decision === "skip"} onChange={() => setDecision("skip")} className="h-4 w-4" />
          Skip
        </label>
      </fieldset>
      {unnamed ? <p className="text-[12px] text-muted">This row has no name, so it cannot create an institution. Identify it, add the institution by hand, then match this row to it.</p> : null}
      {decision === "match_existing" ? (
        <Field id={`inst-${rowId}`} label="Existing institution"
          hint={suggested ? "The institution with the same name is listed first. Search above to list others." : choices.length ? undefined : "Search above by name to list institutions to match."}>
          <select id={`inst-${rowId}`} name="institution_id" className={inputClass()} defaultValue={suggested?.id ?? ""}>
            <option value="" disabled>Choose…</option>
            {choices.map((o) => <option key={o.id} value={o.id}>{o.id === suggested?.id ? `${o.name} (same name)` : o.name}</option>)}
          </select>
        </Field>
      ) : null}
      {decision !== "create_new" ? (
        <Field id={`note-${rowId}`} label="Reason (required)">
          {/* Keyed by decision so a suggested reason for matching is not carried over to a skip. */}
          <textarea key={decision} id={`note-${rowId}`} name="note" rows={2} maxLength={1000} required className={textareaClass()}
            defaultValue={suggested && decision === "match_existing" ? "Same institution: the name matches the existing record." : undefined} />
        </Field>
      ) : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving decision…">Save decision</SubmitButton>
      </div>
    </form>
  );
}

export function ReportForm({ importId, shown }: { importId: string; shown: boolean }) {
  const [state, action] = useActionState(shown ? hideReportAction : boundAction(showReportAction, importId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={shown ? "secondary" : "primary"} pendingLabel={shown ? "Hiding…" : "Adding…"}>
          {shown ? "Hide the report from the public site" : "Add these institutions to the register"}
        </SubmitButton>
      </div>
    </form>
  );
}

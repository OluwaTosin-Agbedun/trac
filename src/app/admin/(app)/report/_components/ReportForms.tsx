"use client";
// Forms for the verified register. Every button that calls a server action is the shared
// SubmitButton (spinner, disabled while pending). Bound actions use boundAction (one binding per
// record) so a form posted before the page has loaded cannot make the server loop.
import { useActionState } from "react";
import { Field, FormMessage, inputClass, textareaClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { boundAction } from "@/lib/boundAction";
import { INDICATORS, NIGERIAN_STATES } from "@/lib/indicators";
import { REPORT_SECTIONS, type ReportSection } from "@/lib/report";
import { ASSESSMENT_STATUSES, type Assessment } from "@/lib/register";
import {
  checkBatchAction, checkLinksAction, deleteEntryAction, returnEntryAction, saveEntryAction, saveSettingsAction, verifyEntryAction,
} from "../actions";

export interface EntryValues {
  section: ReportSection;
  name: string;
  state: string | null;
  head: string | null;
  bursar: string | null;
  homepageUrl: string | null;
  disclosureUrl: string | null;
  extraLinks: { label: string; url: string }[];
  assessments: Record<string, Assessment>;
  trackerClaims: Record<string, boolean | null>;
  websiteText: string | null;
}

const GROUPS = INDICATORS.reduce<{ group: string; items: (typeof INDICATORS)[number][] }[]>((acc, ind) => {
  const last = acc[acc.length - 1];
  if (last && last.group === ind.group) last.items.push(ind);
  else acc.push({ group: ind.group, items: [ind] });
  return acc;
}, []);

const claimText = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : "blank");

export function EntryForm({ entryId, initial, formKey, today }: { entryId: string | null; initial: EntryValues; formKey: string; today: string }) {
  const [state, action] = useActionState(boundAction(saveEntryAction, entryId), undefined as FormState);
  const v = state?.ok === false && state.values ? state.values : null;
  const stateOptions = initial.state && !(NIGERIAN_STATES as readonly string[]).includes(initial.state)
    ? [initial.state, ...NIGERIAN_STATES] : [...NIGERIAN_STATES];
  const id = formKey;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <fieldset className="grid gap-4 border-0 p-0 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink-strong">Institution</legend>
        <Field id={`${id}-name`} label="Name">
          <input id={`${id}-name`} name="name" required maxLength={300} defaultValue={v?.name ?? initial.name} className={inputClass()} />
        </Field>
        <Field id={`${id}-section`} label="Category">
          <select id={`${id}-section`} name="section" defaultValue={v?.section ?? initial.section} className={inputClass()}>
            {REPORT_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field id={`${id}-state`} label="State">
          <select id={`${id}-state`} name="state" defaultValue={v?.state ?? initial.state ?? ""} className={inputClass()}>
            <option value="">Not recorded</option>
            {stateOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field id={`${id}-head`} label="Vice-Chancellor / Rector / Provost">
          <input id={`${id}-head`} name="head_name" maxLength={200} defaultValue={v?.head_name ?? initial.head ?? ""} className={inputClass()} />
        </Field>
        <Field id={`${id}-bursar`} label="Bursar">
          <input id={`${id}-bursar`} name="bursar_name" maxLength={200} defaultValue={v?.bursar_name ?? initial.bursar ?? ""} className={inputClass()} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-0 p-0 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink-strong">Official sources</legend>
        <Field id={`${id}-home`} label="Homepage" hint="The institution's own website, e.g. https://www.unn.edu.ng/">
          <input id={`${id}-home`} name="homepage_url" type="url" maxLength={500} placeholder="https://" defaultValue={v?.homepage_url ?? initial.homepageUrl ?? ""} className={inputClass()} />
        </Field>
        <Field id={`${id}-disc`} label="Disclosure page (the evidence)"
          hint={initial.websiteText && !initial.disclosureUrl && !initial.homepageUrl ? `The spreadsheet said: “${initial.websiteText.slice(0, 120)}”` : "The page that shows the disclosed information, not the homepage."}>
          <input id={`${id}-disc`} name="disclosure_url" type="url" maxLength={500} placeholder="https://" defaultValue={v?.disclosure_url ?? initial.disclosureUrl ?? ""} className={inputClass()} />
        </Field>
        <div className="md:col-span-2">
          <p className="mb-1.5 text-[13px] font-semibold text-ink">Extra documents (optional)</p>
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <input aria-label={`Document ${i + 1} title`} name={`extra_label_${i}`} maxLength={120} placeholder="Title, e.g. 2025 budget"
                  defaultValue={initial.extraLinks[i]?.label ?? ""} className={inputClass()} />
                <input aria-label={`Document ${i + 1} address`} name={`extra_url_${i}`} type="url" maxLength={500} placeholder="https://"
                  defaultValue={initial.extraLinks[i]?.url ?? ""} className={inputClass()} />
              </div>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-md border border-rule-soft bg-surface p-4">
        <legend className="px-1 text-sm font-semibold text-ink-strong">Indicators</legend>
        <Field id={`${id}-checked`} label="Date you checked the sources" hint="Used for every assessed indicator that has no date of its own.">
          <input id={`${id}-checked`} name="checked_all" type="date" max={today} defaultValue={v?.checked_all ?? ""} className={inputClass("w-auto")} />
        </Field>
        {GROUPS.map((g) => (
          <div key={g.group} className="flex flex-col gap-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">{g.group}</p>
            {g.items.map((d) => {
              const a = initial.assessments[d.key];
              return (
                <div key={d.key} className="grid gap-2 rounded border border-rule-soft bg-white p-3 lg:grid-cols-[1.4fr_1.3fr_0.7fr_2fr_1fr]">
                  <div>
                    <p className="text-sm font-semibold text-ink-strong">{d.label}</p>
                    <p className="text-[12px] text-muted">Spreadsheet said: {claimText(initial.trackerClaims[d.key])} (unverified)</p>
                  </div>
                  <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
                    Status
                    <select name={`st_${d.key}`} defaultValue={a?.status ?? "not_assessed"} className={inputClass("text-sm")}>
                      {ASSESSMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
                    Year
                    <input name={`yr_${d.key}`} maxLength={20} placeholder="2025" defaultValue={a?.year ?? ""} className={inputClass("text-sm")} />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
                    Evidence link
                    <input name={`ev_${d.key}`} type="url" maxLength={500} placeholder="https:// (or leave blank to use the disclosure page)" defaultValue={a?.evidence_url ?? ""} className={inputClass("text-sm")} />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
                    Checked on
                    <input name={`ck_${d.key}`} type="date" max={today} defaultValue={a?.checked_on ?? ""} className={inputClass("text-sm")} />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink lg:col-span-5">
                    Note (public; required for “Not applicable”)
                    <input name={`nt_${d.key}`} maxLength={300} defaultValue={a?.note ?? ""} className={inputClass("text-sm")} />
                  </label>
                </div>
              );
            })}
          </div>
        ))}
      </fieldset>
      <div>
        <SubmitButton pendingLabel="Saving…">{entryId ? "Save for verification" : "Add for verification"}</SubmitButton>
      </div>
    </form>
  );
}

export function VerifyForm({ entryId, hash }: { entryId: string; hash: string }) {
  const [state, action] = useActionState(boundAction(verifyEntryAction, entryId, hash), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Verifying…">I have checked the evidence: verify and publish</SubmitButton>
      </div>
    </form>
  );
}

export function ReturnForm({ entryId }: { entryId: string }) {
  const [state, action] = useActionState(boundAction(returnEntryAction, entryId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <Field id="return-note" label="What needs fixing">
        <textarea id="return-note" name="note" rows={2} maxLength={1000} className={textareaClass()} />
      </Field>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Returning…">Return to the editor</SubmitButton>
      </div>
    </form>
  );
}

export function CheckLinksForm({ entryId }: { entryId: string }) {
  const [state, action] = useActionState(boundAction(checkLinksAction, entryId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Checking links…">Check links now</SubmitButton>
      </div>
    </form>
  );
}

export function CheckBatchForm({ section }: { section: string }) {
  const [state, action] = useActionState(boundAction(checkBatchAction, section), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Checking links…">Check links in this category (next 8)</SubmitButton>
      </div>
    </form>
  );
}

export function DeleteEntryForm({ entryId, name }: { entryId: string; name: string }) {
  const [state, action] = useActionState(boundAction(deleteEntryAction, entryId), undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="confirm" value="yes" className="mt-1 h-4 w-4" />
        <span>Remove {name} from the report.</span>
      </label>
      <div>
        <SubmitButton variant="danger" pendingLabel="Removing…">Remove from the report</SubmitButton>
      </div>
    </form>
  );
}

export function SettingsForm({ visible, reportedAsOf }: { visible: boolean; reportedAsOf: string | null }) {
  const [state, action] = useActionState(saveSettingsAction, undefined as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-4">
        <Field id="report-date" label="Report as at">
          <input id="report-date" name="reported_as_of" type="date" defaultValue={reportedAsOf ?? ""} className={inputClass("w-auto")} />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
          <input type="checkbox" name="visible" value="yes" defaultChecked={visible} className="h-4 w-4" />
          Show the report on the public site
        </label>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save settings</SubmitButton>
      </div>
    </form>
  );
}

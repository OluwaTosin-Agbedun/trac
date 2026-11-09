"use client";
// Forms for the verified register. Every button that calls a server action is the shared
// SubmitButton (spinner, disabled while pending). Bound actions use boundAction (one binding per
// record) so a form posted before the page has loaded cannot make the server loop.
//
// A refused form keeps everything typed: the action returns the values and the fields use them as
// defaults. React does not move a <select> to a new defaultValue after it has mounted, so each form
// is mounted afresh after every answer from the server (KeptForm) and the message sits outside it.
import { useActionState, useState, type ReactNode } from "react";
import { Field, FormMessage, inputClass, textareaClass, type FormState } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { boundAction } from "@/lib/boundAction";
import { INDICATORS, NIGERIAN_STATES } from "@/lib/indicators";
import { REPORT_SECTIONS, type ReportSection } from "@/lib/report";
import { ASSESSMENT_STATUSES, isOutdated, type Assessment, type AssessmentStatus } from "@/lib/register";
import { expectedPeriodText, outdatedText } from "../_lib/registerText";
import {
  archiveEntryAction, assignEntriesAction, checkBatchAction, checkLinksAction, restoreEntryAction, returnEntryAction, saveDatesAction,
  saveEntryAction, setVisibilityAction, verifyEntryAction, withdrawVerificationAction,
} from "../actions";

type Action = (formData: FormData) => void;

/** Counts the server's answers, so a form can be mounted afresh after each one. */
function useRound(state: FormState): number {
  const [seen, setSeen] = useState(state);
  const [round, setRound] = useState(0);
  if (state !== seen) {
    setSeen(state);
    setRound(round + 1);
  }
  return round;
}

/** A form whose fields are mounted afresh after each answer, with the answer's message below it. */
function KeptForm({ state, action, id, className = "flex flex-col gap-3", messageFirst = false, children }: {
  state: FormState; action: Action; id?: string; className?: string; messageFirst?: boolean; children: ReactNode;
}) {
  const round = useRound(state);
  return (
    <div className="flex flex-col gap-3">
      {messageFirst ? <FormMessage state={state} /> : null}
      <form key={round} id={id} action={action} className={className} noValidate>{children}</form>
      {messageFirst ? null : <FormMessage state={state} />}
    </div>
  );
}

/** What the person typed, after a refusal, else null (use the saved values). */
const typedValues = (state: FormState) => (state?.ok === false && state.values ? state.values : null);

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export interface EntryValues {
  section: ReportSection;
  name: string;
  state: string | null;
  head: string | null;
  bursar: string | null;
  peopleSourceUrl: string | null;
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

interface IndicatorInit { status: string; year: string; evidence: string; checked: string; note: string }

/** One indicator: status, year, evidence, date and note, with the period it should cover. */
function IndicatorRow({ d, id, init, claim, assessmentYear, today }: {
  d: (typeof INDICATORS)[number]; id: string; init: IndicatorInit; claim: boolean | null | undefined;
  assessmentYear: number | null; today: string;
}) {
  // Mirrors of the status and year, only for the live "earlier than the period" warning.
  const [status, setStatus] = useState(init.status);
  const [year, setYear] = useState(init.year);
  const period = expectedPeriodText(d.key, assessmentYear);
  const outdated = isOutdated(d.key, { status: status as AssessmentStatus, year }, assessmentYear);
  const base = `${id}-${d.key}`;
  return (
    <div className="grid gap-2 rounded border border-rule-soft bg-white p-3 lg:grid-cols-[1.4fr_1.3fr_0.7fr_2fr_1fr]">
      <div>
        <p className="text-sm font-semibold text-ink-strong">{d.label}</p>
        {period ? <p id={`${base}-period`} className="text-[12px] font-medium text-accent">{period}</p> : null}
        <p className="text-[12px] text-muted">Spreadsheet said: {claimText(claim)} (unverified)</p>
      </div>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
        Status
        <select name={`st_${d.key}`} defaultValue={init.status} onChange={(e) => setStatus(e.target.value)} className={inputClass("text-sm")}>
          {ASSESSMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
        Year
        <input name={`yr_${d.key}`} maxLength={20} placeholder={assessmentYear ? String(assessmentYear) : "2025"} defaultValue={init.year}
          onChange={(e) => setYear(e.target.value)} aria-describedby={[period ? `${base}-period` : "", `${base}-old`].filter(Boolean).join(" ")}
          aria-invalid={outdated || undefined} className={inputClass("text-sm")} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
        Evidence link
        <input name={`ev_${d.key}`} type="url" maxLength={500} placeholder="https:// (or leave blank to use the disclosure page)" defaultValue={init.evidence} className={inputClass("text-sm")} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
        Checked on
        <input name={`ck_${d.key}`} type="date" max={today} defaultValue={init.checked} className={inputClass("text-sm")} />
      </label>
      <p id={`${base}-old`} aria-live="polite" className={outdated ? "rounded border border-warn-rule bg-warn-bg px-2 py-1 text-[13px] font-medium text-warn-text lg:col-span-5" : "sr-only"}>
        {outdated ? outdatedText(d.key, assessmentYear) : ""}
      </p>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink lg:col-span-5">
        Note (public; required for “Not applicable”)
        <input name={`nt_${d.key}`} maxLength={300} defaultValue={init.note} className={inputClass("text-sm")} />
      </label>
    </div>
  );
}

export function EntryForm({ entryId, hash, initial, idPrefix, today, assessmentYear }: {
  entryId: string | null; hash: string | null; initial: EntryValues; idPrefix: string; today: string; assessmentYear: number | null;
}) {
  const [state, action] = useActionState(boundAction(saveEntryAction, entryId, hash), undefined as FormState);
  const v = typedValues(state);
  // After a refusal every field shows what was typed (even a field cleared on purpose).
  const pick = (name: string, saved: string | null | undefined) => (v ? v[name] ?? "" : saved ?? "");
  const stateValue = pick("state", initial.state);
  const stateOptions = stateValue && !(NIGERIAN_STATES as readonly string[]).includes(stateValue) ? [stateValue, ...NIGERIAN_STATES] : [...NIGERIAN_STATES];
  const id = idPrefix;
  return (
    <KeptForm state={state} action={action} className="flex flex-col gap-5">
      <fieldset className="grid gap-4 border-0 p-0 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink-strong">Institution</legend>
        <Field id={`${id}-name`} label="Name">
          <input id={`${id}-name`} name="name" required maxLength={300} defaultValue={pick("name", initial.name)} className={inputClass()} />
        </Field>
        <Field id={`${id}-section`} label="Category">
          <select id={`${id}-section`} name="section" defaultValue={pick("section", initial.section)} className={inputClass()}>
            {REPORT_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field id={`${id}-state`} label="State">
          <select id={`${id}-state`} name="state" defaultValue={stateValue} className={inputClass()}>
            <option value="">Not recorded</option>
            {stateOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field id={`${id}-head`} label="Vice-Chancellor / Rector / Provost">
          <input id={`${id}-head`} name="head_name" maxLength={200} defaultValue={pick("head_name", initial.head)} className={inputClass()} />
        </Field>
        <Field id={`${id}-bursar`} label="Bursar">
          <input id={`${id}-bursar`} name="bursar_name" maxLength={200} defaultValue={pick("bursar_name", initial.bursar)} className={inputClass()} />
        </Field>
        <Field id={`${id}-people`} label="Source for the head and bursar"
          hint="The institution's own page that names them (it can be the homepage). Needed before verification when names are given.">
          <input id={`${id}-people`} name="people_source_url" type="url" maxLength={500} placeholder="https://" aria-describedby={`${id}-people-hint`}
            defaultValue={pick("people_source_url", initial.peopleSourceUrl)} className={inputClass()} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-0 p-0 md:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink-strong">Official sources</legend>
        <Field id={`${id}-home`} label="Homepage" hint="The institution's own website, e.g. https://www.unn.edu.ng/">
          <input id={`${id}-home`} name="homepage_url" type="url" maxLength={500} placeholder="https://" aria-describedby={`${id}-home-hint`}
            defaultValue={pick("homepage_url", initial.homepageUrl)} className={inputClass()} />
        </Field>
        <Field id={`${id}-disc`} label="Disclosure page (the evidence)"
          hint={initial.websiteText && !initial.disclosureUrl && !initial.homepageUrl ? `The spreadsheet said: “${initial.websiteText.slice(0, 120)}”` : "The page that shows the disclosed information, not the homepage."}>
          <input id={`${id}-disc`} name="disclosure_url" type="url" maxLength={500} placeholder="https://" aria-describedby={`${id}-disc-hint`}
            defaultValue={pick("disclosure_url", initial.disclosureUrl)} className={inputClass()} />
        </Field>
        <div className="md:col-span-2">
          <p className="mb-1.5 text-[13px] font-semibold text-ink">Extra documents (optional)</p>
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <input aria-label={`Document ${i + 1} title`} name={`extra_label_${i}`} maxLength={120} placeholder="Title, e.g. 2025 budget"
                  defaultValue={pick(`extra_label_${i}`, initial.extraLinks[i]?.label)} className={inputClass()} />
                <input aria-label={`Document ${i + 1} address`} name={`extra_url_${i}`} type="url" maxLength={500} placeholder="https://"
                  defaultValue={pick(`extra_url_${i}`, initial.extraLinks[i]?.url)} className={inputClass()} />
              </div>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-md border border-rule-soft bg-surface p-4">
        <legend className="px-1 text-sm font-semibold text-ink-strong">Indicators</legend>
        {assessmentYear ? null : (
          <p className="text-[13px] text-warn-text">No assessment year is set, so the period each indicator should cover cannot be shown. An administrator sets it under Report settings.</p>
        )}
        <Field id={`${id}-checked`} label="Date you checked the sources" hint="Used for every assessed indicator that has no date of its own.">
          <input id={`${id}-checked`} name="checked_all" type="date" max={today} aria-describedby={`${id}-checked-hint`}
            defaultValue={v?.checked_all ?? ""} className={inputClass("w-auto")} />
        </Field>
        {GROUPS.map((g) => (
          <div key={g.group} className="flex flex-col gap-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">{g.group}</p>
            {g.items.map((d) => {
              const a = initial.assessments[d.key];
              const init: IndicatorInit = {
                status: pick(`st_${d.key}`, a?.status ?? "not_assessed") || "not_assessed", year: pick(`yr_${d.key}`, a?.year),
                evidence: pick(`ev_${d.key}`, a?.evidence_url), checked: pick(`ck_${d.key}`, a?.checked_on), note: pick(`nt_${d.key}`, a?.note),
              };
              return <IndicatorRow key={d.key} d={d} id={id} init={init} claim={initial.trackerClaims[d.key]} assessmentYear={assessmentYear} today={today} />;
            })}
          </div>
        ))}
      </fieldset>
      <div>
        <SubmitButton pendingLabel="Saving…">{entryId ? "Save for verification" : "Add for verification"}</SubmitButton>
      </div>
    </KeptForm>
  );
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export function VerifyForm({ entryId, hash }: { entryId: string; hash: string }) {
  const [state, action] = useActionState(boundAction(verifyEntryAction, entryId, hash), undefined as FormState);
  return (
    <KeptForm state={state} action={action} messageFirst>
      <div>
        <SubmitButton pendingLabel="Verifying…">I have checked the evidence: verify and publish</SubmitButton>
      </div>
    </KeptForm>
  );
}

export function ReturnForm({ entryId }: { entryId: string }) {
  const [state, action] = useActionState(boundAction(returnEntryAction, entryId), undefined as FormState);
  const v = typedValues(state);
  return (
    <KeptForm state={state} action={action}>
      <Field id="return-note" label="What needs fixing">
        <textarea id="return-note" name="note" rows={2} maxLength={1000} defaultValue={v?.note ?? ""} className={textareaClass()} />
      </Field>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Returning…">Return to the editor</SubmitButton>
      </div>
    </KeptForm>
  );
}

export function WithdrawForm({ entryId }: { entryId: string }) {
  const [state, action] = useActionState(boundAction(withdrawVerificationAction, entryId), undefined as FormState);
  const v = typedValues(state);
  return (
    <KeptForm state={state} action={action}>
      <p className="text-[13px] text-muted">
        The public site goes back to “Verification in progress” for this record. The verified version is kept in its history and your
        reason is sent to the editor.
      </p>
      <Field id="withdraw-reason" label="Why the verification is withdrawn" hint="5 to 900 characters.">
        <textarea id="withdraw-reason" name="reason" rows={2} maxLength={900} aria-describedby="withdraw-reason-hint" defaultValue={v?.reason ?? ""} className={textareaClass()} />
      </Field>
      <div>
        <SubmitButton variant="danger" pendingLabel="Withdrawing…">Withdraw the verification</SubmitButton>
      </div>
    </KeptForm>
  );
}

// ---------------------------------------------------------------------------
// Removing and restoring
// ---------------------------------------------------------------------------

export function ArchiveForm({ entryId, name }: { entryId: string; name: string }) {
  const [state, action] = useActionState(boundAction(archiveEntryAction, entryId), undefined as FormState);
  const v = typedValues(state);
  return (
    <KeptForm state={state} action={action}>
      <p className="text-[13px] text-muted">
        The record leaves the public site and the working lists. Nothing is deleted: it stays under “Removed (archived)” with its
        history, and an administrator can restore it.
      </p>
      <Field id="archive-reason" label="Why it is removed" hint="For example: not a public institution, or a duplicate of another record. 5 to 1,000 characters.">
        <textarea id="archive-reason" name="reason" rows={2} maxLength={1000} aria-describedby="archive-reason-hint" defaultValue={v?.reason ?? ""} className={textareaClass()} />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="confirm" value="yes" className="mt-1 h-4 w-4" />
        <span>Remove {name} from the register.</span>
      </label>
      <div>
        <SubmitButton variant="danger" pendingLabel="Removing…">Remove from the register</SubmitButton>
      </div>
    </KeptForm>
  );
}

export function RestoreForm({ entryId }: { entryId: string }) {
  const [state, action] = useActionState(boundAction(restoreEntryAction, entryId), undefined as FormState);
  return (
    <KeptForm state={state} action={action} messageFirst>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Restoring…">Restore to the register</SubmitButton>
      </div>
    </KeptForm>
  );
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export interface TeamChoice { userId: string; name: string; role: string }

const ROLE_WORD: Record<string, string> = { editor: "editor", reviewer: "reviewer", admin: "administrator" };
const choiceLabel = (m: TeamChoice) => `${m.name} (${ROLE_WORD[m.role] ?? m.role})`;

/**
 * Assign records to an editor and a reviewer, with an optional due date. With shownIds the person
 * chooses between the ticked rows (checkboxes in the table, tied to this form by formId) and every
 * record listed; with entryIds the form assigns exactly those records.
 */
export function AssignForm({ team, formId, shownIds, entryIds, current }: {
  team: TeamChoice[];
  formId: string;
  shownIds?: string[];
  entryIds?: string[];
  current?: { editorId: string | null; reviewerId: string | null; dueOn: string | null };
}) {
  const [state, action] = useActionState(assignEntriesAction, undefined as FormState);
  const v = typedValues(state);
  const editors = team;
  const reviewers = team.filter((m) => m.role === "reviewer" || m.role === "admin");
  const editorValue = v ? v.editor ?? "" : current?.editorId ?? "";
  const reviewerValue = v ? v.reviewer ?? "" : current?.reviewerId ?? "";
  const dueValue = v ? v.due_on ?? "" : current?.dueOn ?? "";
  const scope = v?.scope === "shown" ? "shown" : "selected";
  return (
    <KeptForm state={state} action={action} id={formId}>
      {shownIds ? (
        <fieldset className="flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Which records</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
            <input type="radio" name="scope" value="selected" defaultChecked={scope === "selected"} className="h-4 w-4" />
            The rows I tick in the table below
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
            <input type="radio" name="scope" value="shown" defaultChecked={scope === "shown"} className="h-4 w-4" />
            Every record in the list ({shownIds.length})
          </label>
          {shownIds.map((x) => <input key={x} type="hidden" name="shown" value={x} />)}
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="scope" value="selected" />
          {(entryIds ?? []).map((x) => <input key={x} type="hidden" name="ids" value={x} />)}
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${formId}-editor`} label="Editor">
          <select id={`${formId}-editor`} name="editor" defaultValue={editorValue} className={inputClass()}>
            <option value="">Nobody</option>
            {editors.map((m) => <option key={m.userId} value={m.userId}>{choiceLabel(m)}</option>)}
          </select>
        </Field>
        <Field id={`${formId}-reviewer`} label="Reviewer">
          <select id={`${formId}-reviewer`} name="reviewer" defaultValue={reviewerValue} className={inputClass()}>
            <option value="">Nobody</option>
            {reviewers.map((m) => <option key={m.userId} value={m.userId}>{choiceLabel(m)}</option>)}
          </select>
        </Field>
        <Field id={`${formId}-due`} label="Due date (optional)">
          <input id={`${formId}-due`} name="due_on" type="date" defaultValue={dueValue} className={inputClass()} />
        </Field>
      </div>
      <p className="text-[13px] text-muted">Saving replaces the current assignment of these records; a box left on “Nobody” or empty clears it.</p>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Assigning…">Save the assignment</SubmitButton>
      </div>
    </KeptForm>
  );
}

// ---------------------------------------------------------------------------
// Link checks
// ---------------------------------------------------------------------------

export function CheckLinksForm({ entryId }: { entryId: string }) {
  const [state, action] = useActionState(boundAction(checkLinksAction, entryId), undefined as FormState);
  return (
    <KeptForm state={state} action={action} messageFirst>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Checking links…">Check links now</SubmitButton>
      </div>
    </KeptForm>
  );
}

export function CheckBatchForm({ section }: { section: string }) {
  const [state, action] = useActionState(boundAction(checkBatchAction, section), undefined as FormState);
  return (
    <KeptForm state={state} action={action} messageFirst>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Checking links…">Check links in this category (next 8 records)</SubmitButton>
      </div>
    </KeptForm>
  );
}

// ---------------------------------------------------------------------------
// Settings (administrators)
// ---------------------------------------------------------------------------

export function DatesForm({ reportedAsOf, assessmentYear, recheckDays, suggestedYear, today }: {
  reportedAsOf: string | null; assessmentYear: number | null; recheckDays: number; suggestedYear: number; today: string;
}) {
  const [state, action] = useActionState(saveDatesAction, undefined as FormState);
  const v = typedValues(state);
  return (
    <KeptForm state={state} action={action}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="report-date" label="Report as at" hint="The date printed on the public report.">
          <input id="report-date" name="reported_as_of" type="date" max={today} aria-describedby="report-date-hint"
            defaultValue={v ? v.reported_as_of ?? "" : reportedAsOf ?? ""} className={inputClass()} />
        </Field>
        <Field id="assessment-year" label="Assessment year" hint={`The year being assessed, usually this year (${suggestedYear}). Sets the period each indicator should cover.`}>
          <input id="assessment-year" name="assessment_year" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" aria-describedby="assessment-year-hint"
            defaultValue={v ? v.assessment_year ?? "" : String(assessmentYear ?? suggestedYear)} className={inputClass()} />
        </Field>
        <Field id="recheck-days" label="Re-check verified records after (days)" hint="Between 30 and 1,095. 180 is about six months.">
          <input id="recheck-days" name="recheck_days" inputMode="numeric" maxLength={4} aria-describedby="recheck-days-hint"
            defaultValue={v ? v.recheck_days ?? "" : String(recheckDays)} className={inputClass()} />
        </Field>
      </div>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save dates</SubmitButton>
      </div>
    </KeptForm>
  );
}

export function VisibilityForm({ visible }: { visible: boolean }) {
  const [state, action] = useActionState(setVisibilityAction, undefined as FormState);
  const v = typedValues(state);
  const next = visible ? "no" : "yes";
  return (
    <KeptForm state={state} action={action}>
      <input type="hidden" name="visible" value={next} />
      <Field id="visibility-reason" label={visible ? "Why the register is hidden" : "Why the register is shown"} hint="Kept in the history. 5 to 500 characters.">
        <textarea id="visibility-reason" name="reason" rows={2} maxLength={500} aria-describedby="visibility-reason-hint"
          defaultValue={v && v.visible === next ? v.reason ?? "" : ""} className={textareaClass()} />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="confirm" value="yes" className="mt-1 h-4 w-4" />
        <span>{visible ? "Hide the whole register from the public site now." : "Show the register on the public site now."}</span>
      </label>
      <div>
        <SubmitButton variant={visible ? "danger" : "primary"} pendingLabel={visible ? "Hiding…" : "Showing…"}>
          {visible ? "Hide the public register" : "Show the public register"}
        </SubmitButton>
      </div>
    </KeptForm>
  );
}

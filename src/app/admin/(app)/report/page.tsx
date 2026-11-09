// The verified register: one source record per institution. Editors record the homepage,
// disclosure page and, for each indicator, the status, year, evidence and date checked; a second
// reviewer, who did not edit the record, verifies it before anything is public.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import {
  REGISTER_FILTERS, getReportAdmin, isDueForRecheck, looksEverywhere, mayVerify, type ReportAdmin, type ReportEntry, type VerificationState,
} from "@/server/data/cms/report";
import { Notice } from "@/components/ui/Form";
import { StatusIcon } from "@/components/register/StatusIcon";
import { INDICATORS } from "@/lib/indicators";
import { formatCalendarDate, formatDate, formatDateTime } from "@/lib/format";
import { lagosDate } from "@/lib/editorRules";
import { REPORT_SECTIONS, type ReportSection } from "@/lib/report";
import { formatPoints, recordLabel, scoreRecord } from "@/lib/register";
import { LINK_RESULT_LABEL } from "@/server/research/linkCheck";
import { buildHistory, describeVersion, diffContent, importFlagText, isOverdue, type ContentLike, type HistoryLine } from "./_lib/registerText";
import {
  ArchiveForm, AssignForm, CheckBatchForm, CheckLinksForm, DatesForm, EntryForm, RestoreForm, ReturnForm, VerifyForm, VisibilityForm,
  WithdrawForm, type EntryValues,
} from "./_components/ReportForms";
import { Suggestions } from "./_components/Suggestions";

export const metadata: Metadata = { title: "Compliance report", robots: { index: false } };

// Server actions on this page include link checks that open many websites. The batch check starts
// no new record after 25 seconds; this gives the record it is on time to finish.
export const maxDuration = 60;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

const STATE_BADGE: Record<VerificationState, { label: string; className: string }> = {
  verified: { label: "Verified", className: "border-[#b7dcc5] bg-ok-bg text-ok" },
  awaiting: { label: "Awaiting verification", className: "border-warn-rule bg-warn-bg text-warn-text" },
  returned: { label: "Returned for fixes", className: "border-[#e8b4b4] bg-danger-bg text-danger" },
  not_started: { label: "Not started", className: "border-rule bg-surface text-muted" },
};
const ARCHIVED_BADGE = { label: "Removed", className: "border-rule bg-surface-2 text-muted" };

const badgeOf = (e: ReportEntry) => (e.archivedAt ? ARCHIVED_BADGE : STATE_BADGE[e.state_]);
const sectionLabel = (key: string) => REPORT_SECTIONS.find((s) => s.key === key)?.label ?? key;

function toValues(e: ReportEntry): EntryValues {
  return { section: e.section, name: e.name, state: e.state, head: e.head, bursar: e.bursar, peopleSourceUrl: e.peopleSourceUrl,
    homepageUrl: e.homepageUrl, disclosureUrl: e.disclosureUrl, extraLinks: e.extraLinks, assessments: e.assessments,
    trackerClaims: e.trackerClaims, websiteText: e.websiteText };
}

/** The working copy in the same shape as the verified copy, for comparing the two. */
function workingContent(e: ReportEntry): ContentLike {
  return { name: e.name, section: e.section, state: e.state, head_name: e.head, bursar_name: e.bursar, people_source_url: e.peopleSourceUrl,
    homepage_url: e.homepageUrl, disclosure_url: e.disclosureUrl, extra_links: e.extraLinks, assessments: e.assessments };
}

/** Long addresses wrap anywhere so the table fits. */
const hasUrl = (s: string) => /https?:\/\//i.test(s);

/** The verified value and the working value of every changed field, side by side. */
function Changes({ e }: { e: ReportEntry }) {
  if (!e.verified) {
    return <p className="text-muted">Never verified: everything in the record is new to the public site.</p>;
  }
  const changes = diffContent(e.verified as ContentLike, workingContent(e));
  if (!changes.length) return <p className="text-muted">Nothing visible changed (it was saved again without changes).</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[13px]">
        <caption className="sr-only">Changes waiting for verification</caption>
        <thead>
          <tr className="text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
            <th scope="col" className="py-1.5 pr-3">What changed</th>
            <th scope="col" className="py-1.5 pr-3">Public now (verified)</th>
            <th scope="col" className="py-1.5">Working copy (waiting)</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.key} className="border-t border-rule-soft align-top">
              <th scope="row" className="py-1.5 pr-3 text-left font-semibold text-ink">{c.label}</th>
              <td className={`py-1.5 pr-3 text-muted ${hasUrl(c.before) ? "break-all" : ""}`}>{c.before}</td>
              <td className={`py-1.5 text-ink ${hasUrl(c.after) ? "break-all" : ""}`}>{c.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TONE: Record<HistoryLine["tone"], string> = { ok: "text-ok", warn: "text-warn-text", danger: "text-danger", muted: "text-ink" };

function HistoryList({ lines, label }: { lines: HistoryLine[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-2.5">
      {lines.map((h, i) => (
        <li key={`${h.at}-${i}`} className="border-l-2 border-rule pl-3">
          <p className={`font-semibold ${TONE[h.tone]}`}>{h.title}</p>
          <p className="text-[12px] text-muted">{formatDateTime(h.at)} · {h.who}</p>
          {h.details.length ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-muted">
              {h.details.map((d, j) => <li key={j} className="break-words">{d}</li>)}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** What happened to the record (reviewers and administrators) and its earlier verified versions (everyone). */
function History({ data, canSeeEvents }: { data: ReportAdmin; canSeeEvents: boolean }) {
  const names = new Map(data.team.map((t) => [t.userId, t.name]));
  const lines = buildHistory(data.history, data.linkRuns, (id) => names.get(id) ?? null);
  const versions = data.versions.map(describeVersion);
  return (
    <section aria-labelledby="history-h" className="flex flex-col gap-4 rounded border border-rule-soft bg-surface p-4 text-sm">
      <h3 id="history-h" className="font-serif text-lg font-semibold text-ink-strong">History</h3>
      {canSeeEvents ? (
        <div className="flex flex-col gap-2">
          <h4 className="font-semibold text-ink">What happened</h4>
          {lines.length ? <HistoryList lines={lines} label="What happened to this record, newest first" /> : <p className="text-muted">Nothing recorded yet.</p>}
          {data.history.length >= 40 ? <p className="text-[12px] text-muted">Showing the latest 40 changes.</p> : null}
        </div>
      ) : (
        <p className="text-[13px] text-muted">The full list of changes is visible to reviewers and administrators.</p>
      )}
      <div className="flex flex-col gap-2">
        <h4 className="font-semibold text-ink">Earlier verified versions</h4>
        {versions.length ? <HistoryList lines={versions} label="Earlier verified versions, newest first" />
          : <p className="text-muted">None: {data.editing?.verifiedAt ? "the current verification is the first." : "this record has never been verified."}</p>}
      </div>
    </section>
  );
}

function Assignment({ e, today }: { e: ReportEntry; today: string }) {
  if (!e.assignedEditorName && !e.assignedReviewerName && !e.dueOn) return <p className="text-muted">Not assigned to anyone.</p>;
  const overdue = isOverdue(e, today);
  return (
    <p className="text-muted">
      Editor: <strong className="text-ink">{e.assignedEditorName ?? "nobody"}</strong>. Reviewer: <strong className="text-ink">{e.assignedReviewerName ?? "nobody"}</strong>.
      {e.dueOn ? <> Due <span className={overdue ? "font-semibold text-danger" : "text-ink"}>{formatCalendarDate(e.dueOn)}{overdue ? " (overdue)" : ""}</span>.</> : " No due date."}
    </p>
  );
}

async function ReportBody({ searchParams }: Props) {
  await connection();
  const viewer = await requireViewer();
  const sp = await searchParams;
  const section = (REPORT_SECTIONS.find((s) => s.key === one(sp.section))?.key ?? "federal_university") as ReportSection;
  const q = one(sp.q).slice(0, 100);
  const filter = REGISTER_FILTERS.find((f) => f.value === one(sp.filter))?.value ?? "all";
  const editParam = one(sp.edit);
  const editId = isUuid(editParam) ? editParam.toLowerCase() : null;
  const data = await getReportAdmin(viewer, section, q, editId, filter);
  const canEdit = viewer.role === "editor" || viewer.role === "reviewer" || viewer.role === "admin";
  const canVerify = viewer.role === "reviewer" || viewer.role === "admin";
  const isAdmin = viewer.role === "admin";
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const today = lagosDate();
  const thisYear = Number(today.slice(0, 4));
  const everywhere = looksEverywhere(section, q, filter);
  const base = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ section, ...(q ? { q } : {}), ...(filter !== "all" ? { filter } : {}), ...extra });
    return `/admin/report?${params.toString()}`;
  };
  const active = REPORT_SECTIONS.find((s) => s.key === section)!;
  const filterLabel = REGISTER_FILTERS.find((f) => f.value === filter)!.label;
  const e = canEdit ? data.editing : null;
  const team = data.team.map((t) => ({ userId: t.userId, name: t.name, role: t.role }));
  // Reviewers and administrators can tick rows and assign them (not in the list of removed records).
  const bulkAssign = canVerify && data.entries.length > 0 && filter !== "archived";
  const outdated = e ? scoreRecord(e.assessments, data.assessmentYear).outdated : 0;

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Public site</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-ink-strong">Compliance report</h1>
        <p className="mt-2 max-w-[85ch] text-sm text-muted">
          One source record per institution. Record the homepage and the disclosure page, then for each indicator its status,
          reporting year, evidence link and the date you checked it. A second reviewer, who did not edit the record, opens the
          evidence and verifies it. Only verified records are public; until then the public site shows “Verification in progress”.{" "}
          <Link href="/methodology">How we score</Link>.
        </p>
      </div>

      {!canEdit ? (
        <Notice tone="info" title="View only">Editors, reviewers and administrators update the register.</Notice>
      ) : null}

      {!data.visible && canEdit ? (
        <Notice tone="warn" title="The public register is hidden">
          Nobody outside the team can see it.{isAdmin ? " Show it again under Report settings below." : " An administrator can show it again."}
        </Notice>
      ) : null}

      {data.awaitingForMe && canVerify ? (
        <Notice tone="warn" title={`${data.awaitingForMe} record${data.awaitingForMe === 1 ? "" : "s"} awaiting your verification`}>
          <Link href={`/admin/report?section=${section}&filter=awaiting`}>Show every record awaiting verification</Link> (all categories).
        </Notice>
      ) : null}

      {total === 0 ? (
        <Notice tone="warn" title="No records yet">
          Upload the tracker spreadsheet in <Link href="/admin/imports">Imports</Link> and press <strong>Add these institutions to the register</strong>.
          Each institution becomes a record to verify; nothing is public until it is verified.
        </Notice>
      ) : null}

      {isAdmin ? (
        <details className="rounded-md border border-rule bg-white">
          <summary className="min-h-11 cursor-pointer px-5 py-3 text-sm font-semibold text-accent">Report settings</summary>
          <div className="flex flex-col gap-6 border-t border-rule p-5">
            <section aria-labelledby="dates-h" className="flex flex-col gap-3">
              <h2 id="dates-h" className="text-base font-semibold text-ink-strong">Dates</h2>
              <p className="text-sm text-muted">
                {data.reportedAsOf ? `The report is dated ${formatCalendarDate(data.reportedAsOf)}. ` : "The report has no date yet. "}
                {data.assessmentYear ? `Records are assessed for ${data.assessmentYear}. ` : "No assessment year is set. "}
                Verified records are due for re-checking after {data.recheckDays} days.
              </p>
              <DatesForm reportedAsOf={data.reportedAsOf} assessmentYear={data.assessmentYear} recheckDays={data.recheckDays}
                suggestedYear={thisYear} today={today} />
            </section>
            <section aria-labelledby="visibility-h" className="flex flex-col gap-3 border-t border-rule-soft pt-5">
              <h2 id="visibility-h" className="text-base font-semibold text-ink-strong">Public register</h2>
              <p className="text-sm text-muted">
                {data.visible
                  ? "The register is shown on the public site. Hiding it takes every record off the public site at once."
                  : "The register is hidden: the public site says it is not available."}
              </p>
              <VisibilityForm visible={data.visible} />
            </section>
          </div>
        </details>
      ) : null}

      {e ? (
        <section id="edit" aria-labelledby="edit-h" className="flex flex-col gap-5 rounded-md border-2 border-accent bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 id="edit-h" className="font-serif text-xl font-semibold text-ink-strong">{e.name}</h2>
              <p className="text-[13px] text-muted">{sectionLabel(e.section)}{e.state ? ` · ${e.state}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
              {e.verified && !e.archivedAt && data.visible ? (
                <Link href={`/institutions/${e.slug}`} target="_blank">View on public site<span className="sr-only"> (opens in a new tab)</span></Link>
              ) : null}
              <Link href={base()}>Close</Link>
            </div>
          </div>

          {e.importFlags.length ? (
            <Notice tone="warn" title="The importer held this row for a check">
              <ul className="ml-5 list-disc">{e.importFlags.map((f) => <li key={f}>{importFlagText(f)}</li>)}</ul>
              {e.listedName && e.listedName !== e.name ? <p className="mt-1">Imported as “{e.listedName}”.</p> : null}
            </Notice>
          ) : null}

          {e.archivedAt ? (
            <div className="flex flex-col gap-3 rounded-md border border-[#e8b4b4] bg-danger-bg px-4 py-3 text-sm text-danger">
              <p className="font-semibold">Removed from the register on {formatDateTime(e.archivedAt)}</p>
              {e.archiveReason ? <p>Reason: {e.archiveReason}</p> : null}
              <p>It is not on the public site and cannot be changed.{isAdmin ? " Restore it to work on it again." : " An administrator can restore it."}</p>
              {isAdmin ? <RestoreForm entryId={e.id} /> : null}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2 rounded border border-rule-soft bg-surface p-4 text-sm">
              <p><span className={`inline-flex rounded border px-2 py-0.5 text-[12px] font-semibold ${badgeOf(e).className}`}>{badgeOf(e).label}</span></p>
              {e.verifiedAt ? (
                <p className="text-muted">
                  Last verified {formatDateTime(e.verifiedAt)}{e.verifiedByName ? ` by ${e.verifiedByName}` : ""}
                  {e.verifiedMethod ? `, under scoring rule ${e.verifiedMethod}` : ""}{e.verifiedAssessmentYear ? ` for ${e.verifiedAssessmentYear}` : ""}.
                  {" "}The public site shows that version.
                  {isDueForRecheck(e, data.recheckDays) ? <strong className="text-warn-text"> Due for re-checking (verified over {data.recheckDays} days ago).</strong> : null}
                </p>
              ) : <p className="text-muted">Never verified, so not public yet{e.listedName ? ": the public list shows it as “Verification in progress”" : ""}.</p>}
              <Assignment e={e} today={today} />
              {outdated ? (
                <p className="font-medium text-warn-text">
                  {outdated} indicator{outdated === 1 ? " covers" : "s cover"} a year earlier than {outdated === 1 ? "its" : "their"} period
                  {data.assessmentYear ? ` for ${data.assessmentYear}` : ""}, so {outdated === 1 ? "it counts" : "they count"} 0 points. See the warnings below.
                </p>
              ) : null}
              {e.editorNames.length ? <p className="text-muted">Edited since the last verification by {e.editorNames.join(", ")}.</p> : null}
              {e.returnNote ? <Notice tone="danger" title="Returned for fixes">{e.returnNote} Fix it and save; the record goes back for verification.</Notice> : null}
              {!e.archivedAt && (e.state_ === "awaiting" || e.state_ === "returned") ? (
                <div className="flex flex-col gap-1.5">
                  <p className="font-semibold text-ink">Waiting for verification:</p>
                  <Changes e={e} />
                </div>
              ) : null}
              {mayVerify(viewer, e) ? (
                <div className="mt-2 flex flex-col gap-3 border-t border-rule-soft pt-3">
                  <p className="text-[13px] text-muted">Open each evidence link, confirm it is this institution’s own page, covers the period shown and says what the status says, then verify.</p>
                  <VerifyForm entryId={e.id} hash={e.hash} />
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-accent">Return it to the editor instead</summary>
                    <ReturnForm entryId={e.id} />
                  </details>
                </div>
              ) : canVerify && e.state_ === "awaiting" && e.editorIds.includes(viewer.userId) ? (
                <p className="mt-2 border-t border-rule-soft pt-3 text-[13px] text-muted">You edited this record, so another reviewer must verify it.</p>
              ) : null}
              {canVerify && e.verified && !e.archivedAt ? (
                <details className="mt-2 border-t border-rule-soft pt-1">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-danger">Withdraw the verification</summary>
                  <WithdrawForm entryId={e.id} />
                </details>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 rounded border border-rule-soft bg-surface p-4 text-sm">
              <p className="font-semibold text-ink">Link checks</p>
              {data.linkChecks.length ? (
                <ul className="flex flex-col gap-1.5">
                  {data.linkChecks.map((c) => (
                    <li key={`${c.kind}-${c.url}`} className="flex flex-col">
                      <span className={c.result === "ok" ? "text-ok" : "font-semibold text-danger"}>{LINK_RESULT_LABEL[c.result]} · {c.kind.replace("evidence:", "evidence for ")}</span>
                      <span className="break-all text-[12px] text-muted">{c.url}{c.detail ? ` · ${c.detail}` : ""} · {formatDateTime(c.checkedAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-muted">Not checked yet. The check opens each address and flags dead links, homepage-only links and links to another institution’s website.</p>}
              {!e.archivedAt ? <CheckLinksForm entryId={e.id} /> : null}
            </div>
          </div>

          {canVerify && !e.archivedAt ? (
            <details className="rounded border border-rule-soft">
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-accent">Change who works on this record</summary>
              <div className="border-t border-rule-soft p-4">
                <AssignForm team={team} formId={`assign-${e.id.slice(0, 8)}`} entryIds={[e.id]}
                  current={{ editorId: e.assignedEditorId, reviewerId: e.assignedReviewerId, dueOn: e.dueOn }} />
              </div>
            </details>
          ) : null}

          {!e.archivedAt && viewer.role === "editor" && e.assignedEditorId && e.assignedEditorId !== viewer.userId ? (
            <Notice tone="info" title={`Assigned to ${e.assignedEditorName ?? "another editor"}`}>
              Only the assigned editor, a reviewer or an administrator can save changes to this record. Ask a reviewer to reassign it if you should work on it.
            </Notice>
          ) : null}
          {e.archivedAt ? null : (
            <EntryForm key={e.id} idPrefix={`edit-${e.id.slice(0, 8)}`} entryId={e.id} hash={e.hash} initial={toValues(e)} today={today}
              assessmentYear={data.assessmentYear} />
          )}

          <Suspense fallback={null}>
            <Suggestions entryId={e.id} institutionId={e.institutionId} hash={e.hash} />
          </Suspense>

          <History data={data} canSeeEvents={canVerify} />

          {isAdmin && !e.archivedAt ? (
            <details className="rounded border border-[#e8b4b4]">
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-danger">Remove from the register</summary>
              <div className="border-t border-[#e8b4b4] p-4"><ArchiveForm entryId={e.id} name={e.name} /></div>
            </details>
          ) : null}
        </section>
      ) : canEdit && editId ? (
        <Notice tone="warn" title="That record could not be found">It may have been removed. <Link href={base()}>Close</Link></Notice>
      ) : null}

      {canEdit ? (
        <details className="rounded-md border border-rule bg-white">
          <summary className="min-h-11 cursor-pointer px-5 py-3 text-sm font-semibold text-accent">Add an institution</summary>
          <div className="border-t border-rule p-5">
            <EntryForm idPrefix="new" entryId={null} hash={null} today={today} assessmentYear={data.assessmentYear}
              initial={{ section, name: "", state: null, head: null, bursar: null, peopleSourceUrl: null, homepageUrl: null,
                disclosureUrl: null, extraLinks: [], assessments: {}, trackerClaims: {}, websiteText: null }} />
          </div>
        </details>
      ) : null}

      <nav aria-label="Category" className="flex flex-col gap-2">
        {(["Federal", "State"] as const).map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-[12px] font-semibold uppercase tracking-[0.1em] text-subtle">{group}</span>
            {REPORT_SECTIONS.filter((s) => s.ownership === group).map((s) => (
              <Link key={s.key} href={`/admin/report?section=${s.key}${filter !== "all" ? `&filter=${filter}` : ""}`} aria-current={s.key === section && !everywhere ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded border px-4 text-sm font-semibold no-underline ${s.key === section && !everywhere ? "border-accent bg-accent text-white!" : "border-rule bg-white text-ink hover:border-accent"}`}>
                {s.label.replace(/^(Federal|State) /, "").replace(/^./, (ch) => ch.toUpperCase())}
                <span className={`rounded-full px-2 text-[12px] ${s.key === section && !everywhere ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{data.counts[s.key]}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form action="/admin/report" method="get" role="search" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="section" value={section} />
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold text-ink">
            Find an institution
            <input name="q" type="search" defaultValue={q} maxLength={100} placeholder="Name or state"
              className="min-h-11 w-64 max-w-full rounded border border-[#b9c1cc] bg-white px-3 text-[15px] font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
            Show
            <select name="filter" defaultValue={filter} className="min-h-11 rounded border border-[#b9c1cc] bg-white px-3 text-[15px] font-normal">
              {REGISTER_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}{f.value !== "all" && looksEverywhere(section, "", f.value) ? " (all categories)" : ""}</option>)}
            </select>
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center rounded bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover">Apply</button>
          {q || filter !== "all" ? <Link href={`/admin/report?section=${section}`} className="inline-flex min-h-11 items-center text-sm font-semibold">Clear</Link> : null}
        </form>
        {canEdit && !everywhere ? <CheckBatchForm section={section} /> : null}
      </div>

      <p role="status" className="text-sm text-muted">
        {everywhere
          ? <>Showing <strong className="text-ink">{data.entries.length}</strong> record{data.entries.length === 1 ? "" : "s"} from <strong className="text-ink">every category</strong>
              {filter !== "all" ? <> ({filterLabel.toLowerCase()})</> : null}{q ? <> matching “{q}”</> : null}. Choosing a category above does not narrow this list; press Clear to go back to one category.</>
          : <>Showing <strong className="text-ink">{data.entries.length}</strong> {active.label.toLowerCase()}{filter !== "all" ? <> ({filterLabel.toLowerCase()})</> : null}.</>}
      </p>

      {bulkAssign ? (
        <details className="rounded-md border border-rule bg-white">
          <summary className="min-h-11 cursor-pointer px-5 py-3 text-sm font-semibold text-accent">Assign records to an editor and a reviewer</summary>
          <div className="border-t border-rule p-5">
            <AssignForm team={team} formId="assign-rows" shownIds={data.entries.slice(0, 500).map((r) => r.id)} />
            {data.entries.length > 500 ? <p className="mt-2 text-[13px] text-warn-text">Only the first 500 records in the list can be assigned at once.</p> : null}
          </div>
        </details>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-rule bg-white">
        <table className="w-full min-w-[1280px] border-collapse text-sm">
          <caption className="sr-only">{everywhere ? "Records from every category" : `${active.label} in the register`}</caption>
          <thead>
            <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
              {bulkAssign ? <th scope="col" className="px-3 py-2.5"><span className="sr-only">Tick to assign</span></th> : null}
              <th scope="col" className="px-3 py-2.5">Institution</th>
              <th scope="col" className="px-3 py-2.5">Verification</th>
              <th scope="col" className="px-3 py-2.5">Working copy</th>
              <th scope="col" className="px-3 py-2.5">Assigned</th>
              <th scope="col" className="px-3 py-2.5">Links</th>
              {INDICATORS.map((d) => <th key={d.key} scope="col" className="px-1 py-2.5 text-center"><abbr title={d.label} className="no-underline">{d.short}</abbr></th>)}
              <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((r) => {
              const score = scoreRecord(r.assessments, data.assessmentYear);
              const label = recordLabel(score.label);
              const badge = badgeOf(r);
              const overdue = isOverdue(r, today);
              const review = mayVerify(viewer, r);
              return (
                <tr key={r.id} className={`border-t border-rule-soft align-top ${e?.id === r.id ? "bg-accent-soft" : ""}`}>
                  {bulkAssign ? (
                    <td className="px-3 py-2.5">
                      <label className="-m-2 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                        <input type="checkbox" name="ids" value={r.id} form="assign-rows" disabled={Boolean(r.archivedAt)} className="h-5 w-5" />
                        <span className="sr-only">Tick {r.name} to assign it</span>
                      </label>
                    </td>
                  ) : null}
                  <th scope="row" className="max-w-[280px] px-3 py-2.5 text-left font-normal">
                    <span className="font-semibold text-ink-strong">{r.name}</span>
                    <span className="block text-[12px] text-muted">
                      {everywhere ? `${sectionLabel(r.section)} · ` : ""}{r.state ?? "State not recorded"}{r.disclosureUrl ? "" : " · no disclosure page"}
                    </span>
                    {r.importFlags.length ? <span className="mt-0.5 block text-[12px] font-semibold text-warn-text">Flagged by the importer: check before verifying</span> : null}
                  </th>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[12px] font-semibold ${badge.className}`}>{badge.label}</span>
                    {r.verifiedAt ? <span className="mt-1 block text-[11px] text-muted">Verified {formatCalendarDate(r.verifiedAt.slice(0, 10))}</span> : null}
                    {r.verified && r.pending && !r.archivedAt ? <span className="block text-[11px] text-muted">Public shows the last verified version</span> : null}
                    {r.state_ === "verified" && isDueForRecheck(r, data.recheckDays) && !r.archivedAt ? <span className="block text-[11px] font-semibold text-warn-text">Due for re-checking</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    <span className="font-semibold">{label.label}</span>
                    {score.label !== "incomplete" && score.available ? <span className="block text-muted">{formatPoints(score.points)} of {score.available}</span> : null}
                    {score.outdated ? <span className="block text-warn-text">{score.outdated} for an earlier year</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {r.assignedEditorName || r.assignedReviewerName || r.dueOn ? (
                      <>
                        <span className="block">Editor: {r.assignedEditorName ?? "nobody"}</span>
                        <span className="block">Reviewer: {r.assignedReviewerName ?? "nobody"}</span>
                        {r.dueOn ? <span className={`block ${overdue ? "font-semibold text-danger" : "text-muted"}`}>Due {formatCalendarDate(r.dueOn)}{overdue ? " (overdue)" : ""}</span> : null}
                      </>
                    ) : <span className="text-muted">Not assigned</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {r.lastLinkCheckAt ? (
                      <>
                        <span className={`block ${r.linkProblems ? "font-semibold text-danger" : "text-ok"}`}>
                          {r.linkProblems ? `${r.linkProblems} need${r.linkProblems === 1 ? "s" : ""} attention` : "All work"}
                        </span>
                        <span className="block text-muted">Checked {formatDate(r.lastLinkCheckAt)}</span>
                      </>
                    ) : <span className="text-muted">Not checked</span>}
                  </td>
                  {INDICATORS.map((d) => <td key={d.key} className="px-1 py-2.5 text-center"><StatusIcon status={r.assessments[d.key]?.status} label={d.label} size={20} /></td>)}
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <Link href={`${base({ edit: r.id })}#edit`} className="inline-flex min-h-11 items-center rounded border border-accent px-3 text-[13px] font-semibold no-underline hover:bg-accent-soft">
                        {review ? "Review" : r.archivedAt ? "Open" : "Edit"}<span className="sr-only"> {r.name}</span>
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.entries.length ? <p className="px-5 py-8 text-center text-sm text-muted">{q || filter !== "all" ? "No records match." : `No ${active.label.toLowerCase()} yet.`}</p> : null}
      </div>
    </div>
  );
}

export default function ReportPage(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the register…</p>}>
      <ReportBody searchParams={props.searchParams} />
    </Suspense>
  );
}

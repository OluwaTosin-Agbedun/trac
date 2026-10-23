// The verified register: one source record per institution. Editors record the homepage,
// disclosure page and, for each indicator, the status, year, evidence and date checked; a second
// reviewer, who did not edit the record, verifies it before anything is public.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { getReportAdmin, type RegisterFilter, type ReportEntry, type VerificationState } from "@/server/data/cms/report";
import { Notice } from "@/components/ui/Form";
import { StatusIcon } from "@/components/register/StatusIcon";
import { INDICATORS } from "@/lib/indicators";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { lagosDate } from "@/lib/editorRules";
import { REPORT_SECTIONS, type ReportSection } from "@/lib/report";
import { formatPoints, recordLabel, scoreRecord, type RegisterContent } from "@/lib/register";
import { LINK_RESULT_LABEL } from "@/server/research/linkCheck";
import {
  CheckBatchForm, CheckLinksForm, DeleteEntryForm, EntryForm, ReturnForm, SettingsForm, VerifyForm, type EntryValues,
} from "./_components/ReportForms";

export const metadata: Metadata = { title: "Compliance report", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

const STATE_BADGE: Record<VerificationState, { label: string; className: string }> = {
  verified: { label: "Verified", className: "border-[#b7dcc5] bg-ok-bg text-ok" },
  awaiting: { label: "Awaiting verification", className: "border-warn-rule bg-warn-bg text-warn-text" },
  returned: { label: "Returned for fixes", className: "border-[#e8b4b4] bg-danger-bg text-danger" },
  not_started: { label: "Not started", className: "border-rule bg-surface text-muted" },
};

const FILTERS: { value: RegisterFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "awaiting", label: "Awaiting verification" },
  { value: "returned", label: "Returned for fixes" },
  { value: "verified", label: "Verified" },
  { value: "not_started", label: "Not started" },
];

function toValues(e: ReportEntry): EntryValues {
  return { section: e.section, name: e.name, state: e.state, head: e.head, bursar: e.bursar, homepageUrl: e.homepageUrl,
    disclosureUrl: e.disclosureUrl, extraLinks: e.extraLinks, assessments: e.assessments, trackerClaims: e.trackerClaims, websiteText: e.websiteText };
}

/** What differs between the working copy and the public, verified copy. */
function changes(e: ReportEntry): string[] {
  const v: RegisterContent | null = e.verified;
  if (!v) return ["Everything: this record has never been verified."];
  const out: string[] = [];
  const cmp = (label: string, a: unknown, b: unknown) => { if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push(label); };
  cmp("Name", e.name, v.name); cmp("Category", e.section, v.section); cmp("State", e.state, v.state);
  cmp("Head", e.head, v.head_name); cmp("Bursar", e.bursar, v.bursar_name); cmp("Homepage", e.homepageUrl, v.homepage_url);
  cmp("Disclosure page", e.disclosureUrl, v.disclosure_url); cmp("Extra documents", e.extraLinks, v.extra_links);
  for (const d of INDICATORS) cmp(d.label, e.assessments[d.key], v.assessments?.[d.key]);
  return out.length ? out : ["Nothing visible (saved again without changes)."];
}

async function ReportBody({ searchParams }: Props) {
  await connection();
  const viewer = await requireViewer();
  const sp = await searchParams;
  const section = (REPORT_SECTIONS.find((s) => s.key === one(sp.section))?.key ?? "federal_university") as ReportSection;
  const q = one(sp.q).slice(0, 100);
  const filter = FILTERS.find((f) => f.value === one(sp.filter))?.value ?? "all";
  const editParam = one(sp.edit);
  const editId = isUuid(editParam) ? editParam : null;
  const data = await getReportAdmin(viewer, section, q, editId, filter);
  const canEdit = viewer.role === "editor" || viewer.role === "reviewer" || viewer.role === "admin";
  const canVerify = viewer.role === "reviewer" || viewer.role === "admin";
  const isAdmin = viewer.role === "admin";
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const today = lagosDate();
  const base = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ section, ...(q ? { q } : {}), ...(filter !== "all" ? { filter } : {}), ...extra });
    return `/admin/report?${params.toString()}`;
  };
  const active = REPORT_SECTIONS.find((s) => s.key === section)!;
  const e = canEdit ? data.editing : null;
  const mayVerify = (r: ReportEntry) => canVerify && r.state_ === "awaiting" && !r.editorIds.includes(viewer.userId);

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

      {data.awaiting && canVerify ? (
        <Notice tone="warn" title={`${data.awaiting} record${data.awaiting === 1 ? "" : "s"} awaiting verification`}>
          <Link href={`/admin/report?section=${section}&filter=awaiting`}>Show those waiting in this category</Link>, or switch category to see others.
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
          <div className="border-t border-rule p-5">
            <p className="mb-3 text-sm text-muted">{data.visible ? "The report is shown on the public site." : "The report is hidden from the public site."}
              {data.reportedAsOf ? ` It is dated ${formatCalendarDate(data.reportedAsOf)}.` : ""}</p>
            <SettingsForm visible={data.visible} reportedAsOf={data.reportedAsOf} />
          </div>
        </details>
      ) : null}

      {e ? (
        <section id="edit" aria-labelledby="edit-h" className="flex flex-col gap-5 rounded-md border-2 border-accent bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="edit-h" className="font-serif text-xl font-semibold text-ink-strong">{e.name}</h2>
            <Link href={base()} className="text-sm font-semibold">Close</Link>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2 rounded border border-rule-soft bg-surface p-4 text-sm">
              <p><span className={`inline-flex rounded border px-2 py-0.5 text-[12px] font-semibold ${STATE_BADGE[e.state_].className}`}>{STATE_BADGE[e.state_].label}</span></p>
              {e.verifiedAt
                ? <p className="text-muted">Last verified {formatDateTime(e.verifiedAt)}{e.verifiedByName ? ` by ${e.verifiedByName}` : ""}. The public site shows that version.</p>
                : <p className="text-muted">Never verified, so not public yet.</p>}
              {e.editorNames.length ? <p className="text-muted">Edited since by {e.editorNames.join(", ")}.</p> : null}
              {e.returnNote ? <Notice tone="danger" title="Returned for fixes">{e.returnNote} Fix it and save; the record goes back for verification.</Notice> : null}
              {e.state_ === "awaiting" || e.state_ === "returned" ? (
                <div>
                  <p className="font-semibold text-ink">Waiting for verification:</p>
                  <ul className="ml-5 list-disc text-muted">{changes(e).map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
              ) : null}
              {mayVerify(e) ? (
                <div className="mt-2 flex flex-col gap-3 border-t border-rule-soft pt-3">
                  <p className="text-[13px] text-muted">Open each evidence link, confirm it is this institution’s own page and shows what the status says, then verify.</p>
                  <VerifyForm entryId={e.id} hash={e.hash} />
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-accent">Return it to the editor instead</summary>
                    <ReturnForm entryId={e.id} />
                  </details>
                </div>
              ) : canVerify && e.state_ === "awaiting" && e.editorIds.includes(viewer.userId) ? (
                <p className="mt-2 border-t border-rule-soft pt-3 text-[13px] text-muted">You edited this record, so another reviewer must verify it.</p>
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
              <CheckLinksForm entryId={e.id} />
            </div>
          </div>

          <EntryForm key={e.id}formKey={`edit-${e.id.slice(0, 8)}`} entryId={e.id} initial={toValues(e)} today={today} />
          {isAdmin ? (
            <details className="rounded border border-[#e8b4b4]">
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-danger">Remove from the report</summary>
              <div className="border-t border-[#e8b4b4] p-4"><DeleteEntryForm entryId={e.id} name={e.name} /></div>
            </details>
          ) : null}
        </section>
      ) : null}

      {canEdit ? (
        <details className="rounded-md border border-rule bg-white">
          <summary className="min-h-11 cursor-pointer px-5 py-3 text-sm font-semibold text-accent">Add an institution</summary>
          <div className="border-t border-rule p-5">
            <EntryForm formKey="new" entryId={null} today={today} initial={{ section, name: "", state: null, head: null, bursar: null, homepageUrl: null,
              disclosureUrl: null, extraLinks: [], assessments: {}, trackerClaims: {}, websiteText: null }} />
          </div>
        </details>
      ) : null}

      <nav aria-label="Category" className="flex flex-col gap-2">
        {(["Federal", "State"] as const).map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-[12px] font-semibold uppercase tracking-[0.1em] text-subtle">{group}</span>
            {REPORT_SECTIONS.filter((s) => s.ownership === group).map((s) => (
              <Link key={s.key} href={`/admin/report?section=${s.key}${filter !== "all" ? `&filter=${filter}` : ""}`} aria-current={s.key === section ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded border px-4 text-sm font-semibold no-underline ${s.key === section ? "border-accent bg-accent text-white!" : "border-rule bg-white text-ink hover:border-accent"}`}>
                {s.label.replace(/^(Federal|State) /, "").replace(/^./, (ch) => ch.toUpperCase())}
                <span className={`rounded-full px-2 text-[12px] ${s.key === section ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{data.counts[s.key]}</span>
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
              {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center rounded bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover">Apply</button>
          {q || filter !== "all" ? <Link href={`/admin/report?section=${section}`} className="inline-flex min-h-11 items-center text-sm font-semibold">Clear</Link> : null}
        </form>
        {canEdit ? <CheckBatchForm section={section} /> : null}
      </div>

      <div className="overflow-x-auto rounded-md border border-rule bg-white">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <caption className="sr-only">{active.label} in the register</caption>
          <thead>
            <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
              <th scope="col" className="px-3 py-2.5">Institution</th>
              <th scope="col" className="px-3 py-2.5">Verification</th>
              <th scope="col" className="px-3 py-2.5">Working copy</th>
              {INDICATORS.map((d) => <th key={d.key} scope="col" className="px-1 py-2.5 text-center"><abbr title={d.label} className="no-underline">{d.short}</abbr></th>)}
              <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((r) => {
              const score = scoreRecord(r.assessments);
              const label = recordLabel(score.label);
              const badge = STATE_BADGE[r.state_];
              return (
                <tr key={r.id} className={`border-t border-rule-soft align-top ${e?.id === r.id ? "bg-accent-soft" : ""}`}>
                  <th scope="row" className="max-w-[280px] px-3 py-2.5 text-left font-normal">
                    <span className="font-semibold text-ink-strong">{r.name}</span>
                    <span className="block text-[12px] text-muted">{r.state ?? "State not recorded"}{r.disclosureUrl ? "" : " · no disclosure page"}</span>
                  </th>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[12px] font-semibold ${badge.className}`}>{badge.label}</span>
                    {r.verifiedAt ? <span className="mt-1 block text-[11px] text-muted">{formatCalendarDate(r.verifiedAt.slice(0, 10))}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    <span className="font-semibold">{label.label}</span>
                    {score.label !== "incomplete" && score.available ? <span className="block text-muted">{formatPoints(score.points)} of {score.available}</span> : null}
                  </td>
                  {INDICATORS.map((d) => <td key={d.key} className="px-1 py-2.5 text-center"><StatusIcon status={r.assessments[d.key]?.status} label={d.label} size={20} /></td>)}
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <Link href={`${base({ edit: r.id })}#edit`} className="inline-flex min-h-9 items-center rounded border border-accent px-3 text-[13px] font-semibold no-underline hover:bg-accent-soft">
                        {mayVerify(r) ? "Review" : "Edit"}
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

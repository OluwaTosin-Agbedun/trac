import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { ROW_FILTERS, ROW_PAGE_SIZE, getImportDetail, searchInstitutions, type RowFilter } from "@/server/data/cms/imports";
import { Notice } from "@/components/ui/Form";
import { INDICATORS } from "@/lib/indicators";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { CommitForm, DecisionForm, ReportForm } from "../_components/ImportForms";
import { asUser } from "@/server/db";

export const metadata: Metadata = { title: "Import review", robots: { index: false } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const SECTION_LABEL: Record<string, string> = {
  federal_university: "Federal universities", federal_polytechnic: "Federal polytechnics", federal_monotechnic: "Federal monotechnics",
  state_university: "State universities", state_polytechnic: "State polytechnics", state_monotechnic: "State monotechnics",
};
const FILTER_LABEL: Record<RowFilter, string> = {
  needs_decision: "Needs a decision", needs_match: "Needs matching", held: "All held", ready: "Ready to commit",
  committed: "Committed", skipped: "Skipped", all: "All rows",
};
const ISSUE_LABEL: Record<string, string> = {
  ref_serial: "#REF! serial", missing_name: "No name", blank_indicator: "Blank indicator cell", state_conflict: "State conflict",
  location_not_state: "Location is a town", website_missing: "No website", website_not_url: "Website cell is not a URL",
  website_multiple_urls: "Several URLs", website_missing_protocol: "URL without https://", website_share_link: "Google share link",
  website_markdown_link: "Markdown link", website_merged_status: "Status merged into website", website_third_party: "Third-party site",
  potential_duplicate: "Possible duplicate", shared_domain: "Shared domain", website_hyperlink: "Address from hyperlink",
};

function legacyMark(v: boolean | null | undefined) {
  if (v === true) return <span title="Legacy claim: disclosed" className="font-semibold text-ink">T</span>;
  if (v === false) return <span title="Legacy claim: not recorded as disclosed" className="text-muted">F</span>;
  return <span title="Blank in the source" className="text-warn-text">—</span>;
}

async function ImportBody({ params, searchParams }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? ""; };
  const filter = (ROW_FILTERS as readonly string[]).includes(one("filter")) ? (one("filter") as RowFilter) : "needs_decision";
  const issue = /^[a-z_]{3,40}$/.test(one("issue")) ? one("issue") : null;
  const pageNum = Math.max(1, Math.min(1000, Number.parseInt(one("page") || "1", 10) || 1));
  const q = one("q").slice(0, 100);
  const viewer = await requireViewer();
  if (viewer.role === "editor") {
    return <Notice tone="warn" title="Reviewers and administrators only">Imports are managed by reviewers and administrators.</Notice>;
  }
  const d = await getImportDetail(viewer, id, filter, issue, pageNum);
  if (!d) notFound();
  const options = await searchInstitutions(viewer, q);
  const isAdmin = viewer.role === "admin";
  const [shown] = await asUser(viewer.userId, (tx) => tx.query<{ published_at: Date | string }>(
    "select published_at from public_reports where hidden_at is null and import_id = $1", [id]));
  const shownSince = shown ? (shown.published_at instanceof Date ? shown.published_at.toISOString() : String(shown.published_at)) : null;
  const pages = Math.max(1, Math.ceil(d.total / ROW_PAGE_SIZE));
  const href = (change: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { filter, issue, q: q || null, page: null as string | null, ...change };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/imports/${id}${s ? `?${s}` : ""}`;
  };
  const ignored = Array.isArray(d.summary.ignored) ? (d.summary.ignored as { reason: string }[]) : [];
  const filterCount: Record<RowFilter, number> = {
    needs_decision: d.counts.needsDecision, needs_match: d.counts.needsMatch, held: d.counts.held, ready: d.counts.ready,
    committed: d.counts.committed, skipped: d.counts.skipped, all: d.counts.candidates,
  };

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/admin/imports">Imports</Link> / {d.fileName}</nav>
      <header className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h1 className="font-serif text-2xl font-semibold text-ink-strong">{d.fileName}</h1>
        {one("existing") ? <Notice tone="info">This exact file was already staged, so the existing import is shown. Nothing was duplicated.</Notice> : null}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[13px] text-muted">Uploaded</dt><dd>{formatDateTime(d.uploadedAt)}{d.uploadedByName ? ` by ${d.uploadedByName}` : ""}</dd></div>
          <div><dt className="text-[13px] text-muted">Dataset reported as at</dt><dd>{formatCalendarDate(d.reportedAsOf)} <span className="text-muted">(not a verification date)</span></dd></div>
          <div><dt className="text-[13px] text-muted">File fingerprint (SHA-256)</dt><dd><code className="text-[12px]">{d.contentHash.slice(0, 16)}…</code></dd></div>
          <div><dt className="text-[13px] text-muted">Parser</dt><dd>{d.parserVersion}</dd></div>
        </dl>
      </header>

      <section aria-labelledby="summary-h" className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-rule bg-white p-5 lg:col-span-2">
          <h2 id="summary-h" className="font-serif text-xl font-semibold text-ink-strong">Validation summary</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              ["Candidate rows", d.counts.candidates], ["Held for a decision", d.counts.heldPending],
              ["Needs matching (name already exists)", d.counts.needsMatch], ["Ready to commit", d.counts.ready],
              ["Committed (drafts or links)", d.counts.committed], ["Skipped", d.counts.skipped],
              ["Ignored (title, headings, template)", ignored.filter((x) => x.reason !== "blank").length],
            ].map(([label, n]) => (
              <div key={String(label)} className="rounded border border-rule-soft p-3">
                <dt className="text-[12px] text-muted">{label}</dt>
                <dd className="font-serif text-2xl font-semibold text-ink-strong">{n}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-5 text-sm font-semibold text-ink">Rows by section (candidates, before deduplication)</h3>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {d.bySection.map((s) => <li key={s.section} className="flex justify-between border-b border-rule-soft py-1"><span>{SECTION_LABEL[s.section] ?? s.section}</span><span className="font-semibold">{s.count}</span></li>)}
          </ul>
        </div>
        <div className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
          <h2 className="font-serif text-xl font-semibold text-ink-strong">Commit</h2>
          <p className="text-sm text-muted">
            Creates private drafts for rows with no holding issue whose name is new, and for rows you chose to create. Held
            rows, and rows whose name matches an institution that already exists, wait for your decision: nothing is
            duplicated or merged automatically. A web address is copied into a draft only when the cell held one valid
            address as written; repaired, ambiguous or shared addresses stay on the import for an editor to confirm. Safe to
            run again.
          </p>
          {isAdmin ? <CommitForm importId={d.id} ready={d.counts.ready} /> : <p className="text-sm text-muted">Administrators commit imports.</p>}
          <div className="mt-2 flex flex-col gap-2 border-t border-rule-soft pt-4">
            <h3 className="text-base font-semibold text-ink-strong">Public compliance report</h3>
            <p className="text-sm text-muted">
              {shownSince
                ? `This spreadsheet is the report on the public site (since ${formatDateTime(shownSince)}). Visitors see each federal institution with the status recorded for each indicator.`
                : "Shows this spreadsheet's federal institutions on the public Institutions page, with the status recorded for each indicator. It replaces any report shown before. Drafts and notes stay private."}
            </p>
            {isAdmin ? <ReportForm importId={d.id} shown={Boolean(shownSince)} /> : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="rows-h" className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
        <h2 id="rows-h" className="font-serif text-xl font-semibold text-ink-strong">Rows</h2>
        <nav aria-label="Row filter" className="flex flex-wrap gap-2 text-sm">
          {ROW_FILTERS.map((f) => (
            <Link key={f} href={href({ filter: f, issue: null })} aria-current={f === filter ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded border px-3 no-underline ${f === filter ? "border-accent bg-accent text-white" : "border-rule text-ink hover:bg-surface"}`}>
              {FILTER_LABEL[f]} · {filterCount[f]}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2 text-[13px]">
          <span className="font-semibold text-ink">Issues:</span>
          {d.issueCounts.map((c) => (
            <Link key={c.code} href={href({ issue: issue === c.code ? null : c.code, filter: "all" })} aria-current={issue === c.code ? "true" : undefined}
              className={`rounded border px-2 py-1 no-underline ${issue === c.code ? "border-accent bg-accent-soft text-accent" : "border-rule-soft text-ink"}`}>
              {ISSUE_LABEL[c.code] ?? c.code} · {c.count}
            </Link>
          ))}
        </div>
        {isAdmin ? (
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="filter" value={filter} />
            {issue ? <input type="hidden" name="issue" value={issue} /> : null}
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold">Find institutions to match (name)</span>
              <input name="q" defaultValue={q} className="min-h-11 rounded border border-[#b9c1cc] px-3" />
            </label>
            <button type="submit" className="min-h-11 rounded border border-accent px-4 font-semibold text-accent">Search</button>
            {q ? <span className="text-[13px] text-muted">{options.length} found for “{q}”</span> : null}
          </form>
        ) : null}
        <p className="text-sm text-muted">{d.total} rows · page {d.page} of {pages}. T/F are legacy claims (unverified) from the source file; — means the cell was blank.</p>
        <ol className="flex flex-col gap-3">
          {d.rows.map((r) => (
            <li key={r.id} className="rounded border border-rule-soft p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold text-ink-strong">{r.name ?? <span className="text-warn-text">Unnamed row</span>}</h3>
                <span className="text-[12px] text-muted">{SECTION_LABEL[r.section] ?? r.section} #{r.sectionIndex} · source line {r.sourceLine} · serial “{r.serialRaw}”</span>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
                <div><dt className="text-muted">State cell</dt><dd>{r.stateRaw ?? "—"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted">Website cell (as written)</dt><dd className="break-all">{r.websiteRaw ?? "—"}</dd></div>
                <div className="sm:col-span-3">
                  <dt className="text-muted">Website for the draft</dt>
                  <dd className="break-all">
                    {r.websiteConfirmed ? (
                      <>{r.websiteCandidates[0]} <span className="text-muted">(copied, as written)</span></>
                    ) : r.websiteCandidates.length ? (
                      <>Not copied: an editor confirms it. <span className="text-muted">Proposed: {r.websiteCandidates.join(" · ")}</span></>
                    ) : "None"}
                  </dd>
                </div>
                <div><dt className="text-muted">Legacy report status (verbatim)</dt><dd>{r.legacyStatusRaw ?? "blank"}</dd></div>
                <div className="sm:col-span-2">
                  <dt className="text-muted">Legacy claims (unverified) — from the source file; not findings</dt>
                  <dd className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                    {INDICATORS.map((ind) => <span key={ind.key} className="whitespace-nowrap">{ind.short} {legacyMark(r.legacyIndicators[ind.key])}</span>)}
                  </dd>
                </div>
              </dl>
              {r.issues.length ? (
                <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                  {r.issues.map((i, n) => (
                    <li key={n} className={i.holds ? "text-danger" : "text-muted"}>
                      <span className="font-semibold">{i.holds ? "Holds: " : "Note: "}{ISSUE_LABEL[i.code] ?? i.code}.</span> {i.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3">
                {r.institutionId ? (
                  <p className="text-sm">Committed. <Link href={`/admin/institutions/${r.institutionId}`} className="font-semibold">Open the institution</Link>{r.decisionNote ? <span className="text-muted"> · {r.decisionNote}</span> : null}</p>
                ) : r.decision === "skip" ? (
                  <p className="text-sm text-muted">Skipped: {r.decisionNote}</p>
                ) : r.decision === "create_new" ? (
                  <p className="text-sm">Will be created as a new institution on the next commit.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {r.match ? (
                      <p className="text-sm">
                        An institution with this name already exists:{" "}
                        <Link href={`/admin/institutions/${r.match.id}`} className="font-semibold">{r.match.name}</Link>.
                        Commit will not create this row until {isAdmin ? "you decide" : "an administrator decides"}: match it to that
                        institution (its data is not changed), or create a separate institution only if they are different.
                      </p>
                    ) : null}
                    {isAdmin && (r.held || r.match) ? (
                      <DecisionForm importId={d.id} rowId={r.id} unnamed={!r.name} suggested={r.match} options={options} />
                    ) : r.held ? (
                      <p className="text-sm text-muted">Held until an administrator decides.</p>
                    ) : !r.match ? (
                      <p className="text-sm text-muted">No holding issues and a new name: created on the next commit.</p>
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        {pages > 1 ? (
          <nav aria-label="Pagination" className="flex flex-wrap gap-2 text-sm">
            {d.page > 1 ? <Link href={href({ page: String(d.page - 1) })} className="inline-flex min-h-11 items-center rounded border border-rule px-4 no-underline">Previous</Link> : null}
            <span className="inline-flex min-h-11 items-center px-2 text-muted">Page {d.page} of {pages}</span>
            {d.page < pages ? <Link href={href({ page: String(d.page + 1) })} className="inline-flex min-h-11 items-center rounded border border-rule px-4 no-underline">Next</Link> : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}

export default function ImportDetailPage(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the import…</p>}>
      <ImportBody params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

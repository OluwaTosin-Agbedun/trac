// The public report: every institution in the register. Only records a second person has verified
// show their statuses, score and links; the rest show "Verification in progress". Each verified
// record is scored under the assessment year it was verified with.
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getRegister, getRegisterStatus, type PublicRegister, type RegisterRow, type RegisterStatus } from "@/server/data/public";
import { INDICATORS } from "@/lib/indicators";
import { REPORT_SECTIONS, type ReportSectionInfo } from "@/lib/report";
import { ASSESSMENT_STATUSES } from "@/lib/register";
import { formatDate, formatCount } from "@/lib/format";
import { Field, inputClass } from "@/components/ui/Form";
import { StatusIcon } from "@/components/register/StatusIcon";
import { FindingMark } from "@/components/register/FindingMark";
import { RecordResult } from "@/components/register/RecordResult";
import {
  INDICATOR_GROUPS_IN_ORDER, LIST_SORTS, countBySection, filterRows, hostOf, httpUrl, listHref, parseListParams, scoreRow, statesIn,
  type ListParams,
} from "@/components/register/view";
import { RegisterError, RegisterHidden, SCOPE_SENTENCE } from "@/components/public/Notices";

export const metadata: Metadata = {
  title: "Institutions",
  description:
    "Federal and state universities, polytechnics and monotechnics, and whether each publishes its budget, research grants, TETFund allocation, endowment fund and student population on its official website, with the evidence for every finding.",
};

const INDICATOR_HELP: Record<string, string> = {
  budget_personnel: "Annual budgetary allocation for personnel costs (salaries and staff costs).",
  budget_overhead: "Annual budgetary allocation for overhead (running) costs.",
  budget_capital: "Annual budgetary allocation for capital expenditure (projects, buildings, equipment).",
  grants_domestic: "Research grant revenue from Nigerian sources for the previous year.",
  grants_international: "Research grant revenue from international sources for the previous year.",
  tetfund_allocation: "TETFund intervention allocation for the current year.",
  endowment_fund: "Endowment fund for the previous year.",
  students_undergraduate: "Total undergraduate student population.",
  students_postgraduate: "Total postgraduate student population.",
};

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

export default function InstitutionsPage(props: PageProps<"/institutions">) {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex max-w-3xl flex-col gap-3">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Financial Transparency Compliance Report</p>
        <h1 className="font-serif text-4xl font-semibold leading-tight tracking-[-0.015em] text-ink-strong">Institutions</h1>
        <p className="text-base leading-relaxed text-[#2b3442]">
          Whether each federal and state university, polytechnic and monotechnic publishes the information the directive
          requires on its official website. Every finding links to its evidence, with the reporting year and the date it was
          checked, and every record is verified by a second reviewer before it appears here.{" "}
          <Link href="/methodology">How we score</Link>.
        </p>
        <p className="text-[15px] text-muted">{SCOPE_SENTENCE}</p>
      </header>
      <Suspense fallback={<p role="status" className="text-sm text-muted">Loading the report…</p>}>
        <ReportBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

function IndicatorKey() {
  return (
    <section aria-labelledby="key-h" className="rounded-md border border-rule bg-white p-5">
      <h2 id="key-h" className="font-serif text-xl font-semibold text-ink-strong">Key</h2>
      <p className="mt-1 text-sm text-muted">The nine indicators every institution is expected to publish on its official website.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {INDICATOR_GROUPS_IN_ORDER.map((g) => (
          <div key={g.group} className="rounded border border-rule-soft bg-surface p-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-accent">{g.group}</h3>
            <dl className="mt-2 flex flex-col gap-2 text-sm">
              {g.items.map((i) => (
                <div key={i.key} className="grid grid-cols-[4.5rem_1fr] gap-2">
                  <dt><abbr title={i.label} className="font-semibold text-ink-strong no-underline">{i.short}</abbr></dt>
                  <dd className="text-[#2b3442]"><span className="font-semibold">{i.label}.</span> {INDICATOR_HELP[i.key]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-rule-soft pt-3 text-[13px] text-ink sm:grid-cols-2 lg:grid-cols-4">
        {ASSESSMENT_STATUSES.map((s) => (
          <div key={s.value} className="flex items-start gap-2">
            <dt className="shrink-0"><StatusIcon status={s.value} /></dt>
            <dd><span className="font-semibold">{s.label}.</span> <span className="text-muted">{s.meaning}</span></dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-rule-soft pt-3 text-[13px] text-ink">
        <span className="font-semibold">Years.</span> The year under each mark is the reporting year of the evidence.{" "}
        <span className="font-semibold text-danger">Outdated</span> means the evidence is for a year before the indicator&apos;s
        period, so it counts 0.
      </p>
    </section>
  );
}

function EvidenceLinks({ row }: { row: RegisterRow }) {
  const v = row.verified!;
  const disclosure = httpUrl(v.disclosure_url);
  const homepage = httpUrl(v.homepage_url);
  return (
    <>
      {disclosure ? (
        <a href={disclosure} {...EXTERNAL} className="font-semibold">
          View disclosure evidence<span className="sr-only"> for {row.name} (opens in a new tab)</span>
        </a>
      ) : <span className="text-muted">No disclosure page</span>}
      {homepage ? (
        <a href={homepage} {...EXTERNAL} className="block break-all text-[12px] text-muted">
          {hostOf(homepage)}<span className="sr-only"> (official website, opens in a new tab)</span>
        </a>
      ) : null}
    </>
  );
}

function InProgress() {
  return (
    <>
      <span className="inline-flex rounded border border-rule bg-surface px-2 py-0.5 text-[12px] font-semibold text-muted">Verification in progress</span>
      <span className="ml-2 text-[12px] text-muted">Shown once the research team has checked the evidence and a second reviewer has verified it.</span>
    </>
  );
}

/** Wide screens: a table with the institution column fixed while the indicators scroll. */
function ReportTable({ rows, section, caption }: { rows: RegisterRow[]; section: ReportSectionInfo; caption: string }) {
  const sticky = "sticky left-0 border-r border-rule-soft";
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="hidden overflow-x-auto rounded-md border border-rule bg-white md:block">
      <table className="w-full min-w-[1180px] border-collapse text-sm">
        <caption className="sr-only">{caption}: verified disclosure status for each of the nine indicators, with the reporting year and links to the evidence</caption>
        <thead>
          <tr className="bg-band text-left text-[12px] uppercase tracking-[0.04em] text-white">
            <th scope="col" className={`${sticky} z-20 bg-band px-3 py-2.5`}>Institution</th>
            <th scope="col" className="px-3 py-2.5">Evidence</th>
            <th scope="col" className="px-3 py-2.5">Result</th>
            {INDICATORS.map((d) => (
              <th key={d.key} scope="col" className="px-1.5 py-2.5 text-center"><abbr title={d.label} className="no-underline">{d.short}</abbr></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.verified;
            const score = scoreRow(r);
            return (
              <tr key={r.id} className="border-t border-rule-soft align-top">
                <th scope="row" className={`${sticky} z-10 w-[260px] min-w-[220px] bg-white px-3 py-3 text-left font-normal`}>
                  <Link href={`/institutions/${r.slug}`} className="font-semibold">{r.name}</Link>
                  <span className="block text-[12px] text-muted">{r.state ?? "State not recorded"}</span>
                  {v?.head_name ? <span className="block text-[12px] text-muted">{section.head}: {v.head_name}</span> : null}
                </th>
                {v && score ? (
                  <>
                    <td className="max-w-[220px] px-3 py-3 text-[13px]"><EvidenceLinks row={r} /></td>
                    <td className="px-3 py-3"><RecordResult score={score} /></td>
                    {INDICATORS.map((d) => (
                      <td key={d.key} className="px-1.5 py-3 text-center">
                        <FindingMark indicatorKey={d.key} label={d.label} assessment={v.assessments?.[d.key]} assessmentYear={r.verifiedAssessmentYear} />
                      </td>
                    ))}
                  </>
                ) : (
                  <td colSpan={2 + INDICATORS.length} className="px-3 py-3"><InProgress /></td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Phones: one card per institution, the nine findings in a grid. */
function ReportCards({ rows, section }: { rows: RegisterRow[]; section: ReportSectionInfo }) {
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {rows.map((r) => {
        const v = r.verified;
        const score = scoreRow(r);
        return (
          <li key={r.id} className="rounded-md border border-rule bg-white p-4">
            <h3 className="text-[16px] font-semibold leading-snug">
              <Link href={`/institutions/${r.slug}`} className="inline-flex min-h-11 items-center">{r.name}</Link>
            </h3>
            <p className="text-[13px] text-muted">
              {r.state ?? "State not recorded"}{v?.head_name ? ` · ${section.head}: ${v.head_name}` : ""}
            </p>
            {v && score ? (
              <>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                  <RecordResult score={score} />
                  <span className="text-[13px]"><EvidenceLinks row={r} /></span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-rule-soft pt-3 text-[13px] sm:grid-cols-3">
                  {INDICATORS.map((d) => (
                    <div key={d.key} className="flex flex-col gap-0.5">
                      <dt className="text-[12px] font-semibold text-muted">{d.label}</dt>
                      <dd>
                        <FindingMark indicatorKey={d.key} label={d.label} assessment={v.assessments?.[d.key]}
                          assessmentYear={r.verifiedAssessmentYear} layout="inline" />
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : <p className="mt-2"><InProgress /></p>}
          </li>
        );
      })}
    </ul>
  );
}

function SectionResults({ rows, section, headingId, all }: { rows: RegisterRow[]; section: ReportSectionInfo; headingId: string; all: number }) {
  const verified = rows.filter((r) => r.verified).length;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="scroll-mt-4 font-serif text-2xl font-semibold text-ink-strong">{section.label}</h2>
      <p className="text-sm text-muted">
        {formatCount(rows.length)} of {formatCount(all)} {section.label.toLowerCase()} shown · {formatCount(verified)} of these verified so far
      </p>
      <ReportTable rows={rows} section={section} caption={section.label} />
      <ReportCards rows={rows} section={section} />
    </section>
  );
}

function StatusLine({ status }: { status: RegisterStatus }) {
  return (
    <p className="text-sm text-muted">
      {status.lastVerifiedAt
        ? <>Last verification: <strong className="text-ink">{formatDate(status.lastVerifiedAt)}</strong></>
        : <>No record has been verified yet</>}
      {status.assessmentYear ? <> · Assessment year: <strong className="text-ink">{status.assessmentYear}</strong></> : null}
      {" · "}{formatCount(status.verified)} of {formatCount(status.listed)} institutions verified so far
    </p>
  );
}

function SearchForm({ p, states }: { p: ListParams; states: string[] }) {
  return (
    <Form action="/institutions" role="search" aria-label="Search the register" className="flex flex-wrap items-end gap-4">
      {/* The category is kept for filters without a search; a search always covers every category. */}
      <input type="hidden" name="section" value={p.section} />
      <div className="min-w-0 flex-[2_1_240px]">
        <Field id="r-q" label="Search all categories">
          <input id="r-q" name="q" type="search" defaultValue={p.qRaw} maxLength={100} placeholder="Institution, state or head" className={inputClass()} />
        </Field>
      </div>
      <div className="min-w-0 flex-[1_1_160px]">
        <Field id="r-state" label="State">
          <select id="r-state" name="state" defaultValue={p.state} className={inputClass()}>
            <option value="">All states</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="min-w-0 flex-[1_1_160px]">
        <Field id="r-sort" label="Sort by">
          <select id="r-sort" name="sort" defaultValue={p.sort} className={inputClass()}>
            {LIST_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" name="verified" value="1" defaultChecked={p.verifiedOnly} className="h-5 w-5" /> Verified only
      </label>
      <div className="flex items-center gap-4">
        <button type="submit" className="inline-flex min-h-11 items-center rounded bg-accent px-5 text-[15px] font-semibold text-white hover:bg-accent-hover">Search</button>
        {p.q || p.state || p.verifiedOnly || p.sort !== "name" ? (
          <Link href={listHref({ section: p.section })} className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">Clear</Link>
        ) : null}
      </div>
    </Form>
  );
}

async function ReportBody({ searchParams }: { searchParams: PageProps<"/institutions">["searchParams"] }) {
  await connection();
  const p = parseListParams(await searchParams);
  let register: PublicRegister;
  let status: RegisterStatus;
  try {
    [register, status] = await Promise.all([getRegister(), getRegisterStatus()]);
  } catch (err) {
    console.error("[report] could not load the register:", err instanceof Error ? err.message : err);
    return <RegisterError />;
  }
  if (!status.visible) return <RegisterHidden />;
  if (!register.rows.length) {
    return (
      <section className="rounded-md border border-rule bg-surface px-6 py-10 text-center">
        <h2 className="font-serif text-xl font-semibold text-ink-strong">The report has not been published yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted">The report appears here once the research team has loaded the institutions.</p>
      </section>
    );
  }

  const searching = Boolean(p.q);
  const totals = countBySection(register.rows);
  // A search covers every category; without one, the chosen category tab is shown.
  const matches = filterRows(searching ? register.rows : register.rows.filter((r) => r.section === p.section), p);
  const matchCounts = countBySection(searching ? matches : filterRows(register.rows, p));
  const active = REPORT_SECTIONS.find((s) => s.key === p.section)!;
  const keep = { state: p.state, verified: p.verifiedOnly, sort: p.sort };

  return (
    <div className="flex flex-col gap-6">
      <StatusLine status={status} />

      <nav aria-label={searching ? "Search results by category" : "Category"} className="flex flex-col gap-3">
        {(["Federal", "State"] as const).map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-[12px] font-semibold uppercase tracking-[0.1em] text-subtle">{group}</span>
            {REPORT_SECTIONS.filter((s) => s.ownership === group).map((s) => {
              const current = !searching && s.key === active.key;
              const n = searching || p.state || p.verifiedOnly ? matchCounts[s.key] : totals[s.key];
              const text = (
                <>
                  <span><span className="sr-only">{s.ownership} </span>{s.short}</span>
                  <span className={`rounded-full px-2 text-[12px] ${current ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{n}<span className="sr-only">{searching ? " matching" : ""}</span></span>
                </>
              );
              // While searching, a category with no matches has nothing to jump to.
              if (searching && n === 0) {
                return <span key={s.key} className="inline-flex min-h-11 items-center gap-2 rounded border border-rule-soft px-4 text-[15px] font-semibold text-muted">{text}</span>;
              }
              return (
                <Link key={s.key}
                  href={searching ? `#sec-${s.key}` : listHref({ section: s.key, ...keep })}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center gap-2 rounded border px-4 text-[15px] font-semibold no-underline ${current ? "border-band bg-band text-white!" : "border-rule bg-white text-ink hover:border-accent hover:text-accent"}`}>
                  {text}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <SearchForm p={p} states={statesIn(register.rows)} />

      <IndicatorKey />

      {searching ? (
        <>
          <p aria-live="polite" className="text-[15px] text-ink">
            {formatCount(matches.length)} {matches.length === 1 ? "institution matches" : "institutions match"} “{p.qRaw}” across all categories.
          </p>
          {matches.length ? REPORT_SECTIONS.filter((s) => matchCounts[s.key] > 0).map((s) => (
            <SectionResults key={s.key} rows={matches.filter((r) => r.section === s.key)} section={s} headingId={`sec-${s.key}`} all={totals[s.key]} />
          )) : (
            <p className="rounded-md border border-rule bg-surface px-6 py-8 text-center text-[15px] text-muted">
              No institution matches. <Link href={listHref({ section: p.section })} className="underline underline-offset-2">Clear the search</Link>.
            </p>
          )}
        </>
      ) : matches.length ? (
        <SectionResults rows={matches} section={active} headingId="sec-active" all={totals[active.key]} />
      ) : (
        <p aria-live="polite" className="rounded-md border border-rule bg-surface px-6 py-8 text-center text-[15px] text-muted">
          No {active.label.toLowerCase()} match. <Link href={listHref({ section: active.key })} className="underline underline-offset-2">Clear the filters</Link>.
        </p>
      )}
    </div>
  );
}

// The public compliance report: every federal institution in the tracker spreadsheet an
// administrator chose to show, with the status recorded for each of the nine indicators.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getComplianceReport, type ReportRow } from "@/server/data/public";
import { REPORT_SECTIONS, type ReportSection } from "@/lib/report";
import { INDICATORS } from "@/lib/indicators";
import { formatCalendarDate, formatCount } from "@/lib/format";
import { Field, inputClass } from "@/components/ui/Form";

export const metadata: Metadata = {
  title: "Institutions",
  description:
    "Federal universities, polytechnics and monotechnics, and whether each publishes its budget, research grants, TETFund allocation, endowment fund and student population on its official website.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** What each indicator column means, in the order of the report. */
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

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export default function InstitutionsPage(props: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex max-w-3xl flex-col gap-3">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Financial Transparency Compliance Report</p>
        <h1 className="font-serif text-4xl font-semibold leading-tight tracking-[-0.015em] text-ink-strong">Federal institutions</h1>
        <p className="text-base leading-relaxed text-[#2b3442]">
          Whether each federal university, polytechnic and monotechnic publishes the information the directive requires on its
          official website. Each column is one of the nine indicators explained in the key below.
        </p>
      </header>
      <Suspense fallback={<p role="status" className="text-sm text-muted">Loading the report…</p>}>
        <ReportBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

function statusTone(raw: string | null): { text: string; className: string } {
  const s = (raw ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return { text: "Not recorded", className: "border-rule bg-surface text-muted" };
  if (s.startsWith("YES")) return { text: "Updated", className: "border-[#b7dcc5] bg-ok-bg text-ok" };
  if (s.startsWith("PARTIAL")) return { text: "Partially updated", className: "border-warn-rule bg-warn-bg text-warn-text" };
  if (s.includes("NOT YET")) return { text: "Not yet updated", className: "border-[#e8b4b4] bg-danger-bg text-danger" };
  if (s.startsWith("NO")) return { text: "Not updated", className: "border-[#e8b4b4] bg-danger-bg text-danger" };
  return { text: raw!.trim(), className: "border-rule bg-surface text-ink" };
}

function Mark({ value, label }: { value: boolean | null | undefined; label: string }) {
  if (value === true) {
    return (
      <span title={`${label}: published`} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ok-bg text-ok">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="sr-only">{label}: published</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span title={`${label}: not published`} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-danger-bg text-danger">
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
        <span className="sr-only">{label}: not published</span>
      </span>
    );
  }
  return (
    <span title={`${label}: not recorded`} className="inline-flex h-6 w-6 items-center justify-center text-subtle">
      <span aria-hidden="true">–</span>
      <span className="sr-only">{label}: not recorded</span>
    </span>
  );
}

function IndicatorKey() {
  const groups = INDICATORS.reduce<{ group: string; items: (typeof INDICATORS)[number][] }[]>((acc, ind) => {
    const last = acc[acc.length - 1];
    if (last && last.group === ind.group) last.items.push(ind);
    else acc.push({ group: ind.group, items: [ind] });
    return acc;
  }, []);
  return (
    <section aria-labelledby="key-h" className="rounded-md border border-rule bg-white p-5">
      <h2 id="key-h" className="font-serif text-xl font-semibold text-ink-strong">Key</h2>
      <p className="mt-1 text-sm text-muted">The nine indicators every federal institution is expected to publish on its official website.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
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
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule-soft pt-3 text-[13px] text-ink">
        <span className="inline-flex items-center gap-2"><Mark value={true} label="Example" /> Published on the official website</span>
        <span className="inline-flex items-center gap-2"><Mark value={false} label="Example" /> Not published</span>
        <span className="inline-flex items-center gap-2"><Mark value={null} label="Example" /> Not recorded in the report</span>
      </div>
    </section>
  );
}

function ReportTable({ rows, head }: { rows: ReportRow[]; head: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule bg-white">
      <table className="w-full min-w-[1180px] border-collapse text-sm">
        <caption className="sr-only">Federal institutions and the status recorded for each of the nine indicators</caption>
        <thead>
          <tr className="bg-band text-left text-[12px] uppercase tracking-[0.04em] text-white">
            <th scope="col" rowSpan={2} className="px-3 py-2.5 align-bottom">S/N</th>
            <th scope="col" rowSpan={2} className="px-3 py-2.5 align-bottom">Institution</th>
            <th scope="col" rowSpan={2} className="px-3 py-2.5 align-bottom">State</th>
            <th scope="col" rowSpan={2} className="px-3 py-2.5 align-bottom">Official website</th>
            <th scope="col" rowSpan={2} className="px-3 py-2.5 align-bottom">Financial report</th>
            <th scope="colgroup" colSpan={3} className="border-l border-white/20 px-2 py-2 text-center">Budget</th>
            <th scope="colgroup" colSpan={2} className="border-l border-white/20 px-2 py-2 text-center">Research grants</th>
            <th scope="col" rowSpan={2} className="border-l border-white/20 px-2 py-2 text-center align-bottom"><abbr title="TETFund allocation" className="no-underline">TETFund</abbr></th>
            <th scope="col" rowSpan={2} className="border-l border-white/20 px-2 py-2 text-center align-bottom"><abbr title="Endowment fund" className="no-underline">Endow.</abbr></th>
            <th scope="colgroup" colSpan={2} className="border-l border-white/20 px-2 py-2 text-center">Students</th>
          </tr>
          <tr className="bg-band text-[12px] text-white">
            {["budget_personnel", "budget_overhead", "budget_capital", "grants_domestic", "grants_international"].map((k, i) => {
              const def = INDICATORS.find((d) => d.key === k)!;
              return <th key={k} scope="col" className={`px-2 pb-2 text-center font-semibold ${i === 0 || i === 3 ? "border-l border-white/20" : ""}`}><abbr title={def.label} className="no-underline">{def.short}</abbr></th>;
            })}
            {["students_undergraduate", "students_postgraduate"].map((k, i) => {
              const def = INDICATORS.find((d) => d.key === k)!;
              return <th key={k} scope="col" className={`px-2 pb-2 text-center font-semibold ${i === 0 ? "border-l border-white/20" : ""}`}><abbr title={def.label} className="no-underline">{def.short}</abbr></th>;
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => {
            const status = statusTone(r.reportStatus);
            return (
              <tr key={`${r.section}-${r.position}`} className="border-t border-rule-soft align-top odd:bg-white even:bg-surface/50">
                <td className="px-3 py-3 tabular-nums text-muted">{/^\d+$/.test(r.serial) ? r.serial : n + 1}</td>
                <th scope="row" className="max-w-[300px] px-3 py-3 text-left font-normal">
                  {r.institutionSlug ? (
                    <Link href={`/institutions/${encodeURIComponent(r.institutionSlug)}`} className="font-semibold">{r.name}</Link>
                  ) : (
                    <span className="font-semibold text-ink-strong">{r.name}</span>
                  )}
                  {r.head ? <span className="mt-1 block text-[12px] text-muted">{head}: {r.head}</span> : null}
                  {r.bursar ? <span className="block text-[12px] text-muted">Bursar: {r.bursar}</span> : null}
                </th>
                <td className="px-3 py-3">{r.state ?? "—"}</td>
                <td className="max-w-[220px] px-3 py-3">
                  {r.websiteUrl ? (
                    <a href={r.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-[13px]">
                      {r.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  ) : r.websiteText ? <span className="break-words text-[13px] text-muted">{r.websiteText}</span> : <span className="text-muted">—</span>}
                </td>
                <td className="px-3 py-3">
                  <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[12px] font-semibold ${status.className}`}>{status.text}</span>
                </td>
                {INDICATORS.map((d, i) => (
                  <td key={d.key} className={`px-2 py-3 text-center ${[0, 3, 5, 6, 7].includes(i) ? "border-l border-rule-soft" : ""}`}>
                    <Mark value={r.indicators[d.key]} label={d.label} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function ReportBody({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const report = await getComplianceReport();
  const active = REPORT_SECTIONS.find((s) => s.key === one(sp.section)) ?? REPORT_SECTIONS[0];
  const q = one(sp.q).slice(0, 100).toLowerCase();
  const state = one(sp.state).slice(0, 60);
  const inSection = report.rows.filter((r) => r.section === active.key);
  const states = [...new Set(inSection.map((r) => r.state).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b));
  const rows = inSection.filter((r) =>
    (!q || [r.name, r.state, r.head, r.bursar].some((v) => v?.toLowerCase().includes(q))) && (!state || r.state === state));
  const count = (k: ReportSection) => report.rows.filter((r) => r.section === k).length;
  const tabHref = (k: ReportSection) => `/institutions?section=${k}`;

  if (!report.rows.length) {
    return (
      <section className="rounded-md border border-rule bg-surface px-6 py-10 text-center">
        <h2 className="font-serif text-xl font-semibold text-ink-strong">The report has not been published yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted">
          The compliance report appears here once the team uploads the tracker spreadsheet and publishes it.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {report.reportedAsOf ? (
        <p className="text-sm text-muted">Report as at <strong className="text-ink">{formatCalendarDate(report.reportedAsOf)}</strong>.</p>
      ) : null}

      <nav aria-label="Category" className="flex flex-wrap gap-2">
        {REPORT_SECTIONS.map((s) => (
          <Link key={s.key} href={tabHref(s.key)} aria-current={s.key === active.key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded border px-4 text-[15px] font-semibold no-underline ${s.key === active.key ? "border-band bg-band text-white!" : "border-rule bg-white text-ink hover:border-accent hover:text-accent"}`}>
            {s.label}
            <span className={`rounded-full px-2 text-[12px] ${s.key === active.key ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{count(s.key)}</span>
          </Link>
        ))}
      </nav>

      <form action="/institutions" method="get" role="search" className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="section" value={active.key} />
        <div className="min-w-0 flex-[2_1_280px]">
          <Field id="r-q" label="Search">
            <input id="r-q" name="q" type="search" defaultValue={one(sp.q)} maxLength={100} placeholder="Institution, head or bursar" className={inputClass()} />
          </Field>
        </div>
        <div className="min-w-0 flex-[1_1_200px]">
          <Field id="r-state" label="State">
            <select id="r-state" name="state" defaultValue={state} className={inputClass()}>
              <option value="">All states</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex items-center gap-4">
          <button type="submit" className="inline-flex min-h-11 items-center rounded bg-accent px-5 text-[15px] font-semibold text-white hover:bg-accent-hover">Search</button>
          {q || state ? <Link href={tabHref(active.key)} className="text-sm font-semibold underline underline-offset-2">Clear</Link> : null}
        </div>
      </form>

      <IndicatorKey />

      <p aria-live="polite" className="text-sm text-muted">
        {rows.length === inSection.length
          ? `${formatCount(rows.length)} ${active.label.toLowerCase()}`
          : `${formatCount(rows.length)} of ${formatCount(inSection.length)} ${active.label.toLowerCase()}`}
      </p>

      {rows.length ? (
        <ReportTable rows={rows} head={active.head} />
      ) : (
        <p className="rounded-md border border-rule bg-surface px-6 py-8 text-center text-[15px] text-muted">
          No {active.label.toLowerCase()} match that search. <Link href={tabHref(active.key)} className="underline underline-offset-2">Clear the search</Link>.
        </p>
      )}
    </div>
  );
}

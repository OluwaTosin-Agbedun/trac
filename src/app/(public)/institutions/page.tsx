// The public report: every institution in the register. Only records a second person has verified
// show their statuses, score and links; the rest show "Verification in progress".
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getRegister, type RegisterRow } from "@/server/data/public";
import { INDICATORS } from "@/lib/indicators";
import { REPORT_SECTIONS, type ReportSection } from "@/lib/report";
import { ASSESSMENT_STATUSES, formatPoints, recordLabel, scoreRecord } from "@/lib/register";
import { formatCalendarDate, formatCount } from "@/lib/format";
import { Field, inputClass } from "@/components/ui/Form";
import { StatusIcon } from "@/components/register/StatusIcon";

export const metadata: Metadata = {
  title: "Institutions",
  description:
    "Federal and state universities, polytechnics and monotechnics, and whether each publishes its budget, research grants, TETFund allocation, endowment fund and student population on its official website, with the evidence for every finding.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

export default function InstitutionsPage(props: { searchParams: SearchParams }) {
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
      </header>
      <Suspense fallback={<p role="status" className="text-sm text-muted">Loading the report…</p>}>
        <ReportBody searchParams={props.searchParams} />
      </Suspense>
    </div>
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
      <p className="mt-1 text-sm text-muted">The nine indicators every institution is expected to publish on its official website.</p>
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
      <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-rule-soft pt-3 text-[13px] text-ink sm:grid-cols-2 lg:grid-cols-4">
        {ASSESSMENT_STATUSES.map((s) => (
          <div key={s.value} className="flex items-start gap-2">
            <dt className="shrink-0"><StatusIcon status={s.value} /></dt>
            <dd><span className="font-semibold">{s.label}.</span> <span className="text-muted">{s.meaning}</span></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReportTable({ rows, head }: { rows: RegisterRow[]; head: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule bg-white">
      <table className="w-full min-w-[1120px] border-collapse text-sm">
        <caption className="sr-only">Institutions, their verified disclosure status for each of the nine indicators, and links to the evidence</caption>
        <thead>
          <tr className="bg-band text-left text-[12px] uppercase tracking-[0.04em] text-white">
            <th scope="col" className="px-3 py-2.5">Institution</th>
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
            const score = v ? scoreRecord(v.assessments) : null;
            const label = score ? recordLabel(score.label) : null;
            return (
              <tr key={r.id} className="border-t border-rule-soft align-top">
                <th scope="row" className="max-w-[300px] px-3 py-3 text-left font-normal">
                  {v ? <Link href={`/institutions/record/${r.id}`} className="font-semibold">{r.name}</Link> : <span className="font-semibold text-ink-strong">{r.name}</span>}
                  <span className="block text-[12px] text-muted">{r.state ?? "State not recorded"}</span>
                  {v?.head_name ? <span className="block text-[12px] text-muted">{head}: {v.head_name}</span> : null}
                </th>
                {v && score && label ? (
                  <>
                    <td className="max-w-[220px] px-3 py-3 text-[13px]">
                      {v.disclosure_url ? (
                        <a href={v.disclosure_url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold">View disclosure evidence</a>
                      ) : <span className="text-muted">No disclosure page</span>}
                      {v.homepage_url ? (
                        <a href={v.homepage_url} target="_blank" rel="noopener noreferrer nofollow" className="block break-all text-[12px] text-muted">{host(v.homepage_url)}</a>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[12px] font-semibold ${label.className}`}>{label.label}</span>
                      {score.label !== "incomplete" && score.available > 0 ? (
                        <span className="mt-1 block text-[12px] text-muted">{formatPoints(score.points)} of {score.available} points</span>
                      ) : null}
                    </td>
                    {INDICATORS.map((d) => {
                      const a = v.assessments[d.key];
                      return (
                        <td key={d.key} className="px-1.5 py-3 text-center">
                          <StatusIcon status={a?.status} label={`${d.label}${a?.year ? ` (${a.year})` : ""}`} />
                        </td>
                      );
                    })}
                  </>
                ) : (
                  <td colSpan={2 + INDICATORS.length} className="px-3 py-3">
                    <span className="inline-flex rounded border border-rule bg-surface px-2 py-0.5 text-[12px] font-semibold text-muted">Verification in progress</span>
                    <span className="ml-2 text-[12px] text-muted">Shown once the research team has checked the evidence and a second reviewer has verified it.</span>
                  </td>
                )}
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
  let register;
  try {
    register = await getRegister();
  } catch (err) {
    console.error("[report] could not load the register:", err instanceof Error ? err.message : err);
    return (
      <section className="rounded-md border border-rule bg-surface px-6 py-10 text-center">
        <h2 className="font-serif text-xl font-semibold text-ink-strong">The report is not available just now</h2>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted">Please try again in a few minutes.</p>
      </section>
    );
  }
  const active = REPORT_SECTIONS.find((s) => s.key === one(sp.section)) ?? REPORT_SECTIONS[0];
  const q = one(sp.q).slice(0, 100).toLowerCase();
  const state = one(sp.state).slice(0, 60);
  const onlyVerified = one(sp.verified) === "1";
  const inSection = register.rows.filter((r) => r.section === active.key);
  const states = [...new Set(inSection.map((r) => r.state).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b));
  const rows = inSection.filter((r) => (!q || [r.name, r.state].some((v) => v?.toLowerCase().includes(q)))
    && (!state || r.state === state) && (!onlyVerified || r.verified));
  const count = (k: ReportSection) => register.rows.filter((r) => r.section === k).length;
  const verifiedHere = inSection.filter((r) => r.verified).length;
  const tabHref = (k: ReportSection) => `/institutions?section=${k}`;

  if (!register.rows.length) {
    return (
      <section className="rounded-md border border-rule bg-surface px-6 py-10 text-center">
        <h2 className="font-serif text-xl font-semibold text-ink-strong">The report has not been published yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted">The report appears here once the research team has verified the first institutions.</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {register.reportedAsOf ? <p className="text-sm text-muted">Report as at <strong className="text-ink">{formatCalendarDate(register.reportedAsOf)}</strong>.</p> : null}

      <nav aria-label="Category" className="flex flex-col gap-3">
        {(["Federal", "State"] as const).map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-[12px] font-semibold uppercase tracking-[0.1em] text-subtle">{group}</span>
            {REPORT_SECTIONS.filter((s) => s.ownership === group).map((s) => (
              <Link key={s.key} href={tabHref(s.key)} aria-current={s.key === active.key ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded border px-4 text-[15px] font-semibold no-underline ${s.key === active.key ? "border-band bg-band text-white!" : "border-rule bg-white text-ink hover:border-accent hover:text-accent"}`}>
                {s.label.replace(/^(Federal|State) /, "").replace(/^./, (c) => c.toUpperCase())}
                <span className={`rounded-full px-2 text-[12px] ${s.key === active.key ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{count(s.key)}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <form action="/institutions" method="get" role="search" className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="section" value={active.key} />
        <div className="min-w-0 flex-[2_1_260px]">
          <Field id="r-q" label="Search">
            <input id="r-q" name="q" type="search" defaultValue={one(sp.q)} maxLength={100} placeholder="Institution or state" className={inputClass()} />
          </Field>
        </div>
        <div className="min-w-0 flex-[1_1_180px]">
          <Field id="r-state" label="State">
            <select id="r-state" name="state" defaultValue={state} className={inputClass()}>
              <option value="">All states</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" name="verified" value="1" defaultChecked={onlyVerified} className="h-4 w-4" /> Verified only
        </label>
        <div className="flex items-center gap-4">
          <button type="submit" className="inline-flex min-h-11 items-center rounded bg-accent px-5 text-[15px] font-semibold text-white hover:bg-accent-hover">Search</button>
          {q || state || onlyVerified ? <Link href={tabHref(active.key)} className="text-sm font-semibold underline underline-offset-2">Clear</Link> : null}
        </div>
      </form>

      <IndicatorKey />

      <p aria-live="polite" className="text-sm text-muted">
        {formatCount(rows.length)} of {formatCount(inSection.length)} {active.label.toLowerCase()} shown · {formatCount(verifiedHere)} verified so far
      </p>

      {rows.length ? <ReportTable rows={rows} head={active.head} /> : (
        <p className="rounded-md border border-rule bg-surface px-6 py-8 text-center text-[15px] text-muted">
          No {active.label.toLowerCase()} match. <Link href={tabHref(active.key)} className="underline underline-offset-2">Clear the search</Link>.
        </p>
      )}
    </div>
  );
}

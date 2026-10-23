// One verified register record: the evidence behind every indicator, so a reader can reproduce the
// finding without taking it on trust.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getRegister } from "@/server/data/public";
import { INDICATORS } from "@/lib/indicators";
import { REPORT_SECTIONS } from "@/lib/report";
import { formatPoints, recordLabel, scoreRecord, statusInfo } from "@/lib/register";
import { formatCalendarDate } from "@/lib/format";
import { StatusIcon } from "@/components/register/StatusIcon";

export const metadata: Metadata = { title: "Institution record" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function RecordBody({ params }: Props) {
  await connection();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const register = await getRegister();
  const row = register.rows.find((r) => r.id === id);
  if (!row) notFound();
  const section = REPORT_SECTIONS.find((s) => s.key === row.section);
  const v = row.verified;
  if (!v) {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-12 sm:px-6">
        <Link href={`/institutions?section=${row.section}`} className="text-sm font-semibold">← {section?.label ?? "Institutions"}</Link>
        <h1 className="font-serif text-3xl font-semibold text-ink-strong">{row.name}</h1>
        <p className="rounded-md border border-rule bg-surface px-5 py-4 text-[15px] text-muted">
          Verification in progress. This record is shown once the research team has checked the evidence and a second reviewer
          has verified it.
        </p>
      </div>
    );
  }
  const score = scoreRecord(v.assessments);
  const label = recordLabel(score.label);
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <div>
        <Link href={`/institutions?section=${row.section}`} className="text-sm font-semibold">← {section?.label ?? "Institutions"}</Link>
        <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight text-ink-strong sm:text-4xl">{v.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {section?.label.replace(/s$/, "")}{v.state ? ` · ${v.state}` : ""}
          {v.head_name ? ` · ${section?.head}: ${v.head_name}` : ""}{v.bursar_name ? ` · Bursar: ${v.bursar_name}` : ""}
        </p>
      </div>

      <section className="grid gap-4 rounded-md border border-rule bg-white p-5 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex rounded border px-2.5 py-1 text-sm font-semibold ${label.className}`}>{label.label}</span>
            {score.label !== "incomplete" && score.available > 0 ? (
              <span className="text-sm text-muted">{formatPoints(score.points)} of {score.available} points · <Link href="/methodology">How we score</Link></span>
            ) : <Link href="/methodology" className="text-sm">How we score</Link>}
          </div>
          <p className="text-[13px] text-muted">
            Checked by the research team and verified by a second reviewer{row.verifiedAt ? ` on ${formatCalendarDate(row.verifiedAt.slice(0, 10))}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {v.disclosure_url ? (
            <a href={v.disclosure_url} target="_blank" rel="noopener noreferrer nofollow"
              className="inline-flex min-h-11 items-center rounded bg-accent px-4 text-sm font-semibold text-white! no-underline hover:bg-accent-hover">View disclosure evidence</a>
          ) : null}
          {v.homepage_url ? (
            <a href={v.homepage_url} target="_blank" rel="noopener noreferrer nofollow"
              className="inline-flex min-h-11 items-center rounded border border-accent px-4 text-sm font-semibold no-underline hover:bg-accent-soft">Official website</a>
          ) : null}
        </div>
        {v.extra_links.length ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm md:col-span-2">
            {v.extra_links.map((l) => (
              <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer nofollow">{l.label}</a></li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="ind-h" className="flex flex-col gap-3">
        <h2 id="ind-h" className="font-serif text-2xl font-semibold text-ink-strong">The nine indicators</h2>
        <div className="overflow-x-auto rounded-md border border-rule bg-white">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <caption className="sr-only">Status, reporting year, evidence and check date for each indicator</caption>
            <thead>
              <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
                <th scope="col" className="px-4 py-2.5">Indicator</th>
                <th scope="col" className="px-4 py-2.5">Status</th>
                <th scope="col" className="px-4 py-2.5">Reporting year</th>
                <th scope="col" className="px-4 py-2.5">Evidence</th>
                <th scope="col" className="px-4 py-2.5">Checked on</th>
              </tr>
            </thead>
            <tbody>
              {INDICATORS.map((d) => {
                const a = v.assessments[d.key];
                const info = statusInfo(a?.status);
                const evidence = a?.evidence_url ?? (["published", "partial", "nil"].includes(info.value) ? v.disclosure_url : null);
                return (
                  <tr key={d.key} className="border-t border-rule-soft align-top">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <span className="font-semibold text-ink-strong">{d.label}</span>
                      <span className="block text-[12px] text-muted">{d.group}</span>
                    </th>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2"><StatusIcon status={info.value} /> {info.label}</span>
                      {a?.note ? <span className="mt-1 block text-[12px] text-muted">{a.note}</span> : null}
                    </td>
                    <td className="px-4 py-3">{a?.year ?? "—"}</td>
                    <td className="px-4 py-3">
                      {evidence ? <a href={evidence} target="_blank" rel="noopener noreferrer nofollow">Open source</a> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3">{a?.checked_on ? formatCalendarDate(a.checked_on) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-muted">
          Findings describe what the institution publishes on its official website on the dates shown. They are not judgments
          about financial propriety. If something looks wrong, the research team re-checks it against the official sources.
        </p>
      </section>
    </div>
  );
}

export default function RecordPage(props: Props) {
  return (
    <Suspense fallback={<p className="mx-auto max-w-[1100px] px-4 py-12 text-sm text-muted">Loading…</p>}>
      <RecordBody params={props.params} />
    </Suspense>
  );
}

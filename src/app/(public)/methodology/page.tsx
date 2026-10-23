// How we score: the published rule. Built from the same constants that calculate every label,
// score and total on the site, so the page and the figures cannot disagree.
import type { Metadata } from "next";
import Link from "next/link";
import { INDICATORS } from "@/lib/indicators";
import { ASSESSMENT_STATUSES, RECORD_LABELS } from "@/lib/register";
import { StatusIcon } from "@/components/register/StatusIcon";

export const metadata: Metadata = {
  title: "How we score",
  description: "The rule behind every status, score and total in the Financial Transparency Compliance Report.",
};

export default function MethodologyPage() {
  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Financial Transparency Compliance Report</p>
        <h1 className="font-serif text-4xl font-semibold leading-tight text-ink-strong">How we score</h1>
        <p className="text-base leading-relaxed text-[#2b3442]">
          Every label, score and total on this site is calculated from the rule below. Nothing is typed in by hand, so you can
          reproduce any result from the evidence shown on an institution&apos;s record.
        </p>
      </header>

      <section aria-labelledby="what-h" className="flex flex-col gap-3">
        <h2 id="what-h" className="font-serif text-2xl font-semibold text-ink-strong">1. What is checked</h2>
        <p className="text-[15px] leading-relaxed">
          Nine indicators for each institution. One web page can cover several indicators, so these are counts of indicators,
          not of documents.
        </p>
        <ol className="ml-5 list-decimal text-[15px] leading-relaxed">
          {INDICATORS.map((i) => <li key={i.key}>{i.group}: {i.label}</li>)}
        </ol>
      </section>

      <section aria-labelledby="status-h" className="flex flex-col gap-3">
        <h2 id="status-h" className="font-serif text-2xl font-semibold text-ink-strong">2. Status of each indicator</h2>
        <p className="text-[15px] leading-relaxed">
          Each indicator has one status, a reporting year, a link to the evidence and the date the source was checked.
        </p>
        <div className="overflow-x-auto rounded-md border border-rule bg-white">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
                <th scope="col" className="px-4 py-2.5">Status</th>
                <th scope="col" className="px-4 py-2.5">Meaning</th>
                <th scope="col" className="px-4 py-2.5">Points</th>
              </tr>
            </thead>
            <tbody>
              {ASSESSMENT_STATUSES.map((s) => (
                <tr key={s.value} className="border-t border-rule-soft align-top">
                  <th scope="row" className="px-4 py-3 text-left font-semibold"><span className="inline-flex items-center gap-2"><StatusIcon status={s.value} /> {s.label}</span></th>
                  <td className="px-4 py-3">{s.meaning}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{s.credit === null ? "Not counted" : s.credit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="score-h" className="flex flex-col gap-3">
        <h2 id="score-h" className="font-serif text-2xl font-semibold text-ink-strong">3. Score and overall label</h2>
        <p className="text-[15px] leading-relaxed">
          <strong>Score</strong> = points earned ÷ points available. Points available is the number of indicators that apply
          and were assessed (not applicable, not yet assessed and temporarily inaccessible indicators are left out).
        </p>
        <ul className="flex flex-col gap-2 text-[15px] leading-relaxed">
          {RECORD_LABELS.map((l) => (
            <li key={l.value} className="flex flex-wrap items-baseline gap-2">
              <span className={`inline-flex rounded border px-2 py-0.5 text-[13px] font-semibold ${l.className}`}>{l.label}</span>
              <span>{l.rule}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="check-h" className="flex flex-col gap-3">
        <h2 id="check-h" className="font-serif text-2xl font-semibold text-ink-strong">4. How a record is checked</h2>
        <ol className="ml-5 list-decimal text-[15px] leading-relaxed">
          <li>A researcher records the institution&apos;s homepage and disclosure page, and for each indicator the status, reporting year, evidence link and the date checked.</li>
          <li>Links are tested automatically for dead links, homepage-only links and links to another institution&apos;s website.</li>
          <li>A second reviewer, who did not edit the record, checks the evidence and verifies it. Only then does the record appear on this site.</li>
          <li>Any later change goes through the same second check. Until it is verified, the previously verified record stays public.</li>
        </ol>
        <p className="text-[15px] leading-relaxed">
          Findings describe what institutions publish on their official websites. They are not judgments about academic quality,
          financial propriety or breach of any law, and they do not rank institutions. <Link href="/institutions">See the report</Link>.
        </p>
      </section>
    </div>
  );
}

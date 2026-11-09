// How we score: the published rule. Built from the same constants that calculate every label,
// score and total on the site (src/lib/register.ts), so the page and the figures cannot disagree.
// The rule's version history and the current assessment year come from the register.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getRegisterMethods, getRegisterStatus, type RegisterMethod } from "@/server/data/public";
import { INDICATORS } from "@/lib/indicators";
import { ASSESSMENT_STATUSES, RECORD_LABELS, REGISTER_METHOD, expectedYear, statusInfo } from "@/lib/register";
import { formatCalendarDate } from "@/lib/format";
import { StatusIcon } from "@/components/register/StatusIcon";
import { periodWords } from "@/components/register/view";
import { SCOPE_SENTENCE } from "@/components/public/Notices";

export const metadata: Metadata = {
  title: "How we score",
  description: "The rule behind every status, score and total in the Financial Transparency Compliance Report, with its version history.",
};

const H2 = "font-serif text-2xl font-semibold text-ink-strong";
const H3 = "text-[17px] font-semibold text-ink-strong";
const P = "text-[15px] leading-relaxed";

export default function MethodologyPage() {
  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-10 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Financial Transparency Compliance Report</p>
        <h1 className="font-serif text-4xl font-semibold leading-tight text-ink-strong">How we score</h1>
        <p className="text-base leading-relaxed text-[#2b3442]">
          Every label, score and total on this site is calculated from the rule below. Nothing is typed in by hand, so you can
          reproduce any result from the evidence shown on an institution&apos;s record.
        </p>
        <p className="text-[15px] text-muted">
          Rule version <strong className="text-ink">{REGISTER_METHOD.version}</strong>, in force from{" "}
          {formatCalendarDate(REGISTER_METHOD.effectiveOn)}. <a href="#versions-h">Earlier versions</a>.
        </p>
      </header>

      <section aria-labelledby="what-h" className="flex flex-col gap-3">
        <h2 id="what-h" className={H2}>1. What is checked</h2>
        <p className={P}>
          Nine indicators for each institution. One web page can cover several indicators, so these are counts of indicators,
          not of documents.
        </p>
        <ol className="ml-5 list-decimal text-[15px] leading-relaxed">
          {INDICATORS.map((i) => <li key={i.key}>{i.group}: {i.label}</li>)}
        </ol>
        <p className={P}>{SCOPE_SENTENCE}</p>
      </section>

      <section aria-labelledby="status-h" className="flex flex-col gap-4">
        <h2 id="status-h" className={H2}>2. Status of each indicator</h2>
        <p className={P}>Each indicator has one status, a reporting year, a link to the evidence and the date the source was checked.</p>
        <div role="region" aria-label="Statuses and points" tabIndex={0} className="overflow-x-auto rounded-md border border-rule bg-white">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <caption className="sr-only">Each status, what it means and the points it earns</caption>
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
                  <td className="whitespace-nowrap px-4 py-3">{s.credit === null ? "Not counted" : s.credit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className={H3}>What “{statusInfo("not_found").label}” means</h3>
        <p className={P}>
          The research team checked the institution&apos;s official website and the documents it publishes there on the date shown,
          and did not find the information for the year it should cover. It describes what was published when we looked. It
          is not a claim that the information does not exist.
        </p>

        <h3 className={H3}>When “{statusInfo("not_applicable").label}” may be used</h3>
        <p className={P}>Only when the indicator cannot apply to the institution, and always with the reason written on the record. For example:</p>
        <ul className="ml-5 list-disc text-[15px] leading-relaxed">
          <li>the institution runs no postgraduate programmes, so it has no postgraduate students to report;</li>
          <li>the institution has not established an endowment fund.</li>
        </ul>
        <p className={P}>
          It is never assumed from the type of institution. If the institution itself publishes that an amount is nil, the
          finding is “{statusInfo("nil").label}” instead, which counts as a disclosure. An indicator marked not applicable is
          left out of the points available, so it neither helps nor harms the score.
        </p>
      </section>

      <section aria-labelledby="score-h" className="flex flex-col gap-4">
        <h2 id="score-h" className={H2}>3. Score and overall label</h2>
        <p className={P}>
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

        <h3 id="fresh-h" className={H3}>Evidence must be for the right year</h3>
        <p className={P}>
          Following the directive, each indicator should cover either the current year or the previous year, as listed below.
          A finding that is published, partially published or explicitly nil but covers an earlier year is marked{" "}
          <strong className="text-danger">Outdated</strong> and counts 0. The record shows the year found and the year expected.
        </p>
        <Suspense fallback={<FreshnessTable assessmentYear={null} />}>
          <FreshnessWithYear />
        </Suspense>
      </section>

      <section aria-labelledby="check-h" className="flex flex-col gap-3">
        <h2 id="check-h" className={H2}>4. How a record is checked</h2>
        <ol className="ml-5 flex list-decimal flex-col gap-1 text-[15px] leading-relaxed">
          <li>A researcher records the institution&apos;s homepage and disclosure page, the head and bursar with the page where their names were found, and for each indicator the status, reporting year, evidence link and the date checked.</li>
          <li>The research team checks every link before the record is verified, and checks it again whenever the record is reviewed. A link that stops working is looked at again by a person; it never turns a published finding into “Not found” on its own.</li>
          <li>A second reviewer, who did not edit the record, checks the evidence and verifies it. Only then does the record appear on this site.</li>
          <li>Any later change goes through the same second check. Until it is verified, the previously verified record stays public, and earlier verified versions stay listed on the record.</li>
        </ol>
        <p className={P}>
          Findings describe what institutions publish on their official websites. They are not judgments about academic quality,
          financial propriety or breach of any law. Scores are not a ranking. <Link href="/institutions">See the report</Link>.
        </p>
      </section>

      <section aria-labelledby="versions-h" className="flex flex-col gap-3">
        <h2 id="versions-h" className={H2}>5. Versions of this rule</h2>
        <p className={P}>
          Each record is scored under the rule version and assessment year it was verified with, so a change to the rule never
          rescores an earlier verified record. The version is shown on every record.
        </p>
        <Suspense fallback={<p role="status" className="text-sm text-muted">Loading the version history…</p>}>
          <RuleVersions />
        </Suspense>
      </section>
    </div>
  );
}

function FreshnessTable({ assessmentYear }: { assessmentYear: number | null }) {
  return (
    <div role="region" aria-label="The year each indicator should cover" tabIndex={0} className="overflow-x-auto rounded-md border border-rule bg-white">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">The year each indicator&apos;s evidence should cover{assessmentYear ? ` for the ${assessmentYear} assessment` : ""}</caption>
        <thead>
          <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
            <th scope="col" className="px-4 py-2.5">Indicator</th>
            <th scope="col" className="px-4 py-2.5">Should cover</th>
            {assessmentYear ? <th scope="col" className="px-4 py-2.5">For the {assessmentYear} assessment</th> : null}
          </tr>
        </thead>
        <tbody>
          {INDICATORS.map((i) => (
            <tr key={i.key} className="border-t border-rule-soft">
              <th scope="row" className="px-4 py-2.5 text-left font-normal"><span className="font-semibold text-ink-strong">{i.label}</span> <span className="text-muted">({i.groupShort})</span></th>
              <td className="px-4 py-2.5">{periodWords(i.key)}</td>
              {assessmentYear ? <td className="px-4 py-2.5">{expectedYear(i.key, assessmentYear)} or later</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function FreshnessWithYear() {
  await connection();
  let year: number | null = null;
  try {
    const status = await getRegisterStatus();
    year = status.visible ? status.assessmentYear : null;
  } catch (err) {
    console.error("[methodology] could not load the assessment year:", err instanceof Error ? err.message : err);
  }
  return <FreshnessTable assessmentYear={year} />;
}

async function RuleVersions() {
  await connection();
  let methods: RegisterMethod[] | null;
  try {
    methods = await getRegisterMethods();
  } catch (err) {
    console.error("[methodology] could not load the rule versions:", err instanceof Error ? err.message : err);
    methods = null;
  }
  // The version in this code is always listed, even before the database knows it.
  const list = methods?.some((m) => m.version === REGISTER_METHOD.version)
    ? methods
    : [{ version: REGISTER_METHOD.version, effectiveOn: REGISTER_METHOD.effectiveOn, summary: "" }, ...(methods ?? [])];
  return (
    <ul className="flex flex-col divide-y divide-rule-soft rounded-md border border-rule bg-white">
      {list.map((m) => (
        <li key={m.version} className="flex flex-col gap-1 px-4 py-3">
          <span className="text-[15px] text-ink">
            <strong className="font-semibold">Version {m.version}</strong>, in force from {formatCalendarDate(m.effectiveOn)}
            {m.version === REGISTER_METHOD.version ? <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent">Current</span> : null}
          </span>
          {m.summary ? <span className="text-[14px] text-muted">{m.summary}</span> : null}
        </li>
      ))}
      {methods === null ? <li className="px-4 py-3 text-[14px] text-muted">The full version history could not be loaded just now.</li> : null}
    </ul>
  );
}

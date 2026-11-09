import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { getRegister, getRegisterStatus, type PublicRegister, type RegisterStatus } from "@/server/data/public";
import { formatCount, formatDate } from "@/lib/format";
import { REPORT_SECTIONS } from "@/lib/report";
import { countBySection } from "@/components/register/view";
import { RegisterError, RegisterHidden, SCOPE_SENTENCE } from "@/components/public/Notices";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "Whether Nigerian tertiary institutions publish the financial and student information the Federal Government directive requires, with every finding linked to the page or document checked.",
};

// Wording from the original portal's introduction, kept as the institution published it.
const DIRECTIVE_TEXT =
  "As part of the Federal Government’s renewed emphasis on improving governance, transparency and accountability in Federal Tertiary Education Institutions, and in alignment with global best practices, we are continuously monitoring all Federal Institutions to ensure full compliance with the directive to publish the following on their official websites:";

const MUST_PUBLISH: { title: string; note?: string }[] = [
  { title: "Annual Budgetary Allocation", note: "personnel, overhead and capital" },
  { title: "Research Grant Revenue", note: "previous year" },
  { title: "TETFund Allocation", note: "current year" },
  { title: "Endowment Fund", note: "previous year" },
  { title: "Total Student Population", note: "undergraduate and postgraduate" },
];

const CONTAINER = "mx-auto max-w-[1240px] px-4 sm:px-6";

export default function OverviewPage() {
  return (
    <>
      {/* Hero */}
      <section aria-labelledby="hero-h" className="border-b border-rule bg-white text-ink">
        <div className={`${CONTAINER} grid items-center gap-10 pb-16 pt-14 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-14 lg:pt-16`}>
          <div className="flex flex-col gap-5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent">Financial Transparency Compliance Report</p>
            <h1 id="hero-h" className="font-serif text-[36px] font-semibold leading-[1.1] tracking-[-0.015em] text-ink-strong sm:text-[48px]">
              Nigerian Institution Compliance Monitoring Portal
            </h1>
            <span aria-hidden="true" className="block h-1 w-20 rounded bg-[#e8b021]" />
            <p className="max-w-[62ch] text-[17px] leading-relaxed text-muted">{DIRECTIVE_TEXT}</p>
            <p className="max-w-[62ch] text-[15px] leading-relaxed text-muted">{SCOPE_SENTENCE}</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href="/institutions" className="inline-flex min-h-12 items-center rounded bg-accent px-6 text-[15px] font-semibold text-white! no-underline hover:bg-accent-hover">
                View the report
              </Link>
            </div>
          </div>
          <div className="rounded-lg border border-rule bg-white p-6 text-ink shadow-[0_12px_30px_-22px_rgba(15,34,64,0.35)] sm:p-7">
            <h2 className="font-serif text-xl font-semibold text-ink-strong">Institutions must publish</h2>
            <ul className="mt-4 flex flex-col divide-y divide-rule-soft">
              {MUST_PUBLISH.map((m) => (
                <li key={m.title} className="flex items-start gap-3 py-3">
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span className="text-[15px]">
                    <strong className="font-semibold text-ink-strong">{m.title}</strong>
                    {m.note ? <span className="text-muted"> ({m.note})</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-rule-soft pt-3 text-[13px] text-muted">
              Nine indicators per institution, each checked against a stated reporting period and linked to its source.
            </p>
          </div>
        </div>
      </section>

      {/* Report categories */}
      <section aria-labelledby="report-h" className={`${CONTAINER} mt-16`}>
        <SectionHeading id="report-h" eyebrow="The report" title="Nigerian Tertiary Institutions Financial Transparency Compliance Report"
          intro="Federal and state universities, polytechnics and monotechnics. Choose a category to see each institution and the status of each indicator." />
        <Suspense fallback={<p className="mt-6 text-sm text-muted">Loading categories…</p>}>
          <Categories />
        </Suspense>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-h" className="mt-16 border-y border-rule bg-surface">
        <div className={`${CONTAINER} py-14`}>
          <SectionHeading id="how-h" eyebrow="How it works" title="How every finding is made" />
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            <Step n={1} title="Official sources are checked">Researchers review the institution’s official website and documents for each of the nine indicators.</Step>
            <Step n={2} title="Evidence is recorded with its period">Each finding links to the exact page or document, with the reporting period it covers and the date it was checked.</Step>
            <Step n={3} title="A second reviewer verifies it">A different member of the team checks the evidence and verifies the record before it appears here. Corrections are verified again, and earlier versions are kept on the record.</Step>
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section aria-labelledby="cta-h" className={`${CONTAINER} mt-16`}>
        <div className="grid gap-6 rounded-lg border border-rule bg-white p-8 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <h2 id="cta-h" className="font-serif text-2xl font-semibold text-ink-strong">See every institution</h2>
            <p className="mt-2 text-[15px] text-muted">
              Open the report to see each institution&apos;s official website and the status of all nine indicators, or compare
              institutions side by side.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Link href="/compare" className="inline-flex min-h-12 items-center rounded border border-accent px-5 text-[15px] font-semibold no-underline hover:bg-accent-soft">Compare institutions</Link>
            <Link href="/institutions" className="inline-flex min-h-12 items-center rounded bg-accent px-5 text-[15px] font-semibold text-white! no-underline hover:bg-accent-hover">View the report</Link>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeading({ id, eyebrow, title, intro }: { id: string; eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="flex max-w-[820px] flex-col gap-2">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
      <h2 id={id} className="font-serif text-[28px] font-semibold leading-tight text-ink-strong sm:text-[32px]">{title}</h2>
      {intro ? <p className="text-[15px] text-muted">{intro}</p> : null}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-rule bg-white p-6">
      <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-accent font-serif text-lg font-bold text-white">{n}</span>
      <h3 className="text-[17px] font-semibold text-ink-strong">{title}</h3>
      <p className="text-[15px] leading-relaxed text-muted">{children}</p>
    </li>
  );
}

async function Categories() {
  await connection();
  let register: PublicRegister;
  let status: RegisterStatus;
  try {
    [register, status] = await Promise.all([getRegister(), getRegisterStatus()]);
  } catch (err) {
    console.error("[overview] could not load the register:", err instanceof Error ? err.message : err);
    return <div className="mt-6"><RegisterError compact /></div>;
  }
  // Never zeros in place of a hidden or empty register: say what is going on instead.
  if (!status.visible) return <div className="mt-6"><RegisterHidden compact /></div>;
  if (!status.listed) {
    return (
      <p className="mt-6 rounded-md border border-rule bg-surface px-5 py-4 text-[15px] text-muted">
        The report appears here once the research team has loaded the institutions.
      </p>
    );
  }
  const listed = countBySection(register.rows);
  const verified = countBySection(register.rows.filter((r) => r.verified));
  return (
    <>
      <p className="mt-6 text-[17px] text-ink">
        <strong className="font-semibold text-ink-strong">{formatCount(status.verified)}</strong> of {formatCount(status.listed)} institutions verified so far.
      </p>
      <p className="mt-1 text-[13px] text-muted">
        {status.lastVerifiedAt ? `Last verification: ${formatDate(status.lastVerifiedAt)}. ` : ""}
        Only verified records show findings and a score. <Link href="/methodology">How we score</Link>.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_SECTIONS.map((sec) => (
          <li key={sec.key}>
            <Link href={`/institutions?section=${sec.key}`}
              className="group flex h-full items-center justify-between gap-4 rounded-lg border border-rule bg-white p-5 no-underline transition-colors hover:border-accent">
              <span>
                <span className="block text-[12px] font-semibold uppercase tracking-[0.1em] text-subtle">{sec.ownership}</span>
                <span className="mt-1 block font-serif text-xl font-semibold text-ink-strong group-hover:text-accent">{sec.label}</span>
              </span>
              <span className="flex flex-col items-end">
                <span className="font-serif text-3xl font-semibold text-accent">{listed[sec.key]}</span>
                <span className="text-[12px] text-muted">{verified[sec.key]} verified</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

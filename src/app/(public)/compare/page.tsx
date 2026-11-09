// Side-by-side comparison of two to four verified register records. Differences in basis (assessment
// year, scoring-rule version) are stated before the table. Scores exist, but this is not a ranking:
// each column is read on its own terms.
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getRegister, getRegisterStatus, isSlug, type PublicRegister, type RegisterRow, type RegisterStatus } from "@/server/data/public";
import { parseCompareSelection } from "@/lib/compare";
import { REPORT_SECTIONS, reportSection } from "@/lib/report";
import { formatDate } from "@/lib/format";
import { statusInfo } from "@/lib/register";
import { Field, inputClass } from "@/components/ui/Form";
import { StatusIcon } from "@/components/register/StatusIcon";
import { RecordResult } from "@/components/register/RecordResult";
import {
  COMPARE_MAX, INDICATOR_GROUPS_IN_ORDER, compareDifferences, compareHref, findingYear, scoreRow,
} from "@/components/register/view";
import { RegisterError, RegisterHidden } from "@/components/public/Notices";

export const metadata: Metadata = {
  title: "Compare institutions",
  description: "Two to four verified institutions side by side: each indicator's status and reporting year, and each record's result.",
};

const CONTAINER = "mx-auto max-w-[1240px] px-4 sm:px-6";
const ORDINAL = ["First", "Second", "Third", "Fourth"];

function Picker({ rows, selected }: { rows: RegisterRow[]; selected: string[] }) {
  return (
    <section aria-labelledby="pick-h" className="rounded-md border border-rule bg-surface p-5">
      <h2 id="pick-h" className="text-[17px] font-semibold text-ink-strong">Choose institutions</h2>
      <p className="mt-1 text-[14px] text-muted">Pick two to {COMPARE_MAX}. Only verified records can be compared.</p>
      <Form action="/compare" className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: COMPARE_MAX }, (_, i) => (
            <Field key={i} id={`compare-i-${i}`} label={`${ORDINAL[i] ?? `Institution ${i + 1}`} institution${i >= 2 ? " (optional)" : ""}`}>
              <select id={`compare-i-${i}`} name="i" defaultValue={selected[i] ?? ""} className={inputClass()}>
                <option value="">No institution</option>
                {REPORT_SECTIONS.map((s) => {
                  const inSection = rows.filter((r) => r.section === s.key);
                  return inSection.length ? (
                    <optgroup key={s.key} label={s.label}>
                      {inSection.map((r) => <option key={r.slug} value={r.slug}>{r.name}{r.state ? ` (${r.state})` : ""}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="inline-flex min-h-11 items-center rounded border border-accent bg-accent px-5 text-[15px] font-semibold text-white hover:bg-accent-hover">
            Compare
          </button>
          {selected.length ? <Link href="/compare" className="inline-flex min-h-11 items-center text-[15px]">Clear selection</Link> : null}
        </div>
      </Form>
    </section>
  );
}

function BasisWarnings({ messages }: { messages: string[] }) {
  return (
    <section aria-labelledby="basis-h" className="rounded-md border border-warn-rule bg-warn-bg p-5 text-warn-text">
      <h2 id="basis-h" className="text-[18px] font-semibold">These institutions were not checked on the same basis</h2>
      <p className="mt-1 text-[15px]">Read each column on its own terms. Because of the differences below, matching marks or scores do not mean the same thing:</p>
      <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
        {messages.map((m) => <li key={m}>{m}</li>)}
      </ul>
    </section>
  );
}

function CompareTable({ rows }: { rows: RegisterRow[] }) {
  const slugs = rows.map((r) => r.slug);
  const rowTh = "sticky left-0 z-10 w-36 min-w-36 border-r border-rule-soft bg-white px-4 py-3 text-left align-top font-semibold sm:w-56 sm:min-w-48";
  const cell = "min-w-48 px-4 py-3 align-top";
  const groupTh = "bg-surface px-4 py-2 text-left text-[13px] font-semibold uppercase tracking-[0.04em] text-ink";
  return (
    <section aria-labelledby="table-h" className="flex flex-col gap-3">
      <h2 id="table-h" className="font-serif text-[26px] font-semibold text-ink-strong">Side by side</h2>
      <p className="max-w-[820px] text-[15px] leading-relaxed text-muted">
        Each column is that institution&apos;s own verified record, scored under the assessment year and rule it was verified
        with. A status describes public disclosure for the year shown; it says nothing about amounts, quality or legal
        compliance. This is not a ranking.
      </p>
      <div role="region" aria-label="Comparison table" tabIndex={0} className="overflow-x-auto rounded-md border border-rule">
        <table className="w-full border-collapse text-left text-[14px]">
          <caption className="sr-only">The selected institutions&apos; verified records, indicator by indicator</caption>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className={`${rowTh} z-20 bg-surface-2 text-[13px] text-muted`}>Institution</th>
              {rows.map((r) => (
                <th key={r.id} scope="col" className={`${cell} font-normal`}>
                  <span className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">{reportSection(r.section)?.singular}</span>
                    <Link href={`/institutions/${r.slug}`} className="font-serif text-[16px] font-semibold leading-snug">{r.name}</Link>
                    <span className="text-[13px] text-muted">{r.state ?? "State not recorded"}</span>
                    <Link href={compareHref(slugs.filter((x) => x !== r.slug))} className="inline-flex min-h-11 items-center text-[13px]">
                      Remove<span className="sr-only"> {r.name} from the comparison</span>
                    </Link>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-rule"><th scope="rowgroup" colSpan={rows.length + 1} className={groupTh}>Record</th></tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Result</th>
              {rows.map((r) => {
                const s = scoreRow(r);
                return <td key={r.id} className={cell}>{s ? <RecordResult score={s} /> : "—"}</td>;
              })}
            </tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Assessment year</th>
              {rows.map((r) => <td key={r.id} className={cell}>{r.verifiedAssessmentYear ?? "Not set"}</td>)}
            </tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Scoring rule</th>
              {rows.map((r) => <td key={r.id} className={cell}>{r.verifiedMethod ? `Version ${r.verifiedMethod}` : "Not recorded"}</td>)}
            </tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Verified on</th>
              {rows.map((r) => <td key={r.id} className={cell}>{r.verifiedAt ? formatDate(r.verifiedAt) : "Not recorded"}</td>)}
            </tr>
          </tbody>
          {INDICATOR_GROUPS_IN_ORDER.map((g) => (
            <tbody key={g.group}>
              <tr className="border-t border-rule"><th scope="rowgroup" colSpan={rows.length + 1} className={groupTh}>{g.group}</th></tr>
              {g.items.map((d) => (
                <tr key={d.key} className="border-t border-rule-soft">
                  <th scope="row" className={rowTh}>{d.label}</th>
                  {rows.map((r) => {
                    const a = r.verified?.assessments?.[d.key];
                    const info = statusInfo(a?.status);
                    const f = findingYear(d.key, a, r.verifiedAssessmentYear);
                    return (
                      <td key={r.id} className={cell}>
                        <span className="flex items-start gap-2">
                          <span aria-hidden="true"><StatusIcon status={info.value} size={20} /></span>
                          <span className="flex flex-col">
                            <span className="font-semibold text-ink">{info.label}</span>
                            {f.year ? (
                              <span className={`text-[13px] ${f.outdated ? "font-semibold text-danger" : "text-muted"}`}>
                                {f.outdated ? `Outdated: ${f.note}` : `Reporting year ${f.year}`}
                              </span>
                            ) : info.value === "published" || info.value === "partial" || info.value === "nil" ? (
                              <span className="text-[13px] text-muted">Year not stated</span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="text-[13px] text-muted">Evidence links, check dates and notes are on each institution&apos;s record.</p>
    </section>
  );
}

async function CompareBody({ searchParams }: { searchParams: PageProps<"/compare">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const selection = parseCompareSelection(sp.i, COMPARE_MAX, isSlug);
  let register: PublicRegister;
  let status: RegisterStatus;
  try {
    [register, status] = await Promise.all([getRegister(), getRegisterStatus()]);
  } catch (err) {
    console.error("[compare] could not load the register:", err instanceof Error ? err.message : err);
    return <RegisterError compact />;
  }
  if (!status.visible) return <RegisterHidden compact />;
  const rows = register.rows.filter((r) => r.verified);
  if (rows.length < 2) {
    return (
      <section aria-labelledby="empty-h" className="flex flex-col gap-2 rounded-md border border-dashed border-rule p-6">
        <h2 id="empty-h" className="text-[17px] font-semibold text-ink-strong">Not enough verified records yet</h2>
        <p className="max-w-[760px] text-[15px] leading-relaxed text-muted">
          A comparison needs at least two verified records. {rows.length === 1 ? "One record has been verified so far." : "No record has been verified yet."}{" "}
          Meanwhile, see every institution on the <Link href="/institutions">Institutions</Link> page.
        </p>
      </section>
    );
  }
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const chosen = selection.slugs.map((s) => bySlug.get(s)).filter((r): r is RegisterRow => Boolean(r));
  const missing = selection.slugs.filter((s) => !bySlug.has(s));
  const differences = compareDifferences(chosen);

  return (
    <>
      <Picker rows={rows} selected={chosen.map((r) => r.slug)} />
      {selection.truncated || missing.length || selection.invalid ? (
        <div role="status" className="flex flex-col gap-1 rounded-md border border-rule bg-surface px-4 py-3 text-[14px] text-ink">
          {selection.truncated ? <p>Only the first {COMPARE_MAX} institutions are compared at once.</p> : null}
          {missing.length ? (
            <p>
              {missing.length === 1 ? "One requested institution has" : `${missing.length} requested institutions have`} no verified
              record ({missing.join(", ")}). Only verified records can be compared.
            </p>
          ) : null}
          {selection.invalid ? <p>Some entries in the address were not valid institution links and were ignored.</p> : null}
        </div>
      ) : null}
      {chosen.length === 0 ? (
        <section aria-labelledby="none-h" className="flex flex-col gap-2 rounded-md border border-dashed border-rule p-6">
          <h2 id="none-h" className="text-[17px] font-semibold text-ink-strong">No institutions selected</h2>
          <p className="max-w-[760px] text-[15px] leading-relaxed text-muted">
            Choose two to {COMPARE_MAX} institutions above and select Compare. The table lines up each record&apos;s nine
            indicators with the reporting year of each finding. If the records were checked for different assessment years or
            under different versions of the scoring rule, a note explains the difference first.
          </p>
        </section>
      ) : null}
      {chosen.length === 1 ? (
        <p className="rounded-md border border-rule bg-surface px-4 py-3 text-[15px] text-ink">Add at least one more institution to make a comparison.</p>
      ) : null}
      {chosen.length >= 2 ? (
        differences.length ? <BasisWarnings messages={differences} /> : (
          <p className="rounded-md border border-rule bg-surface px-4 py-3 text-[15px] text-ink">
            These records were checked for the same assessment year under the same scoring rule. That does not make the
            institutions equivalent: each status describes public disclosure only.
          </p>
        )
      ) : null}
      {chosen.length >= 2 ? <CompareTable rows={chosen} /> : null}
    </>
  );
}

export default function ComparePage(props: PageProps<"/compare">) {
  return (
    <div className={`${CONTAINER} flex flex-col gap-8 py-8 sm:py-10`}>
      <header className="flex max-w-[860px] flex-col gap-2">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Compare</p>
        <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-[-0.01em] text-ink-strong sm:text-4xl">Compare institutions</h1>
        <p className="text-[16px] leading-relaxed text-muted">
          See up to {COMPARE_MAX} verified institutions side by side. A comparison is fair only on the same basis, so any
          difference in assessment year or scoring rule is stated first. Each record has a score, but this is not a ranking.
        </p>
      </header>
      <Suspense fallback={<p role="status" className="text-sm text-muted">Loading the comparison…</p>}>
        <CompareBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

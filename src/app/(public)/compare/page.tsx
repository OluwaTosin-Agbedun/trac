// Side-by-side comparison of up to COMPARE_MAX current public releases. Every difference in basis
// (periods, methodology, applicability) is stated above the table; nothing implies equivalence.
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { STATE_LABEL, STATE_SHORT, SUMMARY_TEXT } from "@/lib/indicators";
import { formatDate } from "@/lib/format";
import { compareCompatibility, parseCompareSelection, type CompareInstitutionInput, type IndicatorFlag } from "@/lib/compare";
import type { PublishedSnapshot } from "@/lib/snapshot";
import { COMPARE_MAX, getCurrentBySlugs, isSlug, listPublishedNames } from "@/server/data/public";
import { Field, inputClass } from "@/components/ui/Form";
import { StatusLegend, StatusMark } from "@/components/ui/StatusMark";
import { profilePath } from "@/components/public/profile/SnapshotView";
import { countsText, eyebrowText, hasPeriod, institutionName, NOT_RECORDED, orderedIndicators, periodText, stateOf, summaryOf } from "@/components/public/profile/labels";
import { Badge, CONTAINER, EYEBROW, LoadingBlock } from "@/components/public/profile/parts";

export const metadata: Metadata = { title: "Compare institutions" };

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<SearchParams> };

const ORDINAL = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];

const FLAG_TEXT: Record<IndicatorFlag, string> = {
  period_differs: "Periods differ",
  period_unknown: "Period not stated",
  applicability_differs: "Applicability differs",
};

function toInput(s: PublishedSnapshot): CompareInstitutionInput {
  return {
    slug: s.slug,
    name: institutionName(s.payload.profile),
    assessmentPeriod: s.payload.profile.assessment_period,
    methodologyVersionId: s.methodologyVersionId,
    indicators: orderedIndicators(s.payload).flatMap((g) =>
      g.items.map((i) => ({
        key: i.key, label: i.label, state: stateOf(i),
        period_type: i.period_type, period_label: i.period_label, period_start: i.period_start, period_end: i.period_end,
      }))),
  };
}

function compareHref(slugs: string[]) {
  return slugs.length ? `/compare?i=${slugs.map(encodeURIComponent).join(",")}` : "/compare";
}

function Picker({ names, selected }: { names: { slug: string; name: string; state: string | null }[]; selected: string[] }) {
  if (!names.length) {
    return (
      <p className="rounded-md border border-rule bg-surface px-4 py-3 text-[15px] text-ink">
        No institution has a public release yet, so there is nothing to compare.
      </p>
    );
  }
  return (
    <section aria-labelledby="pick-h" className="rounded-md border border-rule bg-surface p-5">
      <h2 id="pick-h" className="text-[17px] font-semibold text-ink-strong">
        Choose institutions
      </h2>
      <p className="mt-1 text-[14px] text-muted">Pick two to {COMPARE_MAX}. Only current public releases can be compared.</p>
      <Form action="/compare" className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: COMPARE_MAX }, (_, i) => (
            <Field key={i} id={`compare-i-${i}`} label={`${ORDINAL[i] ?? `Institution ${i + 1}`} institution${i >= 2 ? " (optional)" : ""}`}>
              <select id={`compare-i-${i}`} name="i" defaultValue={selected[i] ?? ""} className={inputClass()}>
                <option value="">No institution</option>
                {names.map((n) => (
                  <option key={n.slug} value={n.slug}>
                    {n.name}
                    {n.state ? ` (${n.state})` : ""}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded border border-accent bg-accent px-5 text-[15px] font-semibold text-white hover:bg-accent-hover"
          >
            Compare
          </button>
          {selected.length ? (
            <Link href="/compare" className="inline-flex min-h-11 items-center text-[15px]">
              Clear selection
            </Link>
          ) : null}
        </div>
      </Form>
    </section>
  );
}

function BasisWarnings({ messages }: { messages: string[] }) {
  return (
    <section aria-labelledby="basis-h" className="rounded-md border border-warn-rule bg-warn-bg p-5 text-warn-text">
      <h2 id="basis-h" className="text-[18px] font-semibold">
        These institutions are not being compared on the same basis
      </h2>
      <p className="mt-1 text-[15px]">
        Read each column on its own terms. Because of the differences below, matching or different marks do not mean the
        institutions disclose the same information for the same period:
      </p>
      <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
        {messages.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </section>
  );
}

function CompareTable({ snapshots, flags }: { snapshots: PublishedSnapshot[]; flags: Record<string, IndicatorFlag[]> }) {
  const columns = snapshots.map((s) => ({ s, summary: summaryOf(s.payload), groups: orderedIndicators(s.payload) }));
  const groups = orderedIndicators(snapshots[0].payload).map((g) => ({ group: g.group, keys: g.items.map((i) => ({ key: i.key, label: i.label })) }));
  const slugs = snapshots.map((s) => s.slug);
  const rowTh = "sticky left-0 z-10 w-36 min-w-36 border-r sm:w-56 sm:min-w-44 border-rule-soft bg-white px-4 py-3 text-left align-top font-semibold";
  const cell = "min-w-48 px-4 py-3 align-top";

  return (
    <section aria-labelledby="table-h" className="flex flex-col gap-3">
      <h2 id="table-h" className="font-serif text-[26px] font-semibold text-ink-strong">
        Side by side
      </h2>
      <p className="max-w-[820px] text-[15px] leading-relaxed text-muted">
        Each column is that institution&apos;s own current release. A status describes public disclosure for the period shown;
        it says nothing about amounts, quality or legal compliance, and the columns are not ranked.
      </p>
      <StatusLegend />
      <div className="overflow-x-auto rounded-md border border-rule">
        <table className="w-full border-collapse text-left text-[14px]">
          <caption className="sr-only">Current published releases of the selected institutions, indicator by indicator</caption>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className={`${rowTh} bg-surface-2 text-[13px] text-muted`}>
                Institution
              </th>
              {columns.map(({ s }) => (
                <th key={s.id} scope="col" className={`${cell} font-normal`}>
                  <span className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">{eyebrowText(s.payload.profile)}</span>
                    <Link href={profilePath(s.slug)} className="font-serif text-[16px] font-semibold leading-snug">
                      {institutionName(s.payload.profile)}
                    </Link>
                    <span className="text-[13px] text-muted">{s.payload.profile.state?.trim() || "State not recorded"}</span>
                    <Link href={compareHref(slugs.filter((x) => x !== s.slug))} className="inline-flex min-h-11 items-center text-[13px]">
                      Remove<span className="sr-only"> {institutionName(s.payload.profile)} from the comparison</span>
                    </Link>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-rule">
              <th scope="rowgroup" colSpan={columns.length + 1} className="bg-surface px-4 py-2 text-left text-[13px] font-semibold uppercase tracking-[0.04em] text-ink">
                Release
              </th>
            </tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Summary</th>
              {columns.map(({ s, summary }) => (
                <td key={s.id} className={cell}>
                  <span className="block font-semibold text-ink">{SUMMARY_TEXT[summary.label]}</span>
                  <span className="block text-[13px] text-muted">{countsText(summary)}</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Assessment period</th>
              {columns.map(({ s }) => (
                <td key={s.id} className={cell}>{s.payload.profile.assessment_period?.trim() || "Not stated"}</td>
              ))}
            </tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Methodology version</th>
              {columns.map(({ s }) => (
                <td key={s.id} className={cell}>{s.methodologyVersionId}</td>
              ))}
            </tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Public release</th>
              {columns.map(({ s }) => (
                <td key={s.id} className={cell}>
                  Release {s.releaseNumber}, {formatDate(s.publishedAt)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-rule-soft">
              <th scope="row" className={rowTh}>Human verification date</th>
              {columns.map(({ s }) => (
                <td key={s.id} className={cell}>
                  {s.payload.profile.last_verified_at ? formatDate(s.payload.profile.last_verified_at) : NOT_RECORDED}
                </td>
              ))}
            </tr>
          </tbody>
          {groups.map((g) => (
            <tbody key={g.group}>
              <tr className="border-t border-rule">
                <th scope="rowgroup" colSpan={columns.length + 1} className="bg-surface px-4 py-2 text-left text-[13px] font-semibold uppercase tracking-[0.04em] text-ink">
                  {g.group}
                </th>
              </tr>
              {g.keys.map(({ key, label }) => (
                <tr key={key} className="border-t border-rule-soft">
                  <th scope="row" className={rowTh}>
                    <span className="block">{label}</span>
                    {(flags[key] ?? []).length ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(flags[key] ?? []).map((f) => (
                          <Badge key={f} tone="warn">{FLAG_TEXT[f]}</Badge>
                        ))}
                      </span>
                    ) : null}
                  </th>
                  {columns.map(({ s, groups: cg }) => {
                    const ind = cg.flatMap((x) => x.items).find((i) => i.key === key);
                    const state = stateOf(ind);
                    return (
                      <td key={s.id} className={cell}>
                        <span className="flex items-start gap-2">
                          <span aria-hidden="true">
                            <StatusMark state={state} size={16} label="" />
                          </span>
                          <span className="flex flex-col">
                            <span className="font-semibold text-ink">
                              <span aria-hidden="true">{STATE_SHORT[state]}</span>
                              <span className="sr-only">{STATE_LABEL[state]}</span>
                            </span>
                            {ind && hasPeriod(ind) ? (
                              <span className="text-[13px] text-muted">{periodText(ind)}</span>
                            ) : state === "published" || state === "uncertain" ? (
                              <span className="text-[13px] text-muted">Period not stated</span>
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
      <p className="text-[13px] text-muted">
        Values, evidence and explanations are on each institution&apos;s profile.
      </p>
    </section>
  );
}

function EmptyState() {
  return (
    <section aria-labelledby="empty-h" className="flex flex-col gap-2 rounded-md border border-dashed border-rule p-6">
      <h2 id="empty-h" className="text-[17px] font-semibold text-ink-strong">
        No institutions selected
      </h2>
      <p className="max-w-[760px] text-[15px] leading-relaxed text-muted">
        Choose two to {COMPARE_MAX} institutions above and select Compare. The table lines up each institution&apos;s nine
        indicators from its current release, with the reporting period of each finding. If the institutions were assessed for
        different periods, under different methodology versions or with different indicators excluded, a warning explains the
        difference before the table.
      </p>
    </section>
  );
}

async function CompareBody({ searchParams }: Props) {
  const sp = await searchParams;
  await connection();
  const selection = parseCompareSelection(sp.i, COMPARE_MAX, isSlug);
  const [names, snapshots] = await Promise.all([listPublishedNames(), getCurrentBySlugs(selection.slugs)]);
  const found = new Set(snapshots.map((s) => s.slug));
  const missing = selection.slugs.filter((s) => !found.has(s));
  const report = compareCompatibility(snapshots.map(toInput));

  return (
    <>
      <Picker names={names} selected={snapshots.map((s) => s.slug)} />
      {selection.truncated || missing.length || selection.invalid ? (
        <div className="flex flex-col gap-1 rounded-md border border-rule bg-surface px-4 py-3 text-[14px] text-ink">
          {selection.truncated ? <p>Only the first {COMPARE_MAX} institutions are compared at once.</p> : null}
          {missing.length ? (
            <p>
              No current public release was found for {missing.length === 1 ? "one requested institution" : `${missing.length} requested institutions`} (
              {missing.join(", ")}). It may have been renamed, withdrawn or never published.
            </p>
          ) : null}
          {selection.invalid ? <p>Some entries in the address were not valid institution links and were ignored.</p> : null}
        </div>
      ) : null}
      {snapshots.length === 0 ? <EmptyState /> : null}
      {snapshots.length === 1 ? (
        <p className="rounded-md border border-rule bg-surface px-4 py-3 text-[15px] text-ink">
          Add at least one more institution to make a comparison.
        </p>
      ) : null}
      {snapshots.length >= 2 ? (
        report.sameBasis ? (
          <p className="rounded-md border border-rule bg-surface px-4 py-3 text-[15px] text-ink">
            No differences in assessment period, reporting periods, methodology version or applicability were detected. This
            does not make the institutions equivalent: each status describes public disclosure only.
          </p>
        ) : (
          <BasisWarnings messages={report.warnings.map((w) => w.message)} />
        )
      ) : null}
      {snapshots.length ? <CompareTable snapshots={snapshots} flags={report.indicatorFlags} /> : null}
    </>
  );
}

export default function ComparePage(props: Props) {
  return (
    <div className={`${CONTAINER} flex flex-col gap-8 py-8 sm:py-10`}>
      <header className="flex max-w-[860px] flex-col gap-2">
        <p className={EYEBROW}>Compare</p>
        <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-[-0.01em] text-ink-strong sm:text-4xl">
          Compare institutions
        </h1>
        <p className="text-[16px] leading-relaxed text-muted">
          See up to {COMPARE_MAX} institutions&apos; current public releases side by side. Comparisons are fair only on the same
          basis, so any difference in periods, methodology or applicability is stated first. There are no scores or rankings.
        </p>
      </header>
      <Suspense fallback={<LoadingBlock label="Loading the comparison" />}>
        <CompareBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

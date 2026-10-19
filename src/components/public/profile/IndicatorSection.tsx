// The nine disclosure indicators of one release, in their five groups. Each row states the
// finding in words (the mark is supplementary), its reporting period, any extracted value,
// the public reason and the evidence behind it.
import { STATE_LABEL } from "@/lib/indicators";
import { periodCoverage } from "@/lib/compare";
import type { PublishedSnapshot, SnapshotIndicator } from "@/lib/snapshot";
import { StatusLegend, StatusMark } from "@/components/ui/StatusMark";
import { EvidenceList } from "./EvidenceList";
import { hasPeriod, literalText, orderedIndicators, periodText, stateOf, valueText } from "./labels";
import { Badge, Pair } from "./parts";

export function indicatorAnchor(key: string) {
  return `indicator-${key}`;
}

function IndicatorRow({ ind, snapshot, linkDetail }: { ind: SnapshotIndicator; snapshot: PublishedSnapshot; linkDetail: boolean }) {
  const state = stateOf(ind);
  const assessment = snapshot.payload.profile.assessment_period;
  const value = valueText(ind);
  const literal = literalText(ind);
  // Values belong to published findings only; a value left on any other state is never shown.
  const showValue = state === "published";
  const coverage = hasPeriod(ind) ? periodCoverage(ind.period_label, assessment) : "unknown";
  const evidence = ind.evidence ?? [];
  return (
    <li id={indicatorAnchor(ind.key)} className="grid scroll-mt-6 gap-4 border-t border-rule-soft px-4 py-4 first:border-t-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-6">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5">
          <StatusMark state={state} label="" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h4 className="text-[16px] font-semibold text-ink-strong">{ind.label}</h4>
          <p className="text-[14px] text-ink">{STATE_LABEL[state]}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Pair term="Reporting period">
            {periodText(ind)}
            {coverage === "historical" || coverage === "later" ? (
              <span className="mt-1 block">
                <Badge tone="warn">
                  {coverage === "historical" ? "Earlier than" : "Later than"} the assessment period ({assessment?.trim()})
                </Badge>
              </span>
            ) : null}
          </Pair>
          {showValue ? (
            <Pair term="Value">
              {value ?? (literal ? "Not extracted as a number" : "Not extracted")}
              {literal ? <span className="block text-[13px] text-muted">As printed in the source: {literal}</span> : null}
            </Pair>
          ) : null}
          {ind.reason?.trim() ? (
            <Pair term="Explanation" className="sm:col-span-2">
              {ind.reason.trim()}
            </Pair>
          ) : null}
        </dl>
        {evidence.length ? (
          <div className="flex flex-col gap-2">
            <h5 className="text-[13px] font-semibold text-muted">
              Evidence ({evidence.length} {evidence.length === 1 ? "source" : "sources"})
            </h5>
            <EvidenceList
              items={evidence}
              slug={snapshot.slug}
              assessmentPeriod={assessment}
              linkDetail={linkDetail}
              showExcerpt={!linkDetail}
            />
          </div>
        ) : state === "published" || state === "uncertain" ? (
          <p className="text-[13px] text-muted">No public evidence link is attached to this finding.</p>
        ) : null}
      </div>
    </li>
  );
}

export function IndicatorSection({ snapshot, linkDetail }: { snapshot: PublishedSnapshot; linkDetail: boolean }) {
  const groups = orderedIndicators(snapshot.payload);
  return (
    <section aria-labelledby="indicators-h" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="indicators-h" className="font-serif text-[26px] font-semibold text-ink-strong">
          Disclosure indicators
        </h2>
        <p className="max-w-[760px] text-[15px] leading-relaxed text-muted">
          Each indicator records whether the institution publicly discloses this information, for the reporting period shown.
          A value is shown only when the team extracted it from the source; it is not checked for accuracy.
        </p>
      </div>
      <StatusLegend />
      {groups.map((g) => (
        <section key={g.group} aria-labelledby={`group-${g.items[0]?.key}`} className="overflow-hidden rounded-md border border-rule bg-white">
          <h3 id={`group-${g.items[0]?.key}`} className="border-b border-rule bg-surface-2 px-4 py-2.5 text-[14px] font-semibold uppercase tracking-[0.04em] text-ink">
            {g.group}
          </h3>
          <ul>
            {g.items.map((ind) => (
              <IndicatorRow key={ind.key} ind={ind} snapshot={snapshot} linkDetail={linkDetail} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

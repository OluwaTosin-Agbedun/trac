// Release summary: the descriptive label, plain counts and the four separate dates/versions.
// No score, percentage or ranking. The segment bar is decorative; the sentence carries the facts.
import { SUMMARY_TEXT, type AssessmentState } from "@/lib/indicators";
import { formatDate } from "@/lib/format";
import type { PublishedSnapshot } from "@/lib/snapshot";
import { countsText, NOT_RECORDED, orderedIndicators, stateOf, summaryOf } from "./labels";
import { EYEBROW, Pair } from "./parts";

const SEGMENT: Record<AssessmentState, string> = {
  published: "bg-status-published border-status-published",
  uncertain: "bg-[#f6e3cc] border-status-uncertain",
  not_found: "bg-white border-status-notfound",
  not_assessed: "bg-white border-status-unassessed border-dashed",
  not_applicable: "bg-rule-soft border-rule",
};

export function SummaryPanel({ snapshot }: { snapshot: PublishedSnapshot }) {
  const { payload } = snapshot;
  const summary = summaryOf(payload);
  const states = orderedIndicators(payload).flatMap((g) => g.items.map((i) => stateOf(i)));
  return (
    <aside aria-labelledby="release-summary-h" className="flex flex-col gap-4 rounded-md border border-rule bg-surface p-5">
      <h2 id="release-summary-h" className={EYEBROW}>
        Release summary
      </h2>
      <p className="font-serif text-[22px] font-semibold leading-snug text-ink-strong">{SUMMARY_TEXT[summary.label]}</p>
      <div aria-hidden="true" className="grid grid-cols-9 gap-1">
        {states.map((s, i) => (
          <span key={i} className={`h-2.5 rounded-sm border ${SEGMENT[s]}`} />
        ))}
      </div>
      <p className="text-[15px] text-ink">{countsText(summary)}</p>
      <dl className="grid gap-3 border-t border-rule-soft pt-4">
        <Pair term="Assessment period">{payload.profile.assessment_period?.trim() || "Not stated"}</Pair>
        <Pair term="Human verification date">
          {payload.profile.last_verified_at ? formatDate(payload.profile.last_verified_at) : NOT_RECORDED}
        </Pair>
        <Pair term="Public release">
          Release {snapshot.releaseNumber}, published {formatDate(snapshot.publishedAt)}
        </Pair>
        <Pair term="Methodology version">{snapshot.methodologyVersionId}</Pair>
      </dl>
      <p className="text-[13px] leading-relaxed text-muted">
        Counts describe what was found in the sources reviewed. They are not a score, a ranking or a finding about
        quality or legality.
      </p>
    </aside>
  );
}

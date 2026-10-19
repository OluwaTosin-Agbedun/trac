// The directory matrix: one row per institution's current release, nine status marks grouped by
// directive item, then the descriptive summary and release date. Counts only, never a score.
import Link from "next/link";
import { INDICATORS, STATE_LABEL, SUMMARY_TEXT, type AssessmentState, type SummaryLabel } from "@/lib/indicators";
import { formatDate } from "@/lib/format";
import type { PublishedSnapshot, SnapshotIndicator } from "@/lib/snapshot";
import { StatusMark } from "@/components/ui/StatusMark";
import { categorySingular } from "./query";

type Indicator = (typeof INDICATORS)[number];

const GROUPS = INDICATORS.reduce<{ short: string; group: string; items: Indicator[] }[]>((acc, ind) => {
  const last = acc[acc.length - 1];
  if (last && last.short === ind.groupShort) last.items.push(ind);
  else acc.push({ short: ind.groupShort, group: ind.group, items: [ind] });
  return acc;
}, []);

const GROUP_START = new Set(GROUPS.map((g) => g.items[0].key));

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isState = (s: unknown): s is AssessmentState => typeof s === "string" && own(STATE_LABEL, s);

function markLabel(def: Indicator, ind: SnapshotIndicator | undefined, state: AssessmentState) {
  const period = ind?.period_label ? ` (${ind.period_label})` : "";
  return `${def.label}${period}: ${STATE_LABEL[state]}`;
}

function summaryText(label: string | undefined) {
  return label && own(SUMMARY_TEXT, label) ? SUMMARY_TEXT[label as SummaryLabel] : "—";
}

function headLine(p: PublishedSnapshot["payload"]["profile"]) {
  if (!p.head_name) return "Head not stated";
  return p.head_title ? `${p.head_title}: ${p.head_name}` : p.head_name;
}

const th = "border-b border-rule font-bold";

export function DirectoryTable({ rows, caption, showCategory }: {
  rows: PublishedSnapshot[];
  caption: string;
  /** Show "Federal university" under each name when the list mixes categories. */
  showCategory: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule">
      <table className="w-full min-w-[1140px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <colgroup />
        {GROUPS.map((g) => (
          <colgroup key={g.short} span={g.items.length} />
        ))}
        <colgroup />
        <colgroup />
        <thead>
          <tr className="bg-surface-2 text-xs uppercase tracking-[0.05em] text-[#2b3442]">
            <th scope="col" rowSpan={2} className={`${th} sticky left-0 z-[2] w-[30%] bg-surface-2 px-4 py-3 text-left`}>
              Institution
            </th>
            {GROUPS.map((g) =>
              g.items.length > 1 ? (
                <th key={g.short} scope="colgroup" colSpan={g.items.length} className="border-l border-rule-soft px-1 pb-1 pt-2.5 font-bold">
                  <span aria-hidden="true">{g.short}</span>
                  <span className="sr-only">{g.group}</span>
                </th>
              ) : (
                <th key={g.short} scope="col" rowSpan={2} className={`${th} border-l border-rule-soft px-1.5 py-2.5`}>
                  <span aria-hidden="true" className="hyphens-auto">{g.short}</span>
                  <span className="sr-only">{g.items[0].label}</span>
                </th>
              ),
            )}
            <th scope="col" rowSpan={2} className={`${th} border-l border-rule-soft px-4 py-3 text-left`}>
              Summary
            </th>
            <th scope="col" rowSpan={2} className={`${th} border-l border-rule-soft px-4 py-3 text-left`}>
              Released
            </th>
          </tr>
          <tr className="bg-surface-2 text-[11px] text-muted">
            {GROUPS.filter((g) => g.items.length > 1).flatMap((g) =>
              g.items.map((i, n) => (
                <th
                  key={i.key}
                  scope="col"
                  className={`border-b border-rule px-1 pb-2.5 pt-0.5 font-semibold ${n === 0 ? "border-l border-rule-soft" : ""}`}
                >
                  <span aria-hidden="true">{i.short}</span>
                  <span className="sr-only">{i.label}</span>
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = r.payload.profile;
            const s = r.payload.summary;
            const byKey = new Map((r.payload.indicators ?? []).map((i) => [i.key, i]));
            const name = p.name ?? "Name not stated";
            return (
              <tr key={r.id} className="group border-b border-rule-soft last:border-b-0 hover:bg-[#f6f8fb]">
                <th
                  scope="row"
                  className="sticky left-0 z-[1] bg-white px-4 py-3.5 text-left align-top font-normal group-hover:bg-[#f6f8fb]"
                >
                  <Link href={`/institutions/${r.slug}`} className="text-[15px] font-semibold text-ink-strong! no-underline hover:underline">
                    {name}
                  </Link>
                  <div className="mt-1 text-[13px] text-muted">
                    {p.state ?? "State not stated"} · {headLine(p)}
                  </div>
                  {showCategory ? <div className="mt-0.5 text-[13px] text-subtle">{categorySingular(p.ownership, p.institution_type)}</div> : null}
                </th>
                {INDICATORS.map((def) => {
                  const ind = byKey.get(def.key);
                  const state: AssessmentState = ind && isState(ind.state) ? ind.state : "not_assessed";
                  return (
                    <td
                      key={def.key}
                      className={`px-1 py-3.5 text-center align-middle ${GROUP_START.has(def.key) ? "border-l border-rule-soft" : ""}`}
                    >
                      <StatusMark state={state} label={markLabel(def, ind, state)} />
                    </td>
                  );
                })}
                <td className="border-l border-rule-soft px-4 py-3.5 align-top">
                  <div className="font-semibold text-ink-strong">{summaryText(s?.label)}</div>
                  <div className="mt-1 text-[13px] text-muted">
                    {s && s.applicable > 0 ? `${s.published} of ${s.applicable} applicable published` : "No applicable indicators"}
                  </div>
                </td>
                <td className="whitespace-nowrap border-l border-rule-soft px-4 py-3.5 align-top">
                  <div className="text-ink">{formatDate(r.publishedAt)}</div>
                  <div className="mt-1 text-[13px] text-muted">Release {r.releaseNumber}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

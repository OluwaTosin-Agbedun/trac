// A status mark with its reporting year written beside it, and an "outdated" flag when the evidence
// is for a year before the indicator's period (it then counts 0). Server-safe.
import type { Assessment } from "@/lib/register";
import { statusInfo } from "@/lib/register";
import { StatusIcon } from "./StatusIcon";
import { findingYear } from "./view";

export function FindingMark({ indicatorKey, label, assessment, assessmentYear, layout = "stack" }: {
  indicatorKey: string;
  /** The indicator's name, for screen readers and the tooltip. */
  label: string;
  assessment: Partial<Assessment> | null | undefined;
  /** The assessment year the record was verified under. */
  assessmentYear: number | null;
  /** "stack": year under the mark (table cells); "inline": year after the mark (cards). */
  layout?: "stack" | "inline";
}) {
  const f = findingYear(indicatorKey, assessment, assessmentYear);
  const status = statusInfo(assessment?.status).value;
  const showYear = f.year && status !== "not_applicable" && status !== "not_assessed";
  const spoken = `${label}${f.year ? ` (${f.year})` : ""}${f.outdated && f.expected ? `, outdated: the period is ${f.expected}, so it counts 0` : ""}`;
  return (
    <span className={layout === "stack" ? "inline-flex flex-col items-center gap-0.5" : "inline-flex flex-wrap items-center gap-x-1.5"}>
      <StatusIcon status={status} label={spoken} />
      {showYear ? (
        <span aria-hidden="true" className={`whitespace-nowrap text-[11px] leading-tight ${f.outdated ? "font-semibold text-danger" : "text-muted"}`}>
          {f.year}
        </span>
      ) : null}
      {f.outdated ? (
        <span aria-hidden="true" className="whitespace-nowrap rounded-sm bg-danger-bg px-1 text-[10px] font-semibold uppercase leading-tight tracking-[0.02em] text-danger">
          Outdated
        </span>
      ) : null}
    </span>
  );
}

// A verified record's overall label and score, from scoreRecord(). Server-safe.
import { formatPoints, recordLabel, type RecordScore } from "@/lib/register";

export function RecordResult({ score, size = "sm" }: { score: RecordScore; size?: "sm" | "md" }) {
  const label = recordLabel(score.label);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className={`inline-flex whitespace-nowrap rounded border font-semibold ${size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-[12px]"} ${label.className}`}>
        {label.label}
      </span>
      <ScoreText score={score} className={size === "md" ? "text-sm text-muted" : "text-[12px] text-muted"} />
    </span>
  );
}

/** "6.5 of 9 points", or nothing while the assessment is incomplete. */
export function ScoreText({ score, className }: { score: RecordScore; className?: string }) {
  if (score.label === "incomplete" || score.available === 0) return null;
  return (
    <span className={className}>
      {formatPoints(score.points)} of {score.available} points
    </span>
  );
}

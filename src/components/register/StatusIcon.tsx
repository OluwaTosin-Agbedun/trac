// One mark per assessment status, with the status in text for screen readers. Server-safe.
import { statusInfo, type AssessmentStatus } from "@/lib/register";

const STYLE: Record<AssessmentStatus, { box: string; glyph: string }> = {
  published: { box: "bg-ok-bg text-ok", glyph: "✓" },
  nil: { box: "bg-ok-bg text-ok", glyph: "0" },
  partial: { box: "bg-warn-bg text-warn-text", glyph: "½" },
  not_found: { box: "bg-danger-bg text-danger", glyph: "✕" },
  inaccessible: { box: "border border-dashed border-warn-text text-warn-text", glyph: "!" },
  not_applicable: { box: "text-subtle", glyph: "n/a" },
  not_assessed: { box: "text-subtle", glyph: "–" },
};

export function StatusIcon({ status, label, size = 24 }: { status: string | null | undefined; label?: string; size?: number }) {
  const info = statusInfo(status);
  const s = STYLE[info.value];
  const text = label ? `${label}: ${info.label}` : info.label;
  return (
    <span title={text} style={{ minWidth: size, height: size }}
      className={`inline-flex items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none ${s.box}`}>
      <span aria-hidden="true">{s.glyph}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

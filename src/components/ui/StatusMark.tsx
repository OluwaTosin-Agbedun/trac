// Accessible marks for the five assessment states. Shape and fill differ, not colour alone.
import { STATE_LABEL, type AssessmentState } from "@/lib/indicators";

export function StatusMark({ state, size = 18, label }: { state: AssessmentState; size?: number; label?: string }) {
  const name = label ?? STATE_LABEL[state];
  // An empty label means the meaning is given by adjacent text: hide the mark from assistive tech.
  const a11y = name ? { role: "img" as const, "aria-label": name, title: name } : { "aria-hidden": true as const };
  return (
    <span {...a11y} className="inline-flex shrink-0 items-center justify-center" style={{ width: size + 2, height: size + 2 }}>
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
        {state === "published" && (
          <>
            <circle cx="9" cy="9" r="8" fill="#123d7a" />
            <path d="M5.2 9.3l2.4 2.4 5-5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {state === "not_found" && (
          <>
            <circle cx="9" cy="9" r="7.25" fill="#fff" stroke="#6b7685" strokeWidth="1.5" />
            <path d="M5.5 9h7" stroke="#6b7685" strokeWidth="1.6" strokeLinecap="round" />
          </>
        )}
        {state === "uncertain" && (
          <>
            <circle cx="9" cy="9" r="7.25" fill="#fff" stroke="#b15c00" strokeWidth="1.5" />
            <path d="M9 1.75a7.25 7.25 0 0 1 0 14.5z" fill="#b15c00" />
          </>
        )}
        {state === "not_assessed" && (
          <circle cx="9" cy="9" r="7.25" fill="none" stroke="#9aa3af" strokeWidth="1.5" strokeDasharray="2 2.4" />
        )}
        {state === "not_applicable" && (
          <>
            <circle cx="9" cy="9" r="7.25" fill="#eef1f5" stroke="#9aa3af" strokeWidth="1.5" />
            <path d="M4.5 13.5l9-9" stroke="#6b7685" strokeWidth="1.5" />
          </>
        )}
      </svg>
    </span>
  );
}

export function StatusLegend() {
  const states: AssessmentState[] = ["published", "not_found", "uncertain", "not_assessed", "not_applicable"];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-rule-soft bg-surface px-4 py-3 text-[13px] text-ink">
      <span className="font-semibold">Key</span>
      {states.map((s) => (
        <span key={s} className="inline-flex items-center gap-2">
          <StatusMark state={s} label="" />
          {STATE_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

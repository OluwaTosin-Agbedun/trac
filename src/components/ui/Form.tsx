// Form primitives with real labels and error text wired to inputs. Server-safe (no hooks).
import type { ReactNode } from "react";

/** Standard result returned by server actions used with useActionState. */
export type FormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
  /** Echo of submitted values so a failed form keeps what the user typed. */
  values?: Record<string, string>;
} | undefined;

const inputBase =
  "min-h-11 w-full rounded border border-[#b9c1cc] bg-white px-3 text-[15px] text-ink placeholder:text-subtle disabled:bg-surface aria-[invalid=true]:border-danger";

export function Field({ id, label, hint, error, children }: {
  id: string; label: string; hint?: string; error?: string[] | string; children: ReactNode;
}) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">{label}</label>
      {hint ? <p id={`${id}-hint`} className="text-[13px] text-muted">{hint}</p> : null}
      {children}
      {err ? <p id={`${id}-error`} className="text-[13px] font-medium text-danger">{err}</p> : null}
    </div>
  );
}

export function describedBy(id: string, hint?: string, error?: unknown) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function inputClass(extra = "") {
  return `${inputBase} ${extra}`;
}

export function textareaClass(extra = "") {
  return `${inputBase} min-h-24 py-2 ${extra}`;
}

export function Notice({ tone = "info", title, children }: {
  tone?: "info" | "warn" | "danger" | "ok"; title?: string; children: ReactNode;
}) {
  const tones = {
    info: "border-rule bg-surface text-ink",
    warn: "border-warn-rule bg-warn-bg text-warn-text",
    danger: "border-[#e8b4b4] bg-danger-bg text-danger",
    ok: "border-[#b7dcc5] bg-ok-bg text-ok",
  } as const;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${tones[tone]}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

/** Renders an action's message, if any, in a live region. */
export function FormMessage({ state }: { state: FormState }) {
  if (!state?.message) return <p aria-live="polite" className="sr-only" />;
  return (
    <div aria-live="polite">
      <Notice tone={state.ok ? "ok" : "danger"}>{state.message}</Notice>
    </div>
  );
}

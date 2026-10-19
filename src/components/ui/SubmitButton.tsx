"use client";
// The one submit button for every form that calls a server action: shows an inline spinner and a
// present-tense label while pending, and disables itself so it cannot be clicked twice.
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "quiet";

const STYLES: Record<Variant, string> = {
  primary: "bg-accent text-white border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary: "bg-white text-accent border-accent hover:bg-accent-soft",
  danger: "bg-white text-danger border-danger hover:bg-danger-bg",
  quiet: "bg-white text-ink border-rule hover:bg-surface",
};

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  name,
  value,
  formAction,
  disabled,
  className = "",
}: {
  children: ReactNode;
  /** Present-tense label while working, e.g. "Saving…". */
  pendingLabel: string;
  variant?: Variant;
  /** With several submit buttons in one form, name/value identify which one shows the spinner. */
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && (!name || !value || data?.get(name) === value);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending || disabled}
      aria-busy={mine || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${STYLES[variant]} ${className}`}
    >
      {mine ? <Spinner /> : null}
      <span>{mine ? pendingLabel : children}</span>
    </button>
  );
}

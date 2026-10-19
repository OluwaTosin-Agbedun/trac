// Small presentational pieces shared by the profile, release, evidence and comparison pages.
import Link from "next/link";
import type { ReactNode } from "react";
import { safeHttpUrl } from "@/lib/snapshot";

export const CONTAINER = "mx-auto max-w-[1240px] px-4 sm:px-6";
export const EYEBROW = "text-[13px] font-semibold uppercase tracking-[0.08em] text-accent";

/**
 * External links render only through safeHttpUrl, open in a new tab and never pass the opener
 * or referrer. Anything that is not http(s) is shown as plain text, never as a link.
 */
export function ExternalLink({ href, children, className = "" }: { href: string | null | undefined; children: ReactNode; className?: string }) {
  const safe = safeHttpUrl(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={`break-words ${className}`}>
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (official source, opens in a new tab)</span>
    </a>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${it.label}`} className="flex min-w-0 items-center gap-2">
              {it.href && !last ? (
                <Link href={it.href} className="inline-flex min-h-11 items-center">
                  {it.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="inline-flex min-h-11 items-center text-ink">
                  {it.label}
                </span>
              )}
              {!last ? <span aria-hidden="true" className="text-subtle">/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "warn" | "accent" | "ok"; children: ReactNode }) {
  const tones = {
    neutral: "border-rule bg-surface-2 text-ink",
    warn: "border-warn-rule bg-warn-bg text-warn-text",
    accent: "border-[#c5d3ea] bg-accent-soft text-accent",
    ok: "border-[#b7dcc5] bg-ok-bg text-ok",
  } as const;
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[12px] font-semibold leading-5 ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** A label/value pair inside a <dl>. */
export function Pair({ term, children, className = "" }: { term: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${className}`}>
      <dt className="text-[13px] font-semibold text-muted">{term}</dt>
      <dd className="m-0 min-w-0 break-words text-[15px] text-ink">{children}</dd>
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4 py-2">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="h-4 w-40 rounded bg-surface-2" />
      <div aria-hidden="true" className="h-9 w-2/3 max-w-[520px] rounded bg-surface-2" />
      <div aria-hidden="true" className="h-4 w-1/2 max-w-[360px] rounded bg-surface-2" />
      <div aria-hidden="true" className="mt-4 h-48 w-full rounded-md border border-rule-soft bg-surface" />
    </div>
  );
}

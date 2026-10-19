// Page links for the directory. Every link keeps the current filters.
import Link from "next/link";
import type { DirectoryFilters } from "@/server/data/public";
import { directoryHref } from "./query";

/** Page numbers to show: first, last, and the current page with one either side. */
export function pageWindow(page: number, pages: number): (number | "gap")[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = Array.from(want).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(n - sorted[i - 1] === 2 ? n - 1 : "gap");
    out.push(n);
  });
  return out;
}

const box = "inline-flex h-11 min-w-11 items-center justify-center rounded px-3 no-underline";

export function Pagination({ filters, page, pages }: { filters: DirectoryFilters; page: number; pages: number }) {
  if (pages <= 1) return null;
  const current = Math.min(page, pages);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted">
        Page {current} of {pages}
      </p>
      <ul className="flex flex-wrap items-center gap-1.5">
        <li>
          {current > 1 ? (
            <Link href={directoryHref(filters, { page: current - 1 })} className={`${box} border border-[#b9c1cc]`} rel="prev">
              Previous
            </Link>
          ) : (
            <span aria-disabled="true" className={`${box} border border-rule-soft text-subtle`}>Previous</span>
          )}
        </li>
        {pageWindow(current, pages).map((n, i) =>
          n === "gap" ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-subtle">…</li>
          ) : (
            <li key={n}>
              <Link
                href={directoryHref(filters, { page: n })}
                aria-current={n === current ? "page" : undefined}
                aria-label={`Page ${n}`}
                className={n === current ? `${box} bg-accent font-semibold text-white! hover:text-white!` : `${box} border border-[#b9c1cc]`}
              >
                {n}
              </Link>
            </li>
          ),
        )}
        <li>
          {current < pages ? (
            <Link href={directoryHref(filters, { page: current + 1 })} className={`${box} border border-[#b9c1cc]`} rel="next">
              Next
            </Link>
          ) : (
            <span aria-disabled="true" className={`${box} border border-rule-soft text-subtle`}>Next</span>
          )}
        </li>
      </ul>
    </nav>
  );
}

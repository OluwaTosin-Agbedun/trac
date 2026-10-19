// Page links for the team directory. Every link keeps the current filters and sort.
import Link from "next/link";
import { cmsInstitutionsHref, type CmsInstitutionFilters } from "@/lib/cmsDirectory";

/** First, last, and the current page with one either side; gaps of one page are filled in. */
function pageWindow(page: number, pages: number): (number | "gap")[] {
  const want = Array.from(new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  want.forEach((n, i) => {
    if (i > 0 && n - want[i - 1] > 1) out.push(n - want[i - 1] === 2 ? n - 1 : "gap");
    out.push(n);
  });
  return out;
}

const box = "inline-flex h-11 min-w-11 items-center justify-center rounded px-3 no-underline";

export function Pagination({ filters, page, pages }: { filters: CmsInstitutionFilters; page: number; pages: number }) {
  if (pages <= 1) return null;
  const current = Math.min(page, pages);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted">Page {current} of {pages}</p>
      <ul className="flex flex-wrap items-center gap-1.5">
        <li>
          {current > 1 ? (
            <Link href={cmsInstitutionsHref(filters, { page: current - 1 })} rel="prev" className={`${box} border border-[#b9c1cc] bg-white`}>
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
                href={cmsInstitutionsHref(filters, { page: n })}
                aria-current={n === current ? "page" : undefined}
                aria-label={`Page ${n}`}
                className={n === current ? `${box} bg-accent font-semibold text-white! hover:text-white!` : `${box} border border-[#b9c1cc] bg-white`}
              >
                {n}
              </Link>
            </li>
          ),
        )}
        <li>
          {current < pages ? (
            <Link href={cmsInstitutionsHref(filters, { page: current + 1 })} rel="next" className={`${box} border border-[#b9c1cc] bg-white`}>
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

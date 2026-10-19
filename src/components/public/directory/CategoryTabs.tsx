// Category tabs for the directory. Links, not ARIA tabs: each one is a filtered URL.
import Link from "next/link";
import type { DirectoryFilters } from "@/server/data/public";
import { formatCount } from "@/lib/format";
import { CATEGORY_TABS, activeCategory, directoryHref } from "./query";

export function CategoryTabs({ filters, counts }: {
  filters: DirectoryFilters;
  /** Institutions with a current published release, per tab label (unaffected by other filters). */
  counts: Record<string, number>;
}) {
  const active = activeCategory(filters);
  return (
    <nav aria-label="Institution category" className="overflow-x-auto border-b border-rule">
      <ul className="flex min-w-max">
        {CATEGORY_TABS.map((tab) => {
          const on = tab === active;
          const n = counts[tab.label] ?? 0;
          return (
            <li key={tab.label}>
              <Link
                href={directoryHref(filters, { ownership: tab.ownership, type: tab.type, page: undefined })}
                aria-current={on ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-[3px] px-4 py-3 text-[15px] no-underline ${
                  on ? "border-accent font-semibold text-ink-strong!" : "border-transparent text-[#3f4a5a]! hover:text-ink-strong!"
                }`}
              >
                {tab.label}
                <span className="font-normal text-subtle">
                  {formatCount(n)}
                  <span className="sr-only"> published</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

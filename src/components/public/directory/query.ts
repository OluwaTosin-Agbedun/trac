// Directory links and labels. Builds /institutions URLs from already-validated filters, so every
// link (tabs, pagination, overview breakdowns) carries only known values.
import {
  INSTITUTION_TYPES, OWNERSHIP, OWNERSHIP_LABEL,
  type InstitutionType, type Ownership,
} from "@/lib/indicators";
import type { DirectoryFilters, Sort } from "@/server/data/public";

export const DIRECTORY_PATH = "/institutions";

/** URL for the directory with `change` applied over `filters`. Pass a key as undefined to drop it. */
export function directoryHref(filters: DirectoryFilters, change: Partial<DirectoryFilters> = {}): string {
  const f = { ...filters, ...change };
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.ownership) sp.set("ownership", f.ownership);
  if (f.type) sp.set("type", f.type);
  if (f.state) sp.set("state", f.state);
  if (f.indicator) {
    sp.set("indicator", f.indicator);
    if (f.indicatorState && f.indicatorState !== "published") sp.set("indicatorState", f.indicatorState);
  }
  if (f.summary) sp.set("summary", f.summary);
  if (f.sort && f.sort !== "name") sp.set("sort", f.sort);
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  const qs = sp.toString();
  return qs ? `${DIRECTORY_PATH}?${qs}` : DIRECTORY_PATH;
}

/** True when anything narrows the list (category, search or a filter). Sort and page do not. */
export function hasActiveFilters(f: DirectoryFilters): boolean {
  return Boolean(f.q || f.ownership || f.type || f.state || f.indicator || f.summary);
}

/**
 * Sorts offered publicly. Ordering by the number of published indicators would read as a ranking,
 * so it is not offered and is treated as name order if it arrives in a URL.
 */
export const PUBLIC_SORTS: readonly { value: Exclude<Sort, "published_desc">; label: string; phrase: string }[] = [
  { value: "name", label: "Name (A–Z)", phrase: "Sorted by name" },
  { value: "state", label: "State, then name", phrase: "Sorted by state, then name" },
  { value: "recent", label: "Most recently released", phrase: "Most recently released first" },
];

export function publicSort(sort: Sort | undefined): Exclude<Sort, "published_desc"> {
  return sort === "state" || sort === "recent" ? sort : "name";
}

export interface CategoryTab {
  label: string;
  ownership?: Ownership;
  type?: InstitutionType;
}

export const CATEGORY_TABS: readonly CategoryTab[] = [
  { label: "All" },
  { label: "Federal universities", ownership: "federal", type: "university" },
  { label: "Federal polytechnics", ownership: "federal", type: "polytechnic" },
  { label: "Federal monotechnics", ownership: "federal", type: "monotechnic" },
];

export function activeCategory(f: DirectoryFilters): CategoryTab | undefined {
  return CATEGORY_TABS.find((t) => t.ownership === f.ownership && t.type === f.type);
}

const TYPE_PLURAL: Record<InstitutionType, string> = {
  university: "universities",
  polytechnic: "polytechnics",
  monotechnic: "monotechnics",
  college: "colleges",
  other: "other institutions",
};

const TYPE_SINGULAR: Record<InstitutionType, string> = {
  university: "university",
  polytechnic: "polytechnic",
  monotechnic: "monotechnic",
  college: "college",
  other: "institution",
};

export const isOwnership = (v: unknown): v is Ownership => typeof v === "string" && (OWNERSHIP as readonly string[]).includes(v);
export const isInstitutionType = (v: unknown): v is InstitutionType =>
  typeof v === "string" && (INSTITUTION_TYPES as readonly string[]).includes(v);

/** "Federal universities", "Private colleges", "Universities, ownership unknown". */
export function categoryLabel(ownership: string | null | undefined, type: string | null | undefined): string {
  const plural = isInstitutionType(type) ? TYPE_PLURAL[type] : "institutions of unstated type";
  if (!isOwnership(ownership) || ownership === "unknown") {
    return `${plural.charAt(0).toUpperCase()}${plural.slice(1)}, ownership unknown`;
  }
  return `${OWNERSHIP_LABEL[ownership]} ${plural}`;
}

/** "Federal university", "State polytechnic". */
export function categorySingular(ownership: string | null | undefined, type: string | null | undefined): string {
  const noun = isInstitutionType(type) ? TYPE_SINGULAR[type] : "institution";
  if (!isOwnership(ownership) || ownership === "unknown") return `${noun.charAt(0).toUpperCase()}${noun.slice(1)}, ownership unknown`;
  return `${OWNERSHIP_LABEL[ownership]} ${noun}`;
}

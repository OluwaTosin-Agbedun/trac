// Search and filter controls for the public directory. A plain GET form: no server action.
import Link from "next/link";
import {
  ASSESSMENT_STATES, INDICATORS, STATE_LABEL, SUMMARY_LABELS, SUMMARY_TEXT,
} from "@/lib/indicators";
import { Field, inputClass } from "@/components/ui/Form";
import type { DirectoryFilters as Filters } from "@/server/data/public";
import { DirectoryFilterForm, DirectoryFilterSubmit } from "./FilterForm";
import { DIRECTORY_PATH, PUBLIC_SORTS, directoryHref, hasActiveFilters, publicSort } from "./query";

const INDICATOR_GROUPS = INDICATORS.reduce<{ group: string; items: (typeof INDICATORS)[number][] }[]>((acc, ind) => {
  const last = acc[acc.length - 1];
  if (last && last.group === ind.group) last.items.push(ind);
  else acc.push({ group: ind.group, items: [ind] });
  return acc;
}, []);

export function DirectoryFilters({ filters, states }: { filters: Filters; states: string[] }) {
  // Keep a state that arrived in the URL selectable even if it is not in the current release.
  const stateOptions = filters.state && !states.includes(filters.state) ? [...states, filters.state] : states;
  const sort = publicSort(filters.sort);

  return (
    <section aria-labelledby="filters-h" className="flex flex-col gap-3">
      <h2 id="filters-h" className="sr-only">Search and filter</h2>
      <DirectoryFilterForm
        // Remount when the filters change so every control shows the values in the URL.
        key={directoryHref(filters, { page: undefined })}
        path={DIRECTORY_PATH}
        label="Search and filter institutions"
        className="flex flex-wrap items-end gap-4"
      >
        {filters.ownership ? <input type="hidden" name="ownership" value={filters.ownership} /> : null}
        {filters.type ? <input type="hidden" name="type" value={filters.type} /> : null}

        <div className="min-w-0 flex-[2_1_280px]">
          <Field id="f-q" label="Search">
            <input
              id="f-q"
              name="q"
              type="search"
              defaultValue={filters.q ?? ""}
              maxLength={100}
              autoComplete="off"
              placeholder="Institution name, head, bursar or city"
              className={inputClass()}
            />
          </Field>
        </div>

        <div className="min-w-0 flex-[1_1_170px]">
          <Field id="f-state" label="State">
            <select id="f-state" name="state" defaultValue={filters.state ?? ""} className={inputClass()}>
              <option value="">All states</option>
              {stateOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="min-w-0 flex-[1_1_200px]">
          <Field id="f-indicator" label="Indicator">
            <select id="f-indicator" name="indicator" defaultValue={filters.indicator ?? ""} className={inputClass()}>
              <option value="">Any indicator</option>
              {INDICATOR_GROUPS.map((g) =>
                g.items.length === 1 ? (
                  <option key={g.items[0].key} value={g.items[0].key}>{g.items[0].label}</option>
                ) : (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((i) => (
                      <option key={i.key} value={i.key}>{i.label}</option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </Field>
        </div>

        <div className="min-w-0 flex-[1_1_220px]">
          <Field id="f-istate" label="Indicator status" hint="Applies when an indicator is chosen">
            <select
              id="f-istate"
              name="indicatorState"
              aria-describedby="f-istate-hint"
              defaultValue={filters.indicatorState ?? "published"}
              className={inputClass()}
            >
              {ASSESSMENT_STATES.map((s) => (
                <option key={s} value={s}>{STATE_LABEL[s]}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="min-w-0 flex-[1_1_220px]">
          <Field id="f-summary" label="Summary">
            <select id="f-summary" name="summary" defaultValue={filters.summary ?? ""} className={inputClass()}>
              <option value="">Any summary</option>
              {SUMMARY_LABELS.map((s) => (
                <option key={s} value={s}>{SUMMARY_TEXT[s]}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="min-w-0 flex-[1_1_190px]">
          <Field id="f-sort" label="Sort by">
            <select id="f-sort" name="sort" defaultValue={sort} className={inputClass()}>
              {PUBLIC_SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <DirectoryFilterSubmit pendingLabel="Applying…">Apply filters</DirectoryFilterSubmit>
          {hasActiveFilters(filters) || sort !== "name" ? (
            <Link href={DIRECTORY_PATH} className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
              Clear filters
            </Link>
          ) : null}
        </div>
      </DirectoryFilterForm>
    </section>
  );
}

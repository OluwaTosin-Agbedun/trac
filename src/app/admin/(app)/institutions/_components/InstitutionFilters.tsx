"use client";
// Search and filters for the team directory. Without JavaScript it is a plain GET form. With
// JavaScript it drops empty fields and navigates in a transition, so the button shows a spinner
// and stays disabled until the filtered list has rendered. The server re-validates every value.
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field, inputClass } from "@/components/ui/Form";
import { Spinner } from "@/components/ui/Spinner";
import {
  INSTITUTION_TYPES, INSTITUTION_TYPE_LABEL, OWNERSHIP, OWNERSHIP_LABEL, REVISION_STATUS_LABEL,
} from "@/lib/indicators";
import { CMS_PATH, CMS_SORTS, CMS_SORT_LABEL, REVISION_STATUSES, type CmsInstitutionFilters } from "@/lib/cmsDirectory";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function InstitutionFilters({ filters, states, team, filtered }: {
  filters: CmsInstitutionFilters;
  states: string[];
  team: { userId: string; displayName: string; active: boolean }[];
  filtered: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const assigneeKnown = !filters.assignee || filters.assignee === "me" || filters.assignee === "none"
    || team.some((m) => m.userId === filters.assignee);

  return (
    <form
      method="get"
      action={`${BASE_PATH}${CMS_PATH}`}
      role="search"
      aria-label="Search and filter institutions"
      aria-busy={pending || undefined}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const query = new URLSearchParams();
        for (const [key, value] of new FormData(event.currentTarget)) {
          if (typeof value !== "string") continue;
          const v = value.trim();
          if (v && !(key === "sort" && v === "name")) query.append(key, v);
        }
        const qs = query.toString();
        startTransition(() => router.push(qs ? `${CMS_PATH}?${qs}` : CMS_PATH, { scroll: false }));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Field id="cf-q" label="Search">
            <input
              id="cf-q"
              name="q"
              type="search"
              defaultValue={filters.q ?? ""}
              maxLength={100}
              autoComplete="off"
              placeholder="Name or slug"
              className={inputClass()}
            />
          </Field>
        </div>
        <Field id="cf-status" label="Latest revision status">
          <select id="cf-status" name="status" defaultValue={filters.status ?? ""} className={inputClass()}>
            <option value="">Any status</option>
            {REVISION_STATUSES.map((s) => (
              <option key={s} value={s}>{REVISION_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Field>
        <Field id="cf-published" label="Public release">
          <select id="cf-published" name="published" defaultValue={filters.published ?? ""} className={inputClass()}>
            <option value="">Any</option>
            <option value="yes">Has a current public release</option>
            <option value="no">Not currently published</option>
          </select>
        </Field>
        <Field id="cf-ownership" label="Ownership">
          <select id="cf-ownership" name="ownership" defaultValue={filters.ownership ?? ""} className={inputClass()}>
            <option value="">Any ownership</option>
            {OWNERSHIP.map((o) => (
              <option key={o} value={o}>{OWNERSHIP_LABEL[o]}</option>
            ))}
          </select>
        </Field>
        <Field id="cf-type" label="Institution type">
          <select id="cf-type" name="type" defaultValue={filters.type ?? ""} className={inputClass()}>
            <option value="">Any type</option>
            {INSTITUTION_TYPES.map((t) => (
              <option key={t} value={t}>{INSTITUTION_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field id="cf-state" label="State">
          <select id="cf-state" name="state" defaultValue={filters.state ?? ""} className={inputClass()}>
            <option value="">All states</option>
            <option value="none">State not stated</option>
            {states.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            {filters.state && filters.state !== "none" && !states.includes(filters.state) ? (
              <option value={filters.state}>{filters.state}</option>
            ) : null}
          </select>
        </Field>
        <Field id="cf-assignee" label="Assigned to">
          <select id="cf-assignee" name="assignee" defaultValue={filters.assignee ?? ""} className={inputClass()}>
            <option value="">Anyone or no one</option>
            <option value="me">Me (as editor or reviewer)</option>
            <option value="none">No editor assigned</option>
            {team.map((m) => (
              <option key={m.userId} value={m.userId}>{m.displayName}{m.active ? "" : " (inactive)"}</option>
            ))}
            {!assigneeKnown ? <option value={filters.assignee}>Unknown team member</option> : null}
          </select>
        </Field>
        <Field id="cf-sort" label="Sort by">
          <select id="cf-sort" name="sort" defaultValue={filters.sort} className={inputClass()}>
            {CMS_SORTS.map((s) => (
              <option key={s} value={s}>{CMS_SORT_LABEL[s]}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded border border-accent bg-accent px-5 text-sm font-semibold text-white transition-colors hover:border-accent-hover hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? <Spinner /> : null}
          <span>{pending ? "Filtering…" : "Apply filters"}</span>
        </button>
        {filtered || filters.sort !== "name" ? (
          <Link href={CMS_PATH} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold underline underline-offset-2">
            Clear all filters
          </Link>
        ) : null}
      </div>
    </form>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { requireViewer } from "@/server/auth/session";
import { listCmsInstitutions, listStateOptions, listTeam } from "@/server/data/cms/institutions";
import {
  CMS_SORT_LABEL, cmsInstitutionsHref, hasCmsFilters, pageRange, parseCmsInstitutionFilters,
} from "@/lib/cmsDirectory";
import { formatCount, plural } from "@/lib/format";
import { AddInstitutionForm } from "./_components/AddInstitutionForm";
import { InstitutionFilters } from "./_components/InstitutionFilters";
import { InstitutionTable } from "./_components/InstitutionTable";
import { Pagination } from "./_components/Pagination";

export const metadata: Metadata = { title: "Institutions · CMS", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CmsInstitutionsPage(props: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
      <header className="flex max-w-3xl flex-col gap-2">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Team CMS</p>
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-[-0.01em] text-ink-strong sm:text-4xl">Institutions</h1>
        <p className="text-[15px] leading-relaxed text-[#2b3442]">
          Every institution the team tracks, described by its latest revision, including private drafts and imported records.
          The public site shows only published releases.
        </p>
      </header>
      <Suspense fallback={<DirectoryLoading />}>
        <DirectoryBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

function DirectoryLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p role="status" className="text-sm text-muted">Loading institutions…</p>
      <div aria-hidden="true" className="h-14 rounded-md border border-rule bg-white" />
      <div aria-hidden="true" className="h-40 rounded-md border border-rule bg-white" />
      <div aria-hidden="true" className="h-96 rounded-md border border-rule bg-white" />
    </div>
  );
}

async function DirectoryBody({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer(["editor", "reviewer", "admin"]);
  const filters = parseCmsInstitutionFilters(await searchParams);
  const [result, states, team] = await Promise.all([
    listCmsInstitutions(viewer, filters),
    listStateOptions(viewer),
    listTeam(viewer),
  ]);
  const { rows, total, page, pageSize } = result;
  const { from, to, pages } = pageRange(page, pageSize, rows.length, total);
  const filtered = hasCmsFilters(filters);

  return (
    <div className="flex flex-col gap-6">
      <details id="add-institution" className="group rounded-md border border-rule bg-white" open={total === 0 && !filtered ? true : undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold text-accent hover:bg-surface [&::-webkit-details-marker]:hidden">
          <span>Add institution</span>
          <span aria-hidden="true" className="text-lg leading-none text-muted group-open:rotate-45">+</span>
        </summary>
        <div className="border-t border-rule-soft px-5 py-5">
          <AddInstitutionForm />
        </div>
      </details>

      <section aria-labelledby="filters-h" className="rounded-md border border-rule bg-white p-5">
        <h2 id="filters-h" className="sr-only">Search and filter</h2>
        <InstitutionFilters
          // Remount when the URL changes so every control shows the values in use.
          key={cmsInstitutionsHref(filters, { page: 1 })}
          filters={filters}
          states={states}
          team={team.map((m) => ({ userId: m.userId, displayName: m.displayName, active: m.active }))}
          filtered={filtered}
        />
      </section>

      <p aria-live="polite" className="text-sm text-muted">
        {total === 0
          ? "No institutions to show"
          : rows.length === 0
            ? `${formatCount(total)} ${total === 1 ? "institution" : "institutions"} in total`
            : `Showing ${formatCount(from)}–${formatCount(to)} of ${formatCount(total)} ${total === 1 ? "institution" : "institutions"} · Sorted by ${CMS_SORT_LABEL[filters.sort].toLowerCase()}`}
      </p>

      {total === 0 && !filtered ? (
        <EmptyState title="No institutions yet">
          Add the first institution above, or stage the tracker spreadsheet in the import centre. Each new record starts as a
          private draft.
        </EmptyState>
      ) : total === 0 ? (
        <EmptyState title="No institutions match these filters">
          Try a shorter search or remove a filter. <Link href="/admin/institutions" className="underline underline-offset-2">Clear all filters</Link>.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title={`There is no page ${page}`}>
          These filters give {plural(total, "result")} across {plural(pages, "page")}.{" "}
          <Link href={cmsInstitutionsHref(filters, { page: 1 })} className="underline underline-offset-2">Go to the first page</Link>.
        </EmptyState>
      ) : (
        <>
          <InstitutionTable
            rows={rows}
            caption={`Institutions with their latest revision status, public release, assignment, last human verification and last update. Page ${page} of ${pages}.`}
          />
          <Pagination filters={filters} page={page} pages={pages} />
        </>
      )}
    </div>
  );
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="empty-h" className="rounded-md border border-rule bg-white px-6 py-10 text-center">
      <h2 id="empty-h" className="font-serif text-xl font-semibold text-ink-strong">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{children}</p>
    </section>
  );
}

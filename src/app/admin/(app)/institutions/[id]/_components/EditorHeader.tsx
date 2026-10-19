// Identity header for the institution editor: latest revision's name, slug, ownership and type,
// revision number and status, and the public page link when something is published.
import Link from "next/link";
import { REVISION_STATUS_LABEL } from "@/lib/indicators";
import { formatDate, formatDateTime } from "@/lib/format";
import type { EditorData } from "@/server/data/cms/editor";
import { ownershipText, personName, typeText } from "./labels";

const STATUS_TONE: Record<string, string> = {
  draft: "border-accent bg-accent-soft text-accent",
  submitted: "border-warn-rule bg-warn-bg text-warn-text",
  approved: "border-warn-rule bg-warn-bg text-warn-text",
  changes_requested: "border-[#e8b4b4] bg-danger-bg text-danger",
  published: "border-[#b7dcc5] bg-ok-bg text-ok",
  superseded: "border-rule bg-surface text-muted",
  withdrawn: "border-rule bg-surface text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[13px] font-semibold ${STATUS_TONE[status] ?? STATUS_TONE.superseded}`}>
      {REVISION_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function EditorHeader({ data }: { data: EditorData }) {
  const { institution, latest, published } = data;
  const name = latest?.profile.name?.trim() || "Unnamed institution";
  return (
    <header className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li><Link href="/admin/institutions" className="underline underline-offset-2">Institutions</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink">Editor</li>
        </ol>
      </nav>
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">
          {latest ? `${ownershipText(latest.profile.ownership)} · ${typeText(latest.profile.institution_type)}` : "Institution"}
        </p>
        <h1 className="mt-1 break-words font-serif text-3xl font-semibold text-ink-strong sm:text-4xl">{name}</h1>
        {latest?.profile.short_name ? <p className="mt-1 text-sm text-muted">{latest.profile.short_name}</p> : null}
      </div>
      {institution.archivedAt ? (
        <p className="rounded border border-rule bg-surface px-3 py-2 text-sm text-ink">
          Archived on {formatDate(institution.archivedAt)}.
        </p>
      ) : null}
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[13px] font-semibold text-muted">Slug</dt>
          <dd className="mt-0.5 break-all font-mono text-[13px] text-ink">{institution.slug}</dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-muted">Latest revision</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-ink">
            {latest ? (
              <>
                <span>Revision {latest.number}</span>
                <StatusBadge status={latest.status} />
              </>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-muted">Last saved</dt>
          <dd className="mt-0.5 text-ink">
            {latest ? `${formatDateTime(latest.updatedAt)} by ${personName(data.team, latest.updatedBy)}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-muted">Public page</dt>
          <dd className="mt-0.5 text-ink">
            {published ? (
              <>
                <Link href={`/institutions/${published.slug}`} className="font-semibold underline underline-offset-2">
                  View release {published.releaseNumber}
                </Link>
                <span className="block text-[13px] text-muted">Published {formatDate(published.publishedAt)}</span>
              </>
            ) : (
              "Not published"
            )}
          </dd>
        </div>
      </dl>
    </header>
  );
}

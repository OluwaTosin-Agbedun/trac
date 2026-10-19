// Team directory table: one row per institution, described by its latest revision. Shows the
// editorial state (not a disclosure finding), the public release, the assignment and the dates
// that matter, kept separate: human verification and last edit are different things.
import Link from "next/link";
import { INSTITUTION_TYPE_LABEL, OWNERSHIP_LABEL } from "@/lib/indicators";
import { formatCalendarDate, formatDate, formatDateTime } from "@/lib/format";
import type { CmsInstitutionRow } from "@/server/data/cms/institutions";
import { ArchivedBadge, OverdueBadge, RevisionStatusBadge, displayName } from "./badges";

const th = "border-b border-rule px-4 py-3 text-left font-bold";
const td = "border-b border-rule-soft px-4 py-3 align-top";

export function InstitutionTable({ rows, caption }: { rows: CmsInstitutionRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule bg-white">
      <table className="w-full min-w-[1080px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-surface-2 text-xs uppercase tracking-[0.05em] text-[#2b3442]">
            <th scope="col" className={`${th} w-[24%]`}>Institution</th>
            <th scope="col" className={th}>Ownership · type</th>
            <th scope="col" className={th}>State</th>
            <th scope="col" className={th}>Latest revision</th>
            <th scope="col" className={th}>Public release</th>
            <th scope="col" className={th}>Assignment</th>
            <th scope="col" className={th}>Last human verification</th>
            <th scope="col" className={th}>Last updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const name = displayName(r.name);
            const renamed = r.publishedName && r.name && r.publishedName.trim() !== r.name.trim();
            return (
              <tr key={r.id} className="hover:bg-surface">
                <th scope="row" className={`${td} text-left font-normal`}>
                  <Link href={`/admin/institutions/${r.id}`} className="font-semibold underline-offset-2 hover:underline">
                    {name}
                  </Link>
                  <span className="mt-0.5 block font-mono text-[12px] text-subtle">{r.slug}</span>
                  {renamed ? <span className="mt-1 block text-[12px] text-muted">Public name: {r.publishedName}</span> : null}
                  {r.archived ? <span className="mt-1 block"><ArchivedBadge /></span> : null}
                </th>
                <td className={td}>
                  {OWNERSHIP_LABEL[r.ownership] ?? "Ownership unknown"}
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, </span>
                  {INSTITUTION_TYPE_LABEL[r.institutionType] ?? "Other"}
                </td>
                <td className={td}>{r.state ?? <span className="text-muted">Not stated</span>}</td>
                <td className={td}>
                  <span className="block whitespace-nowrap text-ink">Revision {r.revisionNumber}</span>
                  <span className="mt-1 block"><RevisionStatusBadge status={r.status} /></span>
                </td>
                <td className={td}>
                  {r.releaseNumber !== null ? (
                    <>
                      <span className="block whitespace-nowrap font-semibold text-ink">Release {r.releaseNumber}</span>
                      <span className="block text-[13px] text-muted">Released {formatDate(r.releasedAt)}</span>
                    </>
                  ) : (
                    <>
                      <span className="block text-muted">Not published</span>
                      {r.withdrawnRelease !== null ? (
                        <span className="block text-[13px] text-muted">Release {r.withdrawnRelease} withdrawn</span>
                      ) : null}
                    </>
                  )}
                </td>
                <td className={td}>
                  {r.editorId || r.reviewerId || r.dueOn ? (
                    <>
                      <span className="block">
                        <span className="sr-only">Editor: </span>
                        {r.editorId ? r.editorName ?? "Unknown team member" : <span className="text-muted">No editor</span>}
                      </span>
                      <span className="block text-[13px] text-muted">
                        Reviewer: {r.reviewerId ? r.reviewerName ?? "Unknown team member" : "none"}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                        {r.dueOn ? `Due ${formatCalendarDate(r.dueOn)}` : <span className="text-muted">No due date</span>}
                        {r.overdue ? <OverdueBadge /> : null}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">Not assigned</span>
                  )}
                </td>
                <td className={td}>
                  {r.lastVerifiedAt ? formatDate(r.lastVerifiedAt) : <span className="text-muted">Never verified</span>}
                </td>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(r.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

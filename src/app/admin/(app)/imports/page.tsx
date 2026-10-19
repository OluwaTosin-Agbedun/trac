import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireViewer } from "@/server/auth/session";
import { Notice } from "@/components/ui/Form";
import { listImports } from "@/server/data/cms/imports";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { UploadForm } from "./_components/ImportForms";

export const metadata: Metadata = { title: "Imports", robots: { index: false } };

async function ImportsBody() {
  const viewer = await requireViewer();
  if (viewer.role === "editor") {
    return <Notice tone="warn" title="Reviewers and administrators only">Imports are managed by reviewers and administrators.</Notice>;
  }
  const imports = await listImports(viewer);
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Data migration</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-ink-strong">Imports</h1>
        <p className="mt-2 max-w-[75ch] text-sm text-muted">
          Uploading stages the file for review: nothing is created until an administrator commits, and committing creates
          private drafts only. Legacy TRUE/FALSE values stay on the import as unverified claims and are never published.
          Uploading the same file again opens the existing import instead of duplicating it.
        </p>
      </div>
      {viewer.role === "admin" ? (
        <section aria-labelledby="upload-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
          <h2 id="upload-h" className="font-serif text-xl font-semibold text-ink-strong">Upload a tracker export</h2>
          <UploadForm />
        </section>
      ) : (
        <p className="rounded-md border border-rule bg-white p-4 text-sm text-muted">Only administrators can upload, decide and commit imports.</p>
      )}
      <section aria-labelledby="history-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h2 id="history-h" className="font-serif text-xl font-semibold text-ink-strong">Import history</h2>
        {imports.length ? (
          <div className="overflow-x-auto rounded border border-rule-soft">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <caption className="sr-only">Staged imports</caption>
              <thead>
                <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
                  <th scope="col" className="px-4 py-2.5">File</th>
                  <th scope="col" className="px-4 py-2.5">Uploaded</th>
                  <th scope="col" className="px-4 py-2.5">Dataset reported as at</th>
                  <th scope="col" className="px-4 py-2.5">Rows</th>
                  <th scope="col" className="px-4 py-2.5">Needs a decision</th>
                  <th scope="col" className="px-4 py-2.5">Committed</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className="border-t border-rule-soft">
                    <th scope="row" className="px-4 py-3 text-left font-normal"><Link href={`/admin/imports/${i.id}`} className="font-semibold">{i.fileName}</Link></th>
                    <td className="px-4 py-3">{formatDateTime(i.uploadedAt)}<span className="block text-[12px] text-muted">{i.uploadedByName ?? "—"}</span></td>
                    <td className="px-4 py-3">{formatCalendarDate(i.reportedAsOf)}</td>
                    <td className="px-4 py-3">{i.candidates}</td>
                    <td className="px-4 py-3">{i.needsDecision}</td>
                    <td className="px-4 py-3">{i.committed}{i.lastCommittedAt ? <span className="block text-[12px] text-muted">last {formatDateTime(i.lastCommittedAt)}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">No imports yet.</p>}
      </section>
    </div>
  );
}

export default function ImportsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading imports…</p>}>
      <ImportsBody />
    </Suspense>
  );
}

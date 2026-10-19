import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "How to manage the site", robots: { index: false } };

function Task({ n, title, who, children }: { n: number; title: string; who: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent font-serif font-bold text-white">{n}</span>
        <h2 className="font-serif text-xl font-semibold text-ink-strong">{title}</h2>
        <span className="rounded border border-rule px-2 py-0.5 text-[12px] font-semibold text-muted">{who}</span>
      </div>
      <ol className="ml-5 flex list-decimal flex-col gap-1.5 text-[15px] leading-relaxed text-ink">{children}</ol>
    </section>
  );
}

export default function HelpPage() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Help</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-ink-strong">How to manage the site</h1>
        <p className="mt-2 text-[15px] text-muted">
          Everything on the public site comes from this CMS. Nothing goes public until a reviewer approves it and presses
          <strong> Publish</strong>, so you can edit freely. Every save and decision is recorded in the history.
        </p>
      </div>

      <Task n={1} title="Add or update an institution" who="Editors">
        <li>Open <Link href="/admin/institutions">Institutions</Link>. Search for the name, or use <strong>Add institution</strong>.</li>
        <li>On the institution page, press <strong>Start a new draft</strong> if there is no open draft.</li>
        <li>Fill in the profile (head, bursar, website) and the date you last checked the official sources. Press <strong>Save profile</strong>.</li>
        <li>For each of the nine indicators choose a status, the reporting period (for example 2025, or 2024/2025), and add the evidence link with the page or table where you found it. Save each indicator.</li>
        <li>Press <strong>Submit for review</strong>. The draft locks so the reviewer sees exactly what you submitted.</li>
      </Task>

      <Task n={2} title="Review and publish" who="Reviewers and administrators">
        <li>Open the <Link href="/admin/review">Review queue</Link> and choose a submission. Changes from the public version are highlighted.</li>
        <li>Check each published finding has a period and evidence. Then <strong>Approve</strong>, or <strong>Request changes</strong> with a note for the editor.</li>
        <li>After approving, open <strong>Preview public page</strong>, tick the confirmation box and press <strong>Publish approved version</strong>.</li>
        <li>The public page updates at once. The previous version stays in the published history.</li>
        <li>Spotted a mistake after approving but before publishing? Press <strong>Return for changes</strong> on the review page with a note. The approval is cancelled and the editor can start a corrected draft.</li>
        <li>If something published is wrong, open the institution and use <strong>Withdraw from the public site</strong> with a reason. Every release of that institution leaves the public site until a corrected version is published.</li>
      </Task>

      <Task n={3} title="Load the tracker spreadsheet" who="Administrators">
        <li>Upload the tracker as an Excel workbook (.xlsx), a CSV file or tab-separated text on <Link href="/admin/imports">Imports</Link>. You see a preview first; nothing is saved to the institutions yet.</li>
        <li>Rows with problems (no name, possible duplicate, unusable website) and rows whose name matches an institution already in the CMS need a decision. For each, choose <strong>Create</strong>, <strong>Match</strong> to the existing institution, or <strong>Skip</strong> with a reason.</li>
        <li>Web addresses the importer had to guess (for example one missing “https://”) and towns written in the state column are not copied into drafts. Editors confirm them on the institution page, where the original spreadsheet values are shown.</li>
        <li>Press <strong>Commit safe rows</strong>. This creates private drafts only: the old TRUE/FALSE values are kept as unverified notes and never published.</li>
        <li>Uploading the same file twice is safe; it simply opens the existing import.</li>
      </Task>

      <Task n={4} title="Manage the team" who="Administrators">
        <li>On <Link href="/admin/team">Team and settings</Link>, enter a person&apos;s email and role, then press <strong>Create invitation link</strong>.</li>
        <li>Copy the link and send it to them yourself. It works once and expires in 7 days.</li>
        <li>Change a member&apos;s role or deactivate them from the same page. Deactivating signs them out everywhere and cancels invitations they sent.</li>
        <li>An invitation sent to the wrong person can be cancelled with <strong>Revoke</strong> under Pending invitations.</li>
        <li>Someone locked out after too many wrong passwords? Press <strong>Clear sign-in lock</strong> next to their name.</li>
        <li>Roles: <strong>Data editor</strong> edits drafts · <strong>Reviewer and publisher</strong> approves and publishes · <strong>Administrator</strong> also manages imports and the team.</li>
      </Task>

      <Task n={5} title="Use the research assistant" who="Everyone; websites approved by administrators">
        <li>On an institution&apos;s page, open <strong>Research assistant</strong> and add its official website (for example unilag.edu.ng). An administrator approves it.</li>
        <li>Press <strong>Request a scan</strong>. The assistant reads only the approved website, politely, and proposes values with the exact text it found.</li>
        <li>For each proposal compare the quote with the source, then <strong>Accept into draft</strong>, <strong>Edit before accepting</strong> (with a reason), or <strong>Reject</strong>. Accepted values go into the draft with the source as evidence.</li>
        <li>Submit the draft for review as usual. The assistant never publishes, and never decides that something was “not found”.</li>
        <li>Progress, failures and websites waiting for approval are on the <Link href="/admin/research">Research centre</Link> page.</li>
      </Task>

      <section className="rounded-md border border-warn-rule bg-warn-bg p-5 text-[15px] text-warn-text">
        <h2 className="font-semibold">Good to know</h2>
        <ul className="ml-5 mt-2 list-disc">
          <li>“Not found” means not found in the sources you checked, so record which pages you looked at in the reason.</li>
          <li>Nobody can review work they submitted or edited. Ask a colleague.</li>
          <li>Data editors work on institutions assigned to them, or on institutions nobody has been assigned to yet.</li>
          <li>If someone else saved the same draft first, you will be asked to reload before saving, so no work is overwritten.</li>
        </ul>
      </section>
    </div>
  );
}

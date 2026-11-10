// Research suggestions for the register record being edited: the research assistant's pending
// proposals for the record's linked institution, each with the exact text it relied on, where that
// text is, and the page it came from. "Apply to this record" fills that indicator in the working copy
// (the record still needs a second person to verify it); "Dismiss" rejects it with a reason.
// Website text is shown as plain text only; links open the captured page on the approved website.
import Link from "next/link";
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { getRegisterResearch, getWorkerLine, type RegisterSuggestion } from "@/server/data/cms/research";
import { Notice } from "@/components/ui/Form";
import { indicatorByKey, INDICATORS } from "@/lib/indicators";
import { statusInfo } from "@/lib/register";
import { formatDate, formatDateTime } from "@/lib/format";
import { WorkerStatusLine } from "../../research/_components/WorkerStatusLine";
import { SCAN_STATUS_LABEL, scanCoverageText } from "../../institutions/[id]/_components/ResearchPanel";
import { ApplySuggestionForm, ApproveHomepageForm, DismissSuggestionForm, RequestRecordScanForm } from "./SuggestionForms";

const order = (key: string) => {
  const i = INDICATORS.findIndex((d) => d.key === key);
  return i < 0 ? INDICATORS.length : i;
};

function SuggestionCard({ s, current, entryId, hash, mayEdit }: {
  s: RegisterSuggestion; current: { status: string; year: string | null } | undefined; entryId: string; hash: string; mayEdit: boolean;
}) {
  const def = indicatorByKey(s.fieldKey);
  const proposed = statusInfo(s.registerStatus);
  const now = statusInfo(current?.status);
  const check = s.candidateState === "uncertain" || s.uncertainty.length > 0;
  return (
    <li className="flex flex-col gap-3 rounded-md border border-rule bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[15px] font-semibold text-ink-strong">{def ? `${def.group} · ${def.label}` : s.fieldKey}</h4>
        <span className="text-[12px] text-muted">Found {formatDateTime(s.createdAt)}</span>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded border border-rule-soft bg-surface-2 p-3">
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">Now in this record</dt>
          <dd className="mt-1">{now.label}{current?.year ? ` · ${current.year}` : ""}</dd>
        </div>
        <div className="rounded border border-accent/40 bg-accent-soft p-3">
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-accent">Suggested</dt>
          <dd className="mt-1 font-medium">
            {proposed.label}{s.periodLabel ? ` · ${s.periodLabel}` : " · year not stated"}
            {s.valueLiteral ? <span className="block text-[13px] font-normal">Figure as printed: {s.valueLiteral}</span> : null}
          </dd>
        </div>
      </dl>
      <figure className="rounded border-l-4 border-rule bg-surface px-3 py-2 text-sm">
        <blockquote className="whitespace-pre-wrap break-words text-ink">{s.excerpt}</blockquote>
        <figcaption className="mt-1.5 text-[12px] text-muted">
          {s.locator ? <>{s.locator} · </> : null}
          <a href={s.source.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-semibold text-accent underline underline-offset-2">
            {s.source.title || s.source.url}
          </a>
          {" · captured "}{formatDate(s.source.fetchedAt)}
          {" · "}<Link href={`/admin/research/sources/${s.source.id}`} className="font-semibold text-accent underline underline-offset-2">captured text</Link>
        </figcaption>
      </figure>
      {check ? (
        <div className="text-[13px] text-warn-text">
          <p className="font-semibold">{s.candidateState === "uncertain" ? "The assistant was not sure. Check before applying" : "Check before applying"}</p>
          {s.uncertainty.length ? <ul className="mt-1 list-disc pl-5">{s.uncertainty.map((u, i) => <li key={i}>{u}</li>)}</ul> : null}
        </div>
      ) : null}
      {mayEdit && s.candidateState === "uncertain" ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-muted">
            Because the assistant was not sure, this suggestion cannot be applied. Open the source, record what you find in the form
            above, then dismiss the suggestion.
          </p>
          <div><DismissSuggestionForm proposalId={s.id} /></div>
        </div>
      ) : mayEdit ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-muted">
            Applying sets the status to {proposed.label.toLowerCase()}, the year to {s.periodLabel ? `“${s.periodLabel.slice(0, 20)}”` : "blank"}, the
            evidence link to the captured page, the checked date to {formatDate(s.source.fetchedAt)} and the note to the location above.
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <ApplySuggestionForm proposalId={s.id} entryId={entryId} hash={hash} />
            <DismissSuggestionForm proposalId={s.id} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

export async function Suggestions({ entryId, institutionId, hash }: { entryId: string; institutionId: string | null; hash: string }) {
  const viewer = await requireViewer();
  // Only editors, reviewers and administrators work with research (the database refuses anyone else).
  if (viewer.role !== "editor" && viewer.role !== "reviewer" && viewer.role !== "admin") return null;
  if (!isUuid(entryId) || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const [r, worker] = await Promise.all([getRegisterResearch(viewer, entryId), getWorkerLine(viewer)]);
  if (!r || r.archived) return null;
  const isAdmin = viewer.role === "admin";
  // The same scope the database applies when saving: an editor works on records assigned to them or to nobody.
  const mayEdit = viewer.role !== "editor" || !r.assignedEditorId || r.assignedEditorId === viewer.userId;
  const linked = r.institutionId ?? institutionId;
  const suggestions = [...r.suggestions].sort((a, b) => order(a.fieldKey) - order(b.fieldKey) || b.createdAt.localeCompare(a.createdAt));

  return (
    <section aria-labelledby={`suggest-${entryId.slice(0, 8)}`} className="flex flex-col gap-4 rounded border border-rule-soft bg-surface p-4">
      <div>
        <h3 id={`suggest-${entryId.slice(0, 8)}`} className="text-base font-semibold text-ink-strong">Research assistant suggestions</h3>
        <p className="mt-1 max-w-[80ch] text-[13px] text-muted">
          Evidence the assistant found on the institution&apos;s approved website, quoted exactly. Applying a suggestion fills that
          indicator in the form above with the page as evidence, and a second person still verifies the record. Save your own changes
          in the form first: applying a suggestion reloads the form.
        </p>
      </div>
      <WorkerStatusLine line={worker} forAdmin={isAdmin} />

      {!r.institutionId ? (
        <Notice tone="info">
          This record is not linked to a research institution yet, so the research assistant cannot look for evidence for it.
        </Notice>
      ) : (
        <>
          {r.approvedHosts.length === 0 ? (
            <div className="flex flex-col gap-2">
              <Notice tone="info" title="Needs source confirmation">
                No website is approved as a research source for this institution yet.
                {r.homepagePending ? ` ${r.homepageHost} is waiting for an administrator to approve it.` : ""}
                {r.homepageRefused ? ` An administrator decided earlier that ${r.homepageHost} is not a research source.` : ""}
                {!r.homepageHost && !r.homepageUrl ? " Add the institution’s own homepage in the form above first." : ""}
                {!r.homepageHost && r.homepageUrl
                  ? " The homepage in this record is not the institution’s own website (for example a social media page or a shared hosting service), so it cannot be approved from here. Correct it in the form above, or ask an administrator to add the official website on the institution’s research page."
                  : ""}
              </Notice>
              {r.homepageHost && mayEdit && (isAdmin || (!r.homepagePending && !r.homepageRefused)) ? (
                <ApproveHomepageForm entryId={entryId} host={r.homepageHost} isAdmin={isAdmin} />
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-[13px] text-muted">Approved research sources: {r.approvedHosts.join(", ")}.</p>
              {r.activeScan ? (
                <p>
                  <span className="font-semibold">Scan {SCAN_STATUS_LABEL[r.activeScan.status].toLowerCase()}</span>
                  {" · requested "}{formatDateTime(r.activeScan.requestedAt)}{r.activeScan.requestedByName ? ` by ${r.activeScan.requestedByName}` : ""}
                  {r.activeScan.cancelRequested ? " · cancellation requested" : ""}
                </p>
              ) : mayEdit ? (
                <div className="flex flex-col gap-1">
                  <RequestRecordScanForm entryId={entryId} />
                  <p className="text-[12px] text-muted">The scan starts from this record&apos;s disclosure page and document links on the approved websites.</p>
                </div>
              ) : null}
              {r.lastScan ? (
                <div className="rounded border border-rule-soft bg-white p-3 text-[13px]">
                  <p>
                    <span className="font-semibold">Last scan: {SCAN_STATUS_LABEL[r.lastScan.status]}</span>
                    {r.lastScan.finishedAt ? ` · ${formatDateTime(r.lastScan.finishedAt)}` : ""}
                  </p>
                  {scanCoverageText(r.lastScan) ? <p className="mt-1 text-muted">{scanCoverageText(r.lastScan)}</p> : null}
                  {r.lastScan.error ? <p className="mt-1 text-danger">{r.lastScan.error}</p> : null}
                  {typeof r.lastScan.coverage.note === "string" ? <p className="mt-1 text-muted">{r.lastScan.coverage.note}</p> : null}
                </div>
              ) : null}
            </div>
          )}

          {suggestions.length ? (
            <ul className="flex flex-col gap-3" aria-label="Suggestions waiting for a decision">
              {suggestions.map((s) => (
                <SuggestionCard key={s.id} s={s} current={r.current[s.fieldKey]} entryId={entryId} hash={hash} mayEdit={mayEdit} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              No suggestions are waiting for this institution.{linked && r.approvedHosts.length ? " Request a scan to look for evidence on its approved websites." : ""}
            </p>
          )}
          {!mayEdit ? <p className="text-[13px] text-muted">This record is assigned to another editor, so only they, a reviewer or an administrator can apply suggestions.</p> : null}
        </>
      )}
    </section>
  );
}

// Where the latest revision stands in the editorial workflow, what can be done next, and the
// descriptive counts for the draft beside the published release (no score, no percentage).
import Link from "next/link";
import { Notice } from "@/components/ui/Form";
import { INDICATORS, SUMMARY_TEXT } from "@/lib/indicators";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { countsText, indicatorProblems, summarise } from "@/lib/editorRules";
import type { Viewer } from "@/server/auth/session";
import type { EditorData, ReviewDecision } from "@/server/data/cms/editor";
import { StartDraftForm, SubmitRevisionForm } from "./WorkflowForms";
import { DECISION_LABEL, personName } from "./labels";

function ReviewNotes({ reviews, team }: { reviews: ReviewDecision[]; team: EditorData["team"] }) {
  const returned = reviews.filter((r) => r.decision !== "approved");
  if (!returned.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-3">
      {returned.map((r) => (
        <li key={r.id} className="rounded border border-[#e8b4b4] bg-white px-3 py-2 text-ink">
          <p className="text-[13px] text-muted">
            {DECISION_LABEL[r.decision] ?? r.decision} by {personName(team, r.decidedBy)} on {formatDateTime(r.decidedAt)}
          </p>
          <p className="mt-1 whitespace-pre-line">{r.notes || "No notes were recorded."}</p>
          {r.overrideReason ? <p className="mt-1 text-[13px] text-muted">Self-review override: {r.overrideReason}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function WorkflowPanel({ data, viewer }: { data: EditorData; viewer: Viewer }) {
  const { latest, published, institution, assignment, team } = data;
  const reviewerRole = viewer.role === "reviewer" || viewer.role === "admin";

  if (!latest) {
    return (
      <Notice tone="warn" title="No revisions">
        This institution has no revisions yet, so there is nothing to edit. Ask an administrator to check the record.
      </Notice>
    );
  }

  // Same rules as the published summary: prior-year evidence does not count as current.
  const draftSummary = summarise(data.indicators, latest.profile.assessment_period);
  const publishedSummary = published?.payload.summary ?? null;

  const problems: string[] = [];
  if (!latest.profile.name?.trim()) problems.push("Profile: enter the institution's name.");
  for (const ind of data.indicators) {
    const def = INDICATORS.find((d) => d.key === ind.key);
    const ev = data.evidence.filter((e) => e.indicator_key === ind.key);
    for (const p of indicatorProblems(ind, ev)) problems.push(`${def?.group ?? ""}: ${def?.label ?? ind.key} — ${p}`);
  }

  let status: React.ReactNode;
  switch (latest.status) {
    case "draft":
      status = (
        <Notice tone="info" title={`Revision ${latest.number} is a draft`}>
          <p>
            You can edit the profile, indicators and evidence below. Edits do not change the public page until a
            reviewer approves and publishes this revision.
          </p>
          {latest.reviewCycle > 0 ? (
            <p className="mt-1">This is review cycle {latest.reviewCycle + 1}; earlier return notes are in the history below.</p>
          ) : null}
        </Notice>
      );
      break;
    case "submitted":
    case "approved":
      status = (
        <Notice tone="warn" title="Frozen for review">
          <p>
            {latest.status === "submitted"
              ? `Submitted on ${formatDateTime(latest.submittedAt)} by ${personName(team, latest.submittedBy)}. `
              : "A reviewer approved this exact revision; it is waiting to be published. "}
            The fields below are read-only so the reviewer checks exactly what was submitted. Any change needs a new
            draft after the reviewer returns it{latest.status === "approved" ? " or it is published" : ""}.
          </p>
          {reviewerRole ? (
            <p className="mt-2">
              <Link href="/admin/review" className="font-semibold underline underline-offset-2">Open the review queue</Link>
            </p>
          ) : null}
        </Notice>
      );
      break;
    case "changes_requested":
      status = (
        <Notice tone="danger" title="Changes requested">
          <p>A reviewer returned revision {latest.number}. Start a new draft from it, make the changes, then submit again.</p>
          <ReviewNotes reviews={data.latestReviews} team={team} />
        </Notice>
      );
      break;
    case "withdrawn":
      status = (
        <Notice tone="warn" title="Publication withdrawn">
          <p>
            Revision {latest.number} was published and then withdrawn
            {data.withdrawn?.reason ? `. Reason: ${data.withdrawn.reason}` : ""}. Nothing is public. Start a new draft to
            prepare a corrected version.
          </p>
        </Notice>
      );
      break;
    default:
      status = (
        <Notice tone="info" title={latest.status === "published" ? `Revision ${latest.number} is published` : `Revision ${latest.number} is ${latest.status}`}>
          <p>There is no open draft. Start a new draft to make changes; the public page stays as it is until the new revision is approved and published.</p>
        </Notice>
      );
  }

  const canStart = ["published", "superseded", "changes_requested", "withdrawn"].includes(latest.status);
  const notAssigned = viewer.role === "editor" && assignment && assignment.editorId && assignment.editorId !== viewer.userId;

  return (
    <section aria-labelledby="workflow-h" className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
      <h2 id="workflow-h" className="font-serif text-xl font-semibold text-ink-strong">Workflow</h2>
      {status}
      {notAssigned ? (
        <p className="text-[13px] text-muted">
          {personName(team, assignment.editorId)} is the assigned editor
          {assignment.dueOn ? `, due ${formatCalendarDate(assignment.dueOn)}` : ""}. Coordinate before making changes.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-rule-soft bg-surface p-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Revision {latest.number}</p>
          <p className="mt-1 font-semibold text-ink">{SUMMARY_TEXT[draftSummary.label]}</p>
          <p className="mt-1 text-sm text-ink">{countsText(draftSummary)}</p>
          {draftSummary.uncertain ? <p className="mt-1 text-[13px] text-muted">{draftSummary.uncertain} uncertain</p> : null}
        </div>
        <div className="rounded-md border border-rule-soft bg-surface-2 p-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">
            Currently published{published ? ` · release ${published.releaseNumber}` : ""}
          </p>
          {published && publishedSummary ? (
            <>
              <p className="mt-1 font-semibold text-ink">{SUMMARY_TEXT[publishedSummary.label] ?? "Summary not recorded"}</p>
              <p className="mt-1 text-sm text-ink">{countsText(publishedSummary)}</p>
              <p className="mt-1 text-[13px] text-muted">Published {formatDateTime(published.publishedAt)}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">Nothing is published for this institution.</p>
          )}
        </div>
      </div>

      {latest.status === "draft" ? (
        <div className="flex flex-col gap-3">
          {problems.length ? (
            <div className="rounded-md border border-warn-rule bg-warn-bg px-4 py-3 text-sm text-warn-text">
              <p className="font-semibold">Before submitting ({problems.length})</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <p className="mt-2">Published indicators need a period type, a period label and evidence with a locator or excerpt.</p>
            </div>
          ) : null}
          <SubmitRevisionForm revisionId={latest.id} lockVersion={latest.lockVersion} problemCount={problems.length} />
        </div>
      ) : null}

      {canStart && !institution.archivedAt ? (
        <StartDraftForm institutionId={institution.id} label={latest.status === "changes_requested" ? "Start a new draft from this revision" : "Start a new draft"} />
      ) : null}
    </section>
  );
}


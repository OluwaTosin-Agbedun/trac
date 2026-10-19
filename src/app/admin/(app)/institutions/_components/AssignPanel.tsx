// Assignment panel for the institution editor. Loads the open assignment and the team, shows who
// is assigned, and (for reviewers and administrators) the form to change it.
//
// Usage from another screen (it reads the session and the database, so wrap it in Suspense):
//   <Suspense fallback={<p>Loading assignment…</p>}><AssignPanel institutionId={id} /></Suspense>
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { getOpenAssignment, listTeam } from "@/server/data/cms/institutions";
import { formatCalendarDate, formatDate } from "@/lib/format";
import { AssignForm, type AssignOption } from "./AssignForm";
import { OverdueBadge } from "./badges";

export async function AssignPanel({ institutionId, headingLevel = 2 }: { institutionId: string; headingLevel?: 2 | 3 }) {
  if (!isUuid(institutionId)) return null;
  const viewer = await requireViewer();
  const [current, team] = await Promise.all([getOpenAssignment(viewer, institutionId), listTeam(viewer)]);
  const canAssign = viewer.role === "reviewer" || viewer.role === "admin";
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const headingId = `assignment-h-${institutionId}`;

  const nameOf = (id: string | null, fallback: string | null) =>
    id ? fallback ?? team.find((m) => m.userId === id)?.displayName ?? "Unknown team member" : null;
  const inactive = (id: string | null): AssignOption[] => {
    const m = id ? team.find((t) => t.userId === id && !t.active) : undefined;
    return m ? [{ userId: m.userId, displayName: m.displayName, role: "inactive" }] : [];
  };
  const active = team.filter((m) => m.active);
  const editors: AssignOption[] = [
    ...active.map((m) => ({ userId: m.userId, displayName: m.displayName, role: m.role })),
    ...inactive(current?.editorId ?? null),
  ];
  const reviewers: AssignOption[] = [
    ...active.filter((m) => m.role === "reviewer" || m.role === "admin")
      .map((m) => ({ userId: m.userId, displayName: m.displayName, role: m.role })),
    ...inactive(current?.reviewerId ?? null),
  ];

  const editorName = nameOf(current?.editorId ?? null, current?.editorName ?? null);
  const reviewerName = nameOf(current?.reviewerId ?? null, current?.reviewerName ?? null);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
      <Heading id={headingId} className="font-serif text-lg font-semibold text-ink-strong">Assignment</Heading>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[13px] font-semibold text-muted">Editor</dt>
          <dd className="mt-0.5 text-ink">{editorName ?? "Not assigned"}</dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-muted">Reviewer</dt>
          <dd className="mt-0.5 text-ink">{reviewerName ?? "Not assigned"}</dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-muted">Due</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-ink">
            {current?.dueOn ? formatCalendarDate(current.dueOn) : "No due date"}
            {current?.overdue ? <OverdueBadge /> : null}
          </dd>
        </div>
      </dl>
      {current?.assignedAt ? (
        <p className="text-[13px] text-muted">
          Last changed {formatDate(current.assignedAt)}
          {current.assignedByName ? ` by ${current.assignedByName}` : ""}.
        </p>
      ) : null}
      {canAssign ? (
        <AssignForm
          institutionId={institutionId}
          editors={editors}
          reviewers={reviewers}
          current={current ? { editorId: current.editorId, reviewerId: current.reviewerId, dueOn: current.dueOn } : null}
        />
      ) : (
        <p className="text-[13px] text-muted">Only reviewers and administrators can change assignments.</p>
      )}
    </section>
  );
}

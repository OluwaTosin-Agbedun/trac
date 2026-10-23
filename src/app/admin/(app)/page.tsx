import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { requireViewer, type Viewer } from "@/server/auth/session";
import { getDashboard, type DashboardData } from "@/server/data/cms/institutions";
import { getResearchOverview } from "@/server/data/cms/research";
import { asUser } from "@/server/db";
import { formatCalendarDate, formatDate, formatCount, plural } from "@/lib/format";
import {
  OverdueBadge, ROLE_LABEL, RevisionStatusBadge, WithdrawnBadge, displayName,
} from "./institutions/_components/badges";

export const metadata: Metadata = { title: "Dashboard · CMS", robots: { index: false } };

export default function CmsDashboardPage() {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Team CMS</p>
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-[-0.01em] text-ink-strong sm:text-4xl">Dashboard</h1>
      </header>
      <Suspense fallback={<DashboardLoading />}>
        <DashboardBody />
      </Suspense>
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p role="status" className="text-sm text-muted">Loading your dashboard…</p>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-md border border-rule bg-white" />)}
      </div>
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-56 rounded-md border border-rule bg-white" />)}
      </div>
    </div>
  );
}

async function DashboardBody() {
  const viewer = await requireViewer();
  const [d, research, [{ n: institutionCount }]] = await Promise.all([
    getDashboard(viewer),
    getResearchOverview(viewer),
    asUser(viewer.userId, (tx) => tx.query<{ n: number }>("select count(*)::int as n from institutions where archived_at is null")),
  ]);
  const reviewer = viewer.role === "reviewer" || viewer.role === "admin";
  const researchWaiting = research.counts.pendingProposals + (viewer.role === "admin" ? research.pendingHosts.length : 0);

  const quick = [
    { href: "/admin/report", label: "Update the compliance report", show: true },
    { href: "/admin/institutions#add-institution", label: "Add an institution", show: true },
    { href: "/admin/review", label: `Review submissions${d.awaitingReview?.total ? ` (${d.awaitingReview.total})` : ""}`, show: reviewer },
    { href: "/admin/imports", label: "Upload tracker data", show: viewer.role === "admin" },
    { href: "/admin/research", label: `Research assistant${researchWaiting ? ` (${researchWaiting} waiting)` : ""}`, show: true },
    { href: "/admin/team", label: "Invite a team member", show: viewer.role === "admin" },
    { href: "/admin/help", label: "How to manage the site", show: true },
    { href: "/", label: "View the public site", show: true },
  ].filter((q) => q.show);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Quick actions" className="flex flex-wrap gap-2 rounded-md border border-rule bg-white p-3">
        {quick.map((q, i) => (
          <Link key={q.href} href={q.href}
            className={`inline-flex min-h-11 items-center rounded px-4 text-sm font-semibold no-underline ${i === 0 ? "bg-accent text-white! hover:bg-accent-hover" : "border border-rule text-ink hover:border-accent hover:text-accent"}`}>
            {q.label}
          </Link>
        ))}
      </nav>
      <div className="flex max-w-3xl flex-col gap-1 text-[15px] leading-relaxed text-[#2b3442]">
        <p>
          Welcome, <span className="font-semibold text-ink-strong">{viewer.displayName}</span>.
        </p>
        <p>
          Your role: <span className="font-semibold">{ROLE_LABEL[viewer.role] ?? viewer.role}</span>
. Below is the work waiting for you and what was released most
          recently.
        </p>
      </div>

      {institutionCount === 0 ? <GettingStarted admin={viewer.role === "admin"} /> : null}
      {research.counts.failedRecently ? (
        <p role="status" className="rounded-md border border-warn-rule bg-warn-bg px-4 py-3 text-sm text-warn-text">
          {plural(research.counts.failedRecently, "research scan")} failed or needed configuration in the last 7 days.{" "}
          <Link href="/admin/research" className="font-semibold underline underline-offset-2">See the Research centre</Link>.
        </p>
      ) : null}

      <AtAGlance d={d} reviewer={reviewer} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <AssignmentsCard d={d} />
        <ChangesRequestedCard d={d} />
        {reviewer ? <AwaitingReviewCard d={d} /> : null}
        <DraftsCard d={d} />
        <MySubmissionsCard d={d} />
        {reviewer ? <ImportsCard d={d} viewer={viewer} /> : null}
        <StaleCard d={d} />
        <ReleasesCard d={d} />
      </div>
    </div>
  );
}

function GettingStarted({ admin }: { admin: boolean }) {
  const steps = admin
    ? [
        { href: "/admin/imports", title: "Upload the tracker spreadsheet", text: "Excel (.xlsx), CSV or tab-separated. You see a preview before anything is saved." },
        { href: "/admin/imports", title: "Decide the held rows, then commit", text: "Commit turns safe rows into private drafts. Nothing is published." },
        { href: "/admin/team", title: "Invite your team", text: "Editors fill in drafts; reviewers check the evidence and publish." },
        { href: "/admin/institutions", title: "Assign institutions and start reviewing", text: "Each institution's page shows its draft, evidence and research assistant." },
      ]
    : [{ href: "/admin/help", title: "Nothing to work on yet", text: "An administrator has not uploaded the tracker yet. The help page explains how the CMS works." }];
  return (
    <section aria-labelledby="start-h" className="rounded-md border border-accent/40 bg-accent-soft p-5">
      <h2 id="start-h" className="font-serif text-xl font-semibold text-ink-strong">Getting started</h2>
      <p className="mt-1 text-sm text-[#2b3442]">The database is empty. These steps set the site up.</p>
      <ol className="mt-4 grid gap-3 md:grid-cols-2">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3 rounded border border-rule bg-white p-3">
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">{i + 1}</span>
            <span className="text-sm">
              <Link href={step.href} className="font-semibold text-accent underline underline-offset-2">{step.title}</Link>
              <span className="mt-0.5 block text-muted">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Summary tiles (counts only; each links to its card)
// ---------------------------------------------------------------------------

function AtAGlance({ d, reviewer }: { d: DashboardData; reviewer: boolean }) {
  const tiles: { href: string; label: string; value: number; note?: string }[] = [
    {
      href: "#assignments",
      label: "Open assignments",
      value: d.assignments.total,
      note: d.assignments.overdue ? `${formatCount(d.assignments.overdue)} overdue` : "None overdue",
    },
    { href: "#changes", label: "Changes requested", value: d.changesRequested.total },
    reviewer && d.awaitingReview
      ? { href: "#review", label: "Awaiting your review", value: d.awaitingReview.total }
      : { href: "#drafts", label: "My drafts", value: d.drafts.total },
    { href: "#stale", label: "Stale reviews", value: d.stale.total, note: `Initial ${d.stale.thresholdDays}-day threshold` },
  ];
  return (
    <section aria-labelledby="glance-h">
      <h2 id="glance-h" className="sr-only">At a glance</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.href}>
            <a
              href={t.href}
              className="flex min-h-24 flex-col justify-between gap-1 rounded-md border border-rule bg-white px-4 py-3 text-ink no-underline hover:border-accent hover:bg-accent-soft"
            >
              <span className="text-[13px] font-semibold text-muted">{t.label}</span>
              <span className="font-serif text-3xl font-semibold text-ink-strong">{formatCount(t.value)}</span>
              {t.note ? <span className="text-[13px] text-muted">{t.note}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function Card({ id, title, count, description, footer, children }: {
  id: string;
  title: string;
  count?: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-6 flex-col rounded-md border border-rule bg-white">
      <div className="flex flex-col gap-1 border-b border-rule-soft px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id={`${id}-h`} className="font-serif text-lg font-semibold text-ink-strong">{title}</h2>
          {count ? <span className="text-[13px] font-semibold text-muted">{count}</span> : null}
        </div>
        {description ? <p className="text-[13px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      <div className="flex-1 px-5 py-2">{children}</div>
      {footer ? <div className="border-t border-rule-soft px-5 py-3 text-sm">{footer}</div> : null}
    </section>
  );
}

function ItemList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-rule-soft">{children}</ul>;
}

function Item({ href, name, slug, children }: { href: string; name: string | null; slug?: string; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 py-3">
      <Link href={href} className="font-semibold underline-offset-2 hover:underline">{displayName(name)}</Link>
      {!name && slug ? <span className="font-mono text-[12px] text-subtle">{slug}</span> : null}
      {children ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">{children}</div> : null}
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-muted">{children}</p>;
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
      {children}
    </Link>
  );
}

const shown = (n: number, total: number) => (total > n ? `Showing ${n} of ${formatCount(total)}` : undefined);
const editHref = (institutionId: string) => `/admin/institutions/${institutionId}`;

function excerpt(text: string | null, max = 180): string | null {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function AssignmentsCard({ d }: { d: DashboardData }) {
  const { items, total, overdue } = d.assignments;
  return (
    <Card
      id="assignments"
      title="My assignments"
      count={total ? `${plural(total, "open assignment")}${overdue ? ` · ${formatCount(overdue)} overdue` : ""}` : undefined}
      description="Open assignments where you are the editor or the reviewer. An assignment is overdue once its due date has passed (Nigerian time)."
      footer={total ? <MoreLink href="/admin/institutions?assignee=me">All my assigned institutions</MoreLink> : undefined}
    >
      {items.length === 0 ? (
        <Empty>No open assignments. A reviewer or administrator assigns institutions to editors.</Empty>
      ) : (
        <>
          <ItemList>
            {items.map((a) => (
              <Item key={a.institutionId} href={editHref(a.institutionId)} name={a.name} slug={a.slug}>
                <span>
                  You are the {a.myRole}
                  {a.myRole === "editor" && a.reviewerName ? ` · reviewer ${a.reviewerName}` : ""}
                  {a.myRole === "reviewer" && a.editorName ? ` · editor ${a.editorName}` : ""}
                </span>
                <span>{a.dueOn ? `Due ${formatCalendarDate(a.dueOn)}` : "No due date"}</span>
                {a.overdue ? <OverdueBadge /> : null}
                <RevisionStatusBadge status={a.status} />
              </Item>
            ))}
          </ItemList>
          {shown(items.length, total) ? <p className="pb-2 text-[13px] text-muted">{shown(items.length, total)}, earliest due first.</p> : null}
        </>
      )}
    </Card>
  );
}

function ChangesRequestedCard({ d }: { d: DashboardData }) {
  const { items, total } = d.changesRequested;
  return (
    <Card
      id="changes"
      title="Changes requested"
      count={total ? plural(total, "revision") : undefined}
      description="Returned revisions on institutions assigned to you or submitted by you. A returned revision is closed; open the institution and start a new revision from it to make the corrections."
    >
      {items.length === 0 ? (
        <Empty>Nothing has been returned to you.</Empty>
      ) : (
        <>
          <ItemList>
            {items.map((c) => (
              <Item key={c.revisionId} href={editHref(c.institutionId)} name={c.name} slug={c.slug}>
                <span>
                  Revision {c.revisionNumber}
                  {c.decision === "rejected" ? " · findings rejected" : " · returned"}
                  {c.decidedByName ? ` by ${c.decidedByName}` : ""}
                  {c.decidedAt ? ` on ${formatDate(c.decidedAt)}` : ""}
                </span>
                {excerpt(c.notes) ? (
                  <span className="w-full text-ink">
                    <span className="font-semibold">Reviewer note: </span>
                    {excerpt(c.notes)}
                  </span>
                ) : null}
              </Item>
            ))}
          </ItemList>
          {shown(items.length, total) ? <p className="pb-2 text-[13px] text-muted">{shown(items.length, total)}, most recent first.</p> : null}
        </>
      )}
    </Card>
  );
}

function AwaitingReviewCard({ d }: { d: DashboardData }) {
  const review = d.awaitingReview ?? { items: [], total: 0 };
  const approved = d.approvedUnpublished ?? 0;
  return (
    <Card
      id="review"
      title="Awaiting your review"
      count={review.total ? plural(review.total, "submission") : undefined}
      description="Submitted revisions from other team members, oldest first. You cannot review your own submission."
      footer={
        <div className="flex flex-col gap-1">
          {approved ? (
            <p className="text-muted">
              {plural(approved, "approved revision")} {approved === 1 ? "is" : "are"} waiting to be published.
            </p>
          ) : null}
          <MoreLink href="/admin/review">Open the review queue</MoreLink>
        </div>
      }
    >
      {review.items.length === 0 ? (
        <Empty>No submissions are waiting for review.</Empty>
      ) : (
        <>
          <ItemList>
            {review.items.map((s) => (
              <Item key={s.revisionId} href={editHref(s.institutionId)} name={s.name} slug={s.slug}>
                <span>
                  Revision {s.revisionNumber} · submitted
                  {s.submittedByName ? ` by ${s.submittedByName}` : ""}
                  {s.submittedAt ? ` on ${formatDate(s.submittedAt)}` : ""}
                </span>
                {s.reviewCycle > 0 ? <span>Review cycle {s.reviewCycle + 1}</span> : null}
              </Item>
            ))}
          </ItemList>
          {shown(review.items.length, review.total) ? (
            <p className="pb-2 text-[13px] text-muted">{shown(review.items.length, review.total)}.</p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function DraftsCard({ d }: { d: DashboardData }) {
  const { items, total } = d.drafts;
  return (
    <Card
      id="drafts"
      title="My drafts"
      count={total ? plural(total, "draft") : undefined}
      description="Open draft revisions you started, most recently edited first. Drafts are private until reviewed and published."
      footer={total ? <MoreLink href="/admin/institutions?status=draft&sort=updated">All drafts in the directory</MoreLink> : undefined}
    >
      {items.length === 0 ? (
        <Empty>You have no open drafts.</Empty>
      ) : (
        <>
          <ItemList>
            {items.map((r) => (
              <Item key={r.revisionId} href={editHref(r.institutionId)} name={r.name} slug={r.slug}>
                <span>Revision {r.revisionNumber}</span>
                <span>Last edited {formatDate(r.updatedAt)}</span>
              </Item>
            ))}
          </ItemList>
          {shown(items.length, total) ? <p className="pb-2 text-[13px] text-muted">{shown(items.length, total)}.</p> : null}
        </>
      )}
    </Card>
  );
}

function MySubmissionsCard({ d }: { d: DashboardData }) {
  const { items, total } = d.mySubmissions;
  return (
    <Card
      id="submitted"
      title="My submissions awaiting review"
      count={total ? plural(total, "submission") : undefined}
      description="Revisions you submitted. They are frozen until a reviewer approves or returns them."
    >
      {items.length === 0 ? (
        <Empty>None of your submissions are waiting for review.</Empty>
      ) : (
        <>
          <ItemList>
            {items.map((s) => (
              <Item key={s.revisionId} href={editHref(s.institutionId)} name={s.name} slug={s.slug}>
                <span>Revision {s.revisionNumber}</span>
                <span>Submitted {formatDate(s.submittedAt)}</span>
              </Item>
            ))}
          </ItemList>
          {shown(items.length, total) ? <p className="pb-2 text-[13px] text-muted">{shown(items.length, total)}.</p> : null}
        </>
      )}
    </Card>
  );
}

function ImportsCard({ d, viewer }: { d: DashboardData; viewer: Viewer }) {
  const held = d.heldImportRows ?? { rows: 0, imports: 0 };
  return (
    <Card
      id="imports"
      title="Import rows waiting for a decision"
      count={held.rows ? plural(held.rows, "row") : undefined}
      description="Staged rows that are unnamed, conflicting, possible duplicates, have unusable websites, or match an institution already in the CMS. They are never committed without a human decision."
      footer={<MoreLink href="/admin/imports">Open the import centre</MoreLink>}
    >
      {held.rows === 0 ? (
        <Empty>No staged import rows are waiting for a decision.</Empty>
      ) : (
        <div className="flex flex-col gap-2 py-3">
          <p className="font-serif text-3xl font-semibold text-ink-strong">{formatCount(held.rows)}</p>
          <p className="text-sm text-ink">
            {held.rows === 1 ? "row is" : "rows are"} held across {plural(held.imports, "import")}. Legacy values on these rows are
            unverified claims, not assessments.
          </p>
          {viewer.role !== "admin" ? (
            <p className="text-[13px] text-muted">Only administrators can record import decisions.</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function StaleCard({ d }: { d: DashboardData }) {
  const { items, total, thresholdDays } = d.stale;
  return (
    <Card
      id="stale"
      title="Stale reviews"
      count={total ? plural(total, "institution") : undefined}
      description={`Published institutions whose current release was last verified by a person more than ${thresholdDays} days ago, or never (initial ${thresholdDays}-day threshold). A scan alone does not count as verification.`}
      footer={total ? <MoreLink href="/admin/institutions?published=yes">All published institutions</MoreLink> : undefined}
    >
      {items.length === 0 ? (
        <Empty>Every published institution was verified within the last {thresholdDays} days.</Empty>
      ) : (
        <>
          <ItemList>
            {items.map((s) => (
              <Item key={s.institutionId} href={editHref(s.institutionId)} name={s.name} slug={s.slug}>
                <span>{s.lastVerifiedAt ? `Last verified ${formatDate(s.lastVerifiedAt)}` : "Never verified"}</span>
                {s.releaseNumber !== null ? <span>Release {s.releaseNumber}, released {formatDate(s.publishedAt)}</span> : null}
              </Item>
            ))}
          </ItemList>
          {shown(items.length, total) ? (
            <p className="pb-2 text-[13px] text-muted">{shown(items.length, total)}, oldest verification first.</p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function ReleasesCard({ d }: { d: DashboardData }) {
  return (
    <Card
      id="releases"
      title="Recent releases"
      description="The five most recent publications, newest first. Withdrawn releases are marked and are no longer public."
    >
      {d.recentReleases.length === 0 ? (
        <Empty>Nothing has been published yet.</Empty>
      ) : (
        <ItemList>
          {d.recentReleases.map((r) => (
            <Item key={`${r.institutionId}-${r.releaseNumber}`} href={editHref(r.institutionId)} name={r.name} slug={r.slug}>
              <span>
                Release {r.releaseNumber} · released {formatDate(r.publishedAt)}
                {r.publishedByName ? ` by ${r.publishedByName}` : ""}
              </span>
              {r.withdrawnAt ? (
                <>
                  <WithdrawnBadge />
                  <span>on {formatDate(r.withdrawnAt)}</span>
                </>
              ) : r.isCurrent ? (
                <Link href={`/institutions/${r.slug}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                  View public page
                </Link>
              ) : (
                <span>Superseded by a later release</span>
              )}
            </Item>
          ))}
        </ItemList>
      )}
    </Card>
  );
}

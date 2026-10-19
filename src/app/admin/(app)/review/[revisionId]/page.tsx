import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { getReviewDetail, type ReviewDetail, type ReviewIndicator } from "@/server/data/cms/review";
import { Notice } from "@/components/ui/Form";
import { StatusMark } from "@/components/ui/StatusMark";
import {
  INDICATORS, INSTITUTION_TYPE_LABEL, OWNERSHIP_LABEL, PERIOD_TYPE_LABEL, STATE_SHORT,
  type InstitutionType, type Ownership,
} from "@/lib/indicators";
import { formatAmount, formatCalendarDate, formatCount, formatDate, formatDateTime, plural } from "@/lib/format";
import { indicatorProblems } from "@/lib/editorRules";
import type { SnapshotIndicator } from "@/lib/snapshot";
import { RevisionStatusBadge } from "../../institutions/_components/badges";
import { DecisionForm, PublishForm, ReopenForm, WithdrawForm } from "../_components/ReviewForms";

export const metadata: Metadata = { title: "Review revision", robots: { index: false } };

type Props = { params: Promise<{ revisionId: string }> };

const PROFILE_LABEL: Record<string, string> = {
  name: "Name", short_name: "Short name", ownership: "Ownership", institution_type: "Institution type", state: "State",
  city: "City or town", head_name: "Head of institution", head_title: "Head's title", bursar_name: "Bursar",
  website_url: "Official website", assessment_period: "Assessment period", last_verified_at: "Sources last checked by a person",
};

function profileText(key: string, v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "Not recorded";
  if (key === "ownership") return OWNERSHIP_LABEL[v as Ownership] ?? v;
  if (key === "institution_type") return INSTITUTION_TYPE_LABEL[v as InstitutionType] ?? v;
  if (key === "last_verified_at") return formatCalendarDate(v);
  return v;
}

type AnyInd = Pick<SnapshotIndicator, "state" | "period_type" | "period_label" | "value_amount" | "value_scale" | "value_currency" | "value_count" | "value_literal" | "reason">;

function periodText(i: AnyInd | undefined) {
  if (!i || (!i.period_label && !i.period_type)) return "No period";
  return [i.period_label, i.period_type ? PERIOD_TYPE_LABEL[i.period_type] : null].filter(Boolean).join(" · ");
}
function valueText(i: AnyInd | undefined, kind: "money" | "count") {
  if (!i) return "—";
  if (i.value_literal) return i.value_literal;
  if (kind === "money" && i.value_amount !== null && i.value_amount !== undefined) return formatAmount(i.value_amount, i.value_scale, i.value_currency);
  if (kind === "count" && i.value_count !== null && i.value_count !== undefined) return formatCount(i.value_count);
  return "Not stated";
}

function Cell({ changed, children }: { changed: boolean; children: React.ReactNode }) {
  return (
    <td className={`px-3 py-2.5 align-top ${changed ? "bg-[#fff4d6] font-semibold text-ink-strong" : ""}`}>
      {children}
      {changed ? <span className="sr-only"> (changed)</span> : null}
    </td>
  );
}

function ProfileDiff({ d }: { d: ReviewDetail }) {
  const pub = d.published?.payload.profile as Record<string, string | null> | undefined;
  return (
    <div className="overflow-x-auto rounded border border-rule-soft">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Profile: published release compared with this revision</caption>
        <thead>
          <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
            <th scope="col" className="px-3 py-2.5">Field</th>
            <th scope="col" className="px-3 py-2.5">Published</th>
            <th scope="col" className="px-3 py-2.5">This revision</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(PROFILE_LABEL).map((k) => {
            const before = pub ? profileText(k, k === "last_verified_at" ? (pub[k] ?? null)?.slice(0, 10) ?? null : pub[k]) : "—";
            const after = profileText(k, d.profile[k]);
            const changed = Boolean(pub) && before !== after;
            return (
              <tr key={k} className="border-t border-rule-soft">
                <th scope="row" className="px-3 py-2.5 text-left font-semibold text-ink">{PROFILE_LABEL[k]}</th>
                <td className="px-3 py-2.5 text-muted">{before}</td>
                <Cell changed={changed}>{after}</Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IndicatorDiff({ d }: { d: ReviewDetail }) {
  const pubInds = d.published?.payload.indicators ?? [];
  return (
    <div className="overflow-x-auto rounded border border-rule-soft">
      <table className="w-full min-w-[1000px] border-collapse text-sm">
        <caption className="sr-only">Indicators: published release compared with this revision</caption>
        <thead>
          <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
            <th scope="col" className="px-3 py-2.5">Indicator</th>
            <th scope="col" className="px-3 py-2.5">Published</th>
            <th scope="col" className="px-3 py-2.5">This revision</th>
            <th scope="col" className="px-3 py-2.5">Evidence</th>
            <th scope="col" className="px-3 py-2.5">Internal notes (never published)</th>
          </tr>
        </thead>
        <tbody>
          {INDICATORS.map((def) => {
            const now: ReviewIndicator | undefined = d.indicators.find((i) => i.key === def.key);
            const before = pubInds.find((i) => i.key === def.key);
            const ev = d.evidence.filter((e) => e.indicator_key === def.key);
            const pubEv = before?.evidence ?? [];
            const stateChanged = Boolean(before) && before?.state !== now?.state;
            const periodChanged = Boolean(before) && periodText(before) !== periodText(now);
            const valueChanged = Boolean(before) && valueText(before, def.kind) !== valueText(now, def.kind);
            const reasonChanged = Boolean(before) && (before?.reason ?? "") !== (now?.reason ?? "");
            const problems = now ? indicatorProblems(now, ev) : [];
            const added = ev.filter((e) => e.is_public && !pubEv.some((p) => p.url === e.url && (p.locator ?? "") === (e.locator ?? "")));
            const removed = pubEv.filter((p) => !ev.some((e) => e.is_public && e.url === p.url && (e.locator ?? "") === (p.locator ?? "")));
            return (
              <tr key={def.key} className="border-t border-rule-soft align-top">
                <th scope="row" className="px-3 py-2.5 text-left">
                  <span className="block font-semibold text-ink">{def.label}</span>
                  <span className="block text-[12px] font-normal text-muted">{def.group}</span>
                </th>
                <td className="px-3 py-2.5 text-muted">
                  {before ? (
                    <>
                      <span className="flex items-center gap-1.5"><StatusMark state={before.state} size={14} label="" />{STATE_SHORT[before.state]}</span>
                      <span className="block text-[12px]">{periodText(before)}</span>
                      <span className="block text-[12px]">{valueText(before, def.kind)}</span>
                    </>
                  ) : "—"}
                </td>
                <td className="px-3 py-2.5">
                  {now ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={`flex items-center gap-1.5 ${stateChanged ? "rounded bg-[#fff4d6] px-1 font-semibold" : ""}`}>
                        <StatusMark state={now.state} size={14} label="" />{STATE_SHORT[now.state]}{stateChanged ? <span className="sr-only"> (changed)</span> : null}
                      </span>
                      <span className={`text-[12px] ${periodChanged ? "rounded bg-[#fff4d6] px-1 font-semibold" : ""}`}>{periodText(now)}</span>
                      <span className={`text-[12px] ${valueChanged ? "rounded bg-[#fff4d6] px-1 font-semibold" : ""}`}>{valueText(now, def.kind)}</span>
                      {now.reason ? <span className={`text-[12px] text-ink ${reasonChanged ? "rounded bg-[#fff4d6] px-1 font-semibold" : ""}`}>Reason: {now.reason}</span> : null}
                    </div>
                  ) : "—"}
                  {problems.length ? (
                    <ul className="mt-1.5 list-disc pl-4 text-[12px] font-medium text-danger">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-[12px]">
                  {ev.length ? (
                    <ul className="flex flex-col gap-1">
                      {ev.map((e) => (
                        <li key={e.id}>
                          <span className="font-semibold text-ink">{e.title ?? e.url}</span>
                          {e.locator ? <span className="text-muted"> · {e.locator}</span> : null}
                          {!e.is_public ? <span className="ml-1 rounded border border-rule px-1 text-[11px] text-muted">private</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : <span className="text-muted">None</span>}
                  {added.length || removed.length ? (
                    <p className="mt-1 font-semibold text-ink-strong">
                      {added.length ? `${plural(added.length, "public item")} added` : ""}{added.length && removed.length ? " · " : ""}
                      {removed.length ? `${plural(removed.length, "item")} removed` : ""}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-[12px] text-ink">{now?.internal_note ?? <span className="text-muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function ReviewBody({ params }: Props) {
  const { revisionId } = await params;
  if (!isUuid(revisionId)) notFound();
  const viewer = await requireViewer();
  const d = await getReviewDetail(viewer, revisionId);
  if (!d) notFound();
  const canReview = viewer.role === "reviewer" || viewer.role === "admin";
  const selfReview = d.submittedBy === viewer.userId;
  const blocking = d.indicators.some((i) => indicatorProblems(i, d.evidence.filter((e) => e.indicator_key === i.key)).length > 0);

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/admin/review">Review queue</Link> / Revision {d.number}
      </nav>
      <header className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-2xl font-semibold text-ink-strong">{d.profile.name ?? "Unnamed institution"}</h1>
          <RevisionStatusBadge status={d.status} />
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[13px] text-muted">Revision</dt><dd>No. {d.number}{d.reviewCycle ? ` · review cycle ${d.reviewCycle + 1}` : ""}</dd></div>
          <div><dt className="text-[13px] text-muted">Submitted</dt><dd>{formatDateTime(d.submittedAt)}{d.submittedByName ? ` by ${d.submittedByName}` : ""}</dd></div>
          <div><dt className="text-[13px] text-muted">Waiting</dt><dd>{d.waitingDays === null ? "—" : d.waitingDays === 0 ? "Since today" : plural(d.waitingDays, "day")}</dd></div>
          <div><dt className="text-[13px] text-muted">Base public release</dt><dd>{d.published ? `Release ${d.published.releaseNumber} (${formatDate(d.published.publishedAt)})` : "None yet"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-[13px] text-muted">Content hash (approval binds to this)</dt><dd><code className="text-[13px]">{d.contentHash ? `${d.contentHash.slice(0, 12)}…` : "Not submitted"}</code></dd></div>
          <div className="sm:col-span-2 flex flex-wrap items-end gap-4">
            <Link href={`/admin/institutions/${d.institutionId}`} className="text-sm font-semibold">Open in the editor</Link>
            <Link href={`/admin/review/${d.revisionId}/preview`} className="text-sm font-semibold">Preview public page</Link>
          </div>
        </dl>
        {!d.isLatest ? <Notice tone="warn">A newer revision exists for this institution. This one is kept for the record.</Notice> : null}
      </header>

      <section aria-labelledby="diff-profile-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h2 id="diff-profile-h" className="font-serif text-xl font-semibold text-ink-strong">Profile changes</h2>
        {!d.published ? <p className="text-sm text-muted">No published release yet, so everything in this revision is new.</p> : null}
        <ProfileDiff d={d} />
      </section>

      <section aria-labelledby="diff-ind-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h2 id="diff-ind-h" className="font-serif text-xl font-semibold text-ink-strong">Indicators and evidence</h2>
        <p className="text-sm text-muted">Changed values are highlighted. Check each published finding against its evidence and period.</p>
        {blocking ? <Notice tone="danger">Some published findings lack a period or evidence with a locator. Return this revision for changes.</Notice> : null}
        <IndicatorDiff d={d} />
      </section>

      <section aria-labelledby="decisions-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h2 id="decisions-h" className="font-serif text-xl font-semibold text-ink-strong">Decision</h2>
        {d.approvals.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {d.approvals.map((a, i) => (
              <li key={i} className="rounded border border-rule-soft p-3">
                <span className="font-semibold">{a.decision === "approved" ? "Approved" : a.decision === "changes_requested" ? "Changes requested" : "Rejected"}</span>
                <span className="text-muted"> · {a.decidedByName ?? "Unknown"} · {formatDateTime(a.decidedAt)}</span>
                {a.notes ? <p className="mt-1">{a.notes}</p> : null}
                {a.overrideReason ? <p className="mt-1 text-warn-text">Self-review override: {a.overrideReason}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {d.status === "submitted" ? (
          !canReview ? (
            <p className="text-sm text-muted">Waiting for a reviewer. Only reviewers and administrators can record a decision.</p>
          ) : selfReview && viewer.role !== "admin" ? (
            <Notice tone="warn">You cannot review your own submission. Another reviewer must do it.</Notice>
          ) : (
            <DecisionForm revisionId={d.revisionId} selfReview={selfReview} isAdmin={viewer.role === "admin"} />
          )
        ) : d.status === "approved" ? (
          canReview ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                Approved. <Link href={`/admin/review/${d.revisionId}/preview`} className="font-semibold">Preview the public page</Link>, then publish.
              </p>
              <PublishForm revisionId={d.revisionId} />
              <details className="rounded border border-rule-soft">
                <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold text-accent">Found a mistake? Return it for changes instead</summary>
                <div className="border-t border-rule-soft p-3"><ReopenForm revisionId={d.revisionId} /></div>
              </details>
            </div>
          ) : <p className="text-sm text-muted">Approved. A reviewer will publish it.</p>
        ) : (
          <p className="text-sm text-muted">This revision is {d.status.replace("_", " ")}; no decision is pending.</p>
        )}
      </section>

      {canReview && d.hasCurrentRelease ? (
        <section aria-labelledby="withdraw-h" className="flex flex-col gap-3 rounded-md border border-[#e8b4b4] bg-white p-5">
          <h2 id="withdraw-h" className="font-serif text-xl font-semibold text-danger">Withdraw from the public site</h2>
          <p className="text-sm text-muted">Use only when what is published is wrong and should not stay public. This revision can still be published afterwards. Recorded with your reason.</p>
          <WithdrawForm institutionId={d.institutionId} />
        </section>
      ) : null}
    </div>
  );
}

export default function ReviewDetailPage(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the revision…</p>}>
      <ReviewBody params={props.params} />
    </Suspense>
  );
}

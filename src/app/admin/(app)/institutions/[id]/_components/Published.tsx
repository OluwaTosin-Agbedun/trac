// "Currently published" column: what the public sees now, from the current published snapshot.
// Shown beside the draft so editors can compare. Server component; no hooks.
import { StatusMark } from "@/components/ui/StatusMark";
import { ASSESSMENT_STATES, STATE_LABEL, type AssessmentState } from "@/lib/indicators";
import { formatDate, formatDateTime } from "@/lib/format";
import { safeHttpUrl, type SnapshotEvidence, type SnapshotIndicator } from "@/lib/snapshot";
import type { ProfileField } from "@/lib/editorRules";
import type { PublishedRelease, WithdrawnRelease } from "@/server/data/cms/editor";
import { NOT_RECORDED, NOT_STATED, ownershipText, periodText, typeText, valueText } from "./labels";

const asState = (v: unknown): AssessmentState =>
  typeof v === "string" && (ASSESSMENT_STATES as readonly string[]).includes(v) ? (v as AssessmentState) : "not_assessed";

export function ColumnLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">{children}</p>;
}

export function DiffersBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded border border-warn-rule bg-warn-bg px-1.5 text-[12px] font-semibold text-warn-text">
      Draft differs
    </span>
  );
}

export function NotPublished({ withdrawn }: { withdrawn: WithdrawnRelease | null }) {
  return (
    <div className="flex flex-col gap-2 text-sm text-muted">
      <p className="font-semibold text-ink">Nothing is published for this institution.</p>
      {withdrawn ? (
        <p>
          Release {withdrawn.releaseNumber} was withdrawn on {formatDateTime(withdrawn.withdrawnAt)}
          {withdrawn.reason ? `. Reason: ${withdrawn.reason}` : ""}. It is no longer public.
        </p>
      ) : (
        <p>The public site will show this institution only after a reviewer approves and publishes a revision.</p>
      )}
    </div>
  );
}

function ExternalLink({ url, children }: { url: string | null | undefined; children?: React.ReactNode }) {
  const safe = safeHttpUrl(url);
  if (!safe) return <span className="break-all">{url || NOT_RECORDED}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">
      {children ?? url}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function PublishedProfile({ published, withdrawn, changed }: {
  published: PublishedRelease | null;
  withdrawn: WithdrawnRelease | null;
  changed: ProfileField[];
}) {
  if (!published) return <NotPublished withdrawn={withdrawn} />;
  const p = published.payload.profile ?? ({} as PublishedRelease["payload"]["profile"]);
  const rows: { key: ProfileField | "last_verified_at"; label: string; value: React.ReactNode }[] = [
    { key: "name", label: "Name", value: p.name || NOT_RECORDED },
    { key: "short_name", label: "Short name", value: p.short_name || NOT_RECORDED },
    { key: "ownership", label: "Ownership", value: ownershipText(p.ownership) },
    { key: "institution_type", label: "Type", value: typeText(p.institution_type) },
    { key: "state", label: "State", value: p.state || NOT_RECORDED },
    { key: "city", label: "City or town", value: p.city || NOT_RECORDED },
    { key: "head_name", label: "Head of institution", value: p.head_name || NOT_RECORDED },
    { key: "head_title", label: "Head's title", value: p.head_title || NOT_RECORDED },
    { key: "bursar_name", label: "Bursar", value: p.bursar_name || NOT_RECORDED },
    { key: "website_url", label: "Official website", value: p.website_url ? <ExternalLink url={p.website_url} /> : NOT_RECORDED },
    { key: "assessment_period", label: "Assessment period", value: p.assessment_period || NOT_STATED },
    { key: "last_verified_at", label: "Last human verification", value: p.last_verified_at ? formatDate(p.last_verified_at) : NOT_RECORDED },
  ];
  return (
    <dl className="flex flex-col gap-3 text-sm">
      {rows.map((r) => (
        <div key={r.key}>
          <dt className="text-[13px] font-semibold text-muted">
            {r.label}
            {r.key !== "last_verified_at" && changed.includes(r.key) ? <DiffersBadge /> : null}
          </dt>
          <dd className="mt-0.5 break-words text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PublishedEvidenceList({ evidence }: { evidence: SnapshotEvidence[] }) {
  if (!evidence.length) return <p className="text-[13px] text-muted">No public evidence in this release.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {evidence.map((e) => (
        <li key={e.id} className="rounded border border-rule-soft bg-surface p-2 text-[13px]">
          <ExternalLink url={e.url}>{e.title || e.url}</ExternalLink>
          {e.locator ? <span className="block text-muted">Locator: {e.locator}</span> : null}
          {e.document_period ? <span className="block text-muted">Document period: {e.document_period}</span> : null}
          <span className="block text-muted">Captured {e.captured_at ? formatDate(e.captured_at) : "date not recorded"}</span>
        </li>
      ))}
    </ul>
  );
}

export function PublishedIndicator({ published, indicator }: {
  published: PublishedRelease | null;
  indicator: SnapshotIndicator | null;
}) {
  if (!published) return <p className="text-sm text-muted">Not published. Nothing about this indicator is public.</p>;
  if (!indicator) return <p className="text-sm text-muted">This indicator is not in the published release.</p>;
  const state = asState(indicator.state);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="flex items-start gap-2 font-semibold text-ink">
        <StatusMark state={state} label="" />
        <span>{STATE_LABEL[state]}</span>
      </p>
      <dl className="flex flex-col gap-2">
        <div>
          <dt className="text-[13px] font-semibold text-muted">Period</dt>
          <dd className="text-ink">{periodText(indicator)}</dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-muted">Value</dt>
          <dd className="text-ink">{valueText(indicator)}</dd>
        </div>
        {indicator.value_literal ? (
          <div>
            <dt className="text-[13px] font-semibold text-muted">As printed</dt>
            <dd className="text-ink">{indicator.value_literal}</dd>
          </div>
        ) : null}
        {indicator.reason ? (
          <div>
            <dt className="text-[13px] font-semibold text-muted">Public reason</dt>
            <dd className="whitespace-pre-line text-ink">{indicator.reason}</dd>
          </div>
        ) : null}
      </dl>
      <div>
        <p className="mb-1 text-[13px] font-semibold text-muted">Public evidence ({indicator.evidence?.length ?? 0})</p>
        <PublishedEvidenceList evidence={indicator.evidence ?? []} />
      </div>
    </div>
  );
}

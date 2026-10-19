// One indicator in the editor: a collapsible row with the draft's form and evidence on the left and
// the currently published values on the right. Server component; the forms inside are clients.
import { StatusMark } from "@/components/ui/StatusMark";
import { STATE_SHORT, type INDICATORS } from "@/lib/indicators";
import { formatCalendarDate, formatDate } from "@/lib/format";
import { safeHttpUrl } from "@/lib/snapshot";
import { indicatorChanges, indicatorProblems, indicatorWarnings } from "@/lib/editorRules";
import type { EditorEvidence, EditorIndicator, PublishedRelease, TeamPerson } from "@/server/data/cms/editor";
import { IndicatorForm } from "./IndicatorForm";
import { AddEvidenceForm, RemoveEvidenceForm } from "./EvidenceForms";
import { ColumnLabel, PublishedIndicator } from "./Published";
import { periodText, personName, valueText } from "./labels";

type Def = (typeof INDICATORS)[number];

export function EvidenceList({ evidence, revisionId, lockVersion, editable, team, headingId, heading, level = "h5" }: {
  evidence: EditorEvidence[];
  revisionId: string;
  lockVersion: number;
  editable: boolean;
  team: TeamPerson[];
  headingId: string;
  heading: string;
  level?: "h3" | "h4" | "h5";
}) {
  const Heading = level;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <Heading id={headingId} className="text-sm font-semibold text-ink-strong">
        {heading} ({evidence.length})
      </Heading>
      {evidence.length === 0 ? (
        <p className="text-[13px] text-muted">No evidence recorded in this revision.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {evidence.map((e) => {
            const safe = safeHttpUrl(e.url);
            const label = e.title || e.url;
            return (
              <li key={e.id} className="flex flex-col gap-2 rounded-md border border-rule-soft bg-surface p-3 text-sm sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded border px-1.5 text-[12px] font-semibold ${e.is_public ? "border-rule bg-white text-ink" : "border-ink-strong bg-ink-strong text-white"}`}>
                      {e.is_public ? "Public" : "Private"}
                    </span>
                    {safe ? (
                      <a href={safe} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all font-semibold underline underline-offset-2">
                        {label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="break-all font-semibold">{label}</span>
                    )}
                  </p>
                  {e.title ? <p className="mt-1 break-all text-[13px] text-muted">{e.url}</p> : null}
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
                    <div><dt className="inline font-semibold text-muted">Locator: </dt><dd className="inline text-ink">{e.locator || "Not recorded"}</dd></div>
                    <div><dt className="inline font-semibold text-muted">Document period: </dt><dd className="inline text-ink">{e.document_period || "Not stated"}</dd></div>
                    <div><dt className="inline font-semibold text-muted">Source published: </dt><dd className="inline text-ink">{e.source_published_on ? formatCalendarDate(e.source_published_on) : "Not stated"}</dd></div>
                    <div><dt className="inline font-semibold text-muted">Captured: </dt><dd className="inline text-ink">{e.captured_at ? formatDate(e.captured_at) : "Not recorded"}</dd></div>
                    <div className="sm:col-span-2"><dt className="inline font-semibold text-muted">Added by: </dt><dd className="inline text-ink">{personName(team, e.created_by)}</dd></div>
                  </dl>
                  {e.excerpt ? (
                    <blockquote className="mt-2 whitespace-pre-line border-l-0 bg-white px-3 py-2 text-[13px] text-ink ring-1 ring-rule-soft">
                      {e.excerpt}
                    </blockquote>
                  ) : null}
                </div>
                {editable ? (
                  <div className="shrink-0">
                    <RemoveEvidenceForm revisionId={revisionId} lockVersion={lockVersion} evidenceId={e.id} label={label} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Pill({ tone, children }: { tone: "warn" | "info" | "danger"; children: React.ReactNode }) {
  const tones = {
    warn: "border-warn-rule bg-warn-bg text-warn-text",
    info: "border-rule bg-accent-soft text-accent",
    danger: "border-[#e8b4b4] bg-danger-bg text-danger",
  } as const;
  return <span className={`inline-flex items-center rounded border px-1.5 text-[12px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function IndicatorSection({ def, draft, evidence, revisionId, lockVersion, editable, published, team, today }: {
  def: Def;
  draft: EditorIndicator | undefined;
  evidence: EditorEvidence[];
  revisionId: string;
  lockVersion: number;
  editable: boolean;
  published: PublishedRelease | null;
  team: TeamPerson[];
  today: string;
}) {
  const publishedInd = published?.payload.indicators?.find((i) => i.key === def.key) ?? null;
  if (!draft) {
    return (
      <div className="rounded-md border border-rule bg-white p-4 text-sm">
        <h4 className="font-semibold text-ink-strong">{def.label}</h4>
        <p className="mt-1 text-muted">This revision has no row for this indicator. Start a new draft or contact an administrator.</p>
      </div>
    );
  }
  const problems = indicatorProblems(draft, evidence);
  const warnings = indicatorWarnings(draft, evidence);
  const changes = indicatorChanges(draft, evidence.filter((e) => e.is_public), publishedInd, publishedInd?.evidence ?? []);
  const headingId = `ind-${def.key}-h`;

  return (
    <details id={`ind-${def.key}`} className="group rounded-md border border-rule bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block w-3 text-muted transition-transform group-open:rotate-90">›</span>
        <StatusMark state={draft.state} label="" />
        <h4 id={headingId} className="font-semibold text-ink-strong">{def.label}</h4>
        <span className="text-[13px] text-ink">{STATE_SHORT[draft.state]}</span>
        <span className="text-[13px] text-muted">{periodText(draft)}</span>
        <span className="text-[13px] text-muted">{valueText(draft)}</span>
        <span className="text-[13px] text-muted">{evidence.length} evidence</span>
        {problems.length ? <Pill tone="danger">{problems.length} to fix before submitting</Pill> : null}
        {changes.length ? <Pill tone="info">Changed from published: {changes.join(", ")}</Pill> : null}
        {published && !changes.length ? <span className="text-[12px] text-muted">Same as published</span> : null}
      </summary>
      <div className="grid gap-6 border-t border-rule-soft p-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        <div className="flex min-w-0 flex-col gap-5">
          <ColumnLabel>Draft</ColumnLabel>
          {problems.length || warnings.length ? (
            <div className="rounded-md border border-warn-rule bg-warn-bg px-4 py-3 text-sm text-warn-text">
              {problems.length ? (
                <>
                  <p className="font-semibold">Needed before this revision can be submitted</p>
                  <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </>
              ) : null}
              {warnings.length ? (
                <>
                  <p className={`font-semibold ${problems.length ? "mt-2" : ""}`}>Worth checking</p>
                  <ul className="mt-1 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </>
              ) : null}
            </div>
          ) : null}
          <IndicatorForm revisionId={revisionId} lockVersion={lockVersion} indicator={draft} kind={def.kind} label={def.label} editable={editable} />
          <EvidenceList
            evidence={evidence}
            revisionId={revisionId}
            lockVersion={lockVersion}
            editable={editable}
            team={team}
            headingId={`ind-${def.key}-ev-h`}
            heading="Evidence in this draft"
          />
          {editable ? (
            <details className="rounded-md border border-rule-soft">
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-accent">Add evidence</summary>
              <div className="border-t border-rule-soft p-4">
                <AddEvidenceForm revisionId={revisionId} lockVersion={lockVersion} defaultIndicator={def.key} idPrefix={def.key} today={today} />
              </div>
            </details>
          ) : null}
        </div>
        <aside aria-label={`Currently published: ${def.label}`} className="flex min-w-0 flex-col gap-3 rounded-md border border-rule-soft bg-surface-2 p-4 xl:self-start">
          <ColumnLabel>Currently published{published ? ` · release ${published.releaseNumber}` : ""}</ColumnLabel>
          <PublishedIndicator published={published} indicator={publishedInd} />
        </aside>
      </div>
    </details>
  );
}

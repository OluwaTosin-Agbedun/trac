// CMS institution editor: the latest revision's profile, nine indicators and evidence, edited as a
// private draft beside the currently published release, plus workflow, legacy import provenance
// and history. Every read runs as the signed-in member (RLS applies); every write is a checked
// server action backed by a database workflow function.
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { getEditorData } from "@/server/data/cms/editor";
import { StatusLegend } from "@/components/ui/StatusMark";
import { INDICATORS, INDICATOR_GROUPS } from "@/lib/indicators";
import { lagosDate, profileChanges } from "@/lib/editorRules";
import { AssignPanel } from "../_components/AssignPanel";
import { EditorHeader } from "./_components/EditorHeader";
import { WorkflowPanel } from "./_components/WorkflowPanel";
import { ProfileForm } from "./_components/ProfileForm";
import { ColumnLabel, PublishedProfile } from "./_components/Published";
import { EvidenceList, IndicatorSection } from "./_components/IndicatorSection";
import { AddEvidenceForm } from "./_components/EvidenceForms";
import { LegacyPanel } from "./_components/LegacyPanel";
import { HistoryPanel } from "./_components/HistoryPanel";
import { ResearchPanel } from "./_components/ResearchPanel";
import { WithdrawForm } from "../../review/_components/ReviewForms";
import { PROFILE_LABEL } from "./_components/labels";

export const metadata: Metadata = { title: "Institution editor" };

type Props = { params: Promise<{ id: string }> };

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="rounded-md border border-rule bg-white p-5 text-sm text-muted">
      {label}…
    </div>
  );
}

const JUMP = [
  { href: "#workflow-h", label: "Workflow" },
  { href: "#profile-h", label: "Profile" },
  { href: "#indicators-h", label: "Indicators" },
  { href: "#research-h", label: "Research assistant" },
  { href: "#legacy-h", label: "Legacy import" },
  { href: "#history-h", label: "History" },
];

async function EditorBody({ params }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const viewer = await requireViewer();
  const data = await getEditorData(viewer, id);
  if (!data) notFound();

  const { latest, published } = data;
  const editable = latest?.status === "draft";
  const today = lagosDate();
  const changedProfile = latest ? profileChanges(latest.profile, published?.payload.profile ?? null) : [];
  const generalEvidence = data.evidence.filter((e) => e.indicator_key === null);

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-8">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] xl:items-start">
        <EditorHeader data={data} />
        <Suspense fallback={<Loading label="Loading the assignment" />}>
          <AssignPanel institutionId={data.institution.id} />
        </Suspense>
      </div>

      <nav aria-label="On this page" className="flex flex-wrap gap-x-1 gap-y-1 text-sm">
        {JUMP.map((j) => (
          <a key={j.href} href={j.href} className="inline-flex min-h-11 items-center rounded px-3 font-semibold underline-offset-2 hover:bg-white hover:underline">
            {j.label}
          </a>
        ))}
      </nav>

      <WorkflowPanel data={data} viewer={viewer} />

      {latest ? (
        <>
          <section aria-labelledby="profile-h" className="flex flex-col gap-4">
            <div>
              <h2 id="profile-h" className="font-serif text-2xl font-semibold text-ink-strong">Profile</h2>
              <p className="mt-1 text-sm text-muted">
                Edits are saved to revision {latest.number} only. The public page keeps showing the published values on
                the right until a reviewer approves and publishes a new revision.
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] xl:items-start">
              <div className="flex min-w-0 flex-col gap-5 rounded-md border border-rule bg-white p-5">
                <ColumnLabel>Draft · revision {latest.number}</ColumnLabel>
                {changedProfile.length ? (
                  <p className="text-[13px] text-ink">
                    <span className="font-semibold">Differs from the published release:</span>{" "}
                    {changedProfile.map((f) => PROFILE_LABEL[f] ?? f).join(", ")}
                  </p>
                ) : null}
                <ProfileForm revisionId={latest.id} lockVersion={latest.lockVersion} profile={latest.profile} editable={editable}
                  lastVerifiedAt={latest.lastVerifiedAt} today={today} />
                <EvidenceList
                  evidence={generalEvidence}
                  revisionId={latest.id}
                  lockVersion={latest.lockVersion}
                  editable={editable}
                  team={data.team}
                  headingId="profile-ev-h"
                  heading="General profile evidence"
                  level="h3"
                />
                {editable ? (
                  <details className="rounded-md border border-rule-soft">
                    <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-accent">Add evidence</summary>
                    <div className="border-t border-rule-soft p-4">
                      <AddEvidenceForm revisionId={latest.id} lockVersion={latest.lockVersion} defaultIndicator="general" idPrefix="general" today={today} />
                    </div>
                  </details>
                ) : null}
              </div>
              <aside aria-label="Currently published profile" className="flex min-w-0 flex-col gap-4 rounded-md border border-rule-soft bg-surface-2 p-5">
                <ColumnLabel>Currently published{published ? ` · release ${published.releaseNumber}` : ""}</ColumnLabel>
                <PublishedProfile published={published} withdrawn={data.withdrawn} changed={changedProfile} />
              </aside>
            </div>
          </section>

          <section aria-labelledby="indicators-h" className="flex flex-col gap-5">
            <div>
              <h2 id="indicators-h" className="font-serif text-2xl font-semibold text-ink-strong">Indicators</h2>
              <p className="mt-1 text-sm text-muted">
                Open an indicator to edit its assessment and evidence. Each one saves on its own. The right-hand column
                shows what the public sees now.
              </p>
            </div>
            <StatusLegend />
            {INDICATOR_GROUPS.map((group) => (
              <div key={group} className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-ink-strong">{group}</h3>
                {INDICATORS.filter((d) => d.group === group).map((def) => (
                  <IndicatorSection
                    key={def.key}
                    def={def}
                    draft={data.indicators.find((i) => i.key === def.key)}
                    evidence={data.evidence.filter((e) => e.indicator_key === def.key)}
                    revisionId={latest.id}
                    lockVersion={latest.lockVersion}
                    editable={editable}
                    published={published}
                    team={data.team}
                    today={today}
                  />
                ))}
              </div>
            ))}
          </section>
        </>
      ) : null}

      {published && (viewer.role === "reviewer" || viewer.role === "admin") ? (
        <details className="rounded-md border border-[#e8b4b4] bg-white">
          <summary className="min-h-11 cursor-pointer px-5 py-3 text-sm font-semibold text-danger">Withdraw from the public site</summary>
          <div className="flex flex-col gap-3 border-t border-[#e8b4b4] p-5">
            <p className="text-sm text-muted">
              Use only when what is published is wrong and should not stay public. Every release of this institution leaves the
              public site until a corrected version is published. Recorded with your reason.
            </p>
            <WithdrawForm institutionId={data.institution.id} />
          </div>
        </details>
      ) : null}

      <Suspense fallback={<Loading label="Loading the research assistant" />}>
        <ResearchPanel institutionId={data.institution.id} />
      </Suspense>

      <LegacyPanel rows={data.legacy} />

      <Suspense fallback={<Loading label="Loading the history" />}>
        <HistoryPanel viewer={viewer} institutionId={data.institution.id} />
      </Suspense>
    </div>
  );
}

export default function InstitutionEditorPage(props: Props) {
  return (
    <Suspense fallback={<Loading label="Loading the institution editor" />}>
      <EditorBody params={props.params} />
    </Suspense>
  );
}

// Evidence detail for one source behind the current public release. The record comes only from
// the published snapshot payload: no private notes, no staff identities, no draft evidence.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { STATE_LABEL } from "@/lib/indicators";
import { formatCalendarDate, formatDate } from "@/lib/format";
import { periodCoverage } from "@/lib/compare";
import { safeHttpUrl, type SnapshotEvidence, type SnapshotIndicator } from "@/lib/snapshot";
import { isUuid } from "@/server/auth/crypto";
import { getCurrentBySlug, isSlug } from "@/server/data/public";
import { StatusMark } from "@/components/ui/StatusMark";
import { profilePath } from "@/components/public/profile/SnapshotView";
import { releasePath } from "@/components/public/profile/HistoryTable";
import { indicatorAnchor } from "@/components/public/profile/IndicatorSection";
import { coverageNote } from "@/components/public/profile/EvidenceList";
import { hostOf, institutionName, literalText, NOT_RECORDED, periodText, stateOf, valueText } from "@/components/public/profile/labels";
import { Badge, Breadcrumbs, CONTAINER, EYEBROW, ExternalLink, LoadingBlock, Pair } from "@/components/public/profile/parts";

export const metadata: Metadata = { title: "Evidence" };

type Props = { params: Promise<{ slug: string; evidenceId: string }> };

async function EvidenceBody({ params }: Props) {
  const { slug, evidenceId } = await params;
  if (!isSlug(slug) || !isUuid(evidenceId)) notFound();
  await connection();
  const snapshot = await getCurrentBySlug(slug);
  if (!snapshot) notFound();

  const id = evidenceId.toLowerCase();
  let evidence: SnapshotEvidence | null = null;
  let indicator: SnapshotIndicator | null = null;
  for (const ind of snapshot.payload.indicators ?? []) {
    const found = (ind.evidence ?? []).find((e) => String(e.id).toLowerCase() === id);
    if (found) {
      evidence = found;
      indicator = ind;
      break;
    }
  }
  if (!evidence) evidence = (snapshot.payload.profile_evidence ?? []).find((e) => String(e.id).toLowerCase() === id) ?? null;
  if (!evidence) notFound();

  const profile = snapshot.payload.profile;
  const name = institutionName(profile);
  const title = evidence.title?.trim() || "Untitled source document";
  const safeUrl = safeHttpUrl(evidence.url);
  const host = hostOf(evidence.url);
  const assessment = profile.assessment_period?.trim() || null;
  const docPeriod = evidence.document_period?.trim() || null;
  const coverage = docPeriod ? periodCoverage(docPeriod, assessment) : "unknown";
  const note = coverageNote(docPeriod, assessment);
  const state = indicator ? stateOf(indicator) : null;
  const value = indicator ? valueText(indicator) : null;
  const literal = indicator ? literalText(indicator) : null;

  return (
    <div className={`${CONTAINER} flex flex-col gap-8 py-6 sm:py-8`}>
      <Breadcrumbs
        items={[
          { href: "/institutions", label: "Institutions" },
          { href: profilePath(snapshot.slug), label: name },
          { label: "Evidence" },
        ]}
      />

      <div className="flex max-w-[860px] flex-col gap-2">
        <p className={EYEBROW}>Evidence · {name}</p>
        <h1 className="font-serif text-[30px] font-semibold leading-tight text-ink-strong sm:text-4xl">{title}</h1>
        <p className="text-[15px] text-muted">
          {indicator ? (
            <>
              Supports the <strong className="font-semibold text-ink">{indicator.label}</strong> indicator ({indicator.group}) in
              release {snapshot.releaseNumber}.
            </>
          ) : (
            <>General source for the institution&apos;s profile in release {snapshot.releaseNumber}; not tied to one indicator.</>
          )}
        </p>
        {note ? (
          <p>
            <Badge tone={note.tone}>{note.text}</Badge>
          </p>
        ) : null}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="source-h" className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
            <h2 id="source-h" className="text-[17px] font-semibold text-ink-strong">
              Source document
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Pair term="Official URL" className="sm:col-span-2">
                {safeUrl ? (
                  <ExternalLink href={safeUrl} className="inline-block break-all py-2.5">
                    {safeUrl}
                  </ExternalLink>
                ) : (
                  <span className="break-all">{evidence.url || NOT_RECORDED}</span>
                )}
              </Pair>
              <Pair term="Website">{host ?? NOT_RECORDED}</Pair>
              <Pair term="Location in the document">{evidence.locator?.trim() || NOT_RECORDED}</Pair>
              <Pair term="Period the document covers">
                {docPeriod ?? "Not stated"}
                {docPeriod && assessment ? (
                  <span className="block text-[13px] text-muted">
                    {coverage === "in_period"
                      ? `Overlaps the assessment period (${assessment}).`
                      : coverage === "historical"
                        ? `Earlier than the assessment period (${assessment}). Prior-period evidence does not establish disclosure for the current period.`
                        : coverage === "later"
                          ? `Later than the assessment period (${assessment}).`
                          : `Could not be placed against the assessment period (${assessment}).`}
                  </span>
                ) : null}
              </Pair>
              {evidence.source_published_on ? (
                <Pair term="Date the source states it was published">{formatCalendarDate(evidence.source_published_on)}</Pair>
              ) : null}
              <Pair term="Captured by the team">{evidence.captured_at ? formatDate(evidence.captured_at) : NOT_RECORDED}</Pair>
            </dl>
          </section>

          <section aria-labelledby="excerpt-h" className="flex flex-col gap-3">
            <h2 id="excerpt-h" className="text-[17px] font-semibold text-ink-strong">
              Excerpt
            </h2>
            {evidence.excerpt?.trim() ? (
              <figure className="m-0 flex flex-col gap-2">
                <blockquote className="m-0 whitespace-pre-line rounded-md border border-rule bg-surface px-5 py-4 font-serif text-[17px] leading-relaxed text-ink">
                  {evidence.excerpt.trim()}
                </blockquote>
                <figcaption className="text-[13px] text-muted">
                  Quoted from the source as captured{evidence.locator?.trim() ? ` (${evidence.locator.trim()})` : ""}. Check the
                  official source for full context.
                </figcaption>
              </figure>
            ) : (
              <p className="text-[15px] text-muted">
                No excerpt was recorded. Use the location in the document to find the relevant passage in the official source.
              </p>
            )}
          </section>

          {indicator && state ? (
            <section aria-labelledby="supports-h" className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
              <h2 id="supports-h" className="text-[17px] font-semibold text-ink-strong">
                What this evidence supports
              </h2>
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-0.5">
                  <StatusMark state={state} label="" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-[16px] font-semibold text-ink-strong">
                    {indicator.group}: {indicator.label}
                  </p>
                  <p className="text-[15px] text-ink">{STATE_LABEL[state]}</p>
                </div>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Pair term="Reporting period of the finding">{periodText(indicator)}</Pair>
                {state === "published" ? (
                  <Pair term="Value">
                    {value ?? (literal ? "Not extracted as a number" : "Not extracted")}
                    {literal ? <span className="block text-[13px] text-muted">As printed in the source: {literal}</span> : null}
                  </Pair>
                ) : null}
                <Pair term="Assessment explanation" className="sm:col-span-2">
                  {indicator.reason?.trim() || "No further explanation was published for this finding."}
                </Pair>
              </dl>
              <p className="text-[14px]">
                <Link href={`${profilePath(snapshot.slug)}#${indicatorAnchor(indicator.key)}`} className="inline-flex min-h-11 items-center">
                  See this indicator on the institution profile
                </Link>
              </p>
            </section>
          ) : null}
        </div>

        <aside aria-labelledby="release-h" className="flex flex-col gap-4 rounded-md border border-rule bg-surface p-5">
          <h2 id="release-h" className={EYEBROW}>
            Release
          </h2>
          <dl className="grid gap-3">
            <Pair term="Belongs to">
              <Link href={releasePath(snapshot.slug, snapshot.releaseNumber)}>Release {snapshot.releaseNumber}</Link> (current)
            </Pair>
            <Pair term="Public release date">{formatDate(snapshot.publishedAt)}</Pair>
            <Pair term="Human verification date">
              {profile.last_verified_at ? formatDate(profile.last_verified_at) : NOT_RECORDED}
            </Pair>
            <Pair term="Assessment period">{assessment ?? "Not stated"}</Pair>
            <Pair term="Methodology version">{snapshot.methodologyVersionId}</Pair>
          </dl>
          <p className="text-[13px] leading-relaxed text-muted">
            Evidence is recorded by the research team and checked by a reviewer before release. The capture date is when the team
            saved the source, not the period it covers.
          </p>
          <p className="text-[14px]">
            <Link href={profilePath(snapshot.slug)} className="inline-flex min-h-11 items-center">
              Back to {name}
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}

export default function EvidencePage(props: Props) {
  return (
    <Suspense
      fallback={
        <div className={`${CONTAINER} py-8`}>
          <LoadingBlock label="Loading the evidence record" />
        </div>
      }
    >
      <EvidenceBody params={props.params} />
    </Suspense>
  );
}

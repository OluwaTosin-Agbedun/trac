// Renders one published snapshot: identity, leadership, release summary, the nine indicators
// with evidence, general sources, published history and the corrections note. Used by the
// current profile and by historical release pages, so both always read the same way.
import type { ReactNode } from "react";
import type { PublishedSnapshot } from "@/lib/snapshot";
import { HistoryTable } from "./HistoryTable";
import { IndicatorSection } from "./IndicatorSection";
import { EvidenceList } from "./EvidenceList";
import { SummaryPanel } from "./SummaryPanel";
import { eyebrowText, institutionName, locationText, NOT_RECORDED } from "./labels";
import { Breadcrumbs, CONTAINER, EYEBROW, ExternalLink, Pair } from "./parts";

export function profilePath(slug: string) {
  return `/institutions/${encodeURIComponent(slug)}`;
}

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export function CorrectionNote() {
  return (
    <section aria-labelledby="report-correction-h" className="flex flex-col gap-2 rounded-md border border-rule bg-surface p-5">
      <h2 id="report-correction-h" className="text-[17px] font-semibold text-ink-strong">
        Report a correction
      </h2>
      <p className="max-w-[820px] text-[15px] leading-relaxed text-ink">
        If something on this page looks wrong or out of date, the research team will review it against the institution&apos;s
        official sources. Corrections are reviewed by the team and, if confirmed, appear as a new release; a published release
        is never edited directly. A public correction form is not available yet.
      </p>
    </section>
  );
}

export function SnapshotView({
  snapshot, history, breadcrumbs, notice, onReleasePage = false,
}: {
  snapshot: PublishedSnapshot;
  history: PublishedSnapshot[];
  breadcrumbs: { href?: string; label: string }[];
  /** Shown above the identity block, e.g. the "you are viewing release N" notice. */
  notice?: ReactNode;
  onReleasePage?: boolean;
}) {
  const { payload } = snapshot;
  const profile = payload.profile;
  const name = institutionName(profile);
  const location = locationText(profile);
  const headTerm = profile.head_title?.trim() || "Head of institution";
  const linkDetail = snapshot.isCurrent;
  const general = payload.profile_evidence ?? [];

  return (
    <div className={`${CONTAINER} flex flex-col gap-10 py-6 sm:py-8`}>
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={breadcrumbs} />
        {notice}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className={EYEBROW}>{eyebrowText(profile)}</p>
            <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-[-0.01em] text-ink-strong sm:text-4xl">{name}</h1>
            {profile.short_name?.trim() ? <p className="text-[15px] text-muted">Also known as {profile.short_name.trim()}</p> : null}
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Pair term="Location">{location ?? NOT_RECORDED}</Pair>
            <Pair term="Official website">
              {profile.website_url ? (
                <ExternalLink href={profile.website_url} className="inline-block break-all py-2.5">
                  {displayUrl(profile.website_url)}
                </ExternalLink>
              ) : (
                NOT_RECORDED
              )}
            </Pair>
          </dl>
          <section aria-labelledby="leadership-h" className="flex flex-col gap-3">
            <h2 id="leadership-h" className="text-[15px] font-semibold text-ink-strong">
              Leadership, as recorded in this release
            </h2>
            <dl className="grid gap-4 rounded-md border border-rule bg-white p-4 sm:grid-cols-2">
              <Pair term={headTerm}>{profile.head_name?.trim() || NOT_RECORDED}</Pair>
              <Pair term="Bursar">{profile.bursar_name?.trim() || NOT_RECORDED}</Pair>
            </dl>
          </section>
        </div>
        <SummaryPanel snapshot={snapshot} />
      </div>

      <IndicatorSection snapshot={snapshot} linkDetail={linkDetail} />

      {general.length ? (
        <section aria-labelledby="general-sources-h" className="flex flex-col gap-3">
          <h2 id="general-sources-h" className="font-serif text-[26px] font-semibold text-ink-strong">
            General sources
          </h2>
          <p className="max-w-[760px] text-[15px] leading-relaxed text-muted">
            Official pages used for the institution&apos;s identity and leadership, not tied to one indicator.
          </p>
          <EvidenceList
            items={general}
            slug={snapshot.slug}
            assessmentPeriod={profile.assessment_period}
            linkDetail={linkDetail}
            showExcerpt={!linkDetail}
          />
        </section>
      ) : null}

      <HistoryTable history={history} viewingRelease={snapshot.releaseNumber} onReleasePage={onReleasePage} />

      <CorrectionNote />
    </div>
  );
}

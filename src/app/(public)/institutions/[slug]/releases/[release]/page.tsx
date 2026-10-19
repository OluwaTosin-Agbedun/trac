// One public release of an institution's record, exactly as it was published. Withdrawn releases
// are invisible to the public role, so they 404 here like any unknown release.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDate } from "@/lib/format";
import { getHistory, getRelease, isSlug } from "@/server/data/public";
import { profilePath, SnapshotView } from "@/components/public/profile/SnapshotView";
import { institutionName } from "@/components/public/profile/labels";
import { CONTAINER, LoadingBlock } from "@/components/public/profile/parts";

export const metadata: Metadata = { title: "Published release" };

type Props = { params: Promise<{ slug: string; release: string }> };

function parseRelease(raw: string): number | null {
  if (!/^[1-9]\d{0,5}$/.test(raw)) return null;
  return Number(raw);
}

async function ReleaseBody({ params }: Props) {
  const { slug, release } = await params;
  const n = parseRelease(release);
  if (n === null || !isSlug(slug)) notFound();
  await connection();
  const snapshot = await getRelease(slug, n);
  if (!snapshot) notFound();
  const history = await getHistory(snapshot.institutionId);
  const current = history.find((h) => h.isCurrent) ?? null;
  const name = institutionName(snapshot.payload.profile);
  const published = formatDate(snapshot.publishedAt);

  const notice = snapshot.isCurrent ? (
    <div className="rounded-md border border-rule bg-surface px-4 py-3 text-[15px] text-ink">
      This is the current release (release {snapshot.releaseNumber}, published {published}). The{" "}
      <Link href={profilePath(snapshot.slug)}>institution profile</Link> always shows the current release.
    </div>
  ) : (
    <div className="rounded-md border border-warn-rule bg-warn-bg px-4 py-3 text-[15px] text-warn-text">
      <p className="font-semibold">
        You are viewing release {snapshot.releaseNumber} published on {published}.{" "}
        {current ? (
          <Link href={profilePath(snapshot.slug)} className="text-warn-text underline hover:text-ink-strong">
            See the current release.
          </Link>
        ) : null}
      </p>
      <p className="mt-1 text-[14px]">
        {current
          ? `It has been replaced by release ${current.releaseNumber}, published ${formatDate(current.publishedAt)}. Findings below describe what was verified at the time.`
          : "This institution has no current public release. This earlier release remains part of the public record and describes what was verified at the time."}{" "}
        Evidence detail pages are available for the current release only, so excerpts are shown inline here.
      </p>
    </div>
  );

  return (
    <SnapshotView
      snapshot={snapshot}
      history={history}
      onReleasePage
      notice={notice}
      breadcrumbs={[
        { href: "/institutions", label: "Institutions" },
        ...(current ? [{ href: profilePath(snapshot.slug), label: name }] : [{ label: name }]),
        { label: `Release ${snapshot.releaseNumber}` },
      ]}
    />
  );
}

export default function ReleasePage(props: Props) {
  return (
    <Suspense
      fallback={
        <div className={`${CONTAINER} py-8`}>
          <LoadingBlock label="Loading the published release" />
        </div>
      }
    >
      <ReleaseBody params={props.params} />
    </Suspense>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { getPreview } from "@/server/data/cms/review";
import { SnapshotView } from "@/components/public/profile/SnapshotView";
import type { PublishedSnapshot } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Preview", robots: { index: false } };

type Props = { params: Promise<{ revisionId: string }> };

async function PreviewBody({ params }: Props) {
  const { revisionId } = await params;
  if (!isUuid(revisionId)) notFound();
  const viewer = await requireViewer();
  const p = await getPreview(viewer, revisionId);
  if (!p) notFound();
  // Built by the database exactly as publish_revision would; nothing here is public yet.
  const snapshot: PublishedSnapshot = {
    id: revisionId,
    institutionId: p.institutionId,
    slug: p.slug,
    releaseNumber: p.nextRelease,
    publishedAt: new Date().toISOString(),
    methodologyVersionId: p.payload.profile.methodology_version_id,
    isCurrent: false,
    payload: p.payload,
  };
  return (
    <div className="-m-4 bg-white sm:-m-8">
      <div className="sticky top-0 z-10 border-b border-warn-rule bg-warn-bg px-4 py-3 sm:px-8" role="note">
        <p className="text-sm text-warn-text">
          <strong>Preview of revision {p.number} — not public.</strong> This is what release {p.nextRelease} will show if it is
          published. Evidence pages link only after publication.{" "}
          <Link href={`/admin/review/${revisionId}`} className="font-semibold text-warn-text underline">Back to the review</Link>
        </p>
      </div>
      <SnapshotView
        snapshot={snapshot}
        history={[]}
        breadcrumbs={[{ label: "Preview" }, { label: p.payload.profile.name ?? "Unnamed institution" }]}
      />
    </div>
  );
}

export default function PreviewPage(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Building the preview…</p>}>
      <PreviewBody params={props.params} />
    </Suspense>
  );
}

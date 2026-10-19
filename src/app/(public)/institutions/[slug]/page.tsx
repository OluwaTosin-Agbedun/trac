// Public institution profile: the current published release only (never drafts or imports).
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getCurrentBySlug, getHistory } from "@/server/data/public";
import { SnapshotView } from "@/components/public/profile/SnapshotView";
import { institutionName } from "@/components/public/profile/labels";
import { CONTAINER, LoadingBlock } from "@/components/public/profile/parts";

export const metadata: Metadata = { title: "Institution profile" };

type Props = { params: Promise<{ slug: string }> };

async function ProfileBody({ params }: Props) {
  const { slug } = await params;
  await connection();
  const snapshot = await getCurrentBySlug(slug);
  if (!snapshot) notFound();
  const history = await getHistory(snapshot.institutionId);
  return (
    <SnapshotView
      snapshot={snapshot}
      history={history}
      breadcrumbs={[{ href: "/institutions", label: "Institutions" }, { label: institutionName(snapshot.payload.profile) }]}
    />
  );
}

export default function InstitutionProfilePage(props: Props) {
  return (
    <Suspense
      fallback={
        <div className={`${CONTAINER} py-8`}>
          <LoadingBlock label="Loading the institution profile" />
        </div>
      }
    >
      <ProfileBody params={props.params} />
    </Suspense>
  );
}

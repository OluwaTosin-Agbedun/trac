import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { inviteForToken } from "@/server/auth/accounts";
import { Notice } from "@/components/ui/Form";
import { InviteForm } from "../../forms";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false }, referrer: "no-referrer" };

async function InviteBody({ params }: { params: PageProps<"/admin/invite/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const invite = await inviteForToken(token);
  if (!invite) {
    return <Notice tone="danger" title="This invitation link is not valid">It may have expired or already been used. Ask an administrator for a new one.</Notice>;
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-semibold text-ink-strong">Join the team</h1>
      <p className="text-sm text-muted">You have been invited as <strong>{invite.role}</strong>.</p>
      <InviteForm token={token} email={invite.email} />
    </div>
  );
}

export default function InvitePage({ params }: PageProps<"/admin/invite/[token]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <InviteBody params={params} />
    </Suspense>
  );
}

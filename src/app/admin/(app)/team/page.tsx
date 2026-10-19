import type { Metadata } from "next";
import { Suspense } from "react";
import { requireViewer } from "@/server/auth/session";
import { listPendingInvites, listTeam } from "@/server/auth/accounts";
import { asUser } from "@/server/db";
import { Notice } from "@/components/ui/Form";
import { INDICATORS } from "@/lib/indicators";
import { formatDate } from "@/lib/format";
import { ClearLockForm, InviteForm, MemberForm, RevokeInviteForm } from "./_components/TeamForms";

export const metadata: Metadata = { title: "Team and settings", robots: { index: false } };

const ROLE_LABEL: Record<string, string> = { editor: "Data editor", reviewer: "Reviewer and publisher", admin: "Administrator" };

async function TeamBody() {
  const viewer = await requireViewer();
  if (viewer.role !== "admin") {
    return <Notice tone="warn" title="Administrators only">Team and settings are managed by administrators.</Notice>;
  }
  const [team, invites, versions] = await Promise.all([
    listTeam(viewer),
    listPendingInvites(viewer),
    asUser(viewer.userId, (tx) => tx.query<{ id: string; label: string; notes: string | null }>(
      "select id, label, notes from methodology_versions order by created_at")),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Administration</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-ink-strong">Team and settings</h1>
        <p className="mt-2 max-w-[75ch] text-sm text-muted">
          Signing in does not grant access by itself: only people with an active role here can use the CMS. Deactivating a
          member signs them out everywhere and cancels any invitations they sent. At least one active administrator must
          always remain. If someone is locked out after too many wrong passwords, use “Clear sign-in lock”.
        </p>
      </div>

      <section aria-labelledby="members-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h2 id="members-h" className="font-serif text-xl font-semibold text-ink-strong">Members</h2>
        <div className="overflow-x-auto rounded border border-rule-soft">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <caption className="sr-only">Team members and their roles</caption>
            <thead>
              <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
                <th scope="col" className="px-4 py-2.5">Name</th>
                <th scope="col" className="px-4 py-2.5">Current role</th>
                <th scope="col" className="px-4 py-2.5">Change</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.userId} className="border-t border-rule-soft align-top">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="font-semibold text-ink">{m.displayName}</span>
                    <span className="block text-[12px] text-muted">{m.email}</span>
                  </th>
                  <td className="px-4 py-3">{ROLE_LABEL[m.role]}<span className="block text-[12px] text-muted">{m.active ? "Active" : "Deactivated"}</span></td>
                  <td className="px-4 py-3">
                    <MemberForm userId={m.userId} role={m.role} active={m.active} self={m.userId === viewer.userId} />
                    {m.active ? <ClearLockForm userId={m.userId} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="invite-h" className="flex flex-col gap-3 rounded-md border border-rule bg-white p-5">
        <h2 id="invite-h" className="font-serif text-xl font-semibold text-ink-strong">Invite a team member</h2>
        <p className="text-sm text-muted">The person opens the link, sets their name and password, and gets the role you choose. Links work once and expire after 7 days.</p>
        <InviteForm />
        {invites.length ? (
          <>
            <h3 className="mt-2 text-sm font-semibold text-ink">Pending invitations</h3>
            <ul className="divide-y divide-rule-soft rounded border border-rule-soft text-sm">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span>
                    {i.email} · {ROLE_LABEL[i.role]}
                    <span className="block text-[13px] text-muted">
                      {i.invited_by_name ? `Sent by ${i.invited_by_name} · ` : ""}expires {formatDate(i.expires_at)}
                    </span>
                  </span>
                  <RevokeInviteForm inviteId={i.id} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section aria-labelledby="method-h" className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-rule bg-white p-5">
          <h2 id="method-h" className="font-serif text-xl font-semibold text-ink-strong">Methodology versions</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {versions.map((v) => <li key={v.id}><span className="font-semibold">{v.label}</span> <code className="text-[12px] text-muted">{v.id}</code>{v.notes ? <span className="block text-muted">{v.notes}</span> : null}</li>)}
          </ul>
        </div>
        <div className="rounded-md border border-rule bg-white p-5">
          <h2 className="font-serif text-xl font-semibold text-ink-strong">Indicators</h2>
          <ul className="mt-3 grid gap-1 text-sm">
            {INDICATORS.map((i) => <li key={i.key} className="flex justify-between gap-3 border-b border-rule-soft py-1"><span>{i.group} · {i.label}</span><code className="text-[12px] text-muted">{i.key}</code></li>)}
          </ul>
        </div>
      </section>
      <p className="text-[13px] text-muted">Notifications are shown inside the CMS. Email notifications are not configured.</p>
    </div>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the team…</p>}>
      <TeamBody />
    </Suspense>
  );
}

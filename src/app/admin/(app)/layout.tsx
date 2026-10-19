import Link from "next/link";
import { Suspense } from "react";
import { LocalBanner } from "@/components/site/Chrome";
import { requireViewer } from "@/server/auth/session";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { signOutAction } from "../auth-actions";
import { CmsNavLinks, type CmsNavItem } from "./CmsNavLinks";

const NAV: CmsNavItem[] = [
  { href: "/admin", label: "Dashboard", roles: ["editor", "reviewer", "admin"] },
  { href: "/admin/institutions", label: "Institutions", roles: ["editor", "reviewer", "admin"] },
  { href: "/admin/review", label: "Review queue", roles: ["editor", "reviewer", "admin"] },
  { href: "/admin/imports", label: "Imports", roles: ["reviewer", "admin"] },
  { href: "/admin/research", label: "Research centre", roles: ["editor", "reviewer", "admin"] },
  { href: "/admin/team", label: "Team and settings", roles: ["admin"] },
  { href: "/admin/help", label: "How to manage the site", roles: ["editor", "reviewer", "admin"] },
];

// The session check lives inside Suspense (cookies are request data). It is optimistic UI only;
// every page and action below re-checks the viewer and role itself.
async function ViewerNav() {
  const viewer = await requireViewer();
  return (
    <>
      <CmsNavLinks items={NAV.filter((n) => n.roles.includes(viewer.role))} />
      <div className="mt-auto flex flex-col gap-2 border-t border-[#24406e] px-3 pt-4 text-[13px] text-[#9fb0c8]">
        <span>
          Signed in as <span className="font-semibold text-white">{viewer.displayName}</span>
          <br />
          {viewer.role}
          {viewer.isFixture ? " · fixture account" : ""}
        </span>
        <form action={signOutAction}>
          <SubmitButton variant="quiet" pendingLabel="Signing out…" className="w-full">Sign out</SubmitButton>
        </form>
      </div>
    </>
  );
}

export default function CmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <LocalBanner />
      <div className="flex flex-1 flex-wrap">
        <aside className="flex w-full flex-col gap-1 bg-ink-strong px-4 py-5 text-[15px] text-[#d6deea] md:w-[240px] md:shrink-0">
          <Link href="/admin" className="px-3 pb-4 font-serif text-lg font-bold text-white no-underline">Portal CMS</Link>
          <Suspense fallback={<p className="px-3 text-sm text-[#9fb0c8]">Loading…</p>}>
            <ViewerNav />
          </Suspense>
          <Link href="/" className="mt-3 px-3 text-[13px] text-[#9fb0c8] hover:text-white">View public site</Link>
        </aside>
        <main id="main" className="min-w-0 flex-[999_1_640px] bg-surface p-4 sm:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

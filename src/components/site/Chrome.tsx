// Public site chrome in a professional editorial (WordPress-style) layout: partnership top bar,
// primary navigation bar, local-database banner and a column footer.
// The partnership line and portal title come from the original portal's header.
import Link from "next/link";
import { Suspense } from "react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { connection } from "next/server";
import { dataMode } from "@/server/db";
import { NavBarLinks, StaticNavBarLinks } from "./NavLinks";

export const PUBLIC_NAV = [
  { href: "/", label: "Overview" },
  { href: "/institutions", label: "Institutions" },
  { href: "/compare", label: "Compare" },
] as const;

export const SITE_TITLE = "Nigerian Institution Compliance Monitoring Portal";

/**
 * Official logos are shown only when the files have been supplied in public/logos/. No emblem is
 * drawn in their place: the brief forbids inventing an Athena logo or using unsupplied brand assets.
 */
const LOGOS = {
  athena: ["athena-centre.svg", "athena-centre.png"],
  fme: ["federal-ministry-of-education.svg", "federal-ministry-of-education.png"],
} as const;

function logoPath(kind: keyof typeof LOGOS): string | null {
  for (const f of LOGOS[kind]) {
    if (existsSync(join(process.cwd(), "public", "logos", f))) return `/logos/${f}`;
  }
  return null;
}

function Logo({ kind, alt }: { kind: keyof typeof LOGOS; alt: string }) {
  const src = logoPath(kind);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- small static brand files, no optimisation needed
  return <img src={src} alt={alt} className="h-9 w-auto rounded-sm bg-white p-0.5" />;
}

export function PartnershipBand() {
  return (
    <div className="bg-[#0a1c3f] text-white">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-[13px] sm:px-6">
        <span className="flex items-center gap-2">
          <Logo kind="athena" alt="Athena Centre for Policy and Leadership" />
          <span className="font-semibold tracking-[0.01em]">Athena Centre for Policy and Leadership</span>
        </span>
        <span className="text-band-text">in partnership with</span>
        <span className="flex items-center gap-2">
          <Logo kind="fme" alt="Federal Ministry of Education" />
          <span className="font-semibold tracking-[0.01em]">Federal Ministry of Education</span>
        </span>
        <span className="hidden text-band-text lg:ml-auto lg:inline">An initiative of the Arthur Nwankwo Institute of Education</span>
      </div>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header>
      <div className="bg-band">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <Suspense fallback={<StaticNavBarLinks items={PUBLIC_NAV} />}>
            <NavBarLinks items={PUBLIC_NAV} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function LocalBannerInner() {
  await connection();
  if (dataMode() !== "local") return null;
  return (
    <div className="border-b border-warn-rule bg-warn-bg" role="note">
      <p className="mx-auto max-w-[1240px] px-4 py-2.5 text-[13px] text-warn-text sm:px-6">
        <strong>Local preview.</strong> This copy of the site runs on a database on this computer, not the live site.
        Connect the Neon database before launch.
      </p>
    </div>
  );
}

export function LocalBanner() {
  return (
    <Suspense fallback={null}>
      <LocalBannerInner />
    </Suspense>
  );
}

const FOOTER_LINK = "text-[#c9d6ec] no-underline hover:text-white hover:underline";

export function SiteFooter() {
  return (
    <footer className="mt-20 bg-[#0a1c3f] text-[#c9d6ec]">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-14 text-sm leading-relaxed sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.4fr_1fr_1.4fr]">
        <div className="flex flex-col gap-3">
          <span className="font-serif text-xl font-bold leading-snug text-white">{SITE_TITLE}</span>
          <p className="m-0">
            Athena Centre for Policy and Leadership, in partnership with the Federal Ministry of Education. An initiative of the
            Arthur Nwankwo Institute of Education.
          </p>
        </div>
        <nav aria-label="Explore" className="flex flex-col gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-white">Explore</span>
          <Link href="/institutions" className={FOOTER_LINK}>Institutions</Link>
          <Link href="/compare" className={FOOTER_LINK}>Compare institutions</Link>
        </nav>
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-white">About the findings</span>
          <p className="m-0">
            Findings describe what institutions publish on their official websites. They are not judgments about academic quality,
            financial propriety or breach of any law, and they do not rank institutions.
          </p>
        </div>
      </div>
      <div className="border-t border-[#1d3566]">
        <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-2 px-4 py-4 text-[12px] sm:px-6">
          <span>© Athena Centre for Policy and Leadership · Federal Ministry of Education partnership</span>
          <span>Financial Transparency Compliance Report</span>
        </div>
      </div>
    </footer>
  );
}

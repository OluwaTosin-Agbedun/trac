import { LocalBanner, PartnershipBand, SiteFooter, SiteHeader } from "@/components/site/Chrome";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PartnershipBand />
      <SiteHeader />
      <LocalBanner />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

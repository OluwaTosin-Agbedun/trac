import Link from "next/link";
import { LocalBanner, PartnershipBand } from "@/components/site/Chrome";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PartnershipBand />
      <LocalBanner />
      <main id="main" className="flex flex-1 items-start justify-center bg-surface px-4 py-12">
        <div className="w-full max-w-[440px] rounded-md border border-rule bg-white p-6 sm:p-8">
          <Link href="/" className="font-serif text-lg font-bold text-ink-strong no-underline">Nigerian Institution Compliance Monitoring Portal</Link>
          <p className="mt-1 text-[13px] text-muted">Team CMS</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </>
  );
}

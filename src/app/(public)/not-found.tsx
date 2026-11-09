// 404 for the public site, inside the public header and footer. Next adds the noindex tag itself.
import Link from "next/link";

export default function PublicNotFound() {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 py-20">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Page not found</p>
      <h1 className="font-serif text-3xl font-semibold text-ink-strong">We could not find that page</h1>
      <p className="text-muted">
        The address may be mistyped, or the institution may no longer be listed in the register. Every listed institution is on
        the Institutions page.
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-2">
        <Link href="/institutions" className="inline-flex min-h-11 items-center">Browse institutions</Link>
        <Link href="/" className="inline-flex min-h-11 items-center">Go to the overview</Link>
      </p>
    </div>
  );
}

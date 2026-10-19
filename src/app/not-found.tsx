import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex max-w-[640px] flex-1 flex-col gap-4 px-4 py-20">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">Page not found</p>
      <h1 className="font-serif text-3xl font-semibold text-ink-strong">We could not find that page</h1>
      <p className="text-muted">The address may be wrong, or the record may not have a published release.</p>
      <p>
        <Link href="/institutions">Browse institutions</Link> · <Link href="/">Go to the overview</Link>
      </p>
    </main>
  );
}

"use client";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  const config = error instanceof Error && error.message.startsWith("Configuration required");
  return (
    <main id="main" className="mx-auto flex max-w-[640px] flex-1 flex-col gap-4 px-4 py-20">
      <h1 className="font-serif text-3xl font-semibold text-ink-strong">{config ? "Configuration required" : "Something went wrong"}</h1>
      <p className="text-muted">
        {config
          ? "This deployment has no database configured yet. Set DATABASE_URL to the Neon connection string."
          : "The page could not be loaded. Nothing was changed."}
      </p>
      {digest ? <p className="text-[13px] text-subtle">Reference: {digest}</p> : null}
      <div>
        <button type="button" onClick={() => retry()} className="min-h-11 rounded border border-accent bg-accent px-4 text-sm font-semibold text-white">
          Try again
        </button>
      </div>
    </main>
  );
}

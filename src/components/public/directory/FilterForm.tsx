"use client";
// The directory's GET filter form. Without JavaScript it is a plain GET form. With JavaScript it
// drops empty fields from the URL and navigates in a transition, so the submit button can show a
// spinner and stay disabled until the filtered results have rendered.
import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

const PendingContext = createContext(false);
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function DirectoryFilterForm({ path, label, className, children }: {
  /** Route path without the base path, e.g. "/institutions". */
  path: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      method="get"
      action={`${BASE_PATH}${path}`}
      role="search"
      aria-label={label}
      aria-busy={pending || undefined}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const query = new URLSearchParams();
        for (const [key, value] of new FormData(event.currentTarget)) {
          if (typeof value !== "string") continue;
          const v = value.trim();
          if (v) query.append(key, v);
        }
        // Defaults stay out of the URL; a status without an indicator means nothing.
        if (!query.get("indicator") || query.get("indicatorState") === "published") query.delete("indicatorState");
        if (query.get("sort") === "name") query.delete("sort");
        const qs = query.toString();
        startTransition(() => router.push(qs ? `${path}?${qs}` : path, { scroll: false }));
      }}
    >
      <PendingContext value={pending}>{children}</PendingContext>
    </form>
  );
}

/** Submit button for DirectoryFilterForm: spinner and disabled while results load. */
export function DirectoryFilterSubmit({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const pending = useContext(PendingContext);
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded border border-accent bg-accent px-5 text-sm font-semibold text-white transition-colors hover:border-accent-hover hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? <Spinner /> : null}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  );
}

"use client";
// An action's result in a live region. Conflicts and stale forms get a reload button, because the
// only safe recovery is to load the latest version and reapply the change.
import { FormMessage, Notice, type FormState } from "@/components/ui/Form";

export function ActionMessage({ state, keepsValues = true }: { state: FormState; keepsValues?: boolean }) {
  const needsReload = !!state && state.ok === false && !!state.message && /\bReload\b/.test(state.message);
  if (!needsReload) return <FormMessage state={state} />;
  return (
    <div aria-live="polite">
      <Notice tone="warn" title="This draft has changed">
        <p>{state?.message}</p>
        {keepsValues ? <p className="mt-2">Your typed values stay in the form until you reload. Copy anything you need first.</p> : null}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex min-h-11 items-center rounded border border-warn-text bg-white px-4 text-sm font-semibold text-warn-text hover:bg-warn-bg"
        >
          Reload the latest version
        </button>
      </Notice>
    </div>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { isSetupComplete, setupTokenRequired } from "@/server/auth/accounts";
import { SetupForm } from "../forms";

export const metadata: Metadata = { title: "Set up", robots: { index: false } };

// One-time setup. Once the permanent setup flag exists this page only redirects; the action
// re-checks the flag inside the same transaction that creates the owner account.
async function SetupBody() {
  await connection();
  if (await isSetupComplete()) redirect("/admin/sign-in");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-semibold text-ink-strong">Set up the CMS</h1>
      <p className="text-sm text-muted">
        Create the owner account. This screen works once: after the first account exists it closes permanently, and other team
        members are invited from inside the CMS.
      </p>
      <SetupForm needsToken={setupTokenRequired()} />
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <SetupBody />
    </Suspense>
  );
}

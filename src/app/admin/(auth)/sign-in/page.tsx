import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { isSetupComplete } from "@/server/auth/accounts";
import { getViewer } from "@/server/auth/session";
import { SignInForm } from "../forms";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

async function SignInBody() {
  await connection();
  if (!(await isSetupComplete())) redirect("/admin/setup");
  if (await getViewer()) redirect("/admin");
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-semibold text-ink-strong">Sign in</h1>
      <SignInForm />
      <p className="text-[13px] text-muted">
        New team members join through an invitation link from an administrator. Forgotten your password? Ask an
        administrator to send you a new invitation.
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <SignInBody />
    </Suspense>
  );
}

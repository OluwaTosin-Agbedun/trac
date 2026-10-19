"use server";
// Identity actions. Each validates its own input and never trusts the page that rendered it.
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  AccountError, acceptInvite, completeSetup, isSetupComplete, passwordSignIn, validatePassword,
} from "@/server/auth/accounts";
import { clientIp, endSession, startSession } from "@/server/auth/session";
import { fail, field } from "@/server/actions/result";
import type { FormState } from "@/components/ui/Form";

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export async function signInAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(field(fd, "email", 254));
  const password = typeof fd.get("password") === "string" ? (fd.get("password") as string) : "";
  if (!email.success || !password) {
    return fail("Enter your email address and password.", undefined, { email: field(fd, "email", 254) });
  }
  const res = await passwordSignIn(email.data, password, await clientIp());
  if (!res.ok) {
    const message = {
      locked: "Too many unsuccessful attempts. Wait 15 minutes and try again, or ask an administrator to clear the lock.",
      busy: "The sign-in service is busy. Wait a few seconds, then try again.",
      invalid: "That email and password do not match an active team account.",
    }[res.reason];
    return fail(message, undefined, { email: email.data });
  }
  await startSession(res.userId);
  redirect("/admin");
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/admin/sign-in");
}

const setupSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name.").max(120),
  email: emailSchema,
});

export async function setupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  if (await isSetupComplete()) redirect("/admin/sign-in");
  const values = { displayName: field(fd, "displayName", 120), email: field(fd, "email", 254) };
  const parsed = setupSchema.safeParse(values);
  const password = typeof fd.get("password") === "string" ? (fd.get("password") as string) : "";
  const confirm = typeof fd.get("confirm") === "string" ? (fd.get("confirm") as string) : "";
  const setupToken = field(fd, "setupToken", 200);
  const errors: Record<string, string[]> = parsed.success ? {} : (parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const pwError = validatePassword(password);
  if (pwError) errors.password = [pwError];
  if (password !== confirm) errors.confirm = ["The passwords do not match."];
  if (!parsed.success || Object.keys(errors).length) return fail("Check the highlighted fields.", errors, values);
  let userId: string;
  try {
    userId = await completeSetup(parsed.data.email, parsed.data.displayName, password, setupToken);
  } catch (err) {
    if (err instanceof AccountError) return fail(err.message, undefined, values);
    console.error("[setup] failed", err);
    return fail("Setup could not be completed. Nothing was saved.", undefined, values);
  }
  await startSession(userId);
  redirect("/admin");
}

export async function acceptInviteAction(token: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const displayName = field(fd, "displayName", 120);
  const password = typeof fd.get("password") === "string" ? (fd.get("password") as string) : "";
  const confirm = typeof fd.get("confirm") === "string" ? (fd.get("confirm") as string) : "";
  const errors: Record<string, string[]> = {};
  if (!displayName) errors.displayName = ["Enter your name."];
  const pwError = validatePassword(password);
  if (pwError) errors.password = [pwError];
  if (password !== confirm) errors.confirm = ["The passwords do not match."];
  if (Object.keys(errors).length) return fail("Check the highlighted fields.", errors, { displayName });
  let userId: string;
  try {
    userId = await acceptInvite(token, displayName, password);
  } catch (err) {
    if (err instanceof AccountError) return fail(err.message, undefined, { displayName });
    console.error("[invite] failed", err);
    return fail("The account could not be created. Nothing was saved.", undefined, { displayName });
  }
  await startSession(userId);
  redirect("/admin");
}

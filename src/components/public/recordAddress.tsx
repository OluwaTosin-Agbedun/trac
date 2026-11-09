// Earlier public addresses of a record (/institutions/record/<id>, old profile release and evidence
// pages) move permanently to its stable address, /institutions/<slug>. Call this from a page before
// anything streams (no Suspense above it), so the answer is a real HTTP 308 or 404.
import type { ReactNode } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getRegisterStatus, resolveRegister } from "@/server/data/public";
import { RegisterError, RegisterHidden } from "./Notices";

const WRAP = "mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-12 sm:px-6";

export async function redirectToRecord(key: string): Promise<ReactNode> {
  let target: string | null = null;
  let hidden = false;
  try {
    const hit = await resolveRegister(key);
    if (hit) target = hit.slug;
    else hidden = !(await getRegisterStatus()).visible;
  } catch (err) {
    console.error("[record address] could not resolve:", err instanceof Error ? err.message : err);
    return <div className={WRAP}><RegisterError compact /></div>;
  }
  // Outside the try: both work by throwing.
  if (target) permanentRedirect(`/institutions/${target}`);
  if (hidden) return <div className={WRAP}><RegisterHidden compact /></div>;
  notFound();
}

// An old institution profile's evidence page. The verified register is now the public record, so this
// address moves permanently to the institution's register record (a real 308), or is a real 404.
import type { Metadata } from "next";
import { connection } from "next/server";
import { redirectToRecord } from "@/components/public/recordAddress";

// Resolved before anything streams, so the status code is the true one.
export const instant = false;

export const metadata: Metadata = { title: "Institution record", robots: { index: false } };

export default async function OldEvidenceAddress({ params }: PageProps<"/institutions/[slug]/evidence/[evidenceId]">) {
  const { slug } = await params;
  await connection();
  return redirectToRecord(slug);
}

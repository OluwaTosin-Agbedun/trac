// The earlier address of a register record (/institutions/record/<id>). It has moved permanently to
// the record's own address, /institutions/<slug>: a real 308, or a real 404 for an unknown id.
import type { Metadata } from "next";
import { connection } from "next/server";
import { redirectToRecord } from "@/components/public/recordAddress";

// Resolved before anything streams, so the status code is the true one.
export const instant = false;

export const metadata: Metadata = { title: "Institution record", robots: { index: false } };

export default async function OldRecordAddress({ params }: PageProps<"/institutions/record/[id]">) {
  const { id } = await params;
  await connection();
  return redirectToRecord(id);
}

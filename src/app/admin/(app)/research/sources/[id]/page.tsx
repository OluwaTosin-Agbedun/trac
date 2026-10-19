// A captured source, as the assistant saw it: address, capture time, hash and the extracted text.
// The text came from a website, so it is shown as plain text only (never as HTML or a link).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireViewer } from "@/server/auth/session";
import { isUuid } from "@/server/auth/crypto";
import { getSourceVersion } from "@/server/data/cms/research";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Captured source", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

async function SourceBody({ params }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const viewer = await requireViewer();
  const s = await getSourceVersion(viewer, id);
  if (!s) notFound();
  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
      <div>
        <Link href={`/admin/institutions/${s.institution_id}#research-h`} className="text-sm font-semibold text-accent underline underline-offset-2">
          ← Back to the institution
        </Link>
        <h1 className="mt-2 font-serif text-2xl font-semibold text-ink-strong break-words">{s.title || "Captured page"}</h1>
      </div>
      <dl className="grid gap-x-6 gap-y-2 rounded-md border border-rule bg-white p-5 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-semibold">Address</dt>
        <dd className="break-all">
          <a href={s.final_url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">{s.final_url}</a>
          {s.requested_url !== s.final_url ? <span className="block text-[12px] text-muted">Requested as {s.requested_url}</span> : null}
        </dd>
        <dt className="font-semibold">Captured</dt>
        <dd>{formatDateTime(s.fetched_at)} · HTTP {s.http_status}{s.content_type ? ` · ${s.content_type}` : ""}</dd>
        <dt className="font-semibold">Fingerprint</dt>
        <dd className="break-all font-mono text-[12px]">sha256 {s.content_hash} · {s.byte_length.toLocaleString("en-NG")} bytes</dd>
        {s.extraction_note || s.truncated ? (
          <>
            <dt className="font-semibold">Note</dt>
            <dd>{s.extraction_note ?? "Only the first part of this page was kept."}</dd>
          </>
        ) : null}
      </dl>
      <section aria-labelledby="text-h" className="rounded-md border border-rule bg-white p-5">
        <h2 id="text-h" className="text-base font-semibold text-ink-strong">Text the assistant read</h2>
        <p className="mt-1 text-[13px] text-muted">The website may have changed since. This is the captured copy the proposals cite.</p>
        {s.text_content ? (
          <pre className="mt-3 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded border border-rule-soft bg-surface p-3 text-[13px] leading-relaxed">{s.text_content}</pre>
        ) : (
          <p className="mt-3 text-sm text-muted">No text was extracted from this source.</p>
        )}
      </section>
    </div>
  );
}

export default function SourcePage(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the captured source…</p>}>
      <SourceBody params={props.params} />
    </Suspense>
  );
}

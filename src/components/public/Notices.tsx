// Plain notices for the public pages when the register cannot be shown. Never show zeros instead.
import Link from "next/link";

/** The scope of the register, said the same way everywhere. */
export const SCOPE_SENTENCE =
  "The directive binds federal institutions; state institutions are assessed against the same nine items as good practice.";

export function RegisterHidden({ compact = false }: { compact?: boolean }) {
  return (
    <section role="status" className={`rounded-md border border-rule bg-surface ${compact ? "px-5 py-4" : "px-6 py-10 text-center"}`}>
      <h2 className="font-serif text-xl font-semibold text-ink-strong">The register is temporarily unavailable</h2>
      <p className={`mt-2 max-w-xl text-[15px] text-muted ${compact ? "" : "mx-auto"}`}>
        The research team has paused the public register while it is updated. Please check again later. You can still read{" "}
        <Link href="/methodology">how we score</Link>.
      </p>
    </section>
  );
}

export function RegisterError({ compact = false }: { compact?: boolean }) {
  return (
    <section role="status" className={`rounded-md border border-rule bg-surface ${compact ? "px-5 py-4" : "px-6 py-10 text-center"}`}>
      <h2 className="font-serif text-xl font-semibold text-ink-strong">The register is not available just now</h2>
      <p className={`mt-2 max-w-xl text-[15px] text-muted ${compact ? "" : "mx-auto"}`}>
        It could not be loaded. Please try again in a few minutes.
      </p>
    </section>
  );
}

/** A "Report an error" line, shown only when CONTACT_EMAIL is set. */
export function ReportErrorLine({ email, about }: { email: string | null; about?: string }) {
  if (!email) return null;
  const subject = encodeURIComponent(about ? `Possible error: ${about}`.slice(0, 150) : "Possible error in the register");
  return (
    <p className="text-[14px] text-ink">
      <strong className="font-semibold">Report an error.</strong> If something on this page is wrong or out of date, email{" "}
      <a href={`mailto:${email}?subject=${subject}`}>{email}</a> with the page or document that shows the correct information.
    </p>
  );
}

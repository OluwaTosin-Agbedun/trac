// One register record at its stable address: the evidence behind every indicator, so a reader can
// reproduce the finding without taking it on trust. Only the verified copy is shown.
//
// Status codes: the address is resolved before anything streams (no Suspense above the check), so an
// unknown address is a real HTTP 404 and an old one (a profile slug) a real 308 to the record's own
// address. `instant = false` lets this route wait for that check instead of sending a shell first.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import {
  getRegisterRecord, getRegisterStatus, getRegisterVersions, isSlug, resolveRegister,
  type RegisterRecord, type RegisterRow,
} from "@/server/data/public";
import { INDICATORS } from "@/lib/indicators";
import { reportSection } from "@/lib/report";
import { recordLabel, scoreRecord, statusInfo, type Assessment } from "@/lib/register";
import { formatCalendarDate, formatDate, plural } from "@/lib/format";
import { StatusIcon } from "@/components/register/StatusIcon";
import { RecordResult, ScoreText } from "@/components/register/RecordResult";
import { findingYear, hostOf, httpUrl } from "@/components/register/view";
import { RegisterError, RegisterHidden, ReportErrorLine } from "@/components/public/Notices";
import { siteConfig } from "@/components/site/siteConfig";
import { SITE_TITLE } from "@/components/site/Chrome";

export const instant = false;

type Props = PageProps<"/institutions/[slug]">;

type Loaded =
  | { kind: "record"; record: RegisterRecord }
  | { kind: "moved"; slug: string }
  | { kind: "missing" }
  | { kind: "hidden" }
  | { kind: "error" };

/** Resolve an address once per request (metadata and page share it). */
const load = cache(async (raw: string): Promise<Loaded> => {
  const slug = raw.toLowerCase();
  if (!isSlug(slug)) return { kind: "missing" };
  try {
    const hit = await resolveRegister(slug);
    if (!hit) return (await getRegisterStatus()).visible ? { kind: "missing" } : { kind: "hidden" };
    if (hit.slug !== raw) return { kind: "moved", slug: hit.slug };
    const record = await getRegisterRecord(hit.id);
    return record ? { kind: "record", record } : { kind: "missing" };
  } catch (err) {
    console.error("[record] could not load:", err instanceof Error ? err.message : err);
    return { kind: "error" };
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  await connection();
  const result = await load(slug);
  if (result.kind !== "record") return { title: result.kind === "missing" ? "Page not found" : "Institution record", robots: { index: false } };
  const { row } = result.record;
  const section = reportSection(row.section);
  const description = row.verified
    ? `What ${row.name} publishes on its official website for each of the nine financial disclosure indicators, with the evidence, reporting year and check date for every finding.`
    : `${row.name}${section ? `, ${section.singular.toLowerCase()}` : ""}: verification in progress.`;
  const path = `/institutions/${row.slug}`;
  const hasBase = Boolean(siteConfig().origin);
  return {
    title: row.name,
    description,
    openGraph: { title: row.name, description, type: "article", siteName: SITE_TITLE, locale: "en_NG", ...(hasBase ? { url: path } : {}) },
    ...(hasBase ? { alternates: { canonical: path } } : {}),
  };
}

export default async function RecordPage({ params }: Props) {
  const { slug } = await params;
  await connection();
  const result = await load(slug);
  if (result.kind === "missing") notFound();
  if (result.kind === "moved") permanentRedirect(`/institutions/${result.slug}`);
  if (result.kind === "hidden" || result.kind === "error") {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-12 sm:px-6">
        <Link href="/institutions" className="text-sm font-semibold">← Institutions</Link>
        {result.kind === "hidden" ? <RegisterHidden compact /> : <RegisterError compact />}
      </div>
    );
  }
  return <RecordView row={result.record.row} />;
}

const SECTION_H2 = "font-serif text-2xl font-semibold text-ink-strong";
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;
const COUNTS = new Set(["published", "partial", "nil"]);

function RecordView({ row }: { row: RegisterRow }) {
  const section = reportSection(row.section);
  const v = row.verified;
  const back = (
    <Link href={`/institutions?section=${row.section}`} className="inline-flex min-h-11 items-center text-sm font-semibold">
      ← {section?.label ?? "Institutions"}
    </Link>
  );
  const subtitle = [section?.singular, row.state].filter(Boolean).join(" · ");

  if (!v) {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-10 sm:px-6 sm:py-12">
        {back}
        <h1 className="font-serif text-3xl font-semibold leading-tight text-ink-strong sm:text-4xl">{row.name}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        <section aria-labelledby="progress-h" className="rounded-md border border-rule bg-surface px-5 py-4">
          <h2 id="progress-h" className="text-[17px] font-semibold text-ink-strong">Verification in progress</h2>
          <p className="mt-1 text-[15px] text-muted">
            This record is shown once the research team has checked the evidence and a second reviewer has verified it.{" "}
            <Link href="/methodology">How a record is checked</Link>.
          </p>
        </section>
      </div>
    );
  }

  const score = scoreRecord(v.assessments, row.verifiedAssessmentYear);
  const { contactEmail } = siteConfig();
  const disclosure = httpUrl(v.disclosure_url);
  const homepage = httpUrl(v.homepage_url);
  const extra = (v.extra_links ?? []).map((l) => ({ label: l.label?.trim() || "Document", url: httpUrl(l.url) })).filter((l) => l.url);
  const peopleSource = httpUrl(v.people_source_url);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-10 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-1">
        {back}
        <h1 className="font-serif text-3xl font-semibold leading-tight text-ink-strong sm:text-4xl">{v.name}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </header>

      <section aria-labelledby="result-h" className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
        <h2 id="result-h" className={SECTION_H2}>Overall result</h2>
        <RecordResult score={score} size="md" />
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-semibold text-ink">Assessment year</dt>
            <dd className="text-ink">{row.verifiedAssessmentYear ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Scoring rule</dt>
            <dd className="text-ink">
              {row.verifiedMethod ? `Version ${row.verifiedMethod}` : "Version not recorded"} · <Link href="/methodology">How we score</Link>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Verified on</dt>
            <dd className="text-ink">{row.verifiedAt ? formatDate(row.verifiedAt) : "Not recorded"}</dd>
          </div>
        </dl>
        {score.outdated > 0 ? (
          <p className="rounded border border-[#e8b4b4] bg-danger-bg px-3 py-2 text-[14px] text-danger">
            {plural(score.outdated, "finding covers", "findings cover")} a year before the indicator&apos;s period, so{" "}
            {score.outdated === 1 ? "it counts" : "they count"} 0. {score.outdated === 1 ? "It is" : "They are"} marked Outdated below.
          </p>
        ) : null}
        <p className="text-[13px] text-muted">
          Checked by the research team and verified by a second reviewer. Findings describe what the institution publishes on its
          official website on the dates shown.
        </p>
      </section>

      <section aria-labelledby="sources-h" className="flex flex-col gap-3">
        <h2 id="sources-h" className={SECTION_H2}>Official sources</h2>
        {disclosure || homepage || extra.length ? (
          <>
            <div className="flex flex-wrap gap-3">
              {disclosure ? (
                <a href={disclosure} {...EXTERNAL}
                  className="inline-flex min-h-11 items-center rounded bg-accent px-4 text-sm font-semibold text-white! no-underline hover:bg-accent-hover">
                  View disclosure evidence<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
              {homepage ? (
                <a href={homepage} {...EXTERNAL}
                  className="inline-flex min-h-11 items-center rounded border border-accent px-4 text-sm font-semibold no-underline hover:bg-accent-soft">
                  Official website: {hostOf(homepage)}<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </div>
            {extra.length ? (
              <div>
                <h3 className="text-[15px] font-semibold text-ink-strong">Other documents</h3>
                <ul className="mt-1 flex flex-col gap-1 text-[15px]">
                  {extra.map((l) => (
                    <li key={l.url}><a href={l.url!} {...EXTERNAL} className="inline-flex min-h-11 items-center">{l.label}</a></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : <p className="text-[15px] text-muted">No official pages were recorded for this institution.</p>}
      </section>

      <section aria-labelledby="people-h" className="flex flex-col gap-3">
        <h2 id="people-h" className={SECTION_H2}>Head and bursar</h2>
        <dl className="grid gap-x-8 gap-y-3 text-[15px] sm:grid-cols-3">
          <div>
            <dt className="text-[13px] font-semibold text-muted">{section?.head ?? "Head of institution"}</dt>
            <dd className="text-ink">{v.head_name?.trim() || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-semibold text-muted">Bursar</dt>
            <dd className="text-ink">{v.bursar_name?.trim() || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-semibold text-muted">Where the names were found</dt>
            <dd>
              {peopleSource ? (
                <a href={peopleSource} {...EXTERNAL}>{hostOf(peopleSource) ?? "Source page"}<span className="sr-only"> (opens in a new tab)</span></a>
              ) : <span className="text-muted">No source recorded</span>}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="ind-h" className="flex flex-col gap-3">
        <h2 id="ind-h" className={SECTION_H2}>The nine indicators</h2>
        <p className="max-w-[820px] text-[15px] text-muted">
          Each finding shows the reporting year it covers, a link to the evidence and the date the source was checked. A finding
          for a year before the indicator&apos;s period is marked Outdated and counts 0.
        </p>
        <IndicatorTable row={row} />
        <IndicatorCards row={row} />
        <p className="text-[13px] text-muted">
          Findings describe what the institution publishes on its official website on the dates shown. They are not judgments about
          financial propriety.
        </p>
      </section>

      <Suspense fallback={<p role="status" className="text-sm text-muted">Loading earlier verified versions…</p>}>
        <History id={row.id} />
      </Suspense>

      <ReportErrorLine email={contactEmail} about={v.name} />
    </div>
  );
}

type Finding = {
  key: string; label: string; group: string; info: ReturnType<typeof statusInfo>; a: Partial<Assessment> | undefined;
  evidence: string | null; f: ReturnType<typeof findingYear>;
};

function findings(row: RegisterRow): Finding[] {
  const v = row.verified!;
  return INDICATORS.map((d) => {
    const a = v.assessments?.[d.key];
    const info = statusInfo(a?.status);
    // A finding that counts links to its own evidence, or to the disclosure page it was found on.
    const evidence = httpUrl(a?.evidence_url) ?? (COUNTS.has(info.value) ? httpUrl(v.disclosure_url) : null);
    return { key: d.key, label: d.label, group: d.group, info, a, evidence, f: findingYear(d.key, a, row.verifiedAssessmentYear) };
  });
}

function YearDetail({ x }: { x: Finding }) {
  return (
    <>
      <span className={x.f.outdated ? "font-semibold text-danger" : ""}>{x.f.year ?? "—"}</span>
      {x.f.outdated ? (
        <span className="mt-1 block text-[12px] font-semibold text-danger">Outdated: {x.f.note}</span>
      ) : x.f.expected !== null && COUNTS.has(x.info.value) ? (
        <span className="mt-1 block text-[12px] text-muted">Period: {x.f.expected}</span>
      ) : null}
    </>
  );
}

function EvidenceLink({ x }: { x: Finding }) {
  return x.evidence ? (
    <a href={x.evidence} {...EXTERNAL} className="inline-flex min-h-11 items-center">
      Open source<span className="sr-only"> for {x.label} (opens in a new tab)</span>
    </a>
  ) : <span className="text-muted">—</span>;
}

function IndicatorTable({ row }: { row: RegisterRow }) {
  return (
    <div role="region" aria-label="The nine indicators" tabIndex={0} className="hidden overflow-x-auto rounded-md border border-rule bg-white md:block">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <caption className="sr-only">Status, reporting year, evidence and check date for each indicator</caption>
        <thead>
          <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.05em] text-[#2b3442]">
            <th scope="col" className="px-4 py-2.5">Indicator</th>
            <th scope="col" className="px-4 py-2.5">Status</th>
            <th scope="col" className="px-4 py-2.5">Reporting year</th>
            <th scope="col" className="px-4 py-2.5">Evidence</th>
            <th scope="col" className="px-4 py-2.5">Checked on</th>
          </tr>
        </thead>
        <tbody>
          {findings(row).map((x) => (
            <tr key={x.key} className="border-t border-rule-soft align-top">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <span className="font-semibold text-ink-strong">{x.label}</span>
                <span className="block text-[12px] text-muted">{x.group}</span>
              </th>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-2"><StatusIcon status={x.info.value} /> {x.info.label}</span>
                {x.a?.note ? <span className="mt-1 block text-[12px] text-muted">{x.a.note}</span> : null}
              </td>
              <td className="px-4 py-3"><YearDetail x={x} /></td>
              <td className="px-4 py-3"><EvidenceLink x={x} /></td>
              <td className="px-4 py-3">{x.a?.checked_on ? formatCalendarDate(x.a.checked_on) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The same findings stacked as cards on phones. */
function IndicatorCards({ row }: { row: RegisterRow }) {
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {findings(row).map((x) => (
        <li key={x.key} className="rounded-md border border-rule bg-white p-4">
          <h3 className="text-[16px] font-semibold text-ink-strong">{x.label}</h3>
          <p className="text-[12px] text-muted">{x.group}</p>
          <dl className="mt-3 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="font-semibold text-muted">Status</dt>
            <dd>
              <span className="inline-flex items-center gap-2"><StatusIcon status={x.info.value} /> {x.info.label}</span>
              {x.a?.note ? <span className="mt-1 block text-[12px] text-muted">{x.a.note}</span> : null}
            </dd>
            <dt className="font-semibold text-muted">Reporting year</dt>
            <dd><YearDetail x={x} /></dd>
            <dt className="font-semibold text-muted">Evidence</dt>
            <dd><EvidenceLink x={x} /></dd>
            <dt className="font-semibold text-muted">Checked on</dt>
            <dd>{x.a?.checked_on ? formatCalendarDate(x.a.checked_on) : "—"}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** Earlier verified versions: when each was verified, and its label and score under its own rule. */
async function History({ id }: { id: string }) {
  let versions;
  try {
    versions = await getRegisterVersions(id);
  } catch (err) {
    console.error("[record] could not load earlier versions:", err instanceof Error ? err.message : err);
    versions = null;
  }
  return (
    <section aria-labelledby="history-h" className="flex flex-col gap-3">
      <h2 id="history-h" className={SECTION_H2}>Earlier verified versions</h2>
      {versions === null ? (
        <p className="text-[15px] text-muted">Earlier versions could not be loaded just now.</p>
      ) : versions.length === 0 ? (
        <p className="text-[15px] text-muted">This is the first verified version of this record.</p>
      ) : (
        <>
          <p className="max-w-[820px] text-[15px] text-muted">
            When a record is corrected, the new version is verified again and the earlier one is kept here.
          </p>
          <ul className="flex flex-col divide-y divide-rule-soft rounded-md border border-rule bg-white">
            {versions.map((ver, i) => {
              const s = scoreRecord(ver.content?.assessments, ver.assessmentYear);
              return (
                <li key={`${ver.verifiedAt}-${i}`} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <span className="text-[15px] text-ink">
                    Verified {formatDate(ver.verifiedAt)}
                    <span className="block text-[13px] text-muted">
                      Replaced {formatDate(ver.supersededAt)} · {ver.verifiedMethod ? `rule ${ver.verifiedMethod}` : "rule not recorded"}
                      {ver.assessmentYear ? ` · assessment year ${ver.assessmentYear}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-[12px] font-semibold ${recordLabel(s.label).className}`}>
                      {recordLabel(s.label).label}
                    </span>
                    <ScoreText score={s} className="text-[13px] text-muted" />
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

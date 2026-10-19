// Legacy import provenance for this institution. Everything here is an unverified claim from the old
// tracker export, shown verbatim for the team only; it is never a finding and never published.
import { INDICATORS } from "@/lib/indicators";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import type { LegacyImportRow } from "@/server/data/cms/editor";
import { IMPORT_DECISION_LABEL, SECTION_LABEL } from "./labels";

function claimText(v: boolean | null | undefined): string {
  if (v === true) return "TRUE";
  if (v === false) return "FALSE";
  return "Blank (unknown)";
}

function sourceLabel(row: LegacyImportRow): string {
  return row.reportedAsOf
    ? `from the ${formatCalendarDate(row.reportedAsOf)} tracker export`
    : `from the import "${row.fileName}"`;
}

export function LegacyPanel({ rows }: { rows: LegacyImportRow[] }) {
  return (
    <section aria-labelledby="legacy-h" className="flex flex-col gap-4">
      <h2 id="legacy-h" className="font-serif text-2xl font-semibold text-ink-strong">Legacy import record</h2>
      {rows.length === 0 ? (
        <p className="rounded-md border border-rule bg-white p-5 text-sm text-muted">
          No imported tracker rows are linked to this institution.
        </p>
      ) : (
        rows.map((row) => {
          const banner = `Legacy claim (unverified) — ${sourceLabel(row)}; not a finding`;
          return (
            <article key={row.id} aria-labelledby={`legacy-${row.id}-h`} className="flex flex-col gap-4 rounded-md border border-rule bg-white p-5">
              <div className="rounded border border-warn-rule bg-warn-bg px-3 py-2 text-sm font-semibold text-warn-text">{banner}</div>
              <h3 id={`legacy-${row.id}-h`} className="text-base font-semibold text-ink-strong">
                {row.fileName} · line {row.sourceLine}
              </h3>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-[13px] font-semibold text-muted">Section</dt>
                  <dd className="mt-0.5 text-ink">{SECTION_LABEL[row.section] ?? row.section}</dd>
                </div>
                <div>
                  <dt className="text-[13px] font-semibold text-muted">Serial cell (provenance only)</dt>
                  <dd className="mt-0.5 font-mono text-[13px] text-ink">{row.serialRaw || "Blank"}</dd>
                </div>
                <div>
                  <dt className="text-[13px] font-semibold text-muted">Imported</dt>
                  <dd className="mt-0.5 text-ink">{formatDateTime(row.uploadedAt)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] font-semibold text-muted">Name as recorded</dt>
                  <dd className="mt-0.5 break-words text-ink">{row.nameRaw || "Blank"}</dd>
                </div>
                <div>
                  <dt className="text-[13px] font-semibold text-muted">State or location cell as recorded</dt>
                  <dd className="mt-0.5 break-words text-ink">{row.stateRaw || "Blank"}</dd>
                </div>
                <div>
                  <dt className="text-[13px] font-semibold text-muted">Website cell as recorded</dt>
                  <dd className="mt-0.5 break-all text-ink">{row.websiteRaw || "Blank"}</dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-[13px] font-semibold text-muted">Legacy report status — legacy claim (unverified), verbatim</dt>
                  <dd className="mt-0.5 whitespace-pre-line break-words text-ink">{row.legacyStatusRaw || "Blank"}</dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-[13px] font-semibold text-muted">Identity decision</dt>
                  <dd className="mt-0.5 text-ink">
                    {IMPORT_DECISION_LABEL[row.decision] ?? row.decision}
                    {row.decisionNote ? ` — ${row.decisionNote}` : ""}
                    {row.held ? " · held for review at import" : ""}
                  </dd>
                </div>
              </dl>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-sm">
                  <caption className="mb-2 text-left text-[13px] text-muted">
                    The nine legacy TRUE/FALSE/blank values. {banner}. TRUE meant &ldquo;recorded as disclosed&rdquo; in
                    the old tracker; it does not mean anyone verified a disclosure.
                  </caption>
                  <thead>
                    <tr className="bg-surface-2 text-left">
                      <th scope="col" className="border border-rule px-3 py-2 font-semibold">Indicator</th>
                      <th scope="col" className="border border-rule px-3 py-2 font-semibold">Legacy claim (unverified)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INDICATORS.map((i) => (
                      <tr key={i.key}>
                        <th scope="row" className="border border-rule px-3 py-2 text-left font-normal">
                          <span className="text-muted">{i.group}:</span> {i.label}
                        </th>
                        <td className="border border-rule px-3 py-2 font-mono text-[13px]">{claimText(row.legacy[i.key])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-ink-strong">Issues raised at import ({row.issues.length})</h4>
                {row.issues.length === 0 ? (
                  <p className="mt-1 text-[13px] text-muted">None.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {row.issues.map((issue, n) => (
                      <li key={`${issue.code}-${n}`} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-[13px] text-muted">{issue.code}</span>
                        <span className="text-ink">{issue.detail}</span>
                        {issue.holds ? <span className="text-[13px] font-semibold text-warn-text">(held the row for review)</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}

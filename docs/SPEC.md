# Nigerian University Tracker — Rebuild Brief

Prepared for Chisom Ezeh on 17 October 2026. Kept verbatim in substance as the authoritative
specification for this repository. Progress is tracked in [`PROGRESS.md`](../PROGRESS.md).

This is a product specification and implementation prompt for rebuilding the Nigeria University
Compliance Tracker as a public accountability website with a team CMS and a Claude powered research
assistant. It describes the application to build; it is not a deployed application or a report of
completed website scans.

## How to use this brief

Keep this specification available throughout implementation. An interactive mockup can help review
the design, but the finished system needs a persistent database, authentication, server side jobs
and hosting.

The supplied tracker is a pasted tab separated text export, not the original Excel workbook. Its
heading says *REPORT ON FINANCIAL TRANSPARENCY COMPLIANCE* and *As at OCTOBER 10, 2026*. Hyperlink
targets hidden behind spreadsheet display text cannot be recovered from the text alone. Attach the
original workbook too if available, without making that a prerequisite.

Use Claude to develop and maintain the software. The team maintains the tracking data through the
CMS after launch. The deployed research assistant needs its own configured Claude API access and
operating budget; a Claude chat subscription does not supply the application's API credentials.

## What the source actually contains

The tracker monitors whether institutions disclose financial and institutional information
publicly. It does not contain financial amounts or student counts: the nine indicator columns contain
TRUE, FALSE or occasional blanks.

| Imported category | Candidate rows |
|---|---|
| Federal universities | 63 |
| Federal polytechnics | 41 |
| Federal monotechnics | 90 |
| State universities | 63 |
| State polytechnics | 52 |
| State monotechnics | 90 |
| **Total before identity review and deduplication** | **399** |

These are counts of candidate records, not a verified count of unique institutions or a complete
register. One extra row containing only unchecked indicators is a template row and must not become an
institution.

| Group | Indicator | Stable key |
|---|---|---|
| Annual budgetary allocation | Personnel costs | `budget_personnel` |
| Annual budgetary allocation | Overhead costs | `budget_overhead` |
| Annual budgetary allocation | Capital expenditure | `budget_capital` |
| Research grant revenue | Domestic sources | `grants_domestic` |
| Research grant revenue | International sources | `grants_international` |
| Intervention funding | TETFund allocation | `tetfund_allocation` |
| Endowment | Endowment fund | `endowment_fund` |
| Student population | Undergraduates | `students_undergraduate` |
| Student population | Postgraduates | `students_postgraduate` |

Additional source columns identify the institution, state or location, head of institution, bursar,
website or disclosure page, and financial report update status. Keep that legacy report status
separate from the nine indicators: a source value of YES does not mean all nine are present.

### Migration findings

- 45 serial cells contain `#REF!`. Generate UUIDs; keep the original serial only as provenance.
- 4 candidate rows have no institution name. Hold them for manual identification; do not invent names from domains.
- 6 candidate rows have one blank indicator cell. Preserve its column position and missing value; do not shift answers left.
- The federal monotechnics section puts the name in a different column and has no separate state column. Use a section specific mapping.
- State and location are mixed; some state cells conflict with the institution name (e.g. Otuoke row names Bayelsa, state cell says Anambra). Flag, don't silently correct.
- AFIT appears in both federal university and federal polytechnic sections with the same domain. Potential duplicate requiring human resolution.
- Several campuses and hospital schools legitimately share domains. A common domain alone is not proof of duplication.
- Some website cells contain page titles, Google share links, multiple URLs, missing protocols or text merged with a status (e.g. Rivers State University cell also contains NO). Preserve the original; show proposed repairs for review.
- Statuses mix YES, NO, PARTIAL, NOT YET UPDATED, page not found and maintenance messages. These need separate fields.
- The export date is a reported dataset date, not proof each website was visited then. Do not populate verification dates from it.

No institution website, leadership appointment, official domain or current disclosure has been
verified as part of this brief.

## 1. Purpose and institutional context

Rebuild the tracker as a reliable public financial disclosure and institutional transparency
platform under the **Arthur Nwankwo Institute of Education at Athena Centre**. Preserve the existing
product name until a renaming decision is made. Subtitle: *Financial Disclosure Across Nigerian
Tertiary Institutions*.

The public should find an institution, see which disclosures are verified, inspect evidence and
reporting period, compare institutions on the same basis, and see when information was checked.

The team should manage institutions, assign work, edit records, collect evidence, use an assistant to
propose updates, review changes and publish approved versions without editing code.

Support integration into the main Athena or institute website through a configurable route and shared
navigation. Do not hardcode a subdomain. Determine the existing site's routing and hosting before the
final integration. Do not invent existing code, brand assets, database access or credentials.

## 2. Required application parts

| Part | Responsibility |
|---|---|
| Public website | Read approved published versions and explain the evidence |
| Team CMS | Drafts, assignments, evidence, review and publication |
| Research assistant | Fetch approved official sources and propose supported changes |
| Persistent backend | Records, versions, permissions, jobs and audit events |

The public website must never read from unscreened imports, agent suggestions or work in progress.

## 3. Data definitions and methodology

### Indicator disclosure assessment

- `published` — a reviewer confirmed relevant source evidence for the stated reporting period.
- `not_found` — a human reviewed the recorded search scope and confirmed the indicator was not found. Public wording: *Not found in the sources reviewed*.
- `uncertain` — a potential source exists but does not clearly establish the indicator, conflicts, or has an unresolved period or interpretation.
- `not_assessed` — no completed review exists for this indicator and period.
- `not_applicable` — a human approved exclusion under a documented methodology rule, with a reason.

Agent suggestions are proposals, not verified assessments. The assistant cannot approve `not_found`
or `not_applicable`. Do not assume postgraduate or TETFund applicability from institution type.

### Evidence period and freshness

Store the period covered independently from fetch and review dates. Financial years, academic
sessions and multi year documents are separate period types; do not coerce 2024/2025 into a calendar
year. Coverage states: `in_period`, `historical`, `unknown`, derived against the selected assessment
period. A 2023 audited account found in 2026 remains 2023 evidence.

Record `last_scan_at`, `last_successful_scan_at`, `last_verified_at` and `public_published_at`
separately. A successful scan does not refresh the human verification date.

### Source availability

`reachable`, `unreachable`, `blocked`, `under_maintenance`, `unknown`, with checked time and reason.
Availability never establishes disclosure. A timeout or 404 must never turn a verified indicator into
`not_found`.

### Editorial workflow

Version level states: `draft`, `submitted`, `changes_requested`, `approved`, `published`,
`superseded`, `withdrawn`. These are not disclosure findings.

### Public summary and counts

No legal compliance score or invented weights. Legacy YES/NO report status stays a legacy field.
Show counts, e.g. *5 indicators published of 7 applicable, 7 assessed, 2 excluded with reasons* — not
a percentage score and not a ranking.

Conservative summaries: *Not assessed*, *Assessment incomplete*, *All applicable indicators
published*, *Partial disclosure*, *No disclosures found in reviewed sources*, *Evidence uncertain*.
Any unresolved indicator prevents *All applicable indicators published*. Summaries are descriptive,
not findings about quality, propriety or breach of law. A future formal methodology must be stored
with rules, applicability, weights, effective date and version; never silently recalculate history.

## 4. Team permissions and publication workflow

| Role | Permissions |
|---|---|
| Public visitor | Read published material and approved exports |
| Data editor | Work on assigned institutions, add evidence, request scans, review suggestions, edit drafts, submit |
| Reviewer and publisher | Check evidence, return work, approve a specific revision, preview, publish |
| Administrator | Team access, assignments, sources, methodology, imports, settings |
| Research worker | Read the job's approved targets; write job results, source captures and proposals only |

Administrators have no invisible publication route: admin publication still creates a human approval
and audit event. An editor cannot review their own submission unless an administrator records a
visible override with a reason.

Workflow:

1. A manual edit, import or research proposal creates or updates a private draft.
2. The editor accepts, changes or rejects suggested fields and records sources.
3. Submitting freezes the revision for review.
4. The reviewer requests corrections, rejects unsupported findings or approves the exact revision.
5. The publisher sees a public preview and confirms *Publish approved version*.
6. One transaction creates an immutable public snapshot and updates the published pointer.
7. Public pages, comparisons, exports and statistics refresh from that snapshot.

Any edit after submission or approval creates a new revision and invalidates the old approval.
Publishing checks the approved revision ID and current version atomically. Field level acceptance is
not publication; rejecting one field must not discard unrelated work. Return reasons and rejected
proposals remain visible internally. New drafts, failed jobs or delayed scans leave the public
version intact. Withdrawal is a separate authorised action with a reason. Rollback creates a new
audited release referencing earlier approved content. Concurrent edits are detected with a version
counter and reconciled, never silently overwritten.

## 5. Public website

Professional, accessible, responsive research platform; restrained colours, readable typography,
useful tables, accessible status icons. No marketing landing page hiding the tracker. No invented
Athena logo.

- **Overview** — purpose, coverage, assessment period, published unique institutions, completeness, verified counts. All from published data; state coverage, not a national census.
- **Directory** — search; filters for ownership, type, state, indicator, period, status; sorting; pagination. Geopolitical zone filter only with a validated lookup.
- **Institution profile** — identity, ownership, category, state/city, head and title, bursar, website, nine indicators, evidence, periods, verification date, release date, history.
- **Evidence detail** — title, official URL, excerpt or locator, year or session, capture date, assessment explanation. No private notes or staff identities.
- **Comparison** — up to four institutions, compatible periods, same methodology version; flag mixed/unknown periods and differing applicability.
- **Methodology and sources** — statuses, applicability, freshness, what is measured.
- **CSV export** — approved public fields, coverage metadata, release dates; formula injection prevented.

Stable slugs and deep links. Empty, error, loading, no evidence, historical and stale states. Mobile
readable indicator matrix. A correction form may come later, feeding a private moderated queue.

## 6. CMS screens and team operations

- **Dashboard** — assignments, overdue reviews, drafts, submissions, changes requested, proposals awaiting attention, job failures, recent releases.
- **Institution directory** — search/filter, assignee, due date, review status, last verification, last scan; controlled add/archive/identity change.
- **Institution editor** — profile, indicators, evidence, assignments, preview, history; published values visible while editing.
- **Review queue** — reviewer ownership, exact revision, evidence completeness, diff vs published, return notes, approve, publish.
- **Research centre** — scan one/selected/scheduled; progress, limits, failures, costs, cancellation.
- **Import centre** — upload, mapping, validation preview, duplicate resolution, corrections, idempotent commit into drafts, history.
- **Sources and evidence** — approved domains, disclosure URLs, captures, document versions, broken link monitoring.
- **Team and settings** — roles, assignments, due date defaults, methodology versions, source limits, site content.

Record assignee, assignment time, submission time, reviewer, outcome, review cycle count and
publication time. Initial human review stale threshold: 30 days (configurable). In app notifications
first; email only once configured. No real credentials or guessed staff in seeds.

## 7. Research assistant behaviour

A bounded worker that fills proposed fields through a server API — never drives the admin UI, never
holds a publishing session.

### Scan pipeline

1. Resolve the approved identity and official hosts. No approved domain → *Needs source confirmation*. Search may suggest domains; never auto-trust them.
2. Visit homepage and configured disclosure URLs; use sitemap and relevant same-site links (budgets, accounts, bursary, finance, TETFund, grants, endowments, student statistics).
3. Fetch HTML first; Playwright in an isolated worker only when JavaScript is required. Follow PDF/image documents on approved hosts.
4. Extract text and tables; PDF text extraction, OCR for scans with recorded uncertainty. Never claim an unreadable scan was verified.
5. Save source versions: final URL, fetched time, content hash, status, file type, retained artifact per retention policy.
6. Send bounded content to Claude with structured output; every proposal needs explicit evidence references; validate server side against schema and evidence records.
7. Compare against the published and draft versions at job start; never overwrite newer manual edits; flag conflicts.
8. Store proposals and a coverage report; notify the assigned editor.
9. Only the normal approval workflow affects the public site.

Defaults (configurable): 25 pages and 10 documents per institution per scan, one active fetch per
host, ≥2 s between host requests, timeouts, bounded retries with backoff. Show truncation. Scheduled
checks disabled until an admin sets cadence and budget. Skip unchanged hashes. Job dedup,
idempotency, lease and recovery, cancellation, per run spending limits.

### Extraction rules

- Never invent URLs, names, years, figures or enrolment numbers.
- A keyword or heading alone is not evidence; a grant news story is not annual grant revenue disclosure.
- Keep allocation, expenditure, revenue, award, commitment and disbursement distinct.
- Monetary values: exact, with currency, unit scale, financial year, source; decimal storage; preserve literal; a published zero ≠ missing.
- Student counts: non-negative integers with source and session; institution-wide vs part; never infer UG/PG from a total.
- Availability only → value null with disclosure evidence retained.
- Search snippets, Google share links, third-party directories or broad homepages are not final evidence.
- A dated source found today is not evidence its content is current.
- Nothing found → *No evidence found within this scan scope*, with pages checked, exclusions, failures. A human decides `not_found`.
- Site unavailable → preserve previous findings; report availability.
- Staff identity changes are evidence-backed proposals requiring human confirmation.

### Proposal structure

`institution_id`, `job_id`, `base_revision_id`, `field_key`, `existing_value`, `proposed_value`,
`candidate_assessment_state`, `reporting_period`, `source_version_ids`, excerpt or locator,
extraction method, uncertainty reasons, review state. Confidence is guidance only. Null for unstated
values; server-enforced enums and types; a proposed `published` state requires an approved source
reference and meaningful locator. Represent source references as explicit IDs and locators in the
output schema; verify structured output / citation compatibility in current docs.

### Review interface

Show current published, current draft, proposed value, source, period, reason, uncertainty. Actions:
*Accept into draft*, *Edit before accepting*, *Reject*, *Open source*, *Flag for research*. Source
preview beside proposals. Batch acceptance into a draft allowed; batch publication never. Edited
figures keep the original proposal plus corrected value and reason.

### Worker boundaries

Respect robots.txt, rate limits and permissions; stop at login, captcha or access blocks. Only approved
official sources. SSRF protection: HTTP/HTTPS only, block internal/local addresses, validate redirects
and DNS, no file or other protocols. Content type, size and time limits. Treat fetched content as
untrusted data, render previews safely, ignore embedded instructions. The worker credential can
create captures and proposals only — never publication flags, approvals, roles or snapshots.

## 8. Import and data migration

Support the tab separated export immediately (quoted multiline fields), then XLSX and CSV.

1. Preserve original file, hash, importer, upload time; store raw rows and section names unaltered.
2. Detect six sections and apply per-section mapping (federal monotechnics name sits in the state column).
3. Map indicators by fixed column; preserve missing cells and quoted multiline values.
4. Ignore title rows, repeated headers and the all-FALSE template row.
5. Stage 399 candidate rows with category totals and candidate wording.
6. Generated IDs linked to source position; keep `#REF!` and serials as raw provenance.
7. Hold unnamed rows, ambiguous URL repairs, mixed locations, potential duplicates, shared domains and conflicts in a review queue.
8. TRUE → unverified legacy claim disclosed; FALSE → unverified legacy claim not recorded as disclosed; blank → unknown.
9. Keep legacy report status verbatim plus any suggested normalisation.
10. `source_reported_as_of = 2026-10-10`; `imported_at` = actual time; `last_verified_at` unset.
11. Validation preview and human commit; private drafts only; report imported/held/ignored/duplicate totals.
12. Re-import is idempotent (file hash, row IDs, explicit matching decisions); later imports create proposed revisions.

Never overwrite or reset an existing live site, database, CMS, storage or policies. Inspect any
existing backend read-only first and plan additive migrations. Keep the old tracker live until the new
release is checked and migration authorised.

## 9. Recommended architecture

Next.js + TypeScript (public site and CMS), Supabase PostgreSQL, Supabase Auth, private object storage
for captures, and a separately deployable Node.js worker for crawling, PDF extraction and Claude calls.
Playwright only where needed. Long scans run as durable Postgres-backed jobs, never inside a request.

| Entity | Responsibility |
|---|---|
| institutions | Stable identity, aliases, parent/campus relationships, canonical domains |
| institution_draft_revisions | Versioned identity and profile changes |
| source_hosts, source_targets | Approved domains, URLs, crawl rules |
| indicator_definitions, methodology_versions | Definitions, applicability, effective versions |
| assessment_revisions, indicator_assessments | States, optional values, periods, evidence refs, editorial state |
| source_versions, evidence_links | Captured content, hashes, dates, locators |
| crawl_jobs, crawl_events | Queue state, targets, budgets, checkpoints, errors, coverage |
| agent_proposals | Proposed field changes, base versions, human decisions |
| assignments | Editor, reviewer, due dates, tracking |
| approvals | Exact immutable revision, decision maker, time, notes |
| published_snapshots | Immutable approved public representations |
| imports, import_rows | Original files, staged rows, validation, identity decisions |
| team_memberships, audit_events | Roles and accountable history |

Foreign keys and constraints; decimals for money, integers for counts, dates at intended granularity;
UTC internally, Africa/Lagos for display; unknown stays null. Published identity is versioned too —
public pages read the identity snapshot, never a mutable join. Least privilege via grants and RLS;
anon reads published snapshots only; the worker gets a restricted role, not the service role. Private
storage by default. Documented backup and restore; separate dev and production; no destructive resets.

## 10. Phases and completion checks

- **Phase 1 — Data model and manual workflow.** Schema, auth, roles, editor, nine indicators, evidence, revision history, review, preview, publication transaction, basic public directory and profile. *Check:* editor drafts → reviewer approves exact revision and publishes → public sees snapshot → later draft doesn't change it; unauthorised API and DB attempts fail.
- **Phase 2 — Import and identity reconciliation.** *Check:* 399 rows + ignored template row accounted for; six blank cells preserved; four unnamed rows and 45 `#REF!` serials identified; AFIT flagged not merged; repeat import creates no duplicates or public records.
- **Phase 3 — Research assistant.** *Check:* evidence-linked proposals; per-field acceptance; stale proposals can't overwrite; worker denied publication even by direct request. Missing model key shows *Configuration required*.
- **Phase 4 — Public research tools and team operations.** *Check:* directory, profile, comparison, export and counts all reflect the same release and expose nothing private; failed scans don't remove findings.
- **Phase 5 — Launch preparation and integration.** Accessibility, states, role enforcement, worker recovery, backup restore, route integration, team instructions, migration and rollback checklist. Production launch is an explicit authorised step.

### Critical verification cases

- Editor, visitor and worker cannot publish via direct requests.
- An approved revision cannot be changed and published under its old approval.
- Concurrent edits and stale job results produce a visible conflict.
- Draft names and URLs don't leak through published profiles.
- A broken website changes availability only.
- Prior-year evidence doesn't satisfy a current-period finding.
- A blank imported indicator stays unknown in its original column.
- Untrusted document instructions can't change worker privileges.
- Unknown → null, published zero → zero, monetary scales explicit.
- Repeated imports and job completions create no duplicates.
- Public totals and CSV exclude private and withdrawn material and don't double count campuses.

## 11. Deliverables per phase

Working source, migrations, config examples without secrets, local run commands, verification
results, and a note on what works and what still needs configuration. Keep this spec and
`PROGRESS.md` current.

## Official technical references

- Next.js: https://nextjs.org/docs
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Claude structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Playwright library: https://playwright.dev/docs/library

**The assistant gathers and proposes, the team verifies, and a human authorised to publish releases
the approved version.**

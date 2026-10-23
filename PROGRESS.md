# Progress

## Update 23 Oct 2026: the verified register (the Chancellor's requirements)

- **Unverified ticks are off the public site.** Migration 0014 marks every record unverified, and the
  public functions (including the older ones a previous build calls) return verified content only.
  Visitors see "Verification in progress" until a record is verified.
- **One source record per institution** (`/admin/report`): homepage, disclosure page, up to three
  extra documents, and for each of the nine indicators a status, reporting year, evidence link,
  date checked and public note.
- **Statuses:** Published, Partially published, Explicitly nil, Not found, Temporarily inaccessible,
  Not applicable (reason required) and Not yet assessed.
- **Second-person verification:** a reviewer or administrator who did not edit the record verifies
  it. The database enforces this, binds the decision to a content hash so nothing changes between
  reading and verifying, and refuses incomplete records (missing homepage, evidence, year or date
  checked). Reviewers can return a record with a note.
- **Link checker:** per record or in batches of eight. Flags dead links, homepage-only links,
  redirects to the homepage, and links on another institution's website (the FUPRE link on the PTI
  row, for example). Uses the SSRF-safe fetcher.
- **Published scoring rule:** `src/lib/register.ts` is the only scoring code; the public "How we
  score" page is generated from it. Partial counts half; nil counts as disclosed; inaccessible, not
  applicable and not assessed are excluded; no overall label until every indicator is assessed.
- **Public pages:** a record page per institution with the evidence for each indicator, the
  reporting year, date checked and the verification date.
- Imports now only add institutions not already in the register; they never overwrite verified work.

## Update 23 Oct 2026: quick report editor and a server-freeze fix

- **CMS → Compliance report** (`/admin/report`): the public report table, edited directly.
  - Reviewers and administrators edit any institution: name, category, state, head, bursar,
    website, report status, and each indicator (Published, Not published, Not recorded).
  - Saving updates the public Institutions page at once. Every change is audited with the
    values before and after.
  - Administrators add or remove institutions, set the "as at" date, and show or hide the
    report. Uploading a spreadsheet and showing it replaces the table.
  - Migration 0012 keeps the earlier public function working, so deploying and migrating can
    happen in either order.
- **Freeze fixed:** a form posted before the page's JavaScript loaded made React's server render
  wait forever on a freshly bound server action, until the server ran out of memory. Forms now
  reuse one binding per record (`src/lib/boundAction.ts`). Checked in a browser: the same post
  now completes in about 2 seconds.
- The public Institutions page shows a calm message instead of an error page if the report
  cannot be loaded (for example, before migrations have been run).

## Update 18 Oct 2026: clean start, Excel import, security review fixes, research assistant

- **Clean start:** the demonstration "(TEST DATA)" institutions, pre-loaded drafts and demo accounts are
  gone from the app. The local database starts empty; `/admin` opens the one-time setup, then the
  tracker is uploaded in the Import centre. The fixture data now lives only in tests
  (`tests/fixtures/seed.ts`).
- **Excel import:** .xlsx, CSV and TSV uploads. Real addresses behind linked cells are recovered.
  Zip-bomb protection measures bytes actually inflated. Guessed values (repaired addresses, towns
  in the state column, shared domains) are never written into drafts. Rows whose name matches an
  existing institution get a decision form ("Needs matching") instead of being silently skipped.
- **Security review (adversarial, 20 confirmed findings, all fixed):**
  - Setup needs SETUP_TOKEN on a deployed site.
  - Sign-in limits are race-free and keyed per address, so an attacker cannot lock a member out.
    Admins can clear a lock.
  - Invitations are revocable, and are cancelled automatically when the person who sent them loses
    admin rights.
  - Team changes are serialised, so the team cannot end up with no administrator.
  - Editors are limited to their assigned institutions, or ones nobody has been assigned.
  - Nobody reviews work they submitted or edited, including content carried forward after a
    return.
  - Withdrawal takes every release of the institution off the public site.
  - A revision can be published after a withdrawal.
  - "Return for changes" works after approval (reopen_revision).
  - Prior-year evidence no longer counts as current, and all-excluded institutions get a neutral
    label.
  - The content hash is independent of time zone, and amounts are exact on public pages.
- **Research assistant (Phase 3):**
  - Administrators approve official websites.
  - Editors request scans. A bounded crawler respects robots.txt, keeps at least 2 seconds between
    requests to a host, and refuses private or internal addresses, off-site redirects and odd
    content types (SSRF-safe).
  - Claude (`claude-opus-5-5`, structured output, server-side refusal fallback) proposes values.
    Each must quote the captured page verbatim, which is checked by the server and again by the
    database.
  - Editors accept, correct or reject each proposal into the draft. Accept-all is available.
  - The worker role can only add captures and proposals; it cannot read drafts or publish.
    `npm run worker` runs it in production.
  - Without ANTHROPIC_API_KEY, scans end as "Configuration required".
- **Verified:**
  - 156 tests pass. tsc and lint are clean. The production build has no warnings. The repo and
    bundle secret scans are clean. npm audit reports 0 vulnerabilities.
  - In a browser: the clean start opens setup. An Excel upload staged 399 rows (69 held, 330
    ready), and the commit created 330 private drafts.
- **Known issue (local preview only):** after an import commit, the local dev server sometimes
  stopped responding, with memory climbing past 3 GB. The cause is not yet confirmed. The leading
  suspect is a half-started local database engine left running after a damaged local database
  was set aside; that is now closed properly, and long transactions are logged. If it happens:
  stop the dev server, run `npm run db:reset-local`, and start again. Neon (production) does not
  use this engine.
- **Still to do:**
  - Confirm the local hang is gone.
  - PDF text extraction for scans, and scheduled scans.
  - A bulk "match all same-name rows" action for imports.
  - Email notifications.
  - Official logos (`public/logos/`).
  - Connect the real Neon project (docs/DEPLOYMENT.md).

## Update 17 Oct 2026: CMS and public screens on local fixtures, Neon-ready

- **Database:** Neon replaces Supabase. Project-specific roles (`nut_anon`, `nut_member`,
  `nut_system`) keep clear of Neon's own `auth` schema, and the app never connects as the owner.
  Locally the app runs on PGlite with labelled fixture data (`db/migrations`, `scripts/db.ts`).
- **Accounts:** built in, with scrypt passwords, hashed and signed sessions, a permanent one-time
  setup at `/admin/setup`, single-use invite links, sign-in lockout, and admin rights re-checked in
  the database.
- **Public site:** editorial design with the partnership band and wording from the original portal.
  Pages: directory, profiles, history, evidence, compare, methodology, and CSV with
  formula-injection guard.
- **CMS at `/admin`:** dashboard with quick actions, institutions, editor (lock-protected drafts,
  verification date), review queue with comparison, preview, publish and withdraw, imports
  (stage, decide, commit), team and invites, help page.
- **Verified:** 87 tests pass, `tsc` passes, the production build passes, and the repo and bundle
  secret scans are clean. In a browser: editor saves and submits, the reviewer approves, the
  publish confirmation is enforced, the public page updates, an import commit creates drafts only,
  invite links work, and the phone layout has no sideways scroll.
- **Still to do:** Phase 3 research assistant, XLSX import, email, official logos
  (`public/logos/athena-centre.png`, `federal-ministry-of-education.png`), and connecting a real
  Neon project.

Run every check with `npm test`. All 27 currently pass. Database tests run against PGlite
(Postgres 17 in WASM) with a stubbed Supabase `auth.uid()`.

## Phase 1: Data model and manual workflow (schema done; screens not built)

**Done**
- Created a private repo and scaffolded Next.js 16 with TypeScript and Tailwind.
- Added the spec ([docs/SPEC.md](docs/SPEC.md)) and the schema/page proposal ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).
- Wrote `supabase/migrations/0001_phase1_core.sql`, which covers:
  - Team roles, institutions and versioned revisions (profile plus nine indicators), evidence,
    approvals, immutable published snapshots, assignments and an audit log.
  - All writes go through role-checked functions: `create_institution`, `create_revision`,
    `save_profile`, `save_indicator`, `add_evidence`, `remove_evidence`, `submit_revision`,
    `review_revision`, `publish_revision`, `withdraw_publication`.
  - Optimistic locking, content-hash-bound approvals, self-review refusal with an audited admin
    override, and RLS so `anon` reads only non-withdrawn snapshots.
- `tests/db/phase1.test.mjs` has 8 checks covering publish workflow, direct-access attempts,
  leak prevention, lock conflicts, zero vs null, and withdrawal.
- A design draft of the public overview and directory, the institution profile and the CMS
  review screen. It carries the Athena Centre and Federal Ministry of Education partnership
  header from the old portal.

## Phase 2: Import and identity reconciliation (engine done; import centre UI not built)

**Done**
- Saved the 10 Oct 2026 export as [data/source/tracker-export-2026-10-10.tsv](data/source/tracker-export-2026-10-10.tsv). Provenance is in its README.
- `src/lib/import/trackerTsv.ts` is the parser. It:
  - handles quoted multi-line cells and detects all six sections;
  - maps each section's columns, including federal monotechnics, which keep the name in the
    state column;
  - reads the nine indicators by fixed column, so blanks stay `null` in place;
  - normalises legacy status separately from the indicators;
  - proposes website repairs without overwriting the original;
  - flags state conflicts, potential duplicates and shared domains. It never merges.
- `supabase/migrations/0002_phase2_imports.sql` adds:
  - `imports`, which keeps the original text, its SHA-256, the reported-as-of date and a summary;
  - `import_rows`, which keeps raw cells, source line, legacy claims, issues, the hold flag and
    the human decision;
  - `stage_import`, which is idempotent by file hash;
  - `decide_import_row` (`create_new`, `match_existing` or `skip`, with a reason);
  - `commit_import`, which creates private drafts only, can be repeated safely, and sends
    same-name rows from later imports to `needs_match`.
- Phase 2 completion check results, from `tests/import` and `tests/db/phase2.test.mjs`:

  | Check | Result |
  |---|---|
  | Candidate rows | 399 (63 / 41 / 90 / 63 / 52 / 90) |
  | Template row | 1, ignored |
  | `#REF!` serials | 45, kept as provenance |
  | Unnamed rows | 4, held |
  | Blank indicator cells | 6, `null` in their own column |
  | AFIT | Flagged in both sections and held. It merges only by explicit decision |
  | First commit | 329 private drafts, 70 held, 0 published, all indicators `not_assessed`, no verification dates |
  | Re-staging or re-committing | No new imports, rows or institutions |
  | Later import with the same names | 0 created, 329 need a match |

- `npm run import:preview -- <file>` prints the summary and writes the held rows to a CSV.
  Formula injection is neutralised. For this export that is
  `data/reports/tracker-export-2026-10-10.held-rows.csv`.

**Held rows by reason (70):** website text or link unusable (36), potential duplicates (25),
state conflicts (5) and unnamed rows (4). One row can have more than one reason.

**Not done yet**
- Import centre screens: upload, mapping preview, the held-row queue with decision buttons, and
  import history.
- CSV and XLSX upload. The parser is TSV-only, and an XLSX reader is needed to recover hyperlink
  targets.
- Later imports matched to existing institutions only link provenance for now. Field-level
  proposals against existing drafts arrive with the Phase 3 proposal system.

## Next
- Supabase project connection, Auth sign-in and `/cms` route protection.
- CMS screens: institution list, editor, review queue, publish confirmation and import centre.
- Public pages built from the design draft, reading `published_snapshots` only.

## Needs configuration or input
- A Supabase project (URL and anon key), or Docker for a local `supabase start`. Until then the
  migrations are verified on PGlite only.
- The original `.xlsx` workbook, if available, to recover hyperlink targets.
- Official logo files for Athena Centre and the Federal Ministry of Education. The design uses
  labelled placeholders.
- Athena website hosting and routing details for the final integration.

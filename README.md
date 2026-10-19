# Nigeria University Compliance Tracker

*Financial Disclosure Across Nigerian Tertiary Institutions*. A project of the Arthur Nwankwo
Institute of Education at Athena Centre.

This is a public accountability website that shows which financial and institutional disclosures
Nigerian universities, polytechnics and monotechnics publish. It is backed by a team CMS with
review and publication controls, and a Claude-powered research assistant that proposes
evidence-linked updates for humans to verify.

> **Rule:** the assistant gathers and proposes, the team verifies, and a human authorised to
> publish releases the approved version.

## Documents

- [docs/SPEC.md](docs/SPEC.md): the full rebuild brief (the authoritative specification)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): source data summary, schema and page structure
- [PROGRESS.md](PROGRESS.md): what works and what still needs configuration

## Stack

Next.js 16 (App Router, TypeScript, Tailwind CSS 4) and Postgres with row level security: Neon in
production, PGlite locally. Team accounts are built in, with hashed sessions and one-time setup. Research
scans run in a separate Node.js worker (`npm run worker`) that can only add captures and proposals.

## Local development

```bash
npm install
npm run dev            # http://localhost:3000 — public site; team CMS at /admin
```

With no `DATABASE_URL`, the app runs on a local PGlite database in `~/.nigerian-university-tracker/pglite`
(outside the project, because OneDrive and similar sync tools corrupt database files). It starts
**empty**: no demonstration institutions and no demo accounts. Open `/admin` to create the first
administrator (the one-time setup screen), then upload the tracker spreadsheet in the Import centre.
To start again from empty, stop the dev server and run `npm run db:reset-local` (the old copy is set
aside under `.data/`, not deleted).

Tests use their own in-memory databases and a test-only fixture set (`tests/fixtures/seed.ts`); the
application never loads it.

Production uses **Neon Postgres**. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

```bash
npm test               # database, import, library, research and account-service tests
npm run build
npm run check:secrets  # repository scan
npm run check:bundle   # built client assets scan (after build)
```

## Importing the tracker spreadsheet

Federal institutions only: state sections in a file are left out. The quickest route is the script,
which stages the file, commits safe rows as private drafts and shows it as the public report:

```bash
npm run import:tracker -- "path/to/Financial Transparency Compliance Report.xlsx"
```

(Stop the dev server first for the local database, or set `MIGRATION_DATABASE_URL` for Neon.)

In the CMS, an administrator opens **Import centre**, uploads the tracker as an Excel workbook (.xlsx),
CSV or tab-separated text, checks the preview (held rows and rows matching an existing institution
need a decision), then commits, and presses **Show this spreadsheet on the public site** to make it the
report on the public Institutions page. Commits create private drafts only. Excel uploads keep the real web
addresses behind linked cells. Guessed values (a repaired web address, a town in the state column) are
never written into drafts; editors confirm them from the import record.

The 10 October 2026 export is in [data/source/](data/source/README.md). To preview what an import
would stage and hold, without touching a database:

```bash
npm run import:preview -- data/source/tracker-export-2026-10-10.tsv
```

In the database, an administrator calls `stage_import`, which is idempotent by file hash, then
`decide_import_row` for held rows, then `commit_import`. Commits create private drafts only.
Legacy TRUE/FALSE values stay on the import rows as unverified claims and are never published.

## Status

- **Public site:** overview and the compliance report (every federal university, polytechnic and
  monotechnic with the status of each of the nine indicators and a key explaining them), published
  profiles, release history, evidence pages and comparison. It uses an editorial
  WordPress-style design with the Athena Centre and Federal Ministry of Education partnership band.
- **Team CMS (`/admin`):** dashboard with getting-started steps and quick actions, institution
  directory and editor, review queue with comparison and preview, publish, return and withdraw,
  import centre (Excel, CSV, TSV), team, invitations (revocable) and sign-in lock clearing, and a
  plain-language help page.
- **Research assistant:** administrators approve each institution's official websites; editors
  request scans; a bounded, SSRF-safe crawler captures pages (robots.txt respected); Claude
  (`claude-opus-5-5`, structured output) proposes values that must quote the captured text verbatim;
  editors accept, correct or reject each proposal into the draft. It never publishes or marks
  anything "not found". Without `ANTHROPIC_API_KEY` the CMS shows "Configuration required".
- **Not yet:** PDF text extraction for scans, scheduled scans, email notifications and official logo files.

See [PROGRESS.md](PROGRESS.md).

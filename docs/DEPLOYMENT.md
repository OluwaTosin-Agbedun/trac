# Deployment: Vercel and Neon Postgres

The site is live on Vercel with a Neon Postgres database. Local development uses PGlite.

## Release checklist (every deploy that adds migrations)

Migrations 0014 to 0018 replace database functions that earlier builds (and the research worker) call,
so the database and the code must change together. In order:

1. In Neon, create a restore branch from `main` named after the date (for example
   `pre-release-2026-11-09`). This is the rollback point.
2. From an up-to-date checkout of `main`, with the **direct** (not `-pooler`) owner connection string:
   `MIGRATION_DATABASE_URL="<direct owner URL>" npm run db:migrate`. It applies only what is missing,
   in order, and refuses a migration file that has changed since it was applied.
3. Deploy the same commit on Vercel straight away (a push to `main` does this), then smoke-test:
   `/institutions`, one record page `/institutions/<slug>`, `/compare`, and `/admin/report`. The
   research worker (section 5a) redeploys from the same push; check the Research centre says it is
   running.
4. Rollback: reset Neon `main` to the restore branch and redeploy the previous commit in Vercel.

Production environment variables (Vercel, Production scope only; never commit them): `DATABASE_URL`
(pooled, `nut_app` login), `SESSION_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `SETUP_TOKEN` (remove
after the first administrator exists), `SITE_URL` (the public address), `CLIENT_IP_HEADER=x-vercel-forwarded-for`,
and optionally `CONTACT_EMAIL` (shown on the site for corrections). `ANTHROPIC_API_KEY` and
`WORKER_DATABASE_URL` belong on the research worker host only (section 5a), never on Vercel. Preview
deployments must not use the production database. Migration 0016 grants the new `nut_cron` role to `nut_app` when that login exists.
`.gitattributes` pins SQL files to LF line endings so migration fingerprints match on every machine.

## 1. Create the Neon project

1. Create a project in the Neon console. Choose Postgres 17 (it matches PGlite) and a region
   close to the host, for example `aws-eu-west-2` for a European host.
2. Keep the default `main` branch for production. Create a `dev` branch for testing migrations.
3. Copy two connection strings for the owner role (`neondb_owner`):
   - **Direct (unpooled):** the host has no `-pooler`. Use it for migrations only.
   - **Pooled:** the host contains `-pooler`. You will not use it with the owner role.

## 2. Apply migrations as the owner (direct connection)

```bash
MIGRATION_DATABASE_URL="postgresql://neondb_owner:...@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" npm run db:migrate
```

The runner applies `db/migrations/*.sql` in order and records each file's SHA-256 in
`schema_migrations`. If an applied file has changed since, it refuses to run. Write a new
migration instead of editing an old one. It also refuses pooled URLs.

`0000_platform.sql` creates the three NOLOGIN roles that carry every application privilege:
`nut_anon`, `nut_member` and `nut_system`. The names are deliberately project-specific. Neon's
`pg_session_jwt` extension and Data API use an `auth` schema and the roles
`authenticated`/`anonymous`, so these names cannot collide with them.

## 3. Create the unprivileged runtime role

On Neon the owner role belongs to `neon_superuser`, which has BYPASSRLS. **The app must never
connect as the owner.** As the owner, on the direct connection, run:

```sql
create role nut_app login password '<long random password>' noinherit;
grant nut_anon, nut_member, nut_system to nut_app;
```

`nut_app` owns nothing and holds no privileges itself. Each request opens one transaction and
switches to `nut_anon` (public), `nut_member` (signed-in team member) or `nut_system` (account
service). Grants and row level security then decide everything. Workflow functions run as
`SECURITY DEFINER` under the migration owner.

Roles are copied into a branch when the branch is created. Repeat this step on any branch created
before the role existed.

## 4. Environment variables (set in the host, never in git)

| Variable | Value |
|---|---|
| `DATABASE_URL` | **Pooled** connection string for `nut_app` (host contains `-pooler`) |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 48`) |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | base64 of 32 random bytes; needed when more than one instance runs |
| `DATABASE_POOL_MAX` | optional, default 5 (a small pool on top of Neon's pooler) |
| `NEXT_PUBLIC_BASE_PATH` | optional, e.g. `/tracker` when mounted inside the Athena site |
| `SETUP_TOKEN` | 32+ random characters. The one-time setup screen asks for it, so only the person who deployed can create the first administrator |
| `SITE_URL` | the public address, e.g. `https://tracker.example.org`; invitation links use it instead of request headers |
| `CLIENT_IP_HEADER` | a header the host sets to the visitor's address (`x-vercel-forwarded-for` on Vercel, `cf-connecting-ip` behind Cloudflare); used for sign-in limits |

With `DATABASE_URL` set, the app never runs migrations at request time, and accounts flagged as test
fixtures are rejected even if their rows exist. In production without `DATABASE_URL`, every page
shows "Configuration required".

**Transaction pooling note.** The app uses `SET LOCAL ROLE` and `set_config(..., true)` inside one
`BEGIN … COMMIT` on a single checked-out connection. Both are scoped to the transaction, which is
the pattern transaction-mode PgBouncer supports. Neon's documentation does not say this explicitly
(**unverified**). If the pooled endpoint ever misbehaves, point `DATABASE_URL` at the direct host
for `nut_app` instead.

## 5. First run

1. Deploy, then open `/admin`. Because no administrator exists, it shows the one-time setup screen.
2. Enter the `SETUP_TOKEN` value and create the owner account. A permanent `setup_completed` flag
   is written in the same transaction. The screen then closes for good: it cannot reopen even if
   every administrator is later removed. Without `SETUP_TOKEN` set, setup refuses to run.
3. Invite team members from **Team and settings**. The invite link is shown once and expires in
   7 days. Email delivery is not configured yet.
4. In **Imports**, upload the tracker spreadsheet (Excel .xlsx, CSV or tab-separated). Review the
   held rows and any rows that match an existing institution, then **Commit safe rows** to create
   private drafts. Press **Add these institutions to the register**: each institution becomes a record
   to verify in **Compliance report**, and the public site shows "Verification in progress" until a
   second reviewer verifies it. Existing records are never overwritten. Or, from your computer, run
   `MIGRATION_DATABASE_URL="<direct owner URL>" npm run import:tracker -- "<file.xlsx>"`.
5. If someone is locked out after too many wrong passwords, an administrator clears it on
   **Team and settings**. If the only administrator is locked out, wait 15 minutes, or run as the
   owner: `update app_login_attempts set cleared = true where email_lower = '<email>';`

## 5a. Research worker

**How it works on the live site.** The website on Vercel never calls Claude. Scans are done by a
separate, small, always-on Node process, the research worker (`npm run worker`). It checks the
database every 15 seconds for a scan someone queued, takes one at a time, reads only the
administrator-approved websites of that institution (robots.txt respected, at least two seconds
between requests to a site, private and internal addresses refused), reads web pages and PDF text,
sends the text to Claude once per scan, and stores the proposals it gets back. Staff see them in the
CMS. If the worker is not running, scans simply stay queued; the rest of the site is unaffected.

The worker logs in to the database with its own restricted login. It can only call the worker
functions: it cannot read drafts or the register, see accounts, approve, verify or publish.

### Steps

1. **Create the worker's database login** (once per Neon branch). As the owner, on the direct
   connection (the host without `-pooler`), run:
   ```sql
   create role nut_worker_app login password '<long random password>' noinherit;
   grant nut_worker to nut_worker_app;
   ```
   Never grant `nut_worker` to `nut_app`, and never give the worker the owner's or `nut_app`'s
   connection string. Then build its connection string from the direct host, for example
   `postgresql://nut_worker_app:<password>@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`.
   The worker holds at most a few connections, so the direct host is fine.
2. **Apply the migrations first** (release checklist above), so the database has the worker
   functions from migration 0018 before the new worker starts.
3. **Create the worker service** on a small always-on host. Either works:
   - **Render:** New → Background Worker → connect the GitHub repository, branch `main`.
     Runtime: Node. Build command: `npm ci`. Start command: `npm run worker`. The smallest instance
     is enough (PDF reading is capped at 256 MB of memory). Add the environment variable
     `NODE_VERSION=22.18.0` (or any later version).
   - **Railway:** New Project → Deploy from GitHub repo → this repository. In the service settings set
     the build command to `npm ci` and the start command to `npm run worker`, and do not add a public
     domain (the worker serves nothing). Choose Node 22.18 or later in the service variables (Railway's
     builder reads `RAILPACK_NODE_VERSION`, for example `22.18.0`).

   Node 22.18 or later is required: the worker runs the TypeScript files directly. Check the first
   deploy log shows the Node version you chose.
4. **Set the environment variables on the worker host only:**

   | Variable | Value |
   |---|---|
   | `WORKER_DATABASE_URL` | the `nut_worker_app` connection string from step 1 |
   | `ANTHROPIC_API_KEY` | the Claude API key (from the Anthropic Console) |
   | `SITE_URL` | the public site address, e.g. `https://tracker.example.org`; websites see it as the crawler's contact |
   | `NODE_ENV` | `production` (a missing `WORKER_DATABASE_URL` then stops the worker with an error) |

   **Never put `ANTHROPIC_API_KEY` or `WORKER_DATABASE_URL` on Vercel.** The website does not call
   Claude and needs neither; if `ANTHROPIC_API_KEY` is set on Vercel today, remove it. The CMS learns
   whether the worker has a key from the worker itself (a yes or no it reports, never the key).
5. **Check it is running.** Open the Research centre in the CMS. Its status line says one of:
   - "The research worker is running." (with its version), or
   - "No research worker has been seen for N minutes – scans stay queued until it runs." (the
     service is stopped, crashed or cannot reach the database: read its logs), or
   - "The worker has no Anthropic API key – scans will end as Configuration required." (add the key
     on the worker host and restart it).

   The worker's own log shows `[worker] <host>:<process> (<version>) started` and one line per
   finished scan.
6. **First scan.** As an administrator, on the Research centre press **Approve the homepages of
   register records** (it approves the homepage of every record linked to a research institution
   and reports how many records are not linked yet). Open a record in **Compliance report**, press
   **Request a scan** in "Research assistant suggestions", and reload after a few minutes: pages are
   read politely, a few seconds apart, then Claude reads them once. Suggestions appear in the same
   panel.

### Cost control

- Scans start only when a team member presses **Request a scan**. Nothing is scheduled.
- Each scan makes **one Claude call per institution**, after reading at most **25 pages and 10
  documents** from the approved websites. At most 20 sources and 150,000 characters are sent, and
  the reply is capped at 16,000 tokens. (If the model service is busy or briefly fails, the same call
  is retried up to three times.) Pages the model already read that have not changed since are
  not sent again. One scan runs at a time.
- Each scan's token use is stored with the scan. Set a monthly spending limit in the Anthropic
  Console as a backstop.
- Stopping the worker service stops all spending; queued scans wait until it runs again.
- The worker's 15-second check keeps the Neon compute awake while it runs. On a plan billed by
  compute time, stop the worker when no scans are planned.

### What a suggestion can and cannot do

A proposal never changes a record by itself. An editor opens the record, compares each suggestion
(the exact text quoted from the captured page, where it is, and the page's address and capture date)
with what the record holds, and presses **Apply to this record** or **Dismiss** (with a reason).
Applying fills that indicator in the private working copy (status, year, evidence link, date checked
and a note saying where on the page) and adds the editor to the record's editors. The record then
shows "Awaiting verification", and a **second reviewer**, who did not edit it, must verify it before
the public site shows anything. Scanned PDFs with no text layer are listed in the scan's results as
"unreadable (scanned or image-only)" for a person to check by hand.

### Updating and troubleshooting

- Render and Railway redeploy the worker on every push to `main`. When a release adds migrations,
  apply them before the push (release checklist), so the website and the worker meet the new
  functions.
- "No research worker has been seen": open the service's logs. `password authentication failed`
  means the connection string is wrong; `function worker_report_status(...) does not exist` means
  migration 0018 has not been applied; `permission denied to set role "nut_worker"` means the
  login was not given the worker role (`grant nut_worker to nut_worker_app;`, step 1); an exit right
  after start with "Set WORKER_DATABASE_URL" means the variable is missing.
- Scans end as "Configuration required: the research worker's API key was rejected": replace the key
  on the worker host.
- A scan whose worker stopped is taken over by the next worker after five minutes; after three
  attempts it is marked failed. A cancelled scan whose worker stopped is closed as cancelled.

## 6. Previews and branches

- To give each pull request its own database, use the Neon-managed Vercel integration. It
  creates a `preview/<branch>` branch per preview deployment and injects `DATABASE_URL` and
  `DATABASE_URL_UNPOOLED`.
- Run `npm run db:migrate` against the preview branch's **unpooled** URL as a build step, or
  manually. Then create `nut_app` on that branch (step 3) and point the preview's `DATABASE_URL`
  at it.
- Production data never goes to development machines. Local work uses a local PGlite database.

## 7. Backups, restore and rollback

- Neon keeps point-in-time history for the plan's retention window. Before any production
  migration, create a named branch from `main` (for example `pre-0005-2026-11-01`) as an instant
  restore point.
- To restore: reset `main` to the restore branch from the console, or promote the restore branch.
  Then redeploy the matching application commit.
- Application rollback: redeploy the previous commit. Migrations are additive, so an older build
  keeps working against a newer schema unless a migration says otherwise.
- Releases are immutable rows in `published_snapshots`. Withdrawal and rollback create new audited
  records; nothing is deleted.

## 8. Pre-launch checks

Run these and keep the output with the release:

```bash
npm test                 # database, import, library and account-service tests
npx tsc --noEmit
npm run lint
npm run build
npm run check:secrets    # repository scan for credentials and conflict markers
npm run check:bundle     # built client assets: no secrets, SQL or server-only fields
```

Then confirm by hand on the deployed site:

- Signed out, every `/admin` page redirects to sign-in, and direct POSTs to actions are refused.
- The public directory, profile, compare and CSV show only published, non-withdrawn releases.
- The setup screen redirects to sign-in.

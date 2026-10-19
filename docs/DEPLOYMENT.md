# Deployment: Neon Postgres

The app runs on Postgres. Local development uses an empty PGlite database. Production
targets [Neon](https://neon.com). Nothing here has been run against a real Neon project yet. It is
the checklist to follow when one exists.

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
4. In **Imports**, upload the tracker spreadsheet (Excel .xlsx, CSV or tab-separated; federal rows
   only are kept). Review the held rows and any rows that match an existing institution, then
   **Commit safe rows** to create private drafts. Press **Show this spreadsheet on the public site** to
   publish the report table on the Institutions page. Or, from your computer, run
   `MIGRATION_DATABASE_URL="<direct owner URL>" npm run import:tracker -- "<file.xlsx>"`.
5. If someone is locked out after too many wrong passwords, an administrator clears it on
   **Team and settings**. If the only administrator is locked out, wait 15 minutes, or run as the
   owner: `update app_login_attempts set cleared = true where email_lower = '<email>';`

## 5a. Research worker (Phase 3)

Scans run in a separate Node process, never inside a web request, with its own database login that
can only call the worker functions (it cannot read drafts, approve or publish).

1. As the owner, on the direct connection:
   ```sql
   create role nut_worker_app login password '<long random password>' noinherit;
   grant nut_worker to nut_worker_app;
   ```
   Never grant `nut_worker` to `nut_app`.
2. Run `npm run worker` on a small always-on host (a container, VM or background worker) with
   `WORKER_DATABASE_URL` (the `nut_worker_app` connection string) and `ANTHROPIC_API_KEY`.
   It takes one queued scan at a time, visits only administrator-approved official websites
   (robots.txt respected, at least two seconds between requests to a host, private and internal
   addresses refused), and stores proposals for editors.
3. Without `ANTHROPIC_API_KEY`, scans end immediately as "Configuration required". The rest of the
   CMS works without it.

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

# Architecture: schema and page structure

This is the proposal the brief asks for before Phase 1 ([SPEC.md](SPEC.md) §9–10). It covers the
Phase 1 schema in [`supabase/migrations/0001_phase1_core.sql`](../supabase/migrations/0001_phase1_core.sql)
and shows where later phases attach.

## Source data summary

The supplied export is a tab-separated text file titled *REPORT ON FINANCIAL TRANSPARENCY
COMPLIANCE, As at OCTOBER 10, 2026*. It has six sections with 399 candidate rows in total: 63 federal
universities, 41 federal polytechnics, 90 federal monotechnics, 63 state universities, 52 state
polytechnics and 90 state monotechnics. It also has one all-FALSE template row. Each row holds identity
columns (name, state or location, head, bursar, website, legacy report status) and nine TRUE/FALSE
disclosure flags. It contains **no** amounts or student counts. Known defects are 45 `#REF!` serials,
4 unnamed rows, 6 rows with one blank indicator, a different column layout in the federal
monotechnics section, state cells that conflict with names, AFIT listed twice, shared campus
domains, malformed website cells and mixed status values. Phase 2 brings all of this into a
review queue. Nothing in the export becomes a verified assessment.

> The export file was not attached to this repository yet. Phase 2 needs it, and the original
> `.xlsx` if available, to recover hyperlink targets.

## Core model

Each institution has a stable identity row and a sequence of **revisions**. A revision is the
unit that moves through the editorial workflow. It carries both the profile fields (name, state,
head, bursar, website…) and the nine indicator assessments. Versioning them together means a draft
change to a bursar or website can never leak through a join into a published page.

```
institutions ──< revisions ──< revision_indicators ──< evidence_links
     │              │
     │              ├──< approvals (exact revision + content hash)
     │              └──< review_events
     └── published_snapshot_id ──> published_snapshots (immutable JSON, public)
```

| Table | Phase | Notes |
|---|---|---|
| `team_memberships` | 1 | `user_id` → role (`editor`, `reviewer`, `admin`, `worker`). Signing in grants no access by itself. |
| `methodology_versions` | 1 | Seeded `v1-draft`. Snapshots record which version they used. |
| `indicator_definitions` | 1 | The nine stable keys, with group, label and sort order. |
| `institutions` | 1 | `slug`, `ownership`, `institution_type`, `parent_institution_id`, `published_snapshot_id`, `archived_at`. |
| `revisions` | 1 | `status` (draft → submitted → changes_requested / approved → published / superseded / withdrawn), `lock_version`, `base_revision_id`, profile fields, `content_hash`. |
| `revision_indicators` | 1 | `state`, period (`period_type`, `period_label`, `period_start`, `period_end`), optional value (`value_amount numeric`, `value_currency`, `value_scale`, `value_literal`, `value_count integer`), `reason`, `is_public_note`. |
| `evidence_links` | 1 | URL, title, excerpt or locator, document period, captured/reviewed dates, `is_public`. |
| `approvals` | 1 | `revision_id`, `content_hash`, `decided_by`, `decision`, `notes`, `self_review_override_reason`. |
| `published_snapshots` | 1 | Immutable. `payload jsonb` holds identity, indicators, public evidence and summary counts. |
| `audit_events` | 1 | Append-only log of every state change. |
| `assignments` | 1 | Editor, reviewer, due date and timestamps. |
| `source_hosts`, `source_targets`, `source_versions` | 3 | Approved domains, crawl targets and captures. |
| `crawl_jobs`, `crawl_events`, `agent_proposals` | 3 | Durable queue and evidence-linked proposals. |
| `imports`, `import_rows` | 2 | Raw file, hash, staged rows and identity decisions. |

### How the database enforces the rules

- **Freezing.** Triggers reject any change to a revision, or to its indicators and evidence,
  unless its status is `draft` or `changes_requested`. To edit after submission, an editor must
  create a new revision.
- **Exact approval.** `submit_revision` computes a SHA-256 `content_hash` over the profile,
  indicators and evidence. `approve_revision` stores that hash. `publish_revision` recomputes the hash
  and refuses to publish if it differs from the approved one, if the institution's newest published
  snapshot isn't the revision's base, or if anyone but a reviewer/admin calls it.
- **Self-review.** `approve_revision` rejects an approval from the revision's submitter unless an
  admin supplies an override reason, which is recorded in `approvals` and `audit_events`.
- **Optimistic concurrency.** Draft saves go through `save_draft(revision_id, expected_lock_version, …)`.
  A stale version raises `40001 conflict` and the UI shows a reconciliation view.
- **Publication** happens in one function. It inserts the snapshot, repoints
  `institutions.published_snapshot_id`, marks the previous published revision `superseded` and
  writes an audit event, all in one transaction.
- **RLS.** `anon` can select only from `published_snapshots` (and `indicator_definitions`).
  Team tables require an active membership. The `worker` role gets no grant on revisions, approvals
  or snapshots at all.
- **Nulls stay nulls.** Amounts are `numeric` with an explicit `value_scale` (`units`, `thousands`,
  `millions`, `billions`), counts are `integer >= 0`, and no column defaults to 0.

## Page structure

Public (reads `published_snapshots` only):

| Route | Screen |
|---|---|
| `/` | Overview: purpose, coverage, period, published counts |
| `/institutions` | Directory with search, filters, sort, pagination |
| `/institutions/[slug]` | Profile with the nine indicators, evidence, periods, history |
| `/institutions/[slug]/evidence/[evidenceId]` | Evidence detail |
| `/compare?i=a,b,c,d` | Comparison of up to four institutions (Phase 4) |
| `/methodology` | Statuses, applicability, freshness |
| `/export.csv` | Approved public CSV (Phase 4) |

CMS (`/cms`, behind Supabase Auth plus team membership):

| Route | Screen |
|---|---|
| `/cms` | Dashboard |
| `/cms/institutions` | Team directory |
| `/cms/institutions/[id]` | Editor: profile, indicators, evidence, preview, history |
| `/cms/review` | Review queue: diff, approve, return, publish |
| `/cms/research` | Research centre (Phase 3) |
| `/cms/imports` | Import centre (Phase 2) |
| `/cms/sources` | Sources and evidence (Phase 3) |
| `/cms/team` | Team and settings |

The public base path comes from `NEXT_PUBLIC_BASE_PATH` (via `basePath`). That lets the tracker
mount under an existing Athena route once its hosting is known. No subdomain is assumed.

-- Phase 1: data model, editorial workflow and publication.
-- See docs/ARCHITECTURE.md. Additive only; safe on an empty Supabase project.
--
-- Design rules enforced here, not just in the UI:
--   * Team tables are not directly writable by any client role. Every write goes through a
--     SECURITY DEFINER function that checks team membership and workflow state.
--   * Only revisions in 'draft' can change. Submitting freezes the content and records a hash;
--     approval binds to that hash; publishing re-checks it.
--   * Anonymous visitors can read published, non-withdrawn snapshots and nothing else.
--   * Unknown values are NULL. No numeric column defaults to 0.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type team_role as enum ('editor', 'reviewer', 'admin', 'worker');
create type ownership_type as enum ('federal', 'state', 'private', 'unknown');
create type institution_type as enum ('university', 'polytechnic', 'monotechnic', 'college', 'other');
create type revision_status as enum
  ('draft', 'submitted', 'changes_requested', 'approved', 'published', 'superseded', 'withdrawn');
create type assessment_state as enum
  ('published', 'not_found', 'uncertain', 'not_assessed', 'not_applicable');
create type period_type as enum ('financial_year', 'academic_session', 'multi_year', 'unknown');
create type value_scale as enum ('units', 'thousands', 'millions', 'billions');
create type review_decision as enum ('approved', 'changes_requested', 'rejected');

-- ---------------------------------------------------------------------------
-- Team and reference data
-- ---------------------------------------------------------------------------

create table team_memberships (
  user_id      uuid primary key,              -- auth.users.id
  role         team_role not null,
  display_name text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid
);

create table methodology_versions (
  id             text primary key,
  label          text not null,
  effective_from date,
  notes          text,
  created_at     timestamptz not null default now()
);

create table indicator_definitions (
  key         text primary key,
  group_label text not null,
  label       text not null,
  value_kind  text not null check (value_kind in ('money', 'count')),
  sort_order  int  not null unique
);

insert into methodology_versions (id, label, notes) values
  ('v1-draft', 'Initial disclosure methodology (draft)',
   'Counts verified published indicators against applicable indicators. No scores or weights.');

insert into indicator_definitions (key, group_label, label, value_kind, sort_order) values
  ('budget_personnel',       'Annual budgetary allocation', 'Personnel costs',       'money', 1),
  ('budget_overhead',        'Annual budgetary allocation', 'Overhead costs',        'money', 2),
  ('budget_capital',         'Annual budgetary allocation', 'Capital expenditure',   'money', 3),
  ('grants_domestic',        'Research grant revenue',      'Domestic sources',      'money', 4),
  ('grants_international',   'Research grant revenue',      'International sources', 'money', 5),
  ('tetfund_allocation',     'Intervention funding',        'TETFund allocation',    'money', 6),
  ('endowment_fund',         'Endowment',                   'Endowment fund',        'money', 7),
  ('students_undergraduate', 'Student population',          'Undergraduates',        'count', 8),
  ('students_postgraduate',  'Student population',          'Postgraduates',         'count', 9);

-- ---------------------------------------------------------------------------
-- Institutions, revisions, indicators, evidence
-- ---------------------------------------------------------------------------

create table institutions (
  id                         uuid primary key default gen_random_uuid(),
  slug                       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  parent_institution_id      uuid references institutions(id),
  current_published_revision uuid,             -- fk added below
  created_at                 timestamptz not null default now(),
  created_by                 uuid,
  archived_at                timestamptz
);

create table revisions (
  id                     uuid primary key default gen_random_uuid(),
  institution_id         uuid not null references institutions(id),
  revision_number        int  not null,
  base_revision_id       uuid references revisions(id),  -- published revision this draft started from
  previous_revision_id   uuid references revisions(id),  -- revision whose content was copied
  status                 revision_status not null default 'draft',
  lock_version           int  not null default 1,
  review_cycle           int  not null default 0,
  methodology_version_id text not null references methodology_versions(id) default 'v1-draft',
  -- Versioned identity/profile: public pages never join to mutable rows.
  name                   text,
  short_name             text,
  ownership              ownership_type not null default 'unknown',
  institution_type       institution_type not null default 'other',
  state                  text,
  city                   text,
  head_name              text,
  head_title             text,
  bursar_name            text,
  website_url            text check (website_url is null or website_url ~* '^https?://'),
  assessment_period      text,
  legacy_report_status   text,                 -- verbatim from imports; never a finding
  last_verified_at       timestamptz,
  content_hash           text,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  submitted_at           timestamptz,
  submitted_by           uuid,
  unique (institution_id, revision_number)
);

-- One open piece of work per institution; concurrent editors meet on lock_version.
create unique index revisions_one_open_per_institution
  on revisions (institution_id) where status in ('draft', 'submitted', 'approved');

alter table institutions
  add constraint institutions_current_published_fk
  foreign key (current_published_revision) references revisions(id);

create table revision_indicators (
  revision_id    uuid not null references revisions(id) on delete cascade,
  indicator_key  text not null references indicator_definitions(key),
  state          assessment_state not null default 'not_assessed',
  period_type    period_type,
  period_label   text,                         -- e.g. '2024', '2024/2025'
  period_start   date,
  period_end     date,
  value_amount   numeric,                      -- literal amount at value_scale
  value_scale    value_scale,
  value_currency char(3),
  value_count    integer check (value_count is null or value_count >= 0),
  value_literal  text,                         -- exactly as printed in the source
  reason         text,                         -- public explanation
  internal_note  text,                         -- never published
  primary key (revision_id, indicator_key),
  check (period_start is null or period_end is null or period_start <= period_end),
  check (value_amount is null or (value_scale is not null and value_currency is not null)),
  check (state <> 'not_applicable' or nullif(trim(reason), '') is not null)
);

create table evidence_links (
  id                   uuid primary key default gen_random_uuid(),
  revision_id          uuid not null references revisions(id) on delete cascade,
  indicator_key        text references indicator_definitions(key),   -- null = general profile evidence
  url                  text not null check (url ~* '^https?://'),
  title                text,
  excerpt              text,
  locator              text,                   -- page, table or section reference
  document_period      text,
  source_published_on  date,                   -- only when the source states it
  captured_at          timestamptz,
  is_public            boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid
);

-- ---------------------------------------------------------------------------
-- Review, publication, assignments, audit
-- ---------------------------------------------------------------------------

create table approvals (
  id                          uuid primary key default gen_random_uuid(),
  revision_id                 uuid not null references revisions(id),
  content_hash                text not null,
  decision                    review_decision not null,
  decided_by                  uuid not null,
  decided_at                  timestamptz not null default now(),
  notes                       text,
  self_review_override_reason text
);

create table published_snapshots (
  id                     uuid primary key default gen_random_uuid(),
  institution_id         uuid not null references institutions(id),
  revision_id            uuid not null unique references revisions(id),
  approval_id            uuid not null references approvals(id),
  release_number         int  not null,
  slug                   text not null,
  methodology_version_id text not null references methodology_versions(id),
  payload                jsonb not null,
  is_current             boolean not null default false,
  published_by           uuid not null,
  published_at           timestamptz not null default now(),
  withdrawn_at           timestamptz,
  withdrawn_by           uuid,
  withdrawn_reason       text,
  unique (institution_id, release_number)
);

create unique index published_snapshots_one_current
  on published_snapshots (institution_id) where is_current;

create table assignments (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id),
  editor_id      uuid,
  reviewer_id    uuid,
  due_on         date,
  assigned_at    timestamptz not null default now(),
  assigned_by    uuid,
  closed_at      timestamptz
);

create table audit_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  details     jsonb not null default '{}'
);

-- ---------------------------------------------------------------------------
-- Immutability triggers (defence in depth beneath the functions)
-- ---------------------------------------------------------------------------

create function guard_revision_update() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (
       new.name, new.short_name, new.ownership, new.institution_type, new.state, new.city,
       new.head_name, new.head_title, new.bursar_name, new.website_url, new.assessment_period,
       new.legacy_report_status, new.last_verified_at, new.methodology_version_id,
       new.institution_id, new.base_revision_id, new.content_hash
     ) is distinct from (
       old.name, old.short_name, old.ownership, old.institution_type, old.state, old.city,
       old.head_name, old.head_title, old.bursar_name, old.website_url, old.assessment_period,
       old.legacy_report_status, old.last_verified_at, old.methodology_version_id,
       old.institution_id, old.base_revision_id, old.content_hash
     ) then
    raise exception 'revision % is %; create a new revision to change it', old.id, old.status
      using errcode = '55000';
  end if;
  return new;
end $$;

create trigger revisions_guard before update on revisions
  for each row execute function guard_revision_update();

create function guard_revision_children() returns trigger language plpgsql as $$
declare
  s revision_status;
begin
  select status into s from revisions
   where id = coalesce(new.revision_id, old.revision_id);
  if s is distinct from 'draft' then
    raise exception 'revision is %; its indicators and evidence are frozen', s
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;

create trigger revision_indicators_guard before insert or update or delete on revision_indicators
  for each row execute function guard_revision_children();
create trigger evidence_links_guard before insert or update or delete on evidence_links
  for each row execute function guard_revision_children();

create function guard_snapshot_update() returns trigger language plpgsql as $$
begin
  if (new.institution_id, new.revision_id, new.approval_id, new.release_number, new.slug,
      new.methodology_version_id, new.payload, new.published_by, new.published_at)
     is distinct from
     (old.institution_id, old.revision_id, old.approval_id, old.release_number, old.slug,
      old.methodology_version_id, old.payload, old.published_by, old.published_at) then
    raise exception 'published snapshots are immutable' using errcode = '55000';
  end if;
  return new;
end $$;

create trigger published_snapshots_guard before update on published_snapshots
  for each row execute function guard_snapshot_update();

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end $$;

create trigger published_snapshots_no_delete before delete on published_snapshots
  for each row execute function forbid_change();
create trigger approvals_append_only before update or delete on approvals
  for each row execute function forbid_change();
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function current_team_role() returns team_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from team_memberships where user_id = nut_auth.uid() and active
$$;

create function require_role(variadic allowed team_role[]) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r team_role := current_team_role();
begin
  if nut_auth.uid() is null or r is null or not (r = any (allowed)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return nut_auth.uid();
end $$;

create function audit(p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into audit_events (actor_id, action, entity_type, entity_id, details)
  values (nut_auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'))
$$;

-- Canonical content of a revision. p_public = true drops internal notes and private evidence.
create function revision_content(p_revision uuid, p_public boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'name', r.name, 'short_name', r.short_name, 'ownership', r.ownership,
      'institution_type', r.institution_type, 'state', r.state, 'city', r.city,
      'head_name', r.head_name, 'head_title', r.head_title, 'bursar_name', r.bursar_name,
      'website_url', r.website_url, 'assessment_period', r.assessment_period,
      'methodology_version_id', r.methodology_version_id,
      'last_verified_at', r.last_verified_at),
    'indicators', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', d.key, 'group', d.group_label, 'label', d.label, 'state', ri.state,
          'period_type', ri.period_type, 'period_label', ri.period_label,
          'period_start', ri.period_start, 'period_end', ri.period_end,
          'value_amount', ri.value_amount, 'value_scale', ri.value_scale,
          'value_currency', ri.value_currency, 'value_count', ri.value_count,
          'value_literal', ri.value_literal, 'reason', ri.reason,
          'internal_note', case when p_public then null else ri.internal_note end,
          'evidence', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', e.id, 'url', e.url, 'title', e.title, 'excerpt', e.excerpt,
                     'locator', e.locator, 'document_period', e.document_period,
                     'source_published_on', e.source_published_on,
                     'captured_at', e.captured_at, 'is_public', e.is_public)
                   order by e.created_at, e.id)
              from evidence_links e
             where e.revision_id = r.id and e.indicator_key = d.key
               and (not p_public or e.is_public)), '[]'::jsonb))
        order by d.sort_order)
        from indicator_definitions d
        join revision_indicators ri on ri.indicator_key = d.key and ri.revision_id = r.id),
      '[]'::jsonb),
    'profile_evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'url', e.url, 'title', e.title, 'excerpt', e.excerpt,
               'locator', e.locator, 'captured_at', e.captured_at)
             order by e.created_at, e.id)
        from evidence_links e
       where e.revision_id = r.id and e.indicator_key is null
         and (not p_public or e.is_public)), '[]'::jsonb))
  from revisions r where r.id = p_revision
$$;

create function revision_hash(p_revision uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(revision_content(p_revision, false)::text, 'UTF8')), 'hex')
$$;

-- Descriptive counts only; no score, no ranking.
create function revision_summary(p_revision uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (
    select count(*) filter (where state = 'published')        as published,
           count(*) filter (where state <> 'not_applicable')  as applicable,
           count(*) filter (where state not in ('not_assessed', 'not_applicable')) as assessed,
           count(*) filter (where state = 'not_applicable')   as excluded,
           count(*) filter (where state = 'not_assessed')     as not_assessed,
           count(*) filter (where state = 'uncertain')        as uncertain,
           count(*)                                           as total
      from revision_indicators where revision_id = p_revision)
  select jsonb_build_object(
    'published', published, 'applicable', applicable, 'assessed', assessed,
    'excluded', excluded, 'uncertain', uncertain, 'total', total,
    'label', case
      when assessed = 0 and excluded = 0 then 'not_assessed'
      when not_assessed > 0              then 'assessment_incomplete'
      when uncertain > 0                 then 'evidence_uncertain'
      when applicable > 0 and published = applicable then 'all_applicable_published'
      when published = 0                 then 'no_disclosures_found'
      else 'partial_disclosure' end)
  from c
$$;

create function assert_draft(p_revision uuid, p_expected_lock int) returns revisions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r revisions;
begin
  select * into r from revisions where id = p_revision for update;
  if not found then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  if r.status <> 'draft' then
    raise exception 'revision is %; create a new revision to change it', r.status using errcode = '55000';
  end if;
  if r.lock_version <> p_expected_lock then
    raise exception 'conflict: revision was changed by someone else (now version %)', r.lock_version
      using errcode = '40001';
  end if;
  return r;
end $$;

create function bump_lock(p_revision uuid) returns int
language sql security definer set search_path = public, pg_temp as $$
  update revisions set lock_version = lock_version + 1, updated_at = now(), updated_by = nut_auth.uid()
   where id = p_revision returning lock_version
$$;

-- ---------------------------------------------------------------------------
-- Workflow API (the only write path for clients)
-- ---------------------------------------------------------------------------

create function create_institution(p_slug text, p_name text,
                                   p_ownership ownership_type default 'unknown',
                                   p_type institution_type default 'other')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
  inst uuid;
  rev uuid;
begin
  insert into institutions (slug, created_by) values (p_slug, uid) returning id into inst;
  insert into revisions (institution_id, revision_number, name, ownership, institution_type,
                         created_by, updated_by)
  values (inst, 1, p_name, p_ownership, p_type, uid, uid) returning id into rev;
  insert into revision_indicators (revision_id, indicator_key)
    select rev, key from indicator_definitions;
  perform audit('institution.created', 'institution', inst, jsonb_build_object('revision_id', rev));
  return rev;
end $$;

-- New draft copied from the latest revision. Base = what is currently published.
create function create_revision(p_institution uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := require_role('editor', 'reviewer', 'admin');
  prev revisions;
  inst institutions;
  rev  uuid;
begin
  select * into inst from institutions where id = p_institution for update;
  if not found then raise exception 'institution not found' using errcode = 'P0002'; end if;
  select * into prev from revisions where institution_id = p_institution
   order by revision_number desc limit 1;
  if prev.status in ('draft', 'submitted', 'approved') then
    raise exception 'an open revision (%) already exists', prev.status using errcode = '55000';
  end if;
  insert into revisions (institution_id, revision_number, base_revision_id, previous_revision_id,
    review_cycle, methodology_version_id, name, short_name, ownership, institution_type, state,
    city, head_name, head_title, bursar_name, website_url, assessment_period,
    legacy_report_status, last_verified_at, created_by, updated_by)
  values (p_institution, prev.revision_number + 1, inst.current_published_revision, prev.id,
    case when prev.status = 'changes_requested' then prev.review_cycle + 1 else 0 end,
    prev.methodology_version_id, prev.name, prev.short_name, prev.ownership,
    prev.institution_type, prev.state, prev.city, prev.head_name, prev.head_title,
    prev.bursar_name, prev.website_url, prev.assessment_period, prev.legacy_report_status,
    prev.last_verified_at, uid, uid)
  returning id into rev;
  insert into revision_indicators (revision_id, indicator_key, state, period_type, period_label,
    period_start, period_end, value_amount, value_scale, value_currency, value_count,
    value_literal, reason, internal_note)
  select rev, indicator_key, state, period_type, period_label, period_start, period_end,
         value_amount, value_scale, value_currency, value_count, value_literal, reason, internal_note
    from revision_indicators where revision_id = prev.id;
  insert into evidence_links (revision_id, indicator_key, url, title, excerpt, locator,
    document_period, source_published_on, captured_at, is_public, created_by)
  select rev, indicator_key, url, title, excerpt, locator, document_period,
         source_published_on, captured_at, is_public, created_by
    from evidence_links where revision_id = prev.id;
  perform audit('revision.created', 'revision', rev, jsonb_build_object('from', prev.id));
  return rev;
end $$;

create function save_profile(p_revision uuid, p_expected_lock int, p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
begin
  perform assert_draft(p_revision, p_expected_lock);
  update revisions set
    name              = case when p ? 'name'              then p->>'name'              else name end,
    short_name        = case when p ? 'short_name'        then p->>'short_name'        else short_name end,
    ownership         = case when p ? 'ownership'         then (p->>'ownership')::ownership_type else ownership end,
    institution_type  = case when p ? 'institution_type'  then (p->>'institution_type')::institution_type else institution_type end,
    state             = case when p ? 'state'             then p->>'state'             else state end,
    city              = case when p ? 'city'              then p->>'city'              else city end,
    head_name         = case when p ? 'head_name'         then p->>'head_name'         else head_name end,
    head_title        = case when p ? 'head_title'        then p->>'head_title'        else head_title end,
    bursar_name       = case when p ? 'bursar_name'       then p->>'bursar_name'       else bursar_name end,
    website_url       = case when p ? 'website_url'       then p->>'website_url'       else website_url end,
    assessment_period = case when p ? 'assessment_period' then p->>'assessment_period' else assessment_period end
  where id = p_revision;
  perform audit('revision.profile_saved', 'revision', p_revision, p);
  return bump_lock(p_revision);
end $$;

create function save_indicator(p_revision uuid, p_expected_lock int, p_key text, p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
begin
  perform assert_draft(p_revision, p_expected_lock);
  update revision_indicators set
    state          = case when p ? 'state'          then (p->>'state')::assessment_state else state end,
    period_type    = case when p ? 'period_type'    then (p->>'period_type')::period_type else period_type end,
    period_label   = case when p ? 'period_label'   then p->>'period_label'   else period_label end,
    period_start   = case when p ? 'period_start'   then (p->>'period_start')::date else period_start end,
    period_end     = case when p ? 'period_end'     then (p->>'period_end')::date   else period_end end,
    value_amount   = case when p ? 'value_amount'   then (p->>'value_amount')::numeric else value_amount end,
    value_scale    = case when p ? 'value_scale'    then (p->>'value_scale')::value_scale else value_scale end,
    value_currency = case when p ? 'value_currency' then p->>'value_currency' else value_currency end,
    value_count    = case when p ? 'value_count'    then (p->>'value_count')::integer else value_count end,
    value_literal  = case when p ? 'value_literal'  then p->>'value_literal'  else value_literal end,
    reason         = case when p ? 'reason'         then p->>'reason'         else reason end,
    internal_note  = case when p ? 'internal_note'  then p->>'internal_note'  else internal_note end
  where revision_id = p_revision and indicator_key = p_key;
  if not found then raise exception 'unknown indicator %', p_key using errcode = '22023'; end if;
  perform audit('revision.indicator_saved', 'revision', p_revision,
                jsonb_build_object('indicator', p_key) || p);
  return bump_lock(p_revision);
end $$;

create function add_evidence(p_revision uuid, p_expected_lock int, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
  eid uuid;
begin
  perform assert_draft(p_revision, p_expected_lock);
  insert into evidence_links (revision_id, indicator_key, url, title, excerpt, locator,
    document_period, source_published_on, captured_at, is_public, created_by)
  values (p_revision, p->>'indicator_key', p->>'url', p->>'title', p->>'excerpt', p->>'locator',
    p->>'document_period', (p->>'source_published_on')::date, (p->>'captured_at')::timestamptz,
    coalesce((p->>'is_public')::boolean, true), uid)
  returning id into eid;
  perform bump_lock(p_revision);
  perform audit('revision.evidence_added', 'revision', p_revision, jsonb_build_object('evidence_id', eid));
  return eid;
end $$;

create function remove_evidence(p_revision uuid, p_expected_lock int, p_evidence uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
begin
  perform assert_draft(p_revision, p_expected_lock);
  delete from evidence_links where id = p_evidence and revision_id = p_revision;
  perform audit('revision.evidence_removed', 'revision', p_revision, jsonb_build_object('evidence_id', p_evidence));
  return bump_lock(p_revision);
end $$;

create function submit_revision(p_revision uuid, p_expected_lock int) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
  r   revisions := assert_draft(p_revision, p_expected_lock);
  bad text;
  h   text;
begin
  if nullif(trim(r.name), '') is null then
    raise exception 'an institution name is required' using errcode = '23514';
  end if;
  select string_agg(ri.indicator_key, ', ') into bad
    from revision_indicators ri
   where ri.revision_id = p_revision and ri.state = 'published'
     and (ri.period_label is null or ri.period_type is null
          or not exists (select 1 from evidence_links e
                          where e.revision_id = p_revision and e.indicator_key = ri.indicator_key
                            and nullif(trim(coalesce(e.locator, e.excerpt, '')), '') is not null));
  if bad is not null then
    raise exception 'published indicators need a reporting period and evidence with a locator or excerpt: %', bad
      using errcode = '23514';
  end if;
  h := revision_hash(p_revision);
  update revisions set status = 'submitted', content_hash = h,
         submitted_at = now(), submitted_by = uid, lock_version = lock_version + 1
   where id = p_revision;
  perform audit('revision.submitted', 'revision', p_revision, jsonb_build_object('content_hash', h));
  return h;
end $$;

create function review_revision(p_revision uuid, p_decision review_decision, p_notes text default null,
                                p_self_review_override_reason text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('reviewer', 'admin');
  r   revisions;
  aid uuid;
begin
  select * into r from revisions where id = p_revision for update;
  if not found or r.status <> 'submitted' then
    raise exception 'only submitted revisions can be reviewed' using errcode = '55000';
  end if;
  if revision_hash(p_revision) <> r.content_hash then
    raise exception 'revision content changed after submission' using errcode = '55000';
  end if;
  if r.submitted_by = uid then
    if current_team_role() <> 'admin' or nullif(trim(p_self_review_override_reason), '') is null then
      raise exception 'you cannot review your own submission' using errcode = '42501';
    end if;
  end if;
  if p_decision <> 'approved' and nullif(trim(p_notes), '') is null then
    raise exception 'a reason is required when returning or rejecting' using errcode = '23514';
  end if;
  insert into approvals (revision_id, content_hash, decision, decided_by, notes, self_review_override_reason)
  values (p_revision, r.content_hash, p_decision, uid, p_notes,
          case when r.submitted_by = uid then p_self_review_override_reason end)
  returning id into aid;
  update revisions set status = case p_decision when 'approved' then 'approved'::revision_status
                                                else 'changes_requested'::revision_status end
   where id = p_revision;
  perform audit('revision.reviewed', 'revision', p_revision,
                jsonb_build_object('decision', p_decision, 'approval_id', aid,
                                   'self_review_override', r.submitted_by = uid));
  return aid;
end $$;

create function publish_revision(p_revision uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := require_role('reviewer', 'admin');
  r    revisions;
  inst institutions;
  a    approvals;
  sid  uuid;
  rel  int;
begin
  select * into r from revisions where id = p_revision for update;
  if not found or r.status <> 'approved' then
    raise exception 'only approved revisions can be published' using errcode = '55000';
  end if;
  select * into inst from institutions where id = r.institution_id for update;
  select * into a from approvals where revision_id = p_revision
   order by decided_at desc, id desc limit 1;
  if a.decision is distinct from 'approved' or a.content_hash <> r.content_hash
     or revision_hash(p_revision) <> a.content_hash then
    raise exception 'approval does not match this exact revision content' using errcode = '55000';
  end if;
  if r.base_revision_id is distinct from inst.current_published_revision then
    raise exception 'conflict: another version was published since this draft started'
      using errcode = '40001';
  end if;

  select coalesce(max(release_number), 0) + 1 into rel
    from published_snapshots where institution_id = inst.id;
  update published_snapshots set is_current = false where institution_id = inst.id and is_current;
  insert into published_snapshots (institution_id, revision_id, approval_id, release_number, slug,
    methodology_version_id, payload, is_current, published_by)
  values (inst.id, p_revision, a.id, rel, inst.slug, r.methodology_version_id,
    revision_content(p_revision, true)
      || jsonb_build_object('summary', revision_summary(p_revision),
                            'parent_institution_id', inst.parent_institution_id),
    true, uid)
  returning id into sid;

  update revisions set status = 'superseded' where id = inst.current_published_revision;
  update revisions set status = 'published' where id = p_revision;
  update institutions set current_published_revision = p_revision where id = inst.id;
  perform audit('revision.published', 'revision', p_revision,
                jsonb_build_object('snapshot_id', sid, 'release_number', rel, 'approval_id', a.id));
  return sid;
end $$;

create function withdraw_publication(p_institution uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('reviewer', 'admin');
  s   published_snapshots;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'a reason is required' using errcode = '23514';
  end if;
  select * into s from published_snapshots where institution_id = p_institution and is_current for update;
  if not found then raise exception 'nothing is published' using errcode = 'P0002'; end if;
  update published_snapshots set is_current = false, withdrawn_at = now(), withdrawn_by = uid,
         withdrawn_reason = p_reason where id = s.id;
  update revisions set status = 'withdrawn' where id = s.revision_id;
  update institutions set current_published_revision = null where id = p_institution;
  perform audit('publication.withdrawn', 'institution', p_institution,
                jsonb_build_object('snapshot_id', s.id, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------

-- Start from no table, sequence or function rights for the request roles; grant only what is needed.
revoke all on all tables in schema public from nut_anon, nut_member;
revoke all on all sequences in schema public from nut_anon, nut_member;
revoke execute on all functions in schema public from public, nut_anon, nut_member;

alter table team_memberships     enable row level security;
alter table methodology_versions enable row level security;
alter table indicator_definitions enable row level security;
alter table institutions         enable row level security;
alter table revisions            enable row level security;
alter table revision_indicators  enable row level security;
alter table evidence_links       enable row level security;
alter table approvals            enable row level security;
alter table published_snapshots  enable row level security;
alter table assignments          enable row level security;
alter table audit_events         enable row level security;

-- Public reference data and published releases.
grant select on indicator_definitions, methodology_versions, published_snapshots to nut_anon, nut_member;
create policy public_read on indicator_definitions for select to nut_anon, nut_member using (true);
create policy public_read on methodology_versions for select to nut_anon, nut_member using (true);
create policy public_read on published_snapshots for select to nut_anon, nut_member
  using (withdrawn_at is null);
create policy team_read_withdrawn on published_snapshots for select to nut_member
  using (current_team_role() in ('editor', 'reviewer', 'admin'));

-- Team read access. The worker role gets nothing here in Phase 1.
grant select on team_memberships, institutions, revisions, revision_indicators, evidence_links,
               approvals, assignments, audit_events to nut_member;
create policy own_membership on team_memberships for select to nut_member
  using (user_id = nut_auth.uid() or current_team_role() = 'admin');
create policy team_read on institutions        for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on revisions           for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on revision_indicators for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on evidence_links      for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on approvals           for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on assignments         for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy admin_read on audit_events       for select to nut_member using (current_team_role() in ('reviewer', 'admin'));

-- Workflow functions are callable by signed-in users; each checks the caller's team role.
grant execute on function
  current_team_role(), create_institution(text, text, ownership_type, institution_type),
  create_revision(uuid), save_profile(uuid, int, jsonb), save_indicator(uuid, int, text, jsonb),
  add_evidence(uuid, int, jsonb), remove_evidence(uuid, int, uuid), submit_revision(uuid, int),
  review_revision(uuid, review_decision, text, text), publish_revision(uuid),
  withdraw_publication(uuid, text)
to nut_member;

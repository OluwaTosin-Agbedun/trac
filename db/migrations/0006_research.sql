-- Phase 3: research assistant.
--
-- The assistant is a separate worker process. It runs as its own NOLOGIN role, nut_worker, which
-- has no table privileges at all: it can only call the worker_* functions below, which let it
-- claim a queued scan, record what it fetched and add proposals. It cannot read drafts, publish,
-- approve, change roles or touch snapshots, even by calling those functions directly.
--
-- Proposals are never findings. An editor accepts one into a private draft (field by field); the
-- normal review and publication workflow is the only route to the public site.
--
-- Production login role for the worker (run once per branch as the owner; never grant it to the
-- web app's login role):
--   create role nut_worker_app login password '<random>' noinherit;
--   grant nut_worker to nut_worker_app;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nut_worker') then
    create role nut_worker nologin;
  end if;
end $$;
grant nut_worker to current_user;
grant usage on schema public to nut_worker;
grant usage on schema nut_auth to nut_worker;

create type crawl_status as enum
  ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'configuration_required');
create type proposal_status as enum ('pending', 'accepted', 'rejected', 'stale');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Official websites a human approved for an institution. Search may suggest hosts; only an
-- administrator's approval lets the worker fetch from one. Subdomains of an approved host count.
create table source_hosts (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id),
  host           text not null check (
                   host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
                   and host !~ '^[0-9.]+$' and length(host) <= 253),
  approved       boolean not null default false,
  note           text check (note is null or length(note) <= 500),
  created_at     timestamptz not null default now(),
  created_by     uuid,
  decided_at     timestamptz,
  decided_by     uuid,
  unique (institution_id, host)
);

create table crawl_jobs (
  id                   uuid primary key default gen_random_uuid(),
  institution_id       uuid not null references institutions(id),
  status               crawl_status not null default 'queued',
  start_urls           text[] not null default '{}',
  page_budget          int not null default 25 check (page_budget between 1 and 100),
  doc_budget           int not null default 10 check (doc_budget between 0 and 50),
  -- What the team had when the scan was requested: proposals are compared against it so a newer
  -- manual edit is never overwritten.
  base_revision_id     uuid references revisions(id),   -- published at request time
  draft_revision_id    uuid references revisions(id),   -- open draft at request time, if any
  baseline             jsonb not null default '{}',
  requested_at         timestamptz not null default now(),
  requested_by         uuid not null,
  lease_owner          text,
  lease_expires_at     timestamptz,
  attempts             int not null default 0,
  started_at           timestamptz,
  finished_at          timestamptz,
  cancel_requested_at  timestamptz,
  cancel_requested_by  uuid,
  coverage             jsonb not null default '{}',
  usage                jsonb not null default '{}',
  error                text
);

-- One queued or running scan per institution.
create unique index crawl_jobs_one_active on crawl_jobs (institution_id) where status in ('queued', 'running');

create table crawl_events (
  id      bigint generated always as identity primary key,
  job_id  uuid not null references crawl_jobs(id),
  at      timestamptz not null default now(),
  level   text not null check (level in ('info', 'warn', 'error')),
  message text not null check (length(message) <= 500),
  details jsonb not null default '{}'
);

-- What the worker fetched, exactly as captured. Text is extracted, bounded and stored as data; it is
-- never rendered as HTML.
create table source_versions (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references crawl_jobs(id),
  institution_id  uuid not null references institutions(id),
  requested_url   text not null check (requested_url ~* '^https?://' and length(requested_url) <= 2000),
  final_url       text not null check (final_url ~* '^https?://' and length(final_url) <= 2000),
  fetched_at      timestamptz not null default now(),
  http_status     int not null check (http_status between 100 and 599),
  content_type    text check (content_type is null or length(content_type) <= 100),
  content_hash    text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  byte_length     int not null check (byte_length >= 0),
  title           text check (title is null or length(title) <= 300),
  text_content    text not null default '' check (length(text_content) <= 400000),
  truncated       boolean not null default false,
  extraction_note text check (extraction_note is null or length(extraction_note) <= 500)
);
create index source_versions_lookup on source_versions (institution_id, final_url, content_hash);

create table agent_proposals (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references crawl_jobs(id),
  institution_id       uuid not null references institutions(id),
  base_revision_id     uuid references revisions(id),
  field_key            text not null,
  field_kind           text not null check (field_kind in ('indicator', 'profile')),
  existing_value       jsonb,                    -- from the job baseline, set by the server
  proposed             jsonb not null,
  candidate_state      assessment_state check (candidate_state is null or candidate_state in ('published', 'uncertain')),
  source_version_id    uuid not null references source_versions(id),
  excerpt              text not null check (length(excerpt) between 12 and 1000),
  locator              text check (locator is null or length(locator) <= 300),
  extraction_method    text not null default 'html_text' check (length(extraction_method) <= 40),
  uncertainty          text[] not null default '{}',
  confidence           text check (confidence is null or confidence in ('low', 'medium', 'high')),
  status               proposal_status not null default 'pending',
  created_at           timestamptz not null default now(),
  decided_at           timestamptz,
  decided_by           uuid,
  decision_note        text check (decision_note is null or length(decision_note) <= 1000),
  accepted_value       jsonb,                    -- what the editor actually accepted, if edited
  accepted_revision_id uuid references revisions(id),
  check ((field_kind = 'indicator') = (candidate_state is not null))
);
create index agent_proposals_open on agent_proposals (institution_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function url_host(p_url text) returns text language sql immutable as $$
  select case when p_url ~* '^https?://[^/?#@]+([/?#]|$)'
              then rtrim(lower(substring(p_url from '^[A-Za-z]+://([^/?#:@]+)')), '.') end
$$;

create function host_is_approved(p_institution uuid, p_host text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_host is not null and exists (
    select 1 from source_hosts h
     where h.institution_id = p_institution and h.approved
       and (p_host = h.host or right(p_host, length(h.host) + 1) = '.' || h.host))
$$;

create function url_is_approved(p_institution uuid, p_url text) returns boolean
language sql stable as $$
  select p_url ~* '^https?://' and length(p_url) <= 2000 and host_is_approved(p_institution, url_host(p_url))
$$;

-- The comparable value of every field the assistant may propose, for one revision. No notes.
create function proposable_values(p_revision uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select jsonb_object_agg(ri.indicator_key, jsonb_build_object(
             'state', ri.state, 'period_type', ri.period_type, 'period_label', ri.period_label,
             'value_amount', ri.value_amount, 'value_scale', ri.value_scale,
             'value_currency', ri.value_currency, 'value_count', ri.value_count,
             'value_literal', ri.value_literal))
      from revision_indicators ri where ri.revision_id = p_revision), '{}'::jsonb)
  || coalesce((
    select jsonb_build_object(
             'head_name', jsonb_build_object('value', r.head_name),
             'head_title', jsonb_build_object('value', r.head_title),
             'bursar_name', jsonb_build_object('value', r.bursar_name))
      from revisions r where r.id = p_revision), '{}'::jsonb)
$$;

create function norm_text(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(lower(coalesce(t, '')), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Team functions (signed-in members; each checks the caller's role)
-- ---------------------------------------------------------------------------

-- Editors and reviewers suggest a host; an administrator's suggestion is approved immediately.
create function add_source_host(p_institution uuid, p_host text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := require_role('editor', 'reviewer', 'admin');
  h    text := rtrim(lower(btrim(coalesce(p_host, ''))), '.');
  id_  uuid;
  adm  boolean := current_team_role() = 'admin';
begin
  if not exists (select 1 from institutions where id = p_institution and archived_at is null) then
    raise exception 'institution not found' using errcode = 'P0002';
  end if;
  if h ~* '^https?://' then h := url_host(h); end if;
  if h is null or h = 'localhost' or h like '%.localhost' or h like '%.local' or h like '%.internal' then
    raise exception 'enter a public website address such as unilag.edu.ng' using errcode = '22023';
  end if;
  select id into id_ from source_hosts where institution_id = p_institution and host = h;
  if found then return id_; end if;
  insert into source_hosts (institution_id, host, approved, note, created_by, decided_at, decided_by)
  values (p_institution, h, adm, nullif(btrim(p_note), ''), uid,
          case when adm then now() end, case when adm then uid end)
  returning id into id_;
  perform audit(case when adm then 'source_host.approved' else 'source_host.suggested' end,
                'institution', p_institution, jsonb_build_object('host', h, 'source_host_id', id_));
  return id_;
end $$;

create function decide_source_host(p_host uuid, p_approved boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
  h   source_hosts;
begin
  update source_hosts set approved = p_approved, decided_at = now(), decided_by = uid
   where id = p_host returning * into h;
  if not found then raise exception 'source host not found' using errcode = 'P0002'; end if;
  perform audit(case when p_approved then 'source_host.approved' else 'source_host.revoked' end,
                'institution', h.institution_id, jsonb_build_object('host', h.host, 'source_host_id', h.id));
end $$;

create function request_scan(p_institution uuid, p_start_urls text[] default '{}') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('editor', 'reviewer', 'admin');
  inst   institutions;
  latest uuid;
  draft  uuid;
  job    uuid;
  u      text;
  urls   text[] := coalesce(p_start_urls, '{}');
begin
  select * into inst from institutions where id = p_institution and archived_at is null for update;
  if not found then raise exception 'institution not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from source_hosts where institution_id = p_institution and approved) then
    raise exception 'needs source confirmation: an administrator must approve an official website for this institution first'
      using errcode = '55000';
  end if;
  if cardinality(urls) > 10 then
    raise exception 'add at most 10 starting pages' using errcode = '22023';
  end if;
  foreach u in array urls loop
    if not url_is_approved(p_institution, u) then
      raise exception 'starting page % is not on an approved website for this institution', left(u, 120)
        using errcode = '22023';
    end if;
  end loop;
  select id into job from crawl_jobs where institution_id = p_institution and status in ('queued', 'running');
  if found then return job; end if;  -- one active scan per institution
  select id into latest from revisions where institution_id = p_institution order by revision_number desc limit 1;
  select id into draft from revisions where institution_id = p_institution and status = 'draft';
  insert into crawl_jobs (institution_id, start_urls, base_revision_id, draft_revision_id, baseline, requested_by)
  values (p_institution, urls, inst.current_published_revision, draft,
          case when latest is null then '{}'::jsonb else proposable_values(latest) end, uid)
  returning id into job;
  perform audit('scan.requested', 'crawl_job', job, jsonb_build_object('institution_id', p_institution));
  return job;
end $$;

create function cancel_scan(p_job uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
  j   crawl_jobs;
begin
  select * into j from crawl_jobs where id = p_job for update;
  if not found then raise exception 'scan not found' using errcode = 'P0002'; end if;
  if j.status = 'queued' then
    update crawl_jobs set status = 'cancelled', finished_at = now(), cancel_requested_at = now(),
           cancel_requested_by = uid where id = p_job;
  elsif j.status = 'running' then
    update crawl_jobs set cancel_requested_at = now(), cancel_requested_by = uid where id = p_job;
  else
    raise exception 'this scan has already finished' using errcode = '55000';
  end if;
  perform audit('scan.cancel_requested', 'crawl_job', p_job, '{}');
end $$;

-- Accept one proposal into the institution's open draft. Returns {"lock_version": n} on success, or
-- {"stale": true} when the field changed after the scan started (the proposal is then marked stale
-- and nothing is written). p_edit, when given, replaces the proposed values; a reason is required.
create function accept_proposal(p_proposal uuid, p_revision uuid, p_expected_lock int,
                                p_edit jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid   uuid := require_role('editor', 'reviewer', 'admin');
  pr    agent_proposals;
  rev   revisions;
  sv    source_versions;
  vals  jsonb;
  p     jsonb;
  lock_ int;
  note  text := nullif(btrim(coalesce(p_note, '')), '');
  allowed constant text[] := array['state', 'period_type', 'period_label', 'value_amount', 'value_scale',
                                   'value_currency', 'value_count', 'value_literal'];
begin
  select * into pr from agent_proposals where id = p_proposal for update;
  if not found then raise exception 'proposal not found' using errcode = 'P0002'; end if;
  if pr.status <> 'pending' then
    raise exception 'this proposal was already %', pr.status using errcode = '55000';
  end if;
  rev := assert_draft(p_revision, p_expected_lock);
  if rev.institution_id <> pr.institution_id then
    raise exception 'that draft belongs to a different institution' using errcode = '22023';
  end if;
  if p_edit is not null and note is null then
    raise exception 'give a reason when you change a proposed value' using errcode = '22023';
  end if;
  -- Never overwrite a newer manual edit: the field must still hold what it held when the scan began.
  vals := proposable_values(p_revision);
  if (vals -> pr.field_key) is distinct from pr.existing_value then
    update agent_proposals set status = 'stale', decided_at = now(), decided_by = uid,
           decision_note = 'The field changed after the scan started.' where id = pr.id;
    perform audit('proposal.stale', 'proposal', pr.id, jsonb_build_object('revision_id', p_revision));
    return jsonb_build_object('stale', true);
  end if;
  select * into sv from source_versions where id = pr.source_version_id;
  if pr.field_kind = 'indicator' then
    -- Every value field is written (null when absent), so no figure from an earlier release survives
    -- beside the new evidence.
    select jsonb_object_agg(k, coalesce(coalesce(p_edit, pr.proposed) -> k, 'null'::jsonb)) into p
      from unnest(allowed) as k;
    if (p->>'state') is null or (p->>'state') not in ('published', 'uncertain') then
      p := p || jsonb_build_object('state', pr.candidate_state);
    end if;
    lock_ := save_indicator(p_revision, p_expected_lock, pr.field_key, p);
  else
    p := jsonb_build_object(pr.field_key, coalesce(p_edit, pr.proposed) ->> 'value');
    lock_ := save_profile(p_revision, p_expected_lock, p);
  end if;
  perform add_evidence(p_revision, lock_, jsonb_build_object(
    'indicator_key', case when pr.field_kind = 'indicator' then pr.field_key end,
    'url', sv.final_url, 'title', sv.title, 'excerpt', pr.excerpt, 'locator', pr.locator,
    'document_period', pr.proposed ->> 'period_label', 'captured_at', sv.fetched_at, 'is_public', true));
  update agent_proposals set status = 'accepted', decided_at = now(), decided_by = uid, decision_note = note,
         accepted_value = case when p_edit is not null then p end, accepted_revision_id = p_revision
   where id = pr.id;
  perform audit('proposal.accepted', 'proposal', pr.id,
                jsonb_build_object('revision_id', p_revision, 'edited', p_edit is not null));
  select lock_version into lock_ from revisions where id = p_revision;
  return jsonb_build_object('lock_version', lock_);
end $$;

create function reject_proposal(p_proposal uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := require_role('editor', 'reviewer', 'admin');
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if note is null or length(note) > 1000 then
    raise exception 'give a short reason for rejecting this proposal' using errcode = '22023';
  end if;
  update agent_proposals set status = 'rejected', decided_at = now(), decided_by = uid, decision_note = note
   where id = p_proposal and status = 'pending';
  if not found then raise exception 'this proposal is no longer pending' using errcode = '55000'; end if;
  perform audit('proposal.rejected', 'proposal', p_proposal, '{}');
end $$;

-- ---------------------------------------------------------------------------
-- Worker functions (nut_worker only). A worker identifies itself with a lease token.
-- ---------------------------------------------------------------------------

create function worker_job(p_job uuid, p_worker text) returns crawl_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j crawl_jobs;
begin
  select * into j from crawl_jobs where id = p_job for update;
  if not found or j.status <> 'running' or j.lease_owner is distinct from p_worker or j.lease_expires_at < now() then
    raise exception 'lease lost for scan %', p_job using errcode = '55000';
  end if;
  return j;
end $$;

create function worker_claim_job(p_worker text, p_lease_seconds int default 300) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j crawl_jobs;
begin
  if p_worker !~ '^[A-Za-z0-9._:-]{3,80}$' or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid worker claim' using errcode = '22023';
  end if;
  -- Recover scans whose worker died: retry up to three attempts, then fail them visibly.
  update crawl_jobs set status = 'failed', finished_at = now(), lease_owner = null,
         error = 'The worker stopped responding three times; the scan was abandoned.'
   where status = 'running' and lease_expires_at < now() and attempts >= 3;
  select * into j from crawl_jobs
   where (status = 'queued' or (status = 'running' and lease_expires_at < now()))
     and cancel_requested_at is null
   order by requested_at limit 1 for update skip locked;
  if not found then return null; end if;
  update crawl_jobs set status = 'running', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = attempts + 1, started_at = coalesce(started_at, now())
   where id = j.id;
  insert into crawl_events (job_id, level, message, details)
  values (j.id, 'info', 'Scan started', jsonb_build_object('worker', p_worker, 'attempt', j.attempts + 1));
  return jsonb_build_object(
    'job_id', j.id, 'institution_id', j.institution_id,
    'institution_name', (select name from revisions where institution_id = j.institution_id
                          order by revision_number desc limit 1),
    'hosts', (select coalesce(jsonb_agg(host order by host), '[]'::jsonb) from source_hosts
               where institution_id = j.institution_id and approved),
    'start_urls', to_jsonb(j.start_urls), 'page_budget', j.page_budget, 'doc_budget', j.doc_budget,
    'baseline', j.baseline);
end $$;

-- Extends the lease. Returns 'cancel' when a team member asked to stop the scan.
create function worker_heartbeat(p_job uuid, p_worker text, p_lease_seconds int default 300) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j crawl_jobs := worker_job(p_job, p_worker);
begin
  update crawl_jobs set lease_expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 3600))
   where id = p_job;
  return case when j.cancel_requested_at is not null then 'cancel' else 'continue' end;
end $$;

create function worker_log(p_job uuid, p_worker text, p_level text, p_message text, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform worker_job(p_job, p_worker);
  insert into crawl_events (job_id, level, message, details)
  values (p_job, p_level, left(p_message, 500), coalesce(p_details, '{}'));
end $$;

-- Record one fetched page or document. Both the requested and the final URL must be on a host
-- approved for this institution (the worker checks too; this is the backstop).
create function worker_record_source(p_job uuid, p_worker text, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j   crawl_jobs := worker_job(p_job, p_worker);
  id_ uuid;
begin
  if not url_is_approved(j.institution_id, p->>'requested_url') or not url_is_approved(j.institution_id, p->>'final_url') then
    raise exception 'source is not on an approved host' using errcode = '42501';
  end if;
  insert into source_versions (job_id, institution_id, requested_url, final_url, http_status, content_type,
    content_hash, byte_length, title, text_content, truncated, extraction_note)
  values (j.id, j.institution_id, p->>'requested_url', p->>'final_url', (p->>'http_status')::int,
    left(p->>'content_type', 100), p->>'content_hash', (p->>'byte_length')::int, left(p->>'title', 300),
    coalesce(p->>'text_content', ''), coalesce((p->>'truncated')::boolean, false), left(p->>'extraction_note', 500))
  returning id into id_;
  return id_;
end $$;

-- Add one proposal. The server, not the model, decides what the existing value was, and the excerpt
-- must appear verbatim (ignoring case and spacing) in the captured text of the cited source.
create function worker_add_proposal(p_job uuid, p_worker text, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j       crawl_jobs := worker_job(p_job, p_worker);
  sv      source_versions;
  key_    text := p->>'field_key';
  kind    text;
  vkind   text;
  st      assessment_state;
  prop    jsonb := coalesce(p->'proposed', '{}'::jsonb);
  excerpt text := btrim(coalesce(p->>'excerpt', ''));
  locator text := nullif(btrim(coalesce(p->>'locator', '')), '');
  id_     uuid;
begin
  select value_kind into vkind from indicator_definitions where key = key_;
  if found then
    kind := 'indicator';
  elsif key_ in ('head_name', 'head_title', 'bursar_name') then
    kind := 'profile';
  else
    raise exception 'unknown field %', left(key_, 60) using errcode = '22023';
  end if;
  select * into sv from source_versions where id = (p->>'source_version_id')::uuid and institution_id = j.institution_id;
  if not found then raise exception 'proposal cites an unknown source' using errcode = '22023'; end if;
  if length(excerpt) < 12 or position(norm_text(excerpt) in norm_text(sv.text_content)) = 0 then
    raise exception 'proposal excerpt does not appear in the cited source' using errcode = '22023';
  end if;
  if kind = 'indicator' then
    st := (p->>'candidate_state')::assessment_state;
    -- The assistant can never approve not_found or not_applicable, or reset work to not_assessed.
    if st not in ('published', 'uncertain') then
      raise exception 'the assistant may only propose published or uncertain' using errcode = '22023';
    end if;
    if st = 'published' and (locator is null or length(locator) < 3) then
      raise exception 'a proposed published value needs a locator' using errcode = '22023';
    end if;
    prop := jsonb_strip_nulls(jsonb_build_object(
      'state', st,
      'period_type', (prop->>'period_type')::period_type,
      'period_label', left(prop->>'period_label', 40),
      'value_amount', case when vkind = 'money' then (prop->>'value_amount')::numeric end,
      'value_scale', case when vkind = 'money' then (prop->>'value_scale')::value_scale end,
      'value_currency', case when vkind = 'money' then upper(prop->>'value_currency') end,
      'value_count', case when vkind = 'count' then (prop->>'value_count')::integer end,
      'value_literal', left(prop->>'value_literal', 200)));
    if (prop ? 'value_amount') and not (prop ? 'value_scale' and prop ? 'value_currency') then
      raise exception 'a monetary value needs its scale and currency' using errcode = '22023';
    end if;
    if (prop ? 'value_currency') and (prop->>'value_currency') !~ '^[A-Z]{3}$' then
      raise exception 'currency must be a three-letter code' using errcode = '22023';
    end if;
    if (prop ? 'value_count') and (prop->>'value_count')::integer < 0 then
      raise exception 'a count cannot be negative' using errcode = '22023';
    end if;
    if (prop ? 'value_amount' or prop ? 'value_count') and not (prop ? 'value_literal') then
      raise exception 'keep the figure exactly as printed in value_literal' using errcode = '22023';
    end if;
  else
    if nullif(btrim(prop->>'value'), '') is null or length(prop->>'value') > 200 then
      raise exception 'a profile proposal needs a value' using errcode = '22023';
    end if;
    prop := jsonb_build_object('value', btrim(prop->>'value'));
  end if;
  insert into agent_proposals (job_id, institution_id, base_revision_id, field_key, field_kind, existing_value,
    proposed, candidate_state, source_version_id, excerpt, locator, extraction_method, uncertainty, confidence)
  values (j.id, j.institution_id, j.base_revision_id, key_, kind, j.baseline -> key_, prop,
    case when kind = 'indicator' then st end, sv.id, excerpt, left(locator, 300),
    coalesce(left(p->>'extraction_method', 40), 'html_text'),
    coalesce((select array_agg(left(x, 300)) from jsonb_array_elements_text(
               case when jsonb_typeof(p->'uncertainty') = 'array' then p->'uncertainty' else '[]'::jsonb end) x), '{}'),
    case when p->>'confidence' in ('low', 'medium', 'high') then p->>'confidence' end)
  returning id into id_;
  return id_;
end $$;

create function worker_finish_job(p_job uuid, p_worker text, p_status crawl_status, p_coverage jsonb,
                                  p_usage jsonb default '{}', p_error text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j crawl_jobs := worker_job(p_job, p_worker);
begin
  if p_status not in ('succeeded', 'failed', 'cancelled', 'configuration_required') then
    raise exception 'invalid final status' using errcode = '22023';
  end if;
  update crawl_jobs set status = p_status, finished_at = now(), lease_owner = null, lease_expires_at = null,
         coverage = coalesce(p_coverage, '{}'), usage = coalesce(p_usage, '{}'), error = left(p_error, 1000)
   where id = j.id;
  insert into crawl_events (job_id, level, message)
  values (j.id, case when p_status = 'succeeded' then 'info' else 'warn' end, 'Scan finished: ' || p_status);
end $$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table source_hosts    enable row level security;
alter table crawl_jobs      enable row level security;
alter table crawl_events    enable row level security;
alter table source_versions enable row level security;
alter table agent_proposals enable row level security;

revoke all on source_hosts, crawl_jobs, crawl_events, source_versions, agent_proposals
  from public, nut_anon, nut_member, nut_system, nut_worker;
grant select on source_hosts, crawl_jobs, crawl_events, source_versions, agent_proposals to nut_member;
create policy team_read on source_hosts    for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on crawl_jobs      for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on crawl_events    for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on source_versions for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on agent_proposals for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));

-- New functions are executable by PUBLIC by default; start from nothing and grant precisely.
revoke execute on function url_host(text), host_is_approved(uuid, text), url_is_approved(uuid, text),
  proposable_values(uuid), norm_text(text),
  add_source_host(uuid, text, text), decide_source_host(uuid, boolean), request_scan(uuid, text[]),
  cancel_scan(uuid), accept_proposal(uuid, uuid, int, jsonb, text), reject_proposal(uuid, text),
  worker_job(uuid, text), worker_claim_job(text, int), worker_heartbeat(uuid, text, int),
  worker_log(uuid, text, text, text, jsonb), worker_record_source(uuid, text, jsonb),
  worker_add_proposal(uuid, text, jsonb), worker_finish_job(uuid, text, crawl_status, jsonb, jsonb, text)
from public, nut_anon, nut_member, nut_system, nut_worker;

grant execute on function add_source_host(uuid, text, text), decide_source_host(uuid, boolean),
  request_scan(uuid, text[]), cancel_scan(uuid), accept_proposal(uuid, uuid, int, jsonb, text),
  reject_proposal(uuid, text)
to nut_member;

grant execute on function worker_claim_job(text, int), worker_heartbeat(uuid, text, int),
  worker_log(uuid, text, text, text, jsonb), worker_record_source(uuid, text, jsonb),
  worker_add_proposal(uuid, text, jsonb), worker_finish_job(uuid, text, crawl_status, jsonb, jsonb, text)
to nut_worker;

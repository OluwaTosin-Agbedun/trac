-- The research assistant feeds the verified register (0018).
--
-- 1. Worker recovery: a running scan whose lease expired after a team member asked to cancel it is
--    closed as cancelled (before, it was skipped forever and blocked new scans of that institution).
-- 2. Worker status: the worker reports itself on every poll and heartbeat (when it was last seen,
--    whether its host has a model key, its version). Team members read only those three facts, so
--    the CMS no longer guesses from the web server's own environment.
-- 3. PDF text: captures record how their text was read (html_text, plain_text, pdf_text) and a PDF's
--    page count; proposals keep a known extraction method.
-- 4. Proposals may say a disclosure is partial (proposed.register_status), for the register's
--    "Partially published" status.
-- 5. The register: request a scan from a record, apply a pending proposal to a record's working copy
--    (hash-bound, editor scope as for saving, audited; the record still needs a second person to
--    verify it), and approve the homepage hosts of all linked records at once (administrators).
-- 6. Crawling: a scan requested from a record starts from the record's own links on approved hosts;
--    captures the model actually read are marked, and a later scan is told the latest such capture
--    of each address, so a page whose address and content hash have not changed is not sent again.
--
-- Redefined functions keep their exact signatures, so existing grants stay as they were.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

-- Only referenced inside plpgsql bodies below: a new enum value cannot be used in the transaction
-- that adds it.
alter type proposal_status add value if not exists 'applied_to_register';

alter table agent_proposals
  add column applied_entry_id uuid references report_entries(id);

create table worker_status (
  worker_id    text primary key check (worker_id ~ '^[A-Za-z0-9._:-]{3,80}$'),
  last_seen_at timestamptz not null default now(),
  configured   boolean not null,
  version      text check (version is null or version ~ '^[A-Za-z0-9._+-]{1,40}$')
);

alter table source_versions
  add column extraction_method text check (extraction_method is null or extraction_method in ('html_text', 'plain_text', 'pdf_text')),
  add column page_count        int check (page_count is null or page_count between 0 and 100000),
  add column sent_to_model     boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Claiming work: recovery
-- ---------------------------------------------------------------------------

create or replace function worker_claim_job(p_worker text, p_lease_seconds int default 300) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j crawl_jobs;
begin
  if p_worker is null or p_worker !~ '^[A-Za-z0-9._:-]{3,80}$' or p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid worker claim' using errcode = '22023';
  end if;
  -- A team member asked to stop the scan and its worker then died: nobody will finish it, so close
  -- it as cancelled. Sources captured before the worker stopped are kept.
  with closed as (
    update crawl_jobs
       set status = 'cancelled', finished_at = now(), lease_owner = null, lease_expires_at = null,
           coverage = coverage || jsonb_build_object('note',
             'Cancelled. The worker stopped before it could finish; sources captured so far were kept.')
     where status = 'running' and lease_expires_at < now() and cancel_requested_at is not null
    returning id)
  insert into crawl_events (job_id, level, message)
  select id, 'warn', 'Scan closed as cancelled: the worker stopped responding after the cancel request' from closed;
  -- Recover scans whose worker died: retry up to three attempts, then fail them visibly.
  with failed as (
    update crawl_jobs set status = 'failed', finished_at = now(), lease_owner = null, lease_expires_at = null,
           error = 'The worker stopped responding three times; the scan was abandoned.'
     where status = 'running' and lease_expires_at < now() and attempts >= 3
    returning id)
  insert into crawl_events (job_id, level, message)
  select id, 'error', 'Scan abandoned after three attempts' from failed;
  select * into j from crawl_jobs
   where (status = 'queued' or (status = 'running' and lease_expires_at < now()))
     and cancel_requested_at is null
   order by requested_at limit 1 for update skip locked;
  if not found then return null; end if;
  if j.status = 'running' then
    insert into crawl_events (job_id, level, message, details)
    values (j.id, 'warn', 'The previous worker stopped responding; the scan starts again',
            jsonb_build_object('previous_worker', j.lease_owner));
  end if;
  update crawl_jobs set status = 'running', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = attempts + 1, started_at = coalesce(started_at, now())
   where id = j.id;
  insert into crawl_events (job_id, level, message, details)
  values (j.id, 'info', 'Scan started', jsonb_build_object('worker', p_worker, 'attempt', j.attempts + 1));
  update worker_status set last_seen_at = now() where worker_id = p_worker;
  return jsonb_build_object(
    'job_id', j.id, 'institution_id', j.institution_id,
    'institution_name', (select name from revisions where institution_id = j.institution_id
                          order by revision_number desc limit 1),
    'hosts', (select coalesce(jsonb_agg(host order by host), '[]'::jsonb) from source_hosts
               where institution_id = j.institution_id and approved),
    'start_urls', to_jsonb(j.start_urls), 'page_budget', j.page_budget, 'doc_budget', j.doc_budget,
    'baseline', j.baseline,
    -- The latest capture of each address that an earlier scan sent to the model: an unchanged page
    -- (same address, same content hash) is not sent again.
    'previous', (select coalesce(jsonb_agg(jsonb_build_object('final_url', p.final_url, 'content_hash', p.content_hash)), '[]'::jsonb)
                   from (select distinct on (s.final_url) s.final_url, s.content_hash
                           from source_versions s
                          where s.institution_id = j.institution_id and s.sent_to_model and s.job_id <> j.id
                          order by s.final_url, s.fetched_at desc
                          limit 500) p));
end $$;

-- Extends the lease. Returns 'cancel' when a team member asked to stop the scan. Also tells the CMS
-- the worker is alive during a long scan.
create or replace function worker_heartbeat(p_job uuid, p_worker text, p_lease_seconds int default 300) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j crawl_jobs := worker_job(p_job, p_worker);
begin
  update crawl_jobs set lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 3600))
   where id = p_job;
  update worker_status set last_seen_at = now() where worker_id = p_worker;
  return case when j.cancel_requested_at is not null then 'cancel' else 'continue' end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Worker status
-- ---------------------------------------------------------------------------

-- Written by the worker on every poll. p_configured says whether its host has a model key (never
-- the key itself).
create function worker_report_status(p_worker text, p_configured boolean, p_version text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_worker is null or p_worker !~ '^[A-Za-z0-9._:-]{3,80}$' or p_configured is null
     or (p_version is not null and p_version !~ '^[A-Za-z0-9._+-]{1,40}$') then
    raise exception 'invalid worker status' using errcode = '22023';
  end if;
  insert into worker_status (worker_id, last_seen_at, configured, version)
  values (p_worker, now(), p_configured, p_version)
  on conflict (worker_id) do update set last_seen_at = now(), configured = excluded.configured, version = excluded.version;
  -- Each restart has a new id (host:process); forget the ones not seen for a month.
  delete from worker_status where last_seen_at < now() - interval '30 days';
end $$;

-- The most recently seen worker, for editors, reviewers and administrators: when, whether its host
-- has a model key, and its version. Nothing else about the worker host is exposed.
create function research_worker_status()
returns table (last_seen_at timestamptz, configured boolean, version text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_role('editor', 'reviewer', 'admin');
  return query select w.last_seen_at, w.configured, w.version from worker_status w order by w.last_seen_at desc limit 1;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Captures and proposals: how the text was read
-- ---------------------------------------------------------------------------

create or replace function worker_record_source(p_job uuid, p_worker text, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j   crawl_jobs := worker_job(p_job, p_worker);
  id_ uuid;
begin
  if not url_is_approved(j.institution_id, p->>'requested_url') or not url_is_approved(j.institution_id, p->>'final_url') then
    raise exception 'source is not on an approved host' using errcode = '42501';
  end if;
  insert into source_versions (job_id, institution_id, requested_url, final_url, http_status, content_type,
    content_hash, byte_length, title, text_content, truncated, extraction_note, extraction_method, page_count)
  values (j.id, j.institution_id, p->>'requested_url', p->>'final_url', (p->>'http_status')::int,
    left(p->>'content_type', 100), p->>'content_hash', (p->>'byte_length')::int, left(p->>'title', 300),
    coalesce(p->>'text_content', ''), coalesce((p->>'truncated')::boolean, false), left(p->>'extraction_note', 500),
    case when p->>'extraction_method' in ('html_text', 'plain_text', 'pdf_text') then p->>'extraction_method' end,
    case when (p->>'page_count') ~ '^[0-9]{1,5}$' then (p->>'page_count')::int end)
  returning id into id_;
  return id_;
end $$;

-- After the model call succeeds: these captures of this scan were read by the model.
create function worker_mark_sent(p_job uuid, p_worker text, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform worker_job(p_job, p_worker);
  if p_ids is null or cardinality(p_ids) > 100 then
    raise exception 'mark at most 100 sources' using errcode = '22023';
  end if;
  update source_versions set sent_to_model = true where job_id = p_job and id = any (p_ids);
end $$;

-- As in 0006, with the extraction method limited to the known ones, and (indicators) the register
-- status the disclosure supports: published, or partial when only part of it is shown.
create or replace function worker_add_proposal(p_job uuid, p_worker text, p jsonb) returns uuid
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
    if (prop ? 'register_status') and jsonb_typeof(prop->'register_status') <> 'null'
       and (prop->>'register_status') not in ('published', 'partial') then
      raise exception 'the register status may only be published or partial' using errcode = '22023';
    end if;
    prop := jsonb_strip_nulls(jsonb_build_object(
      'state', st,
      'register_status', prop->>'register_status',
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
    case when p->>'extraction_method' in ('html_text', 'plain_text', 'pdf_text') then p->>'extraction_method' else 'html_text' end,
    coalesce((select array_agg(left(x, 300)) from jsonb_array_elements_text(
               case when jsonb_typeof(p->'uncertainty') = 'array' then p->'uncertainty' else '[]'::jsonb end) x), '{}'),
    case when p->>'confidence' in ('low', 'medium', 'high') then p->>'confidence' end)
  returning id into id_;
  return id_;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The register
-- ---------------------------------------------------------------------------

-- The host to approve for a record's homepage: its host without a leading "www." (so subdomains such
-- as bursary.example.edu.ng are covered), or null when it is not a public website name. A bare public
-- suffix (edu.ng, gov.ng, com …) is never returned, so an approval can never cover a whole domain space.
-- Nor is a social network or a shared hosting service (a homepage recorded as a Facebook page or a
-- Google Site would otherwise approve every page on that service as this institution's source); an
-- institution's own subdomain of a hosting service (unilag.wordpress.com) is its own site and is kept.
create function register_research_host(p_url text) returns text
language plpgsql immutable security definer set search_path = public, pg_temp as $$
declare
  h        text := url_host(btrim(coalesce(p_url, '')));
  suffixes constant text[] := array['ng', 'edu.ng', 'gov.ng', 'com.ng', 'org.ng', 'net.ng', 'sch.ng', 'name.ng', 'mil.ng',
                                    'mobi.ng', 'i.ng', 'com', 'org', 'net', 'edu', 'gov', 'info', 'co.uk', 'ac.uk', 'org.uk'];
  -- Services where one site is a path or a page: never approved, nor any of their subdomains.
  shared   constant text[] := array['facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
                                    'youtube.com', 'youtu.be', 'tiktok.com', 'threads.net', 't.me', 'telegram.me', 'wa.me',
                                    'whatsapp.com', 'linktr.ee', 'google.com', 'goo.gl', 'bit.ly', 'dropbox.com', 'scribd.com',
                                    'academia.edu', 'researchgate.net', 'medium.com', 'github.com', 'amazonaws.com',
                                    'googleapis.com', 'live.com', '1drv.ms', 'sharepoint.com', 'archive.org'];
  -- Services where one site is a subdomain: the service's own name is never approved.
  hosting  constant text[] := array['wordpress.com', 'blogspot.com', 'wixsite.com', 'weebly.com', 'github.io', 'netlify.app',
                                    'vercel.app', 'pages.dev', 'herokuapp.com', 'azurewebsites.net', 'web.app', 'firebaseapp.com',
                                    'cloudfront.net', 'webs.com', 'jimdofree.com', 'godaddysites.com'];
begin
  if h is null then return null; end if;
  if h like 'www.%' then
    if substr(h, 5) = any (suffixes) then return null; end if;
    if position('.' in substr(h, 5)) > 0 then h := substr(h, 5); end if;
  end if;
  if h = any (suffixes) or position('.' in h) = 0 or h = 'localhost' or h like '%.localhost' or h like '%.local'
     or h like '%.internal' or h ~ '^[0-9.]+$' or length(h) > 253
     or h !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    return null;
  end if;
  if h = any (hosting) or exists (select 1 from unnest(shared) s where h = s or right(h, length(s) + 1) = '.' || s) then
    return null;
  end if;
  return h;
end $$;

-- Request a scan for a register record's linked institution (same checks as request_scan, plus the
-- record's own editor scope). Its start pages are the record's own disclosure page, extra documents
-- and evidence links that are on an approved host of the institution (at most 10).
create function request_register_scan(p_entry uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := require_role('editor', 'reviewer', 'admin');
  e    report_entries;
  urls text[];
  job  uuid;
begin
  select * into e from report_entries where id = p_entry;
  if not found then raise exception 'that institution is no longer in the report' using errcode = 'P0002'; end if;
  if e.archived_at is not null then
    raise exception 'this institution was removed from the register; an administrator can restore it' using errcode = '22023';
  end if;
  if current_team_role() = 'editor' and e.assigned_editor is not null and e.assigned_editor <> uid then
    raise exception 'this institution is assigned to another editor' using errcode = '42501';
  end if;
  if e.institution_id is null then
    raise exception 'this record is not linked to a research institution yet' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.u order by c.ord, c.u), '{}') into urls
    from (select u, min(ord) as ord
            from (select e.disclosure_url as u, 0::bigint as ord
                  union all
                  select l.value->>'url', l.n
                    from jsonb_array_elements(case when jsonb_typeof(e.extra_links) = 'array' then e.extra_links else '[]'::jsonb end)
                         with ordinality as l(value, n)
                   where jsonb_typeof(l.value) = 'object'
                  union all
                  select a.value->>'evidence_url', 10
                    from jsonb_each(case when jsonb_typeof(e.assessments) = 'object' then e.assessments else '{}'::jsonb end) as a(key, value)
                   where jsonb_typeof(a.value) = 'object') s
           where u is not null and length(u) <= 500 and url_is_approved(e.institution_id, u)
           group by u
           order by min(ord), u
           limit 10) c;
  job := request_scan(e.institution_id, urls);
  perform audit('report.scan_requested', 'report_entry', p_entry,
                jsonb_build_object('job_id', job, 'institution_id', e.institution_id, 'start_pages', cardinality(urls)));
  return job;
end $$;

-- Apply one pending proposal to a record's working copy: the indicator becomes published (or
-- partially published) for the proposal's period, with the captured page as evidence, the capture
-- date as the checked date and the locator as the note. Bound to the version the person opened
-- (register_hash), with the same editor scope as saving. Like any edit, the record then needs a
-- second person to verify it before the public sees it.
create function apply_proposal_to_register(p_proposal uuid, p_entry uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid     uuid := require_role('editor', 'reviewer', 'admin');
  my_role team_role := current_team_role();
  pr      agent_proposals;
  sv      source_versions;
  before  report_entries;
  after   report_entries;
  st      text;
  old_a   jsonb;
  new_a   jsonb;
begin
  select * into before from report_entries where id = p_entry for update;
  if not found then raise exception 'that institution is no longer in the report' using errcode = 'P0002'; end if;
  if before.archived_at is not null then
    raise exception 'this institution was removed from the register; an administrator can restore it' using errcode = '22023';
  end if;
  if my_role = 'editor' and before.assigned_editor is not null and before.assigned_editor <> uid then
    raise exception 'this institution is assigned to another editor' using errcode = '42501';
  end if;
  if p_hash is null or register_hash(before) is distinct from p_hash then
    raise exception 'conflict: someone else saved this record after you opened it' using errcode = '40001';
  end if;
  select * into pr from agent_proposals where id = p_proposal for update;
  if not found then raise exception 'that suggestion could not be found' using errcode = 'P0002'; end if;
  if before.institution_id is null or pr.institution_id <> before.institution_id then
    raise exception 'that suggestion is for a different institution' using errcode = '22023';
  end if;
  if pr.status <> 'pending' then
    raise exception 'this suggestion was already %', replace(pr.status::text, '_', ' ') using errcode = '55000';
  end if;
  if pr.field_kind <> 'indicator' then
    raise exception 'only indicator suggestions can be applied to the register' using errcode = '22023';
  end if;
  if pr.candidate_state = 'uncertain' then
    raise exception 'the assistant was not sure about this suggestion: open the source, record the finding yourself, then dismiss it'
      using errcode = '22023';
  end if;
  select * into sv from source_versions where id = pr.source_version_id;
  -- An administrator may have withdrawn the website since the scan: its pages are no longer evidence.
  if not url_is_approved(before.institution_id, sv.final_url) then
    raise exception 'the website this suggestion came from is no longer an approved research source; dismiss the suggestion'
      using errcode = '22023';
  end if;
  if length(sv.final_url) > 500 then
    raise exception 'the source address is too long to keep as evidence (500 characters at most); add the evidence link by hand'
      using errcode = '22023';
  end if;
  st := case when pr.proposed->>'register_status' = 'partial' then 'partial' else 'published' end;
  old_a := before.assessments -> pr.field_key;
  new_a := jsonb_build_object(
    'status', st,
    'year', left(nullif(btrim(coalesce(pr.proposed->>'period_label', '')), ''), 20),
    'evidence_url', sv.final_url,
    'checked_on', (sv.fetched_at at time zone 'Africa/Lagos')::date,
    'note', left(nullif(btrim(coalesce(pr.locator, sv.title, '')), ''), 300));
  update report_entries set
    assessments = clean_assessments(assessments || jsonb_build_object(pr.field_key, new_a)),
    editors = case when uid = any (editors) then editors else editors || uid end,
    return_note = null,
    updated_at = now(), updated_by = uid
  where id = p_entry returning * into after;
  after.pending := register_content(after) is distinct from after.verified;
  update report_entries set pending = after.pending where id = p_entry;
  update agent_proposals set status = 'applied_to_register', decided_at = now(), decided_by = uid,
         applied_entry_id = p_entry, accepted_value = after.assessments -> pr.field_key
   where id = pr.id;
  perform audit('report.proposal_applied', 'report_entry', p_entry, jsonb_build_object(
    'proposal_id', pr.id, 'job_id', pr.job_id, 'indicator', pr.field_key,
    'before', old_a, 'after', after.assessments -> pr.field_key, 'source_url', sv.final_url));
end $$;

-- Administrators: approve, as research sources, the homepage hosts of every register record that
-- has a homepage and a linked institution. A host an administrator refused before stays refused.
create function approve_register_homepages() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid        uuid := require_role('admin');
  r          record;
  h          text;
  s          source_hosts;
  approved   int := 0;
  already    int := 0;
  refused    int := 0;
  not_linked int := 0;
  unusable   int := 0;
begin
  for r in select e.id, e.institution_id, e.homepage_url
             from report_entries e
            where e.archived_at is null and e.homepage_url is not null
            order by e.id
  loop
    if r.institution_id is null
       or not exists (select 1 from institutions i where i.id = r.institution_id and i.archived_at is null) then
      not_linked := not_linked + 1;
      continue;
    end if;
    h := register_research_host(r.homepage_url);
    if h is null then
      unusable := unusable + 1;
      continue;
    end if;
    select * into s from source_hosts where institution_id = r.institution_id and host = h for update;
    if not found then
      insert into source_hosts (institution_id, host, approved, note, created_by, decided_at, decided_by)
      values (r.institution_id, h, true, 'The homepage recorded in the register', uid, now(), uid)
      returning * into s;
      perform audit('source_host.approved', 'institution', r.institution_id,
                    jsonb_build_object('host', h, 'source_host_id', s.id, 'register_entry_id', r.id));
      approved := approved + 1;
    elsif s.approved then
      already := already + 1;
    elsif s.decided_at is not null then
      refused := refused + 1;
    else
      update source_hosts set approved = true, decided_at = now(), decided_by = uid where id = s.id;
      perform audit('source_host.approved', 'institution', r.institution_id,
                    jsonb_build_object('host', h, 'source_host_id', s.id, 'register_entry_id', r.id));
      approved := approved + 1;
    end if;
  end loop;
  perform audit('research.homepages_approved', 'report', null, jsonb_build_object(
    'approved', approved, 'already_approved', already, 'previously_refused', refused,
    'not_linked', not_linked, 'unusable', unusable));
  return jsonb_build_object('approved', approved, 'already_approved', already, 'previously_refused', refused,
                            'not_linked', not_linked, 'unusable', unusable);
end $$;

-- ---------------------------------------------------------------------------
-- Access: nothing for anyone by default, then precisely what each role needs.
-- ---------------------------------------------------------------------------

alter table worker_status enable row level security;
revoke all on worker_status from public, nut_anon, nut_member, nut_system, nut_worker, nut_cron;

revoke execute on function worker_report_status(text, boolean, text), worker_mark_sent(uuid, text, uuid[]),
  research_worker_status(), register_research_host(text), request_register_scan(uuid),
  apply_proposal_to_register(uuid, uuid, text), approve_register_homepages()
  from public, nut_anon, nut_member, nut_system, nut_worker, nut_cron;

grant execute on function worker_report_status(text, boolean, text), worker_mark_sent(uuid, text, uuid[]) to nut_worker;
grant execute on function research_worker_status(), register_research_host(text), request_register_scan(uuid),
  apply_proposal_to_register(uuid, uuid, text), approve_register_homepages()
  to nut_member;

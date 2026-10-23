-- The verified register (in response to the Chancellor's review of 21 Oct 2026).
--
-- Each institution in the public report becomes one source record with:
--   * separate homepage and disclosure-page addresses, plus up to three extra document links;
--   * for each of the nine indicators: a status, the reporting year, an evidence link, the date the
--     source was checked and a short note;
--   * a second-person check: whoever edited the record cannot verify it. Only the verified copy is
--     public; until then the public site shows "Verification in progress".
--
-- Statuses: published, partial (partially published), not_found, inaccessible (temporarily
-- inaccessible), nil (explicitly declared nil, which is a disclosure, not a gap), not_applicable
-- and not_assessed. The spreadsheet's TRUE/FALSE values and YES/NO status are kept for editors as
-- "tracker claims" and are never shown publicly.

alter table report_entries
  add column homepage_url   text check (homepage_url is null or (homepage_url ~* '^https?://[^\s<>"]+$' and length(homepage_url) <= 500)),
  add column disclosure_url text check (disclosure_url is null or (disclosure_url ~* '^https?://[^\s<>"]+$' and length(disclosure_url) <= 500)),
  add column extra_links    jsonb not null default '[]',
  add column assessments    jsonb not null default '{}',
  add column tracker_claims jsonb not null default '{}',
  add column tracker_status text,
  add column editors        uuid[] not null default '{}',
  add column pending        boolean not null default true,
  add column return_note    text check (return_note is null or length(return_note) <= 1000),
  add column verified       jsonb,
  add column verified_at    timestamptz,
  add column verified_by    uuid;

create table report_link_checks (
  id         bigint generated always as identity primary key,
  entry_id   uuid not null references report_entries(id) on delete cascade,
  url        text not null,
  kind       text not null check (length(kind) <= 60),
  result     text not null check (result in ('ok', 'homepage', 'redirects_to_homepage', 'other_site', 'not_found', 'error', 'blocked')),
  http_status int,
  final_url  text,
  detail     text check (detail is null or length(detail) <= 300),
  checked_at timestamptz not null default now(),
  checked_by uuid
);
create index report_link_checks_entry on report_link_checks (entry_id, checked_at desc);

-- Validate and normalise the nine assessments. Unknown keys are dropped; bad values are refused.
create function clean_assessments(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d   record;
  a   jsonb;
  s   text;
  y   text;
  u   text;
  c   date;
  n   text;
  res jsonb := '{}';
begin
  for d in select key, label from indicator_definitions order by sort_order loop
    a := coalesce(p -> d.key, '{}'::jsonb);
    if jsonb_typeof(a) <> 'object' then a := '{}'; end if;
    s := coalesce(nullif(a->>'status', ''), 'not_assessed');
    if s not in ('published', 'partial', 'not_found', 'inaccessible', 'nil', 'not_applicable', 'not_assessed') then
      raise exception 'choose a valid status for %', d.label using errcode = '22023';
    end if;
    y := nullif(btrim(coalesce(a->>'year', '')), '');
    if y is not null and length(y) > 20 then
      raise exception 'the reporting year for % is too long', d.label using errcode = '22023';
    end if;
    u := nullif(btrim(coalesce(a->>'evidence_url', '')), '');
    if u is not null and (u !~* '^https?://[^\s<>"]+$' or length(u) > 500) then
      raise exception 'the evidence link for % must be a full address starting with https://', d.label using errcode = '22023';
    end if;
    begin
      c := nullif(btrim(coalesce(a->>'checked_on', '')), '')::date;
    exception when others then
      raise exception 'the checked date for % is not a date', d.label using errcode = '22023';
    end;
    if c is not null and (c > current_date + 1 or c < date '2000-01-01') then
      raise exception 'the checked date for % must be between 2000 and today', d.label using errcode = '22023';
    end if;
    n := nullif(btrim(coalesce(a->>'note', '')), '');
    if n is not null and length(n) > 300 then
      raise exception 'the note for % is too long (300 characters at most)', d.label using errcode = '22023';
    end if;
    res := res || jsonb_build_object(d.key, jsonb_build_object('status', s, 'year', y, 'evidence_url', u, 'checked_on', c, 'note', n));
  end loop;
  return res;
end $$;

create function clean_extra_links(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  l   jsonb;
  res jsonb := '[]';
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'; end if;
  for l in select value from jsonb_array_elements(p) loop
    continue when jsonb_typeof(l) <> 'object' or nullif(btrim(coalesce(l->>'url', '')), '') is null;
    if (l->>'url') !~* '^https?://[^\s<>"]+$' or length(l->>'url') > 500 then
      raise exception 'each extra document link must be a full address starting with https://' using errcode = '22023';
    end if;
    res := res || jsonb_build_array(jsonb_build_object('label', left(coalesce(nullif(btrim(l->>'label'), ''), 'Document'), 120), 'url', btrim(l->>'url')));
    exit when jsonb_array_length(res) >= 3;
  end loop;
  return res;
end $$;

-- The content a verifier checks and the public sees.
create function register_content(e report_entries) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'name', e.name, 'section', e.section, 'state', e.state, 'head_name', e.head_name, 'bursar_name', e.bursar_name,
    'homepage_url', e.homepage_url, 'disclosure_url', e.disclosure_url, 'extra_links', e.extra_links,
    'assessments', e.assessments)
$$;

create function register_hash(e report_entries) returns text language sql stable as $$
  select encode(sha256(convert_to(register_content(e)::text, 'UTF8')), 'hex')
$$;

create function is_homepage_url(u text) returns boolean language sql immutable as $$
  select u is not null and u ~* '^https?://[^/?#]+/?([?#].*)?$'
$$;

-- Backfill: every existing entry starts unverified, with its spreadsheet claims kept for editors.
update report_entries set
  homepage_url   = case when is_homepage_url(website_url) then website_url end,
  disclosure_url = case when website_url is not null and not is_homepage_url(website_url) then website_url end,
  tracker_claims = indicators,
  tracker_status = report_status,
  assessments    = clean_assessments('{}'),
  pending        = true,
  verified       = null;

-- Add (p_id null) or update a record's working copy. Every change needs a second-person check.
create or replace function save_report_entry(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('editor', 'reviewer', 'admin');
  before report_entries;
  after  report_entries;
  sect   text := p->>'section';
  home   text := nullif(btrim(coalesce(p->>'homepage_url', '')), '');
  disc   text := nullif(btrim(coalesce(p->>'disclosure_url', p->>'website_url', '')), '');
  assess jsonb;
  links  jsonb;
begin
  if sect not in ('federal_university', 'federal_polytechnic', 'federal_monotechnic', 'state_university', 'state_polytechnic', 'state_monotechnic') then
    raise exception 'choose the category' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p->>'name', '')), '') is null then
    raise exception 'enter the institution''s name' using errcode = '22023';
  end if;
  if home is not null and (home !~* '^https?://[^\s<>"]+$' or length(home) > 500) then
    raise exception 'the homepage must be a full address starting with https://' using errcode = '22023';
  end if;
  if disc is not null and (disc !~* '^https?://[^\s<>"]+$' or length(disc) > 500) then
    raise exception 'the disclosure page must be a full address starting with https://' using errcode = '22023';
  end if;
  assess := clean_assessments(p->'assessments');
  links := clean_extra_links(p->'extra_links');
  if p_id is null then
    insert into report_entries (section, sort_order, name, state, head_name, bursar_name, homepage_url, disclosure_url,
                                extra_links, assessments, editors, pending, created_by, updated_by)
    values (sect, coalesce((select max(sort_order) + 1 from report_entries where section = sect), 1),
            left(btrim(p->>'name'), 300), left(nullif(btrim(p->>'state'), ''), 60), left(nullif(btrim(p->>'head_name'), ''), 200),
            left(nullif(btrim(p->>'bursar_name'), ''), 200), home, disc, links, assess, array[uid], true, uid, uid)
    returning * into after;
    perform audit('report.entry_added', 'report_entry', after.id, jsonb_build_object('name', after.name));
  else
    select * into before from report_entries where id = p_id for update;
    if not found then raise exception 'that institution is no longer in the report' using errcode = 'P0002'; end if;
    update report_entries set
      section = sect,
      sort_order = case when sect = before.section then sort_order
                        else coalesce((select max(sort_order) + 1 from report_entries where section = sect), 1) end,
      name = left(btrim(p->>'name'), 300),
      state = left(nullif(btrim(p->>'state'), ''), 60),
      head_name = left(nullif(btrim(p->>'head_name'), ''), 200),
      bursar_name = left(nullif(btrim(p->>'bursar_name'), ''), 200),
      homepage_url = home,
      disclosure_url = disc,
      extra_links = links,
      assessments = assess,
      editors = case when uid = any (editors) then editors else editors || uid end,
      return_note = null,
      updated_at = now(), updated_by = uid
    where id = p_id returning * into after;
    after.pending := register_content(after) is distinct from after.verified;
    update report_entries set pending = after.pending where id = p_id;
    perform audit('report.entry_updated', 'report_entry', p_id, jsonb_build_object(
      'before', register_content(before), 'after', register_content(after)));
  end if;
  return after.id;
end $$;

-- A second person verifies exactly the content they reviewed; it becomes the public record.
create function verify_report_entry(p_id uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('reviewer', 'admin');
  e   report_entries;
  d   record;
  a   jsonb;
  problems text[] := '{}';
begin
  select * into e from report_entries where id = p_id for update;
  if not found then raise exception 'that institution is no longer in the report' using errcode = 'P0002'; end if;
  if uid = any (e.editors) then
    raise exception 'you edited this record, so another reviewer must verify it' using errcode = '42501';
  end if;
  if register_hash(e) is distinct from p_hash then
    raise exception 'conflict: this record changed since you opened it; reload and check it again' using errcode = '40001';
  end if;
  for d in select key, label from indicator_definitions order by sort_order loop
    a := e.assessments -> d.key;
    if (a->>'status') = 'not_assessed' or a is null then
      problems := problems || format('%s is not assessed', d.label);
    elsif (a->>'status') in ('published', 'partial', 'nil') then
      if a->>'evidence_url' is null and e.disclosure_url is null then problems := problems || format('%s has no evidence link', d.label); end if;
      if (a->>'status') <> 'nil' and a->>'year' is null then problems := problems || format('%s has no reporting year', d.label); end if;
      if a->>'checked_on' is null then problems := problems || format('%s has no checked date', d.label); end if;
    elsif (a->>'status') in ('not_found', 'inaccessible') then
      if a->>'checked_on' is null then problems := problems || format('%s has no checked date', d.label); end if;
    elsif (a->>'status') = 'not_applicable' then
      if a->>'note' is null then problems := problems || format('%s needs a reason for not applicable', d.label); end if;
    end if;
  end loop;
  if e.homepage_url is null then problems := problems || 'the homepage is missing'::text; end if;
  if array_length(problems, 1) > 0 then
    raise exception 'not ready to verify: %', array_to_string(problems, '; ') using errcode = '22023';
  end if;
  update report_entries set verified = register_content(e), verified_at = now(), verified_by = uid, pending = false,
         editors = '{}', return_note = null
   where id = p_id;
  perform audit('report.entry_verified', 'report_entry', p_id, jsonb_build_object('hash', p_hash));
end $$;

create function return_report_entry(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := require_role('reviewer', 'admin');
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if note is null or length(note) > 1000 then
    raise exception 'say what needs fixing (1,000 characters at most)' using errcode = '22023';
  end if;
  update report_entries set return_note = note where id = p_id;
  if not found then raise exception 'that institution is no longer in the report' using errcode = 'P0002'; end if;
  perform audit('report.entry_returned', 'report_entry', p_id, jsonb_build_object('note', note));
end $$;

create function save_link_checks(p_entry uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
  c   jsonb;
begin
  if not exists (select 1 from report_entries where id = p_entry) then
    raise exception 'that institution is no longer in the report' using errcode = 'P0002';
  end if;
  for c in select value from jsonb_array_elements(coalesce(p, '[]'::jsonb)) limit 20 loop
    insert into report_link_checks (entry_id, url, kind, result, http_status, final_url, detail, checked_by)
    values (p_entry, left(c->>'url', 500), left(c->>'kind', 60), c->>'result', nullif(c->>'http_status', '')::int,
            left(c->>'final_url', 500), left(c->>'detail', 300), uid);
  end loop;
end $$;

-- Loading a spreadsheet never touches records already in the register: it only adds institutions
-- that are not there yet (by name), unverified, with their spreadsheet claims kept for editors.
create or replace function load_report_from_import(p_import uuid, p_uid uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  insert into report_entries (section, sort_order, name, state, head_name, bursar_name, homepage_url, disclosure_url,
                              website_text, tracker_claims, tracker_status, assessments, institution_id, source_import_id,
                              created_by, updated_by)
  select r.section, r.section_index, left(btrim(r.mapped->>'name'), 300),
         case when r.issues @> '[{"code": "state_conflict"}]'::jsonb then null else r.mapped->>'stateCanonical' end,
         left(btrim(r.mapped->>'head'), 200), left(btrim(r.mapped->>'bursar'), 200),
         case when ok.url is not null and is_homepage_url(ok.url) then ok.url end,
         case when ok.url is not null and not is_homepage_url(ok.url) then ok.url end,
         left(btrim(r.mapped->>'websiteRaw'), 500),
         clean_indicators(r.legacy_indicators), r.mapped->>'legacyStatusRaw', clean_assessments('{}'),
         r.institution_id, p_import, p_uid, p_uid
    from import_rows r
    cross join lateral (select case
           when r.mapped->>'websiteConfirmed' = 'true' and (r.mapped->'websiteCandidates'->>0) ~* '^https?://[^\s<>"]+$'
                and length(r.mapped->'websiteCandidates'->>0) <= 500
                and not (r.issues @> '[{"code": "potential_duplicate"}]'::jsonb or r.issues @> '[{"code": "shared_domain"}]'::jsonb
                         or r.issues @> '[{"code": "website_third_party"}]'::jsonb)
             then r.mapped->'websiteCandidates'->>0 end as url) ok
   where r.import_id = p_import
     and r.section in ('federal_university', 'federal_polytechnic', 'federal_monotechnic', 'state_university', 'state_polytechnic', 'state_monotechnic')
     and nullif(btrim(r.mapped->>'name'), '') is not null
     and r.decision <> 'skip'
     and not exists (select 1 from report_entries e where norm_name(e.name) = norm_name(r.mapped->>'name'));
  get diagnostics n = row_count;
  update report_settings set visible = true, source_import_id = p_import,
         reported_as_of = coalesce(reported_as_of, (select source_reported_as_of from imports where id = p_import)),
         updated_at = now(), updated_by = p_uid;
  return n;
end $$;

-- What the public site shows: verified content only (null while verification is in progress).
create function public_register()
returns table (id uuid, section text, sort_order int, name text, state text, verified jsonb, verified_at timestamptz,
               reported_as_of date)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.section, e.sort_order, coalesce(e.verified->>'name', e.name),
         coalesce(e.verified->>'state', e.state), e.verified, e.verified_at, s.reported_as_of
    from report_entries e cross join report_settings s
   where s.visible
   order by case e.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 when 'federal_monotechnic' then 3
                           when 'state_university' then 4 when 'state_polytechnic' then 5 else 6 end, e.sort_order, e.name
$$;

-- The earlier public functions now expose verified content only, so a site still running an older
-- build stops showing unverified spreadsheet ticks as soon as this migration is applied.
create or replace function public_report()
returns table (id uuid, section text, sort_order int, name text, state text, head_name text, bursar_name text,
               website_url text, website_text text, report_status text, indicators jsonb, institution_slug text,
               reported_as_of date, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.section, e.sort_order, coalesce(e.verified->>'name', e.name), coalesce(e.verified->>'state', e.state),
         e.verified->>'head_name', e.verified->>'bursar_name',
         coalesce(e.verified->>'disclosure_url', e.verified->>'homepage_url'),
         case when e.verified is null then 'Verification in progress' end,
         'not_recorded',
         coalesce((select jsonb_object_agg(k, case when v->>'status' in ('published', 'nil') then 'true'::jsonb
                                                    when v->>'status' = 'not_found' then 'false'::jsonb else 'null'::jsonb end)
                     from jsonb_each(e.verified->'assessments') as t(k, v)), '{}'::jsonb),
         null::text, s.reported_as_of, e.verified_at
    from report_entries e cross join report_settings s
   where s.visible
   order by case e.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 when 'federal_monotechnic' then 3
                           when 'state_university' then 4 when 'state_polytechnic' then 5 else 6 end, e.sort_order, e.name
$$;

create or replace function tracker_report()
returns table (section text, section_index int, serial text, name text, state text, head_name text, bursar_name text,
               website_text text, website_url text, report_status text, indicators jsonb, institution_slug text,
               reported_as_of date, published_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.section, p.sort_order, p.sort_order::text, p.name, p.state, p.head_name, p.bursar_name, p.website_text,
         p.website_url, null::text, p.indicators, p.institution_slug, p.reported_as_of, p.updated_at
    from public_report() p
$$;

alter table report_link_checks enable row level security;
revoke all on report_link_checks from public, nut_anon, nut_member, nut_system, nut_worker;
grant select on report_link_checks to nut_member;
create policy team_read on report_link_checks for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));

revoke execute on function clean_assessments(jsonb), clean_extra_links(jsonb), register_content(report_entries),
  register_hash(report_entries), is_homepage_url(text), verify_report_entry(uuid, text), return_report_entry(uuid, text),
  save_link_checks(uuid, jsonb), public_register()
  from public, nut_anon, nut_member, nut_system, nut_worker;
grant execute on function verify_report_entry(uuid, text), return_report_entry(uuid, text), save_link_checks(uuid, jsonb),
  register_content(report_entries), register_hash(report_entries) to nut_member;
grant execute on function public_register() to nut_anon, nut_member;

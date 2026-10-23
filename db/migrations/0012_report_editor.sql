-- The public compliance report becomes directly editable in the CMS.
--
-- report_entries holds the live report table (federal institutions only). Showing an uploaded
-- spreadsheet copies its federal rows in, replacing the table; after that, reviewers and
-- administrators update any row, add or remove institutions and change the "as at" date. Every
-- change goes live at once and is audited with the values before and after. The uploaded import
-- itself is never changed, so the original spreadsheet stays as provenance.

create table report_entries (
  id               uuid primary key default gen_random_uuid(),
  section          text not null check (section in ('federal_university', 'federal_polytechnic', 'federal_monotechnic')),
  sort_order         int  not null default 0,
  name             text not null check (length(btrim(name)) between 1 and 300),
  state            text check (state is null or length(state) <= 60),
  head_name        text check (head_name is null or length(head_name) <= 200),
  bursar_name      text check (bursar_name is null or length(bursar_name) <= 200),
  website_url      text check (website_url is null or (website_url ~* '^https?://[^\s<>"]+$' and length(website_url) <= 500)),
  website_text     text check (website_text is null or length(website_text) <= 500),
  report_status    text not null default 'not_recorded'
                     check (report_status in ('updated', 'partial', 'not_updated', 'not_yet_updated', 'not_recorded')),
  indicators       jsonb not null default '{}',
  institution_id   uuid references institutions(id),
  source_import_id uuid references imports(id),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
create index report_entries_order on report_entries (section, sort_order, name);

-- One row: whether the report is shown, and the date it is "as at".
create table report_settings (
  id               boolean primary key default true check (id),
  visible          boolean not null default false,
  reported_as_of   date,
  source_import_id uuid references imports(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
insert into report_settings (id) values (true);

create function report_status_code(p_raw text) returns text language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_raw, '')), '') is null then 'not_recorded'
    when upper(btrim(p_raw)) like 'YES%' then 'updated'
    when upper(btrim(p_raw)) like 'PARTIAL%' then 'partial'
    when upper(btrim(p_raw)) like '%NOT YET%' then 'not_yet_updated'
    when upper(btrim(p_raw)) like 'NO%' then 'not_updated'
    else 'not_recorded' end
$$;

-- Keep only the nine indicator keys, each true, false or null.
create function clean_indicators(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(d.key,
           case when jsonb_typeof(coalesce(p, '{}'::jsonb) -> d.key) = 'boolean' then p -> d.key else 'null'::jsonb end), '{}'::jsonb)
    from indicator_definitions d
$$;

-- Replace the report table with an import's federal rows (the uploaded spreadsheet).
create function load_report_from_import(p_import uuid, p_uid uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  delete from report_entries;
  insert into report_entries (section, sort_order, name, state, head_name, bursar_name, website_url, website_text,
                              report_status, indicators, institution_id, source_import_id, created_by, updated_by)
  select r.section, r.section_index, left(btrim(r.mapped->>'name'), 300),
         left(coalesce(r.mapped->>'stateCanonical', btrim(r.mapped->>'stateRaw')), 60),
         left(btrim(r.mapped->>'head'), 200), left(btrim(r.mapped->>'bursar'), 200),
         case
           when r.mapped->>'websiteConfirmed' = 'true' and (r.mapped->'websiteCandidates'->>0) ~* '^https?://[^\s<>"]+$'
                and length(r.mapped->'websiteCandidates'->>0) <= 500 then r.mapped->'websiteCandidates'->>0
           when btrim(r.mapped->>'websiteRaw') ~* '^https?://[^\s<>"]+$' and length(btrim(r.mapped->>'websiteRaw')) <= 500
             then btrim(r.mapped->>'websiteRaw')
         end,
         left(btrim(r.mapped->>'websiteRaw'), 500),
         report_status_code(r.mapped->>'legacyStatusRaw'),
         clean_indicators(r.legacy_indicators),
         r.institution_id, p_import, p_uid, p_uid
    from import_rows r
   where r.import_id = p_import
     and r.section in ('federal_university', 'federal_polytechnic', 'federal_monotechnic')
     and nullif(btrim(r.mapped->>'name'), '') is not null
     and r.decision <> 'skip';
  get diagnostics n = row_count;
  update report_settings set visible = true, source_import_id = p_import,
         reported_as_of = (select source_reported_as_of from imports where id = p_import), updated_at = now(), updated_by = p_uid;
  return n;
end $$;

-- Showing a spreadsheet now loads it into the editable report (replacing it).
create or replace function publish_tracker_report(p_import uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
  n int;
begin
  if not exists (select 1 from imports where id = p_import) then
    raise exception 'import not found' using errcode = 'P0002';
  end if;
  update public_reports set hidden_at = now(), hidden_by = uid where hidden_at is null;
  insert into public_reports (import_id, published_by) values (p_import, uid);
  n := load_report_from_import(p_import, uid);
  perform audit('report.shown', 'import', p_import, jsonb_build_object('entries', n));
end $$;

create or replace function hide_tracker_report() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
begin
  update public_reports set hidden_at = now(), hidden_by = uid where hidden_at is null;
  update report_settings set visible = false, updated_at = now(), updated_by = uid;
  perform audit('report.hidden', 'report', null, '{}');
end $$;

create function set_report_settings(p_visible boolean, p_reported_as_of date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
begin
  if p_reported_as_of is not null and (p_reported_as_of < date '2000-01-01' or p_reported_as_of > current_date + 1) then
    raise exception 'choose a report date between 2000 and today' using errcode = '22023';
  end if;
  update report_settings set visible = coalesce(p_visible, visible), reported_as_of = p_reported_as_of,
         updated_at = now(), updated_by = uid;
  perform audit('report.settings_saved', 'report', null, jsonb_build_object('visible', p_visible, 'reported_as_of', p_reported_as_of));
end $$;

-- Add (p_id null) or update one institution in the report. Reviewers and administrators.
create function save_report_entry(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('reviewer', 'admin');
  before report_entries;
  after  report_entries;
  sect   text := p->>'section';
  url    text := nullif(btrim(coalesce(p->>'website_url', '')), '');
  stat   text := coalesce(nullif(p->>'report_status', ''), 'not_recorded');
begin
  if sect not in ('federal_university', 'federal_polytechnic', 'federal_monotechnic') then
    raise exception 'choose federal university, polytechnic or monotechnic' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p->>'name', '')), '') is null then
    raise exception 'enter the institution''s name' using errcode = '22023';
  end if;
  if url is not null and (url !~* '^https?://[^\s<>"]+$' or length(url) > 500) then
    raise exception 'the website must be a full address starting with https://' using errcode = '22023';
  end if;
  if stat not in ('updated', 'partial', 'not_updated', 'not_yet_updated', 'not_recorded') then
    raise exception 'choose a financial report status' using errcode = '22023';
  end if;
  if p_id is null then
    insert into report_entries (section, sort_order, name, state, head_name, bursar_name, website_url, report_status, indicators,
                                created_by, updated_by)
    values (sect, coalesce((select max(sort_order) + 1 from report_entries where section = sect), 1),
            left(btrim(p->>'name'), 300), left(nullif(btrim(p->>'state'), ''), 60), left(nullif(btrim(p->>'head_name'), ''), 200),
            left(nullif(btrim(p->>'bursar_name'), ''), 200), url, stat, clean_indicators(p->'indicators'), uid, uid)
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
      website_url = url,
      website_text = case when url is not null then null else website_text end,
      report_status = stat,
      indicators = clean_indicators(p->'indicators'),
      updated_at = now(), updated_by = uid
    where id = p_id returning * into after;
    perform audit('report.entry_updated', 'report_entry', p_id, jsonb_build_object(
      'before', jsonb_build_object('name', before.name, 'state', before.state, 'head', before.head_name, 'bursar', before.bursar_name,
                                   'website', before.website_url, 'status', before.report_status, 'indicators', before.indicators),
      'after', jsonb_build_object('name', after.name, 'state', after.state, 'head', after.head_name, 'bursar', after.bursar_name,
                                  'website', after.website_url, 'status', after.report_status, 'indicators', after.indicators)));
  end if;
  return after.id;
end $$;

create function delete_report_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
  gone report_entries;
begin
  delete from report_entries where id = p_id returning * into gone;
  if not found then raise exception 'that institution is no longer in the report' using errcode = 'P0002'; end if;
  perform audit('report.entry_removed', 'report_entry', p_id, to_jsonb(gone) - 'created_by' - 'updated_by');
end $$;

-- The previous public reader keeps working (same columns) for a site still running the earlier
-- build, so the migration and the new deployment can happen in either order.
create or replace function tracker_report()
returns table (section text, section_index int, serial text, name text, state text, head_name text, bursar_name text,
               website_text text, website_url text, report_status text, indicators jsonb, institution_slug text,
               reported_as_of date, published_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.section, e.sort_order, e.sort_order::text, e.name, e.state, e.head_name, e.bursar_name,
         coalesce(e.website_text, e.website_url), e.website_url,
         case e.report_status when 'updated' then 'YES' when 'partial' then 'PARTIAL' when 'not_updated' then 'NO'
                              when 'not_yet_updated' then 'NOT YET UPDATED' end,
         e.indicators,
         (select i.slug from institutions i where i.id = e.institution_id and i.current_published_revision is not null),
         s.reported_as_of, s.updated_at
    from report_entries e cross join report_settings s
   where s.visible
   order by case e.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 else 3 end, e.sort_order, e.name
$$;

-- What the public site shows.
create function public_report()
returns table (id uuid, section text, sort_order int, name text, state text, head_name text, bursar_name text,
               website_url text, website_text text, report_status text, indicators jsonb, institution_slug text,
               reported_as_of date, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.section, e.sort_order, e.name, e.state, e.head_name, e.bursar_name, e.website_url, e.website_text,
         e.report_status, e.indicators,
         (select i.slug from institutions i where i.id = e.institution_id and i.current_published_revision is not null),
         s.reported_as_of, e.updated_at
    from report_entries e cross join report_settings s
   where s.visible
   order by case e.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 else 3 end, e.sort_order, e.name
$$;

-- Carry over a report that was already shown under 0011.
do $$
declare
  shown record;
begin
  select import_id, published_by into shown from public_reports where hidden_at is null limit 1;
  if found then perform load_report_from_import(shown.import_id, shown.published_by); end if;
end $$;

alter table report_entries enable row level security;
alter table report_settings enable row level security;
revoke all on report_entries, report_settings from public, nut_anon, nut_member, nut_system, nut_worker;
grant select on report_entries, report_settings to nut_member;
create policy team_read on report_entries  for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on report_settings for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));

revoke execute on function report_status_code(text), clean_indicators(jsonb), load_report_from_import(uuid, uuid),
  set_report_settings(boolean, date), save_report_entry(uuid, jsonb), delete_report_entry(uuid), public_report()
  from public, nut_anon, nut_member, nut_system, nut_worker;
grant execute on function set_report_settings(boolean, date), save_report_entry(uuid, jsonb), delete_report_entry(uuid) to nut_member;
grant execute on function public_report() to nut_anon, nut_member;

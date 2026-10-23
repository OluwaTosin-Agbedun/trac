-- State institutions are back, and the public report shows only what the importer could stand behind.
--
-- 1. report_entries accepts the three state categories again (federal and state universities,
--    polytechnics and monotechnics); loading a spreadsheet keeps its state sections.
-- 2. When a spreadsheet is loaded into the report, a web address is linked only when the importer
--    confirmed it (one valid address as written or the cell's real hyperlink) and it is not shared
--    with another institution, a possible duplicate or a third-party site. Otherwise the cell text
--    is kept for editors to check, and nothing is linked.
-- 3. A state is filled in only when the state cell is a Nigerian state that does not contradict the
--    institution's name (e.g. "Federal University, Otuoke, Bayelsa" listed under Anambra is left blank).
-- 4. Entries loaded under 0012 and never edited since are corrected the same way.

alter table report_entries drop constraint if exists report_entries_section_check;
alter table report_entries add constraint report_entries_section_check check (section in ('federal_university', 'federal_polytechnic', 'federal_monotechnic', 'state_university', 'state_polytechnic', 'state_monotechnic'));

create or replace function load_report_from_import(p_import uuid, p_uid uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  delete from report_entries;
  insert into report_entries (section, sort_order, name, state, head_name, bursar_name, website_url, website_text,
                              report_status, indicators, institution_id, source_import_id, created_by, updated_by)
  select r.section, r.section_index, left(btrim(r.mapped->>'name'), 300),
         case when r.issues @> '[{"code": "state_conflict"}]'::jsonb then null else r.mapped->>'stateCanonical' end,
         left(btrim(r.mapped->>'head'), 200), left(btrim(r.mapped->>'bursar'), 200),
         case
           when r.mapped->>'websiteConfirmed' = 'true' and (r.mapped->'websiteCandidates'->>0) ~* '^https?://[^\s<>"]+$'
                and length(r.mapped->'websiteCandidates'->>0) <= 500
                and not (r.issues @> '[{"code": "potential_duplicate"}]'::jsonb or r.issues @> '[{"code": "shared_domain"}]'::jsonb
                         or r.issues @> '[{"code": "website_third_party"}]'::jsonb)
             then r.mapped->'websiteCandidates'->>0
         end,
         left(btrim(r.mapped->>'websiteRaw'), 500),
         report_status_code(r.mapped->>'legacyStatusRaw'),
         clean_indicators(r.legacy_indicators),
         r.institution_id, p_import, p_uid, p_uid
    from import_rows r
   where r.import_id = p_import
     and r.section in ('federal_university', 'federal_polytechnic', 'federal_monotechnic', 'state_university', 'state_polytechnic', 'state_monotechnic')
     and nullif(btrim(r.mapped->>'name'), '') is not null
     and r.decision <> 'skip';
  get diagnostics n = row_count;
  update report_settings set visible = true, source_import_id = p_import,
         reported_as_of = (select source_reported_as_of from imports where id = p_import), updated_at = now(), updated_by = p_uid;
  return n;
end $$;

create or replace function save_report_entry(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('reviewer', 'admin');
  before report_entries;
  after  report_entries;
  sect   text := p->>'section';
  url    text := nullif(btrim(coalesce(p->>'website_url', '')), '');
  stat   text := coalesce(nullif(p->>'report_status', ''), 'not_recorded');
begin
  if sect not in ('federal_university', 'federal_polytechnic', 'federal_monotechnic', 'state_university', 'state_polytechnic', 'state_monotechnic') then
    raise exception 'choose the category' using errcode = '22023';
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

create or replace function public_report()
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
   order by case e.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 when 'federal_monotechnic' then 3 when 'state_university' then 4 when 'state_polytechnic' then 5 else 6 end, e.sort_order, e.name
$$;

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
   order by case e.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 when 'federal_monotechnic' then 3 when 'state_university' then 4 when 'state_polytechnic' then 5 else 6 end, e.sort_order, e.name
$$;

-- Correct entries loaded before this migration that no one has edited since.
update report_entries e
   set website_url = case
         when r.mapped->>'websiteConfirmed' = 'true'
              and not (r.issues @> '[{"code": "potential_duplicate"}]'::jsonb or r.issues @> '[{"code": "shared_domain"}]'::jsonb
                       or r.issues @> '[{"code": "website_third_party"}]'::jsonb)
           then e.website_url end,
       state = case when r.issues @> '[{"code": "state_conflict"}]'::jsonb then null else r.mapped->>'stateCanonical' end
  from import_rows r
 where r.import_id = e.source_import_id and r.section = e.section and r.section_index = e.sort_order
   and e.updated_at = e.created_at;

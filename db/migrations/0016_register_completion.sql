-- Completing the verified register as the single public path.
--
-- 1. Before its first verification a record is listed publicly under the name, state and category it
--    was imported with (frozen), never the editable working copy. Records added by hand are not
--    listed until they are verified.
-- 2. Saving a record is bound to the version the editor opened (content hash), so two people editing
--    the same record get a visible conflict instead of a silent overwrite.
-- 3. Assignments: an editor, a reviewer and a due date per record. An editor may change a record
--    assigned to them or to nobody.
-- 4. Every verified version is kept. A reviewer can withdraw a verification with a reason. Removing a
--    record archives it with a reason (an administrator can restore it); nothing is destroyed.
-- 5. The scoring rule has a version and an effective date; each verification stores the version and
--    the assessment year it was checked under, so changing either never rescores earlier records.
-- 6. Freshness: evidence for an earlier year than an indicator's period scores 0 (the rule lives in
--    src/lib/register.ts). Verified records are flagged for re-checking after a set number of days.
-- 7. Each record has a stable, readable address (slug). Old profile addresses resolve to it.
-- 8. The head and bursar names need a source page before verification.
-- 9. Imports respect the Import centre: rows held as possible duplicates or with no name wait for a
--    decision, matched rows join the existing record, and a row is never loaded twice. The reasons a
--    row was held travel with the record. Loading no longer switches the public register on or off;
--    only an administrator does, with a reason.
-- 10. A scheduled link check runs without a signed-in member under its own role, nut_cron, which can
--     call exactly two functions.

alter table report_entries
  add column listed_name       text check (listed_name is null or length(btrim(listed_name)) between 1 and 300),
  add column listed_state      text check (listed_state is null or length(listed_state) <= 60),
  add column listed_section    text check (listed_section is null or listed_section in
                                 ('federal_university', 'federal_polytechnic', 'federal_monotechnic',
                                  'state_university', 'state_polytechnic', 'state_monotechnic')),
  add column slug              text,
  add column source_row_id     uuid unique references import_rows(id),
  add column import_flags      text[] not null default '{}',
  add column people_source_url text check (people_source_url is null
                                           or (people_source_url ~* '^https?://[^\s<>"]+$' and length(people_source_url) <= 500)),
  add column assigned_editor   uuid,
  add column assigned_reviewer uuid,
  add column due_on            date,
  add column verified_method   text,
  add column verified_assessment_year int,
  add column archived_at       timestamptz,
  add column archived_by       uuid,
  add column archive_reason    text check (archive_reason is null or length(archive_reason) <= 1000);

create function import_hold_codes(p_issues jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct i->>'code' order by i->>'code'), '{}')
    from jsonb_array_elements(case when jsonb_typeof(p_issues) = 'array' then p_issues else '[]'::jsonb end) i
   where coalesce((i->>'holds')::boolean, false)
$$;

-- Backfill the public listing from the spreadsheet row each record came from (its imported values,
-- not the working copy); a record whose name no longer matches its row keeps its current values.
update report_entries set listed_name = name, listed_state = state, listed_section = section
 where source_import_id is not null;
update report_entries e set listed_name = left(btrim(m.mapped->>'name'), 300),
       listed_state = case when m.issues @> '[{"code": "state_conflict"}]'::jsonb then null
                           else left(m.mapped->>'stateCanonical', 60) end,
       listed_section = m.section, source_row_id = m.row_id, import_flags = import_hold_codes(m.issues)
  from (select distinct on (x.id) x.id as entry_id, r.id as row_id, r.mapped, r.issues, r.section
          from report_entries x
          join import_rows r on r.import_id = x.source_import_id and norm_name(r.mapped->>'name') = norm_name(x.name)
         where r.section in ('federal_university', 'federal_polytechnic', 'federal_monotechnic',
                             'state_university', 'state_polytechnic', 'state_monotechnic')
         order by x.id, r.section_index) m
 where e.id = m.entry_id;

-- Link register records to the institutions the research assistant works on, by name.
update report_entries set institution_id = institution_named(name)
 where institution_id is null and institution_named(name) is not null;

-- Stable, readable addresses.
create function register_slugify(t text) returns text language sql immutable as $$
  select coalesce(nullif(trim(both '-' from left(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g'), 100)), ''), 'institution')
$$;

create function register_unique_slug(p_base text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s text := p_base;
  n int := 1;
begin
  while s in ('record') or exists (select 1 from report_entries where slug = s and id is distinct from p_id) loop
    n := n + 1;
    s := left(p_base, 110) || '-' || n;
  end loop;
  return s;
end $$;

do $$
declare
  r record;
begin
  for r in select e.id, coalesce(i.slug, register_slugify(coalesce(e.listed_name, e.name))) as base
             from report_entries e left join institutions i on i.id = e.institution_id
            order by case e.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 when 'federal_monotechnic' then 3
                                    when 'state_university' then 4 when 'state_polytechnic' then 5 else 6 end, e.sort_order, e.name
  loop
    update report_entries set slug = register_unique_slug(r.base, r.id) where id = r.id;
  end loop;
end $$;
alter table report_entries
  alter column slug set not null,
  add constraint report_entries_slug_key unique (slug),
  add constraint report_entries_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120);

alter table report_settings
  add column assessment_year int check (assessment_year is null or assessment_year between 2000 and 2100),
  add column recheck_days    int not null default 180 check (recheck_days between 30 and 1095);
update report_settings set assessment_year = extract(year from reported_as_of)::int where reported_as_of is not null;

create table register_methods (
  version      text primary key check (version ~ '^[0-9]{4}\.[0-9]+$'),
  effective_on date not null,
  summary      text not null check (length(summary) <= 1000)
);
insert into register_methods (version, effective_on, summary) values
  ('2026.1', date '2026-11-06',
   'Published or explicitly nil: 1 point. Partially published: half a point. Not found: 0. Temporarily inaccessible, '
   'not applicable and not yet assessed are left out. Evidence for a year earlier than the indicator''s period counts 0. '
   'No overall label until every indicator is assessed.');

create function current_register_method() returns text language sql stable security definer set search_path = public, pg_temp as $$
  select version from register_methods where effective_on <= current_date order by effective_on desc, version desc limit 1
$$;

create table report_entry_versions (
  id              bigint generated always as identity primary key,
  entry_id        uuid not null references report_entries(id) on delete cascade,
  content         jsonb not null,
  verified_at     timestamptz not null,
  verified_by     uuid,
  verified_method text,
  assessment_year int,
  superseded_at   timestamptz not null default now(),
  superseded_by   uuid,
  reason          text check (reason is null or length(reason) <= 1000)
);
create index report_entry_versions_entry on report_entry_versions (entry_id, verified_at desc);

-- The content a verifier checks and the public sees now includes the source for the names.
create or replace function register_content(e report_entries) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'name', e.name, 'section', e.section, 'state', e.state, 'head_name', e.head_name, 'bursar_name', e.bursar_name,
    'people_source_url', e.people_source_url,
    'homepage_url', e.homepage_url, 'disclosure_url', e.disclosure_url, 'extra_links', e.extra_links,
    'assessments', e.assessments)
$$;

-- Add (p_id null) or update a record's working copy. p_hash is register_hash() of the version the
-- editor opened; a different current hash means someone else saved in between.
create function save_report_entry(p_id uuid, p jsonb, p_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid     uuid := require_role('editor', 'reviewer', 'admin');
  my_role team_role := current_team_role();
  before  report_entries;
  after   report_entries;
  sect    text := p->>'section';
  home    text := nullif(btrim(coalesce(p->>'homepage_url', '')), '');
  disc    text := nullif(btrim(coalesce(p->>'disclosure_url', '')), '');
  people  text := nullif(btrim(coalesce(p->>'people_source_url', '')), '');
  assess  jsonb;
  links   jsonb;
begin
  if sect is null or sect not in ('federal_university', 'federal_polytechnic', 'federal_monotechnic', 'state_university', 'state_polytechnic', 'state_monotechnic') then
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
  if people is not null and (people !~* '^https?://[^\s<>"]+$' or length(people) > 500) then
    raise exception 'the source for the head and bursar must be a full address starting with https://' using errcode = '22023';
  end if;
  assess := clean_assessments(p->'assessments');
  links := clean_extra_links(p->'extra_links');
  if p_id is null then
    insert into report_entries (section, sort_order, name, slug, state, head_name, bursar_name, people_source_url, homepage_url,
                                disclosure_url, extra_links, assessments, editors, pending, created_by, updated_by)
    values (sect, coalesce((select max(sort_order) + 1 from report_entries where section = sect), 1),
            left(btrim(p->>'name'), 300), register_unique_slug(register_slugify(p->>'name'), null),
            left(nullif(btrim(p->>'state'), ''), 60), left(nullif(btrim(p->>'head_name'), ''), 200),
            left(nullif(btrim(p->>'bursar_name'), ''), 200), people, home, disc, links, assess, array[uid], true, uid, uid)
    returning * into after;
    perform audit('report.entry_added', 'report_entry', after.id, jsonb_build_object('name', after.name));
    return after.id;
  end if;

  select * into before from report_entries where id = p_id for update;
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
  update report_entries set
    section = sect,
    sort_order = case when sect = before.section then sort_order
                      else coalesce((select max(sort_order) + 1 from report_entries where section = sect), 1) end,
    name = left(btrim(p->>'name'), 300),
    state = left(nullif(btrim(p->>'state'), ''), 60),
    head_name = left(nullif(btrim(p->>'head_name'), ''), 200),
    bursar_name = left(nullif(btrim(p->>'bursar_name'), ''), 200),
    people_source_url = people,
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
  return after.id;
end $$;

-- The two-argument form cannot detect concurrent edits; a page from an older build gets a reload message.
create or replace function save_report_entry(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_role('editor', 'reviewer', 'admin');
  raise exception 'conflict: the site was updated; reload the page and save again' using errcode = '40001';
end $$;

-- Verification (the 0015 rules, plus: a four-digit year for published and partially published
-- findings, a source for the head and bursar, archived records refused). The previous verified
-- version is kept, with the rule version and assessment year it was checked under.
create or replace function verify_report_entry(p_id uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('reviewer', 'admin');
  e   report_entries;
  d   record;
  a   jsonb;
  ev  text;
  c   record;
  yr  int := (select assessment_year from report_settings limit 1);
  problems text[] := '{}';
begin
  select * into e from report_entries where id = p_id for update;
  if not found then raise exception 'that institution is no longer in the report' using errcode = 'P0002'; end if;
  if e.archived_at is not null then
    raise exception 'this institution was removed from the register; an administrator can restore it' using errcode = '22023';
  end if;
  if uid = any (e.editors) then
    raise exception 'you edited this record, so another reviewer must verify it' using errcode = '42501';
  end if;
  if register_hash(e) is distinct from p_hash then
    raise exception 'conflict: this record changed since you opened it; reload and check it again' using errcode = '40001';
  end if;
  if e.homepage_url is null then problems := problems || 'the homepage is missing'::text; end if;
  if (e.head_name is not null or e.bursar_name is not null) and e.people_source_url is null then
    problems := problems || 'add the page that names the head and bursar (it can be the homepage), or clear the names'::text;
  end if;
  if e.disclosure_url is not null then
    if is_homepage_url(e.disclosure_url) then
      problems := problems || 'the disclosure page is the homepage, not a page showing the information'::text;
    elsif e.homepage_url is not null and not same_site(e.disclosure_url, e.homepage_url) then
      problems := problems || format('the disclosure page is on another website (%s), not the institution''s (%s)',
                                     site_of(e.disclosure_url), site_of(e.homepage_url));
    end if;
  end if;
  for d in select key, label from indicator_definitions order by sort_order loop
    a := e.assessments -> d.key;
    ev := a->>'evidence_url';
    if (a->>'status') = 'not_assessed' or a is null then
      problems := problems || format('%s is not assessed', d.label);
    elsif (a->>'status') in ('published', 'partial', 'nil') then
      if ev is null and e.disclosure_url is null then problems := problems || format('%s has no evidence link', d.label); end if;
      if (a->>'status') <> 'nil' and a->>'year' is null then
        problems := problems || format('%s has no reporting year', d.label);
      elsif (a->>'status') <> 'nil' and (a->>'year') !~ '(19|20)[0-9]{2}' then
        problems := problems || format('the %s reporting year must include a four-digit year, for example 2025 or 2024/2025', d.label);
      end if;
      if a->>'checked_on' is null then problems := problems || format('%s has no checked date', d.label); end if;
    elsif (a->>'status') in ('not_found', 'inaccessible') then
      if a->>'checked_on' is null then problems := problems || format('%s has no checked date', d.label); end if;
    elsif (a->>'status') = 'not_applicable' then
      if a->>'note' is null then problems := problems || format('%s needs a reason for not applicable', d.label); end if;
    end if;
    if ev is not null and is_homepage_url(ev) then
      problems := problems || format('the %s evidence is the homepage, not a page showing the information', d.label);
    elsif ev is not null and e.homepage_url is not null and not same_site(ev, e.homepage_url) then
      problems := problems || format('the %s evidence is on another website (%s)', d.label, site_of(ev));
    end if;
  end loop;
  for c in
    select distinct on (l.url) l.url, l.result
      from report_link_checks l
     where l.entry_id = p_id
       and l.url in (select e.disclosure_url
                     union select x.value->>'evidence_url' from jsonb_each(e.assessments) x)
     order by l.url, l.checked_at desc
  loop
    if c.result in ('not_found', 'homepage', 'redirects_to_homepage', 'other_site') then
      problems := problems || format('the last link check of %s found %s; fix the link or check it again',
        c.url, case c.result when 'not_found' then 'a dead link' when 'homepage' then 'only the homepage'
                             when 'redirects_to_homepage' then 'a redirect to the homepage' else 'another website' end);
    end if;
  end loop;
  if array_length(problems, 1) > 0 then
    raise exception 'not ready to verify: %', array_to_string(problems, '; ') using errcode = '22023';
  end if;
  if e.verified is not null then
    insert into report_entry_versions (entry_id, content, verified_at, verified_by, verified_method, assessment_year, superseded_by, reason)
    values (p_id, e.verified, e.verified_at, e.verified_by, e.verified_method, e.verified_assessment_year, uid,
            'replaced by a newer verification');
  end if;
  update report_entries set verified = register_content(e), verified_at = now(), verified_by = uid,
         verified_method = current_register_method(), verified_assessment_year = yr,
         pending = false, editors = '{}', return_note = null
   where id = p_id;
  perform audit('report.entry_verified', 'report_entry', p_id,
                jsonb_build_object('hash', p_hash, 'method', current_register_method(), 'assessment_year', yr));
end $$;

-- Take a verified record off the public site (it shows "Verification in progress" again) with a
-- reason. The verified copy is kept in the history and the reason goes to the editor.
create function withdraw_report_verification(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('reviewer', 'admin');
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  e      report_entries;
begin
  if reason is null or length(reason) < 5 or length(reason) > 900 then
    raise exception 'give the reason for withdrawing the verification (5 to 900 characters)' using errcode = '22023';
  end if;
  select * into e from report_entries where id = p_id for update;
  if not found then raise exception 'that institution is no longer in the report' using errcode = 'P0002'; end if;
  if e.verified is null then raise exception 'this record is not verified, so there is nothing to withdraw' using errcode = '22023'; end if;
  insert into report_entry_versions (entry_id, content, verified_at, verified_by, verified_method, assessment_year, superseded_by, reason)
  values (p_id, e.verified, e.verified_at, e.verified_by, e.verified_method, e.verified_assessment_year, uid, reason);
  update report_entries set verified = null, verified_at = null, verified_by = null, verified_method = null,
         verified_assessment_year = null, pending = true, return_note = 'Verification withdrawn: ' || reason
   where id = p_id;
  perform audit('report.verification_withdrawn', 'report_entry', p_id, jsonb_build_object('reason', reason));
end $$;

-- Removing a record archives it: it leaves the public site and the working lists, and keeps its
-- history. An administrator can restore it.
create function archive_report_entry(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('admin');
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if reason is null or length(reason) < 5 or length(reason) > 1000 then
    raise exception 'give the reason for removing this institution (5 to 1,000 characters)' using errcode = '22023';
  end if;
  update report_entries set archived_at = now(), archived_by = uid, archive_reason = reason
   where id = p_id and archived_at is null;
  if not found then raise exception 'that institution is not in the register' using errcode = 'P0002'; end if;
  perform audit('report.entry_archived', 'report_entry', p_id, jsonb_build_object('reason', reason));
end $$;

create function restore_report_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
begin
  update report_entries set archived_at = null, archived_by = null, archive_reason = null
   where id = p_id and archived_at is not null;
  if not found then raise exception 'that institution is not archived' using errcode = 'P0002'; end if;
  perform audit('report.entry_restored', 'report_entry', p_id, '{}');
end $$;

-- Records are no longer deleted: a page from an older build gets a reload message.
create or replace function delete_report_entry(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_role('admin');
  raise exception 'conflict: the site was updated; reload the page and remove the institution with a reason' using errcode = '40001';
end $$;

-- Assign records (up to 500 at a time) to an editor and a reviewer, with an optional due date.
-- Passing nulls clears the assignment.
create function assign_report_entries(p_ids uuid[], p_editor uuid, p_reviewer uuid, p_due_on date) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('reviewer', 'admin');
  rid uuid;
  n   int := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'choose between 1 and 500 records' using errcode = '22023';
  end if;
  if p_editor is not null and not exists (
       select 1 from team_memberships where user_id = p_editor and active and role in ('editor', 'reviewer', 'admin')) then
    raise exception 'editor must be an active team member' using errcode = '23514';
  end if;
  if p_reviewer is not null and not exists (
       select 1 from team_memberships where user_id = p_reviewer and active and role in ('reviewer', 'admin')) then
    raise exception 'reviewer must be an active reviewer or administrator' using errcode = '23514';
  end if;
  if p_editor is not null and p_editor = p_reviewer then
    raise exception 'the editor and reviewer must be different people' using errcode = '23514';
  end if;
  if p_due_on is not null and (p_due_on < current_date - 1 or p_due_on > current_date + 730) then
    raise exception 'choose a due date between today and two years from now' using errcode = '22023';
  end if;
  for rid in update report_entries set assigned_editor = p_editor, assigned_reviewer = p_reviewer, due_on = p_due_on
              where id = any (p_ids) and archived_at is null returning id loop
    perform audit('report.entry_assigned', 'report_entry', rid,
                  jsonb_build_object('editor_id', p_editor, 'reviewer_id', p_reviewer, 'due_on', p_due_on));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Dates and years (administrators). Visibility is a separate, explained action.
create function set_report_settings(p_reported_as_of date, p_assessment_year int, p_recheck_days int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
begin
  if p_reported_as_of is not null and (p_reported_as_of < date '2000-01-01' or p_reported_as_of > current_date + 1) then
    raise exception 'choose a report date between 2000 and today' using errcode = '22023';
  end if;
  if p_assessment_year is not null and (p_assessment_year < 2000 or p_assessment_year > extract(year from current_date)::int + 1) then
    raise exception 'choose an assessment year between 2000 and next year' using errcode = '22023';
  end if;
  if p_recheck_days is null or p_recheck_days < 30 or p_recheck_days > 1095 then
    raise exception 'choose a re-check interval between 30 and 1,095 days' using errcode = '22023';
  end if;
  update report_settings set reported_as_of = p_reported_as_of, assessment_year = p_assessment_year,
         recheck_days = p_recheck_days, updated_at = now(), updated_by = uid;
  perform audit('report.settings_saved', 'report', null, jsonb_build_object('reported_as_of', p_reported_as_of,
                'assessment_year', p_assessment_year, 'recheck_days', p_recheck_days));
end $$;

create or replace function set_report_settings(p_visible boolean, p_reported_as_of date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_role('admin');
  raise exception 'conflict: the site was updated; reload the page and save the settings again' using errcode = '40001';
end $$;

-- Show or hide the whole public register, with a reason (administrators).
create function set_register_visibility(p_visible boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('admin');
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_visible is null then raise exception 'choose whether the register is shown' using errcode = '22023'; end if;
  if reason is null or length(reason) < 5 or length(reason) > 500 then
    raise exception 'give the reason for showing or hiding the register (5 to 500 characters)' using errcode = '22023';
  end if;
  update report_settings set visible = p_visible, updated_at = now(), updated_by = uid;
  perform audit(case when p_visible then 'report.shown' else 'report.hidden' end, 'report', null, jsonb_build_object('reason', reason));
end $$;

-- The Import centre no longer hides the whole public register.
create or replace function hide_tracker_report() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_role('admin');
  raise exception 'hide or show the register under Compliance report, Report settings' using errcode = '22023';
end $$;

-- Loading a spreadsheet adds institutions the register does not have yet:
--   * rows the Import centre skipped are left out;
--   * rows held as a possible duplicate (or with no name) wait until someone decides them;
--   * a row matched to an institution that already has a register record joins it (nothing is added);
--   * a row already loaded, or whose name a record already has (archived ones included), is not added.
-- The imported name, state and category become the public listing until the first verification.
-- Only the very first load switches the register on.
create or replace function load_report_from_import(p_import uuid, p_uid uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r   record;
  url text;
  n   int := 0;
begin
  for r in
    select ir.*, case when ir.issues @> '[{"code": "state_conflict"}]'::jsonb then null
                      else left(ir.mapped->>'stateCanonical', 60) end as state_value
      from import_rows ir
     where ir.import_id = p_import
       and ir.section in ('federal_university', 'federal_polytechnic', 'federal_monotechnic', 'state_university', 'state_polytechnic', 'state_monotechnic')
       and nullif(btrim(ir.mapped->>'name'), '') is not null
       and ir.decision <> 'skip'
       and not (ir.decision = 'pending' and import_hold_codes(ir.issues) && array['potential_duplicate', 'missing_name'])
       and not exists (select 1 from report_entries e where e.source_row_id = ir.id)
       and not exists (select 1 from report_entries e where norm_name(e.name) = norm_name(ir.mapped->>'name'))
       and not (ir.decision = 'match_existing' and exists (select 1 from report_entries e where e.institution_id = ir.institution_id))
     order by ir.section, ir.section_index
  loop
    -- Re-checked here: two rows of the same file can share a name or a matched institution.
    continue when exists (select 1 from report_entries e where norm_name(e.name) = norm_name(r.mapped->>'name'))
               or (r.decision = 'match_existing' and exists (select 1 from report_entries e where e.institution_id = r.institution_id));
    url := case when r.mapped->>'websiteConfirmed' = 'true' and (r.mapped->'websiteCandidates'->>0) ~* '^https?://[^\s<>"]+$'
                     and length(r.mapped->'websiteCandidates'->>0) <= 500
                     and not (r.issues @> '[{"code": "potential_duplicate"}]'::jsonb or r.issues @> '[{"code": "shared_domain"}]'::jsonb
                              or r.issues @> '[{"code": "website_third_party"}]'::jsonb)
                then r.mapped->'websiteCandidates'->>0 end;
    insert into report_entries (section, sort_order, name, slug, state, head_name, bursar_name, homepage_url, disclosure_url,
                                website_text, tracker_claims, tracker_status, assessments, institution_id, source_import_id,
                                source_row_id, listed_name, listed_state, listed_section, import_flags, created_by, updated_by)
    values (r.section, r.section_index, left(btrim(r.mapped->>'name'), 300),
            register_unique_slug(coalesce((select i.slug from institutions i where i.id = r.institution_id),
                                          register_slugify(r.mapped->>'name')), null),
            r.state_value, left(btrim(r.mapped->>'head'), 200), left(btrim(r.mapped->>'bursar'), 200),
            case when url is not null and is_homepage_url(url) then url end,
            case when url is not null and not is_homepage_url(url) then url end,
            left(btrim(r.mapped->>'websiteRaw'), 500),
            clean_indicators(r.legacy_indicators), r.mapped->>'legacyStatusRaw', clean_assessments('{}'),
            r.institution_id, p_import, r.id,
            left(btrim(r.mapped->>'name'), 300), r.state_value, r.section, import_hold_codes(r.issues), p_uid, p_uid);
    n := n + 1;
  end loop;
  update report_settings set visible = case when source_import_id is null then true else visible end,
         source_import_id = p_import,
         reported_as_of = coalesce(reported_as_of, (select source_reported_as_of from imports where id = p_import)),
         assessment_year = coalesce(assessment_year, extract(year from (select source_reported_as_of from imports where id = p_import))::int),
         updated_at = now(), updated_by = p_uid;
  return n;
end $$;

-- What the public sees: verified content, else the frozen imported listing. Hand-added records
-- appear only once verified; archived records never.
drop function public_register();
create function public_register()
returns table (id uuid, slug text, section text, sort_order int, name text, state text, verified jsonb, verified_at timestamptz,
               verified_method text, verified_assessment_year int, reported_as_of date, assessment_year int)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.slug, coalesce(e.verified->>'section', e.listed_section), e.sort_order,
         coalesce(e.verified->>'name', e.listed_name), coalesce(e.verified->>'state', e.listed_state),
         e.verified, e.verified_at, e.verified_method, e.verified_assessment_year, s.reported_as_of, s.assessment_year
    from report_entries e cross join report_settings s
   where s.visible and e.archived_at is null and (e.verified is not null or e.listed_name is not null)
   order by case coalesce(e.verified->>'section', e.listed_section)
              when 'federal_university' then 1 when 'federal_polytechnic' then 2 when 'federal_monotechnic' then 3
              when 'state_university' then 4 when 'state_polytechnic' then 5 else 6 end, e.sort_order, 5
$$;

-- Whether the register is shown, and its headline facts (so a hidden register is not mistaken for an
-- empty one).
create function public_register_status()
returns table (visible boolean, listed int, verified int, last_verified_at timestamptz, reported_as_of date, assessment_year int)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.visible,
         (select count(*)::int from report_entries e where s.visible and e.archived_at is null
             and (e.verified is not null or e.listed_name is not null)),
         (select count(*)::int from report_entries e where s.visible and e.archived_at is null and e.verified is not null),
         (select max(e.verified_at) from report_entries e where s.visible and e.archived_at is null),
         case when s.visible then s.reported_as_of end, case when s.visible then s.assessment_year end
    from report_settings s
$$;

-- Earlier verified versions of one public record (content only; withdrawal reasons stay internal).
create function public_register_versions(p_id uuid)
returns table (verified_at timestamptz, superseded_at timestamptz, verified_method text, assessment_year int, content jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.verified_at, v.superseded_at, v.verified_method, v.assessment_year, v.content
    from report_entry_versions v
    join report_entries e on e.id = v.entry_id
    cross join report_settings s
   where s.visible and e.archived_at is null and v.entry_id = p_id
   order by v.verified_at desc
   limit 50
$$;

-- Resolve a public address to a register record: its own slug, an old profile slug
-- (/institutions/<institution slug>) or the record's id.
create function public_register_resolve(p_key text)
returns table (id uuid, slug text)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.slug
    from report_entries e
    left join institutions i on i.id = e.institution_id
    cross join report_settings s
   where s.visible and e.archived_at is null and (e.verified is not null or e.listed_name is not null)
     and (e.slug = p_key or i.slug = p_key or e.id::text = lower(p_key))
   order by (e.slug = p_key) desc, e.verified_at desc nulls last
   limit 1
$$;

create function public_register_methods()
returns table (version text, effective_on date, summary text)
language sql stable security definer set search_path = public, pg_temp as $$
  select version, effective_on, summary from register_methods order by effective_on desc, version desc
$$;

-- The older public readers use the same listing rule.
create or replace function public_report()
returns table (id uuid, section text, sort_order int, name text, state text, head_name text, bursar_name text,
               website_url text, website_text text, report_status text, indicators jsonb, institution_slug text,
               reported_as_of date, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, coalesce(e.verified->>'section', e.listed_section), e.sort_order,
         coalesce(e.verified->>'name', e.listed_name), coalesce(e.verified->>'state', e.listed_state),
         e.verified->>'head_name', e.verified->>'bursar_name',
         coalesce(e.verified->>'disclosure_url', e.verified->>'homepage_url'),
         case when e.verified is null then 'Verification in progress' end,
         'not_recorded',
         coalesce((select jsonb_object_agg(k, case when v->>'status' in ('published', 'nil') then 'true'::jsonb
                                                    when v->>'status' = 'not_found' then 'false'::jsonb else 'null'::jsonb end)
                     from jsonb_each(e.verified->'assessments') as t(k, v)), '{}'::jsonb),
         null::text, s.reported_as_of, e.verified_at
    from report_entries e cross join report_settings s
   where s.visible and e.archived_at is null and (e.verified is not null or e.listed_name is not null)
   order by case coalesce(e.verified->>'section', e.listed_section)
              when 'federal_university' then 1 when 'federal_polytechnic' then 2 when 'federal_monotechnic' then 3
              when 'state_university' then 4 when 'state_polytechnic' then 5 else 6 end, e.sort_order, 4
$$;

-- Scheduled link checks run as nut_cron, which can call only these two functions.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nut_cron') then
    create role nut_cron nologin;
  end if;
  if exists (select 1 from pg_roles where rolname = 'nut_app') then
    grant nut_cron to nut_app;
  end if;
end $$;
grant usage on schema public to nut_cron;

-- The records checked longest ago (or never), with the addresses to check: the working copy's and
-- the verified copy's (the public evidence keeps being watched after verification).
create function system_register_links_due(p_limit int)
returns table (id uuid, homepage_url text, disclosure_url text, extra_links jsonb, assessments jsonb,
               verified_homepage_url text, verified_disclosure_url text, verified_extra_links jsonb, verified_assessments jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.homepage_url, e.disclosure_url, e.extra_links, e.assessments,
         e.verified->>'homepage_url', e.verified->>'disclosure_url', e.verified->'extra_links', e.verified->'assessments'
    from report_entries e
   where e.archived_at is null and (e.homepage_url is not null or e.disclosure_url is not null or e.verified is not null)
   order by (select max(checked_at) from report_link_checks c where c.entry_id = e.id) nulls first, e.verified_at nulls last, e.id
   limit least(greatest(coalesce(p_limit, 0), 0), 50)
$$;

create function system_save_link_checks(p_entry uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c jsonb;
begin
  if not exists (select 1 from report_entries where id = p_entry) then return; end if;
  for c in select value from jsonb_array_elements(coalesce(p, '[]'::jsonb)) limit 30 loop
    insert into report_link_checks (entry_id, url, kind, result, http_status, final_url, detail, checked_by)
    values (p_entry, left(c->>'url', 500), left(c->>'kind', 60), c->>'result', nullif(c->>'http_status', '')::int,
            left(c->>'final_url', 500), left(c->>'detail', 300), null);
  end loop;
end $$;

alter table register_methods enable row level security;
alter table report_entry_versions enable row level security;
revoke all on register_methods, report_entry_versions from public, nut_anon, nut_member, nut_system, nut_worker, nut_cron;
grant select on register_methods, report_entry_versions to nut_member;
create policy team_read on register_methods      for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on report_entry_versions for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));

revoke execute on function import_hold_codes(jsonb), register_slugify(text), register_unique_slug(text, uuid), current_register_method(),
  save_report_entry(uuid, jsonb, text), withdraw_report_verification(uuid, text), archive_report_entry(uuid, text),
  restore_report_entry(uuid), assign_report_entries(uuid[], uuid, uuid, date), set_report_settings(date, int, int),
  set_register_visibility(boolean, text), public_register(), public_register_status(), public_register_versions(uuid),
  public_register_resolve(text), public_register_methods(), system_register_links_due(int), system_save_link_checks(uuid, jsonb)
  from public, nut_anon, nut_member, nut_system, nut_worker, nut_cron;
grant execute on function save_report_entry(uuid, jsonb, text), withdraw_report_verification(uuid, text), archive_report_entry(uuid, text),
  restore_report_entry(uuid), assign_report_entries(uuid[], uuid, uuid, date), set_report_settings(date, int, int),
  set_register_visibility(boolean, text), current_register_method() to nut_member;
grant execute on function public_register(), public_register_status(), public_register_versions(uuid), public_register_resolve(text),
  public_register_methods() to nut_anon, nut_member;
grant execute on function system_register_links_due(int), system_save_link_checks(uuid, jsonb) to nut_cron;

-- The public compliance report: an administrator chooses one uploaded tracker spreadsheet to show
-- on the public site, as the report's own table (status per indicator, as recorded in the sheet).
-- Only that import's federal rows are readable, through tracker_report(); nothing else about
-- imports, drafts or internal notes becomes public. Showing another import replaces it; hiding it
-- leaves the public table empty. Every change is audited.

create table public_reports (
  id           uuid primary key default gen_random_uuid(),
  import_id    uuid not null references imports(id),
  published_at timestamptz not null default now(),
  published_by uuid not null,
  hidden_at    timestamptz,
  hidden_by    uuid
);
create unique index public_reports_one_shown on public_reports ((true)) where hidden_at is null;

create function publish_tracker_report(p_import uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
begin
  if not exists (select 1 from imports where id = p_import) then
    raise exception 'import not found' using errcode = 'P0002';
  end if;
  update public_reports set hidden_at = now(), hidden_by = uid where hidden_at is null;
  insert into public_reports (import_id, published_by) values (p_import, uid);
  perform audit('report.shown', 'import', p_import, '{}');
end $$;

create function hide_tracker_report() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
  shown uuid;
begin
  update public_reports set hidden_at = now(), hidden_by = uid where hidden_at is null returning import_id into shown;
  if shown is not null then perform audit('report.hidden', 'import', shown, '{}'); end if;
end $$;

-- The rows the public site shows. Links only when the address is a plain http(s) URL.
create function tracker_report()
returns table (section text, section_index int, serial text, name text, state text, head_name text, bursar_name text,
               website_text text, website_url text, report_status text, indicators jsonb, institution_slug text,
               reported_as_of date, published_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.section, r.section_index, r.serial_raw,
         btrim(r.mapped->>'name'),
         coalesce(r.mapped->>'stateCanonical', r.mapped->>'stateRaw'),
         r.mapped->>'head', r.mapped->>'bursar',
         r.mapped->>'websiteRaw',
         case
           when r.mapped->>'websiteConfirmed' = 'true' and (r.mapped->'websiteCandidates'->>0) ~* '^https?://[^\s<>"]+$'
             then r.mapped->'websiteCandidates'->>0
           when btrim(r.mapped->>'websiteRaw') ~* '^https?://[^\s<>"]+$' then btrim(r.mapped->>'websiteRaw')
         end,
         r.mapped->>'legacyStatusRaw',
         r.legacy_indicators,
         (select i.slug from institutions i where i.id = r.institution_id and i.current_published_revision is not null),
         im.source_reported_as_of, p.published_at
    from public_reports p
    join imports im on im.id = p.import_id
    join import_rows r on r.import_id = p.import_id
   where p.hidden_at is null
     and r.section in ('federal_university', 'federal_polytechnic', 'federal_monotechnic')
     and nullif(btrim(r.mapped->>'name'), '') is not null
     and r.decision <> 'skip'
   order by case r.section when 'federal_university' then 1 when 'federal_polytechnic' then 2 else 3 end, r.section_index
$$;

alter table public_reports enable row level security;
revoke all on public_reports from public, nut_anon, nut_member, nut_system, nut_worker;
grant select on public_reports to nut_member;
create policy team_read on public_reports for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));

revoke execute on function publish_tracker_report(uuid), hide_tracker_report(), tracker_report()
  from public, nut_anon, nut_member, nut_system, nut_worker;
grant execute on function publish_tracker_report(uuid), hide_tracker_report() to nut_member;
grant execute on function tracker_report() to nut_anon, nut_member;

-- Phase 2: import staging, identity decisions and idempotent commit into private drafts.
-- Additive only. Builds on 0001_phase1_core.sql.
--
-- Rules enforced here:
--   * The original upload is preserved verbatim with its SHA-256; staging the same bytes twice
--     returns the existing import instead of creating another.
--   * Staged rows keep raw cells, source line, legacy indicator claims (true/false/null) and
--     issues. Legacy claims never become assessments: committed drafts start "not_assessed".
--   * Held rows (unnamed, conflicting, possible duplicates, unusable websites) are never
--     committed without an explicit human decision. Nothing is merged automatically.
--   * Committing creates private draft revisions only. Nothing reaches published_snapshots.
--   * Committing again is a no-op for rows already committed.

create type import_row_decision as enum ('pending', 'create_new', 'match_existing', 'skip');

create table imports (
  id                    uuid primary key default gen_random_uuid(),
  file_name             text not null,
  content_hash          text not null unique,          -- sha256 of the original text, hex
  original_text         text not null,                 -- preserved upload; private
  source_reported_as_of date,                          -- from the file heading, not a verification date
  parser_version        text not null,
  summary               jsonb not null,
  uploaded_by           uuid not null,
  uploaded_at           timestamptz not null default now(),
  last_committed_at     timestamptz,
  last_committed_by     uuid
);

create table import_rows (
  id                uuid primary key default gen_random_uuid(),
  import_id         uuid not null references imports(id),
  section           text not null check (section in ('federal_university', 'federal_polytechnic',
                      'federal_monotechnic', 'state_university', 'state_polytechnic', 'state_monotechnic')),
  section_index     int  not null,
  source_line       int  not null,
  serial_raw        text not null,                     -- provenance only, e.g. '#REF!'
  raw_cells         jsonb not null,
  mapped            jsonb not null,
  legacy_indicators jsonb not null,                    -- unverified legacy claims
  issues            jsonb not null default '[]',
  held              boolean not null,
  decision          import_row_decision not null default 'pending',
  decision_note     text,
  decided_by        uuid,
  decided_at        timestamptz,
  institution_id    uuid references institutions(id),
  revision_id       uuid references revisions(id),
  committed_at      timestamptz,
  unique (import_id, source_line),
  unique (import_id, section, section_index)
);

create index import_rows_institution on import_rows (institution_id);

-- Staged rows are immutable apart from the decision and commit columns.
create function guard_import_row_update() returns trigger language plpgsql as $$
begin
  if (new.import_id, new.section, new.section_index, new.source_line, new.serial_raw,
      new.raw_cells, new.mapped, new.legacy_indicators, new.issues, new.held)
     is distinct from
     (old.import_id, old.section, old.section_index, old.source_line, old.serial_raw,
      old.raw_cells, old.mapped, old.legacy_indicators, old.issues, old.held) then
    raise exception 'staged import rows are immutable' using errcode = '55000';
  end if;
  if old.revision_id is not null and new.revision_id is distinct from old.revision_id then
    raise exception 'a committed row cannot be re-pointed' using errcode = '55000';
  end if;
  return new;
end $$;

create trigger import_rows_guard before update on import_rows
  for each row execute function guard_import_row_update();
create trigger imports_no_delete before delete on imports
  for each row execute function forbid_change();
create trigger import_rows_no_delete before delete on import_rows
  for each row execute function forbid_change();

create function guard_import_update() returns trigger language plpgsql as $$
begin
  if (new.file_name, new.content_hash, new.original_text, new.source_reported_as_of,
      new.parser_version, new.summary, new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.file_name, old.content_hash, old.original_text, old.source_reported_as_of,
      old.parser_version, old.summary, old.uploaded_by, old.uploaded_at) then
    raise exception 'imports are immutable once staged' using errcode = '55000';
  end if;
  return new;
end $$;

create trigger imports_guard before update on imports
  for each row execute function guard_import_update();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function norm_name(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g'))
$$;

create function slugify(t text) returns text language sql immutable as $$
  select left(btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g'), '-'), 80)
$$;

create function unique_slug(p_base text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  base text := coalesce(nullif(slugify(p_base), ''), 'institution');
  candidate text := base;
  n int := 1;
begin
  while exists (select 1 from institutions where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

-- A placeholder such as "Not found" is not a name.
create function real_value(t text) returns text language sql immutable as $$
  select case when t is null or btrim(t) = '' or lower(btrim(t)) in ('not found', 'nil', 'n/a') then null
              else btrim(t) end
$$;

-- An institution whose current name (any revision's latest) matches, for later-import safety.
create function institution_named(p_name text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.institution_id
    from revisions r
   where norm_name(r.name) = norm_name(p_name) and norm_name(p_name) <> ''
   order by r.created_at
   limit 1
$$;

-- Creates the institution and a private draft from one staged row. Internal only.
create function create_draft_from_import_row(p_row uuid, p_uid uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ir   import_rows;
  m    jsonb;
  inst uuid;
  rev  uuid;
  holds_state boolean;
  holds_web boolean;
  site text;
begin
  select * into ir from import_rows where id = p_row for update;
  m := ir.mapped;
  if real_value(m->>'name') is null then
    raise exception 'row % has no institution name; identify it before creating a draft', p_row
      using errcode = '23514';
  end if;
  holds_state := exists (select 1 from jsonb_array_elements(ir.issues) i where i->>'code' = 'state_conflict');
  holds_web := exists (select 1 from jsonb_array_elements(ir.issues) i
                        where i->>'code' like 'website\_%' and (i->>'holds')::boolean);
  site := case when holds_web then null else m->'websiteCandidates'->>0 end;

  insert into institutions (slug, created_by) values (unique_slug(m->>'name'), p_uid) returning id into inst;
  insert into revisions (institution_id, revision_number, name, ownership, institution_type,
                         state, city, head_name, bursar_name, website_url, legacy_report_status,
                         created_by, updated_by)
  values (inst, 1, real_value(m->>'name'), (m->>'ownership')::ownership_type,
          (m->>'institutionType')::institution_type,
          case when holds_state then null else m->>'stateCanonical' end,
          case when m->>'stateCanonical' is null then real_value(m->>'stateRaw') end,
          real_value(m->>'head'), real_value(m->>'bursar'),
          case when site ~* '^https?://' then site end,
          m->>'legacyStatusRaw', p_uid, p_uid)
  returning id into rev;
  -- Legacy TRUE/FALSE claims stay on the import row; the draft starts unassessed.
  insert into revision_indicators (revision_id, indicator_key)
    select rev, key from indicator_definitions;

  update import_rows set institution_id = inst, revision_id = rev, committed_at = now() where id = p_row;
  perform audit('import.row_committed', 'import_row', p_row,
                jsonb_build_object('institution_id', inst, 'revision_id', rev));
  return rev;
end $$;

-- ---------------------------------------------------------------------------
-- Import API (administrators only)
-- ---------------------------------------------------------------------------

-- p_rows: the parser's staged rows as JSON. Returns the import id; staging identical bytes
-- again returns the existing import untouched.
create function stage_import(p_file_name text, p_original_text text, p_reported_as_of date,
                             p_parser_version text, p_summary jsonb, p_rows jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
  h   text := encode(sha256(convert_to(p_original_text, 'UTF8')), 'hex');
  existing uuid;
  imp uuid;
  bad int;
begin
  select id into existing from imports where content_hash = h;
  if existing is not null then
    perform audit('import.repeat_ignored', 'import', existing, jsonb_build_object('file_name', p_file_name));
    return existing;
  end if;

  select count(*) into bad
    from jsonb_array_elements(p_rows) r
   where (select array_agg(k order by k) from jsonb_object_keys(r->'legacyIndicators') k)
         is distinct from (select array_agg(key order by key) from indicator_definitions)
      or exists (select 1 from jsonb_each(r->'legacyIndicators') e
                  where jsonb_typeof(e.value) not in ('boolean', 'null'));
  if bad > 0 then
    raise exception '% staged rows do not carry exactly the nine indicator keys as true/false/null', bad
      using errcode = '22023';
  end if;

  insert into imports (file_name, content_hash, original_text, source_reported_as_of,
                       parser_version, summary, uploaded_by)
  values (p_file_name, h, p_original_text, p_reported_as_of, p_parser_version, p_summary, uid)
  returning id into imp;

  insert into import_rows (import_id, section, section_index, source_line, serial_raw, raw_cells,
                           mapped, legacy_indicators, issues, held)
  select imp, r->>'section', (r->>'sectionIndex')::int, (r->>'sourceLine')::int, r->>'serialRaw',
         r->'cells', r->'mapped', r->'legacyIndicators', coalesce(r->'issues', '[]'::jsonb),
         exists (select 1 from jsonb_array_elements(coalesce(r->'issues', '[]'::jsonb)) i
                  where (i->>'holds')::boolean)
    from jsonb_array_elements(p_rows) r;

  perform audit('import.staged', 'import', imp,
                jsonb_build_object('file_name', p_file_name, 'content_hash', h,
                                   'rows', jsonb_array_length(p_rows)));
  return imp;
end $$;

-- Record a human identity decision. match_existing links provenance to an institution without
-- changing its data; later field changes arrive as reviewed proposals, never as overwrites.
create function decide_import_row(p_row uuid, p_decision import_row_decision,
                                  p_institution uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
  ir  import_rows;
begin
  select * into ir from import_rows where id = p_row for update;
  if not found then raise exception 'import row not found' using errcode = 'P0002'; end if;
  if ir.institution_id is not null then
    raise exception 'row is already committed or linked' using errcode = '55000';
  end if;
  if p_decision = 'create_new' and real_value(ir.mapped->>'name') is null then
    -- Unnamed rows: create the institution by hand once identified, then match this row to it.
    raise exception 'this row has no name; create the institution manually and match it'
      using errcode = '23514';
  end if;
  if p_decision = 'match_existing' and p_institution is null then
    raise exception 'choose the existing institution to match' using errcode = '23514';
  end if;
  if p_decision in ('skip', 'match_existing') and nullif(btrim(p_note), '') is null then
    raise exception 'a reason is required' using errcode = '23514';
  end if;
  update import_rows set decision = p_decision, decision_note = p_note, decided_by = uid,
         decided_at = now(),
         institution_id = case when p_decision = 'match_existing' then p_institution end,
         committed_at = case when p_decision = 'match_existing' then now() end
   where id = p_row;
  perform audit('import.row_decided', 'import_row', p_row,
                jsonb_build_object('decision', p_decision, 'institution_id', p_institution, 'note', p_note));
end $$;

-- Commit every row that is safe to commit. Repeatable: committed rows are skipped.
create function commit_import(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('admin');
  ir  import_rows;
  created int := 0; held int := 0; needs_match int := 0; skipped int := 0; already int := 0;
begin
  perform 1 from imports where id = p_import for update;
  if not found then raise exception 'import not found' using errcode = 'P0002'; end if;

  for ir in select * from import_rows where import_id = p_import order by source_line loop
    if ir.institution_id is not null then
      already := already + 1;
    elsif ir.decision = 'skip' then
      skipped := skipped + 1;
    elsif ir.decision = 'create_new' then
      perform create_draft_from_import_row(ir.id, uid);
      created := created + 1;
    elsif ir.held then
      held := held + 1;
    elsif institution_named(ir.mapped->>'name') is not null then
      -- Same name already exists (e.g. from an earlier import): a human must match or create.
      needs_match := needs_match + 1;
    else
      perform create_draft_from_import_row(ir.id, uid);
      created := created + 1;
    end if;
  end loop;

  update imports set last_committed_at = now(), last_committed_by = uid where id = p_import;
  perform audit('import.committed', 'import', p_import,
                jsonb_build_object('created', created, 'held', held, 'needs_match', needs_match,
                                   'skipped', skipped, 'already_committed', already));
  return jsonb_build_object('created', created, 'held', held, 'needs_match', needs_match,
                            'skipped', skipped, 'already_committed', already);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on imports, import_rows from nut_anon, nut_member;
revoke execute on function norm_name(text), slugify(text), unique_slug(text), real_value(text),
  institution_named(text), create_draft_from_import_row(uuid, uuid),
  stage_import(text, text, date, text, jsonb, jsonb),
  decide_import_row(uuid, import_row_decision, uuid, text), commit_import(uuid)
from public, nut_anon, nut_member;

alter table imports     enable row level security;
alter table import_rows enable row level security;

grant select on imports, import_rows to nut_member;
create policy team_read on imports     for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));
create policy team_read on import_rows for select to nut_member using (current_team_role() in ('editor', 'reviewer', 'admin'));

grant execute on function stage_import(text, text, date, text, jsonb, jsonb),
  decide_import_row(uuid, import_row_decision, uuid, text), commit_import(uuid)
to nut_member;

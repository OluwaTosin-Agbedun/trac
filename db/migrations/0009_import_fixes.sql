-- Import fixes after review. Additive only; builds on 0002_phase2_imports.sql.
--
-- 1. Guessed values never reach a draft (SPEC §8.7). The parser now marks a website as confirmed
--    (mapped.websiteConfirmed) only when the cell held exactly one valid http(s) URL as written, or
--    the address is the cell's real hyperlink and the cell shows no other address, and it is not
--    shared with other rows. A draft gets
--    the address only then: repaired protocols, one-of-several URLs, Markdown links and shared
--    domains stay on the import row for an editor to confirm. Rows staged before the flag existed
--    carry no flag, so their addresses are left for editors too (fail closed). The state is set only
--    from a cell that names a state; a town stays as the city, as before.
-- 2. Rows waiting on a human are visible. commit_import sends an unheld row whose name matches an
--    existing institution to "needs matching" without creating anything. import_name_matches lists
--    those rows (and any held row with a match) with the institution, so the review page can offer
--    the match first. decide_import_row already accepts decisions on unheld rows and commit_import
--    honours them; neither changes here.
-- 3. A decision saved while a commit is running wins: the draft function re-checks the row under
--    its lock and refuses, rolling the whole commit back, if the row was matched or skipped meanwhile.

-- Same signature as 0002, so the privileges granted there are kept. Body copied from 0002; only
-- the lock re-check and the website and state lines differ.
create or replace function create_draft_from_import_row(p_row uuid, p_uid uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ir   import_rows;
  m    jsonb;
  inst uuid;
  rev  uuid;
  holds_state boolean;
  web_unconfirmed boolean;
  site text;
begin
  select * into ir from import_rows where id = p_row for update;
  if not found then raise exception 'import row not found' using errcode = 'P0002'; end if;
  -- Re-checked under the row lock: commit_import reads its rows before locking each one, so a
  -- match or skip saved meanwhile must win rather than be overwritten by a new draft.
  if ir.institution_id is not null or ir.decision = 'skip' then
    raise exception 'a decision was saved on this import while it was being committed, so nothing was committed; commit again'
      using errcode = '55000';
  end if;
  m := ir.mapped;
  if real_value(m->>'name') is null then
    raise exception 'row % has no institution name; identify it before creating a draft', p_row
      using errcode = '23514';
  end if;
  holds_state := exists (select 1 from jsonb_array_elements(ir.issues) i
                          where i->>'code' in ('state_conflict', 'location_not_state'));
  -- Belt and braces: the parser's flag must agree with the issues it raised.
  web_unconfirmed := exists (select 1 from jsonb_array_elements(ir.issues) i
                              where (i->>'code' like 'website\_%' and (i->>'holds')::boolean)
                                 or i->>'code' in ('website_missing_protocol', 'website_multiple_urls',
                                                   'website_markdown_link', 'website_merged_status', 'shared_domain'));
  site := case
            when web_unconfirmed or m->'websiteConfirmed' is distinct from 'true'::jsonb then null
            when jsonb_typeof(m->'websiteCandidates') is distinct from 'array' then null
            when jsonb_array_length(m->'websiteCandidates') <> 1 then null
            else m->'websiteCandidates'->>0
          end;

  insert into institutions (slug, created_by) values (unique_slug(m->>'name'), p_uid) returning id into inst;
  insert into revisions (institution_id, revision_number, name, ownership, institution_type,
                         state, city, head_name, bursar_name, website_url, legacy_report_status,
                         created_by, updated_by)
  values (inst, 1, real_value(m->>'name'), (m->>'ownership')::ownership_type,
          (m->>'institutionType')::institution_type,
          case when holds_state then null else m->>'stateCanonical' end,
          case when m->>'stateCanonical' is null then real_value(m->>'stateRaw') end,
          real_value(m->>'head'), real_value(m->>'bursar'),
          case when site ~* '^https?://[^[:space:]]+$' then site end,
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

-- institution_named() runs once per waiting row on every commit and review page; index its test.
create index revisions_norm_name on revisions (norm_name(name));

-- Rows of an import still waiting on a human (pending, not linked) whose name matches an existing
-- institution by the same rule commit_import applies, with that institution's current name. Team
-- members who may read imports may call it; it reveals nothing they cannot already read.
create function import_name_matches(p_import uuid)
returns table (row_id uuid, institution_id uuid, institution_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform require_role('editor', 'reviewer', 'admin');
  return query
    select r.id, m.inst,
           (select rv.name from revisions rv where rv.institution_id = m.inst
             order by rv.revision_number desc limit 1)
      from import_rows r
      cross join lateral (select institution_named(r.mapped->>'name') as inst) m
     where r.import_id = p_import and r.institution_id is null and r.decision = 'pending'
       and m.inst is not null;
end $$;

-- New functions are executable by PUBLIC by default; start from nothing and grant precisely.
revoke execute on function create_draft_from_import_row(uuid, uuid), import_name_matches(uuid)
from public, nut_anon, nut_member, nut_system, nut_worker;
grant execute on function import_name_matches(uuid) to nut_member;

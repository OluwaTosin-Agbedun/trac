-- Editorial refinements found while building the CMS screens.
--
-- 1. An indicator reassessed as not_found, not_assessed or not_applicable no longer carries the
--    value fields copied from an earlier release (a stale ₦0 or figure must never reappear).
-- 2. Editors record when a person last verified the sources (revisions.last_verified_at), as part
--    of the draft, so it is reviewed and published with everything else.
-- 3. Publishing closes the institution's open assignment, so finished work stops showing as due.
-- 4. preview_revision(): reviewers see exactly what the public page will show before publishing.

create or replace function save_indicator(p_revision uuid, p_expected_lock int, p_key text, p jsonb) returns int
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
  -- Only a published (or still-uncertain) finding may carry a value.
  update revision_indicators
     set value_amount = null, value_scale = null, value_currency = null, value_count = null, value_literal = null
   where revision_id = p_revision and indicator_key = p_key
     and state in ('not_found', 'not_assessed', 'not_applicable');
  perform audit('revision.indicator_saved', 'revision', p_revision,
                jsonb_build_object('indicator', p_key) || p);
  return bump_lock(p_revision);
end $$;

create or replace function save_profile(p_revision uuid, p_expected_lock int, p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
  verified timestamptz;
begin
  perform assert_draft(p_revision, p_expected_lock);
  if p ? 'last_verified_at' and p->>'last_verified_at' is not null then
    verified := (p->>'last_verified_at')::timestamptz;
    if verified > now() + interval '1 day' then
      raise exception 'the verification date cannot be in the future' using errcode = '23514';
    end if;
  end if;
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
    assessment_period = case when p ? 'assessment_period' then p->>'assessment_period' else assessment_period end,
    last_verified_at  = case when p ? 'last_verified_at'  then verified else last_verified_at end
  where id = p_revision;
  perform audit('revision.profile_saved', 'revision', p_revision, p);
  return bump_lock(p_revision);
end $$;

create function close_assignment_on_publish() returns trigger language plpgsql as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    update assignments set closed_at = now() where institution_id = new.institution_id and closed_at is null;
  end if;
  return new;
end $$;

create trigger revisions_close_assignment after update of status on revisions
  for each row execute function close_assignment_on_publish();

create function preview_revision(p_revision uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
begin
  if not exists (select 1 from revisions where id = p_revision) then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  return revision_content(p_revision, true) || jsonb_build_object('summary', revision_summary(p_revision));
end $$;

revoke execute on function save_indicator(uuid, int, text, jsonb), save_profile(uuid, int, jsonb),
  preview_revision(uuid) from public, nut_anon, nut_member;
grant execute on function save_indicator(uuid, int, text, jsonb), save_profile(uuid, int, jsonb),
  preview_revision(uuid) to nut_member;
revoke execute on function close_assignment_on_publish() from public;

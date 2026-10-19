-- Editorial workflow fixes from the workflow review.
--
-- 1. Editors work on their assigned institutions only. require_institution_writer() performs the
--    same role check as require_role('editor', 'reviewer', 'admin') and, for an editor, also refuses
--    an institution whose open assignment names a different editor. Every function that changes an
--    institution's draft or its research queue starts with it.
-- 2. A reviewer who made any content edit to a revision counts as its author, like the submitter:
--    they cannot review it unless an administrator records an override reason. Edits to a returned
--    revision whose content was carried into the new draft count too.
-- 3. Withdrawing a publication takes every release of the institution off the public site, not only
--    the current one. Earlier releases already left readable by a withdrawal are withdrawn here too.
-- 4. A revision started from a release that was later withdrawn can still be published.
-- 5. reopen_revision(): a reviewer sends a submitted or approved revision back with a reason; the
--    recorded decision voids the earlier approval and a corrected draft can then be started.
-- 6. revision_summary(): a published finding whose reporting period lies entirely before the
--    assessment period is counted as historical and no longer satisfies 'all_applicable_published'
--    (same rule as periodCoverage() in src/lib/compare.ts).
-- 7. revision_content() and revision_hash() render timestamps in UTC whatever the session time zone,
--    so a content hash never depends on the connection.
-- 8. 'no_applicable_indicators': every indicator excluded with a reason is a neutral summary, not
--    'no_disclosures_found'.
--
-- Redefined functions keep their exact signatures, so existing grants stay as they were.

-- ---------------------------------------------------------------------------
-- 1. Assigned institutions
-- ---------------------------------------------------------------------------

create function require_institution_writer(p_institution uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('editor', 'reviewer', 'admin');
begin
  -- Reviewers and administrators are not limited. An editor may work on an institution assigned to
  -- them, or on one whose open assignment (if any) names no editor.
  if current_team_role() = 'editor' and exists (
       select 1 from assignments a
        where a.institution_id = p_institution and a.closed_at is null
          and a.editor_id is not null and a.editor_id <> uid) then
    raise exception 'this institution is assigned to another editor' using errcode = '42501';
  end if;
  return uid;
end $$;

-- New draft copied from the latest revision. Base = what is currently published.
create or replace function create_revision(p_institution uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := require_institution_writer(p_institution);
  prev revisions;
  inst institutions;
  rev  uuid;
begin
  select * into inst from institutions where id = p_institution for update;
  if not found then raise exception 'institution not found' using errcode = 'P0002'; end if;
  select * into prev from revisions where institution_id = p_institution
   order by revision_number desc limit 1;
  if prev.status in ('draft', 'submitted', 'approved') then
    raise exception 'an open revision (%) already exists', prev.status using errcode = '55000';
  end if;
  insert into revisions (institution_id, revision_number, base_revision_id, previous_revision_id,
    review_cycle, methodology_version_id, name, short_name, ownership, institution_type, state,
    city, head_name, head_title, bursar_name, website_url, assessment_period,
    legacy_report_status, last_verified_at, created_by, updated_by)
  values (p_institution, prev.revision_number + 1, inst.current_published_revision, prev.id,
    case when prev.status = 'changes_requested' then prev.review_cycle + 1 else 0 end,
    prev.methodology_version_id, prev.name, prev.short_name, prev.ownership,
    prev.institution_type, prev.state, prev.city, prev.head_name, prev.head_title,
    prev.bursar_name, prev.website_url, prev.assessment_period, prev.legacy_report_status,
    prev.last_verified_at, uid, uid)
  returning id into rev;
  insert into revision_indicators (revision_id, indicator_key, state, period_type, period_label,
    period_start, period_end, value_amount, value_scale, value_currency, value_count,
    value_literal, reason, internal_note)
  select rev, indicator_key, state, period_type, period_label, period_start, period_end,
         value_amount, value_scale, value_currency, value_count, value_literal, reason, internal_note
    from revision_indicators where revision_id = prev.id;
  insert into evidence_links (revision_id, indicator_key, url, title, excerpt, locator,
    document_period, source_published_on, captured_at, is_public, created_by)
  select rev, indicator_key, url, title, excerpt, locator, document_period,
         source_published_on, captured_at, is_public, created_by
    from evidence_links where revision_id = prev.id;
  perform audit('revision.created', 'revision', rev, jsonb_build_object('from', prev.id));
  return rev;
end $$;

create or replace function save_profile(p_revision uuid, p_expected_lock int, p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_institution_writer((select institution_id from revisions where id = p_revision));
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

create or replace function save_indicator(p_revision uuid, p_expected_lock int, p_key text, p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_institution_writer((select institution_id from revisions where id = p_revision));
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

create or replace function add_evidence(p_revision uuid, p_expected_lock int, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_institution_writer((select institution_id from revisions where id = p_revision));
  eid uuid;
begin
  perform assert_draft(p_revision, p_expected_lock);
  insert into evidence_links (revision_id, indicator_key, url, title, excerpt, locator,
    document_period, source_published_on, captured_at, is_public, created_by)
  values (p_revision, p->>'indicator_key', p->>'url', p->>'title', p->>'excerpt', p->>'locator',
    p->>'document_period', (p->>'source_published_on')::date, (p->>'captured_at')::timestamptz,
    coalesce((p->>'is_public')::boolean, true), uid)
  returning id into eid;
  perform bump_lock(p_revision);
  perform audit('revision.evidence_added', 'revision', p_revision, jsonb_build_object('evidence_id', eid));
  return eid;
end $$;

create or replace function remove_evidence(p_revision uuid, p_expected_lock int, p_evidence uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_institution_writer((select institution_id from revisions where id = p_revision));
begin
  perform assert_draft(p_revision, p_expected_lock);
  delete from evidence_links where id = p_evidence and revision_id = p_revision;
  perform audit('revision.evidence_removed', 'revision', p_revision, jsonb_build_object('evidence_id', p_evidence));
  return bump_lock(p_revision);
end $$;

create or replace function submit_revision(p_revision uuid, p_expected_lock int) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_institution_writer((select institution_id from revisions where id = p_revision));
  r   revisions := assert_draft(p_revision, p_expected_lock);
  bad text;
  h   text;
begin
  if nullif(trim(r.name), '') is null then
    raise exception 'an institution name is required' using errcode = '23514';
  end if;
  select string_agg(ri.indicator_key, ', ') into bad
    from revision_indicators ri
   where ri.revision_id = p_revision and ri.state = 'published'
     and (ri.period_label is null or ri.period_type is null
          or not exists (select 1 from evidence_links e
                          where e.revision_id = p_revision and e.indicator_key = ri.indicator_key
                            and nullif(trim(coalesce(e.locator, e.excerpt, '')), '') is not null));
  if bad is not null then
    raise exception 'published indicators need a reporting period and evidence with a locator or excerpt: %', bad
      using errcode = '23514';
  end if;
  h := revision_hash(p_revision);
  update revisions set status = 'submitted', content_hash = h,
         submitted_at = now(), submitted_by = uid, lock_version = lock_version + 1
   where id = p_revision;
  perform audit('revision.submitted', 'revision', p_revision, jsonb_build_object('content_hash', h));
  return h;
end $$;

create or replace function request_scan(p_institution uuid, p_start_urls text[] default '{}') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_institution_writer(p_institution);
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

create or replace function cancel_scan(p_job uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_institution_writer((select institution_id from crawl_jobs where id = p_job));
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

-- The write itself goes through save_* and add_evidence (which check again); the check here also
-- covers the stale path, which marks the proposal without writing to the draft.
create or replace function accept_proposal(p_proposal uuid, p_revision uuid, p_expected_lock int,
                                p_edit jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid   uuid := require_institution_writer((select institution_id from agent_proposals where id = p_proposal));
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

create or replace function reject_proposal(p_proposal uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid  uuid := require_institution_writer((select institution_id from agent_proposals where id = p_proposal));
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
-- 2. Self-review: editing a revision makes you one of its authors
-- ---------------------------------------------------------------------------

-- The authorship lookup reads audit_events by revision on every review.
create index audit_events_entity on audit_events (entity_id, entity_type);
create index audit_events_accepted_revision on audit_events ((details->>'revision_id'))
  where action = 'proposal.accepted';

create or replace function review_revision(p_revision uuid, p_decision review_decision, p_notes text default null,
                                p_self_review_override_reason text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('reviewer', 'admin');
  r      revisions;
  aid    uuid;
  author boolean;
begin
  select * into r from revisions where id = p_revision for update;
  if not found or r.status <> 'submitted' then
    raise exception 'only submitted revisions can be reviewed' using errcode = '55000';
  end if;
  if revision_hash(p_revision) <> r.content_hash then
    raise exception 'revision content changed after submission' using errcode = '55000';
  end if;
  -- The submitter, and anyone who changed the revision's content, is an author of it. A returned
  -- revision's content was never approved and is copied into the next draft, so edits to it count
  -- too: otherwise sending work back (or reopening it) and resubmitting it unchanged would let its
  -- editor review it.
  with recursive carried(id) as (
    select p_revision
    union
    select prev.id
      from carried c
      join revisions cur  on cur.id = c.id
      join revisions prev on prev.id = cur.previous_revision_id
     where prev.status = 'changes_requested')
  select coalesce(r.submitted_by = uid, false)
      or exists (select 1 from audit_events e
                  where e.actor_id = uid and e.entity_type = 'revision'
                    and e.entity_id in (select id from carried)
                    and e.action in ('revision.profile_saved', 'revision.indicator_saved',
                                     'revision.evidence_added', 'revision.evidence_removed'))
      or exists (select 1 from audit_events e
                  where e.actor_id = uid and e.action = 'proposal.accepted'
                    and e.details->>'revision_id' in (select id::text from carried))
    into author;
  if author then
    if current_team_role() <> 'admin' or nullif(trim(p_self_review_override_reason), '') is null then
      raise exception 'you cannot review a revision you submitted or edited' using errcode = '42501';
    end if;
  end if;
  if p_decision <> 'approved' and nullif(trim(p_notes), '') is null then
    raise exception 'a reason is required when returning or rejecting' using errcode = '23514';
  end if;
  insert into approvals (revision_id, content_hash, decision, decided_by, notes, self_review_override_reason)
  values (p_revision, r.content_hash, p_decision, uid, p_notes,
          case when author then p_self_review_override_reason end)
  returning id into aid;
  update revisions set status = case p_decision when 'approved' then 'approved'::revision_status
                                                else 'changes_requested'::revision_status end
   where id = p_revision;
  perform audit('revision.reviewed', 'revision', p_revision,
                jsonb_build_object('decision', p_decision, 'approval_id', aid,
                                   'self_review_override', author));
  return aid;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Withdrawal removes every release of the institution
-- ---------------------------------------------------------------------------

create or replace function withdraw_publication(p_institution uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('reviewer', 'admin');
  s   published_snapshots;
  ids jsonb;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'a reason is required' using errcode = '23514';
  end if;
  select * into s from published_snapshots where institution_id = p_institution and is_current for update;
  if not found then raise exception 'nothing is published' using errcode = 'P0002'; end if;
  -- Earlier releases go too: otherwise they stay readable at /institutions/{slug}/releases/{n}.
  with w as (
    update published_snapshots set is_current = false, withdrawn_at = now(), withdrawn_by = uid,
           withdrawn_reason = p_reason
     where institution_id = p_institution and withdrawn_at is null
    returning id)
  select coalesce(jsonb_agg(id), '[]'::jsonb) into ids from w;
  update revisions set status = 'withdrawn' where id = s.revision_id;
  update institutions set current_published_revision = null where id = p_institution;
  perform audit('publication.withdrawn', 'institution', p_institution,
                jsonb_build_object('snapshot_id', s.id, 'reason', p_reason, 'withdrawn_snapshot_ids', ids));
end $$;

-- Releases that an earlier withdrawal left public: withdraw each with the first later withdrawal's
-- details, exactly as the function above would have done at the time.
with gone as (
  select s.id, s.institution_id, w.withdrawn_at, w.withdrawn_by, w.withdrawn_reason
    from published_snapshots s
    join lateral (
      select l.withdrawn_at, l.withdrawn_by, l.withdrawn_reason
        from published_snapshots l
       where l.institution_id = s.institution_id and l.withdrawn_at is not null
         and l.release_number > s.release_number
       order by l.release_number
       limit 1) w on true
   where s.withdrawn_at is null),
done as (
  update published_snapshots p
     set is_current = false, withdrawn_at = gone.withdrawn_at, withdrawn_by = gone.withdrawn_by,
         withdrawn_reason = gone.withdrawn_reason
    from gone
   where p.id = gone.id
  returning p.id, p.institution_id)
insert into audit_events (action, entity_type, entity_id, details)
select 'publication.withdrawn', 'institution', institution_id,
       jsonb_build_object('withdrawn_snapshot_ids', jsonb_agg(id order by id),
                          'reason', 'Earlier releases withdrawn with the later withdrawal (migration 0008).')
  from done
 group by institution_id;

-- ---------------------------------------------------------------------------
-- 4. Publishing after a withdrawal
-- ---------------------------------------------------------------------------

create or replace function publish_revision(p_revision uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('reviewer', 'admin');
  r      revisions;
  inst   institutions;
  a      approvals;
  latest published_snapshots;
  sid    uuid;
  rel    int;
begin
  select * into r from revisions where id = p_revision for update;
  if not found or r.status <> 'approved' then
    raise exception 'only approved revisions can be published' using errcode = '55000';
  end if;
  select * into inst from institutions where id = r.institution_id for update;
  select * into a from approvals where revision_id = p_revision
   order by decided_at desc, id desc limit 1;
  if a.decision is distinct from 'approved' or a.content_hash <> r.content_hash
     or revision_hash(p_revision) <> a.content_hash then
    raise exception 'approval does not match this exact revision content' using errcode = '55000';
  end if;
  -- The draft must start from what is published now. After a withdrawal nothing is published, so a
  -- draft started from the withdrawn release (the institution's latest) is also up to date.
  select * into latest from published_snapshots where institution_id = inst.id
   order by release_number desc limit 1;
  if r.base_revision_id is distinct from inst.current_published_revision
     and not (inst.current_published_revision is null and r.base_revision_id is not null
              and latest.withdrawn_at is not null and r.base_revision_id = latest.revision_id) then
    raise exception 'conflict: another version was published since this draft started'
      using errcode = '40001';
  end if;

  select coalesce(max(release_number), 0) + 1 into rel
    from published_snapshots where institution_id = inst.id;
  update published_snapshots set is_current = false where institution_id = inst.id and is_current;
  insert into published_snapshots (institution_id, revision_id, approval_id, release_number, slug,
    methodology_version_id, payload, is_current, published_by)
  values (inst.id, p_revision, a.id, rel, inst.slug, r.methodology_version_id,
    revision_content(p_revision, true)
      || jsonb_build_object('summary', revision_summary(p_revision),
                            'parent_institution_id', inst.parent_institution_id),
    true, uid)
  returning id into sid;

  update revisions set status = 'superseded' where id = inst.current_published_revision;
  update revisions set status = 'published' where id = p_revision;
  update institutions set current_published_revision = p_revision where id = inst.id;
  perform audit('revision.published', 'revision', p_revision,
                jsonb_build_object('snapshot_id', sid, 'release_number', rel, 'approval_id', a.id));
  return sid;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reopening a submitted or approved revision
-- ---------------------------------------------------------------------------

create function reopen_revision(p_revision uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := require_role('reviewer', 'admin');
  reason text := btrim(coalesce(p_reason, ''), E' \t\r\n');
  r      revisions;
  aid    uuid;
begin
  if length(reason) < 3 or length(reason) > 1000 then
    raise exception 'give a reason for reopening this revision (3 to 1,000 characters)' using errcode = '22023';
  end if;
  select * into r from revisions where id = p_revision for update;
  if not found then raise exception 'revision not found' using errcode = 'P0002'; end if;
  if r.status not in ('submitted', 'approved') then
    raise exception 'only submitted or approved revisions can be reopened; this one is %', r.status
      using errcode = '55000';
  end if;
  -- Recorded against the same content: as the latest decision it voids any earlier approval.
  insert into approvals (revision_id, content_hash, decision, decided_by, notes)
  values (p_revision, r.content_hash, 'changes_requested', uid, reason)
  returning id into aid;
  update revisions set status = 'changes_requested' where id = p_revision;
  perform audit('revision.reopened', 'revision', p_revision,
                jsonb_build_object('approval_id', aid, 'previous_status', r.status, 'reason', reason));
end $$;

-- ---------------------------------------------------------------------------
-- 6 and 8. Summary: period coverage and the neutral all-excluded label
-- ---------------------------------------------------------------------------

-- The calendar years a period label mentions, as a span. Same rule as periodYears() in
-- src/lib/compare.ts: "FY 2025" → 2025–2025, "2024/25" → 2024–2025, "2020–2024 plan" → 2020–2024,
-- no readable year → nulls. The character classes spell out JavaScript's \b, \s and \d exactly.
create function period_years(p_label text, out year_from int, out year_to int)
language sql immutable as $$
  with m as (
    select x[1]::int as first_year, x[2] as second
      from regexp_matches(coalesce(p_label, ''),
             '(?<![A-Za-z0-9_])((?:19|20)[0-9]{2})(?:[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[/\u2013\u2014-][\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*([0-9]{4}|[0-9]{2})(?![A-Za-z0-9_]))?',
             'g') as x),
  e as (
    select first_year,
           case length(second)
             when 4 then second::int
             when 2 then (first_year / 100) * 100 + second::int
                         + case when (first_year / 100) * 100 + second::int < first_year then 100 else 0 end
           end as end_year
      from m)
  select min(y), max(y)
    from e, lateral (values (first_year),
                            (case when end_year >= first_year and end_year - first_year <= 50 then end_year end)) as v(y)
$$;

-- Where a period sits against the assessment period: 'in_period' (years overlap), 'historical'
-- (entirely earlier), 'later' (entirely later) or 'unknown'. Same rule as periodCoverage().
create function period_coverage(p_period text, p_assessment text) returns text
language sql immutable as $$
  select case when p.year_from is null or a.year_from is null then 'unknown'
              when p.year_to < a.year_from then 'historical'
              when p.year_from > a.year_to then 'later'
              else 'in_period' end
    from period_years(p_period) p, period_years(p_assessment) a
$$;

-- Descriptive counts only; no score, no ranking. A published finding counts towards
-- 'all_applicable_published' only when its period overlaps the assessment period or cannot be
-- placed; prior-year evidence is counted as historical and cannot satisfy a current-period finding.
create or replace function revision_summary(p_revision uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with i as (
    select ri.state,
           case when ri.state = 'published' then period_coverage(ri.period_label, r.assessment_period) end as coverage
      from revision_indicators ri join revisions r on r.id = ri.revision_id
     where ri.revision_id = p_revision),
  c as (
    select count(*) filter (where state = 'published')        as published,
           count(*) filter (where coverage in ('in_period', 'unknown')) as current_published,
           count(*) filter (where coverage = 'historical')    as historical,
           count(*) filter (where state <> 'not_applicable')  as applicable,
           count(*) filter (where state not in ('not_assessed', 'not_applicable')) as assessed,
           count(*) filter (where state = 'not_applicable')   as excluded,
           count(*) filter (where state = 'not_assessed')     as not_assessed,
           count(*) filter (where state = 'uncertain')        as uncertain,
           count(*)                                           as total
      from i)
  select jsonb_build_object(
    'published', published, 'applicable', applicable, 'assessed', assessed,
    'excluded', excluded, 'uncertain', uncertain, 'total', total, 'historical', historical,
    'label', case
      when assessed = 0 and excluded = 0 then 'not_assessed'
      when not_assessed > 0              then 'assessment_incomplete'
      when uncertain > 0                 then 'evidence_uncertain'
      when applicable > 0 and current_published = applicable then 'all_applicable_published'
      when applicable = 0 and excluded > 0 then 'no_applicable_indicators'
      when published = 0                 then 'no_disclosures_found'
      else 'partial_disclosure' end)
  from c
$$;

-- ---------------------------------------------------------------------------
-- 7. Content and hash independent of the session time zone
-- ---------------------------------------------------------------------------

-- Canonical content of a revision. p_public = true drops internal notes and private evidence.
create or replace function revision_content(p_revision uuid, p_public boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp set timezone to 'UTC' as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'name', r.name, 'short_name', r.short_name, 'ownership', r.ownership,
      'institution_type', r.institution_type, 'state', r.state, 'city', r.city,
      'head_name', r.head_name, 'head_title', r.head_title, 'bursar_name', r.bursar_name,
      'website_url', r.website_url, 'assessment_period', r.assessment_period,
      'methodology_version_id', r.methodology_version_id,
      'last_verified_at', r.last_verified_at),
    'indicators', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', d.key, 'group', d.group_label, 'label', d.label, 'state', ri.state,
          'period_type', ri.period_type, 'period_label', ri.period_label,
          'period_start', ri.period_start, 'period_end', ri.period_end,
          'value_amount', ri.value_amount, 'value_scale', ri.value_scale,
          'value_currency', ri.value_currency, 'value_count', ri.value_count,
          'value_literal', ri.value_literal, 'reason', ri.reason,
          'internal_note', case when p_public then null else ri.internal_note end,
          'evidence', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', e.id, 'url', e.url, 'title', e.title, 'excerpt', e.excerpt,
                     'locator', e.locator, 'document_period', e.document_period,
                     'source_published_on', e.source_published_on,
                     'captured_at', e.captured_at, 'is_public', e.is_public)
                   order by e.created_at, e.id)
              from evidence_links e
             where e.revision_id = r.id and e.indicator_key = d.key
               and (not p_public or e.is_public)), '[]'::jsonb))
        order by d.sort_order)
        from indicator_definitions d
        join revision_indicators ri on ri.indicator_key = d.key and ri.revision_id = r.id),
      '[]'::jsonb),
    'profile_evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'url', e.url, 'title', e.title, 'excerpt', e.excerpt,
               'locator', e.locator, 'captured_at', e.captured_at)
             order by e.created_at, e.id)
        from evidence_links e
       where e.revision_id = r.id and e.indicator_key is null
         and (not p_public or e.is_public)), '[]'::jsonb))
  from revisions r where r.id = p_revision
$$;

create or replace function revision_hash(p_revision uuid) returns text
language sql stable security definer set search_path = public, pg_temp set timezone to 'UTC' as $$
  select encode(sha256(convert_to(revision_content(p_revision, false)::text, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- Access: new functions are executable by PUBLIC by default; start from nothing.
-- ---------------------------------------------------------------------------

revoke execute on function require_institution_writer(uuid), reopen_revision(uuid, text),
  period_years(text), period_coverage(text, text)
from public, nut_anon, nut_member, nut_system, nut_worker;

grant execute on function reopen_revision(uuid, text) to nut_member;

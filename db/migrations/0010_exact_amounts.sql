-- Exact amounts in published releases.
--
-- Releases store their content as jsonb. A numeric value_amount became a JSON number there, and
-- readers parse JSON numbers as floating point, so a stored 4250.50 was shown as 4,250.5 and very
-- large amounts lost digits. value_amount is now written as its exact decimal text; the CMS, public
-- pages and CSV already accept text (and still read numbers in older releases).
--
-- This changes the canonical content, so a revision submitted or approved before this migration
-- fails the content check at review or publish; return it with reopen_revision (shown as "Return
-- for changes") and resubmit. Nothing has been deployed yet, so only local databases are affected.

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
          'value_amount', ri.value_amount::text, 'value_scale', ri.value_scale,
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

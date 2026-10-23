-- Verification refuses evidence that does not belong to the institution: a disclosure page or
-- evidence link on another institution's website (the FUPRE link on the PTI row), a homepage given
-- as evidence, or a link whose latest check found it dead, homepage-only or redirecting to the
-- homepage. Same signature as 0014, so grants are kept.

-- The site an address belongs to: its host, lower case, without a leading www or trailing dot.
create function site_of(u text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(lower(substring(u from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?([^/?#:]+)')), '\.$', ''), '^www\.', ''), '')
$$;

-- True when two addresses are on the same site (one host equals, or is a subdomain of, the other).
create function same_site(a text, b text) returns boolean language sql immutable as $$
  select site_of(a) is not null and site_of(b) is not null
     and (site_of(a) = site_of(b) or site_of(a) like '%.' || site_of(b) or site_of(b) like '%.' || site_of(a))
$$;

revoke all on function site_of(text) from public;
revoke all on function same_site(text, text) from public;

create or replace function verify_report_entry(p_id uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('reviewer', 'admin');
  e   report_entries;
  d   record;
  a   jsonb;
  ev  text;
  c   record;
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
  if e.homepage_url is null then problems := problems || 'the homepage is missing'::text; end if;
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
      if (a->>'status') <> 'nil' and a->>'year' is null then problems := problems || format('%s has no reporting year', d.label); end if;
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
  -- The latest check of each address the record uses as evidence must not have found a broken link.
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
  update report_entries set verified = register_content(e), verified_at = now(), verified_by = uid, pending = false,
         editors = '{}', return_note = null
   where id = p_id;
  perform audit('report.entry_verified', 'report_entry', p_id, jsonb_build_object('hash', p_hash));
end $$;

-- Editors see every reason the importer withheld or doubted a value, not only the reasons that held
-- the row. A web address shared with another row, or a cell holding several addresses, is kept out
-- of the record (never trusted automatically); the record now says why, so the editor knows to
-- confirm the address from the spreadsheet text shown beside the field.
--
-- load_report_from_import (0016) only skips rows flagged potential_duplicate or missing_name, which
-- always hold the row, so widening this list changes what editors see, not what is loaded.
create or replace function import_hold_codes(p_issues jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct i->>'code' order by i->>'code'), '{}')
    from jsonb_array_elements(case when jsonb_typeof(p_issues) = 'array' then p_issues else '[]'::jsonb end) i
   where coalesce((i->>'holds')::boolean, false)
      or i->>'code' in ('shared_domain', 'website_multiple_urls', 'website_missing_protocol', 'website_markdown_link',
                        'location_not_state')
$$;

update report_entries e set import_flags = import_hold_codes(r.issues)
  from import_rows r
 where r.id = e.source_row_id;

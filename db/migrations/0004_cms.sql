-- CMS work tracking: assignments, editable through a checked function like everything else.

create function assign_institution(p_institution uuid, p_editor uuid, p_reviewer uuid, p_due_on date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := require_role('reviewer', 'admin');
  aid uuid;
begin
  if not exists (select 1 from institutions where id = p_institution) then
    raise exception 'institution not found' using errcode = 'P0002';
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
  update assignments set closed_at = now() where institution_id = p_institution and closed_at is null;
  insert into assignments (institution_id, editor_id, reviewer_id, due_on, assigned_by)
  values (p_institution, p_editor, p_reviewer, p_due_on, uid)
  returning id into aid;
  perform audit('institution.assigned', 'institution', p_institution,
                jsonb_build_object('assignment_id', aid, 'editor_id', p_editor,
                                   'reviewer_id', p_reviewer, 'due_on', p_due_on));
  return aid;
end $$;

create unique index assignments_one_open on assignments (institution_id) where closed_at is null;

revoke execute on function assign_institution(uuid, uuid, uuid, date) from public, nut_anon, nut_member;
grant execute on function assign_institution(uuid, uuid, uuid, date) to nut_member;

-- Platform roles for plain Postgres (Neon in production, PGlite locally).
--
-- Three NOLOGIN roles carry every privilege the application has:
--   nut_anon    public visitors: may read published snapshots only
--   nut_member  signed-in team members: reads per RLS; every write goes through checked functions
--   nut_system  the account service: sign-in, sessions, setup and invitations, nothing else
--
-- The application's login role owns nothing and has no privileges of its own. Each request opens
-- one transaction, runs SET LOCAL ROLE nut_anon|nut_member|nut_system, and (for team members) sets
-- the verified user id with set_config('nut.user_id', <uuid>, true). Grants and RLS then apply as
-- written. SECURITY DEFINER workflow functions run as the migration owner, as intended.
--
-- Names are deliberately project-specific: Neon's pg_session_jwt and Data API use an "auth" schema
-- and the roles "authenticated"/"anonymous", so these never collide with them.
--
-- Production login role (run once per branch as the owner; the password lives only in the
-- connection string held by the host):
--   create role nut_app login password '<random>' noinherit;
--   grant nut_anon, nut_member, nut_system to nut_app;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nut_anon') then
    create role nut_anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'nut_member') then
    create role nut_member nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'nut_system') then
    create role nut_system nologin;
  end if;
end $$;

-- The migrating role can also switch into them (local development and maintenance).
grant nut_anon, nut_member, nut_system to current_user;

create schema if not exists nut_auth;

-- The signed-in team member for this transaction, or null for public requests. Only trusted server
-- code sets nut.user_id, after verifying the session; clients never reach SQL directly.
create or replace function nut_auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('nut.user_id', true), '')::uuid
$$;

revoke all on schema nut_auth from public;
grant usage on schema nut_auth to nut_anon, nut_member, nut_system;
revoke execute on function nut_auth.uid() from public;
grant execute on function nut_auth.uid() to nut_anon, nut_member, nut_system;

revoke create on schema public from public;
grant usage on schema public to nut_anon, nut_member, nut_system;

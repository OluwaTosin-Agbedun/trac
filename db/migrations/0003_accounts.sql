-- Team accounts, sessions, invitations and one-time setup.
--
-- These tables are reachable only by the account service, which runs as the nut_system role. The
-- request roles (nut_anon, nut_member) have no grants and no policies here, so a public or team
-- request can never read password hashes, session hashes or invite hashes.
--
-- Security rules enforced here:
--   * Passwords, session tokens and invite tokens are stored only as hashes.
--   * The setup flag, once written, can never be changed or removed, so the public setup screen
--     cannot reopen even if every administrator is later removed.
--   * A team membership requires a real account.

create table app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  display_name  text not null check (length(btrim(display_name)) between 1 and 120),
  password_hash text,                          -- null: cannot sign in with a password (fixtures, pending)
  is_fixture    boolean not null default false,
  created_at    timestamptz not null default now(),
  disabled_at   timestamptz
);
create unique index app_users_email_lower on app_users (lower(email));

create table app_sessions (
  token_hash   text primary key,               -- sha256 of the random cookie token
  user_id      uuid not null references app_users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index app_sessions_user on app_sessions (user_id);

create table app_invites (
  token_hash  text primary key,
  email       text not null,
  role        team_role not null check (role in ('editor', 'reviewer', 'admin')),
  invited_by  uuid not null references app_users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references app_users(id),
  revoked_at  timestamptz
);

create table app_settings (
  key    text primary key,
  value  jsonb not null,
  set_at timestamptz not null default now()
);

create table app_login_attempts (
  id          bigint generated always as identity primary key,
  email_lower text not null,
  ip          text,
  at          timestamptz not null default now(),
  succeeded   boolean not null
);
create index app_login_attempts_lookup on app_login_attempts (email_lower, at);

-- Setup and other one-way flags can be written once and never changed or deleted.
create function guard_one_way_settings() returns trigger language plpgsql as $$
begin
  if old.key in ('setup_completed', 'fixtures_seeded') then
    raise exception 'setting % is permanent', old.key using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;

create trigger app_settings_one_way before update or delete on app_settings
  for each row execute function guard_one_way_settings();

-- Every team member is a real account.
alter table team_memberships
  add constraint team_memberships_user_fk foreign key (user_id) references app_users(id);

revoke all on app_users, app_sessions, app_invites, app_settings, app_login_attempts from nut_anon, nut_member;
alter table app_users          enable row level security;
alter table app_sessions       enable row level security;
alter table app_invites        enable row level security;
alter table app_settings       enable row level security;
alter table app_login_attempts enable row level security;

-- The account service: exactly the rights sign-in, sessions, setup and invitations need.
-- No deletes anywhere; settings are insert-only (the one-way trigger covers updates too).
grant select, insert, update on app_users, app_sessions, app_invites to nut_system;
grant select, insert on app_settings, app_login_attempts to nut_system;
grant select, insert, update on team_memberships to nut_system;
grant insert on audit_events to nut_system;
create policy account_service on app_users          for all to nut_system using (true) with check (true);
create policy account_service on app_sessions       for all to nut_system using (true) with check (true);
create policy account_service on app_invites        for all to nut_system using (true) with check (true);
create policy account_service on app_settings       for all to nut_system using (true) with check (true);
create policy account_service on app_login_attempts for all to nut_system using (true) with check (true);
create policy account_service on team_memberships   for all to nut_system using (true) with check (true);
create policy account_service on audit_events       for insert to nut_system with check (actor_id is not null);

-- Team members may see each other's names (for assignments and review attribution), never
-- credentials or emails. The view runs with its owner's rights, so it filters to team members
-- explicitly: anyone else gets no rows.
create view team_directory with (security_barrier) as
  select m.user_id, u.display_name, m.role, m.active
    from team_memberships m join app_users u on u.id = m.user_id
   where current_team_role() in ('editor', 'reviewer', 'admin');
revoke all on team_directory from nut_anon, nut_member;
grant select on team_directory to nut_member;

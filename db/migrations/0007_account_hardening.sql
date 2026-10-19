-- Account hardening after the security review.
--
-- 1. Sign-in attempts are recorded before the password is checked (as a provisional failure that is
--    flipped to succeeded afterwards), so a burst of parallel guesses cannot all slip under the
--    limit. The account service needs UPDATE for that, and to clear a lock.
-- 2. "cleared" lets an administrator (or the owner, from the command line) lift a sign-in lock.
-- 3. Invitations get an id so an administrator can revoke one without the token or its hash ever
--    reaching the browser.

alter table app_login_attempts add column cleared boolean not null default false;
create index app_login_attempts_recent on app_login_attempts (email_lower, at) where not succeeded and not cleared;

alter table app_invites add column id uuid not null default gen_random_uuid();
create unique index app_invites_id on app_invites (id);

grant update (succeeded, cleared) on app_login_attempts to nut_system;
grant update (revoked_at) on app_invites to nut_system;

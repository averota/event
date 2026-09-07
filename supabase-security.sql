-- ============================================================
-- Supabase security hardening
-- Run this in the Supabase SQL editor (Project → SQL Editor).
--
-- This assumes two tables:
--   invitees  — the invite list (columns: employee_id, fullname,
--               gender, position, department, bu)
--   attendees — people who have actually registered/checked in
-- If your columns differ, adjust the RPC bodies below
-- (check_employee / register_participant / get_dashboard_stats /
-- list_attendees) to match your existing function definitions if
-- they already exist with different logic.
--
-- GOAL: nothing is reachable with the public anon key except the two
-- narrow, purpose-built RPCs the public kiosk (register.html) needs.
-- Everything else requires a real logged-in Supabase Auth user
-- (`authenticated` role), which is what login.html/index.html/
-- invitees.html now enforce.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Lock down the base tables. No role gets implicit access —
--    RLS with zero policies for anon effectively blocks it, and we
--    also revoke the table-level grants Supabase creates by default.
-- ------------------------------------------------------------
alter table public.invitees   enable row level security;
alter table public.attendees enable row level security;

revoke all on public.invitees   from anon, authenticated, public;
revoke all on public.attendees from anon, authenticated, public;

-- Drop any pre-existing permissive policies before re-adding ours
-- (safe no-ops if they don't exist).
drop policy if exists "authenticated_full_access_invitees"   on public.invitees;
drop policy if exists "authenticated_full_access_attendees" on public.attendees;

-- Logged-in admin users (dashboard.html / invitees.html) may read/write
-- directly if you still want ad-hoc table access from the SQL editor
-- or future features. The RPCs below are the actual path the apps use.
create policy "authenticated_full_access_invitees"
  on public.invitees for all
  to authenticated
  using (true)
  with check (true);

create policy "authenticated_full_access_attendees"
  on public.attendees for all
  to authenticated
  using (true)
  with check (true);

-- anon gets NO policy at all on either table => zero direct access,
-- even though the anon key is public. All anon access to attendees
-- data goes exclusively through check_employee / register_participant.

-- ------------------------------------------------------------
-- 2. Public kiosk RPCs (register.html) — SECURITY DEFINER so they can
--    do their job under a fixed, narrow set of operations regardless
--    of the caller's own row-level permissions, but each one must
--    validate/limit what it does internally. Grant to anon explicitly.
-- ------------------------------------------------------------
-- Example shape — replace the body with your existing implementation,
-- just make sure `security definer` + `set search_path = public` and
-- the grants below stay in place.
--
-- create or replace function public.check_employee(p_employee_id text)
-- returns jsonb
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$ ... $$;
--
-- create or replace function public.register_participant(
--   p_employee_id text, p_fullname text, p_gender text, p_position text,
--   p_department text, p_bu text, p_is_invited boolean
-- ) returns jsonb
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$ ... $$;

revoke execute on function public.check_employee(text) from public;
revoke execute on function public.register_participant(text, text, text, text, text, text, boolean) from public;

grant execute on function public.check_employee(text) to anon, authenticated;
grant execute on function public.register_participant(text, text, text, text, text, text, boolean) to anon, authenticated;

-- ------------------------------------------------------------
-- 3. Admin-only RPCs (index.html) — authenticated only, NEVER anon.
-- ------------------------------------------------------------
-- create or replace function public.get_dashboard_stats()
-- returns jsonb
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$ ... $$;
--
-- create or replace function public.list_attendees()
-- returns setof public.attendees
-- language sql
-- security definer
-- set search_path = public
-- as $$ select * from public.attendees order by created_at desc; $$;

revoke execute on function public.get_dashboard_stats() from public, anon;
revoke execute on function public.list_attendees()      from public, anon;

grant execute on function public.get_dashboard_stats() to authenticated;
grant execute on function public.list_attendees()      to authenticated;

-- Delete a single attendee/registration row. Assumes a primary key
-- column called `id` (bigint/bigserial) — adjust the parameter type
-- and the `where` clause below if your primary key is named or typed
-- differently (e.g. a uuid).
create or replace function public.admin_delete_attendee(p_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.attendees where id = p_id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Wipe every attendee/registration row — used by the "Clear all
-- attendees" button on index.html to start a fresh event on the same
-- database without touching the invite list.
create or replace function public.admin_clear_attendees()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.attendees where true;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.admin_delete_attendee(bigint) from public, anon;
revoke execute on function public.admin_clear_attendees()       from public, anon;

grant execute on function public.admin_delete_attendee(bigint) to authenticated;
grant execute on function public.admin_clear_attendees()       to authenticated;

-- ------------------------------------------------------------
-- 4. Admin-only RPCs (invitees.html) — replace the old direct
--    `db.from('invitees').select/insert/delete()` calls that ran
--    with just the anon key. These are new; add them if they don't
--    exist yet.
-- ------------------------------------------------------------
create or replace function public.admin_list_employee_ids()
returns table (employee_id text)
language sql
security definer
set search_path = public
as $$
  select employee_id from public.invitees;
$$;

create or replace function public.admin_list_invitees()
returns setof public.invitees
language sql
security definer
set search_path = public
as $$
  select * from public.invitees order by employee_id;
$$;

create or replace function public.admin_append_invitees(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.invitees (employee_id, fullname, gender, position, department, bu)
  select
    r->>'employee_id', r->>'fullname', r->>'gender',
    r->>'position', r->>'department', r->>'bu'
  from jsonb_array_elements(p_rows) as r
  on conflict (employee_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.admin_overwrite_invitees(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  delete from public.invitees where true;

  insert into public.invitees (employee_id, fullname, gender, position, department, bu)
  select
    r->>'employee_id', r->>'fullname', r->>'gender',
    r->>'position', r->>'department', r->>'bu'
  from jsonb_array_elements(p_rows) as r;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Delete a single invitee by employee_id — used by the per-row
-- delete button in the "View invitee list" table.
create or replace function public.admin_delete_invitee(p_employee_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.invitees where employee_id = p_employee_id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Update a single invitee's fields, identified by their original
-- employee_id — used by the per-row edit button in the "View invitee
-- list" table. p_original_employee_id finds the row; p_employee_id is
-- the (possibly changed) new value to save, allowing the ID itself to
-- be corrected. If p_employee_id collides with another existing row,
-- this fails with a uniqueness violation, which the app surfaces as
-- an "Update failed" message rather than silently overwriting data.
create or replace function public.admin_update_invitee(
  p_original_employee_id text,
  p_employee_id text,
  p_fullname text,
  p_gender text,
  p_position text,
  p_department text,
  p_bu text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.invitees
  set employee_id = p_employee_id,
      fullname = p_fullname,
      gender = p_gender,
      position = p_position,
      department = p_department,
      bu = p_bu
  where employee_id = p_original_employee_id;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- Wipe every invitee row — used by the "Clear all invitees" button
-- to start a fresh invite list without touching existing registrations.
create or replace function public.admin_clear_invitees()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.invitees where true;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.admin_list_employee_ids()      from public, anon;
revoke execute on function public.admin_list_invitees()          from public, anon;
revoke execute on function public.admin_append_invitees(jsonb)   from public, anon;
revoke execute on function public.admin_overwrite_invitees(jsonb) from public, anon;
revoke execute on function public.admin_delete_invitee(text)     from public, anon;
revoke execute on function public.admin_update_invitee(text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.admin_clear_invitees()         from public, anon;

grant execute on function public.admin_list_employee_ids()       to authenticated;
grant execute on function public.admin_list_invitees()           to authenticated;
grant execute on function public.admin_append_invitees(jsonb)    to authenticated;
grant execute on function public.admin_overwrite_invitees(jsonb) to authenticated;
grant execute on function public.admin_delete_invitee(text)      to authenticated;
grant execute on function public.admin_update_invitee(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_clear_invitees()          to authenticated;



-- ------------------------------------------------------------
-- 5. Audit tracking: who changed an invitee record, and when.
--
--    Adds two columns to public.invitees and a trigger that stamps
--    them automatically on every INSERT/UPDATE — including from
--    admin_append_invitees, admin_overwrite_invitees, and
--    admin_update_invitee above, and from any direct SQL edit an
--    admin makes in the Supabase dashboard, since it's a table-level
--    trigger rather than logic duplicated inside each RPC.
--
--    Database-only change: no HTML/JS reads or displays these columns.
-- ------------------------------------------------------------
alter table public.invitees
  add column if not exists last_modified timestamp without time zone,
  add column if not exists modified_by text;

-- last_modified is stored as a plain (timezone-naive) timestamp
-- already shifted to Phnom Penh's wall-clock time (UTC+7, no DST),
-- via `now() AT TIME ZONE 'Asia/Phnom_Penh'`. Unlike a `timestamptz`
-- column, this value won't silently re-render in a different zone
-- depending on who/what queries it later — it always reads as Phnom
-- Penh local time, matching how the app already displays timestamps
-- elsewhere (see formatPhnomPenhTime() in index.js).
--
-- modified_by prefers the caller's email from their JWT (readable at
-- a glance in the dashboard), falling back to their user id, or
-- 'unknown' for the rare case for a write with no identifiable
-- session (auth.jwt() and auth.uid() aren't affected by these
-- functions being SECURITY DEFINER — they reflect the actual calling
-- user's session, not the function owner).
create or replace function public.set_invitees_audit_fields()
returns trigger
language plpgsql
as $$
begin
  new.last_modified := (now() AT TIME ZONE 'Asia/Phnom_Penh');
  new.modified_by := coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'unknown');
  return new;
end;
$$;

drop trigger if exists trg_invitees_audit on public.invitees;
create trigger trg_invitees_audit
before insert or update on public.invitees
for each row
execute function public.set_invitees_audit_fields();

-- ------------------------------------------------------------
-- 6. Live dashboard updates (Realtime).
--    This lets index.html subscribe to new rows and refresh
--    automatically instead of requiring a manual "Refresh" click.
--    Realtime enforces the SAME RLS policies as normal queries, so
--    this is safe: only a logged-in `authenticated` user can receive
--    these change events, because that's who the RLS policy in
--    section 1 already grants SELECT to. No anon exposure is added.
-- ------------------------------------------------------------
-- Idempotent: only adds the table if it isn't already publishing
-- changes, so this script can be re-run safely without erroring on
-- "relation is already member of publication".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attendees'
  ) then
    alter publication supabase_realtime add table public.attendees;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. Auth hardening (do this in the Dashboard, not SQL):
--    Authentication → Providers → Email:
--      - Turn OFF "Allow new users to sign up" — accounts for
--        index.html/invitees.html should only be created by an
--        admin (Authentication → Users → Add user), matching the
--        requirement that login uses pre-created Supabase users.
--    Authentication → URL Configuration:
--      - Set Site URL and Redirect URLs to your real deployed
--        domain only (removes any localhost/preview wildcard).
--    Project Settings → API:
--      - Confirm the service_role key is never used client-side and
--        is not present anywhere in this repository.
-- ------------------------------------------------------------

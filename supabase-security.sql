-- ============================================================
-- Supabase security hardening
-- Run this in the Supabase SQL editor (Project → SQL Editor).
--
-- ADAPT THE NAMES: this assumes a table called `invitees` (columns:
-- employee_id, fullname, gender, position, department, bu) and an
-- attendance/registration table — rename `attendance` below to
-- whatever your registrations table is actually called, and adjust
-- the RPC bodies (check_employee / register_participant /
-- get_dashboard_stats / list_attendees) to match your existing
-- function definitions if they already exist with different logic.
--
-- GOAL: nothing is reachable with the public anon key except the two
-- narrow, purpose-built RPCs the public kiosk (register.html) needs.
-- Everything else requires a real logged-in Supabase Auth user
-- (`authenticated` role), which is what login.html/dashboard.html/
-- invitees.html now enforce.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Lock down the base tables. No role gets implicit access —
--    RLS with zero policies for anon effectively blocks it, and we
--    also revoke the table-level grants Supabase creates by default.
-- ------------------------------------------------------------
alter table public.invitees   enable row level security;
alter table public.attendance enable row level security;

revoke all on public.invitees   from anon, authenticated, public;
revoke all on public.attendance from anon, authenticated, public;

-- Drop any pre-existing permissive policies before re-adding ours
-- (safe no-ops if they don't exist).
drop policy if exists "authenticated_full_access_invitees"   on public.invitees;
drop policy if exists "authenticated_full_access_attendance" on public.attendance;

-- Logged-in admin users (dashboard.html / invitees.html) may read/write
-- directly if you still want ad-hoc table access from the SQL editor
-- or future features. The RPCs below are the actual path the apps use.
create policy "authenticated_full_access_invitees"
  on public.invitees for all
  to authenticated
  using (true)
  with check (true);

create policy "authenticated_full_access_attendance"
  on public.attendance for all
  to authenticated
  using (true)
  with check (true);

-- anon gets NO policy at all on either table => zero direct access,
-- even though the anon key is public. All anon access to attendance
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
-- 3. Admin-only RPCs (dashboard.html) — authenticated only, NEVER anon.
-- ------------------------------------------------------------
-- create or replace function public.get_dashboard_stats()
-- returns jsonb
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$ ... $$;
--
-- create or replace function public.list_attendees()
-- returns setof public.attendance
-- language sql
-- security definer
-- set search_path = public
-- as $$ select * from public.attendance order by created_at desc; $$;

revoke execute on function public.get_dashboard_stats() from public, anon;
revoke execute on function public.list_attendees()      from public, anon;

grant execute on function public.get_dashboard_stats() to authenticated;
grant execute on function public.list_attendees()      to authenticated;

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
  delete from public.invitees;

  insert into public.invitees (employee_id, fullname, gender, position, department, bu)
  select
    r->>'employee_id', r->>'fullname', r->>'gender',
    r->>'position', r->>'department', r->>'bu'
  from jsonb_array_elements(p_rows) as r;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke execute on function public.admin_list_employee_ids()      from public, anon;
revoke execute on function public.admin_list_invitees()          from public, anon;
revoke execute on function public.admin_append_invitees(jsonb)   from public, anon;
revoke execute on function public.admin_overwrite_invitees(jsonb) from public, anon;

grant execute on function public.admin_list_employee_ids()       to authenticated;
grant execute on function public.admin_list_invitees()           to authenticated;
grant execute on function public.admin_append_invitees(jsonb)    to authenticated;
grant execute on function public.admin_overwrite_invitees(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 5. Auth hardening (do this in the Dashboard, not SQL):
--    Authentication → Providers → Email:
--      - Turn OFF "Allow new users to sign up" — accounts for
--        dashboard.html/invitees.html should only be created by an
--        admin (Authentication → Users → Add user), matching the
--        requirement that login uses pre-created Supabase users.
--    Authentication → URL Configuration:
--      - Set Site URL and Redirect URLs to your real deployed
--        domain only (removes any localhost/preview wildcard).
--    Project Settings → API:
--      - Confirm the service_role key is never used client-side and
--        is not present anywhere in this repository.
-- ------------------------------------------------------------

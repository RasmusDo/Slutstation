-- ============================================================================
-- SLUTSTATION — per-event staff tags  (run AFTER schema-phase2.sql)
--
-- Changes the model: `profiles.role` is now only the PERMANENT account tag
-- (member | admin). Door and bar are granted per event, and stop working on
-- their own once the event is over — nothing to remember to revoke.
--
-- Access window: from 4h before doors until 6h after the event ends. A staff
-- member's phone is useless the next day.
--
-- Staff see only what the job needs (name, membership, tier) — never address,
-- phone, birth date or email. That is enforced by returning limited columns
-- from SECURITY DEFINER functions rather than opening the profiles table.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'staff_role') then
    create type public.staff_role as enum ('door', 'bar');
  end if;
end $$;

-- account tag is only member/admin now; any old door/bar tags become member
update public.profiles set role = 'member' where role in ('door', 'bar');
alter table public.profiles drop constraint if exists profiles_role_account_only;
alter table public.profiles add constraint profiles_role_account_only
  check (role in ('member', 'admin'));

comment on column public.profiles.role is
  'Permanent account tag: member or admin only. Door/bar are per-event — see event_staff.';

-- ----------------------------------------------------------------------------
-- Per-event assignments
-- ----------------------------------------------------------------------------
create table if not exists public.event_staff (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id)   on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  staff_role public.staff_role not null,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists event_staff_user_idx  on public.event_staff (user_id);
create index if not exists event_staff_event_idx on public.event_staff (event_id);

-- ----------------------------------------------------------------------------
-- "Am I on shift right now?"
-- ----------------------------------------------------------------------------
create or replace function public.active_staff_event()
returns uuid language sql stable security definer set search_path = public as $$
  select es.event_id
    from public.event_staff es
    join public.events e on e.id = es.event_id
   where es.user_id = auth.uid()
     and now() >= e.starts_at - interval '4 hours'
     and now() <= coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '6 hours'
   order by e.starts_at desc
   limit 1;
$$;

create or replace function public.active_staff_role()
returns public.staff_role language sql stable security definer set search_path = public as $$
  select es.staff_role
    from public.event_staff es
    join public.events e on e.id = es.event_id
   where es.user_id = auth.uid()
     and now() >= e.starts_at - interval '4 hours'
     and now() <= coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '6 hours'
   order by e.starts_at desc
   limit 1;
$$;

-- Redefining is_staff() updates every policy that already uses it.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.active_staff_event() is not null or public.is_admin();
$$;

-- What the staff member sees about their own shift
create or replace function public.my_shift()
returns json language sql stable security definer set search_path = public as $$
  select case when public.active_staff_event() is null then null else
    (select json_build_object(
       'event_id', e.id, 'event_name', e.name, 'venue', e.venue,
       'starts_at', e.starts_at, 'role', public.active_staff_role())
     from public.events e where e.id = public.active_staff_event())
  end;
$$;

-- ----------------------------------------------------------------------------
-- Policies
-- ----------------------------------------------------------------------------
-- staff must NOT read the profiles table directly (it holds address, phone,
-- birth date). They go through the limited functions below instead.
drop policy if exists profiles_staff_read on public.profiles;

drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles
  for select using (public.is_admin());

-- staff see attendance only for the event they are working
drop policy if exists attendance_read_own on public.attendance;
create policy attendance_read_own on public.attendance
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or event_id = public.active_staff_event()
  );

alter table public.event_staff enable row level security;
drop policy if exists event_staff_read on public.event_staff;
create policy event_staff_read on public.event_staff
  for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists event_staff_admin_write on public.event_staff;
create policy event_staff_admin_write on public.event_staff
  for all using (public.is_admin()) with check (public.is_admin());

-- settings are admin-only now (they were staff-readable)
drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings
  for select using (public.is_admin());

-- ----------------------------------------------------------------------------
-- Door: check someone in. Returns only what the door needs to see.
-- ----------------------------------------------------------------------------
create or replace function public.staff_check_in(p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  ev uuid := public.active_staff_event();
  rl public.staff_role := public.active_staff_role();
  already boolean;
  res json;
begin
  if ev is null then
    raise exception 'You are not on shift for any event right now';
  end if;
  if rl is distinct from 'door' and not public.is_admin() then
    raise exception 'Door staff only';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Unknown member';
  end if;

  select exists (select 1 from public.attendance
                  where user_id = p_user and event_id = ev) into already;

  insert into public.attendance (user_id, event_id, checked_in_by, source)
  values (p_user, ev, auth.uid(), 'door_scan')
  on conflict (user_id, event_id) do nothing;

  select json_build_object(
    'user_id',   p.id,
    'name',      nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
    'member_ok', coalesce(m.is_active_member, false),
    'tier',      s.tier,
    'tier_name', s.tier_name,
    'events',    s.events_window,
    'already_checked_in', already
  ) into res
  from public.profiles p
  left join public.membership_status m on m.id = p.id
  left join public.member_stats s      on s.id = p.id
  where p.id = p_user;

  return res;
end $$;

-- ----------------------------------------------------------------------------
-- Door/bar: look a member up by name. Limited columns only.
-- ----------------------------------------------------------------------------
create or replace function public.staff_lookup(p_query text)
returns table (user_id uuid, name text, member_ok boolean, tier int,
               tier_name text, checked_in boolean)
language plpgsql stable security definer set search_path = public as $$
declare ev uuid := public.active_staff_event();
begin
  if ev is null and not public.is_admin() then
    raise exception 'You are not on shift for any event right now';
  end if;
  if coalesce(trim(p_query), '') = '' then return; end if;

  return query
  select p.id,
         nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
         coalesce(m.is_active_member, false),
         s.tier, s.tier_name,
         exists (select 1 from public.attendance a
                  where a.user_id = p.id and a.event_id = ev)
  from public.profiles p
  left join public.membership_status m on m.id = p.id
  left join public.member_stats s      on s.id = p.id
  where (coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) ilike '%' || trim(p_query) || '%'
  order by p.first_name
  limit 25;
end $$;

-- Tonight's check-ins for the event the caller is working (spot doubles, undo)
create or replace function public.staff_tonight()
returns table (user_id uuid, name text, checked_in_at timestamptz, tier int)
language plpgsql stable security definer set search_path = public as $$
declare ev uuid := public.active_staff_event();
begin
  if ev is null then return; end if;
  return query
  select p.id,
         nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
         a.checked_in_at, s.tier
  from public.attendance a
  join public.profiles p on p.id = a.user_id
  left join public.member_stats s on s.id = p.id
  where a.event_id = ev
  order by a.checked_in_at desc
  limit 200;
end $$;

-- Door staff can undo their own mistake, but only for tonight's event
create or replace function public.staff_undo_check_in(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ev uuid := public.active_staff_event();
begin
  if ev is null then raise exception 'You are not on shift'; end if;
  if public.active_staff_role() is distinct from 'door' and not public.is_admin() then
    raise exception 'Door staff only';
  end if;
  delete from public.attendance where user_id = p_user and event_id = ev;
end $$;

-- ----------------------------------------------------------------------------
-- Admin: assign / revoke per-event tags
-- ----------------------------------------------------------------------------
create or replace function public.admin_assign_staff(p_event uuid, p_user uuid, p_role public.staff_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  insert into public.event_staff (event_id, user_id, staff_role, granted_by)
  values (p_event, p_user, p_role, auth.uid())
  on conflict (event_id, user_id) do update set staff_role = excluded.staff_role,
                                                granted_by = excluded.granted_by,
                                                granted_at = now();
end $$;

create or replace function public.admin_revoke_staff(p_event uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  delete from public.event_staff where event_id = p_event and user_id = p_user;
end $$;

-- ----------------------------------------------------------------------------
-- Admin: overview numbers + user browser
-- ----------------------------------------------------------------------------
create or replace function public.admin_overview()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select json_build_object(
    'accounts_total',      (select count(*) from public.profiles),
    'members_active',      (select count(*) from public.membership_status where is_active_member),
    'members_expired',     (select count(*) from public.profiles where ebas_status = 'expired'),
    'members_unverified',  (select count(*) from public.profiles where ebas_status = 'unverified'),
    'signups_30d',         (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'admins',              (select count(*) from public.profiles where role = 'admin'),
    'events_total',        (select count(*) from public.events),
    'events_upcoming',     (select count(*) from public.events where starts_at > now()),
    'checkins_total',      (select count(*) from public.attendance),
    'avg_events_per_member',
      (select round(coalesce(avg(events_total), 0)::numeric, 2) from public.member_stats),
    'tier_counts', (select json_object_agg(t, c) from (
        select 'tier_' || tier as t, count(*) as c from public.member_stats group by tier
      ) x),
    'marketing_opt_in',    (select count(*) from public.profiles where marketing_consent)
  ));
end $$;

create or replace function public.admin_users(p_search text default '', p_limit int default 50, p_offset int default 0)
returns table (
  user_id uuid, name text, email text, role public.user_role,
  ebas_status public.ebas_status, member_ok boolean,
  tier int, events_window int, events_total int,
  last_attended_at timestamptz, created_at timestamptz,
  marketing_consent boolean, city text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return query
  select p.id,
         nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
         p.email, p.role, p.ebas_status,
         coalesce(m.is_active_member, false),
         s.tier, s.events_window, s.events_total,
         s.last_attended_at, p.created_at, p.marketing_consent, p.city
  from public.profiles p
  left join public.membership_status m on m.id = p.id
  left join public.member_stats s      on s.id = p.id
  where coalesce(trim(p_search), '') = ''
     or (coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'') || ' ' || p.email)
        ilike '%' || trim(p_search) || '%'
  order by p.created_at desc
  limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
end $$;

-- Everything an admin needs about one member, including their event history
create or replace function public.admin_user_detail(p_user uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select json_build_object(
    'profile', (select row_to_json(x) from (
        select p.id, p.first_name, p.last_name, p.email, p.phone, p.city,
               p.role, p.ebas_status, p.ebas_renewed_on, p.created_at,
               p.marketing_consent, p.referral_code
        from public.profiles p where p.id = p_user) x),
    'stats', (select row_to_json(y) from (
        select s.tier, s.tier_name, s.events_window, s.events_total,
               s.first_attended_at, s.last_attended_at, s.credit_ore,
               s.events_to_next_tier, s.next_tier
        from public.member_stats s where s.id = p_user) y),
    'attendance', coalesce((select json_agg(row_to_json(z) order by z.checked_in_at desc) from (
        select e.name, e.venue, a.checked_in_at, a.source, e.id as event_id
        from public.attendance a join public.events e on e.id = a.event_id
        where a.user_id = p_user) z), '[]'::json),
    'shifts', coalesce((select json_agg(row_to_json(w)) from (
        select e.name, e.starts_at, es.staff_role, es.event_id
        from public.event_staff es join public.events e on e.id = es.event_id
        where es.user_id = p_user order by e.starts_at desc) w), '[]'::json)
  ));
end $$;

-- Per-event roster: who worked it, who came
create or replace function public.admin_event_detail(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select json_build_object(
    'event', (select row_to_json(e) from public.events e where e.id = p_event),
    'checkins', (select count(*) from public.attendance where event_id = p_event),
    'staff', coalesce((select json_agg(row_to_json(s)) from (
        select es.user_id, es.staff_role,
               nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as name
        from public.event_staff es join public.profiles p on p.id = es.user_id
        where es.event_id = p_event) s), '[]'::json)
  ));
end $$;

grant execute on function public.my_shift() to authenticated;
grant execute on function public.staff_check_in(uuid) to authenticated;
grant execute on function public.staff_undo_check_in(uuid) to authenticated;
grant execute on function public.staff_lookup(text) to authenticated;
grant execute on function public.staff_tonight() to authenticated;
grant execute on function public.admin_assign_staff(uuid, uuid, public.staff_role) to authenticated;
grant execute on function public.admin_revoke_staff(uuid, uuid) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_users(text, int, int) to authenticated;
grant execute on function public.admin_user_detail(uuid) to authenticated;
grant execute on function public.admin_event_detail(uuid) to authenticated;

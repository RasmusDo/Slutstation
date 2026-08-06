-- ============================================================================
-- SLUTSTATION, phase 7 — the crew view
--
-- Door and bar tags are per-event and expire on their own, which is the right
-- model and has one blind spot: there was nowhere to see the people. You could
-- give somebody a tag from their member page, and that was it. No list of who
-- works for you, no way to see whether Saturday has anybody on the door, and no
-- way to find last month's bar crew without opening members one at a time.
--
-- Three read-only functions, no new tables. Everything here is derived from
-- event_staff, events and attendance, which already hold all of it.
--
-- Admin only, all of them. They return phone numbers and email addresses,
-- which staff themselves must never see (that boundary is the whole reason the
-- staff_* functions return limited columns).
--
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Everyone who works here
--
-- "Crew" means anyone who has ever been given a tag, plus every admin, because
-- an admin who has never worked a door is still someone you would look for in
-- this list. Ordered by who is on right now, then who is on next, then who
-- worked most recently — which is the order you actually want to read it in.
-- ----------------------------------------------------------------------------
create or replace function public.admin_crew(p_search text default '')
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  return (
    select coalesce(json_agg(row_to_json(c) order by
             c.on_shift_now desc,
             c.next_shift_at asc nulls last,
             c.last_shift_at desc nulls last,
             c.name), '[]'::json)
    from (
      select
        p.id as user_id,
        nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as name,
        p.email,
        p.phone,
        p.role::text,
        coalesce(m.is_active_member, false) as member_ok,
        s.tier,

        (select count(*)::int from public.event_staff es where es.user_id = p.id) as shifts_total,
        (select count(*)::int from public.event_staff es
          where es.user_id = p.id and es.staff_role = 'door') as door_shifts,
        (select count(*)::int from public.event_staff es
          where es.user_id = p.id and es.staff_role = 'bar') as bar_shifts,

        -- How many people they personally scanned in, ever. The one number that
        -- says who actually did the work rather than who was on the list.
        (select count(*)::int from public.attendance a where a.checked_in_by = p.id) as checkins_done,

        -- Working right now, by exactly the same window the staff page uses to
        -- decide whether to let them in.
        exists (
          select 1 from public.event_staff es
            join public.events e on e.id = es.event_id
           where es.user_id = p.id
             and now() >= e.starts_at - interval '4 hours'
             and now() <= coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '6 hours'
        ) as on_shift_now,

        (select e.starts_at from public.event_staff es
           join public.events e on e.id = es.event_id
          where es.user_id = p.id and e.starts_at < now()
          order by e.starts_at desc limit 1) as last_shift_at,
        (select e.name from public.event_staff es
           join public.events e on e.id = es.event_id
          where es.user_id = p.id and e.starts_at < now()
          order by e.starts_at desc limit 1) as last_shift_name,

        (select e.starts_at from public.event_staff es
           join public.events e on e.id = es.event_id
          where es.user_id = p.id and e.starts_at >= now()
          order by e.starts_at asc limit 1) as next_shift_at,
        (select e.name from public.event_staff es
           join public.events e on e.id = es.event_id
          where es.user_id = p.id and e.starts_at >= now()
          order by e.starts_at asc limit 1) as next_shift_name,
        (select es.staff_role::text from public.event_staff es
           join public.events e on e.id = es.event_id
          where es.user_id = p.id and e.starts_at >= now()
          order by e.starts_at asc limit 1) as next_shift_role

      from public.profiles p
      left join public.membership_status m on m.id = p.id
      left join public.member_stats s      on s.id = p.id
      where (p.role = 'admin'
             or exists (select 1 from public.event_staff es where es.user_id = p.id))
        and (coalesce(trim(p_search), '') = ''
             or (coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'') || ' ' || p.email)
                ilike '%' || trim(p_search) || '%')
    ) c);
end $$;

-- ----------------------------------------------------------------------------
-- 2. One person's whole working history
--
-- Every shift they have had, in order, with what they did on each night.
-- Separate from admin_user_detail because that one is about a member and this
-- one is about an employee, and mixing them makes both worse.
-- ----------------------------------------------------------------------------
create or replace function public.admin_crew_detail(p_user uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  return (select json_build_object(
    'profile', (select row_to_json(x) from (
        select p.id, p.email, p.phone, p.role,
               nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as name,
               p.ebas_status, p.created_at
        from public.profiles p where p.id = p_user) x),

    'shifts', coalesce((select json_agg(row_to_json(y) order by y.starts_at desc) from (
        select e.id as event_id, e.name, e.venue, e.starts_at, e.ends_at,
               es.staff_role::text, es.granted_at,
               -- What they did that night, not just that they were rostered.
               (select count(*)::int from public.attendance a
                 where a.event_id = e.id and a.checked_in_by = p_user) as checked_in,
               (e.starts_at >= now()) as upcoming,
               (now() >= e.starts_at - interval '4 hours'
                and now() <= coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '6 hours') as active_now
          from public.event_staff es
          join public.events e on e.id = es.event_id
         where es.user_id = p_user) y), '[]'::json),

    'totals', (select row_to_json(z) from (
        select (select count(*)::int from public.event_staff es where es.user_id = p_user) as shifts,
               (select count(*)::int from public.attendance a where a.checked_in_by = p_user) as checkins
      ) z)
  ));
end $$;

-- ----------------------------------------------------------------------------
-- 3. Cover for what is coming
--
-- The question this answers is "is Saturday staffed", which is the one you
-- want answered before Saturday. Past events are included at the end so you
-- can see who worked the last few nights without going hunting.
-- ----------------------------------------------------------------------------
create or replace function public.admin_crew_cover(p_past int default 3)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  return (select json_build_object(
    'upcoming', coalesce((select json_agg(row_to_json(u) order by u.starts_at asc) from (
        select e.id, e.name, e.venue, e.starts_at, e.announced,
               (select count(*)::int from public.event_staff es
                 where es.event_id = e.id and es.staff_role = 'door') as door,
               (select count(*)::int from public.event_staff es
                 where es.event_id = e.id and es.staff_role = 'bar') as bar,
               coalesce((select json_agg(json_build_object(
                          'user_id', es.user_id, 'role', es.staff_role::text,
                          'name', nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
                          'phone', p.phone)
                        order by es.staff_role, p.first_name)
                   from public.event_staff es join public.profiles p on p.id = es.user_id
                  where es.event_id = e.id), '[]'::json) as crew
          from public.events e
         where e.starts_at >= now()) u), '[]'::json),

    'recent', coalesce((select json_agg(row_to_json(r) order by r.starts_at desc) from (
        select e.id, e.name, e.venue, e.starts_at,
               (select count(*)::int from public.event_staff es where es.event_id = e.id) as crew_size,
               (select count(*)::int from public.attendance a where a.event_id = e.id) as checkins
          from public.events e
         where e.starts_at < now()
         order by e.starts_at desc
         limit greatest(coalesce(p_past, 3), 0)) r), '[]'::json)
  ));
end $$;

grant execute on function public.admin_crew(text)       to authenticated;
grant execute on function public.admin_crew_detail(uuid) to authenticated;
grant execute on function public.admin_crew_cover(int)   to authenticated;

-- ----------------------------------------------------------------------------
-- Applied to the live database on 6 August 2026. Nothing here writes, so
-- re-running it costs nothing and changes nothing.
--
-- One note on the security boundary, because it is the thing worth getting
-- wrong-proof: these three return phone numbers and email addresses, which is
-- exactly what staff must never be able to reach. That is why they are
-- admin-gated at the top and why the staff_* functions in phase 2b still
-- return name, membership and tier and nothing else. Do not be tempted to
-- reuse admin_crew to build a "who else is on tonight" view for staff — write
-- a separate function that returns first names, or nothing at all.
-- ----------------------------------------------------------------------------

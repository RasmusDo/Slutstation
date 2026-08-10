-- ============================================================================
-- PHASE 18 — A note on a person, visible at the door, and a way to report
--            something from it
--
-- 1. profile_notes. "Refused last time", "comp, approved by Axel", "owes the
--    bar". ONE note per member, written by an admin, shown to door staff in
--    the lookup. This is personal data about behaviour, so three rules are
--    built in rather than promised:
--      * it expires: a nightly job clears notes older than twelve months
--      * the member can read their own note (RLS below) — nothing is written
--        about a person that they cannot see
--      * staff see it only through staff_lookup, on shift, and it is NOT
--        included in the offline roster, so it never sits cached on a phone
--    The privacy policy paragraph shipped with this phase says all of this
--    in the open.
--
-- 2. incident_reports. One press at the door files a timestamped note —
--    refused entry, incident, capacity reached — straight into the admin
--    panel. It costs nothing and it is the beginning of the incident record
--    a serveringstillstånd application and any conversation with the police
--    will eventually want.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The note
-- ----------------------------------------------------------------------------
create table if not exists public.profile_notes (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  note       text not null,
  written_by uuid references public.profiles (id) on delete set null,
  written_at timestamptz not null default now()
);

alter table public.profile_notes enable row level security;

drop policy if exists profile_notes_admin on public.profile_notes;
create policy profile_notes_admin on public.profile_notes
  for all using (public.is_admin()) with check (public.is_admin());

-- The member can always read what is written about them. Deliberate: a note
-- system a person cannot inspect is the kind that goes wrong.
drop policy if exists profile_notes_own on public.profile_notes;
create policy profile_notes_own on public.profile_notes
  for select using (auth.uid() = user_id);

comment on table public.profile_notes is
  'One door note per member, admin-written, staff-read via staff_lookup on shift only, self-readable, cleared after 12 months.';

-- Retention: cleared nightly once a note passes twelve months. The time is
-- 04:13 for the same reason every job here runs off the hour — not colliding
-- with anything else on the minute marks people pick by habit.
select cron.unschedule('slutstation-note-retention')
 where exists (select 1 from cron.job where jobname = 'slutstation-note-retention');

select cron.schedule(
  'slutstation-note-retention',
  '13 4 * * *',
  $$delete from public.profile_notes where written_at < now() - interval '12 months'$$
);

-- ----------------------------------------------------------------------------
-- staff_lookup, now carrying the note. The return type changes, so the old
-- function is dropped first (create-or-replace cannot change a signature).
-- Same gate, same rows, one more column — and the note only travels on an
-- active shift, never into the offline roster.
-- ----------------------------------------------------------------------------
drop function if exists public.staff_lookup(text);

create function public.staff_lookup(p_query text)
returns table (user_id uuid, name text, member_ok boolean, tier int,
               tier_name text, checked_in boolean, note text)
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
                  where a.user_id = p.id and a.event_id = ev),
         (select n.note from public.profile_notes n
           where n.user_id = p.id
             and n.written_at > now() - interval '12 months')
  from public.profiles p
  left join public.membership_status m on m.id = p.id
  left join public.member_stats s      on s.id = p.id
  where (coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) ilike '%' || trim(p_query) || '%'
  order by p.first_name
  limit 25;
end $$;

grant execute on function public.staff_lookup(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Reports from the door
-- ----------------------------------------------------------------------------
create table if not exists public.incident_reports (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  -- Nullable on purpose: "on delete set null" must be able to fire when a
  -- staff account is deleted, and the report is still evidence without it.
  reported_by uuid default auth.uid() references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('refused_entry', 'incident', 'capacity', 'other')),
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists incident_reports_event_idx on public.incident_reports (event_id, created_at);

alter table public.incident_reports enable row level security;

-- Staff file reports only for the event they are working, as themselves.
drop policy if exists incident_reports_staff_insert on public.incident_reports;
create policy incident_reports_staff_insert on public.incident_reports
  for insert with check (
    reported_by = auth.uid()
    and (event_id = public.active_staff_event() or public.is_admin())
  );

drop policy if exists incident_reports_admin_read on public.incident_reports;
create policy incident_reports_admin_read on public.incident_reports
  for select using (public.is_admin());

comment on table public.incident_reports is
  'Timestamped reports from the door: refused entry, incident, capacity. Staff insert on shift; admins read.';

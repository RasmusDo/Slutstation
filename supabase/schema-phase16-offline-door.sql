-- ============================================================================
-- PHASE 16 — The offline door roster, narrowed to the people who can
--            actually come in tonight
--
-- Phase 9 item 4 (never applied, and superseded by this file) let a door
-- phone download THE WHOLE MEMBERSHIP: every name in the association, cached
-- in a browser on a volunteer's phone, so a lost phone became a lost list of
-- names. That trade is why it sat unapplied.
--
-- This version keeps the feature and shrinks the blast radius to the night:
--
--   1. Everyone holding a live own-sale ticket for the event on shift, plus
--      everyone already checked in tonight. For a night sold through our own
--      releases that IS the guest list, and nothing else leaves the server.
--   2. For a night sold through Billetto the database does not know the
--      attendee list before doors (attendance is imported from the Billetto
--      export afterwards), so there are no ticket rows to narrow to. The
--      roster then falls back to ACTIVE MEMBERS ONLY — membership is required
--      at the door anyway, so expired and never-verified accounts, which are
--      most of the register over time, never leave the server at all.
--
-- Everything else the unapplied draft promised still holds:
--   * No wider per person than staff_lookup already returns: name,
--     membership, tier, checked-in. No email, phone, address, birth date.
--   * Gated on holding the DOOR tag for an event that is on RIGHT NOW.
--   * The front end (staff.js) already calls staff_roster(), already scopes
--     the cache to the shift, and already throws it away when the shift ends.
--     Applying this file is the only step; no deploy needed.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create or replace function public.staff_roster()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  ev uuid;
  has_holders boolean;
begin
  ev := public.active_staff_event();
  if ev is null then raise exception 'Not on shift'; end if;
  if public.active_staff_role() is distinct from 'door' then
    raise exception 'Door staff only';
  end if;

  -- Own-sale tickets for tonight. 'valid' is a ticket not yet used; 'used'
  -- stays in so a re-scan after a crashed phone still finds the person.
  has_holders := exists (
    select 1 from public.tickets t
     where t.event_id = ev and t.status in ('valid', 'used'));

  return (select coalesce(json_agg(row_to_json(x) order by x.name), '[]'::json) from (
    select p.id as user_id,
           nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as name,
           coalesce(m.is_active_member, false) as member_ok,
           coalesce(s.tier, 1) as tier,
           exists (select 1 from public.attendance a
                    where a.user_id = p.id and a.event_id = ev) as checked_in
      from public.profiles p
      left join public.membership_status m on m.id = p.id
      left join public.member_stats s on s.id = p.id
     where nullif(trim(coalesce(p.first_name,'') || coalesce(p.last_name,'')), '') is not null
       and (
         -- tonight's ticket-holders
         exists (select 1 from public.tickets t
                  where t.user_id = p.id and t.event_id = ev
                    and t.status in ('valid', 'used'))
         -- anyone already inside
         or exists (select 1 from public.attendance a
                     where a.user_id = p.id and a.event_id = ev)
         -- Billetto night (no own tickets exist): active members only
         or (not has_holders and coalesce(m.is_active_member, false))
       )
  ) x);
end $$;

grant execute on function public.staff_roster() to authenticated;

comment on function public.staff_roster() is
  'Offline cache for the door: tonight''s own-sale ticket-holders + checked-in, falling back to active members only on a Billetto-sold night. Door tag on an active shift required.';

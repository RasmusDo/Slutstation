-- ============================================================================
-- APPLY-EVERYTHING — phases 15 through 20, in order, one paste.
--
-- Generated from the individual schema-phase files, which remain the
-- documented source of truth. Every phase is safe to re-run, so this whole
-- file is safe to re-run. Paste into the Supabase SQL editor and run once.
-- ============================================================================

-- ########################################################################
-- #### supabase/schema-phase15-admin-mfa.sql
-- ########################################################################
-- ============================================================================
-- PHASE 15 — Two-factor for admins, enforced where it matters
--
-- The admin panel is convenience, not security: every admin RPC checks
-- is_admin() on the server. Which means this ONE function is the entire
-- admin attack surface, and a stolen admin session (a phished password, a
-- laptop left open) currently walks straight through it.
--
-- After this phase, is_admin() also demands that the session has actually
-- passed a second factor (aal2) — but ONLY once that admin has a verified
-- TOTP factor enrolled. The order is what makes it safe to apply:
--
--   1. Apply this file. Nothing changes for anyone: no admin has a factor
--      yet, so the not-exists branch keeps password-only sessions working.
--   2. Each admin enrols from the panel (Overview -> Security card). From
--      their next session on, THEIR admin rights require the code.
--
-- An admin who loses their authenticator is rescued by the other admin
-- deleting the factor row (auth.mfa_factors) from the Supabase dashboard —
-- which is the same "two people can rescue each other" model the protected-
-- admins phase already relies on.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false)
     and (
       -- Not enrolled yet: password alone still works, so applying this file
       -- can never lock every admin out before anyone has set up a factor.
       not exists (
         select 1 from auth.mfa_factors
         where user_id = auth.uid() and status = 'verified'
       )
       -- Enrolled: the JWT must carry aal2, i.e. this session really did
       -- present the second factor, not just the password.
       or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     );
$$;

comment on function public.is_admin() is
  'admin role, and — once that admin has a verified MFA factor — an aal2 session. Every admin RPC funnels through this.';

-- ########################################################################
-- #### supabase/schema-phase16-offline-door.sql
-- ########################################################################
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

-- ########################################################################
-- #### supabase/schema-phase17-admin-costs-stats.sql
-- ########################################################################
-- ============================================================================
-- PHASE 17 — What the night cost, and a stats view of what the database
--            already knows
--
-- 1. event_costs. The panel knows what came in and nothing about what went
--    out; a non-profit has to show break-even per event to its board and
--    eventually to Skatteverket, and today that lives in a spreadsheet.
--    One row per line item, cost or income (a Billetto payout is entered as
--    income by hand — Billetto's money never touches this database). Plain
--    table with admin-only RLS; the panel writes it directly.
--
-- 2. admin_stats(). Signups per week and attendance per event. Every number
--    has been sitting in profiles/attendance since the beginning — this only
--    aggregates. Tier spread already lives on the Overview card, so it is
--    deliberately not repeated here.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What the night cost
-- ----------------------------------------------------------------------------
create table if not exists public.event_costs (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  kind       text not null default 'cost' check (kind in ('cost', 'income')),
  label      text not null,
  amount_ore bigint not null check (amount_ore > 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists event_costs_event_idx on public.event_costs (event_id);

alter table public.event_costs enable row level security;

drop policy if exists event_costs_admin on public.event_costs;
create policy event_costs_admin on public.event_costs
  for all using (public.is_admin()) with check (public.is_admin());

comment on table public.event_costs is
  'Line items per event, cost or income, entered in the admin panel. Billetto payouts are entered as income by hand.';

-- ----------------------------------------------------------------------------
-- 2. Stats
-- ----------------------------------------------------------------------------
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  return json_build_object(
    'signups_by_week', coalesce((
      select json_agg(row_to_json(w) order by w.wk)
        from (select to_char(date_trunc('week', p.created_at), 'YYYY-MM-DD') as wk,
                     count(*)::int as n
                from public.profiles p
               where p.created_at >= date_trunc('week', now()) - interval '11 weeks'
               group by 1) w), '[]'::json),
    'attendance_by_event', coalesce((
      select json_agg(row_to_json(e) order by e.starts_at)
        from (select e.name, e.starts_at, e.capacity,
                     (select count(*)::int from public.attendance a
                       where a.event_id = e.id) as n
                from public.events e
               where e.starts_at < now()
               order by e.starts_at desc
               limit 10) e), '[]'::json)
  );
end $$;

grant execute on function public.admin_stats() to authenticated;

-- ########################################################################
-- #### supabase/schema-phase18-door-notes-incidents.sql
-- ########################################################################
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

-- ########################################################################
-- #### supabase/schema-phase19-tier-distribution.sql
-- ########################################################################
-- ============================================================================
-- PHASE 19 — "Top 9% of members": the tier distribution, counts only
--
-- The account page's tier card can say where a rank sits among the whole
-- membership. That needs exactly one thing the browser cannot currently ask
-- for: how many members hold each tier. COUNTS ONLY — no names, no emails,
-- no way to work out who attends what. A leaderboard is deliberately not
-- built and should stay that way; this is the whole of what leaves.
--
-- SECURITY DEFINER on purpose: member_stats is a security_invoker view, so a
-- plain member querying it sees one row (their own). Run as the function
-- owner it sees them all, aggregates, and returns four integers.
--
-- The front end hides the line entirely below 25 total members — a
-- percentage over a handful of people flatters nobody.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create or replace function public.tier_distribution()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg('tier_' || t.tier, t.n), '{}'::json)
    from (select s.tier, count(*)::int as n
            from public.member_stats s
           group by s.tier) t;
$$;

grant execute on function public.tier_distribution() to authenticated;

comment on function public.tier_distribution() is
  'How many members hold each tier, and nothing else. Feeds the "top N%" line on the account page.';

-- ########################################################################
-- #### supabase/schema-phase20-wallet.sql
-- ########################################################################
-- ============================================================================
-- PHASE 20 — Apple Wallet: who holds the card, and when to tell their phone
--
-- The pass itself is built and signed by the `wallet` Edge Function. The
-- database's whole job is two small tables and a flag:
--
--   wallet_passes          one row per member who has ever downloaded the
--                          card. Holds the per-pass authentication token
--                          Apple echoes back (never a session token), and
--                          needs_push, which is how the rest of the system
--                          says "this card is stale".
--   wallet_registrations   which physical devices hold which pass, written
--                          by Apple's own registration callback.
--
-- Live updates ride the machinery that already exists: the same
-- member_events rows that power the timeline and the tier card flip
-- needs_push, and a pg_cron tick tells the wallet function to notify the
-- registered devices. The phone then fetches a fresh pass — tier, progress,
-- perks — through the PassKit web service half of the same function.
--
-- Both tables are service-role only: RLS is enabled and no policy is
-- created, so no browser token can read a push token or an auth token.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create table if not exists public.wallet_passes (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  auth_token  text not null,
  needs_push  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.wallet_registrations (
  device_library_id text not null,
  user_id           uuid not null references public.wallet_passes (user_id) on delete cascade,
  push_token        text not null,
  created_at        timestamptz not null default now(),
  primary key (device_library_id, user_id)
);

create index if not exists wallet_registrations_user_idx
  on public.wallet_registrations (user_id);

alter table public.wallet_passes        enable row level security;
alter table public.wallet_registrations enable row level security;
-- No policies on purpose: service role only.

-- ----------------------------------------------------------------------------
-- Staleness. Anything that changes what the card shows flips the flag:
--   * member_events — attendance recorded, tier reached (the same append-only
--     log everything else trusts)
--   * perk_claims — the wardrobe or the drink handed over at the bar, so the
--     card can say "used 23:41" before they're back at the table
-- ----------------------------------------------------------------------------
create or replace function public.wallet_flag_stale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.wallet_passes
     set needs_push = true, updated_at = now()
   where user_id = new.user_id;
  return new;
end $$;

drop trigger if exists wallet_stale_on_member_event on public.member_events;
create trigger wallet_stale_on_member_event
  after insert on public.member_events
  for each row execute function public.wallet_flag_stale();

drop trigger if exists wallet_stale_on_perk_claim on public.perk_claims;
create trigger wallet_stale_on_perk_claim
  after insert on public.perk_claims
  for each row execute function public.wallet_flag_stale();

-- ----------------------------------------------------------------------------
-- The tick. Every five minutes, tell the wallet function to notify devices
-- whose pass is flagged. Between events this select matches nothing and the
-- HTTP call is skipped entirely — the guard is in the WHERE, not in the
-- function, so a quiet month costs zero invocations.
-- ----------------------------------------------------------------------------
select cron.unschedule('slutstation-wallet-push')
 where exists (select 1 from cron.job where jobname = 'slutstation-wallet-push');

select cron.schedule(
  'slutstation-wallet-push',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url     := 'https://uwawugvatencvzvvfaeq.supabase.co/functions/v1/wallet/push',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'slutstation_cron_secret')
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
    where exists (select 1 from public.wallet_passes where needs_push);
  $job$
);

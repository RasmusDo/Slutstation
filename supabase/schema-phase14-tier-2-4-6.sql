-- ============================================================================
-- SLUTSTATION, phase 14 — thresholds become 2 / 4 / 6, and the history is
-- rebuilt so it stops claiming people were promoted on their first night
--
-- SUPERSEDES phase 12 (2/4/5), which superseded phase 2 (2/4/8). Rebuilding
-- from scratch runs all three in order and this one wins. Do not edit the
-- earlier files to match: each of them is a record of what was true when it
-- was written.
--
-- PART ONE — THE NUMBERS
--
-- Six nights instead of five for Tier 4. Measured across the six Billetto
-- exports, 1564 people:
--
--     1 night  1432      4 nights   9
--     2 nights   99      5 nights   3
--     3 nights   21      6 nights   0
--
-- so Tier 4 has nobody in it today and Tier 3 gains the three who were in it.
-- That is the deliberate consequence: Tier 4 becomes something that has to be
-- earned at an upcoming event rather than something a handful of people were
-- given for a history they had already finished. The three Tier 4 codes sit in
-- the pool until someone gets there, which is what the pool is for.
--
-- PART TWO — THE HISTORY WAS DATED WRONG, AND THAT WAS MY FAULT
--
-- The trigger in phase 6 writes a tier_up row stamped with the checked_in_at
-- of the attendance row that caused it. That is correct when nights arrive in
-- the order they happened. The legacy import did not: the six events were
-- imported in the order they appeared in the export folder, so for a member
-- who came to a 2026 night and a 2024 night, the second INSERT was the earlier
-- night, and the promotion got dated to it. Three members were shown "reached
-- Tier 2" against the first night they ever came to, which reads as being
-- rewarded for turning up once.
--
-- Re-dating alone would not be enough, because the rows were also computed
-- against 2/4/5 and are about to be wrong for a second reason. So they are
-- rebuilt from the attendance itself.
--
-- HOW THE REBUILD DECIDES A DATE
--
-- For every night a member came to, in order, count how many nights they had
-- inside the rolling window as of that night, and ask tier_for what that was
-- worth. The first night that produces each tier is the night they reached it.
-- This models the window honestly: a member with two nights three years apart
-- never held Tier 2 at any single moment, and does not get a row saying they
-- did.
--
-- AND THE TRIGGER IS FIXED SO THIS CANNOT HAPPEN AGAIN
--
-- log_attendance_event now recomputes that one member's promotions instead of
-- assuming the row it was handed is the latest one. Importing an old event
-- next year will date the promotions correctly on its own. This costs one
-- small delete and insert per attendance row, against a handful of rows per
-- member — cheaper than being wrong.
--
-- ONE DELIBERATE CHANGE OF MIND: removing an attendance row now also removes
-- any promotion that depended on it. Phase 6 kept the promotion on the grounds
-- that it happened. But attendance is only ever removed because it was wrong,
-- and a promotion caused by a night that did not happen is a lie with a date
-- on it.
--
-- Safe to re-run. Rerunning rebuilds the history to the same answer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The thresholds
-- ----------------------------------------------------------------------------
create or replace function public.tier_for(p_events integer)
returns integer language sql immutable as $$
  select case
    when p_events >= 6 then 4
    when p_events >= 4 then 3
    when p_events >= 2 then 2
    else 1
  end;
$$;

-- The inverse, and it must stay the inverse: the account page draws "TIER 3 AT
-- 4" and the progress bar from this, so if the two disagree a member is told
-- they need a number of nights that would not actually promote them.
create or replace function public.tier_threshold(p_tier integer)
returns integer language sql immutable as $$
  select case p_tier when 2 then 2 when 3 then 4 when 4 then 6 else 0 end;
$$;

-- A guard rather than a comment. If someone edits one of the two functions and
-- forgets the other, this fails loudly at apply time instead of quietly telling
-- members the wrong target for months. Checks both directions now: that the
-- threshold is enough to reach the tier, and that nothing below it already does.
do $$
declare n int;
begin
  for n in 0..14 loop
    if public.tier_for(n) > 1
       and n < public.tier_threshold(public.tier_for(n)) then
      raise exception 'tier_for(%) says tier % but tier_threshold(%) says you need % — the two are out of step',
        n, public.tier_for(n), public.tier_for(n), public.tier_threshold(public.tier_for(n));
    end if;
  end loop;
  for n in 2..4 loop
    if public.tier_for(public.tier_threshold(n)) <> n then
      raise exception 'tier_threshold(%) is % nights, but % nights is tier % — the two are out of step',
        n, public.tier_threshold(n), public.tier_threshold(n), public.tier_for(public.tier_threshold(n));
    end if;
    if public.tier_for(public.tier_threshold(n) - 1) >= n then
      raise exception 'tier_threshold(%) is % nights, but % nights already reaches tier % — the threshold is too high',
        n, public.tier_threshold(n), public.tier_threshold(n) - 1, public.tier_for(public.tier_threshold(n) - 1);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Rebuilding one member's promotions from their attendance
--
-- p_user null means everybody. Returns how many tier_up rows now exist for the
-- members it touched, so an admin running it by hand gets an answer rather than
-- silence.
-- ----------------------------------------------------------------------------
create or replace function public.rebuild_tier_history(p_user uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  win interval := (public.setting('tier_window_months','24') || ' months')::interval;
  n   int := 0;
begin
  delete from public.member_events
   where kind = 'tier_up'
     and (p_user is null or user_id = p_user);

  with nights as (
    select a.user_id, a.event_id, a.checked_in_at,
           -- How many nights this member had inside the window AS OF this
           -- night. Not a running total: nights that had already aged out do
           -- not count towards a promotion that happened later.
           (select count(*)::int from public.attendance b
             where b.user_id = a.user_id
               and b.checked_in_at <= a.checked_in_at
               and b.checked_in_at >  a.checked_in_at - win) as in_window
      from public.attendance a
     where p_user is null or a.user_id = p_user
  ), tiered as (
    select user_id, event_id, checked_in_at, public.tier_for(in_window) as tier
      from nights
  ), firsts as (
    -- The earliest night at which each tier was true for them.
    select distinct on (user_id, tier) user_id, tier, event_id, checked_in_at
      from tiered
     where tier > 1
     order by user_id, tier, checked_in_at
  ), ins as (
    insert into public.member_events (user_id, kind, event_id, tier, occurred_at)
    select user_id, 'tier_up', event_id, tier, checked_in_at from firsts
    on conflict do nothing
    returning 1
  )
  select (select count(*)::int from ins) into n;

  return n;
end $$;

revoke execute on function public.rebuild_tier_history(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. The trigger, corrected
--
-- The 'attended' row is still written straight from the inserted row — that
-- one is simply a fact about a night. Only the promotion needs recomputing,
-- because a promotion is a statement about a sequence and the sequence is not
-- necessarily the insert order.
-- ----------------------------------------------------------------------------
create or replace function public.log_attendance_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.member_events (user_id, kind, event_id, occurred_at, meta)
  values (new.user_id, 'attended', new.event_id, new.checked_in_at,
          jsonb_build_object('source', new.source));

  perform public.rebuild_tier_history(new.user_id);
  return new;
end $$;

-- Removing a night removes the promotion it caused. See the header.
create or replace function public.unlog_attendance_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.member_events
   where user_id = old.user_id and event_id = old.event_id and kind = 'attended';
  perform public.rebuild_tier_history(old.user_id);
  return old;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Do it, for everyone who already has attendance
-- ----------------------------------------------------------------------------
do $$
declare n int;
begin
  n := public.rebuild_tier_history(null);
  raise notice 'tier history rebuilt: % promotions', n;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Prove it
--
-- Nobody may hold a promotion dated to the first night they ever came to. If
-- this raises, the rebuild is wrong and the file has not been applied — which
-- is the correct outcome, because the alternative is members reading a history
-- that flatters them for turning up once.
-- ----------------------------------------------------------------------------
do $$
declare bad int;
begin
  select count(*)::int into bad
    from public.member_events me
    join (select user_id, min(checked_in_at) as first_night
            from public.attendance group by user_id) f
      on f.user_id = me.user_id
   where me.kind = 'tier_up'
     and me.occurred_at <= f.first_night;

  if bad > 0 then
    raise exception '% tier_up rows are still dated to a member''s first night', bad;
  end if;
end $$;

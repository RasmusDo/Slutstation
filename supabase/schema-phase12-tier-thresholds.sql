-- ============================================================================
-- SLUTSTATION, phase 12 — the tier thresholds move to 2 / 4 / 5
--
-- SUPERSEDED BY schema-phase14-tier-2-4-6.sql, which moves Tier 4 to six
-- nights. This file is left exactly as it was applied; read phase 14 for the
-- reasoning and for the numbers that are actually live.
--
-- SUPERSEDES the definitions in schema-phase2.sql, which were 2 / 4 / 8. If you
-- ever rebuild from scratch, phase 2 runs first and this corrects it; do not
-- edit phase 2 to match, or the two files stop telling the truth about when the
-- change happened.
--
-- WHY
--
-- Tier 4 at eight nights was unreachable. Six events have happened, so eight
-- nights was arithmetically impossible, and even six would have been "attended
-- literally everything". Measured across all six Billetto exports, 1564 people:
--
--     1 night  1432      4 nights   9
--     2 nights   99      5 nights   3
--     3 nights   21      6 nights   0
--
-- which at 2/4/5 gives 1432 / 120 / 9 / 3 across the four tiers. Tier 4 becomes
-- a real thing that three people have actually earned, rather than a promise
-- with nobody in it. Tier 3 at nine also happens to match the nine 20% codes
-- that exist.
--
-- THE WINDOW STAYS AT 24 MONTHS. Axel's call, and the reasoning is sound: the
-- events are about to get more frequent, so a shorter window stops being a
-- punishment and starts being what keeps the ladder meaningful. Revisit it only
-- if the cadence drops back.
--
-- ONE THING TO KNOW ABOUT HISTORY
--
-- member_events rows of kind 'tier_up' were written against the OLD thresholds
-- by the trigger in phase 6. They are a log of what was announced at the time,
-- not a derived value, so they are deliberately left alone. There are currently
-- no attendance rows in the database at all, so in practice nothing is stale —
-- but after the legacy import, a member's history and their current tier are
-- answering two different questions and should not be expected to agree.
--
-- Safe to re-run.
-- ============================================================================

create or replace function public.tier_for(p_events integer)
returns integer language sql immutable as $$
  select case
    when p_events >= 5 then 4
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
  select case p_tier when 2 then 2 when 3 then 4 when 4 then 5 else 0 end;
$$;

-- A guard rather than a comment. If someone edits one of the two functions and
-- forgets the other, this fails loudly at apply time instead of quietly telling
-- members the wrong target for months.
do $$
declare n int;
begin
  for n in 0..12 loop
    if public.tier_for(n) > 1
       and n < public.tier_threshold(public.tier_for(n)) then
      raise exception 'tier_for(%) says tier % but tier_threshold(%) says you need % — the two are out of step',
        n, public.tier_for(n), public.tier_for(n), public.tier_threshold(public.tier_for(n));
    end if;
  end loop;
end $$;

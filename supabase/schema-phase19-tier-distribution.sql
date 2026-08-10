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

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

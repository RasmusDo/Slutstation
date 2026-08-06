-- ============================================================================
-- SLUTSTATION — Phase 3b: terms versioning + the ticket float
-- Run AFTER schema-phase3-tickets.sql.
--
-- TWO THINGS, BOTH LEARNED FROM SWEDISH LAW AND FROM WHAT TICKET PLATFORMS DO.
--
-- 1. TERMS VERSIONING.
--    Bokföringslagen 7 kap 2 § makes "handlingar som klargör villkoren för
--    affärshändelserna" part of the accounting record you must keep for seven
--    years. In a dispute at ARN the question is never "what do your terms say
--    now" — it is "what did they say the day this person bought". So every
--    order records which version of the terms it was sold under. A trigger does
--    it, not the browser, so it cannot be faked or forgotten.
--
-- 2. THE TICKET FLOAT.
--    Money taken for an event that has not happened yet is not yours. If you
--    cancel, every krona goes back — Swedish law gives no force-majeure escape
--    from that. Every ticket platform enforces this by simply not paying the
--    organiser until after the doors: Eventbrite holds 20% and pays three days
--    after the event; Billetto pays 3-5 working days after; Skiddle says it
--    outright. Selling direct hands you that money up to a year early, which
--    feels like a benefit and is actually the trap that has killed promoters.
--    So the admin panel separates "collected, not yet earned" from "earned".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Which terms was this order sold under
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists terms_version text;

insert into public.app_settings (key, value, note) values
  ('terms_version', '2026-08-04',
   'Bump this date whenever the Köpvillkor change. Stamped onto every new order so a dispute can be answered with the terms as they stood that day.')
on conflict (key) do nothing;

create or replace function public.stamp_terms_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.terms_version is null then
    new.terms_version := public.setting('terms_version', 'unversioned');
  end if;
  return new;
end $$;

drop trigger if exists orders_stamp_terms on public.orders;
create trigger orders_stamp_terms
  before insert on public.orders
  for each row execute function public.stamp_terms_version();

-- ----------------------------------------------------------------------------
-- 2. The float
--
-- unearned = paid orders for events that have not happened. This is refundable
--            in full, on demand, with no legal defence available to us.
-- earned   = paid orders for events that have taken place. Still disputable
--            through the card networks for months, but it is money we have
--            actually delivered against.
-- ----------------------------------------------------------------------------
create or replace function public.admin_ticket_float()
returns json language plpgsql security definer set search_path = public as $$
declare res json;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  select json_build_object(
    'unearned_ore', coalesce(sum(o.total_ore) filter (where e.starts_at > now()), 0),
    'earned_ore',   coalesce(sum(o.total_ore) filter (where e.starts_at <= now()), 0),
    'refunded_ore', (select coalesce(sum(total_ore), 0) from public.orders where status = 'refunded'),
    'unearned_tickets', (
      select count(*) from public.tickets t
      join public.events e2 on e2.id = t.event_id
      where t.status = 'valid' and e2.starts_at > now()),
    'by_event', (
      select coalesce(json_agg(x order by x->>'starts_at'), '[]'::json) from (
        select json_build_object(
          'event_id', e3.id,
          'name', e3.name,
          'starts_at', e3.starts_at,
          'days_away', greatest(ceil(extract(epoch from (e3.starts_at - now())) / 86400)::int, 0),
          'held_ore', coalesce(sum(o3.total_ore), 0),
          'orders', count(o3.id)
        ) as x
        from public.events e3
        join public.orders o3 on o3.event_id = e3.id and o3.status = 'paid'
        where e3.starts_at > now()
        group by e3.id, e3.name, e3.starts_at
      ) s)
  ) into res
  from public.orders o
  join public.events e on e.id = o.event_id
  where o.status = 'paid';

  return res;
end $$;

comment on function public.admin_ticket_float() is
  'Splits ticket money into not-yet-earned (fully refundable on demand) and earned. The unearned figure is what a cancellation would cost you in cash.';

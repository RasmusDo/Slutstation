-- ============================================================================
-- SLUTSTATION — Phase 3: selling tickets ourselves (Stripe)
-- Run AFTER schema.sql, schema-phase2.sql, schema-phase2b, schema-phase2c.
--
-- WHAT THIS BUILDS
--   ticket_types   the four releases + the backstage add-on, per event
--   orders         one row per checkout attempt, pending until Stripe says paid
--   order_items    what was in that order, with the price frozen at purchase
--   tickets        the thing a person actually holds; one row per admission
--
-- HOW A RELEASE ADVANCES — all three at once, so you are never boxed in:
--   * quantity  — when a release sells its allocation it closes itself and the
--                 next one by release_order opens automatically
--   * dates     — sales_start / sales_end, if you set them
--   * by hand   — an admin can open, pause or close any release at any time
--   A release is buyable only when it is 'on_sale', inside its dates, and has
--   stock left. Leave dates null and it is purely quantity + manual.
--
-- WHY IT CANNOT OVERSELL
--   create_ticket_order takes a row lock (select … for update) on each
--   ticket_type before it touches the counters. Two people clicking Buy on the
--   last ticket at the same moment queue up behind that lock, so the second one
--   sees the first one's reservation and is told there is one left, not two.
--   Held stock lives in `reserved` and is released after 30 minutes if the
--   person never pays.
--
-- MONEY IS ALWAYS AN INTEGER NUMBER OF ÖRE. Never a float. 250 kr = 25000.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Types
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.ticket_kind as enum ('entry','addon');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_type_status as enum ('draft','on_sale','paused','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('pending','paid','expired','cancelled','refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_status as enum ('valid','used','refunded','void');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Ticket types — the releases
--
-- Two extra columns on events first, so the front page can draw a real card
-- for whatever is on sale instead of a hand-edited one.
-- ----------------------------------------------------------------------------
alter table public.events add column if not exists image_url   text;
alter table public.events add column if not exists description text;

create table if not exists public.ticket_types (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  name           text not null,
  description    text,
  kind           public.ticket_kind not null default 'entry',
  release_order  integer not null default 1,      -- 1..4 for the four releases
  price_ore      integer not null check (price_ore >= 0),
  quantity       integer check (quantity is null or quantity > 0), -- null = unlimited
  reserved       integer not null default 0 check (reserved >= 0), -- held mid-checkout
  sold           integer not null default 0 check (sold >= 0),
  status         public.ticket_type_status not null default 'draft',
  sales_start    timestamptz,
  sales_end      timestamptz,
  max_per_order  integer not null default 4 check (max_per_order between 1 and 20),
  created_at     timestamptz not null default now(),
  unique (event_id, name)
);

create index if not exists ticket_types_event_idx on public.ticket_types (event_id, release_order);

comment on column public.ticket_types.reserved is
  'Tickets held by a pending order. Released automatically after 30 minutes.';

-- ----------------------------------------------------------------------------
-- 3. Orders and what was in them
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  event_id              uuid not null references public.events (id)   on delete cascade,
  status                public.order_status not null default 'pending',
  total_ore             bigint not null default 0,
  currency              text not null default 'sek',
  stripe_session_id     text unique,
  stripe_payment_intent text,
  reserved_until        timestamptz,
  flagged               text,          -- set when something needed a human look
  created_at            timestamptz not null default now(),
  paid_at               timestamptz,
  refunded_at           timestamptz
);

create index if not exists orders_user_idx  on public.orders (user_id, created_at desc);
create index if not exists orders_event_idx on public.orders (event_id);
create index if not exists orders_pending_idx on public.orders (reserved_until)
  where status = 'pending';

create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types (id) on delete restrict,
  name_snapshot  text not null,        -- what it was called on the day
  qty            integer not null check (qty > 0),
  unit_price_ore integer not null check (unit_price_ore >= 0)
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ----------------------------------------------------------------------------
-- 4. Tickets
-- ----------------------------------------------------------------------------
create table if not exists public.tickets (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  order_id       uuid not null references public.orders (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  event_id       uuid not null references public.events (id)  on delete cascade,
  ticket_type_id uuid not null references public.ticket_types (id) on delete restrict,
  status         public.ticket_status not null default 'valid',
  issued_at      timestamptz not null default now(),
  used_at        timestamptz,
  used_by        uuid references public.profiles (id)
);

create index if not exists tickets_user_idx  on public.tickets (user_id);
create index if not exists tickets_event_idx on public.tickets (event_id, status);

-- Short, unambiguous, readable over a loud PA: no 0/O/1/I.
-- The variable is v_code, not code: a plpgsql variable named `code` is
-- ambiguous against tickets.code inside the uniqueness check, and Postgres
-- raises 42702 rather than guessing. Caught by the end-to-end test.
create or replace function public.gen_ticket_code()
returns text language plpgsql as $$
declare
  alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text;
  i int;
begin
  loop
    v_code := 'SS-';
    for i in 1..8 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      if i = 4 then v_code := v_code || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.tickets t where t.code = v_code);
  end loop;
  return v_code;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Availability
-- ----------------------------------------------------------------------------
create or replace function public.tt_available(p_quantity int, p_sold int, p_reserved int)
returns int language sql immutable as $$
  select case when p_quantity is null then 2147483647
              else greatest(p_quantity - p_sold - p_reserved, 0) end;
$$;

create or replace function public.tt_is_open(
  p_status public.ticket_type_status, p_start timestamptz, p_end timestamptz,
  p_quantity int, p_sold int, p_reserved int)
returns boolean language sql stable as $$
  select p_status = 'on_sale'
     and (p_start is null or now() >= p_start)
     and (p_end   is null or now() <= p_end)
     and public.tt_available(p_quantity, p_sold, p_reserved) > 0;
$$;

-- ----------------------------------------------------------------------------
-- 6. Housekeeping: give back stock nobody paid for
-- ----------------------------------------------------------------------------
create or replace function public.expire_stale_orders(p_event uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; o record;
begin
  for o in
    select id from public.orders
     where status = 'pending'
       and reserved_until is not null
       and reserved_until < now()
       and (p_event is null or event_id = p_event)
     for update skip locked
  loop
    update public.ticket_types t
       set reserved = greatest(t.reserved - i.qty, 0)
      from public.order_items i
     where i.order_id = o.id and t.id = i.ticket_type_id;
    update public.orders set status = 'expired' where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- When a release runs out, close it and open the next one. This is what makes
-- "Blind → Standard → Second → Third" happen on its own at 3am with nobody
-- watching. Add-ons are left alone; they are not part of the ladder.
create or replace function public.advance_releases(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nxt uuid;
begin
  update public.ticket_types
     set status = 'closed'
   where event_id = p_event and kind = 'entry' and status = 'on_sale'
     and quantity is not null and public.tt_available(quantity, sold, reserved) = 0;

  if exists (select 1 from public.ticket_types
              where event_id = p_event and kind = 'entry'
                and public.tt_is_open(status, sales_start, sales_end, quantity, sold, reserved))
  then
    return;   -- something is still buyable; nothing to advance
  end if;

  select id into nxt from public.ticket_types
   where event_id = p_event and kind = 'entry'
     and status in ('draft','paused')
     and public.tt_available(quantity, sold, reserved) > 0
     and (sales_end is null or now() <= sales_end)
   order by release_order, price_ore
   limit 1;

  if nxt is not null then
    update public.ticket_types set status = 'on_sale' where id = nxt;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 7. Buying: reserve stock and hand back something Stripe can be pointed at
--
-- p_items is [{"ticket_type_id":"…","qty":2}, …]
-- Nothing here talks to Stripe. It only decides whether the sale is allowed and
-- freezes the price. The Edge Function turns the result into a Checkout Session.
-- ----------------------------------------------------------------------------
create or replace function public.create_ticket_order(p_event uuid, p_items jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev  public.events%rowtype;
  it  record;
  tt  public.ticket_types%rowtype;
  new_order uuid;
  total bigint := 0;
  entry_qty int := 0;
  addon_qty int := 0;
  held int;
  avail int;
  lines json;
begin
  if uid is null then
    raise exception 'Sign in to buy tickets';
  end if;

  if public.setting('tickets_require_active_membership','false') = 'true'
     and not coalesce((select is_active_member from public.membership_status where id = uid), false)
  then
    raise exception 'Your membership needs to be active before you can buy tickets';
  end if;

  perform public.expire_stale_orders(p_event);

  select * into ev from public.events where id = p_event;
  if not found or not ev.is_published then
    raise exception 'That event is not on sale';
  end if;
  if ev.starts_at < now() - interval '12 hours' then
    raise exception 'That event has already happened';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pick at least one ticket';
  end if;

  insert into public.orders (user_id, event_id, reserved_until)
  -- 35 minutes, deliberately longer than the 31-minute Stripe session expiry:
  -- the checkout window must close before the stock is handed back, never after.
  values (uid, p_event, now() + interval '35 minutes')
  returning id into new_order;

  for it in
    select (x->>'ticket_type_id')::uuid as tid, (x->>'qty')::int as qty
      from jsonb_array_elements(p_items) x
  loop
    if it.qty is null or it.qty < 1 then
      raise exception 'Invalid quantity';
    end if;

    -- The lock that makes overselling impossible. Everything below runs with
    -- this row held until the transaction ends.
    select * into tt from public.ticket_types
     where id = it.tid and event_id = p_event
     for update;

    if not found then
      raise exception 'Unknown ticket';
    end if;
    if not public.tt_is_open(tt.status, tt.sales_start, tt.sales_end, tt.quantity, tt.sold, tt.reserved) then
      raise exception '% is not on sale right now', tt.name;
    end if;
    if it.qty > tt.max_per_order then
      raise exception 'Max %  per order for %', tt.max_per_order, tt.name;
    end if;

    -- per-person cap across separate orders, not just within one
    select coalesce(sum(oi.qty), 0) into held
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.ticket_type_id = tt.id
       and o.user_id = uid
       and o.id <> new_order
       and (o.status = 'paid' or (o.status = 'pending' and o.reserved_until > now()));
    if held + it.qty > tt.max_per_order then
      raise exception 'You already have % of %  — the limit is % per person',
        held, tt.name, tt.max_per_order;
    end if;

    avail := public.tt_available(tt.quantity, tt.sold, tt.reserved);
    if it.qty > avail then
      raise exception 'Only % left of %', avail, tt.name;
    end if;

    update public.ticket_types
       set reserved = reserved + it.qty
     where id = tt.id;

    insert into public.order_items (order_id, ticket_type_id, name_snapshot, qty, unit_price_ore)
    values (new_order, tt.id, tt.name, it.qty, tt.price_ore);

    total := total + (tt.price_ore::bigint * it.qty);
    if tt.kind = 'entry' then entry_qty := entry_qty + it.qty;
                         else addon_qty := addon_qty + it.qty; end if;
  end loop;

  -- An add-on is an add-on. You cannot buy backstage without being inside.
  if addon_qty > 0 and entry_qty = 0
     and not exists (select 1 from public.tickets
                      where user_id = uid and event_id = p_event and status = 'valid'
                        and ticket_type_id in (select id from public.ticket_types
                                                where event_id = p_event and kind = 'entry'))
  then
    raise exception 'Add-ons need an entry ticket — add one to your order';
  end if;

  update public.orders set total_ore = total where id = new_order;

  select json_agg(json_build_object(
           'name', name_snapshot, 'qty', qty, 'unit_price_ore', unit_price_ore))
    into lines
    from public.order_items where order_id = new_order;

  return json_build_object(
    'order_id', new_order,
    'total_ore', total,
    'currency', 'sek',
    'event_name', ev.name,
    'items', coalesce(lines, '[]'::json)
  );
end $$;

-- ----------------------------------------------------------------------------
-- 8. Fulfilment — called by the Stripe webhook only, never by a browser
--
-- Idempotent on purpose: Stripe retries webhooks, and will happily send the
-- same event twice. Calling this five times issues one set of tickets.
-- ----------------------------------------------------------------------------
create or replace function public.finalize_ticket_order(
  p_order uuid, p_session text, p_payment_intent text, p_amount_ore bigint default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  i record;
  k int;
  was_pending boolean;
  issued int := 0;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Unknown order %', p_order; end if;

  if o.status = 'paid' then
    return json_build_object('order_id', o.id, 'status', 'paid', 'already', true,
                             'tickets', (select count(*) from public.tickets where order_id = o.id));
  end if;
  if o.status = 'refunded' then
    return json_build_object('order_id', o.id, 'status', 'refunded', 'already', true);
  end if;

  was_pending := (o.status = 'pending');

  for i in select * from public.order_items where order_id = o.id loop
    -- Move the count from held to sold. If the hold had already lapsed we sell
    -- anyway — the money is taken, refusing the ticket now would be worse — but
    -- we flag the order so an admin sees it.
    update public.ticket_types
       set sold     = sold + i.qty,
           reserved = case when was_pending then greatest(reserved - i.qty, 0) else reserved end
     where id = i.ticket_type_id;

    if not was_pending then
      update public.orders set flagged = 'Hold had expired when payment landed — check capacity'
       where id = o.id;
    end if;

    for k in 1..i.qty loop
      insert into public.tickets (code, order_id, user_id, event_id, ticket_type_id)
      values (public.gen_ticket_code(), o.id, o.user_id, o.event_id, i.ticket_type_id);
      issued := issued + 1;
    end loop;
  end loop;

  update public.orders
     set status = 'paid',
         paid_at = now(),
         stripe_session_id = coalesce(p_session, stripe_session_id),
         stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent),
         total_ore = coalesce(p_amount_ore, total_ore),
         reserved_until = null
   where id = o.id;

  perform public.advance_releases(o.event_id);

  return json_build_object('order_id', o.id, 'status', 'paid', 'already', false, 'tickets', issued);
end $$;

create or replace function public.cancel_ticket_order(p_order uuid, p_reason text default 'expired')
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.status <> 'pending' then return; end if;

  update public.ticket_types t
     set reserved = greatest(t.reserved - i.qty, 0)
    from public.order_items i
   where i.order_id = o.id and t.id = i.ticket_type_id;

  update public.orders
     set status = case when p_reason = 'cancelled' then 'cancelled'::public.order_status
                       else 'expired'::public.order_status end
   where id = o.id;
end $$;

create or replace function public.refund_ticket_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.status <> 'paid' then return; end if;

  update public.ticket_types t
     set sold = greatest(t.sold - i.qty, 0)
    from public.order_items i
   where i.order_id = o.id and t.id = i.ticket_type_id;

  update public.tickets set status = 'refunded'
   where order_id = o.id and status in ('valid','used');

  update public.orders set status = 'refunded', refunded_at = now() where id = o.id;
end $$;

-- Only the service role (i.e. the webhook) may fulfil or refund.
revoke execute on function public.finalize_ticket_order(uuid, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.refund_ticket_order(uuid)  from public, anon, authenticated;
revoke execute on function public.cancel_ticket_order(uuid, text) from public, anon, authenticated;
revoke execute on function public.expire_stale_orders(uuid)  from public, anon;
grant  execute on function public.finalize_ticket_order(uuid, text, text, bigint) to service_role;
grant  execute on function public.refund_ticket_order(uuid)  to service_role;
grant  execute on function public.cancel_ticket_order(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 9. What a member sees
-- ----------------------------------------------------------------------------
create or replace function public.tickets_on_sale()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(s.e order by s.starts_at), '[]'::json)
  from (
    select ev.starts_at,
           json_build_object(
             'event_id',  ev.id,
             'name',      ev.name,
             'venue',     ev.venue,
             'starts_at', ev.starts_at,
             'ends_at',   ev.ends_at,
             'image_url', ev.image_url,
             'description', ev.description,
             'types', (
               select coalesce(json_agg(json_build_object(
                        'id', t.id, 'name', t.name, 'description', t.description,
                        'kind', t.kind, 'release_order', t.release_order,
                        'price_ore', t.price_ore, 'max_per_order', t.max_per_order,
                        'status', t.status,
                        'sales_start', t.sales_start, 'sales_end', t.sales_end,
                        'open', public.tt_is_open(t.status, t.sales_start, t.sales_end,
                                                  t.quantity, t.sold, t.reserved),
                        'left', case when t.quantity is null then null
                                     else public.tt_available(t.quantity, t.sold, t.reserved) end
                      ) order by t.kind desc, t.release_order, t.price_ore), '[]'::json)
                 from public.ticket_types t
                where t.event_id = ev.id and t.status <> 'draft'
             )
           ) as e
      from public.events ev
     where ev.is_published
       and ev.starts_at > now() - interval '12 hours'
       and exists (select 1 from public.ticket_types t
                    where t.event_id = ev.id and t.status <> 'draft')
  ) s;
$$;

create or replace function public.my_tickets()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'id', t.id, 'code', t.code, 'status', t.status,
           'type_name', tt.name, 'kind', tt.kind,
           'event_id', e.id, 'event_name', e.name, 'venue', e.venue,
           'starts_at', e.starts_at, 'used_at', t.used_at,
           'price_ore', oi.unit_price_ore
         ) order by e.starts_at desc, tt.kind desc), '[]'::json)
    from public.tickets t
    join public.ticket_types tt on tt.id = t.ticket_type_id
    join public.events e        on e.id  = t.event_id
    left join public.order_items oi
           on oi.order_id = t.order_id and oi.ticket_type_id = t.ticket_type_id
   where t.user_id = auth.uid()
     and t.status in ('valid','used');
$$;

create or replace function public.my_order(p_order uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', o.id, 'status', o.status, 'total_ore', o.total_ore,
    'event_name', e.name, 'starts_at', e.starts_at,
    'tickets', (select coalesce(json_agg(json_build_object(
                          'code', t.code, 'type_name', tt.name) order by tt.kind desc), '[]'::json)
                  from public.tickets t
                  join public.ticket_types tt on tt.id = t.ticket_type_id
                 where t.order_id = o.id))
    from public.orders o join public.events e on e.id = o.event_id
   where o.id = p_order and o.user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 10. The door
-- ----------------------------------------------------------------------------
-- A ticket QR carries its code. This validates and burns it in one call, and
-- also counts the person as attending (which is what feeds the tier system).
create or replace function public.staff_redeem_ticket(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  ev uuid := public.active_staff_event();
  rl public.staff_role := public.active_staff_role();
  t  public.tickets%rowtype;
  res json;
begin
  if ev is null then raise exception 'You are not on shift for any event right now'; end if;
  if rl is distinct from 'door' and not public.is_admin() then
    raise exception 'Door staff only';
  end if;

  select * into t from public.tickets
   where code = upper(trim(p_code)) for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'unknown', 'message', 'No ticket with that code');
  end if;
  if t.event_id <> ev then
    return json_build_object('ok', false, 'reason', 'wrong_event',
                             'message', 'That ticket is for a different event');
  end if;
  if t.status = 'refunded' or t.status = 'void' then
    return json_build_object('ok', false, 'reason', 'void', 'message', 'This ticket was refunded or cancelled');
  end if;
  if t.status = 'used' then
    return json_build_object('ok', false, 'reason', 'used', 'message',
      'Already scanned at ' || to_char(t.used_at at time zone 'Europe/Stockholm', 'HH24:MI'),
      'name', (select nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '')
                 from public.profiles p where p.id = t.user_id),
      'type_name', (select name from public.ticket_types where id = t.ticket_type_id));
  end if;

  update public.tickets set status = 'used', used_at = now(), used_by = auth.uid()
   where id = t.id;

  insert into public.attendance (user_id, event_id, checked_in_by, source)
  values (t.user_id, ev, auth.uid(), 'ticket_scan')
  on conflict (user_id, event_id) do nothing;

  select json_build_object(
    'ok', true,
    'name', nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
    'type_name', tt.name,
    'kind', tt.kind,
    'member_ok', coalesce(m.is_active_member, false),
    'tier', s.tier,
    'other_tickets', (select coalesce(json_agg(tt2.name), '[]'::json)
                        from public.tickets t2
                        join public.ticket_types tt2 on tt2.id = t2.ticket_type_id
                       where t2.user_id = t.user_id and t2.event_id = ev
                         and t2.id <> t.id and t2.status in ('valid','used'))
  ) into res
  from public.profiles p
  join public.ticket_types tt on tt.id = t.ticket_type_id
  left join public.membership_status m on m.id = p.id
  left join public.member_stats s on s.id = p.id
  where p.id = t.user_id;

  return res;
end $$;

-- What tickets does this person hold for tonight? Used by the door when
-- somebody scans their member QR instead of their ticket.
create or replace function public.staff_member_tickets(p_user uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'code', t.code, 'type_name', tt.name, 'kind', tt.kind, 'status', t.status)
         order by tt.kind desc), '[]'::json)
    from public.tickets t
    join public.ticket_types tt on tt.id = t.ticket_type_id
   where t.user_id = p_user
     and t.event_id = public.active_staff_event()
     and t.status in ('valid','used')
     and public.active_staff_event() is not null;
$$;

-- ----------------------------------------------------------------------------
-- 11. Admin
-- ----------------------------------------------------------------------------
create or replace function public.admin_upsert_ticket_type(
  p_id uuid, p_event uuid, p_name text, p_kind public.ticket_kind,
  p_release_order int, p_price_ore int, p_quantity int,
  p_status public.ticket_type_status, p_sales_start timestamptz,
  p_sales_end timestamptz, p_max_per_order int, p_description text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  if p_id is null then
    insert into public.ticket_types (event_id, name, description, kind, release_order,
                                     price_ore, quantity, status, sales_start, sales_end, max_per_order)
    values (p_event, trim(p_name), nullif(trim(coalesce(p_description,'')),''), p_kind, p_release_order,
            p_price_ore, p_quantity, p_status, p_sales_start, p_sales_end, coalesce(p_max_per_order,4))
    returning id into rid;
  else
    -- You may not cut the allocation below what has already gone out the door.
    if p_quantity is not null and exists (
      select 1 from public.ticket_types
       where id = p_id and p_quantity < sold + reserved)
    then
      raise exception 'You have already sold or reserved more than that';
    end if;

    update public.ticket_types
       set name = trim(p_name),
           description = nullif(trim(coalesce(p_description,'')),''),
           kind = p_kind,
           release_order = p_release_order,
           price_ore = p_price_ore,
           quantity = p_quantity,
           status = p_status,
           sales_start = p_sales_start,
           sales_end = p_sales_end,
           max_per_order = coalesce(p_max_per_order, 4)
     where id = p_id
    returning id into rid;
  end if;

  return rid;
end $$;

create or replace function public.admin_set_ticket_status(p_id uuid, p_status public.ticket_type_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  update public.ticket_types set status = p_status where id = p_id;
end $$;

create or replace function public.admin_delete_ticket_type(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  if exists (select 1 from public.order_items where ticket_type_id = p_id) then
    raise exception 'This release has orders against it — close it instead of deleting it';
  end if;
  delete from public.ticket_types where id = p_id;
end $$;

-- One click: lay out the four releases plus the backstage add-on for an event.
-- Prices are a starting point; edit them per event.
create or replace function public.admin_seed_releases(p_event uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  insert into public.ticket_types (event_id, name, kind, release_order, price_ore, quantity, status, max_per_order, description)
  values
    (p_event, 'Blind Release',    'entry', 1, 18000, 40,   'on_sale', 4, 'Cheapest, before the lineup is out.'),
    (p_event, 'Standard Release', 'entry', 2, 22000, null, 'draft',   4, 'Opens when the blind release sells out.'),
    (p_event, 'Second Release',   'entry', 3, 26000, null, 'draft',   4, null),
    (p_event, 'Third Release',    'entry', 4, 30000, null, 'draft',   4, 'Last tickets before the door.'),
    (p_event, 'Backstage',        'addon', 9, 10000, 20,   'on_sale', 2, 'Add-on. Needs an entry ticket.')
  on conflict (event_id, name) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_event_sales(p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
declare res json;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  perform public.expire_stale_orders(p_event);

  select json_build_object(
    'types', (select coalesce(json_agg(json_build_object(
                'id', t.id, 'name', t.name, 'description', t.description, 'kind', t.kind,
                'release_order', t.release_order, 'price_ore', t.price_ore,
                'quantity', t.quantity, 'sold', t.sold, 'reserved', t.reserved,
                'status', t.status, 'sales_start', t.sales_start, 'sales_end', t.sales_end,
                'max_per_order', t.max_per_order,
                'open', public.tt_is_open(t.status, t.sales_start, t.sales_end, t.quantity, t.sold, t.reserved),
                'left', case when t.quantity is null then null
                             else public.tt_available(t.quantity, t.sold, t.reserved) end,
                'revenue_ore', t.sold::bigint * t.price_ore
              ) order by t.kind desc, t.release_order), '[]'::json)
              from public.ticket_types t where t.event_id = p_event),
    'totals', (select json_build_object(
                'sold',        coalesce(sum(t.sold), 0),
                'revenue_ore', coalesce(sum(t.sold::bigint * t.price_ore), 0),
                'held',        coalesce(sum(t.reserved), 0))
              from public.ticket_types t where t.event_id = p_event),
    'orders', (select json_build_object(
                'paid',     count(*) filter (where status = 'paid'),
                'pending',  count(*) filter (where status = 'pending' and reserved_until > now()),
                'refunded', count(*) filter (where status = 'refunded'),
                'flagged',  count(*) filter (where flagged is not null))
              from public.orders where event_id = p_event),
    'scanned', (select count(*) from public.tickets where event_id = p_event and status = 'used')
  ) into res;
  return res;
end $$;

create or replace function public.admin_orders(p_event uuid default null, p_limit int default 50)
returns json language plpgsql security definer set search_path = public as $$
declare res json;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  select coalesce(json_agg(r order by r->>'created_at' desc), '[]'::json) into res from (
    select json_build_object(
      'id', o.id, 'status', o.status, 'total_ore', o.total_ore,
      'created_at', o.created_at, 'paid_at', o.paid_at, 'flagged', o.flagged,
      'event_name', e.name,
      'buyer', nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
      'email', p.email,
      'items', (select coalesce(json_agg(oi.name_snapshot || ' ×' || oi.qty), '[]'::json)
                  from public.order_items oi where oi.order_id = o.id)
    ) as r
    from public.orders o
    join public.events e   on e.id = o.event_id
    join public.profiles p on p.id = o.user_id
    where (p_event is null or o.event_id = p_event)
      and o.status <> 'expired'
    order by o.created_at desc
    limit greatest(coalesce(p_limit, 50), 1)
  ) s;
  return res;
end $$;

-- ----------------------------------------------------------------------------
-- 12. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.ticket_types enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.tickets      enable row level security;

-- Releases: anyone signed in can see anything that isn't a draft. Drafts are
-- yours to prepare in private.
drop policy if exists ticket_types_read on public.ticket_types;
create policy ticket_types_read on public.ticket_types
  for select to authenticated
  using (status <> 'draft' or public.is_admin());

drop policy if exists ticket_types_admin on public.ticket_types;
create policy ticket_types_admin on public.ticket_types
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Orders and tickets: your own, and nobody else's. Staff get what they need
-- through the security-definer functions above, never by reading these tables.
drop policy if exists orders_own on public.orders;
create policy orders_own on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists order_items_own on public.order_items;
create policy order_items_own on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o
                  where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));

drop policy if exists tickets_own on public.tickets;
create policy tickets_own on public.tickets
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No insert/update/delete policies anywhere: every write goes through a
-- function that checks who is asking. A stolen browser token cannot mint a
-- ticket, change a price, or mark somebody else's ticket used.

-- ----------------------------------------------------------------------------
-- 13. Settings
-- ----------------------------------------------------------------------------
insert into public.app_settings (key, value, note) values
  ('tickets_require_active_membership', 'false',
   'Set to true to require a verified Kulturförening membership before buying.'),
  ('tickets_hold_minutes', '35',
   'How long a checkout holds stock. Stays above the Stripe session expiry (31 min).')
on conflict (key) do nothing;

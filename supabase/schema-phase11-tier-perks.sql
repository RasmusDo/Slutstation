-- ============================================================================
-- SLUTSTATION, phase 11 — the tier code, and the perks it carries
--
-- The ladder stops being a number and starts being worth something:
--
--   Tier 1  buy tickets at all. This is membership itself, not a reward.
--   Tier 2  the wardrobe is free, every night.
--   Tier 3  the above, plus a soft drink or a Red Bull at the bar, plus 20%
--           off, plus the announcement a few hours before everyone else.
--   Tier 4  tickets at the lowest price, always, even on a sold-out night.
--
-- Only the first two are enforced by this file, because only they are handed
-- over at the door. The 10%, the early announcement and the Tier 4 price are
-- ticketing decisions and live wherever tickets are sold.
--
-- Skipping the queue was on this list and came off it: there is no way to
-- enforce it at a door that is one person and a torch, and a promise nobody
-- can keep is worse than one nobody made.
--
-- Tier 4 is worded vaguely on the account page ON PURPOSE. If more people
-- reach it than the deal can carry, the wording has to survive being adjusted
-- without anyone being told a number has been taken away from them.
--
-- WHY THIS IS BUILT AT THE DOOR AND NOT IN THE CHECKOUT
--
-- Billetto's API is read-only for anything that matters here: you cannot mint
-- a discount code through it, and gift cards are something buyers purchase
-- rather than something we can issue. What we CAN do, at no cost and with no
-- third party involved, is read a member's tier off a scan — the staff app
-- already puts it on screen. So the perks that need no money to change hands
-- live here, enforced by the same phone that already scans people in.
--
-- WHY A CLAIM TABLE AND NOT A FLAG
--
-- A free wardrobe is only free once a night. The primary key below is the
-- whole enforcement: one row per member, per event, per perk. A second scan
-- finds the row and says so, with the time it was first claimed, so the person
-- on the wardrobe never has to remember a face.
--
-- WHY THE TIER CANNOT MOVE DURING THE NIGHT
--
-- Attendance is imported from the Billetto export after the event, not scanned
-- live, so nobody is promoted between the door and the bar. That is Axel's
-- decision and it is the right one: it means the tier a member shows at 22:00
-- is the tier they show at 03:00, and the people working can count what they
-- are giving away in advance. The tier is frozen onto each claim anyway, so
-- the record still explains itself in six months.
--
-- Safe to re-run.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'perk_kind') then
    create type public.perk_kind as enum ('wardrobe', 'drink');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. What each tier is owed
--
-- One function, so the account page, the scanner and any future email all
-- answer this question the same way. Changing what a tier unlocks is a change
-- here and nowhere else.
-- ----------------------------------------------------------------------------
create or replace function public.perks_for_tier(p_tier int)
returns public.perk_kind[] language sql immutable as $$
  select case
    when coalesce(p_tier, 1) >= 3 then array['wardrobe','drink']::public.perk_kind[]
    when coalesce(p_tier, 1) >= 2 then array['wardrobe']::public.perk_kind[]
    else '{}'::public.perk_kind[]
  end;
$$;

grant execute on function public.perks_for_tier(int) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The claims
-- ----------------------------------------------------------------------------
create table if not exists public.perk_claims (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  event_id     uuid not null references public.events (id)   on delete cascade,
  perk         public.perk_kind not null,
  claimed_at   timestamptz not null default now(),
  claimed_by   uuid references public.profiles (id),
  -- Frozen, so a claim still makes sense after the member's tier has moved on.
  tier_at_claim integer,
  primary key (user_id, event_id, perk)
);

create index if not exists perk_claims_event_idx on public.perk_claims (event_id, claimed_at desc);

alter table public.perk_claims enable row level security;

-- A member may read their own claims and nothing else. Staff and admins go
-- through the functions below, which decide what they are allowed to see.
drop policy if exists perk_claims_own on public.perk_claims;
create policy perk_claims_own on public.perk_claims
  for select using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. The scan
--
-- Same payload as the door scanner: the member's id, straight out of the QR.
-- Returns exactly what the person on the wardrobe needs and nothing else — a
-- name, whether the membership is good, the tier, and the state of each perk.
-- No email, no phone, no address, no birth date. That rule has held since
-- phase 2 and it holds here.
-- ----------------------------------------------------------------------------
create or replace function public.staff_tier_scan(p_user uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  ev   uuid := public.active_staff_event();
  tier int;
  nm   text;
  ok   boolean;
begin
  if ev is null and not public.is_admin() then
    raise exception 'Not on shift';
  end if;

  select nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
         coalesce(m.is_active_member, false)
    into nm, ok
    from public.profiles p
    left join public.membership_status m on m.id = p.id
   where p.id = p_user;

  if nm is null and ok is null then raise exception 'No such member'; end if;

  tier := public.tier_of(p_user);

  return json_build_object(
    'user_id',   p_user,
    'name',      nm,
    'member_ok', ok,
    'tier',      tier,
    'event_id',  ev,
    'perks', (
      select coalesce(json_agg(json_build_object(
               'perk',       k,
               'entitled',   k = any(public.perks_for_tier(tier)),
               'claimed',    c.user_id is not null,
               'claimed_at', c.claimed_at
             ) order by k), '[]'::json)
        from unnest(enum_range(null::public.perk_kind)) k
        left join public.perk_claims c
               on c.user_id = p_user and c.event_id = ev and c.perk = k)
  );
end $$;

grant execute on function public.staff_tier_scan(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Claiming
--
-- Deliberately open to ANY staff on shift rather than a wardrobe-only role.
-- At an event this size the same person does the wardrobe, the bar and half of
-- the door, and inventing a third tag would mean somebody cannot hand over a
-- Red Bull because of a dropdown. The claim is low-stakes and fully logged.
--
-- The two ways this can fail are both worth a clear message rather than a
-- silent no-op: not entitled (their tier does not include it), and already
-- claimed (with the time, so the member can be told when).
-- ----------------------------------------------------------------------------
create or replace function public.staff_claim_perk(p_user uuid, p_perk public.perk_kind)
returns json language plpgsql security definer set search_path = public as $$
declare
  ev    uuid := public.active_staff_event();
  tier  int;
  prior timestamptz;
begin
  if ev is null then raise exception 'Not on shift'; end if;

  tier := public.tier_of(p_user);
  if not (p_perk = any(public.perks_for_tier(tier))) then
    return json_build_object('ok', false, 'reason', 'not_entitled', 'tier', tier);
  end if;

  select claimed_at into prior from public.perk_claims
   where user_id = p_user and event_id = ev and perk = p_perk;
  if found then
    return json_build_object('ok', false, 'reason', 'already', 'claimed_at', prior, 'tier', tier);
  end if;

  insert into public.perk_claims (user_id, event_id, perk, claimed_by, tier_at_claim)
  values (p_user, ev, p_perk, auth.uid(), tier)
  -- Two phones scanning the same person at the same second is not a
  -- hypothetical on a busy door. The unique key settles it; this turns the
  -- loser of that race into "already claimed" rather than an error.
  on conflict (user_id, event_id, perk) do nothing;

  if not found then
    select claimed_at into prior from public.perk_claims
     where user_id = p_user and event_id = ev and perk = p_perk;
    return json_build_object('ok', false, 'reason', 'already', 'claimed_at', prior, 'tier', tier);
  end if;

  return json_build_object('ok', true, 'perk', p_perk, 'tier', tier, 'claimed_at', now());
end $$;

grant execute on function public.staff_claim_perk(uuid, public.perk_kind) to authenticated;

-- Undo. Somebody will tap the wrong row on a dark phone at midnight, and the
-- alternative to an undo is a member who cannot have their coat back for free.
create or replace function public.staff_unclaim_perk(p_user uuid, p_perk public.perk_kind)
returns json language plpgsql security definer set search_path = public as $$
declare ev uuid := public.active_staff_event();
begin
  if ev is null then raise exception 'Not on shift'; end if;
  delete from public.perk_claims
   where user_id = p_user and event_id = ev and perk = p_perk;
  return json_build_object('ok', true, 'perk', p_perk);
end $$;

grant execute on function public.staff_unclaim_perk(uuid, public.perk_kind) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The member's own view
--
-- What their code is worth tonight, and what has already been used. Scoped to
-- an event happening TODAY, because that is the only night a claim can be made
-- and showing "claimed" against last month's event would just be confusing.
-- ----------------------------------------------------------------------------
create or replace function public.my_tier_card()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  tier int;
  ev   uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  tier := public.tier_of(uid);

  select e.id into ev from public.events e
   where e.starts_at::date = current_date
   order by e.starts_at limit 1;

  return json_build_object(
    'tier',  tier,
    'perks', public.perks_for_tier(tier),
    'event_tonight', ev,
    'claimed', (
      select coalesce(json_agg(json_build_object('perk', c.perk, 'claimed_at', c.claimed_at)), '[]'::json)
        from public.perk_claims c where c.user_id = uid and c.event_id = ev)
  );
end $$;

grant execute on function public.my_tier_card() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. What the night cost in perks
--
-- Two numbers the admin panel can show after an event: how many coats went
-- through free and how many drinks were handed over. Worth having before
-- anyone asks whether the ladder is affordable.
-- ----------------------------------------------------------------------------
create or replace function public.admin_perk_totals(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select coalesce(json_object_agg(perk, n), '{}'::json) from (
    select perk, count(*)::int as n from public.perk_claims
     where event_id = p_event group by perk) x);
end $$;

grant execute on function public.admin_perk_totals(uuid) to authenticated;

-- ============================================================================
-- SLUTSTATION, phase 13 — handing out the reward codes
--
-- Billetto cannot mint codes through its API, so they are made by hand in the
-- dashboard and poured into the pool below. What this file does is the part a
-- human should not: deciding who gets which one, exactly once, without two
-- people ever being handed the same code.
--
-- WHY A POOL AND NOT A COLUMN ON THE MEMBER
--
-- A code is a scarce physical-ish object: it exists in Billetto, it works a
-- fixed number of times, and then it is gone. Modelling it as a row that gets
-- claimed means the database can answer "how many are left" and can refuse to
-- hand out one that does not exist, rather than promising a member something
-- and leaving Axel to find twelve more by Friday.
--
-- ASSIGNMENT IS AUTOMATIC AND ATOMIC
--
-- A member who has earned the tier claims the next free code the first time
-- they look. `for update skip locked` is what makes that safe: two members
-- refreshing at the same moment take two different rows instead of racing for
-- one. The partial unique index is the belt to that brace — one code of each
-- kind per member, enforced by the schema and not by the query.
--
-- ONCE GIVEN, IT IS THEIRS
--
-- Tiers move both ways, and a member who drops from Tier 3 keeps the code they
-- already hold. Taking back something already handed over would be a worse
-- experience than the tier system is worth, and Billetto has already been told
-- that code exists.
--
-- WHAT MEMBERS ARE NOT TOLD
--
-- Nothing here records the discount or the ticket cap, on purpose. Those live
-- in Billetto. The site says what the tier unlocks in words the collective can
-- keep at any future event; it does not quote a percentage it might not be
-- able to afford next time.
--
-- Safe to re-run.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reward_code_kind') then
    create type public.reward_code_kind as enum ('tier3', 'tier4');
  end if;
end $$;

create table if not exists public.reward_codes (
  code        text primary key
              check (code = upper(code) and code ~ '^[A-Z0-9]{6,24}$'),
  kind        public.reward_code_kind not null,
  assigned_to uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz,
  added_at    timestamptz not null default now(),
  note        text
);

-- One code of each kind per member. Partial, so the many unassigned rows do not
-- collide with each other on a null assigned_to.
create unique index if not exists reward_codes_one_per_member
  on public.reward_codes (assigned_to, kind) where assigned_to is not null;

create index if not exists reward_codes_free_idx
  on public.reward_codes (kind, added_at) where assigned_to is null;

alter table public.reward_codes enable row level security;

-- A member sees their own codes and nothing else. The unassigned pool is
-- invisible to every browser token, which is the point: a code is worth money
-- and the network tab is not a secret.
drop policy if exists reward_codes_own on public.reward_codes;
create policy reward_codes_own on public.reward_codes
  for select using (assigned_to = auth.uid());

-- ----------------------------------------------------------------------------
-- Which tier earns which kind
-- ----------------------------------------------------------------------------
create or replace function public.reward_kinds_for_tier(p_tier int)
returns public.reward_code_kind[] language sql immutable as $$
  select case
    -- Tier 4 holds both: the tier-4 code covers fewer tickets, so the tier-3
    -- one is what they use for the rest of the group.
    when coalesce(p_tier,1) >= 4 then array['tier3','tier4']::public.reward_code_kind[]
    when coalesce(p_tier,1) >= 3 then array['tier3']::public.reward_code_kind[]
    else '{}'::public.reward_code_kind[]
  end;
$$;

grant execute on function public.reward_kinds_for_tier(int) to authenticated;

-- ----------------------------------------------------------------------------
-- The member's own codes, claiming any they have earned but not yet been given
-- ----------------------------------------------------------------------------
create or replace function public.my_reward_codes()
returns json language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  tier int;
  k    public.reward_code_kind;
  got  text;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  tier := public.tier_of(uid);

  foreach k in array public.reward_kinds_for_tier(tier) loop
    if not exists (select 1 from public.reward_codes
                    where assigned_to = uid and kind = k) then
      -- skip locked: two members refreshing at the same instant take two
      -- different rows rather than one of them erroring.
      update public.reward_codes c
         set assigned_to = uid, assigned_at = now()
       where c.code = (select code from public.reward_codes
                        where kind = k and assigned_to is null
                        order by added_at, code
                        for update skip locked
                        limit 1)
      returning c.code into got;
      -- got is null when the pool for that kind is empty. Deliberately not an
      -- error: the member has genuinely earned it and should be told it is
      -- coming, not shown a failure.
    end if;
  end loop;

  return json_build_object(
    'tier',  tier,
    'earned', public.reward_kinds_for_tier(tier),
    'codes', (
      select coalesce(json_agg(json_build_object(
               'kind', kind, 'code', code, 'since', assigned_at) order by kind), '[]'::json)
        from public.reward_codes where assigned_to = uid)
  );
end $$;

grant execute on function public.my_reward_codes() to authenticated;

-- ----------------------------------------------------------------------------
-- Admin: fill the pool, and see how much is left
-- ----------------------------------------------------------------------------
create or replace function public.admin_add_reward_codes(
  p_kind public.reward_code_kind, p_codes text[])
returns json language plpgsql security definer set search_path = public as $$
declare added int := 0; skipped int := 0;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  with cleaned as (
    select distinct upper(trim(c)) as code
      from unnest(coalesce(p_codes,'{}'::text[])) c
     where upper(trim(c)) ~ '^[A-Z0-9]{6,24}$'
  ), ins as (
    insert into public.reward_codes (code, kind)
    select code, p_kind from cleaned
    on conflict (code) do nothing
    returning 1
  )
  select (select count(*)::int from ins),
         (select count(*)::int from cleaned) - (select count(*)::int from ins)
    into added, skipped;

  perform public.log_admin_action('reward_codes_added', null,
    jsonb_build_object('kind', p_kind, 'added', added, 'already_there', skipped));

  return json_build_object('kind', p_kind, 'added', added, 'already_there', skipped);
end $$;

grant execute on function public.admin_add_reward_codes(public.reward_code_kind, text[]) to authenticated;

create or replace function public.admin_reward_code_status()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select coalesce(json_agg(row_to_json(x) order by x.kind), '[]'::json) from (
    select kind,
           count(*) filter (where assigned_to is null)::int as free,
           count(*) filter (where assigned_to is not null)::int as given,
           count(*)::int as total
      from public.reward_codes group by kind) x);
end $$;

grant execute on function public.admin_reward_code_status() to authenticated;

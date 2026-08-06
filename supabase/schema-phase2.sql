-- ============================================================================
-- SLUTSTATION — Phase 2 schema
--   * staff roles (member / door / bar / admin)
--   * events + door check-in  -> attendance
--   * earned tiers with progress to the next one
--   * referral codes, referrals, and banked credit
--
-- Run AFTER schema.sql. Safe to re-run.
--
-- Design notes:
--   * A member can never write their own role, tier, attendance or credit.
--     Everything that confers value is written by the service role (Edge
--     Function) or by a SECURITY DEFINER function that checks the caller.
--   * Credit lives in `ledger_entries` in ÖRE as integers — the same table the
--     Phase 2 top-up wallet will use, so referral rewards and wallet top-ups
--     merge with no migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Roles
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('member', 'door', 'bar', 'admin');
  end if;
end $$;

alter table public.profiles
  add column if not exists role public.user_role not null default 'member';

alter table public.profiles
  add column if not exists referral_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_referral_code_key') then
    alter table public.profiles add constraint profiles_referral_code_key unique (referral_code);
  end if;
end $$;

comment on column public.profiles.role is 'member = normal. door/bar = staff. admin = full. Never writable by the user themselves.';

-- helper used by policies: is the caller staff / admin?
create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false);
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid())
                  in ('door', 'bar', 'admin'), false);
$$;

-- ----------------------------------------------------------------------------
-- 2. Referral codes — 8 chars, no look-alike characters
-- ----------------------------------------------------------------------------
create or replace function public.gen_referral_code()
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no O/0, I/1
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = code);
  end loop;
  return code;
end $$;

-- backfill anyone who already has an account
update public.profiles
   set referral_code = public.gen_referral_code()
 where referral_code is null;

-- ----------------------------------------------------------------------------
-- 3. Settings — so reward amounts and the referral rule are data, not code
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key   text primary key,
  value text not null,
  note  text
);

insert into public.app_settings (key, value, note) values
  ('referral_qualifies_on', 'ticket_purchase',
   'When a referral turns from pending into a reward. One of: signup | attendance | ticket_purchase. NOTE: ticket_purchase cannot fire while tickets are sold on Billetto — set to attendance to make referrals live now.'),
  ('referral_reward_referrer_ore', '5000', 'Credit to the referrer, in öre. 5000 = 50 kr. PLACEHOLDER — confirm.'),
  ('referral_reward_referred_ore', '2500', 'Credit to the new member, in öre. 2500 = 25 kr. PLACEHOLDER — confirm.'),
  ('tier_window_months', '24', 'Attendance is counted over this trailing window.')
on conflict (key) do nothing;

create or replace function public.setting(p_key text, p_default text default null)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = p_key), p_default);
$$;

-- ----------------------------------------------------------------------------
-- 4. Events
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  venue             text,
  capacity          integer,
  billetto_event_id text,
  is_published      boolean not null default true,
  created_at        timestamptz not null default now()
);

create index if not exists events_starts_at_idx on public.events (starts_at desc);

-- ----------------------------------------------------------------------------
-- 5. Attendance — one row per person per event they actually turned up to
-- ----------------------------------------------------------------------------
create table if not exists public.attendance (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  event_id       uuid not null references public.events (id)   on delete cascade,
  checked_in_at  timestamptz not null default now(),
  checked_in_by  uuid references public.profiles (id),
  source         text not null default 'door_scan',   -- door_scan | manual | import
  unique (user_id, event_id)                          -- can only count once
);

create index if not exists attendance_user_idx  on public.attendance (user_id);
create index if not exists attendance_event_idx on public.attendance (event_id);

-- ----------------------------------------------------------------------------
-- 6. Referrals
-- ----------------------------------------------------------------------------
create table if not exists public.referrals (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references public.profiles (id) on delete cascade,
  referred_id  uuid not null unique references public.profiles (id) on delete cascade,
  code_used    text not null,
  status       text not null default 'pending',   -- pending | qualified | void
  created_at   timestamptz not null default now(),
  qualified_at timestamptz,
  constraint referrals_no_self check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id, status);

-- ----------------------------------------------------------------------------
-- 7. Ledger — banked credit. Same table the top-up wallet will use.
--    Amounts are integers in ÖRE. Never floats for money.
-- ----------------------------------------------------------------------------
create table if not exists public.ledger_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  amount_ore  bigint not null,
  type        text not null,      -- referral_bonus | topup | purchase | bonus | refund | adjustment
  reference   text,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists ledger_user_idx on public.ledger_entries (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 8. Referral qualification
--    Called with the trigger that just happened. Only pays out if that matches
--    the configured rule, so switching the rule needs no code change.
-- ----------------------------------------------------------------------------
create or replace function public.qualify_referral(p_user uuid, p_trigger text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r public.referrals%rowtype;
  rule text := public.setting('referral_qualifies_on', 'ticket_purchase');
  ref_ore bigint := public.setting('referral_reward_referrer_ore', '0')::bigint;
  new_ore bigint := public.setting('referral_reward_referred_ore', '0')::bigint;
begin
  if p_trigger is distinct from rule then
    return false;                       -- not the configured trigger
  end if;

  select * into r from public.referrals
   where referred_id = p_user and status = 'pending'
   for update;

  if not found then
    return false;
  end if;

  update public.referrals
     set status = 'qualified', qualified_at = now()
   where id = r.id;

  if ref_ore > 0 then
    insert into public.ledger_entries (user_id, amount_ore, type, reference, note)
    values (r.referrer_id, ref_ore, 'referral_bonus', r.id::text, 'Referral reward');
  end if;

  if new_ore > 0 then
    insert into public.ledger_entries (user_id, amount_ore, type, reference, note)
    values (r.referred_id, new_ore, 'referral_bonus', r.id::text, 'Welcome bonus');
  end if;

  return true;
end $$;

-- fire it automatically when attendance is recorded (no-op unless the rule is 'attendance')
create or replace function public.attendance_qualifies_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.qualify_referral(new.user_id, 'attendance');
  return new;
end $$;

drop trigger if exists attendance_referral_hook on public.attendance;
create trigger attendance_referral_hook
  after insert on public.attendance
  for each row execute function public.attendance_qualifies_referral();

-- ----------------------------------------------------------------------------
-- 9. Signup hook — assign a referral code and record who referred them
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  ref_code  text  := upper(nullif(trim(meta ->> 'referred_by_code'), ''));
  referrer  uuid;
begin
  insert into public.profiles (
    id, email, first_name, last_name, phone,
    birth_date, gender_id, street, zip_code, city,
    marketing_consent, terms_accepted_at, referral_code
  )
  values (
    new.id,
    new.email,
    nullif(trim(meta ->> 'first_name'), ''),
    nullif(trim(meta ->> 'last_name'),  ''),
    nullif(trim(meta ->> 'phone'),      ''),
    case when (meta ->> 'birth_date') ~ '^\d{4}-\d{2}-\d{2}$'
         then (meta ->> 'birth_date')::date end,
    case when (meta ->> 'gender_id') ~ '^\d+$'
         then (meta ->> 'gender_id')::smallint end,
    nullif(trim(meta ->> 'street'),   ''),
    nullif(trim(meta ->> 'zip_code'), ''),
    nullif(trim(meta ->> 'city'),     ''),
    coalesce((meta ->> 'marketing_consent')::boolean, false),
    case when coalesce((meta ->> 'terms_accepted')::boolean, false) then now() end,
    public.gen_referral_code()
  )
  on conflict (id) do nothing;

  -- who sent them? (never themselves — the row doesn't exist yet)
  if ref_code is not null then
    select id into referrer from public.profiles where referral_code = ref_code;
    if referrer is not null and referrer <> new.id then
      insert into public.referrals (referrer_id, referred_id, code_used)
      values (referrer, new.id, ref_code)
      on conflict (referred_id) do nothing;
      perform public.qualify_referral(new.id, 'signup');
    end if;
  end if;

  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 10. Tier + stats. This is what the dashboard reads.
-- ----------------------------------------------------------------------------
--   Tier 1: 0–1   Tier 2: 2–3   Tier 3: 4–7   Tier 4: 8+
--   over a trailing 24-month window (5 events/year makes 12 months too tight)
create or replace function public.tier_for(p_events integer)
returns integer language sql immutable as $$
  select case
    when p_events >= 8 then 4
    when p_events >= 4 then 3
    when p_events >= 2 then 2
    else 1
  end;
$$;

create or replace function public.tier_threshold(p_tier integer)
returns integer language sql immutable as $$
  select case p_tier when 2 then 2 when 3 then 4 when 4 then 8 else 0 end;
$$;

create or replace view public.member_stats
with (security_invoker = true) as
with base as (
  select
    p.id,
    p.referral_code,
    p.role,
    (select count(*) from public.attendance a
      where a.user_id = p.id
        and a.checked_in_at > now() - (public.setting('tier_window_months','24') || ' months')::interval
    )::int as events_window,
    (select count(*) from public.attendance a where a.user_id = p.id)::int as events_total,
    (select max(a.checked_in_at) from public.attendance a where a.user_id = p.id) as last_attended_at,
    (select min(a.checked_in_at) from public.attendance a where a.user_id = p.id) as first_attended_at,
    (select count(*) from public.referrals r
      where r.referrer_id = p.id and r.status = 'qualified')::int as referrals_qualified,
    (select count(*) from public.referrals r
      where r.referrer_id = p.id and r.status = 'pending')::int as referrals_pending,
    coalesce((select sum(l.amount_ore) from public.ledger_entries l where l.user_id = p.id), 0)::bigint as credit_ore
  from public.profiles p
)
select
  b.*,
  public.tier_for(b.events_window) as tier,
  case public.tier_for(b.events_window)
    when 1 then 'Tier 1' when 2 then 'Tier 2'
    when 3 then 'Tier 3' else 'Tier 4' end as tier_name,
  case when public.tier_for(b.events_window) < 4
       then public.tier_for(b.events_window) + 1 end as next_tier,
  case when public.tier_for(b.events_window) < 4
       then greatest(public.tier_threshold(public.tier_for(b.events_window) + 1) - b.events_window, 0)
  end as events_to_next_tier,
  public.tier_threshold(public.tier_for(b.events_window))     as tier_floor,
  case when public.tier_for(b.events_window) < 4
       then public.tier_threshold(public.tier_for(b.events_window) + 1) end as next_tier_at
from base b;

comment on view public.member_stats is 'Dashboard source. security_invoker means a member only ever sees their own row.';

-- ----------------------------------------------------------------------------
-- 11. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.events        enable row level security;
alter table public.attendance    enable row level security;
alter table public.referrals     enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.app_settings  enable row level security;

-- events: anyone signed in sees published ones; admins manage
drop policy if exists events_read on public.events;
create policy events_read on public.events
  for select using (is_published or public.is_staff());

drop policy if exists events_admin_write on public.events;
create policy events_admin_write on public.events
  for all using (public.is_admin()) with check (public.is_admin());

-- attendance: you see your own; staff see all (needed for the door list)
drop policy if exists attendance_read_own on public.attendance;
create policy attendance_read_own on public.attendance
  for select using (auth.uid() = user_id or public.is_staff());
-- no insert/update policy: writes go through the check-in Edge Function
-- (service role) or the admin RPC below.

-- referrals: you see referrals you made, and the one that brought you in
drop policy if exists referrals_read_own on public.referrals;
create policy referrals_read_own on public.referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referred_id);

-- ledger: you see your own money only
drop policy if exists ledger_read_own on public.ledger_entries;
create policy ledger_read_own on public.ledger_entries
  for select using (auth.uid() = user_id or public.is_admin());

-- settings: readable by staff, writable by admins
drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings
  for select using (public.is_staff());
drop policy if exists settings_admin_write on public.app_settings;
create policy settings_admin_write on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- staff need to look members up; members still only see themselves
drop policy if exists profiles_staff_read on public.profiles;
create policy profiles_staff_read on public.profiles
  for select using (public.is_staff());

-- ----------------------------------------------------------------------------
-- 12. Nobody promotes themselves. Extends the Phase 1 guard.
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER on purpose: this trigger is the thing that stops privilege
-- escalation, so it must not depend on the calling role having rights on the
-- auth schema. Without it the UPDATE errors instead of being silently reverted.
create or replace function public.protect_ebas_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.ebas_status     := old.ebas_status;
    new.ebas_renewed_on := old.ebas_renewed_on;
    new.ebas_checked_at := old.ebas_checked_at;
    new.ebas_message    := old.ebas_message;
    new.email           := old.email;
    new.referral_code   := old.referral_code;   -- codes are permanent
    -- only an admin may change a role, and never their own
    if new.role is distinct from old.role
       and not (public.is_admin() and auth.uid() <> new.id) then
      new.role := old.role;
    end if;
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 13. Admin RPCs (SECURITY DEFINER, caller checked inside)
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_role(p_user uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;
  update public.profiles set role = p_role where id = p_user;
end $$;

create or replace function public.admin_add_attendance(p_user uuid, p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  insert into public.attendance (user_id, event_id, checked_in_by, source)
  values (p_user, p_event, auth.uid(), 'manual')
  on conflict (user_id, event_id) do nothing;
end $$;

create or replace function public.admin_remove_attendance(p_user uuid, p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  delete from public.attendance where user_id = p_user and event_id = p_event;
end $$;

revoke all on function public.admin_set_role(uuid, public.user_role) from public;
revoke all on function public.admin_add_attendance(uuid, uuid) from public;
revoke all on function public.admin_remove_attendance(uuid, uuid) from public;
grant execute on function public.admin_set_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_add_attendance(uuid, uuid) to authenticated;
grant execute on function public.admin_remove_attendance(uuid, uuid) to authenticated;

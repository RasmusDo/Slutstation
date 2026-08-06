-- ============================================================================
-- SLUTSTATION — Account system, Phase 1 (accounts + eBas membership status)
-- Run this once in the Supabase SQL Editor.
--
-- Design notes:
--   * Passwords are NEVER stored here. Supabase Auth owns auth.users and
--     handles hashing (bcrypt), sessions, resets and email confirmation.
--   * public.profiles holds everything WE need, keyed 1:1 to auth.users.
--   * We store date of birth (eBas needs YYYYMMDD for renewals) but we do
--     NOT store a full personnummer. Don't add one.
--   * Row Level Security is ON: a logged-in member can only ever read or
--     write their own row, even though the anon key is public.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Membership status
-- ----------------------------------------------------------------------------
-- unverified : account exists, never successfully registered in eBas
-- active     : eBas accepted the member (renewed within the last 12 months)
-- expired    : was registered, but the yearly renewal has lapsed
-- failed     : the last eBas attempt was rejected (see ebas_message)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ebas_status') then
    create type public.ebas_status as enum ('unverified', 'active', 'expired', 'failed');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Profiles
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null,

  -- the fields eBas requires, so a member can renew with one click
  first_name        text,
  last_name         text,
  phone             text,
  birth_date        date,
  gender_id         smallint,            -- eBas: 1 = female, 2 = male, 3 = other
  street            text,
  zip_code          text,
  city              text,

  -- consent is tracked separately from the account itself (GDPR)
  marketing_consent boolean     not null default false,
  terms_accepted_at timestamptz,

  -- eBas / Kulturföreningen Musikbopp membership
  ebas_status       public.ebas_status not null default 'unverified',
  ebas_renewed_on   date,                -- the "renewed" date eBas holds; valid 1 year
  ebas_checked_at   timestamptz,         -- last time we asked eBas
  ebas_message      text,                -- last error/warning from eBas, if any

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table  public.profiles is 'One row per member account. Mirrors auth.users; never stores passwords or personnummer.';
comment on column public.profiles.ebas_renewed_on is 'Date eBas recorded as "renewed". Membership is valid for one year from this date.';

create index if not exists profiles_email_idx      on public.profiles (lower(email));
create index if not exists profiles_ebas_status_idx on public.profiles (ebas_status);

-- ----------------------------------------------------------------------------
-- 3. keep updated_at honest
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Auto-create a profile whenever someone signs up
--    Values come from the `data:` metadata passed to supabase.auth.signUp().
--    Everything is defensively parsed — a bad date must never block signup.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (
    id, email, first_name, last_name, phone,
    birth_date, gender_id, street, zip_code, city,
    marketing_consent, terms_accepted_at
  )
  values (
    new.id,
    new.email,
    -- Our signup form sends first_name/last_name; Google sends given_name /
    -- family_name. Take whichever arrived.
    coalesce(nullif(trim(meta ->> 'first_name'), ''),
             nullif(trim(meta ->> 'given_name'), '')),
    coalesce(nullif(trim(meta ->> 'last_name'),  ''),
             nullif(trim(meta ->> 'family_name'), '')),
    nullif(trim(meta ->> 'phone'),      ''),
    case when (meta ->> 'birth_date') ~ '^\d{4}-\d{2}-\d{2}$'
         then (meta ->> 'birth_date')::date end,
    case when (meta ->> 'gender_id') ~ '^\d+$'
         then (meta ->> 'gender_id')::smallint end,
    nullif(trim(meta ->> 'street'),   ''),
    nullif(trim(meta ->> 'zip_code'), ''),
    nullif(trim(meta ->> 'city'),     ''),
    coalesce((meta ->> 'marketing_consent')::boolean, false),
    case when coalesce((meta ->> 'terms_accepted')::boolean, false)
         then now() end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. Row Level Security — the anon key is public, so this is what protects data
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Deliberately NO insert or delete policy: profiles are created by the
-- trigger above, and the eBas Edge Function writes ebas_* using the service
-- role key (which bypasses RLS). Members can never fake their own status.

-- Protect the eBas columns from being edited by the member themselves.
create or replace function public.protect_ebas_columns()
returns trigger
language plpgsql
as $$
begin
  -- auth.uid() is null when the service role / Edge Function is writing
  if auth.uid() is not null then
    new.ebas_status     := old.ebas_status;
    new.ebas_renewed_on := old.ebas_renewed_on;
    new.ebas_checked_at := old.ebas_checked_at;
    new.ebas_message    := old.ebas_message;
    new.email           := old.email;   -- email changes go through Supabase Auth
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_ebas on public.profiles;
create trigger profiles_protect_ebas
  before update on public.profiles
  for each row execute function public.protect_ebas_columns();

-- ----------------------------------------------------------------------------
-- 6. Derived membership view — this is what powers the green check
--    security_invoker means the caller's RLS applies, so a member only ever
--    sees their own row here too.
-- ----------------------------------------------------------------------------
create or replace view public.membership_status
with (security_invoker = true) as
select
  p.id,
  p.ebas_status,
  p.ebas_renewed_on,
  p.ebas_checked_at,
  p.ebas_message,
  (
    p.ebas_status = 'active'
    and p.ebas_renewed_on is not null
    and p.ebas_renewed_on > (current_date - interval '1 year')
  ) as is_active_member,
  case
    when p.ebas_renewed_on is not null
    then (p.ebas_renewed_on + interval '1 year')::date
  end as expires_on
from public.profiles p;

comment on view public.membership_status is 'Green check = is_active_member. Membership lapses one year after ebas_renewed_on.';

-- ----------------------------------------------------------------------------
-- 7. Nightly sweep: flip lapsed memberships to expired.
--    Call from a Supabase scheduled function, or just rely on the view above
--    (the view is already time-correct; this only tidies the stored column).
-- ----------------------------------------------------------------------------
create or replace function public.expire_lapsed_memberships()
returns integer
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.profiles
       set ebas_status = 'expired'
     where ebas_status = 'active'
       and (ebas_renewed_on is null
            or ebas_renewed_on <= (current_date - interval '1 year'))
    returning 1
  )
  select count(*)::integer from updated;
$$;

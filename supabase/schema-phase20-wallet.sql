-- ============================================================================
-- PHASE 20 — Apple Wallet: who holds the card, and when to tell their phone
--
-- The pass itself is built and signed by the `wallet` Edge Function. The
-- database's whole job is two small tables and a flag:
--
--   wallet_passes          one row per member who has ever downloaded the
--                          card. Holds the per-pass authentication token
--                          Apple echoes back (never a session token), and
--                          needs_push, which is how the rest of the system
--                          says "this card is stale".
--   wallet_registrations   which physical devices hold which pass, written
--                          by Apple's own registration callback.
--
-- Live updates ride the machinery that already exists: the same
-- member_events rows that power the timeline and the tier card flip
-- needs_push, and a pg_cron tick tells the wallet function to notify the
-- registered devices. The phone then fetches a fresh pass — tier, progress,
-- perks — through the PassKit web service half of the same function.
--
-- Both tables are service-role only: RLS is enabled and no policy is
-- created, so no browser token can read a push token or an auth token.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create table if not exists public.wallet_passes (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  auth_token  text not null,
  needs_push  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.wallet_registrations (
  device_library_id text not null,
  user_id           uuid not null references public.wallet_passes (user_id) on delete cascade,
  push_token        text not null,
  created_at        timestamptz not null default now(),
  primary key (device_library_id, user_id)
);

create index if not exists wallet_registrations_user_idx
  on public.wallet_registrations (user_id);

alter table public.wallet_passes        enable row level security;
alter table public.wallet_registrations enable row level security;
-- No policies on purpose: service role only.

-- ----------------------------------------------------------------------------
-- Staleness. Anything that changes what the card shows flips the flag:
--   * member_events — attendance recorded, tier reached (the same append-only
--     log everything else trusts)
--   * perk_claims — the wardrobe or the drink handed over at the bar, so the
--     card can say "used 23:41" before they're back at the table
-- ----------------------------------------------------------------------------
create or replace function public.wallet_flag_stale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.wallet_passes
     set needs_push = true, updated_at = now()
   where user_id = new.user_id;
  return new;
end $$;

drop trigger if exists wallet_stale_on_member_event on public.member_events;
create trigger wallet_stale_on_member_event
  after insert on public.member_events
  for each row execute function public.wallet_flag_stale();

drop trigger if exists wallet_stale_on_perk_claim on public.perk_claims;
create trigger wallet_stale_on_perk_claim
  after insert on public.perk_claims
  for each row execute function public.wallet_flag_stale();

-- ----------------------------------------------------------------------------
-- The tick. Every five minutes, tell the wallet function to notify devices
-- whose pass is flagged. Between events this select matches nothing and the
-- HTTP call is skipped entirely — the guard is in the WHERE, not in the
-- function, so a quiet month costs zero invocations.
-- ----------------------------------------------------------------------------
select cron.unschedule('slutstation-wallet-push')
 where exists (select 1 from cron.job where jobname = 'slutstation-wallet-push');

select cron.schedule(
  'slutstation-wallet-push',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url     := 'https://uwawugvatencvzvvfaeq.supabase.co/functions/v1/wallet/push',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'slutstation_cron_secret')
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
    where exists (select 1 from public.wallet_passes where needs_push);
  $job$
);

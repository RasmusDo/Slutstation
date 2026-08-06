-- ============================================================================
-- SLUTSTATION — the schedule that sends the "you're in" email
--
-- ALREADY APPLIED — 5 August 2026. You do not need to run this.
--
-- The extensions are installed, a freshly generated 64-character secret is in
-- Vault as `slutstation_cron_secret`, the same value is set as the CRON_SECRET
-- secret on the function, and all three jobs below are scheduled and active.
-- The chain was fired by hand to confirm it: the job authenticated to the
-- function and the function replied "SMTP not configured", which is the only
-- remaining gap (the mailbox password — see GO-LIVE.md).
--
-- This file is kept as the record of what was done, and so it can be re-run to
-- rebuild the schedule from scratch. If you do re-run it, replace
-- PUT-YOUR-CRON-SECRET-HERE below with a new random string AND set the same
-- string as the function's CRON_SECRET — they must match, and that shared value
-- is the only thing stopping a stranger from making your mail server send.
--
-- To rotate the secret without touching the schedule, use vault.update_secret
-- (see the note under step 1) and update CRON_SECRET on the function to match.
--
-- The secret goes into Supabase Vault, not into a table, so it is encrypted at
-- rest and does not show up in the admin panel or in a database dump readable
-- by anyone who gets a copy.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- 1. Store the shared secret  (EDIT THE VALUE, then run)
-- ----------------------------------------------------------------------------
select vault.create_secret(
  'PUT-YOUR-CRON-SECRET-HERE',
  'slutstation_cron_secret',
  'Shared secret the member-emails schedule sends back to the Edge Function.'
);

-- Re-running later to change it? Use this instead of create_secret:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'slutstation_cron_secret'),
--     'NEW-VALUE');

-- ----------------------------------------------------------------------------
-- 2. Every five minutes, ask the function to send whatever is due
--
-- Five minutes against a 15-55 minute delay means the check and the email land
-- within a few minutes of each other, which is what a member would expect. The
-- function is idempotent — it only ever picks up people whose email hasn't been
-- sent — so a missed tick costs nothing and a double tick sends nothing twice.
-- ----------------------------------------------------------------------------
select cron.unschedule('slutstation-member-emails')
 where exists (select 1 from cron.job where jobname = 'slutstation-member-emails');

select cron.schedule(
  'slutstation-member-emails',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url     := 'https://uwawugvatencvzvvfaeq.supabase.co/functions/v1/member-emails',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'slutstation_cron_secret')
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $job$
);

-- ----------------------------------------------------------------------------
-- 3. Nightly tidy: flip memberships that have run past a year
-- ----------------------------------------------------------------------------
select cron.unschedule('slutstation-expire-memberships')
 where exists (select 1 from cron.job where jobname = 'slutstation-expire-memberships');

select cron.schedule('slutstation-expire-memberships', '17 4 * * *',
  $job$ select public.expire_lapsed_memberships(); $job$);

-- ----------------------------------------------------------------------------
-- 4. Every ten minutes, hand back ticket stock nobody paid for
-- ----------------------------------------------------------------------------
select cron.unschedule('slutstation-expire-orders')
 where exists (select 1 from cron.job where jobname = 'slutstation-expire-orders');

select cron.schedule('slutstation-expire-orders', '*/10 * * * *',
  $job$ select public.expire_stale_orders(); $job$);

-- ----------------------------------------------------------------------------
-- Checking on it later
--   select jobname, schedule, active from cron.job;
--   select j.jobname, r.status, r.return_message, r.start_time
--     from cron.job_run_details r join cron.job j on j.jobid = r.jobid
--    order by r.start_time desc limit 20;
-- ----------------------------------------------------------------------------

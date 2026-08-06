-- ============================================================================
-- SLUTSTATION — Phase 5: membership runs by calendar year
--
-- Until now, membership was a rolling twelve months from the date eBas last
-- recorded a renewal — so somebody who joined on 14 March was a member until
-- 14 March. That was wrong. Membership runs to the END OF THE CALENDAR YEAR
-- and everybody renews in January, regardless of when they joined. Join in
-- August 2026 and you are a member until 1 January 2027, same as somebody who
-- joined in February.
--
-- This is the normal shape for a Swedish ideell förening: the verksamhetsår is
-- the calendar year, and the medlemsregister is renewed for the year as a whole.
--
-- Run AFTER schema-phase4-approval-and-import.sql.
--
-- NOTE: `expires_on` is the LAST DAY the membership is valid — 31 December.
-- The membership ends when 1 January arrives. Both statements describe the
-- same moment; the column holds the last valid day so date comparisons stay
-- simple and inclusive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. One function that owns the rule
--
-- Everything derives expiry from here — the view, the nightly sweep, the door.
-- If the association ever changes its verksamhetsår, this is the only place
-- that has to know.
-- ----------------------------------------------------------------------------
create or replace function public.membership_expires_on(p_renewed date)
returns date language sql stable security definer set search_path = public as $$
  select case
    -- Optional kindness for people who join right at the end of the year.
    -- Set membership_rollover_from_month to, say, 11 and anybody who joins in
    -- November or December is covered for the whole of the following year too.
    -- Default is 0, which means off: strictly this calendar year, as asked.
    when p_renewed is null then null
    when coalesce(public.setting('membership_rollover_from_month', '0')::int, 0) between 1 and 12
         and extract(month from p_renewed)::int
             >= coalesce(public.setting('membership_rollover_from_month', '0')::int, 0)
      then make_date(extract(year from p_renewed)::int + 1, 12, 31)
    else make_date(extract(year from p_renewed)::int, 12, 31)
  end;
$$;

comment on function public.membership_expires_on(date) is
  'Last day a membership renewed on this date is valid. Calendar year: 31 December of the year it was renewed.';

insert into public.app_settings (key, value, note) values
  ('membership_rollover_from_month', '0',
   'Off by default. Set to a month number (e.g. 11) to give people who join that late a membership covering the following year as well.')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. The green check follows the calendar
--
-- Dropped rather than replaced: `create or replace view` cannot change a
-- column's type or position, and expires_on is being recomputed.
-- ----------------------------------------------------------------------------
drop view if exists public.membership_status;

create view public.membership_status
with (security_invoker = true) as
select
  p.id,
  p.ebas_status,
  p.ebas_renewed_on,
  p.ebas_checked_at,
  p.ebas_message,
  p.approved_at,
  (
    p.ebas_status = 'active'
    and p.ebas_renewed_on is not null
    and current_date <= public.membership_expires_on(p.ebas_renewed_on)
    and p.approved_at is not null
    and p.approved_at <= now()
  ) as is_active_member,
  (
    p.ebas_status = 'active'
    and p.approved_at is not null
    and p.approved_at > now()
  ) as pending_approval,
  public.membership_expires_on(p.ebas_renewed_on) as expires_on,
  -- Handy for the account page: how much of the year is left to run.
  case
    when p.ebas_renewed_on is null then null
    else greatest(public.membership_expires_on(p.ebas_renewed_on) - current_date, 0)
  end as days_left
from public.profiles p;

comment on view public.membership_status is
  'Green check = is_active_member. Membership runs to 31 December of the year it was registered; everybody renews in January. The check itself is released 15-55 minutes after registration, and pending_approval is true in between.';

grant select on public.membership_status to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. The nightly sweep uses the same rule
--
-- The view is already time-correct on its own, so this only tidies the stored
-- column — but on 1 January it is what makes every dashboard say "expired"
-- rather than leaving stale "active" rows around.
-- ----------------------------------------------------------------------------
create or replace function public.expire_lapsed_memberships()
returns integer language sql security definer set search_path = public as $$
  with updated as (
    update public.profiles
       set ebas_status = 'expired'
     where ebas_status = 'active'
       and (ebas_renewed_on is null
            or current_date > public.membership_expires_on(ebas_renewed_on))
    returning 1
  )
  select count(*)::int from updated;
$$;

-- ----------------------------------------------------------------------------
-- 4. Renewing must not re-trigger the approval wait
--
-- The 15-55 minute delay is for new applications. Somebody renewing in January
-- has already been through it, so approved_at stays put and their check comes
-- straight back. The trigger only fires when approved_at is null, so this is
-- already true — this comment exists so nobody "fixes" it later by clearing
-- approved_at on renewal.
-- ----------------------------------------------------------------------------

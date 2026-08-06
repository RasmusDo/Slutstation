-- ============================================================================
-- SLUTSTATION, phase 6
--
-- Three things, all of which exist because the database already knew more
-- about a member than the site ever told them:
--
--   1. member_events    an append-only log, so "you reached Tier 3" has a date
--                       attached to it instead of being recomputed from a count
--                       every time anyone looks
--   2. my_history()     a member's own nights, which nobody but us can show them
--   3. weekly_digest()  a Monday summary to ourselves, so problems surface
--                       without anyone remembering to go and look
--
-- Plus one column: notify_lastminute, splitting "email me about events" into
-- the two things it was actually doing.
--
-- Safe to re-run. Every statement is idempotent, and the backfill at the end
-- only inserts rows that are not already there.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. The announce switch, written down
--
-- These two columns were applied straight to the live database when the
-- September event went on hold, and never made it into a file. Repeated here
-- so a rebuild from these scripts produces the same database. Both guards are
-- no-ops against the live one.
-- ----------------------------------------------------------------------------
alter table public.events add column if not exists announced   boolean not null default false;
alter table public.events add column if not exists announce_at timestamptz;

comment on column public.events.announced is
  'Nothing about an event is public until this is true. Billetto cannot be polled for it (their WAF blocks datacenter IPs), so this is the switch.';

-- ----------------------------------------------------------------------------
-- 1. Split the email preference
--
-- One tick asking about "events" was covering two very different messages: a
-- new event going on sale, which people want weeks ahead, and thirty tickets
-- released at 4pm on the day, which is either welcome or an intrusion. Keeping
-- them separate raises opt-in on the first and cuts unsubscribes on the second.
-- Existing members default to true so nobody silently loses mail they agreed to.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists notify_lastminute boolean not null default true;

comment on column public.profiles.notify_lastminute is
  'Same-day ticket releases. marketing_consent covers new events announced ahead of time.';

-- ----------------------------------------------------------------------------
-- 2. member_events, append-only
--
-- Current state is cheap to compute and impossible to ask questions about.
-- member_stats can tell you somebody is Tier 3; it cannot tell you when they
-- got there, and every support question is about how somebody got somewhere.
-- Writing the transition down at the moment it happens is a small table now
-- and an unpleasant migration later.
--
-- No updates and no deletes: RLS grants select only, and nothing here is
-- written by a member. The triggers below are the only writers.
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.member_event_kind as enum
    ('joined', 'approved', 'attended', 'tier_up', 'referral_qualified');
exception when duplicate_object then null; end $$;

create table if not exists public.member_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         public.member_event_kind not null,
  event_id     uuid references public.events (id) on delete set null,
  tier         smallint,
  occurred_at  timestamptz not null default now(),
  meta         jsonb
);

create index if not exists member_events_user_idx
  on public.member_events (user_id, occurred_at desc);

-- One tier_up row per member per tier, forever. Without this a re-import or a
-- removed-then-readded attendance would log the same promotion twice.
create unique index if not exists member_events_tier_once
  on public.member_events (user_id, tier)
  where kind = 'tier_up';

comment on table public.member_events is
  'Append-only history. Written by trigger only; members read their own rows, admins read all.';

-- ----------------------------------------------------------------------------
-- 3. The triggers that write it
-- ----------------------------------------------------------------------------

-- A member's tier, counted the same way member_stats counts it. Kept as its
-- own function so the trigger and the view can never drift apart.
create or replace function public.tier_of(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select public.tier_for((
    select count(*)::int from public.attendance a
     where a.user_id = p_user
       and a.checked_in_at > now() - (public.setting('tier_window_months','24') || ' months')::interval
  ));
$$;

-- Attendance: log the night, then log the promotion if that night caused one.
create or replace function public.log_attendance_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_tier int;
begin
  insert into public.member_events (user_id, kind, event_id, occurred_at, meta)
  values (new.user_id, 'attended', new.event_id, new.checked_in_at,
          jsonb_build_object('source', new.source));

  new_tier := public.tier_of(new.user_id);
  if new_tier > 1 then
    insert into public.member_events (user_id, kind, event_id, tier, occurred_at)
    values (new.user_id, 'tier_up', new.event_id, new_tier, new.checked_in_at)
    on conflict do nothing;
  end if;

  return new;
end $$;

drop trigger if exists attendance_history_hook on public.attendance;
create trigger attendance_history_hook
  after insert on public.attendance
  for each row execute function public.log_attendance_event();

-- The attendance row can be removed (a mis-scan, an undone import). The
-- history of it should go with it, or the account page shows a night they were
-- never at. The tier_up row stays: they did reach it, on that date.
create or replace function public.unlog_attendance_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.member_events
   where user_id = old.user_id and event_id = old.event_id and kind = 'attended';
  return old;
end $$;

drop trigger if exists attendance_history_unhook on public.attendance;
create trigger attendance_history_unhook
  after delete on public.attendance
  for each row execute function public.unlog_attendance_event();

-- Membership approval. Fires on the transition only, so a nightly re-verify
-- that leaves the status alone writes nothing.
create or replace function public.log_membership_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.member_events (user_id, kind, occurred_at)
    values (new.id, 'joined', new.created_at);
  elsif new.ebas_status is distinct from old.ebas_status and new.ebas_status = 'active' then
    insert into public.member_events (user_id, kind, occurred_at)
    values (new.id, 'approved', now());
  end if;
  return new;
end $$;

drop trigger if exists profiles_history_hook on public.profiles;
create trigger profiles_history_hook
  after insert or update of ebas_status on public.profiles
  for each row execute function public.log_membership_event();

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------
alter table public.member_events enable row level security;

drop policy if exists member_events_read_own on public.member_events;
create policy member_events_read_own on public.member_events
  for select using (user_id = auth.uid() or public.is_admin());

-- No insert, update or delete policy on purpose. Only the SECURITY DEFINER
-- triggers above write here, which means a member cannot invent a night.

-- ----------------------------------------------------------------------------
-- 5. What a member sees: their own nights, newest first
--
-- Returns the event, not just the date, because "Slutstation VII at Nalen" is
-- a memory and "2025-11-08" is a row in a table.
-- ----------------------------------------------------------------------------
create or replace function public.my_history()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'nights', coalesce((
      select json_agg(row_to_json(n) order by n.checked_in_at desc) from (
        select e.id as event_id, e.name, e.venue, e.starts_at, a.checked_in_at
          from public.attendance a
          join public.events e on e.id = a.event_id
         where a.user_id = auth.uid()
         order by a.checked_in_at desc
         limit 40) n), '[]'::json),
    'milestones', coalesce((
      select json_agg(row_to_json(m) order by m.occurred_at desc) from (
        select me.kind::text, me.tier, me.occurred_at, e.name as event_name
          from public.member_events me
          left join public.events e on e.id = me.event_id
         where me.user_id = auth.uid()
           and me.kind in ('joined', 'approved', 'tier_up', 'referral_qualified')
         order by me.occurred_at desc
         limit 20) m), '[]'::json)
  );
$$;

grant execute on function public.my_history() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. What an admin sees: one member's whole story, in order
--
-- Deliberately separate from admin_user_detail rather than bolted onto it.
-- That function is called on every row click and this one is only needed when
-- somebody actually opens the timeline.
-- ----------------------------------------------------------------------------
create or replace function public.admin_member_timeline(p_user uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (
    select coalesce(json_agg(row_to_json(x) order by x.occurred_at desc), '[]'::json) from (
      select me.kind::text, me.tier, me.occurred_at, me.meta,
             e.name as event_name, e.venue
        from public.member_events me
        left join public.events e on e.id = me.event_id
       where me.user_id = p_user
       order by me.occurred_at desc
       limit 200) x);
end $$;

-- ----------------------------------------------------------------------------
-- 7. The weekly digest
--
-- Everything that changed in the last seven days, plus anything that looks
-- wrong. Read by the member-emails function on a Monday and sent to whoever is
-- listed in app_settings.digest_to.
--
-- The failures block is the point of the whole thing. Members stuck pending,
-- welcome emails that never sent and eBas errors are all currently invisible
-- until somebody complains.
-- ----------------------------------------------------------------------------
create or replace function public.weekly_digest()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'generated_at', now(),
    'new_members', (
      select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'approved', (
      select count(*) from public.member_events
       where kind = 'approved' and occurred_at > now() - interval '7 days'),
    'total_active', (
      select count(*) from public.profiles where ebas_status = 'active'),
    'attendance', (
      select count(*) from public.attendance where checked_in_at > now() - interval '7 days'),
    'next_event', (
      select row_to_json(e) from (
        select id, name, venue, starts_at, announced
          from public.events
         where starts_at > now()
         order by starts_at asc limit 1) e),
    -- In the 15-55 minute window between eBas saying yes and the green check
    -- being released. A healthy number here is small and always changing.
    'pending_approval', (
      select count(*) from public.profiles
       where ebas_status = 'active' and approved_at > now()),
    -- Signed up, never reached eBas. Almost always a missing address or birth
    -- date, which means they are stuck on a form and do not know it.
    'stuck_unverified', (
      select count(*) from public.profiles
       where ebas_status = 'unverified' and created_at < now() - interval '3 days'),
    'ebas_failed', (
      select count(*) from public.profiles where ebas_status = 'failed'),
    -- Approved, past their release time, and the welcome email still has not
    -- gone. Non-zero means the mail chain is broken.
    'welcome_unsent', (
      select count(*) from public.profiles p
       where p.ebas_status = 'active'
         and p.approved_at is not null and p.approved_at <= now()
         and p.approval_email_sent_at is null)
  );
$$;

revoke execute on function public.weekly_digest() from public, anon, authenticated;
grant  execute on function public.weekly_digest() to service_role;

-- ----------------------------------------------------------------------------
-- 8. Backfill
--
-- Everything that already happened, written into the log once. The unique
-- index on tier_up and the not-exists guards make this safe to run again.
-- ----------------------------------------------------------------------------
insert into public.member_events (user_id, kind, occurred_at)
select p.id, 'joined', p.created_at
  from public.profiles p
 where not exists (
   select 1 from public.member_events me where me.user_id = p.id and me.kind = 'joined');

insert into public.member_events (user_id, kind, event_id, occurred_at, meta)
select a.user_id, 'attended', a.event_id, a.checked_in_at, jsonb_build_object('source', a.source)
  from public.attendance a
 where not exists (
   select 1 from public.member_events me
    where me.user_id = a.user_id and me.event_id = a.event_id and me.kind = 'attended');

-- Current tier, dated to the night that earned it. Approximate for history
-- that predates this table, exact from here on.
insert into public.member_events (user_id, kind, tier, occurred_at)
select s.id, 'tier_up', s.tier, coalesce(s.last_attended_at, now())
  from public.member_stats s
 where s.tier > 1
on conflict do nothing;

insert into public.member_events (user_id, kind, occurred_at)
select p.id, 'approved', coalesce(p.ebas_checked_at, p.updated_at, p.created_at)
  from public.profiles p
 where p.ebas_status = 'active'
   and not exists (
     select 1 from public.member_events me where me.user_id = p.id and me.kind = 'approved');

-- ----------------------------------------------------------------------------
-- 9. The Monday schedule
--
-- Its own Edge Function (supabase/functions/weekly-digest) rather than another
-- branch inside member-emails: that one runs every five minutes and sends the
-- email people are actually waiting for, and nothing about a summary to
-- ourselves should ever be able to break it.
--
-- 07:00 UTC is 09:00 in Stockholm in summer and 08:00 in winter. Close enough
-- for a thing you read with coffee.
-- ----------------------------------------------------------------------------
insert into public.app_settings (key, value, note) values
  ('digest_to', 'info@slutstation.se',
   'Who gets the Monday digest. Comma-separated. Empty means the digest does not send.')
on conflict (key) do nothing;

select cron.unschedule('slutstation-weekly-digest')
 where exists (select 1 from cron.job where jobname = 'slutstation-weekly-digest');

select cron.schedule(
  'slutstation-weekly-digest',
  '0 7 * * 1',
  $job$
    select net.http_post(
      url     := 'https://uwawugvatencvzvvfaeq.supabase.co/functions/v1/weekly-digest',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'slutstation_cron_secret')
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);

-- ----------------------------------------------------------------------------
-- 10. The import returns a receipt, not a status code
--
-- It already told you four numbers. A bulk write across other people's
-- accounts is only trustworthy if you can see exactly what it did and to
-- whom, so it now also returns who was recorded, by name.
--
-- The insert and the names come from one statement: a CTE can be referenced
-- more than once, so `ins` gives both the count and the set of ids without a
-- temp table (which would break if the function were ever called twice in one
-- transaction).
-- ----------------------------------------------------------------------------
create or replace function public.admin_import_attendance(
  p_event uuid, p_emails text[], p_source text default 'billetto_import')
returns json language plpgsql security definer set search_path = public as $$
declare
  cleaned  text[];
  matched  int  := 0;
  added    int  := 0;
  recorded json := '[]'::json;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.events where id = p_event) then
    raise exception 'Unknown event';
  end if;

  select array_agg(distinct lower(trim(e)))
    into cleaned
    from unnest(coalesce(p_emails, '{}'::text[])) e
   where coalesce(trim(e), '') <> '';

  if cleaned is null or array_length(cleaned, 1) is null then
    raise exception 'No email addresses found in that file';
  end if;

  with hits as (
    select p.id,
           lower(p.email) as email,
           nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as name
      from public.profiles p
     where lower(p.email) = any(cleaned)
  ), ins as (
    insert into public.attendance (user_id, event_id, checked_in_by, source)
    select h.id, p_event, auth.uid(), coalesce(nullif(trim(p_source), ''), 'billetto_import')
      from hits h
    on conflict (user_id, event_id) do nothing
    returning user_id
  )
  select
    (select count(*)::int from hits),
    (select count(*)::int from ins),
    (select coalesce(json_agg(json_build_object('name', h.name, 'email', h.email)
                              order by h.name nulls last, h.email), '[]'::json)
       from hits h where h.id in (select user_id from ins))
  into matched, added, recorded;

  return json_build_object(
    'submitted', array_length(cleaned, 1),
    'matched',   matched,
    'added',     added,
    'already',   matched - added,
    'recorded',  recorded,
    'unmatched', (
      select coalesce(json_agg(e order by e), '[]'::json)
        from unnest(cleaned) e
       where not exists (select 1 from public.profiles p where lower(p.email) = e))
  );
end $$;

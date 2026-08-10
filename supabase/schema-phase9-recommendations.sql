-- ============================================================================
-- SLUTSTATION, phase 9 — the recommendations from IDEAS.md
--
-- Four things, none of them big:
--
--   1. The announcement email queue. The announce switch already knows the
--      exact moment an event becomes public; this is what makes that moment
--      reach an inbox instead of only a web page.
--   2. A dry run on the attendance import.
--   3. The audit log's read side.
--   4. A roster a door phone can hold when the signal drops.
--
-- Items 1-3 were applied live on 6 August 2026. Item 4 is at the bottom and is
-- marked NOT YET APPLIED — see the note above it.
--
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The announcement email
--
-- One row per member per event, so the send is exactly-once in the same way
-- the welcome email is: the queue is "everyone who opted in and is not in this
-- table", and marking happens only after the mail server has accepted it. A
-- missed run costs nothing and a double run sends nothing twice.
--
-- The queue is deliberately keyed on the SOONEST announced future event rather
-- than "all announced events". Two events announced in the same week should
-- not produce two emails in the same hour, and the second one comes round on
-- the next tick once the first is drained.
-- ----------------------------------------------------------------------------
create table if not exists public.event_mail_sent (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.event_mail_sent enable row level security;

drop policy if exists event_mail_sent_admin on public.event_mail_sent;
create policy event_mail_sent_admin on public.event_mail_sent
  for select using (public.is_admin());

create or replace function public.members_awaiting_announcement(p_limit int default 50)
returns table (event_id uuid, event_name text, venue text, starts_at timestamptz,
               info text, user_id uuid, email text, first_name text)
language sql security definer set search_path = public as $$
  with ev as (
    select e.id, e.name, e.venue, e.starts_at, e.info
      from public.events e
     where e.announced and e.starts_at > now()
     order by e.starts_at asc
     limit 1
  )
  select ev.id, ev.name, ev.venue, ev.starts_at, ev.info, p.id, p.email, p.first_name
    from ev
    join public.profiles p on p.marketing_consent
   where p.ebas_status in ('active','expired','unverified')
     and not exists (select 1 from public.event_mail_sent s
                      where s.event_id = ev.id and s.user_id = p.id)
   order by p.created_at
   limit greatest(coalesce(p_limit, 50), 1);
$$;

create or replace function public.mark_announcement_sent(p_event uuid, p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.event_mail_sent (event_id, user_id)
  select p_event, unnest(p_ids)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Service role only. This is the second place email addresses leave the
-- database in bulk, and no browser token should ever be able to ask for it.
revoke execute on function public.members_awaiting_announcement(int)  from public, anon, authenticated;
revoke execute on function public.mark_announcement_sent(uuid, uuid[]) from public, anon, authenticated;
grant  execute on function public.members_awaiting_announcement(int)   to service_role;
grant  execute on function public.mark_announcement_sent(uuid, uuid[]) to service_role;

-- The schedule. Every ten minutes rather than every five: Loopia's ceiling is
-- 200 an hour and a batch is 40, so this uses at most 240 an hour of headroom
-- and in practice drains the whole list in one or two runs. Nothing is sent
-- until an event is actually announced — proved by firing it by hand against
-- an un-announced calendar, which returned {"ok":true,"sent":0}.
select cron.unschedule('slutstation-event-emails')
 where exists (select 1 from cron.job where jobname = 'slutstation-event-emails');

select cron.schedule(
  'slutstation-event-emails',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url     := 'https://uwawugvatencvzvvfaeq.supabase.co/functions/v1/event-emails',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret
                                       from vault.decrypted_secrets
                                      where name = 'slutstation_cron_secret')
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);

-- ----------------------------------------------------------------------------
-- 2. The import, with a dry run
--
-- It already told you what it did. Now it will tell you what it would do,
-- before it does it, on a file nobody has checked. Same arithmetic, nothing
-- written, and the panel renders the two results identically on purpose: what
-- you checked is what you get.
--
-- NOTE: the three-argument version is dropped at the end. Leaving both would
-- give PostgREST an ambiguous overload to resolve.
-- ----------------------------------------------------------------------------
create or replace function public.admin_import_attendance(
  p_event uuid, p_emails text[], p_source text default 'billetto_import',
  p_dry_run boolean default false)
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

  select array_agg(distinct lower(trim(e))) into cleaned
    from unnest(coalesce(p_emails, '{}'::text[])) e
   where coalesce(trim(e), '') <> '';
  if cleaned is null or array_length(cleaned, 1) is null then
    raise exception 'No email addresses found in that file';
  end if;

  if p_dry_run then
    select
      (select count(*)::int from public.profiles p where lower(p.email) = any(cleaned)),
      (select count(*)::int from public.profiles p
         where lower(p.email) = any(cleaned)
           and not exists (select 1 from public.attendance a
                            where a.user_id = p.id and a.event_id = p_event)),
      (select coalesce(json_agg(json_build_object('name',
                nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
                'email', lower(p.email)) order by p.first_name nulls last, p.email), '[]'::json)
         from public.profiles p
        where lower(p.email) = any(cleaned)
          and not exists (select 1 from public.attendance a
                           where a.user_id = p.id and a.event_id = p_event))
    into matched, added, recorded;
  else
    with hits as (
      select p.id, lower(p.email) as email,
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

    perform public.log_admin_action('attendance_imported', null,
              jsonb_build_object('event', p_event, 'submitted', array_length(cleaned,1),
                                 'matched', matched, 'added', added));
  end if;

  return json_build_object(
    'dry_run',   p_dry_run,
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

drop function if exists public.admin_import_attendance(uuid, text[], text);

-- ----------------------------------------------------------------------------
-- 3. Reading the audit log
-- ----------------------------------------------------------------------------
create or replace function public.admin_audit(p_limit int default 100)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select coalesce(json_agg(row_to_json(x) order by x.occurred_at desc), '[]'::json) from (
    select l.action, l.meta, l.occurred_at,
           nullif(trim(coalesce(a.first_name,'') || ' ' || coalesce(a.last_name,'')), '') as actor,
           nullif(trim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,'')), '') as target
      from public.admin_actions l
      left join public.profiles a on a.id = l.actor_id
      left join public.profiles t on t.id = l.target_id
     order by l.occurred_at desc
     limit greatest(coalesce(p_limit, 100), 1)) x);
end $$;

grant execute on function public.admin_audit(int) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The offline door roster        *** SUPERSEDED — do not apply this one ***
--
-- A narrowed version now lives in schema-phase16-offline-door.sql: tonight's
-- ticket-holders and checked-in members, falling back to active members only
-- on a Billetto-sold night, instead of the whole register. Apply that file,
-- not the block below, which is kept only to show what was decided against.
--
-- Check-ins already queue offline and send themselves when the signal comes
-- back. The LOOKUP does not: it needs the network, so the moment the signal
-- drops, the fallback for a cracked screen or a dead phone stops working —
-- which is precisely when it is needed. An open-air event in a forest is the
-- worst case and the one coming up.
--
-- The fix is to let a door phone hold the list. There is a real trade-off in
-- that, and it is Axel's call rather than mine, which is why this is the one
-- statement in these files that has not been run:
--
--   * It is no WIDER than staff_lookup already returns — name, membership,
--     tier. No email, no phone, no address, no birth date.
--   * It is gated on being on shift for an event RIGHT NOW and on holding the
--     door tag, so it cannot be pulled the week before or the week after.
--   * But it is the whole membership in one response, and it lands in a
--     browser on a volunteer's phone. A lost phone is then a lost list of
--     names, where before it was a lost ability to search.
--
-- The front end treats a missing function as "offline search unavailable" and
-- carries on, so applying this is genuinely optional. Run it if you want the
-- door to work without signal; leave it if you would rather the list never
-- leaves the server.
-- ----------------------------------------------------------------------------
-- create or replace function public.staff_roster()
-- returns json language plpgsql stable security definer set search_path = public as $$
-- declare ev uuid;
-- begin
--   ev := public.active_staff_event();
--   if ev is null then raise exception 'Not on shift'; end if;
--   if public.active_staff_role() is distinct from 'door' then
--     raise exception 'Door staff only';
--   end if;
--
--   return (select coalesce(json_agg(row_to_json(x) order by x.name), '[]'::json) from (
--     select p.id as user_id,
--            nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as name,
--            coalesce(m.is_active_member, false) as member_ok,
--            coalesce(s.tier, 1) as tier,
--            exists (select 1 from public.attendance a
--                     where a.user_id = p.id and a.event_id = ev) as checked_in
--       from public.profiles p
--       left join public.membership_status m on m.id = p.id
--       left join public.member_stats s on s.id = p.id
--      where nullif(trim(coalesce(p.first_name,'') || coalesce(p.last_name,'')), '') is not null
--   ) x);
-- end $$;
--
-- grant execute on function public.staff_roster() to authenticated;

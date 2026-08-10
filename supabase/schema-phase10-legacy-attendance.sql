-- ============================================================================
-- SLUTSTATION, phase 10 — counting the nights that happened before the site
--
-- Five events sold through Billetto before any of this existed. 1205 people
-- bought tickets; almost none of them have an account. The point of this file
-- is that when one of them signs up, the nights they already came to are
-- waiting for them.
--
-- THE SHAPE OF THE PROBLEM
--
-- `attendance` is keyed on a user_id, and a user_id is a row in `profiles`.
-- These people have no profile, so their nights cannot be stored as attendance
-- yet. They need somewhere to wait, keyed on the only thing we know about
-- them and the only thing that will still be true when they sign up: their
-- email address.
--
-- WHAT IS AND IS NOT STORED
--
-- Not the address. A SHA-256 of a per-project salt plus the lowercased
-- address. Signup hashes the new address the same way and finds the same row,
-- so matching works exactly as well — but the database holds nothing readable
-- about 1205 people who never asked to be in it. An admin can still answer
-- "why didn't my nights count?" for one named person by hashing that one
-- address; nobody can browse the list, export it, or mail it.
--
-- The salt lives in Vault, never in this file and never in the repo. Without
-- it the hashes are not reversible by dictionary attack, which is the whole
-- reason it is salted rather than a plain hash of the address.
--
-- ONE NIGHT PER PERSON PER EVENT
--
-- Buyers bought 1.3 to 1.8 tickets each and only the buyer's address is
-- recorded, so roughly a third of the people in those rooms are not in this
-- data at all and never can be. Someone who bought six tickets for friends
-- gets one night, the same as everyone else: the tier measures how often you
-- turn up, not how much you spent. The primary key enforces it.
--
-- WHAT COUNTS AS TURNING UP
--
-- These exports are sales, not door scans — Billetto kept no check-in data for
-- these nights. A paid, uncancelled ticket counts. Every row lands with
-- source = 'billetto_legacy', so if door data ever turns up, correcting this
-- is a delete on one source value rather than an archaeology project.
--
-- Cancelled tickets (Active = false in the export, 40 of them) are not
-- included; that filtering happens before the list reaches this function.
--
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. The salt
--
-- Generated once, here, if it does not already exist. Re-running this file
-- must never mint a second salt: every hash already stored would stop matching
-- and every unclaimed night would be orphaned silently. Hence the guard.
-- ----------------------------------------------------------------------------
-- pgcrypto lives in the `extensions` schema on Supabase, and every function
-- below pins search_path = public for safety. So digest() and gen_random_bytes()
-- are schema-qualified rather than trusted to resolve. Unqualified, this file
-- fails on its very first statement with "function digest(text, unknown) does
-- not exist", which is a confusing way to learn about search_path.
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'slutstation_legacy_salt') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
                                'slutstation_legacy_salt');
  end if;
end $$;

create or replace function public.legacy_email_hash(p_email text)
returns text language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets
   where name = 'slutstation_legacy_salt';
  if s is null then raise exception 'legacy salt missing'; end if;
  -- lower + trim, because 'Simon.Brunn10@gmail.com' and 'simon.brunn10@gmail.com'
  -- are one person, and the export contains both spellings.
  return encode(extensions.digest(s || lower(trim(p_email)), 'sha256'), 'hex');
end $$;

revoke execute on function public.legacy_email_hash(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. Where the nights wait
-- ----------------------------------------------------------------------------
create table if not exists public.legacy_attendance (
  email_hash   text not null,
  event_id     uuid not null references public.events (id) on delete cascade,
  tickets      integer not null default 1,   -- kept for the record, never for tier
  imported_at  timestamptz not null default now(),
  primary key (email_hash, event_id)
);

alter table public.legacy_attendance enable row level security;
-- No policy, deliberately: not selectable, not insertable, not updatable by any
-- browser token. Everything below is SECURITY DEFINER and goes through a
-- function that decides what may be seen.

-- ----------------------------------------------------------------------------
-- 2. The import
--
-- Takes the raw addresses as an argument and hashes them here, so the plain
-- addresses exist for the length of one statement and are never written down.
--
-- Anyone who ALREADY has an account skips the waiting room entirely and gets a
-- real attendance row immediately — that is the "existing accounts too" half of
-- the decision, and it costs nothing to do it in the same pass.
--
-- checked_in_at is the EVENT'S OWN start time, not now(). This is the single
-- most important line in the file: tier counts nights inside a rolling
-- 24-month window, so stamping a 2024 night with today's date would both
-- overstate it now and stop it ever ageing out.
-- ----------------------------------------------------------------------------
create or replace function public.admin_import_legacy(
  p_event uuid, p_emails text[], p_dry_run boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  cleaned  text[];
  ev_start timestamptz;
  matched  int := 0;
  waiting  int := 0;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  select starts_at into ev_start from public.events where id = p_event;
  if not found then raise exception 'Unknown event'; end if;
  if ev_start is null then raise exception 'That event has no start time; set one first'; end if;
  if ev_start > now() then
    raise exception 'That event has not happened yet — this is for past nights only';
  end if;

  select array_agg(distinct lower(trim(e))) into cleaned
    from unnest(coalesce(p_emails, '{}'::text[])) e
   where coalesce(trim(e), '') <> '' and position('@' in e) > 1;
  if cleaned is null then raise exception 'No usable email addresses in that list'; end if;

  if p_dry_run then
    select
      (select count(*)::int from public.profiles p where lower(p.email) = any(cleaned)),
      (select count(*)::int from unnest(cleaned) e
        where not exists (select 1 from public.profiles p where lower(p.email) = e))
    into matched, waiting;
  else
    -- People we already know: straight into attendance, dated to the event.
    with hits as (
      select p.id from public.profiles p where lower(p.email) = any(cleaned)
    ), ins as (
      insert into public.attendance (user_id, event_id, checked_in_at, checked_in_by, source)
      select h.id, p_event, ev_start, auth.uid(), 'billetto_legacy' from hits h
      on conflict (user_id, event_id) do nothing
      returning 1
    )
    select (select count(*)::int from ins) into matched;

    -- Everyone else: a hash, waiting for the day they sign up.
    with strangers as (
      select e from unnest(cleaned) e
       where not exists (select 1 from public.profiles p where lower(p.email) = e)
    ), ins2 as (
      insert into public.legacy_attendance (email_hash, event_id)
      select public.legacy_email_hash(s.e), p_event from strangers s
      on conflict (email_hash, event_id) do nothing
      returning 1
    )
    select (select count(*)::int from ins2) into waiting;

    perform public.log_admin_action('legacy_attendance_imported', null,
      jsonb_build_object('event', p_event, 'submitted', array_length(cleaned,1),
                         'credited_now', matched, 'left_waiting', waiting));
  end if;

  return json_build_object(
    'dry_run', p_dry_run,
    'submitted', array_length(cleaned, 1),
    'credited_now', matched,      -- had an account already
    'left_waiting', waiting,      -- will be credited when they sign up
    'event_dated', ev_start
  );
end $$;

grant execute on function public.admin_import_legacy(uuid, text[], boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The claim
--
-- Called by the account page. Idempotent, cheap, and safe to call on every
-- load: once a row is claimed it is deleted, so the second call finds nothing.
--
-- Deleting rather than marking is the point. The moment the night becomes a
-- real attendance row it is attached to a real consenting member, and the
-- hash of their address has no further purpose. Keeping it would be keeping a
-- record of someone for no reason.
--
-- THE SECURITY LINE IS email_confirmed_at. Without it, anyone could sign up
-- with somebody else's address and inherit their history before the real owner
-- ever saw the confirmation mail. Supabase does not hand out a session until
-- the address is confirmed, so this is belt and braces — but it is the kind of
-- belt worth wearing, because the whole function is "give me the nights that
-- belong to this address".
-- ----------------------------------------------------------------------------
create or replace function public.claim_legacy_attendance()
returns integer language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  addr      text;
  confirmed timestamptz;
  h         text;
  n         int := 0;
begin
  if uid is null then return 0; end if;

  select u.email, u.email_confirmed_at into addr, confirmed
    from auth.users u where u.id = uid;
  if addr is null or confirmed is null then return 0; end if;

  h := public.legacy_email_hash(addr);

  with mine as (
    select l.event_id from public.legacy_attendance l where l.email_hash = h
  ), ins as (
    insert into public.attendance (user_id, event_id, checked_in_at, checked_in_by, source)
    select uid, m.event_id, e.starts_at, null, 'billetto_legacy'
      from mine m join public.events e on e.id = m.event_id
    on conflict (user_id, event_id) do nothing
    returning 1
  )
  select (select count(*)::int from ins) into n;

  delete from public.legacy_attendance where email_hash = h;
  return n;
end $$;

grant execute on function public.claim_legacy_attendance() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Reading it back
--
-- How many nights are still waiting, per event. Counts only — there is nothing
-- readable in that table to show, which is the whole design.
-- ----------------------------------------------------------------------------
create or replace function public.admin_legacy_pending()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select coalesce(json_agg(row_to_json(x) order by x.starts_at), '[]'::json) from (
    select e.name, e.starts_at, count(l.*)::int as still_waiting
      from public.events e
      join public.legacy_attendance l on l.event_id = e.id
     group by e.id, e.name, e.starts_at) x);
end $$;

grant execute on function public.admin_legacy_pending() to authenticated;

-- One address, for answering "why didn't my nights count?" about a specific
-- person who has asked. Deliberately one at a time and admin-only: this is a
-- support tool, not a way to test the list against a file of addresses.
create or replace function public.admin_legacy_lookup(p_email text)
returns json language plpgsql stable security definer set search_path = public as $$
declare h text;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  h := public.legacy_email_hash(p_email);
  perform public.log_admin_action('legacy_lookup', null,
    jsonb_build_object('for', lower(trim(p_email))));
  return (select coalesce(json_agg(row_to_json(x) order by x.starts_at), '[]'::json) from (
    select e.name, e.starts_at from public.legacy_attendance l
      join public.events e on e.id = l.event_id
     where l.email_hash = h) x);
end $$;

grant execute on function public.admin_legacy_lookup(text) to authenticated;

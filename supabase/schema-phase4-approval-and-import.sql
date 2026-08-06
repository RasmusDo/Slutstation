-- ============================================================================
-- SLUTSTATION — Phase 4
--   1. The green check arrives 15–55 minutes after email confirmation, not
--      instantly, and an email goes out when it does.
--   2. Attendance can be imported from a Billetto export, so the tier system
--      works for the 12 September open air without anyone scanning a QR code.
--
-- Run AFTER schema-phase3b-terms-and-float.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Two new columns and the settings that drive the delay
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists approved_at             timestamptz;
alter table public.profiles add column if not exists approval_email_sent_at  timestamptz;

create index if not exists profiles_approval_due_idx
  on public.profiles (approved_at)
  where approval_email_sent_at is null;

insert into public.app_settings (key, value, note) values
  ('approval_delay_min_minutes', '15', 'Earliest the green check can appear after eBas registration succeeds.'),
  ('approval_delay_max_minutes', '55', 'Latest. A random point in this window is picked per member.')
on conflict (key) do nothing;

-- Nobody who is already a member should suddenly go back to pending.
update public.profiles
   set approved_at = coalesce(ebas_checked_at, created_at)
 where approved_at is null
   and ebas_status in ('active', 'expired');

-- ----------------------------------------------------------------------------
-- 2. Pick the moment
--
-- A trigger, not application code, so it fires no matter which path made the
-- membership active — signup, the "Register membership" button, a renewal, or
-- an admin fixing something by hand.
--
-- The name matters. BEFORE triggers run in alphabetical order and this one has
-- to see the FINAL value of ebas_status, after profiles_protect_ebas has had
-- its say. profiles_zz_approval sorts last.
-- ----------------------------------------------------------------------------
create or replace function public.schedule_membership_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lo int := coalesce(public.setting('approval_delay_min_minutes','15')::int, 15);
  hi int := coalesce(public.setting('approval_delay_max_minutes','55')::int, 55);
begin
  if new.ebas_status = 'active' and new.approved_at is null then
    if hi < lo then hi := lo; end if;
    new.approved_at := now() + make_interval(mins => lo + floor(random() * (hi - lo + 1))::int);
  end if;
  return new;
end $$;

drop trigger if exists profiles_zz_approval on public.profiles;
create trigger profiles_zz_approval
  before insert or update on public.profiles
  for each row execute function public.schedule_membership_approval();

-- ----------------------------------------------------------------------------
-- 3. The green check now waits
--
-- is_active_member is what the account page, the door and the ticket gate all
-- read, so putting the delay here means it applies everywhere at once and a
-- member cannot get ahead of it by reloading or calling the API directly.
-- ----------------------------------------------------------------------------
-- Dropped rather than replaced: `create or replace view` can only append
-- columns at the end, and approved_at/pending_approval belong next to the
-- status they qualify. Nothing else depends on this view.
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
    and p.ebas_renewed_on > (current_date - interval '1 year')
    and p.approved_at is not null
    and p.approved_at <= now()
  ) as is_active_member,
  (
    p.ebas_status = 'active'
    and p.approved_at is not null
    and p.approved_at > now()
  ) as pending_approval,
  case
    when p.ebas_renewed_on is not null
    then (p.ebas_renewed_on + interval '1 year')::date
  end as expires_on
from public.profiles p;

comment on view public.membership_status is
  'Green check = is_active_member. Registration in eBas is instant; the check is released 15-55 minutes later, and pending_approval is true in between.';

-- Re-granted explicitly, because dropping the view dropped its privileges.
grant select on public.membership_status to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Who needs the "you're in" email
--
-- Service role only — this is the one place email addresses leave the database
-- in bulk, and no browser token should ever be able to ask for that list.
-- ----------------------------------------------------------------------------
create or replace function public.members_awaiting_welcome(p_limit int default 50)
returns table (id uuid, email text, first_name text)
language sql security definer set search_path = public as $$
  select p.id, p.email, p.first_name
    from public.profiles p
   where p.ebas_status = 'active'
     and p.approved_at is not null
     and p.approved_at <= now()
     and p.approval_email_sent_at is null
   order by p.approved_at
   limit greatest(coalesce(p_limit, 50), 1);
$$;

create or replace function public.mark_welcome_sent(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.profiles
     set approval_email_sent_at = now()
   where id = any(p_ids) and approval_email_sent_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.members_awaiting_welcome(int) from public, anon, authenticated;
revoke execute on function public.mark_welcome_sent(uuid[])   from public, anon, authenticated;
grant  execute on function public.members_awaiting_welcome(int) to service_role;
grant  execute on function public.mark_welcome_sent(uuid[])     to service_role;

-- ----------------------------------------------------------------------------
-- 5. Attendance from a Billetto export
--
-- Billetto holds the attendee list for the 12 September open air, so tiers have
-- to be fed from their spreadsheet rather than from our own door scanner. The
-- browser parses the file and sends a list of email addresses; matching and
-- writing happen here, where is_admin() is checked and duplicates are
-- impossible (attendance is unique on user + event).
--
-- Emails are matched case-insensitively and trimmed. Anything unmatched comes
-- back so an admin can see exactly who bought a ticket without an account.
-- ----------------------------------------------------------------------------
create or replace function public.admin_import_attendance(
  p_event uuid, p_emails text[], p_source text default 'billetto_import')
returns json language plpgsql security definer set search_path = public as $$
declare
  cleaned text[];
  matched int := 0;
  added   int := 0;
  res json;
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
    select p.id, lower(p.email) as email from public.profiles p
     where lower(p.email) = any(cleaned)
  ), ins as (
    insert into public.attendance (user_id, event_id, checked_in_by, source)
    select h.id, p_event, auth.uid(), coalesce(nullif(trim(p_source), ''), 'billetto_import')
      from hits h
    on conflict (user_id, event_id) do nothing
    returning 1
  )
  select
    (select count(*) from hits),
    (select count(*) from ins)
  into matched, added;

  select json_build_object(
    'submitted', array_length(cleaned, 1),
    'matched',   matched,
    'added',     added,
    'already',   matched - added,
    'unmatched', (
      select coalesce(json_agg(e order by e), '[]'::json)
        from unnest(cleaned) e
       where not exists (select 1 from public.profiles p where lower(p.email) = e)
    )
  ) into res;

  return res;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Let a Billetto event show up like any other
--
-- The 12 September open air is sold on Billetto, not through our own releases,
-- so it has no ticket_types rows and used to be invisible to both the front
-- page and the tickets page. Now an event qualifies if it has releases OR a
-- billetto_event_id — one events row then drives the front-page card, the
-- ticket page, and the attendance import.
-- ----------------------------------------------------------------------------
create or replace function public.tickets_on_sale()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(s.e order by s.starts_at), '[]'::json)
  from (
    select ev.starts_at,
           json_build_object(
             'event_id',   ev.id,
             'name',       ev.name,
             'venue',      ev.venue,
             'starts_at',  ev.starts_at,
             'ends_at',    ev.ends_at,
             'image_url',  ev.image_url,
             'description', ev.description,
             'billetto_event_id', ev.billetto_event_id,
             'types', (
               select coalesce(json_agg(json_build_object(
                        'id', t.id, 'name', t.name, 'description', t.description,
                        'kind', t.kind, 'release_order', t.release_order,
                        'price_ore', t.price_ore, 'max_per_order', t.max_per_order,
                        'status', t.status,
                        'sales_start', t.sales_start, 'sales_end', t.sales_end,
                        'open', public.tt_is_open(t.status, t.sales_start, t.sales_end,
                                                  t.quantity, t.sold, t.reserved),
                        'left', case when t.quantity is null then null
                                     else public.tt_available(t.quantity, t.sold, t.reserved) end
                      ) order by t.kind desc, t.release_order, t.price_ore), '[]'::json)
                 from public.ticket_types t
                where t.event_id = ev.id and t.status <> 'draft'
             )
           ) as e
      from public.events ev
     where ev.is_published
       and ev.starts_at > now() - interval '12 hours'
       and (
         exists (select 1 from public.ticket_types t
                  where t.event_id = ev.id and t.status <> 'draft')
         or coalesce(trim(ev.billetto_event_id), '') <> ''
       )
  ) s;
$$;

-- Undo, for when the wrong file or the wrong event gets picked.
create or replace function public.admin_undo_import(p_event uuid, p_source text default 'billetto_import')
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  delete from public.attendance
   where event_id = p_event and source = coalesce(nullif(trim(p_source), ''), 'billetto_import');
  get diagnostics n = row_count;
  return n;
end $$;

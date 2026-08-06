-- ============================================================================
-- SLUTSTATION, phase 8 — working with us
--
-- Two ways in besides buying a ticket:
--
--   Volunteers   work the nights and get in free. They apply, an admin says
--                yes, and from then on they see their shifts and a countdown.
--   Creators     bring people. They apply with their channels, an admin gives
--                them a code, and they can see what that code actually did.
--
-- Design notes worth keeping:
--
--   * Roles are NOT a column on profiles. profiles.role stays member|admin,
--     which is the permanent account tag every policy already reads. Being a
--     volunteer or a creator is "has an approved application of that kind",
--     which means somebody can be both, the decision has a date and an author,
--     and revoking it is one status change rather than a migration.
--
--   * A code qualifies on ATTENDANCE, not on a ticket purchase. While tickets
--     are sold through Billetto we cannot see a purchase, so paying out on one
--     would be paying out on something we cannot verify. Turning up is
--     something we scan ourselves. Same rule the referrals table already uses.
--
--   * NO PAYMENT DETAILS ARE STORED, anywhere, deliberately. Not bank
--     accounts, not Swish numbers, not card details. reward_ore records what a
--     code has EARNED; paying it is arranged by email between two humans. A
--     table of other people's account numbers is a liability with no upside at
--     this size.
--
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Two things the rest of this file leans on
--
-- The audit log first, because every admin decision below writes to it.
-- member_events records what happened TO a member; nothing recorded what an
-- operator DID. With two admins, protected accounts and a documented
-- break-glass, this is the table you want the day something looks wrong.
--
-- Append-only by policy: no insert, update or delete grant exists, and the
-- only writer is a SECURITY DEFINER function called from inside the admin
-- RPCs, so an admin cannot quietly edit their own trail.
-- ----------------------------------------------------------------------------
create table if not exists public.admin_actions (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  target_id   uuid references public.profiles (id) on delete set null,
  meta        jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists admin_actions_at_idx on public.admin_actions (occurred_at desc);

alter table public.admin_actions enable row level security;

drop policy if exists admin_actions_read on public.admin_actions;
create policy admin_actions_read on public.admin_actions
  for select using (public.is_admin());

create or replace function public.log_admin_action(
  p_action text, p_target uuid default null, p_meta jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_actions (actor_id, action, target_id, meta)
  values (auth.uid(), p_action, p_target, p_meta);
$$;

-- Practical information for one night: how to get there, when to arrive, what
-- happens if it rains. Every one of those is currently a DM to Instagram.
alter table public.events add column if not exists info text;

comment on column public.events.info is
  'Practical info shown on the ticket and to staff. Getting there, timings, weather, wardrobe.';

-- ----------------------------------------------------------------------------
-- 1. Applications
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.application_kind as enum ('volunteer', 'creator');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.application_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.applications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         public.application_kind not null,
  status       public.application_status not null default 'pending',
  -- The answers, as given. jsonb rather than thirty columns because the
  -- questions will change and the answers are read by a human, not queried.
  payload      jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles (id),
  admin_note   text,
  -- One live application per kind. Re-applying updates the row rather than
  -- filling the queue with duplicates.
  unique (user_id, kind)
);

create index if not exists applications_status_idx on public.applications (status, submitted_at desc);

comment on table public.applications is
  'Volunteer and creator applications. An approved row IS the role: there is no role column for these.';

-- ----------------------------------------------------------------------------
-- 2. Codes
--
-- A creator posts about us; a promoter brings people to the door. Same
-- mechanism, different word, and the word matters to the person holding it.
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.promo_kind as enum ('creator', 'promoter');
exception when duplicate_object then null; end $$;

create table if not exists public.promo_codes (
  code        text primary key
              check (code = upper(code) and code ~ '^[A-Z0-9]{3,16}$'),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  kind        public.promo_kind not null,
  -- What one qualified signup earns, in öre. Left at 0 until the rate is
  -- decided; the plumbing does not care what the number is.
  reward_ore  integer not null default 0 check (reward_ore >= 0),
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id)
);

create index if not exists promo_codes_owner_idx on public.promo_codes (owner_id);

create table if not exists public.promo_uses (
  id           uuid primary key default gen_random_uuid(),
  code         text not null references public.promo_codes (code) on delete cascade,
  -- One code per person, forever. Whoever brought them, brought them; a second
  -- code cannot claim the same signup later.
  user_id      uuid not null unique references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'qualified')),
  created_at   timestamptz not null default now(),
  qualified_at timestamptz,
  -- Frozen at the moment it qualified, so changing the rate later does not
  -- silently rewrite what somebody was already owed.
  reward_ore   integer not null default 0
);

create index if not exists promo_uses_code_idx on public.promo_uses (code, created_at desc);

comment on table public.promo_uses is
  'Who came in on whose code. Qualifies on attendance, not purchase: while Billetto sells the tickets a purchase is not something we can verify.';

-- ----------------------------------------------------------------------------
-- 3. A code qualifies when the person actually turns up
-- ----------------------------------------------------------------------------
create or replace function public.qualify_promo_use()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.promo_uses u
     set status = 'qualified',
         qualified_at = new.checked_in_at,
         reward_ore = coalesce((select c.reward_ore from public.promo_codes c where c.code = u.code), 0)
   where u.user_id = new.user_id
     and u.status = 'pending';
  return new;
end $$;

drop trigger if exists attendance_promo_hook on public.attendance;
create trigger attendance_promo_hook
  after insert on public.attendance
  for each row execute function public.qualify_promo_use();

-- ----------------------------------------------------------------------------
-- 4. RLS
--
-- Members read their own application and their own code's numbers. Nobody but
-- an admin reads anybody else's. promo_uses is deliberately NOT readable by
-- the code owner row-by-row: they get counts and a weekly series through
-- my_promo_stats(), never the names of the people they brought.
-- ----------------------------------------------------------------------------
alter table public.applications enable row level security;
alter table public.promo_codes  enable row level security;
alter table public.promo_uses   enable row level security;

drop policy if exists applications_read_own on public.applications;
create policy applications_read_own on public.applications
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists applications_insert_own on public.applications;
create policy applications_insert_own on public.applications
  for insert with check (user_id = auth.uid() and status = 'pending');

-- Editing your own application is allowed only while nobody has looked at it,
-- and only the answers: the check clause pins status to pending, so you cannot
-- approve yourself.
drop policy if exists applications_update_own on public.applications;
create policy applications_update_own on public.applications
  for update using (user_id = auth.uid() and status = 'pending')
           with check (user_id = auth.uid() and status = 'pending');

drop policy if exists promo_codes_read_own on public.promo_codes;
create policy promo_codes_read_own on public.promo_codes
  for select using (owner_id = auth.uid() or public.is_admin());

drop policy if exists promo_uses_read_admin on public.promo_uses;
create policy promo_uses_read_admin on public.promo_uses
  for select using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. Claiming a code at signup
--
-- Called once by the account page after registration. It refuses a code that
-- is inactive, refuses your own code, and refuses to move somebody who has
-- already been claimed. Returns a plain word the page can act on rather than
-- raising, because a wrong code typed at signup is a normal thing to happen
-- and must not look like a crash.
-- ----------------------------------------------------------------------------
create or replace function public.claim_promo_code(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  c record;
  me uuid := auth.uid();
begin
  if me is null then return 'not_signed_in'; end if;

  select * into c from public.promo_codes
   where code = upper(trim(coalesce(p_code, ''))) and active;
  if not found then return 'unknown'; end if;
  if c.owner_id = me then return 'own_code'; end if;
  if exists (select 1 from public.promo_uses where user_id = me) then return 'already'; end if;

  insert into public.promo_uses (code, user_id) values (c.code, me);
  return 'ok';
end $$;

grant execute on function public.claim_promo_code(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. What a member sees about themselves
--
-- One call, because the account page needs all of it at once and three round
-- trips on a phone connection is three chances to be slow.
-- ----------------------------------------------------------------------------
create or replace function public.my_roles()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'volunteer', exists (select 1 from public.applications a
                          where a.user_id = auth.uid() and a.kind = 'volunteer' and a.status = 'approved'),
    'creator',   exists (select 1 from public.applications a
                          where a.user_id = auth.uid() and a.kind = 'creator' and a.status = 'approved'),
    'applications', coalesce((
      select json_agg(json_build_object(
               'kind', a.kind::text, 'status', a.status::text,
               'submitted_at', a.submitted_at, 'reviewed_at', a.reviewed_at,
               'note', a.admin_note))
        from public.applications a where a.user_id = auth.uid()), '[]'::json)
  );
$$;

grant execute on function public.my_roles() to authenticated;

-- Every shift they hold, past and future, not just the one that is active
-- right now. my_shift() answers "can I open the staff page"; this answers
-- "when am I next working", which is the question people actually have.
create or replace function public.my_shifts()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(s) order by s.starts_at asc), '[]'::json)
    from (
      select e.id as event_id, e.name, e.venue, e.starts_at, e.ends_at, e.info,
             es.staff_role::text,
             (e.starts_at - interval '4 hours') as access_from,
             (coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '6 hours') as access_until,
             (now() >= e.starts_at - interval '4 hours'
              and now() <= coalesce(e.ends_at, e.starts_at + interval '8 hours') + interval '6 hours') as active_now
        from public.event_staff es
        join public.events e on e.id = es.event_id
       where es.user_id = auth.uid()
         and coalesce(e.ends_at, e.starts_at + interval '8 hours') > now() - interval '30 days'
    ) s;
$$;

grant execute on function public.my_shifts() to authenticated;

-- The creator dashboard. Counts and a weekly series, never names: a code owner
-- has no business knowing who signed up under it.
create or replace function public.my_promo_stats()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
    select
      c.code, c.kind::text, c.reward_ore, c.active, c.created_at,
      (select count(*)::int from public.promo_uses u where u.code = c.code) as signups,
      (select count(*)::int from public.promo_uses u where u.code = c.code and u.status = 'qualified') as turned_up,
      (select count(*)::int from public.promo_uses u where u.code = c.code and u.status = 'pending') as pending,
      (select coalesce(sum(u.reward_ore), 0)::bigint from public.promo_uses u
        where u.code = c.code and u.status = 'qualified') as earned_ore,
      -- Twelve weeks, oldest first, with zero-weeks present so the chart has a
      -- flat stretch instead of a gap where nothing happened.
      (select json_agg(json_build_object(
                'week', to_char(w.wk, 'YYYY-MM-DD'),
                'signups', (select count(*)::int from public.promo_uses u
                             where u.code = c.code and date_trunc('week', u.created_at) = w.wk),
                'turned_up', (select count(*)::int from public.promo_uses u
                               where u.code = c.code and u.status = 'qualified'
                                 and date_trunc('week', u.created_at) = w.wk))
              order by w.wk)
         from generate_series(date_trunc('week', now()) - interval '11 weeks',
                              date_trunc('week', now()), interval '1 week') as w(wk)) as weekly
    from public.promo_codes c
   where c.owner_id = auth.uid()
   order by c.created_at
  ) x;
$$;

grant execute on function public.my_promo_stats() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Admin: the review queue and the codes
-- ----------------------------------------------------------------------------
create or replace function public.admin_applications(p_status text default 'pending')
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select coalesce(json_agg(row_to_json(x) order by x.submitted_at desc), '[]'::json) from (
    select a.id, a.kind::text, a.status::text, a.payload, a.submitted_at,
           a.reviewed_at, a.admin_note, a.user_id,
           nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as name,
           p.email, p.phone, p.city, p.created_at as member_since,
           coalesce(m.is_active_member, false) as member_ok,
           s.tier, s.events_total,
           (select nullif(trim(coalesce(r.first_name,'') || ' ' || coalesce(r.last_name,'')), '')
              from public.profiles r where r.id = a.reviewed_by) as reviewed_by_name,
           coalesce((select json_agg(json_build_object('code', c.code, 'kind', c.kind::text, 'active', c.active))
                       from public.promo_codes c where c.owner_id = a.user_id), '[]'::json) as codes
      from public.applications a
      join public.profiles p on p.id = a.user_id
      left join public.membership_status m on m.id = a.user_id
      left join public.member_stats s on s.id = a.user_id
     where coalesce(nullif(trim(p_status), ''), 'pending') = 'all'
        or a.status::text = trim(p_status)
  ) x);
end $$;

create or replace function public.admin_review_application(
  p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'Unknown status %', p_status;
  end if;

  update public.applications
     set status = p_status::public.application_status,
         admin_note = nullif(trim(coalesce(p_note, '')), ''),
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = p_id
  returning * into a;

  if not found then raise exception 'Unknown application'; end if;

  perform public.log_admin_action('application_' || p_status, a.user_id,
            jsonb_build_object('kind', a.kind, 'application', p_id));
end $$;

create or replace function public.admin_create_promo_code(
  p_user uuid, p_code text, p_kind text, p_reward_ore int default 0, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare clean text;
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;

  clean := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(clean) < 3 then raise exception 'A code needs at least 3 letters or numbers'; end if;
  if length(clean) > 16 then clean := left(clean, 16); end if;
  if exists (select 1 from public.promo_codes where code = clean) then
    raise exception 'That code is already taken';
  end if;

  insert into public.promo_codes (code, owner_id, kind, reward_ore, note, created_by)
  values (clean, p_user, p_kind::public.promo_kind, greatest(coalesce(p_reward_ore, 0), 0),
          nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  perform public.log_admin_action('promo_code_created', p_user,
            jsonb_build_object('code', clean, 'kind', p_kind, 'reward_ore', p_reward_ore));
  return clean;
end $$;

create or replace function public.admin_set_promo_code(
  p_code text, p_active boolean default null, p_reward_ore int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  update public.promo_codes
     set active = coalesce(p_active, active),
         reward_ore = coalesce(greatest(p_reward_ore, 0), reward_ore)
   where code = upper(trim(p_code));
  perform public.log_admin_action('promo_code_changed', null,
            jsonb_build_object('code', upper(trim(p_code)), 'active', p_active, 'reward_ore', p_reward_ore));
end $$;

create or replace function public.admin_promo_codes()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  return (select coalesce(json_agg(row_to_json(x) order by x.signups desc, x.code), '[]'::json) from (
    select c.code, c.kind::text, c.reward_ore, c.active, c.created_at, c.note, c.owner_id,
           nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as owner_name,
           p.email as owner_email,
           (select count(*)::int from public.promo_uses u where u.code = c.code) as signups,
           (select count(*)::int from public.promo_uses u where u.code = c.code and u.status = 'qualified') as turned_up,
           (select coalesce(sum(u.reward_ore), 0)::bigint from public.promo_uses u
             where u.code = c.code and u.status = 'qualified') as owed_ore
      from public.promo_codes c join public.profiles p on p.id = c.owner_id
  ) x);
end $$;

grant execute on function public.admin_applications(text)                      to authenticated;
grant execute on function public.admin_review_application(uuid, text, text)    to authenticated;
grant execute on function public.admin_create_promo_code(uuid, text, text, int, text) to authenticated;
grant execute on function public.admin_set_promo_code(text, boolean, int)      to authenticated;
grant execute on function public.admin_promo_codes()                           to authenticated;

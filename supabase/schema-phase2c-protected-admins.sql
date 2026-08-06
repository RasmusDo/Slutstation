-- ============================================================================
-- SLUTSTATION — protected founder admins  (run AFTER schema-phase2b)
--
-- Axel Thore and William Eriksson are admins, and their admin tag cannot be
-- removed through the app by anyone — not by each other, not by a future
-- admin, not by a compromised admin session.
--
-- HOW STRONG IS THIS, HONESTLY:
--   * Blocked: every route the website has. The admin panel, the admin RPCs,
--     and any direct table update — including one made with the service role.
--     The guard is a database trigger, so it fires no matter who is asking.
--   * Blocked: deleting these profiles (and therefore their auth users, since
--     deletion cascades through this table).
--   * NOT blocked: someone with your Supabase dashboard or database password.
--     They can open the SQL editor and use the break-glass below. That is not
--     a hole I can close — whoever holds the database can always rewrite it.
--     Treat the Supabase login itself as the real key, and put 2FA on it.
--
-- BREAK GLASS — the only way to change these accounts. Run in the Supabase SQL
-- editor, deliberately, and tell the other founder you did it:
--
--     begin;
--       set local app.allow_protected_change = 'on';
--       update public.profiles set role = 'member' where id = '<user id>';
--       delete from public.protected_accounts where user_id = '<user id>';
--     commit;
--
-- To protect a third person later, add their id to protected_accounts the same
-- way (that insert also needs the break-glass setting is NOT true — the table
-- is simply unreachable from the app, so any SQL-editor insert works).
-- ============================================================================

create table if not exists public.protected_accounts (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

-- RLS on with NO policies at all: this table is invisible and unwritable from
-- the app for every signed-in user, admins included. Verified: an admin
-- selecting from it gets 0 rows rather than an error, so it leaks nothing.
alter table public.protected_accounts enable row level security;

create or replace function public.guard_protected_accounts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.allow_protected_change', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from public.protected_accounts where user_id = old.id) then
      raise exception 'This account is protected and cannot be deleted from the app.';
    end if;
    return old;
  end if;

  if new.role is distinct from old.role
     and exists (select 1 from public.protected_accounts where user_id = old.id) then
    raise exception 'This account is protected. Its admin tag cannot be changed from the app.';
  end if;
  return new;
end $$;

-- The name matters. BEFORE triggers fire in alphabetical order, and
-- "guard" must run before "protect_ebas" — otherwise the older trigger
-- silently reverts the change and this one never gets to raise.
drop trigger if exists profiles_guard_protected on public.profiles;
create trigger profiles_guard_protected
  before update or delete on public.profiles
  for each row execute function public.guard_protected_accounts();

-- The admin RPC refuses early, so the panel shows a clear message instead of
-- a raw trigger error.
create or replace function public.admin_set_role(p_user uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if exists (select 1 from public.protected_accounts where user_id = p_user) then
    raise exception 'This account is protected. Its admin tag cannot be changed from the app.';
  end if;
  update public.profiles set role = p_role where id = p_user;
end $$;

-- ----------------------------------------------------------------------------
-- The two founder accounts
-- ----------------------------------------------------------------------------
update public.profiles set role = 'admin'
 where id in ('6b1015b6-fc02-4790-8243-255bad920717',   -- Axel Thore
              'b6f775ce-106e-4590-aca9-61e03c02309a');  -- William Eriksson

insert into public.protected_accounts (user_id, note) values
 ('6b1015b6-fc02-4790-8243-255bad920717','Axel Thore — founder admin, protected 2026-08-03'),
 ('b6f775ce-106e-4590-aca9-61e03c02309a','William Eriksson — founder admin, protected 2026-08-03')
on conflict (user_id) do nothing;

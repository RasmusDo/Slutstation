-- ============================================================================
-- PHASE 15 — Two-factor for admins, enforced where it matters
--
-- The admin panel is convenience, not security: every admin RPC checks
-- is_admin() on the server. Which means this ONE function is the entire
-- admin attack surface, and a stolen admin session (a phished password, a
-- laptop left open) currently walks straight through it.
--
-- After this phase, is_admin() also demands that the session has actually
-- passed a second factor (aal2) — but ONLY once that admin has a verified
-- TOTP factor enrolled. The order is what makes it safe to apply:
--
--   1. Apply this file. Nothing changes for anyone: no admin has a factor
--      yet, so the not-exists branch keeps password-only sessions working.
--   2. Each admin enrols from the panel (Overview -> Security card). From
--      their next session on, THEIR admin rights require the code.
--
-- An admin who loses their authenticator is rescued by the other admin
-- deleting the factor row (auth.mfa_factors) from the Supabase dashboard —
-- which is the same "two people can rescue each other" model the protected-
-- admins phase already relies on.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false)
     and (
       -- Not enrolled yet: password alone still works, so applying this file
       -- can never lock every admin out before anyone has set up a factor.
       not exists (
         select 1 from auth.mfa_factors
         where user_id = auth.uid() and status = 'verified'
       )
       -- Enrolled: the JWT must carry aal2, i.e. this session really did
       -- present the second factor, not just the password.
       or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     );
$$;

comment on function public.is_admin() is
  'admin role, and — once that admin has a verified MFA factor — an aal2 session. Every admin RPC funnels through this.';

-- FINAL (tested on a Supabase branch 2026-10-27). Shuk Nadlan, project obookujgolazrwycsiyn.
-- Changes vs mfa_fix_draft.sql: break-glass is a function switch (the GUC switch can't be set on Supabase),
-- explicit begin/commit removed (migration runner wraps it), mfa_status() hardened so the
-- verification screen / Edge gate still get `pending` when a lookup table is broken.
-- Make public.mfa_pre_request fail CLOSED, scoped to the users who are (or may be) in MFA scope,
-- so a broken check does NOT turn every CRM user into a guest (the original reason for fail-open).
--
-- Behaviour after this change:
--   * Scope = WA-2FA enrolled, verified TOTP factor, or _mfa_role_required (active platform admin,
--     or active manager with a phone). Each scope source is checked in its own sub-block.
--   * If every scope check succeeds and says "not in scope" -> request passes (ordinary agents unaffected).
--   * If any scope check says "in scope" OR errors -> check the per-session verification;
--     if that is verified -> pass; if it is not verified OR errors -> demote to anon (fail closed).
--   * Demoted-on-error requests set shuk.mfa_pending_sub (so mfa_status()/wa_login_start() and the
--     CRM verification screen still work) plus shuk.mfa_check_error = '1' for diagnostics.
--   * Lock waits are capped at 2s inside the helper functions (function-level SET, restored on exit),
--     so a migration lock costs 2s, not 8s, and the rest of the request keeps its normal lock_timeout.
--   * Break-glass (owner only, off by default): restores the old fail-open behaviour during an
--     incident. Turn ON (SQL editor, as postgres):
--       create or replace function public._mfa_break_glass() returns boolean
--         language sql stable set search_path = '' as $f$ select true $f$;
--     Turn OFF afterwards: the same with `select false`. Takes effect on the next request (no reload).
--     (A GUC switch such as `alter role authenticator set shuk.mfa_fail_open = 'on'` does NOT work on
--     Supabase: postgres is not superuser and supautils only allows pgrst.* etc. -> 42501. Tested.)
--   * Note: QUERY_CANCELED (statement_timeout) is not caught by WHEN OTHERS in PL/pgSQL and already
--     aborts the request (fails closed); unchanged here.
--
-- Also note: _shared/mfa-gate.ts reads mfa_status().pending, which comes from shuk.mfa_pending_sub set
-- here, so today a fail-open in the pre-request also opens the Edge Function gate. This fix closes both.
--
-- Rollout: apply on a branch, then test: (1) normal agent aal1 -> data visible; (2) admin aal1 unverified
-- -> anon; (3) admin verified session -> data visible; (4) simulate error, e.g. in a branch
-- `alter table public.wa_login_verifications rename to wa_lv_tmp;` -> admins demoted, ordinary agents fine
-- (ordinary agents still pass because the scope checks succeed); rename back.

-- Break-glass switch, OFF. Only the owner can redefine it; authenticated may only execute it.
create or replace function public._mfa_break_glass()
returns boolean language sql stable set search_path = '' as $$ select false $$;
revoke all on function public._mfa_break_glass() from public, anon, authenticated;
grant execute on function public._mfa_break_glass() to authenticated, service_role;

create or replace function public.mfa_pre_request()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claims    jsonb;
  v_uid       uuid;
  v_session   uuid;
  v_in_scope  boolean := false;
  v_uncertain boolean := false;
  v_verified  boolean := false;
  v_hit       boolean;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if v_claims is null
     or coalesce(v_claims->>'role', '') <> 'authenticated'
     or coalesce(v_claims->>'aal', '') = 'aal2' then
    return;
  end if;

  v_uid := nullif(v_claims->>'sub', '')::uuid;
  if v_uid is null then return; end if;

  -- break-glass: owner-defined function switch (see header). An error reading it = switch off.
  begin
    v_hit := public._mfa_break_glass();
  exception when others then
    v_hit := false;
  end;
  if coalesce(v_hit, false) then
    begin
      if not public._mfa_pending_self() then return; end if;
    exception when others then
      raise warning 'mfa_pre_request[break-glass]: check failed (%), passing: %', sqlstate, sqlerrm;
      return;
    end;
    v_in_scope := true;   -- pending -> fall through to demotion
  else

    -- scope: each source independently, an error counts as "maybe in scope"
    begin
      select public._mfa_role_required_self(v_uid) into v_hit;
      v_in_scope := v_in_scope or coalesce(v_hit, false);
    exception when others then
      v_uncertain := true;
      raise warning 'mfa_pre_request: role scope check failed (%): %', sqlstate, sqlerrm;
    end;
    if not v_in_scope then
      begin
        select public._mfa_enrolled(v_uid) into v_hit;
        v_in_scope := v_in_scope or coalesce(v_hit, false);
      exception when others then
        v_uncertain := true;
        raise warning 'mfa_pre_request: enrolment scope check failed (%): %', sqlstate, sqlerrm;
      end;
    end if;

    if not v_in_scope and not v_uncertain then
      return;                                   -- definitely not an MFA user: unaffected
    end if;

    -- in scope (or unknown): require a verified session, an error here = not verified
    begin
      v_session := nullif(v_claims->>'session_id', '')::uuid;
      select public._mfa_session_verified(v_uid, v_session) into v_verified;
      v_verified := coalesce(v_verified, false);
    exception when others then
      v_verified := false;
      perform set_config('shuk.mfa_check_error', '1', true);
      raise warning 'mfa_pre_request: verification check failed (%), request demoted: %', sqlstate, sqlerrm;
    end;
    if v_uncertain then
      perform set_config('shuk.mfa_check_error', '1', true);
    end if;

    if v_verified then return; end if;
  end if;

  -- demote (unchanged from the original)
  perform set_config('shuk.mfa_pending_sub', v_uid::text, true);
  perform set_config('shuk.mfa_pending_session', coalesce(v_claims->>'session_id', ''), true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon', 'mfa_pending', true)::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim', '', true);
end;
$$;

-- These take a uuid parameter. To avoid letting any user probe other users' MFA status via /rpc,
-- they must be callable ONLY from the pre-request. Option A (preferred): keep them out of the exposed
-- schema - move all three helpers to a private schema (e.g. create schema if not exists private;
-- not in PostgREST db_schemas) and grant usage/execute to authenticated there. Option B: guard with
-- `where p_uid = auth.uid()` (pre-request runs before claims are reset, so auth.uid() = v_uid).
-- Option B shown, minimal change:
create or replace function public._mfa_enrolled(p_uid uuid)
returns boolean language sql stable security definer set search_path = public set lock_timeout = '2s' as $$
  select p_uid = auth.uid() and (
         exists (select 1 from agent_wa_2fa t where t.user_id = p_uid)
      or exists (select 1 from auth.mfa_factors f where f.user_id = p_uid and f.status = 'verified'));
$$;
create or replace function public._mfa_session_verified(p_uid uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = public set lock_timeout = '2s' as $$
  select p_uid = auth.uid() and p_session is not null and exists (
    select 1 from wa_login_verifications v
     where v.user_id = p_uid and v.session_id = p_session and v.verified_at is not null);
$$;
-- _mfa_role_required(uuid) currently has no authenticated grant; the pre-request runs as authenticated,
-- so it needs one. Wrap it the same way rather than granting the raw function:
create or replace function public._mfa_role_required_self(p_uid uuid)
returns boolean language sql stable security definer set search_path = public set lock_timeout = '2s' as $$
  select p_uid = auth.uid() and public._mfa_role_required(p_uid);
$$;
-- (mfa_pre_request above already calls _mfa_role_required_self)

revoke all on function public._mfa_enrolled(uuid)              from public, anon, authenticated;
revoke all on function public._mfa_session_verified(uuid, uuid) from public, anon, authenticated;
revoke all on function public._mfa_role_required_self(uuid)     from public, anon, authenticated;
grant execute on function public._mfa_enrolled(uuid)              to authenticated, service_role;
grant execute on function public._mfa_session_verified(uuid, uuid) to authenticated, service_role;
grant execute on function public._mfa_role_required_self(uuid)     to authenticated, service_role;

revoke all on function public.mfa_pre_request() from public, anon, authenticated;
grant execute on function public.mfa_pre_request() to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- mfa_status(): same output as 20270507090000, but each lookup is isolated, so a broken
-- table/grant (the exact situation in which the pre-request now fails closed) still returns
-- `pending` (read from shuk.mfa_pending_sub, no table access) instead of an error. The CRM
-- verification screen and _shared/mfa-gate.ts (which reads .pending) keep working.
-- New key `check_error`: true when the pre-request or a lookup here hit an error.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pending boolean := nullif(current_setting('shuk.mfa_pending_sub', true), '') is not null;
  v_uid     uuid := coalesce(auth.uid(), nullif(current_setting('shuk.mfa_pending_sub', true), '')::uuid);
  v_err     boolean := coalesce(current_setting('shuk.mfa_check_error', true), '') = '1';
  v_enabled boolean;
  v_totp    boolean;
  v_admin   boolean;
  v_manager boolean;
  v_phone   boolean;
begin
  if v_uid is null then
    return jsonb_build_object('pending', false, 'enabled', false, 'required', false);
  end if;
  begin
    select exists (select 1 from agent_wa_2fa where user_id = v_uid) into v_enabled;
  exception when others then v_err := true;
  end;
  begin
    select exists (select 1 from auth.mfa_factors where user_id = v_uid and status = 'verified') into v_totp;
  exception when others then v_err := true;
  end;
  begin
    select coalesce(bool_or(is_platform_admin and active), false),
           coalesce(bool_or(role = 'manager' and active and coalesce(phone_e164, '') <> ''), false),
           coalesce(bool_or(phone_e164 is not null and phone_e164 <> ''), false)
      into v_admin, v_manager, v_phone
      from agency_members where user_id = v_uid;
  exception when others then v_err := true;
  end;
  return jsonb_build_object(
    'pending',     v_pending,
    'enabled',     coalesce(v_enabled, false),
    'totp',        coalesce(v_totp, false),
    'required',    coalesce(v_enabled or v_totp or v_admin or v_manager, v_pending),
    'admin',       coalesce(v_admin, false),
    'manager',     coalesce(v_manager, false),
    'has_phone',   coalesce(v_phone, false),
    'check_error', v_err
  );
end;
$$;

revoke all on function public.mfa_status() from public, anon, authenticated;
grant execute on function public.mfa_status() to authenticated;

notify pgrst, 'reload schema';

-- ===========================================================================
-- יומן ביקורת אבטחה (security_audit_log)
--
-- ‏ISO 27001 (‏8.15, ‏8.16) ותקנות אבטחת מידע דורשים לדעת **מי שינה מה
-- ומתי** בדברים שקובעים מי רואה מה. עד היום התשובה הייתה "אין לנו": יומני
-- התחומים (‏lead_routing_log, ‏ads_actions_log) מתעדים עבודה, לא הרשאות.
--
-- ‏**מה נרשם** (כל אחד בטריגר, כך שאין דרך לשנות בלי שזה ייכתב - גם לא מה-
-- service role או מה-SQL editor):
--   * ‏agency_members - תפקיד, פעיל/ה, מנהל/ת פלטפורמה, משרד, טלפון (עליו
--     נשען אימות הכניסה), מייל, רישיון, ניתוק וסגירה, ות.ז. (רק *שהשתנתה*,
--     בלי הערך). וגם הוספה ומחיקה של כרטיס.
--   * ‏agent_wa_2fa - הפעלה וכיבוי של אימות כניסה בוואטסאפ.
--   * ‏wa_login_verifications - כל אימות כניסה שעבר, ושחרור ידני בנפרד
--     (‏nonce = 'manual', ‏docs/mfa.md).
--   * ‏pricing_config - כל שינוי מחיר, מכסה או תקרה.
--
-- ‏**מה לא נרשם כאן:** כניסות וניסיונות כניסה - אלה ב-auth.audit_log_entries
-- של Supabase Auth. וקריאות (מי צפה בת.ז.) - טריגר אינו רואה SELECT; זה פער
-- מתועד ב-docs/security-audit-log.md.
--
-- ‏**התראה מיידית:** מינוי מנהל/ת פלטפורמה חדש/ה שולח security_alert לכל
-- מנהלי הפלטפורמה. זו ההרשאה הרחבה ביותר במערכת, ומינוי שלא ציפו לו הוא
-- סימן מובהק לחשבון שנפרץ.
--
-- קריאה: מנהל/ת פלטפורמה בלבד (‏RLS). כתיבה: רק הטריגרים. אין מחיקה.
-- ===========================================================================

create table if not exists public.security_audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  -- ‏null = לא משתמש/ת מחובר/ת: service role, ‏cron, או SQL ישיר
  actor_user  uuid,
  actor_role  text,
  action      text not null,
  target_user uuid,
  target_id   text,
  details     jsonb not null default '{}'::jsonb
);

comment on table public.security_audit_log is
  'יומן ביקורת: שינויי הרשאות, אימות כניסה ומחירים. נכתב רק מטריגרים. docs/security-audit-log.md';

create index if not exists security_audit_log_at_idx on public.security_audit_log (at desc);
create index if not exists security_audit_log_target_idx on public.security_audit_log (target_user, at desc);

alter table public.security_audit_log enable row level security;
revoke all on table public.security_audit_log from public, anon, authenticated;
grant select on table public.security_audit_log to authenticated;
revoke all on sequence public.security_audit_log_id_seq from public, anon, authenticated;

drop policy if exists "platform admin reads audit log" on public.security_audit_log;
create policy "platform admin reads audit log"
  on public.security_audit_log for select to authenticated
  using (public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 1. כתיבה אחת לכל הטריגרים. מי עשה את זה: ה-uid מה-JWT, והתפקיד מה-claims
--    או, בלי JWT, מתפקיד ה-DB (‏postgres / service_role).
-- ---------------------------------------------------------------------------
create or replace function public._audit(
  p_action text, p_target_user uuid, p_target_id text, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.security_audit_log (actor_user, actor_role, action, target_user, target_id, details)
  values (
    auth.uid(),
    coalesce(nullif(auth.role(), ''), current_user::text),
    p_action, p_target_user, p_target_id, coalesce(p_details, '{}'::jsonb)
  );
$$;

revoke all on function public._audit(text, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. ‏agency_members
-- ---------------------------------------------------------------------------
create or replace function public.audit_agency_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_field   text;
  v_old     jsonb;
  v_new     jsonb;
begin
  if tg_op = 'INSERT' then
    perform public._audit('member_created', new.user_id, new.id::text,
      jsonb_build_object('agency_id', new.agency_id, 'role', new.role,
                         'is_platform_admin', new.is_platform_admin));
    if new.is_platform_admin then
      perform public._alert_platform_admin_granted(new.id, new.display_name);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public._audit('member_deleted', old.user_id, old.id::text,
      jsonb_build_object('agency_id', old.agency_id, 'display_name', old.display_name));
    return old;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_field in array array['role','active','is_platform_admin','agency_id','phone',
                                 'email','license_number','license_status','released_at','closed_at']
  loop
    if v_old->v_field is distinct from v_new->v_field then
      v_changes := v_changes || jsonb_build_object(v_field,
        jsonb_build_object('from', v_old->v_field, 'to', v_new->v_field));
    end if;
  end loop;
  -- ת.ז.: רק שהשתנתה. היומן נקרא על ידי יותר אנשים מהשדה עצמו.
  if old.id_number is distinct from new.id_number then
    v_changes := v_changes || jsonb_build_object('id_number', 'changed');
  end if;

  if v_changes = '{}'::jsonb then return new; end if;

  perform public._audit('member_changed', new.user_id, new.id::text, v_changes);

  if new.is_platform_admin and not coalesce(old.is_platform_admin, false) then
    perform public._alert_platform_admin_granted(new.id, new.display_name);
  end if;
  return new;
end;
$$;

-- מינוי מנהל/ת פלטפורמה: security_alert לכל המנהלים הפעילים, כולל החדש/ה.
-- ‏translate - הטקסט יוצא לוואטסאפ (CLAUDE.md, מקף רגיל).
create or replace function public._alert_platform_admin_granted(p_member uuid, p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (agent_id, type, title, body)
  select m.id, 'security_alert',
         'מנהל/ת פלטפורמה חדש/ה',
         translate(coalesce(p_name, 'כרטיס ללא שם')
           || ' קיבל/ה הרשאת ניהול פלטפורמה. אם זה לא מינוי שתוכנן - '
           || 'להסיר את ההרשאה מיד ולבדוק את יומן הביקורת.', '—–', '--')
    from public.agency_members m
   where m.is_platform_admin = true and m.active = true;
$$;

revoke all on function public.audit_agency_members() from public, anon, authenticated;
revoke all on function public._alert_platform_admin_granted(uuid, text) from public, anon, authenticated;

drop trigger if exists agency_members_audit on public.agency_members;
-- ‏update of: הטריגר רץ רק כשאחת העמודות הנצפות ברשימת ה-SET. כרטיס הסוכן/ת
-- מתעדכן כל הזמן (יתרה, מכסה, מסלול), ואין סיבה לחשב השוואה על כל אחד מאלה.
create trigger agency_members_audit
  after insert or delete or update of role, active, is_platform_admin, agency_id, phone,
        email, license_number, license_status, released_at, closed_at, id_number
  on public.agency_members
  for each row execute function public.audit_agency_members();

-- ---------------------------------------------------------------------------
-- 3. אימות כניסה: הפעלה, כיבוי, ואימות שעבר
-- ---------------------------------------------------------------------------
create or replace function public.audit_wa_2fa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public._audit('login_2fa_enabled', new.user_id, null, '{}'::jsonb);
    return new;
  end if;
  perform public._audit('login_2fa_disabled', old.user_id, null, '{}'::jsonb);
  return old;
end;
$$;

revoke all on function public.audit_wa_2fa() from public, anon, authenticated;

drop trigger if exists agent_wa_2fa_audit on public.agent_wa_2fa;
create trigger agent_wa_2fa_audit
  after insert or delete on public.agent_wa_2fa
  for each row execute function public.audit_wa_2fa();

create or replace function public.audit_wa_login_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verified_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.verified_at is not null then return new; end if;
  perform public._audit(
    case when new.nonce = 'manual' then 'login_verified_manual' else 'login_verified' end,
    new.user_id, new.session_id::text,
    jsonb_build_object('enable', new.enable));
  return new;
end;
$$;

revoke all on function public.audit_wa_login_verification() from public, anon, authenticated;

drop trigger if exists wa_login_verifications_audit on public.wa_login_verifications;
create trigger wa_login_verifications_audit
  after insert or update of verified_at on public.wa_login_verifications
  for each row execute function public.audit_wa_login_verification();

-- ---------------------------------------------------------------------------
-- 4. מחירים
-- ---------------------------------------------------------------------------
create or replace function public.audit_pricing_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public._audit('pricing_deleted', null, old.key, jsonb_build_object('from', old.value));
    return old;
  end if;
  if tg_op = 'UPDATE' and old.value is not distinct from new.value then return new; end if;
  perform public._audit(
    case when tg_op = 'INSERT' then 'pricing_created' else 'pricing_changed' end,
    null, new.key,
    jsonb_build_object('from', case when tg_op = 'UPDATE' then to_jsonb(old.value) end,
                       'to', to_jsonb(new.value)));
  return new;
end;
$$;

revoke all on function public.audit_pricing_config() from public, anon, authenticated;

drop trigger if exists pricing_config_audit on public.pricing_config;
create trigger pricing_config_audit
  after insert or update or delete on public.pricing_config
  for each row execute function public.audit_pricing_config();

-- ---------------------------------------------------------------------------
-- 5. השחרור הידני מ-12.10.2026 נעשה לפני שהיומן היה קיים. נרשם כאן למפרע,
--    כדי שהיומן יתחיל שלם (‏docs/mfa.md, "מה קרה ב-12.10.2026").
-- ---------------------------------------------------------------------------
insert into public.security_audit_log (at, actor_user, actor_role, action, target_user, target_id, details)
select v.verified_at, null, 'postgres', 'login_verified_manual', v.user_id, v.session_id::text,
       jsonb_build_object('note', 'נרשם למפרע - שחרור אחרי הנעילה ב-12.10.2026 (PR #717)')
  from public.wa_login_verifications v
 where v.nonce = 'manual'
   and not exists (select 1 from public.security_audit_log a
                    where a.action = 'login_verified_manual' and a.target_id = v.session_id::text);

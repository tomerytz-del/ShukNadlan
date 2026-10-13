-- ===========================================================================
-- אימות דו-שלבי חובה גם למנהלי משרדים
--
-- ‏עד היום החובה חלה רק על מנהלי פלטפורמה (‏20270421090000). מנהל/ת משרד
-- רואה את כל הלידים והלקוחות של המשרד, ולכן חשבון שנפרץ שלו/ה חושף את
-- כולם. החלטת הבעלים (13.10.2026): חובה, מיד.
--
-- ‏**פטור אחד:** מנהל/ת בלי נייד בכרטיס (‏phone_e164 ריק). אימות הוואטסאפ
-- צריך לאן לשלוח, ובלי נייד המסך היה ננעל עליו/ה בלי מוצא (‏wa_login_start
-- מחזירה no_phone). ברגע שנוסף נייד - החובה חלה מעצמה. סקירת ההרשאות מציגה
-- אותו/ה כ"אימות דו-שלבי: לא", כדי שיטופל ידנית (‏docs/access-review.md).
--
-- ‏**מה קורה בפועל אחרי המיזוג:** מנהל/ת שמחובר/ת עכשיו יקבל/ת בבקשה הבאה
-- את מסך האימות - הודעת וואטסאפ אחת לכל session. זה אותו מסך שמנהלי
-- הפלטפורמה עוברים מאז 20270421090000, ו-crm.js כבר מטפל ב-mfa_required.
--
-- ‏שתי הפונקציות הוחלפו מהגרסה היחידה שלהן (‏20270421090000), שזהה לפרודקשן
-- (נבדק 13.10.2026). ‏docs/mfa.md
-- ===========================================================================

-- התנאי במקום אחד, בשביל שלוש הפונקציות שלמטה
create or replace function public._mfa_role_required(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agency_members m
     where m.user_id = p_uid and m.active
       and (m.is_platform_admin
            or (m.role = 'manager' and coalesce(m.phone_e164, '') <> ''))
  );
$$;

-- ‏uuid כפרמטר, ולכן סגורה לגמרי: גרסה פתוחה הייתה מאפשרת לברר על אחרים מי
-- מנהל/ת (ראו ההערה ל-_mfa_pending_self ב-20270421090000).
revoke all on function public._mfa_role_required(uuid) from public, anon, authenticated;

create or replace function public._mfa_pending_self()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and coalesce(auth.jwt()->>'aal', '') <> 'aal2'
     and (
           exists (select 1 from agent_wa_2fa t where t.user_id = auth.uid())
        or exists (select 1 from auth.mfa_factors f
                    where f.user_id = auth.uid() and f.status = 'verified')
        or public._mfa_role_required(auth.uid())
         )
     and not exists (
           select 1 from wa_login_verifications v
            where v.user_id = auth.uid()
              and v.session_id = nullif(auth.jwt()->>'session_id', '')::uuid
              and v.verified_at is not null
         );
$$;

revoke all on function public._mfa_pending_self() from public, anon, authenticated;
grant execute on function public._mfa_pending_self() to authenticated;

-- ‏'admin' נשאר כמו שהוא (מנהל/ת פלטפורמה), ו-'manager' חדש: ה-CRM מציג
-- לפיהם את ההסבר "למה זה חובה" במסך האימות ובהגדרות.
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
  v_enabled boolean;
  v_totp    boolean;
  v_admin   boolean;
  v_manager boolean;
  v_phone   boolean;
begin
  if v_uid is null then
    return jsonb_build_object('pending', false, 'enabled', false, 'required', false);
  end if;
  select exists (select 1 from agent_wa_2fa where user_id = v_uid) into v_enabled;
  select exists (select 1 from auth.mfa_factors where user_id = v_uid and status = 'verified') into v_totp;
  select coalesce(bool_or(is_platform_admin and active), false),
         coalesce(bool_or(role = 'manager' and active and coalesce(phone_e164, '') <> ''), false),
         coalesce(bool_or(phone_e164 is not null and phone_e164 <> ''), false)
    into v_admin, v_manager, v_phone
    from agency_members where user_id = v_uid;
  return jsonb_build_object(
    'pending',   v_pending,
    'enabled',   v_enabled,
    'totp',      v_totp,
    'required',  v_enabled or v_totp or v_admin or v_manager,
    'admin',     v_admin,
    'manager',   v_manager,
    'has_phone', v_phone
  );
end;
$$;

revoke all on function public.mfa_status() from public, anon, authenticated;
grant execute on function public.mfa_status() to authenticated;

-- ---------------------------------------------------------------------------
-- סקירת ההרשאות: "אימות דו-שלבי" כולל עכשיו גם את החובה של מנהלי משרדים
-- (מהגרסה היחידה, 20270506090000)
-- ---------------------------------------------------------------------------
create or replace function public.access_review_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select m.id, m.user_id, m.display_name, m.email, m.role, m.active,
           m.is_platform_admin, a.name as agency_name,
           u.last_sign_in_at,
           -- מנהל/ת פלטפורמה, ומנהל/ת משרד עם נייד, חייבים אימות מעצם התפקיד
           -- (‏_mfa_pending_self, ‏docs/mfa.md), גם בלי רישום ב-agent_wa_2fa
           (m.is_platform_admin
            or (m.role = 'manager' and m.active and coalesce(m.phone_e164, '') <> '')
            or exists (select 1 from public.agent_wa_2fa w where w.user_id = m.user_id)
            or exists (select 1 from auth.mfa_factors f
                        where f.user_id = m.user_id and f.status = 'verified')) as has_2fa
      from public.agency_members m
      left join public.agencies a on a.id = m.agency_id
      left join auth.users u on u.id = m.user_id
  )
  select jsonb_build_object(
    'platform_admins', coalesce((select jsonb_agg(jsonb_build_object(
        'name', display_name, 'email', email, 'agency', agency_name,
        'active', active, 'has_2fa', has_2fa, 'last_sign_in_at', last_sign_in_at)
        order by display_name) from m where is_platform_admin), '[]'::jsonb),
    'managers', coalesce((select jsonb_agg(jsonb_build_object(
        'name', display_name, 'email', email, 'agency', agency_name,
        'has_2fa', has_2fa, 'last_sign_in_at', last_sign_in_at)
        order by agency_name, display_name) from m where role = 'manager' and active), '[]'::jsonb),
    -- פעיל/ה במערכת אבל לא נכנס/ה 90 יום: הרשאה שאף אחד לא משתמש בה, והראשונה
    -- לבדוק אם היא עוד צריכה להיות שם.
    'dormant', coalesce((select jsonb_agg(jsonb_build_object(
        'name', display_name, 'email', email, 'agency', agency_name, 'role', role,
        'last_sign_in_at', last_sign_in_at)
        order by last_sign_in_at nulls first) from m
        where active and user_id is not null
          and (last_sign_in_at is null or last_sign_in_at < now() - interval '90 days')), '[]'::jsonb),
    'active_members', (select count(*) from m where active)
  );
$$;

revoke all on function public.access_review_snapshot() from public, anon, authenticated;

-- ============================================================================
-- תיקון: ‏is_self בלוגיקה תלת-ערכית, ומעקף מפורש להקשרים מנהלתיים
--
-- שני באגים שהתגלו כשהרצנו את הבקאפיל בפועל:
--
-- 1. ‏is_self יכול להיות NULL, לא רק true/false.
--
--    ‏‎old.user_id is not null and old.user_id = (select auth.uid())‎ מחזיר NULL
--    כאשר auth.uid() הוא NULL ו-user_id אינו NULL: ‏‎true and NULL = NULL‎.
--    ואז ‏‎if not is_self‎ הוא ‏‎not NULL = NULL‎ — והענף פשוט לא נכנס.
--
--    התוצאה: בכל הקשר שבו auth.uid() הוא NULL, ההגנה "אי אפשר לחתום בשם
--    מישהו אחר" נעלמה בשקט. זה בדיוק מה שקרה בבקאפיל — חמש שורות נחתמו דרך
--    הנתיב הזה, ורק השורה שבה user_id הוא NULL (ולכן is_self היה false אמיתי)
--    נחסמה. הגנה שתלויה בכך ש-auth.uid() תמיד מאוכלס אינה הגנה.
--
--    התיקון: ‏coalesce עוטף את ההשוואה, כך ש-is_self הוא תמיד true או false.
--
-- 2. אין מעקף להקשר מנהלתי.
--
--    מיגרציות ו-SQL Editor רצים כ-‏postgres, לא כ-service_role, ו-auth.role()
--    שם הוא NULL — כלומר הבדיקה הקיימת לא תפסה אותם. אחרי תיקון (1) הם היו
--    נחסמים לגמרי, ושורה שאין לה user_id (סוכן/ת שטרם חובר/ה לחשבון) הייתה
--    הופכת לבלתי-ניתנת לחתימה בשום דרך.
--
--    התיקון: המעקף נשען על ‏current_user‎ ולא על ה-JWT. דפדפן מגיע דרך
--    PostgREST תמיד כ-anon או authenticated, ולעולם לא כ-postgres או
--    ‏service_role — ולכן זו בדיקה שאי אפשר לזייף מצד הלקוח, בשונה מ-claim
--    ב-JWT.
-- ============================================================================

create or replace function public.protect_sensitive_agency_member_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- ‏coalesce מבטיח true/false ולעולם לא NULL — ראו (1) בראש הקובץ
  is_self boolean := coalesce(
    old.user_id is not null and old.user_id = (select auth.uid()),
    false
  );
  -- הקשר מנהלתי: מיגרציה, SQL Editor או Edge Function. נקבע לפי תפקיד ה-DB
  -- בפועל, שדפדפן לא יכול להתחזות אליו
  is_privileged boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
                           or auth.role() = 'service_role';
begin
  if is_privileged then
    return new;
  end if;
  new.credit_balance := old.credit_balance;
  new.tier := old.tier;
  new.free_quota_used := old.free_quota_used;
  new.free_quota_cycle_start := old.free_quota_cycle_start;
  new.payment_token_id := old.payment_token_id;
  new.billing_status := old.billing_status;
  new.pending_tier_change := old.pending_tier_change;
  new.pending_tier_change_at := old.pending_tier_change_at;
  new.subscription_id := old.subscription_id;
  new.is_platform_admin := old.is_platform_admin; -- נעול לחלוטין, גם למנהל משרד רגיל
  new.is_mortgage_advisor := old.is_mortgage_advisor; -- נעול לחלוטין — מנהל/ת הפלטפורמה בלבד
  new.ethics_badge_revoked_at := old.ethics_badge_revoked_at; -- הסרת תו: הנהלת הפלטפורמה בלבד

  if not is_self or new.license_number is null or btrim(new.license_number) = '' then
    new.license_number := old.license_number;
  end if;

  -- אישור הקוד האתי — אישי בלבד, והחותמת נקבעת בשרת
  if not is_self then
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
    new.ethics_code_version := old.ethics_code_version;
  elsif new.ethics_code_accepted_at is null then
    new.ethics_code_version := null;               -- ביטול אישור מנקה גם את הגרסה
  elsif old.ethics_code_accepted_at is null
        or new.ethics_code_version is distinct from old.ethics_code_version then
    new.ethics_code_accepted_at := now();          -- אישור חדש (או לגרסה חדשה) — עכשיו
  else
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
  end if;

  if is_self then
    new.role := old.role;
    new.active := old.active;
    new.agency_id := old.agency_id;
  end if;
  return new;
end;
$$;

create or replace function public.protect_agency_ethics_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  is_privileged boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
                           or auth.role() = 'service_role';
begin
  if is_privileged then
    return new;
  end if;
  new.ethics_badge_revoked_at := old.ethics_badge_revoked_at;

  if new.ethics_code_accepted_at is null then
    new.ethics_code_version := null;
  elsif old.ethics_code_accepted_at is null
        or new.ethics_code_version is distinct from old.ethics_code_version then
    new.ethics_code_accepted_at := now();
  else
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
  end if;
  return new;
end;
$$;

-- השורה שנחסמה בבקאפיל הראשון (‏user_id הוא NULL ולכן is_self היה false אמיתי)
update public.agency_members
   set ethics_code_accepted_at = now(),
       ethics_code_version     = '2026-08'
 where ethics_code_accepted_at is null
   and ethics_badge_revoked_at is null
   and created_at < timestamptz '2026-08-29 21:00:00+00';

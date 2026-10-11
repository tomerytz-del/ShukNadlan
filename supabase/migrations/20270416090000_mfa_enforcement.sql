-- ===========================================================================
-- אימות דו-שלבי (TOTP) — האכיפה במסד
--
-- ‏ההרשמה והקוד עצמם הם של Supabase Auth (‏auth.mfa_factors, ‏aal1/aal2 ב-JWT).
-- מה שהקובץ הזה מוסיף הוא הצד שהדפדפן אינו יכול לתת: **מי שחייב/ת קוד ולא
-- הזין/ה אותו אינו/ה רואה כלום**, גם כשהוא/היא פונה ישירות ל-API עם הסיסמה
-- בלבד ועוקף/ת את מסך הקוד ב-CRM. בלי זה האימות הדו-שלבי הוא קישוט.
--
-- מי חייב/ת קוד (‏_mfa_required_self):
--   * כל מי שהפעיל/ה אימות דו-שלבי (יש לו/ה factor מאומת)
--   * מנהל/ת פלטפורמה פעיל/ה — תמיד, גם בלי שהפעיל/ה. ההרשאה הרחבה ביותר
--     במערכת אינה יכולה להישען על סיסמה אחת.
--
-- ‏**איך: pre-request של PostgREST, ולא policy בכל טבלה.** הפונקציה רצה לפני
-- כל בקשה ל-Data API (טבלאות ו-RPC כאחד, כולל SECURITY DEFINER שעוקפות
-- RLS), ולמי שחייב/ת קוד ולא הזין/ה אותו היא **מאפסת את ה-claims לאלה של
-- אורח/ת**: ‏auth.uid() מחזיר null, ‏auth.role() מחזיר anon. המשמעות:
--   * כל מה שפרטי — נעלם, כי כל policy פרטית נשענת על auth.uid().
--   * מה שציבורי (נכסים, משרדים, דף הבית) — ממשיך לעבוד. זו הסיבה שלא
--     זורקים שגיאה: ה-session משותף לכל הדפים באותו דומיין, וטלפון שנשאר
--     מחובר מלפני ההפעלה היה מקבל דף בית ריק או שבור.
--   * ‏policy של authenticated עם ‏using (true) הייתה דולפת — נבדק במסד
--     ב-10.10.2026, ואין כזו ב-public או ב-storage.
--
-- ‏**מה לא מכוסה כאן:** ‏Storage ו-Realtime אינם עוברים ב-pre-request. ל-
-- Storage יש למטה policy מגבילה משלה; ‏Realtime אינו בשימוש. ‏Edge Functions
-- שמזהות משתמש/ת ב-getUser ועובדות ב-service role נבדקות ב-
-- ‏_shared/mfa-gate.ts. הפרטים: docs/mfa.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. מי חייב/ת קוד - **על עצמו/ה בלבד**, לפי auth.uid(). בלי פרמטר בכוונה:
--    גרסה שמקבלת uuid הייתה מאפשרת לכל משתמש/ת לברר על אחרים מי מנהל/ת
--    פלטפורמה. ‏security definer כי auth.mfa_factors אינה קריאה ל-
--    authenticated (נבדק: has_table_privilege = false), ו-agency_members
--    מוגבלת ב-RLS.
-- ---------------------------------------------------------------------------
create or replace function public._mfa_required_self()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null and (
           exists (
             select 1 from auth.mfa_factors f
              where f.user_id = auth.uid() and f.status = 'verified'
           )
        or exists (
             select 1 from public.agency_members m
              where m.user_id = auth.uid() and m.is_platform_admin = true and m.active = true
           ));
$$;

revoke all on function public._mfa_required_self() from public, anon, authenticated;
grant execute on function public._mfa_required_self() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ה-pre-request.
--
-- ‏aal2 יוצא בשורה הראשונה, בלי שום שאילתה — זה המצב של מי שכבר הזין/ה
-- קוד. מי שבלי אימות דו-שלבי משלם/ת שתי בדיקות אינדקס לבקשה.
--
-- ‏**כשל פתוח, ובכוונה.** תקלה בבדיקה עצמה (הרשאה שהשתנתה בגרסה של
-- Supabase) בכשל סגור הייתה הופכת כל משתמש/ת aal1 לאורח/ת — כלומר מפילה את
-- ה-CRM לכולם בבת אחת. בכשל פתוח המחיר הוא שהאכיפה נחלשת עד התיקון, וזה
-- נרשם כ-warning ביומן של Postgres.
--
-- ‏shuk.mfa_pending_sub שומר מי היה/תה שם לפני האיפוס, בשביל mfa_status()
-- בלבד: בלי זה ה-CRM לא יכול לדעת שמנהל/ת פלטפורמה צריך/ה להפעיל.
--
-- ‏**security invoker, ולא definer.** ‏PostgREST מריץ אותה בתפקיד של הבקשה,
-- כולל anon, ולכן היא חייבת execute לכולם. פונקציית definer פתוחה ל-anon
-- שמריצה set_config היא בדיוק מה שהסוכן התפעולי מסמן high
-- (‏anon_secdef_unguarded). כאן אין בזה צורך: ‏set_config על ה-claims מותר
-- לכל תפקיד, והקריאה המוגנת היחידה עוברת דרך _mfa_required_self.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_pre_request()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claims jsonb;
  v_uid    uuid;
  v_req    boolean := false;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if v_claims is null
     or coalesce(v_claims->>'role', '') <> 'authenticated'
     or coalesce(v_claims->>'aal', '') = 'aal2' then
    return;
  end if;

  v_uid := nullif(v_claims->>'sub', '')::uuid;
  if v_uid is null then return; end if;

  begin
    v_req := public._mfa_required_self();
  exception when others then
    raise warning 'mfa_pre_request: check failed, request passes without MFA enforcement: %', sqlerrm;
    return;
  end;

  if not v_req then return; end if;

  perform set_config('shuk.mfa_pending_sub', v_uid::text, true);
  -- ‏auth.uid() / auth.role() / auth.jwt() קוראים את שלושת אלה; כולם מתאפסים
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon', 'mfa_pending', true)::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim', '', true);
end;
$$;

revoke all on function public.mfa_pre_request() from public, anon, authenticated;
-- ‏PostgREST מריץ את ה-pre-request בתפקיד של הבקשה, ולכן שלושתם צריכים
-- הרשאת הרצה. ‏revoke ואז grant מפורש — ההחלטה כתובה, לא ברירת מחדל.
grant execute on function public.mfa_pre_request() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. מה ה-CRM צריך לדעת כדי להציג את המסך הנכון.
--
-- ‏pending: חייב/ת קוד ועוד לא הזין/ה (כלומר כרגע אורח/ת במסד)
-- ‏enrolled: יש factor מאומת — מסך קוד. בלי — מסך הפעלה (מנהל/ת פלטפורמה).
-- ---------------------------------------------------------------------------
create or replace function public.mfa_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid      uuid := coalesce(auth.uid(), nullif(current_setting('shuk.mfa_pending_sub', true), '')::uuid);
  v_aal      text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'aal', '');
  v_enrolled boolean;
  v_admin    boolean;
  v_pending  boolean := nullif(current_setting('shuk.mfa_pending_sub', true), '') is not null;
begin
  if v_uid is null then
    return jsonb_build_object('pending', false, 'enrolled', false, 'required', false);
  end if;
  select exists (select 1 from auth.mfa_factors where user_id = v_uid and status = 'verified') into v_enrolled;
  select exists (select 1 from agency_members where user_id = v_uid and is_platform_admin and active) into v_admin;
  return jsonb_build_object(
    'pending',  v_pending,
    'enrolled', v_enrolled,
    'required', v_enrolled or v_admin,
    'admin',    v_admin,
    -- אחרי האיפוס ה-aal כבר לא בטוקן; pending הוא מה שקובע
    'aal',      case when v_pending then 'aal1' else nullif(v_aal, '') end
  );
end;
$$;

revoke all on function public.mfa_status() from public, anon, authenticated;
-- ‏authenticated בלבד: אחרי האיפוס התפקיד במסד עדיין authenticated, ורק
-- ה-claims הם של אורח/ת.
grant execute on function public.mfa_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ‏Storage אינו עובר ב-pre-request. ‏policy מגבילה (restrictive) אחת על
--    storage.objects: מי שחייב/ת קוד ולא הזין/ה — אינו/ה קורא/ת, מעלה או
--    מוחק/ת דרך ה-API של Storage. הקלטות השיחות (call-recordings) הן הסיבה.
--    הקישורים הציבוריים של הדליים הציבוריים אינם עוברים ב-RLS ולא נפגעים.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is null
      or coalesce(auth.jwt()->>'aal', '') = 'aal2'
      or not public._mfa_required_self();
$$;

revoke all on function public.mfa_satisfied() from public, anon, authenticated;
grant execute on function public.mfa_satisfied() to authenticated;

drop policy if exists "mfa required for storage" on storage.objects;
create policy "mfa required for storage"
  on storage.objects
  as restrictive
  for all
  to authenticated
  using ((select public.mfa_satisfied()))
  with check ((select public.mfa_satisfied()));

-- ---------------------------------------------------------------------------
-- 5. הרישום. ‏alter role authenticator נתמך ומתועד ב-Supabase ("Securing
--    your API" → "Enforce additional rules on each request"). נבדק לפני
--    הכתיבה: לא היה pre-request קודם, כך שאין כאן דריסה של משהו אחר.
-- ---------------------------------------------------------------------------
alter role authenticator set pgrst.db_pre_request = 'public.mfa_pre_request';
notify pgrst, 'reload config';

-- ============================================================================
-- מתנת הרכישה בקורס: חודש Elite נוסף על 60 ימי ה-Elite הקבועים
--
-- החלטת תומר (15.11.2026): מי שרכש/ה את קורס ההכנה ונרשם/ה בפלטפורמה כיועץ/ת
-- נדל״ן באותו חשבון Google מקבל/ת 90 ימי Elite במקום 60 (60 הימים הם התמחור הקבוע, לא הטבה זמנית). הזיהוי הוא לפי
-- ‏`user_id`: ‏`course_orders.user_id` ו-`agency_members.user_id` מצביעים שניהם
-- ל-`auth.users`.
--
-- הפונקציה כאן רק עונה "האם שולם". מספר החודשים הנוספים יושב בקוד
-- (‏`COURSE_BUYER_BONUS_MONTHS` ב-`_shared/launch-promo.ts`), ו-`grant_launch_promo`
-- נשארת כמות שהיא ומקבלת את הסכום ב-`p_months`: אותה אידמפוטנטיות, ואותו יומן.
--
-- "שולם" = הזמנה ב-`success` שאינה `test_mode`. גישה שנפתחה ב-
-- `course_grant_access` (בדיקה או מתנה) אינה הזמנה ולכן אינה מזכה.
-- ============================================================================

create or replace function public.is_course_buyer(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.agency_members m
      join public.course_orders o on o.user_id = m.user_id
     where m.id = p_member_id
       and m.user_id is not null
       and o.status = 'success'
       and o.test_mode = false
  );
$$;

comment on function public.is_course_buyer(uuid) is
  'האם בעל/ת הכרטיס רכש/ה את הקורס בתשלום (אותו user_id). משמשת את grantLaunchPromo להוספת חודש להטבת ההשקה. docs/exam-course.md';

revoke all on function public.is_course_buyer(uuid) from public, anon, authenticated;
grant execute on function public.is_course_buyer(uuid) to service_role;

-- ============================================================================
-- מדף לידי המשכנתאות: נראה רק ליועצי משכנתאות, גם במסד ולא רק במסך
--
-- ‏mortgage_leads_public נפתח ל-authenticated כולו (‏20260826120000), וה-CRM הסתיר
-- את המגירה בלי שום סינון בשורה: ‏"הבדיקה האמיתית יושבת ב-purchase_mortgage_lead,
-- וזו כאן היא נוחות בלבד" (assets/crm.js, חנות הלידים). הרכישה אכן חסומה, אבל
-- הקריאה לא: כל סוכן/ת תיווך מחובר/ת שקרא/ה ל-/rest/v1/mortgage_leads_public
-- קיבל/ה את כל הלידים - סכום הנכס, ההון העצמי, המשכנתא והמקור. לא פרטי קשר
-- (הם נשארים בטבלה), אבל כן מלאי שנועד לקהל אחר.
--
-- העיקרון שנקבע (7.11.2026): **מדף לידים ממוקד למי שביקש אותו.** ליד של יועץ/ת
-- משכנתאות אינו מוצג למתווכים, וליד של עורך/ת דין (המדף הבא) לא יוצג להם ולא
-- ליועצי משכנתאות. ההפרדה נעשית ב-view עצמו, לא ב-JS: מסך שמסתיר מגירה אינו
-- הרשאה.
--
-- ‏current_is_mortgage_advisor() היא ההגדרה היחידה של "מי רואה את המדף": יועץ/ת
-- פעיל/ה, או מנהל/ת פלטפורמה (current_is_platform_admin, ההגדרה היחידה שלו) שרואה את
-- כל המדפים כדי לתפעל אותם. היא מחזירה רק את מצב הקורא/ת עצמו/ה, ולכן ניתנת ל-
-- authenticated: בפרודקשן נצפה ש-view של הבעלים נכשל עם permission denied על EXECUTE
-- של פונקציה כזו אם הקורא/ת אינו מחזיק/ה בו (saved_search_intent_score, 20260830090000).
--
-- ‏שימו לב: ה-view בודק כל חברות פעילה של הקורא/ת (user_id), וה-CRM מציג מגירה לפי
-- החברות שנבחרה. מי שיועץ/ת במשרד אחד וסוכן/ת במשרד אחר יקרא/תקרא את המדף ב-REST גם
-- כשהמגירה מוסתרת - בכוונה: הוא/היא יועץ/ת, ובקשת REST אינה נושאת "חברות נבחרת".
--
-- ‏(select ...) עוטף את הקריאה כדי שתחושב פעם אחת לשאילתה ולא לכל שורה.
-- ‏create or replace view: אותן עמודות באותו סדר, ורק ה-where השתנה. ההרשאות
-- נשמרות ב-replace.
-- ============================================================================

create or replace function public.current_is_mortgage_advisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agency_members
     where user_id = auth.uid()
       and active = true
       and is_mortgage_advisor = true
  ) or public.current_is_platform_admin();
$$;

comment on function public.current_is_mortgage_advisor() is
  'האם הקורא/ת רשאי/ת לראות את מדף ייעוץ המשכנתאות: יועץ/ת פעיל/ה או מנהל/ת פלטפורמה. הגדרה אחת, בשימוש ה-view mortgage_leads_public.';

revoke all on function public.current_is_mortgage_advisor() from public, anon;
grant execute on function public.current_is_mortgage_advisor() to authenticated, service_role;

create or replace view public.mortgage_leads_public as
select
  id,
  owns_property,
  property_price,
  equity,
  loan_amount,
  interest_rate,
  years,
  monthly_payment,
  ltv_pct,
  (email is not null and btrim(email) <> '') as has_email,
  status,
  created_at,
  property_id,
  source
from public.mortgage_leads
where status in ('new','sold')
  and (select public.current_is_mortgage_advisor());

comment on view public.mortgage_leads_public is
  'מדף לידי המשכנתאות - נתוני המחשבון והקשר הנכס בלבד, ורק ליועצי משכנתאות ולמנהל/ת פלטפורמה (current_is_mortgage_advisor). ללא שם, ללא טלפון, ללא אימייל.';

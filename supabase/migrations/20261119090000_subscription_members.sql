-- ============================================================================
-- רשימת המנויים שמאחורי כל מספר בתמונת המצב
-- ----------------------------------------------------------------------------
-- ‏subscription_overview() (‏20261014090000) מחזירה שישה מספרים: כמה על כל
-- מסלול, כמה בתוך ההטבה, כמה מהן נגמרות החודש, וכמה בקשות פתוחות. המספרים
-- האלה עונים על "כמה" ומשאירים את "מי" בלי תשובה — ומי שרואה "11 Elite"
-- או "9 בתוך ההטבה" רוצה בדיוק את הדבר השני: מי הם, באיזה משרד, ומתי
-- ההטבה שלהם נגמרת.
--
-- עד היום התשובה הזו הייתה ‎select‎ ידני ב-SQL Editor. הפונקציה כאן היא אותה
-- שאילתה, פעם אחת ונכון: **אותם תנאי סינון בדיוק** של ‎subscription_overview‎,
-- כדי שמספר שנלחץ ורשימה שנפתחת לא יסתרו זה את זה. תנאי שמשתנה בעתיד חייב
-- להשתנות בשתי הפונקציות יחד — הן יושבות זו לצד זו כאן ובקובץ הקודם.
--
-- ‏security definer מאותה סיבה כמו שאר פונקציות הניהול: ‎agency_members‎ חסומה
-- ב-RLS מול הדפדפן, ובדיקת ההרשאה יושבת ב-‎where‎ ולא ב-‎raise‎ — לפונקציית
-- קריאה, רשימה ריקה היא התשובה הנכונה למי שאינו/ה מנהל/ת פלטפורמה. שגיאה
-- הייתה מספרת לקורא/ת שהפונקציה קיימת ומה שמה.
--
-- אידמפוטנטית: ‎create or replace‎ בלבד, בלי DDL על טבלאות.
-- ============================================================================

create or replace function public.subscription_members(p_bucket text)
returns table (
  member         uuid,
  member_name    text,
  member_email   text,
  member_slug    text,
  agency_name    text,
  now_tier       text,
  source_now     text,
  wanted_tier    text,
  asked_on       date,
  promo_ends     timestamptz,
  wallet_balance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id,
         m.display_name,
         m.email,
         coalesce(nullif(m.slug, ''), m.id::text),
         a.name,
         m.tier,
         m.tier_source,
         m.pending_tier_change,
         m.pending_tier_change_at,
         m.promo_ends_at,
         m.credit_balance
    from public.agency_members m
    left join public.agencies a on a.id = m.agency_id
   where public.current_is_platform_admin()
     and m.active = true
     and case p_bucket
           when 'free'    then m.tier = 'free'
           when 'mid'     then m.tier = 'mid'
           when 'premium' then m.tier = 'premium'
           when 'promo_active' then
             m.promo_ends_at > now() and m.promo_ended_at is null
           when 'promo_ending_30' then
             m.promo_ends_at > now()
             and m.promo_ends_at <= now() + interval '30 days'
             and m.promo_ended_at is null
           when 'pending' then m.pending_tier_change is not null
           -- קטגוריה שאינה מוכרת מחזירה ריק ולא שגיאה: הקורא היחיד הוא
           -- כפתור במסך, ושם טעות כתיב לא צריכה להפיל את הקטגוריה כולה.
           else false
         end
   -- הסדר הוא סדר השימוש: בקטגוריות ההטבה השאלה היא מי ראשון/ה בתור לגמור,
   -- בתור הבקשות מי ממתין/ה הכי הרבה זמן, ובשאר פשוט לפי שם.
   order by case when p_bucket in ('promo_active', 'promo_ending_30')
                 then m.promo_ends_at end asc nulls last,
            case when p_bucket = 'pending'
                 then m.pending_tier_change_at end asc nulls last,
            m.display_name;
$$;

comment on function public.subscription_members(text) is
  'המנויים שמאחורי מספר אחד בתמונת המצב. ריקה למי שאינו/ה מנהל/ת פלטפורמה.';

revoke all on function public.subscription_members(text) from public;
revoke all on function public.subscription_members(text) from anon;
grant execute on function public.subscription_members(text) to authenticated, service_role;

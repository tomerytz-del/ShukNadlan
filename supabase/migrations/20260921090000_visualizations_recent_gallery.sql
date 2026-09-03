-- ============================================================================
-- גלריית ההדמיות האחרונות שהופקו במערכת
-- ----------------------------------------------------------------------------
-- ‏property_visualizations_public מציג אך ורק הדמיות בסיס (‏is_base = true) —
-- הסט שנוצר אוטומטית עם פרסום הנכס ומוצג בגלריה שלו. זה נשאר כפי שהוא.
--
-- מה שחסר הוא מקור שני: ההדמיות שנוצרו לפי דרישה. הן פומביות — מי שמפיק
-- הדמיה באתר מפרסם אותה לשאר הגולשים — אבל לא היה שום נתיב שדרכו גולש
-- אנונימי יכול לראות אותן, כי ‏property_visualizations עצמו סגור ב-RLS
-- למתווך/ת שהנכס שייך לו/ה. התוצאה: תיבת ההדמיה בנכס מסחרי הציגה רשת
-- ריקה גם כשבמערכת כבר היו עשרות הדמיות מוכנות.
--
-- ה-view הזה הוא הנתיב הזה. שלוש מגבלות מרכיבות אותו:
--
--   1. **רק מה שהושלם.** ‏status = 'done' ועם תוצאה בפועל.
--   2. **רק נכסים חיים וזכאים.** נכס שהוסר מהאוויר לא ממשיך לפרנס גלריה
--      במקום אחר באתר, ואותה בדיקת זכאות שחלה על ההדמיות עצמן חלה גם כאן.
--   3. **בלי job_id ובלי error_detail.** ‏job_id מקשר לבקשה שנשלחה, ואיתה
--      לשם ולטלפון של מי שהשאיר/ה פרטים; ‎error_detail‎ הוא טקסט תקלה
--      פנימי. שניהם לא יוצאים החוצה, גם כשהתמונה עצמה כן.
--
-- ההפרדה לשני view נשמרת בכוונה: גלריית הנכס עצמו ממשיכה לשאול "מה הסט
-- הרשמי של הנכס הזה", והגלריה החדשה שואלת "מה המערכת ייצרה לאחרונה". שתי
-- שאלות שונות, ואיחוד שלהן היה מציג הדמיה שגולש/ת ביקש/ה כאילו היא חלק
-- מהמצגת הרשמית של הנכס.
-- ============================================================================

create or replace view public.property_visualizations_recent as
select
  v.property_id,
  v.kind,
  v.target,
  v.style_key,
  v.source_image_url,
  v.result_url,
  v.is_base,
  v.created_at
from public.property_visualizations v
join public.properties p on p.id = v.property_id
where v.status = 'done'
  and v.result_url is not null
  and p.status = 'active'
  and public.property_visualizations_enabled(v.property_id);

comment on view public.property_visualizations_recent is
  'כל ההדמיות המוכנות של נכסים פעילים וזכאים — כולל אלה שנוצרו לפי דרישה. מזין את גלריית "הופקו לאחרונה". ללא job_id וללא error_detail.';

-- ‏security_invoker=off (ברירת המחדל) בכוונה: ה-view הוא בדיוק שכבת
-- ההרשאה כאן. ‏property_visualizations סגור ב-RLS לבעליו, וה-view הוא
-- החלון המצומצם שדרכו קורא אנונימי רואה את מה שפומבי בלבד.
grant select on public.property_visualizations_recent to anon, authenticated;

-- הגלריה נשלפת ממוינת לפי זמן ומוגבלת לכמה פריטים, ולכן זה האינדקס שהיא
-- באמת נשענת עליו.
create index if not exists property_visualizations_recent_idx
  on public.property_visualizations (created_at desc)
  where status = 'done' and result_url is not null;

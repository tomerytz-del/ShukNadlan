-- ============================================================================
-- רשימת התפוצה — הרשמה לעדכוני נכסים חדשים
--
-- הטופס יושב בפוטר של דף הבית ומבקש דבר אחד בלבד: אימייל. זו הרשמה
-- קלת־משקל, ולכן היא *לא* טבלת לידים: אין כאן שם, אין טלפון, אין קריטריוני
-- חיפוש, אין ניתוב לסוכן/ת ואין מה למכור. מי שרוצה התראה על נכס מתאים נרשם/ת
-- לסוכן החכם (`saved_searches`) — שם יש קריטריונים, הסכמה ליצירת קשר ומדף.
--
-- שלוש החלטות שקובעות את המבנה:
--
--   1. **הטבלה סגורה לחלוטין ל-anon ול-authenticated.** אימייל של אדם פרטי
--      הוא מידע אישי, ורשימת תפוצה גלויה היא רשימת יעדים לספאם. הכתיבה
--      נעשית ב-service_role מתוך ‏`newsletter-subscribe`, בדיוק כמו בכל שאר
--      הטפסים הציבוריים באתר, והקריאה נעשית מהמערכת בלבד.
--   2. **האימייל הוא המפתח, מנורמל ל-lowercase.** הרשמה חוזרת של אותה
--      כתובת אינה שגיאה ואינה שורה שנייה — היא מעדכנת את החותמת האחרונה.
--      ‏`Tomer@X.com` ו-`tomer@x.com` הם אותו אדם, ובלי הנרמול היו שתי שורות
--      ושני מיילים.
--   3. **הסרה היא עדכון, לא מחיקה.** ‏`unsubscribed_at` נשמר כדי שהרשמה
--      חוזרת לא תדרוס בקשת הסרה בשקט, ומי שביקש/ה לצאת לא יקבל/תקבל דיוור
--      גם אם הכתובת תיובא שוב מאיזה קובץ.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

create table if not exists public.newsletter_subscribers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  -- מאיפה נרשמו. טקסט חופשי ולא enum מאותה סיבה כמו ב-leads.source: מקור
  -- חדש (דף נחיתה, קמפיין, QR) לא אמור לדרוש DDL.
  source        text not null default 'homepage_footer',
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  unsubscribed_at timestamptz,
  constraint newsletter_subscribers_email_format
    check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.newsletter_subscribers is
  'רשימת התפוצה של עדכוני הנכסים. אימייל בלבד, מנורמל ל-lowercase. סגורה ל-anon — הכתיבה דרך newsletter-subscribe ב-service_role.';
comment on column public.newsletter_subscribers.unsubscribed_at is
  'בקשת הסרה. שורה עם ערך כאן לא נכללת בדיוור, וגם הרשמה חוזרת לא מנקה אותה — הסרה מבוטלת רק ביוזמת הנרשם/ת מקישור ההסרה.';

-- הדיוור שולף "כל מי שרשום/ה ולא ביקש/ה לצאת". אינדקס חלקי על התאריך נותן
-- בדיוק את זה בלי לאנדקס את המוסרים.
create index if not exists newsletter_subscribers_active_idx
  on public.newsletter_subscribers (created_at desc)
  where unsubscribed_at is null;

alter table public.newsletter_subscribers enable row level security;

-- אין policy במכוון: RLS פעיל בלי אף מדיניות = הטבלה סגורה לכל תפקיד שאינו
-- service_role. זו לא השמטה — זו ההגדרה.

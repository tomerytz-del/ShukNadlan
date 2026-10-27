-- ============================================================================
-- סגירת leads_masked ו-views ציבוריים שנשארו עם הרשאת כתיבה
--
-- הוחל ידנית על הפרודקשן בשם security_fix_view_grants_20261026, לפני
-- שהקובץ נכנס לריפו. הסיומת של שם הקובץ חייבת להישאר זהה לשם הרשומה:
-- ה-workflow מזהה רשומה בלי version תואם לפי השם, מוחק אותה מההיסטוריה,
-- ומריץ את הקובץ הזה תחת ה-version שבשמו. הגוף אידמפוטנטי, ולכן ההרצה
-- השנייה אינה משנה את הסכימה.
--
-- leads_masked בלי security_invoker רץ כבעלים (postgres, BYPASSRLS) ובלי
-- where, ומפתח ה-anon הציבורי קרא את כל הלידים הפתוחים. כתיבה על
-- market_cities_public, rss_leads_public ו-planning_lookups_public נשארה
-- כי grant select אינו מבטל את ALL שברירת המחדל של הסכימה public מעניקה
-- ל-view חדש. mortgage_leads_public נסגר ל-anon לגמרי; הקריאה נשארת
-- ל-authenticated.
--
-- לא נוגעים כאן ב-Leaked password protection (מתג במסך Auth) ולא ב-
-- search_path של פונקציות.
-- ============================================================================

alter view public.leads_masked set (security_invoker = true);

revoke all on public.leads_masked from public, anon;

revoke insert, update, delete, truncate, references, trigger
  on public.market_cities_public from public, anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.rss_leads_public from public, anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.planning_lookups_public from public, anon, authenticated;

revoke all on public.mortgage_leads_public from public, anon;

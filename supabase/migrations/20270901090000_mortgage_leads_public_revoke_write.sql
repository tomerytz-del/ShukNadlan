-- ============================================================================
-- סגירת כתיבה דרך mortgage_leads_public
--
-- ה-view רץ כבעלים (בלי security_invoker) מעל mortgage_leads, ולכן כתיבה
-- דרכו עוקפת את ה-RLS. אחרי 20270831090000 ל-anon אין הרשאה, אבל
-- authenticated נשאר עם INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
-- בנוסף ל-SELECT. כל משתמש/ת מחובר/ת יכול/ה לשנות או למחוק לידי משכנתא.
--
-- SELECT נשאר ל-authenticated: מדף ה-CRM (loadMortgageShelf) קורא מה-view.
-- אין בריפו כתיבה דרכו. הקליטה והרכישה כותבות לטבלה דרך service_role.
--
-- לא נוגעים ב-security_invoker. הדלקה שלו הייתה מחילה את ה-RLS של הקורא/ת,
-- וליד במצב new אינו שייך לקונה, כך שמדף היועצים היה מתרוקן.
--
-- revoke חוזר הוא no-op, ולכן המיגרציה אידמפוטנטית.
-- ============================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.mortgage_leads_public from public, anon, authenticated;

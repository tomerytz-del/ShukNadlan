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
--
-- הסיומת של שם הקובץ חייבת להישאר mortgage_leads_public_revoke_writes_20261027.
-- כך נרשמה ההחלה הידנית (version 20261027010551). ה-workflow מזהה את
-- הרשומה לפי השם, מוחק אותה מההיסטוריה, ומריץ את הקובץ הזה תחת
-- 20270901090000. שינוי הסיומת מחזיר את "Remote migration versions not
-- found" ועוצר כל db push.
-- ============================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.mortgage_leads_public from public, anon, authenticated;

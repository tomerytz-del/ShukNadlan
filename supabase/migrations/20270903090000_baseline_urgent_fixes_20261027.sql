-- ============================================================================
-- סנכרון הריפו עם baseline_urgent_fixes_20261027
--
-- הוחל על הפרודקשן (obookujgolazrwycsiyn) ב-2026-10-27, version
-- 20261027013404, באישור הבעלים, לפני שהקובץ נכנס לריפו. הסיומת של שם
-- הקובץ חייבת להישאר baseline_urgent_fixes_20261027: ה-workflow מזהה
-- רשומה בלי version תואם לפי השם, מוחק אותה מההיסטוריה, ומריץ את הקובץ
-- הזה תחת 20270903090000. הגוף אידמפוטנטי, ולכן ההרצה השנייה אינה משנה
-- את הסכימה. אין כאן DDL חדש מעבר למה שכבר רץ.
--
-- ה-version הוא 20270903090000 ולא 20270902090000: את המספר הזה תפסה
-- 20270902090000_notification_push_quiet_hold (#1007). היא אינה נוגעת
-- ב-views האלה ולא ב-agent_share_fit, והיא רצה לפני הקובץ הזה.
--
-- market_city_names נולד ב-20270115101000 בלי security_invoker, עם
-- grant select שאינו מבטל את ALL שברירת המחדל. anon ו-authenticated
-- יכלו לעדכן ולמחוק את 1,163 הערים. הקריאה באתר אינה עוברת בו (ה-CRM
-- קורא מ-cities); רק service_role, למשל office-coach. לכן revoke all
-- משלושת התפקידים, ואז security_invoker. service_role שומר את ה-grant
-- שברירת המחדל נתנה לו, והוא עוקף RLS.
--
-- saved_search_leads_public ו-project_leads_shelf נשארים views של הבעלים.
-- הדלקת security_invoker על project_leads_shelf הייתה מרוקנת את מדף
-- היזמים (ליד במדף אינו שייך לאיש, וה-RLS על project_leads סוגר אותו).
-- כאן נסגרת רק הכתיבה. SELECT ל-authenticated נשאר: ה-CRM
-- (saved_search_leads_public) ו-developer-crm (project_leads_shelf)
-- קוראים, ו-saved-search-intake קורא ב-service_role.
--
-- agent_share_fit הוגדרה ב-20270711090000 ונלקח ממנה EXECUTE של
-- authenticated, מתוך הנחה שה-view רץ כבעלים ולכן הדפדפן אינו צריך אותה.
-- PostgreSQL בודק EXECUTE על פונקציה מול הקורא/ת, לא מול בעל ה-view.
-- shared_properties_for_me ("נכסים ששותפו איתי") חזר 403. ה-grant מחזיר
-- EXECUTE ל-authenticated בלבד. anon נשאר סגור מה-revoke של 20270711090000.
--
-- אין אחרי הקובץ הזה מיגרציה, seed או סקריפט שמחזירים כתיבה על שלושת
-- ה-views או שלוקחים שוב את ה-EXECUTE. הערה ישנה ב-20270115101000
-- ("בלי security_invoker בכוונה") מתארת את המצב שלפני ההחלה הזו.
-- ============================================================================

revoke all on public.market_city_names from public, anon, authenticated;
alter view public.market_city_names set (security_invoker = true);
revoke insert, update, delete, truncate, references, trigger on public.saved_search_leads_public from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.project_leads_shelf from public, anon, authenticated;
grant execute on function public.agent_share_fit(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- סגירת saved_search_quiet_now() ל-anon ול-authenticated
--
-- ‏20260830090000_saved_search_alerts.sql סגר את כל פונקציות ההתראות ל-
-- ‏service_role, חוץ משתיים שנשכחו: פונקציית הטריגר (נסגרה ב-651e122) ו-
-- ‏saved_search_quiet_now(), שנשארה פתוחה עד היום. נבדק מול המסד בקריאה
-- בלבד (has_function_privilege): ‏anon ו-authenticated מחזיקים EXECUTE,
-- והיא חשופה ב-/rest/v1/rpc/saved_search_quiet_now.
--
-- הנזק קטן - SECURITY INVOKER שקוראת שתי שורות מ-pricing_config ומחזירה
-- בוליאני - אבל זה בדיוק הדפוס שהכלל ב-new-migration קיים בשבילו, והיא
-- נמצאה בהשוואת סקירות קוד ולא באף בדיקה.
--
-- מי קורא לה, ולמה זה לא שובר אף אחד מהם:
--   ‏· saved_search_pending_alerts() - SECURITY DEFINER, רצה כבעלים.
--   ‏· ה-cron של 20261021090000 - רץ כ-postgres.
--   ‏· service_role מקבל הרשאה מפורשת, למקרה של קריאה ישירה מ-Edge Function.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

revoke all on function public.saved_search_quiet_now() from public, anon, authenticated;
grant execute on function public.saved_search_quiet_now() to service_role;

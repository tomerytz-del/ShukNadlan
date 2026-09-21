-- ============================================================================
-- ‏revoke from public אינו מוציא את anon — סגירת חמש פונקציות קריאה
--
-- ## מה פתוח היום, ולמה זה לא נראה כך בקוד
--
-- הסוכן התפעולי דיווח על `city_id_from_address` כשליפה פתוחה לאנונימי/ת
-- בלי בדיקת הרשאה. המיגרציה שיצרה אותה (‏20261212090000) כתבה במפורש את
-- ההיפך:
--
--     revoke all on function public.city_id_from_address(text) from public;
--     grant execute on function public.city_id_from_address(text)
--       to authenticated, service_role;
--
-- שתי השורות האלה נראות כמו צמצום ל-authenticated, ואינן. ‏Supabase
-- מגדירה הרשאות ברירת מחדל לסכימה public:
--
--     alter default privileges in schema public
--       grant all on functions to anon, authenticated, service_role;
--
-- ולכן כל פונקציה שנוצרת שם נולדת עם EXECUTE ל-anon כהרשאה **ישירה**, לא
-- דרך PUBLIC. ‏`revoke ... from public` מוריד את הרשאת ה-PUBLIC של
-- Postgres ואינו נוגע בה, וה-`grant` שאחריו **מוסיף** ואינו מחליף.
--
-- ב-proacl רואים את שתי ההרשאות בנפרד, וזה כל ההבדל:
--
--     postgres=X | anon=X | authenticated=X | service_role=X   ← פתוח
--     postgres=X | service_role=X                              ← סגור
--
-- ‏PostgREST חושף כל פונקציה ב-/rest/v1/rpc/<שם>, ומפתח ה-anon יושב גלוי
-- בקוד המקור של כל דף באתר - כי זה תפקידו. כלומר חמש הפונקציות שלמטה הן
-- נקודות קצה פומביות, גם כשהמיגרציות שיצרו אותן הצהירו על ההיפך.
--
-- ## ‏זה קרה כאן פעמיים, ובאותו קובץ פעם אחת
--
-- ‏20261112090000_revoke_anon_tier_rpc.sql סגרה חמש פונקציות **כתיבה**
-- מאותה סיבה בדיוק. ‏`city_id_from_address` נכתבה חודש אחרי אותה סגירה,
-- עם אותה שורת revoke, ונשארה פתוחה. ובאותו קובץ עצמו
-- ‏`agencies_backfill_city_id` כן כתבה `from public, anon, authenticated`
-- ונסגרה כראוי - שתי שורות, שני גורלות, אותו מיזוג.
--
-- הלקח לא החזיק כי שום דבר לא אכף אותו, ולכן נכנסת יחד עם המיגרציה הזו
-- בדיקת CI: ‏scripts/check_function_grants.py.
--
-- ## החמש, ולמה הסגירה בטוחה בכל אחת
--
--   city_id_from_address(text)      אין לה שום קורא/ת מחוץ למסד. הטריגר
--                                   agencies_set_city_id והפונקציה
--                                   agencies_backfill_city_id הן
--                                   SECURITY DEFINER בבעלות postgres,
--                                   ולכן קוראות לה בהרשאות הבעלים.
--   agent_reminder_findings(uuid)   נקראת מ-assets/crm.js ומ-Edge Function
--                                   agent-reminders - שניהם מחוברים.
--   video_uplift_ratio()            נקראת רק מתוך agent_reminder_findings,
--                                   שהיא SECURITY INVOKER - כלומר בהרשאות
--                                   של authenticated, שנשארת לה.
--   order_lead_candidates(uuid[])   נקראת רק מ-Edge Function
--                                   owner-lead-intake, עם service_role.
--   property_video_job_status(uuid) נקראת מ-assets/crm.js ומ-Edge Function
--                                   property-video-create.
--
-- **אין אף קריאה אנונימית מהדפדפן.** בדיקה: grep על שם כל אחת בקובצי
-- ה-HTML וה-assets מחזיר רק את הדפים שמחייבים התחברות.
--
-- ‏**ואין אף policy של RLS שקוראת לאחת מהן** - נבדק ב-pg_policies מול
-- qual ו-with_check. זה מה שהיה הופך את הסגירה למסוכנת: policy שחלה על
-- התפקיד public וקוראת לפונקציה שאין ל-anon הרשאה עליה מחזירה
-- permission denied במקום אפס שורות.
--
-- ## מה **לא** נסגר כאן, וזו החלטה ולא השמטה
--
-- ‏`current_is_platform_admin()` מוענקת ל-authenticated ונשארת פתוחה
-- ל-anon בכוונה: חמש policy-ות קוראות לה, ושלוש מהן חלות על התפקיד
-- public - כלומר גם על anon. היא עצמה הגייט, ומחזירה false למי שאינו
-- מחובר/ת. החריג מתועד ב-ALLOW ב-scripts/check_function_grants.py.
--
-- וכן אינן נסגרות הפונקציות שהוענקו ל-anon **במפורש** - דגלי תצוגה
-- כמו property_map_enabled ו-city_id_for_name, שדפי הנכס קוראים בלי
-- התחברות. הענקה מפורשת היא החלטה מוצהרת, לא תקלה.
--
-- ## אידמפוטנטיות
--
-- ‏revoke על הרשאה שכבר בוטלה אינה שגיאה, ו-grant חוזר אינו משנה דבר.
-- ‏to_regprocedure מחזיר null כשחתימה אינה קיימת, וכך המיגרציה מדלגת
-- במקום להפיל את כל ה-job אם פונקציה תשתנה בעתיד.
--
-- תיעוד: docs/supabase-migrations.md, docs/cities-and-regions.md
-- ============================================================================

do $$
declare
  specs constant text[][] := array[
    -- חתימה, התפקידים שנשארים
    ['public.city_id_from_address(text)',      'authenticated, service_role'],
    ['public.agent_reminder_findings(uuid)',   'authenticated, service_role'],
    ['public.video_uplift_ratio()',            'authenticated, service_role'],
    ['public.property_video_job_status(uuid)', 'authenticated, service_role'],
    ['public.order_lead_candidates(uuid[])',   'service_role']
  ];
  i integer;
begin
  for i in 1 .. array_length(specs, 1) loop
    if to_regprocedure(specs[i][1]) is null then
      raise notice 'skipping missing function %', specs[i][1];
      continue;
    end if;

    -- שתי השורות נדרשות יחד: הראשונה להרשאת PUBLIC של Postgres,
    -- השנייה להרשאה הישירה שהגיעה מברירת המחדל של Supabase.
    execute format('revoke all on function %s from public', specs[i][1]);
    execute format('revoke all on function %s from anon', specs[i][1]);
    execute format('grant execute on function %s to %s',
                   specs[i][1], specs[i][2]);

    raise notice 'closed % to anon, kept %', specs[i][1], specs[i][2];
  end loop;
end $$;

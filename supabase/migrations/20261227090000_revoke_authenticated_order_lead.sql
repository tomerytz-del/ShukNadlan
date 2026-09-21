-- ============================================================================
-- ‏order_lead_candidates — סגירת התפקיד שנשאר פתוח: authenticated
--
-- ## מה נשאר פתוח, ולמה בדיוק
--
-- ‏`20261226090000` סגרה חמש פונקציות בפני `anon`, ובהן זו. אבל
-- ‏`order_lead_candidates` שונה מארבע האחרות: המיגרציה שיצרה אותה
-- (‏`20260828200000_reviews_engine`) העניקה **‏`service_role` בלבד** —
--
--     grant execute on function public.order_lead_candidates(uuid[])
--       to service_role;
--
-- בלי שום `revoke`. וארבע האחרות התכוונו ל-`authenticated, service_role`.
-- כלומר בזו ההצהרה הדירה גם את `authenticated`, והסגירה הקודמת ביטלה
-- ‏`public` ו-`anon` בלבד — ולכן הרשאת ברירת המחדל של `authenticated`
-- **שרדה**:
--
--     postgres=X | authenticated=X | service_role=X     ← המצב עכשיו
--     postgres=X | service_role=X                       ← ההצהרה המקורית
--
-- זה אותו מנגנון בדיוק שתואר ב-`20261226090000`, תפקיד אחד הלאה: הרשאות
-- ברירת המחדל של Supabase מעניקות `EXECUTE` ל-**שלושת** התפקידים, ומי
-- שמונה שניים מהם ב-`revoke` משאיר את השלישי.
--
-- ## מה זה חושף בפועל
--
-- ‏`order_lead_candidates` היא `SECURITY DEFINER` בלי בדיקת זהות, והיא
-- קוראת את `agent_lead_preferences` **חוצה-סוכנים** — זו כל הסיבה שהיא
-- ‏DEFINER. כלומר כל מי שמחובר/ת יכול/ה לקרוא לה עם מזהי סוכנים
-- שרירותיים ולקבל בחזרה את הסדר שהמערכת נותנת להם.
--
-- זו דליפת מידע בין סוכנים, לא הסלמת הרשאות: אין כתיבה, והפונקציה אינה
-- מחזירה את תוכן ההעדפות אלא סדר. לכן `medium` ולא `high` — אבל היא גם
-- לא מה שההצהרה ביקשה.
--
-- ## למה הסגירה בטוחה
--
-- ‏**קורא/ת אחד/ת בלבד:** ‏Edge Function `owner-lead-intake`, שמריצה
-- ‏`supabase.rpc("order_lead_candidates", …)` עם
-- ‏`SUPABASE_SERVICE_ROLE_KEY`. ההערה בראש הקובץ שם אומרת זאת במפורש
-- ("רץ עם service_role - צריך לקרוא חוצי-סוכנים").
--
-- ‏**ואין אף קורא/ת אחר/ת במסד** — נבדק מול שלושה מקורות ולא רק grep:
--
--   · ‏`pg_proc`: אין גוף פונקציה אחרת שמזכיר אותה
--   · ‏`pg_policies`: אין policy שקוראת לה ב-`qual` או ב-`with_check`
--   · ‏`information_schema.views`: אין view שמסתמך עליה
--
-- זה מה שהיה הופך את הסגירה למסוכנת: פונקציה `SECURITY INVOKER` שקוראת
-- לה הייתה מאבדת את ההרשאה יחד עם הקורא/ת — בדיוק היחס שבין
-- ‏`agent_reminder_findings` ל-`video_uplift_ratio`, ששם **כן** שמרנו
-- ‏`authenticated` לשתיהן מהסיבה הזו.
--
-- ‏**ו-`service_role` אינו נפגע:** הוא מחזיק הרשאה מפורשת
-- (‏`service_role=X/postgres` ב-proacl), ו-`postgres` הוא הבעלים.
--
-- ## אידמפוטנטיות
--
-- ‏`revoke` על הרשאה שבוטלה אינה שגיאה, ו-`grant` חוזר אינו משנה דבר.
-- ‏`to_regprocedure` מחזיר null כשהחתימה אינה קיימת, וכך המיגרציה מדלגת
-- במקום להפיל את ה-job.
--
-- תיעוד: docs/supabase-migrations.md (כלל 6), docs/lead-routing.md
-- ============================================================================

do $$
declare
  fn constant text := 'public.order_lead_candidates(uuid[])';
begin
  if to_regprocedure(fn) is null then
    raise notice 'skipping missing function %', fn;
    return;
  end if;

  -- שלושת התפקידים בשם, ולא `from public` בלבד: זו כל הנקודה.
  execute format('revoke all on function %s from public', fn);
  execute format('revoke all on function %s from anon', fn);
  execute format('revoke all on function %s from authenticated', fn);
  execute format('grant execute on function %s to service_role', fn);

  raise notice 'closed % to anon and authenticated, kept service_role', fn;
end $$;

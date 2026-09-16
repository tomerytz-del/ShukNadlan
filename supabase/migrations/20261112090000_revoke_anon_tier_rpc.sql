-- ============================================================================
-- סגירת חמש פונקציות כתיבה בפני anon — כל אחת מהן היא היום קריאת REST פתוחה
--
-- ## מה פתוח היום
--
-- חמש פונקציות ‎SECURITY DEFINER‎ שכותבות למסד מחזיקות הרשאת ‎EXECUTE‎
-- ל-‎anon‎ ול-‎authenticated‎. ‏PostgREST חושף כל פונקציה כזו ב-
-- ‎/rest/v1/rpc/<שם>‎, והמפתח הציבורי שנדרש כדי לקרוא לה יושב גלוי בקוד
-- המקור של כל דף באתר (‎SUPABASE_ANON_KEY‎) — כי זה תפקידו.
--
-- אף אחת מהחמש אינה בודקת מי הקורא/ת.
--
-- הקשה מכולן היא ‎record_tier_selection(p_member_id, p_tier, …)‎. היא
-- מקבלת מזהה חבר/ה ומסלול, ומעדכנת ‎agency_members.tier‎ — בלי שום בדיקה.
-- את המזהים אי אפשר להסתיר: ‎agency_members_public‎ פתוח ל-anon בכוונה (זה
-- מה שמזין את דפי הסוכנים), והעמודה הראשונה בו היא ‎id‎. כלומר שתי בקשות
-- HTTP בלי התחברות בכלל:
--
--   GET  /rest/v1/agency_members_public?select=id
--   POST /rest/v1/rpc/record_tier_selection  {"p_member_id":"…","p_tier":"free"}
--
-- והן מורידות כל מנוי/ה משלם/ת ל-‎free‎ — או מעלות את מי שרוצה ל-‎premium‎.
-- זו כתיבה ישירה למצב החיובי של הפלטפורמה, מגולש אנונימי.
--
-- השאר באותו דפוס: ‎grant_launch_promo‎ מעניקה חצי שנה של מסלול בתשלום
-- (יש לה שומר — רק חבר/ה ב-‎free‎ שלא בחר/ה מסלול — אבל לא שומר על מי
-- קורא/ת), ‎expire_launch_promos‎ מריצה את מחזור הסיום מתי שמישהו יחליט,
-- ו-‎request_review_for_lead‎ מייצרת שורות ב-‎review_requests‎ וב-
-- ‎notifications‎ לכל ‎lead_id‎ שינחשו — ערוץ ספאם אל תוך מרכז ההתראות.
--
-- ## למה הסגירה בטוחה
--
-- כל חמש הפונקציות נקראות **רק** מ-Edge Functions, ורק דרך לקוח
-- ‎service_role‎:
--
--   record_tier_selection    → Edge Function join-agency
--   grant_launch_promo       → _shared/launch-promo.ts (create-own-agency,
--                              join-agency, add-team-member, agency-signup)
--   expire_launch_promos     → Edge Function promo-lifecycle
--   request_review_for_lead  → טריגרים במסד (enqueue_review_requests,
--                              request_reviews_on_property_sold)
--   enqueue_review_requests  → משימת pg_cron בשם ‎enqueue-review-requests‎
--                              (‎0 4 * * *‎), שרצה כ-‎postgres‎
--
-- אין אף קריאה מהדפדפן. בדיקה: ‎grep -rn '<שם>' --include=*.html .‎ מחזירה
-- אפס התאמות בקוד הדפים.
--
-- ‏service_role מחזיק/ה הרשאה **מפורשת** על כל החמש (‎service_role=X/postgres‎
-- ב-proacl), ולכן ביטול ההרשאה מ-‎anon‎, מ-‎authenticated‎ ומ-‎PUBLIC‎ אינו
-- נוגע בו. ‎postgres‎ הוא הבעלים של כל החמש — ולכן גם משימת ה-pg_cron וגם
-- הטריגרים (‎SECURITY DEFINER‎ בבעלות ‎postgres‎) ממשיכים לעבוד: ההרשאה
-- נבדקת מול הבעלים ולא מול הגולש/ת.
--
-- שתיים מהחמש נושאות גם הרשאת ‎PUBLIC‎ (‎=X/postgres‎), ולכן יש לבטל גם
-- אותה — ביטול מ-anon בלבד לא היה מספיק.
--
-- ## אידמפוטנטיות
--
-- ‎revoke‎ על הרשאה שכבר בוטלה אינה שגיאה, ו-‎grant‎ חוזר ל-service_role
-- אינו משנה דבר. המיגרציה בטוחה להרצה חוזרת.
-- ============================================================================

do $$
declare
  fn text;
  fns text[] := array[
    'public.record_tier_selection(uuid, text, text, text)',
    'public.grant_launch_promo(uuid, text, integer)',
    'public.expire_launch_promos()',
    'public.request_review_for_lead(uuid, text)',
    'public.enqueue_review_requests()'
  ];
begin
  foreach fn in array fns loop
    -- to_regprocedure מחזיר null כשהחתימה אינה קיימת — כך המיגרציה עוברת
    -- גם אם פונקציה תשתנה או תוסר בעתיד, במקום להפיל את כל ה-job
    if to_regprocedure(fn) is null then
      raise notice 'skipping missing function %', fn;
      continue;
    end if;

    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

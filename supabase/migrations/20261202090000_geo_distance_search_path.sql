-- ============================================================================
-- ‏geo_distance_meters מקבלת search_path קבוע
--
-- ## מה שבור
--
-- ‏`20261201090000` הוסיפה את `geo_distance_meters` בלי `set search_path`,
-- בניגוד לכל שאר הפונקציות שנכתבו באותה מיגרציה ובקודמתה. הלינטר של
-- Supabase מסמן אותה: ‏`function_search_path_mutable`.
--
-- ## למה זה מטריד גם כשהפונקציה היא חשבון טהור
--
-- הפונקציה אינה `security definer`, ולכן היא רצה בהרשאות הקורא — ההשפעה
-- מוגבלת. אבל הגוף שלה קורא ל-`sin`, ‏`cos`, ‏`radians`, ‏`power`,
-- ‏`sqrt` ו-`asin` בשמות לא מוסמכים, ופתרון שמות שתלוי ב-`search_path`
-- של הקורא הוא בדיוק הדפוס שאין סיבה להשאיר. חשוב מזה: **פונקציה אחת
-- שחורגת מהכלל הופכת את הכלל לעניין של טעם**, והביקורת הבאה תצטרך
-- להחליט בכל פעם מחדש אם חריגה כזו בסדר.
--
-- ‏`search_path = ''` בטוח כאן: ‏`pg_catalog` נסרק תמיד ראשון ואי אפשר
-- להסיר אותו, ולכן כל הפונקציות המתמטיות ממשיכות להיפתר. נבדק בהרצה עם
-- ‏`set local search_path = ''` לפני כתיבת הקובץ.
--
-- החתימה, הגוף וההתנהגות זהים. ‏`agent_cma_report` אינה משתנה.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

create or replace function public.geo_distance_meters(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  end;
$$;

comment on function public.geo_distance_meters(double precision, double precision, double precision, double precision) is
  'מרחק אווירי במטרים בין שתי נקודות WGS84 (הוורסין). הייתה משוכפלת שלוש פעמים בגוף agent_cma_report.';

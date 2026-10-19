-- ‏מסלול 'samsung' במונה ההתקנות.
--
-- הדפדפן של סמסונג באנדרואיד בונה את קובץ ההתקנה (‏WebAPK) בשרת של
-- סמסונג, ו-Google Play Protect חוסם אותו ("אפליקציה לא בטוחה נחסמה").
-- מעכשיו assets/pwa-install.js מציע שם "פתיחה בכרום" במקום התקנה, תחת
-- mode = 'samsung' (‏docs/pwa-install.md).
--
-- ‏pwa_install_events_platform_check מכיר רק את חמשת המסלולים הקודמים,
-- ושורה עם ערך שאינו ברשימה נדחית - הכתיבה מהדפדפן בולעת את השגיאה, כלומר
-- האירועים של המסלול החדש היו נעלמים בשקט מהדשבורד.
--
-- ‏**מוסיפים לרשימה הקיימת ולא כותבים אותה מחדש** (כלל 8 בסקיל
-- new-migration): הערכים נקראים מהאילוץ כפי שהוא ברגע הריצה, כך ש-PR
-- מקביל שהוסיף ערך משלו לא יימחק. אידמפוטנטית: אם 'samsung' כבר שם -
-- לא נוגעים.

do $$
declare
  v_def    text;
  v_values text[];
  v_list   text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'pwa_install_events_platform_check'
     and c.conrelid = 'public.pwa_install_events'::regclass;

  if v_def is not null and v_def like '%''samsung''%' then
    return;
  end if;

  if v_def is not null then
    select array_agg(m[1]) into v_values
      from regexp_matches(v_def, '''([^'']+)''', 'g') as m;
  end if;

  v_values := coalesce(v_values,
    array['prompt','ios','ios-other','in-app','mac-safari','unknown']) || array['samsung'];

  select string_agg(quote_literal(x), ',') into v_list
    from (select distinct unnest(v_values) as x) s;

  alter table public.pwa_install_events drop constraint if exists pwa_install_events_platform_check;
  execute format(
    'alter table public.pwa_install_events add constraint pwa_install_events_platform_check check (platform in (%s))',
    v_list);
end $$;

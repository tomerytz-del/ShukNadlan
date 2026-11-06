-- ===========================================================================
-- המרלו״גים שכבר במאגר עוברים לסוג החדש 'מרלו״ג/מרכז לוגיסטי'
--
-- הסוג נולד ב-20271106140000. עד אז סוכנים פרסמו מרלו״גים תחת הסוג הקרוב
-- ביותר, וכתבו "מרלו״ג" בכותרת. נבדק ב-6.11.2026 (בקריאה) על כל נכס
-- שהכותרת, התיאור או התיאור השיווקי שלו מכילים "מרלו" או "לוגיסט":
--
--   | מי              | הסוג היום      | מה בכותרת / בתיאור                   | כאן |
--   | שי דרזי (5)     | מחסנים / תעשייה | "מרלו״ג" בכותרת עצמה                 | כן  |
--   | מבואות הגלבוע   | מבני תעשייה     | "מבנה תעשייה/לוגיסטיקה", 2,544 מ"ר   | כן  |
--   | שי דרזי, אבן יהודה | אולמות       | "מחסן | 280 מ"ר ... אחסנה לוגיסטיקה" | לא  |
--   | עפולה עילית     | מבני תעשייה     | 200 מ"ר, "לוגיסט" רק בטקסט השיווקי  | לא  |
--
-- שני האחרונים אינם מרלו״ג: הראשון הוא מחסן (והסוג "אולמות" שלו הוא עניין
-- של הסוכן), והשני מבנה תעשייה קטן. לכן הקריטריון הוא **"מרלו" בכותרת**
-- - מה שהסוכן/ת עצמו/ה קרא/ה לנכס - ועוד הנכס במבואות הגלבוע לפי מזהה,
-- כי שם המילה היא "לוגיסטיקה" בתיאור ולא בכותרת. לא regex על התיאור:
-- "יכול לשמש לאחסנה לוגיסטיקה" אינו מרלו״ג.
--
-- המלכודת, כמו ב-20261202090000: ‏property_marketing_fingerprint() כוללת
-- את property_type, ולכן שינוי הסוג מסמן תיאור שיווקי טרי כמתיישן - קריאת
-- Claude על טקסט שכבר אומר "מרלו״ג". מי שהיה טרי לפני נשאר טרי אחרי;
-- מי שכבר התיישן נשאר מתיישן.
--
-- הטריגר properties_client_match_alerts_upd רץ על שינוי סוג ומחשב מחדש
-- את ההתאמות של הנכס. לקוח/ה שביקש/ה "מחסנים" בלבד לא יתאים עוד
-- למרלו״ג במסד (ההשוואה שם היא על הערך עצמו), וזה נכון: בשביל זה נולד
-- הסוג. באתר ובבוטים "מחסן" ממשיך לכלול מרלו״ג (PROPERTY_TYPES.warehouse).
--
-- אידמפוטנטית: הרצה שנייה מוצאת את הנכסים כבר בסוג החדש ומעדכנת אפס.
-- ===========================================================================

do $$
declare
  c_type  constant text := 'מרלו״ג/מרכז לוגיסטי';
  -- "מבני תעשייה במבואות גלבוע" - "מבנה תעשייה/לוגיסטיקה חדש", נדל"ן עפולה
  c_gilboa constant uuid := 'ebb0350f-cad3-4860-9c79-e89621abe7ea';
  v_fresh uuid[];
  v_rows  bigint;
begin
  -- 1. מי טרי לפני השינוי, מבין הנכסים שישתנו
  select array_agg(p.id) into v_fresh
    from public.properties p
   where p.category = 'commercial'
     and p.property_type is distinct from c_type
     and (coalesce(p.title, '') ~* 'מרלו' or p.id = c_gilboa)
     and p.marketing_description_fingerprint is not null
     and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p);

  -- 2. הסוג
  update public.properties p
     set property_type = c_type
   where p.category = 'commercial'
     and p.property_type is distinct from c_type
     and (coalesce(p.title, '') ~* 'מרלו' or p.id = c_gilboa);
  get diagnostics v_rows = row_count;
  raise notice 'מרלו״ג: % נכסים סווגו מחדש', v_rows;

  -- 3. טביעת האצבע חוזרת למי שהיה טרי
  update public.properties p
     set marketing_description_fingerprint = public.property_marketing_fingerprint(src)
    from public.properties src
   where src.id = p.id
     and p.id = any(coalesce(v_fresh, '{}'::uuid[]))
     and p.marketing_description_fingerprint is distinct from
         public.property_marketing_fingerprint(src);
  get diagnostics v_rows = row_count;
  raise notice 'טביעות אצבע שהוחזרו: % שורות', v_rows;
end $$;

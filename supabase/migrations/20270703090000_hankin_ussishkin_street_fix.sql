-- ============================================================================
-- "יהושוע חנקין" הוא "יהושע חנקין", ו"אוסישקין" הוא "מנחם אוסישקין"
--
-- ## מה נמצא (20.10.2026)
--
-- אחרי 20270702090000 התור של המידע התכנוני פתר 13 מ-22 הנכסים שהוחזרו.
-- ארבעה מהנכשלים הם "יהושוע חנקין" (6, 7, 7, 9) - שגיאת כתיב, ו"יהושוע"
-- אינו מתורגם בכוונה: street-resolve.ts אינו מנחש כתיב. השם הרשמי בשכבה
-- הוא "יהושע חנקין", וה-WFS כבר ענה עליו (‏planning_lookups: ‏7 ← 16699/9).
-- ההכרעה התקבלה מול מנהל/ת הפלטפורמה. אותו דבר ל"אוסישקין 61": התרגום
-- מצא אותו, אבל השדה עצמו נשאר קצר - והוא מפתח הכפילות ושם הרחוב בדף.
--
-- ## מה נבדק לפני הכתיבה
--
-- ‏`properties_guard_duplicate` נבדק לכל אחד מהנכסים: אחרי התיקון יש מפתח
-- זהה ל-"חנקין 7" (השניים זה לזה) ול-"חנקין 6" (מודעה אחרת של אותו סוכן),
-- אבל בכולם אין חדרים וקומה והשטח שונה (‏180/120, ‏ריק/70), ולכן הטריגר
-- מבחין ביניהם. ל"מנחם אוסישקין 61" אין נכס פעיל אחר באותו מפתח.
--
-- ‏`street_registry`: ‏"יהושוע חנקין" ו"מנחם אושיסקין" כבר רשומים כ-`legacy`
-- עם `active = false`, כלומר אינם מוצעים בטופס. אין מה למחוק.
--
-- ## טביעת האצבע של התיאור השיווקי
--
-- ‏property_marketing_fingerprint() כוללת את הרחוב ואת הכותרת. תיקון כתיב
-- אינו שינוי תוכן, ולכן מי שהיה טרי לפני מקבל טביעה מעודכנת ונשאר טרי -
-- אותה תבנית כמו 20261202090000_long_dash_backfill.sql.
--
-- ## והתורים
--
-- ניסיון אחד (‏`attempts = 2`) למידע התכנוני של חמשת נכסי חנקין 6/7/9 - כולל
-- 5962cef7, שכבר כתוב נכון ומיצה את התור בספטמבר על כתובת שהשכבה מכירה -
-- ולגאוקוד של חנקין 6, היחיד בלי פין. אין כאן DDL.
--
-- אידמפוטנטית: כל update מותנה בערך הישן, והרצה שנייה לא מוצאת שורות.
-- ============================================================================

do $$
declare
  v_ids   constant uuid[] := array[
    '74643d8f-6831-4332-b355-efb71519959e',  -- חנקין 7, ‏180 מ"ר
    '88bc4bbb-3a65-4289-b1c9-f34dd99ef756',  -- חנקין 7, ‏120 מ"ר
    '989b677f-da1e-448c-a69c-20ae5aef58ca',  -- חנקין 9
    'a83833e5-fd53-41fc-8a44-f06ed3bf558e',  -- חנקין 6
    '1ed50b1e-2b66-4f04-8525-ec9036cb2756'   -- אוסישקין 61
  ]::uuid[];
  v_fresh uuid[];
  v_rows  bigint;
begin
  -- 1. מי טרי לפני התיקון
  select array_agg(p.id) into v_fresh
    from public.properties p
   where p.id = any(v_ids)
     and p.marketing_description_fingerprint is not null
     and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p);

  -- 2. חנקין: רחוב, כתובת וכותרת
  update public.properties
     set street  = 'יהושע חנקין',
         address = replace(address, 'יהושוע חנקין', 'יהושע חנקין'),
         title   = replace(title,   'יהושוע חנקין', 'יהושע חנקין')
   where id = any(v_ids)
     and city = 'עפולה'
     and street = 'יהושוע חנקין';
  get diagnostics v_rows = row_count;
  raise notice 'חנקין: % שורות', v_rows;

  -- 3. אוסישקין: הרחוב והכתובת. הכותרת ("דירה 4 חדרים באוסישקין 61")
  --    היא ניסוח של הסוכן/ת ונכונה כמו שהיא.
  update public.properties
     set street  = 'מנחם אוסישקין',
         address = case when address = 'אוסישקין 61' then 'מנחם אוסישקין 61' else address end
   where id = '1ed50b1e-2b66-4f04-8525-ec9036cb2756'
     and city = 'עפולה'
     and street = 'אוסישקין';
  get diagnostics v_rows = row_count;
  raise notice 'אוסישקין: % שורות', v_rows;

  -- 4. טביעת האצבע למי שהיה טרי
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

-- 5. ניסיון אחד נוסף למידע התכנוני
update public.properties p
   set planning_attempted_at = null,
       planning_attempts     = least(planning_attempts, 2),
       planning_error        = null
 where p.id in ('74643d8f-6831-4332-b355-efb71519959e',
                '88bc4bbb-3a65-4289-b1c9-f34dd99ef756',
                '989b677f-da1e-448c-a69c-20ae5aef58ca',
                'a83833e5-fd53-41fc-8a44-f06ed3bf558e',
                '5962cef7-c6b6-4af3-8577-858378dbff61')
   and p.planning_error = 'address_not_found'
   and not exists (select 1 from public.property_planning_info i
                    where i.property_id = p.id and i.gush is not null);

-- 6. וגאוקוד לחנקין 6, היחיד בלי פין
update public.properties
   set geocode_attempted_at = null,
       geocode_attempts     = least(geocode_attempts, 2),
       geocode_error        = null
 where id = 'a83833e5-fd53-41fc-8a44-f06ed3bf558e'
   and (lat is null or lng is null)
   and geocode_error = 'address_not_found';

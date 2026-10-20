-- ============================================================================
-- היצירה 3, לא היצירה 5
--
-- ## מה תוקן (20.10.2026)
--
-- חמש המודעות בהיצירה (1036, 1039, 1065, 1074, 1086) נרשמו במספר בית 5.
-- הכתובת המדויקת היא **היצירה 3** - ההכרעה התקבלה מול מנהל/ת הפלטפורמה.
-- מתוקנים מספר הבית, הכתובת, הכותרת, ותיאור הסוכן/ת והתיאור השיווקי -
-- רק במופע המדויק "היצירה 5", כדי שלא ייגעו במספרים אחרים בטקסט.
--
-- ## מה **לא** נוגע, בכוונה
--
-- * **ההסכם החתום על מודעה 1086** (‏aaf558b2, ‏kind = buy) מזכיר את
--   "היצירה 5". הסכם חתום הוא מסמך משפטי שגופו נעול
--   (‏docs/client-agreements.md), ושכתוב שלו הוא זיוף. אם צריך תיקון -
--   זה תיקון מול הלקוח/ה, לא כאן.
-- * **הפוסטים שכבר עלו לפייסבוק** (‏property_publications) - רשומה היסטורית,
--   אותו כלל כמו 20261202090000_long_dash_backfill.sql.
-- * **הפין.** הוא הפין הזמני של המלאכה 25 (‏20261225090000), כי רחוב
--   היצירה עדיין אינו בשכבת הכתובות של העירייה. הוא נשאר כמו שהוא, וגם
--   ההחזרה שמתועדת שם (לפי הרחוב והקואורדינטה) ממשיכה לעבוד.
--
-- ## מה נבדק לפני הכתיבה
--
-- * ‏`properties_guard_duplicate`: אין נכס אחר בהיצירה 3. בין החמש עצמן
--   השטחים שונים (‏160/330/350/145/230, ו-1086 עם קומה 0), ולכן המפתח המשותף
--   אינו חוסם - הטריגר מבחין לפי השטח כשאין חדרים וקומה.
-- * **התיאור השיווקי:** טרי בכל החמש. ‏`properties_track_marketing_copy`
--   מסמן שינוי בתיאור השיווקי כאילו סוכן/ת כתב/ה אותו (‏source = 'agent',
--   ‏at = now). תיקון מספר בית אינו כתיבה מחדש, ולכן המקור, התאריך וטביעת
--   האצבע מוחזרים לכל נכס כפי שהיו - והוא נשאר טרי.
--
-- אידמפוטנטית: מותנית ב-`house_number = '5'`; הרצה שנייה אינה מוצאת שורות.
-- בלי DDL.
-- ============================================================================

do $$
declare
  v_ids constant uuid[] := array(
    select id from public.properties
     where city = 'עפולה' and street = 'היצירה' and house_number = '5'
       and listing_number in (1036, 1039, 1065, 1074, 1086)
  );
  v_rows bigint;
begin
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise notice 'היצירה 5: אין מה לתקן';
    return;
  end if;

  -- 1. מצב התיאור השיווקי לפני: מי טרי, ומאיפה הוא בא
  create temp table _hy_before on commit drop as
    select p.id,
           p.marketing_description_source as old_source,
           p.marketing_description_at     as old_at,
           (p.marketing_description_fingerprint is not null
            and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p)) as fresh
      from public.properties p
     where p.id = any(v_ids);

  -- 2. הכתובת והטקסטים
  update public.properties
     set house_number          = '3',
         address               = replace(address,               'היצירה 5', 'היצירה 3'),
         title                 = replace(title,                 'היצירה 5', 'היצירה 3'),
         description           = replace(description,           'היצירה 5', 'היצירה 3'),
         marketing_description = replace(marketing_description, 'היצירה 5', 'היצירה 3')
   where id = any(v_ids)
     and house_number = '5';
  get diagnostics v_rows = row_count;
  raise notice 'היצירה: % שורות', v_rows;

  -- 3. המקור, התאריך וטביעת האצבע - כפי שהיו, למי שהיה טרי
  --
  --    ‏`cur` ולא `src`: בגרסה הראשונה של הקובץ עמודה בטבלה הזמנית נקראה
  --    ‏`src`, ושם עמודה גובר על כינוי טבלה בתוך קריאה לפונקציה - כך
  --    ש-`property_marketing_fingerprint(src)` קיבלה text, והמיגרציה נכשלה
  --    בצינור (20.10.2026, בלי שינוי נתונים - טרנזקציה אחת). לכן שמות
  --    העמודות כאן `old_*`, והכינוי אינו מתנגש באף אחת מהן.
  update public.properties p
     set marketing_description_source      = b.old_source,
         marketing_description_at          = b.old_at,
         marketing_description_fingerprint = public.property_marketing_fingerprint(cur)
    from _hy_before b, public.properties cur
   where b.id = p.id
     and cur.id = p.id
     and b.fresh;
  get diagnostics v_rows = row_count;
  raise notice 'טביעות אצבע שהוחזרו: % שורות', v_rows;
end $$;

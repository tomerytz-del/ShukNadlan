-- ============================================================================
-- ארבעה תיקוני נתונים בנכסים (הכרעת מנהל הפלטפורמה, 12.10.2026)
--
-- ## 1. "עפולה עילית" כעיר נפרדת
--
-- נכס אחד (מבנה תעשייה) נשמר עם city = 'עפולה עילית'. אין עיר כזו ב-cities -
-- עפולה עילית היא חלק מעפולה, ויש לה שכונה ("עפולה עלית") - ולכן city_id
-- נשאר null, הנכס לא נכנס לשוק עפולה ולא לשום שכונה. מתוקן ל-'עפולה';
-- הטריגר properties_set_city_id_trg ממלא את city_id. השכונה נשארת ריקה: אין
-- לנכס פין, ואין ממה להכריע בין "עפולה עלית" ל"אזור התעשייה ע. עלית".
--
-- ## 2. "מבואות גלבוע" / "מבואות הגלבוע"
--
-- שני נכסים באותו אזור תעשייה, בשני כתיבים - ובחיפוש לפי יישוב הם שני
-- מקומות. מאוחדים ל"מבואות הגלבוע" (השם שבו האזור מוכר, וכך גם נכתב
-- בתיאור של שניהם). הכותרת והתיאור של הנכס לא נוגעים - הם טקסט של הסוכן/ת.
-- לאזור אין שורה ב-cities, ולכן city_id שלהם נשאר ריק גם אחרי האיחוד.
--
-- ## 2א. "מושב אביטל"
--
-- ב-cities היישוב הוא "אביטל". נכס אחד נשמר "מושב אביטל", ולכן city_id ריק.
-- מתוקן ל"אביטל", והטריגר ממלא את city_id.
--
-- ## 3. שדרות רובע יזרעאל 10
--
-- משויך ידנית ל"מזרח העיר", והפין שלו נופל במצולע "רובע יזרעאל" בלבד
-- (neighborhood_assignment_report: change). מתוקן לרובע יזרעאל. שלושת
-- ה-change האחרים בעפולה (הולנד 16, יהושע חנקין 56, קרן היסוד 16) נשארים -
-- ייתכן שהסוכן/ת צודק/ת, וההכרעה שלהם לא התקבלה.
--
-- ## לא דורסים
--
-- כל עדכון לפי id **ובתנאי שהערך הנוכחי הוא בדיוק הישן**. נכס שנערך מאז -
-- מדולג.
--
-- ## טביעת האצבע
--
-- property_marketing_fingerprint() כוללת את העיר ואת השכונה, ולכן שינוי
-- כאן היה מסמן את הנכסים כ"כדאי לרענן תיאור". כמו ב-20261202090000: מי
-- שהיה טרי לפני - מקבל את טביעת האצבע בחזרה.
--
-- התראות: הטריגרים של התאמות לקוחות וחיפושים שמורים יורים על שינוי עיר
-- ושכונה בנכס פעיל - וזה נכון: נכס התעשייה בעפולה עילית לא הופיע עד היום
-- למי שמחפש/ת בעפולה.
--
-- תיעוד: docs/neighborhood-assignment.md
-- ============================================================================

do $$
declare
  v_ids   uuid[] := array[
    '5c391269-7231-4c7b-a66c-156753ce72b1',   -- עפולה עילית
    'ebb0350f-cad3-4860-9c79-e89621abe7ea',   -- מבואות (ה)גלבוע
    'b1ab02e5-d309-408f-b908-876e361473c6',   -- מבואות (ה)גלבוע
    '827612e5-e3f5-445e-ad3a-12a2a317217e',   -- מושב אביטל
    '622a346f-dd21-4284-82b7-4343d767a0e1'    -- שדרות רובע יזרעאל 10
  ]::uuid[];
  v_fresh uuid[];
  v_rows  bigint;
begin
  select array_agg(p.id) into v_fresh
    from public.properties p
   where p.id = any(v_ids)
     and p.marketing_description_fingerprint is not null
     and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p);

  update public.properties
     set city = 'עפולה'
   where id = '5c391269-7231-4c7b-a66c-156753ce72b1'
     and city = 'עפולה עילית';
  get diagnostics v_rows = row_count;
  raise notice 'עפולה עילית -> עפולה: % נכסים', v_rows;

  update public.properties
     set city = 'מבואות הגלבוע'
   where id in ('ebb0350f-cad3-4860-9c79-e89621abe7ea',
                'b1ab02e5-d309-408f-b908-876e361473c6')
     and city = 'מבואות גלבוע';
  get diagnostics v_rows = row_count;
  raise notice 'מבואות גלבוע -> מבואות הגלבוע: % נכסים', v_rows;

  update public.properties
     set city = 'אביטל'
   where id = '827612e5-e3f5-445e-ad3a-12a2a317217e'
     and city = 'מושב אביטל';
  get diagnostics v_rows = row_count;
  raise notice 'מושב אביטל -> אביטל: % נכסים', v_rows;

  update public.properties p
     set neighborhood_id = r.id
    from public.neighborhoods r, public.neighborhoods e
   where p.id = '622a346f-dd21-4284-82b7-4343d767a0e1'
     and r.city = 'עפולה' and r.name = 'רובע יזרעאל'
     and e.city = 'עפולה' and e.name = 'מזרח העיר'
     and p.neighborhood_id = e.id;
  get diagnostics v_rows = row_count;
  raise notice 'שדרות רובע יזרעאל 10 -> רובע יזרעאל: % נכסים', v_rows;

  update public.properties p
     set marketing_description_fingerprint = public.property_marketing_fingerprint(src)
    from public.properties src
   where src.id = p.id
     and p.id = any(coalesce(v_fresh, '{}'::uuid[]))
     and p.marketing_description_fingerprint is distinct from
         public.property_marketing_fingerprint(src);
  get diagnostics v_rows = row_count;
  raise notice 'טביעות אצבע שהוחזרו: % נכסים', v_rows;
end $$;

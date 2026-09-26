-- ===========================================================================
-- שוק חדש: "הקריות והסביבה" (krayot), ו"חיפה והקריות" → "חיפה והסביבה"
-- (haifa). שניהם לא חיים.
--
-- ## למה לפצל
--
-- בהחלטה בשיחה (27.9.2026). הקריות הן שוק דיור משלהן - מחירים אחרים
-- מחיפה, וקונה שמחפש/ת בקריית ביאליק משווה/ה לקריית מוצקין ולקריית אתא
-- לפני שהוא/היא משווה לכרמל. כך גם יד 2 ("קריות והסביבה" לחוד מ"חיפה
-- והסביבה"). ועם 1,500 העסקאות של כל אחת מארבע הקריות במאגר הרשמי, יש
-- לשוק הזה כבר את מה שדוח ה-CMA צריך.
--
-- ## "והסביבה" = עמק זבולון
--
-- המועצה האזורית זבולון (קוד 12 בקובץ רשות האוכלוסין), 15 יישובים, כ-14
-- אלף תושבים: כפר ביאליק, כפר המכבי, רמת יוחנן, אושה, כפר חסידים א' וב',
-- יגור, שער העמקים, אבטין, נופית, ראס עלי, ח'ואלד ועוד. לפי המועצה, כמו
-- מטה אשר ומשגב - כולל יישובי הדרום שלה (יגור, כפר חסידים, אבטין, נופית),
-- שמשולבים ברכסים ובטבעון. נקודת GPS שם מגיעה לחיפה - מחיר הכלל.
--
-- ## מה נשאר בחיפה
--
-- חיפה, נשר, טירת כרמל, קריית טבעון ורכסים, ו-16 יישובי צפון חוף הכרמל.
-- ה-slug עובר מ-haifa-krayot ל-haifa - השוק לא היה חי, והכתובת הישנה
-- מפנה (301) ב-_redirects. זה הרגע הזול לשנות, כמו נצרת ב-20270114101000.
--
-- ## הסדר, ולמה הוא לא דורס
--
--   1. כל מה שעל haifa-krayot עובר ל-haifa (שינוי שם, אותה קבוצה).
--   2. ארבע הקריות עוברות מ-haifa ל-krayot - update מפורש, רק משורה שעדיין
--      על haifa: שיוך אחר (אם מנהל/ת שינה ביד) אינו נדרס.
--   3. זבולון - market_slug רק אם ריק.
-- ===========================================================================

-- 1. שינוי השם
update public.cities
   set market_slug = 'haifa'
 where market_slug = 'haifa-krayot';

-- 2. ארבע הקריות
update public.cities
   set market_slug = 'krayot'
 where muni_code in ('6800',  -- קריית אתא
                     '9500',  -- קריית ביאליק
                     '8200',  -- קריית מוצקין
                     '9600')  -- קריית ים
   and market_slug = 'haifa';

-- 3. עמק זבולון (קוד מועצה 12)
update public.cities c
   set market_slug = coalesce(c.market_slug, 'krayot')
 where c.muni_code in ('96',   -- יגור
                       '112',  -- כפר חסידים א'
                       '178',  -- רמת יוחנן
                       '220',  -- כפר ביאליק
                       '237',  -- שער העמקים
                       '254',  -- כפר המכבי
                       '278',  -- אושה
                       '652',  -- אבטין
                       '882',  -- אורנים
                       '889',  -- כפר חסידים ב'
                       '890',  -- כפר הנוער הדתי
                       '986',  -- ח'ואלד (שבט)
                       '990',  -- ראס עלי
                       '1284', -- נופית
                       '1321'); -- ח'ואלד

do $$
declare
  v_haifa  integer;
  v_krayot integer;
  v_old    integer;
begin
  select count(*) into v_haifa  from public.cities where market_slug = 'haifa';
  select count(*) into v_krayot from public.cities where market_slug = 'krayot';
  select count(*) into v_old    from public.cities where market_slug = 'haifa-krayot';
  raise notice 'haifa: % יישובים; krayot: % יישובים', v_haifa, v_krayot;
  if v_old > 0 then
    raise warning '% יישובים עדיין על haifa-krayot - לבדוק ביד.', v_old;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ההשלמה - כמו בכל מיגרציית שווקים.
-- ---------------------------------------------------------------------------
do $$
declare
  v integer;
  v_total integer := 0;
begin
  loop
    v := public.properties_backfill_city_id(200);
    v_total := v_total + v;
    exit when v = 0;
  end loop;
  raise notice 'properties.city_id: הושלמו % שורות', v_total;
end $$;

do $$
declare r record;
begin
  select * into r from public.agencies_backfill_city_id();
  raise notice 'agencies.city_id: % מכתובת, % מנכסים, % נותרו ריקים',
    r.from_address, r.from_properties, r.still_null;
end $$;

do $$
declare v_done integer;
begin
  update public.neighborhoods n
     set city_id = public.city_id_for_name(n.city)
   where n.city_id is null
     and public.city_id_for_name(n.city) is not null;
  get diagnostics v_done = row_count;
  raise notice 'neighborhoods.city_id: הושלמו % שורות', v_done;
end $$;

-- ---------------------------------------------------------------------------
-- רחובות: יישובי זבולון ייקלטו בסבב ה-gov הבא (כמו ב-20270114098000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

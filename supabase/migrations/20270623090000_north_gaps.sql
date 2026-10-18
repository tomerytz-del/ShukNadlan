-- ===========================================================================
-- השלמות בצפון: 61 יישובים שנשמטו מארבעה שווקים קיימים
--
-- 29 בתוכנית (docs/regional-pages.md). בבדיקת הפערים של 18.10.2026 נמצאו
-- יישובים יהודיים בתוך האזורים של שווקים שכבר נבנו, בלי market_slug:
--   - afula-emek: 32 כפרי עמק יזרעאל והגלבוע (נהלל, גבת, רמת דוד, עין חרוד,
--     בית השיטה, יזרעאל, דבורה ועוד; לפי ההחלטה של 18.10.2026).
--   - nof-hagalil-migdal: 5 יישובים (הושעיה, ציפורי, חנתון, בית רימון,
--     מצפה נטופה).
--   - akko-nahariya: 22 יישובי מטה אשר ומעלה יוסף (עין יעקב, נווה זיו,
--     שומרה, שתולה, נטועה, זרעית, גורנות הגליל, מעונה ועוד).
--   - karmiel-misgav: עדי ושזור.
--
-- כולם כבר ברישום (20270114095000) - ולכן update ולא insert.
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - בלי slug אמיתי: אף אחד מהם אינו רשות מקומית.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, v.market),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('80', null, 'afula-emek'),   -- נהלל
    ('134', null, 'afula-emek'),   -- יפעת
    ('133', null, 'afula-emek'),   -- גבת
    ('126', null, 'afula-emek'),   -- שריד
    ('92', null, 'afula-emek'),   -- גיניגר
    ('132', null, 'afula-emek'),   -- כפר ברוך
    ('135', null, 'afula-emek'),   -- רמת דוד
    ('104', null, 'afula-emek'),   -- מזרע
    ('85', null, 'afula-emek'),   -- כפר יחזקאל
    ('86', null, 'afula-emek'),   -- גבע
    ('82', null, 'afula-emek'),   -- עין חרוד (מאוחד)
    ('89', null, 'afula-emek'),   -- עין חרוד (איחוד)
    ('84', null, 'afula-emek'),   -- תל יוסף
    ('442', null, 'afula-emek'),   -- גדעונה
    ('242', null, 'afula-emek'),   -- בית השיטה
    ('1110', null, 'afula-emek'),   -- חבר
    ('269', null, 'afula-emek'),   -- מולדת
    ('339', null, 'afula-emek'),   -- רמת צבי
    ('164', null, 'afula-emek'),   -- מלאה
    ('2054', null, 'afula-emek'),   -- מיטב
    ('2053', null, 'afula-emek'),   -- פרזון
    ('113', null, 'afula-emek'),   -- אדירים
    ('1069', null, 'afula-emek'),   -- רם-און
    ('457', null, 'afula-emek'),   -- גזית
    ('146', null, 'afula-emek'),   -- דבורה
    ('436', null, 'afula-emek'),   -- עין דור
    ('407', null, 'afula-emek'),   -- דברת
    ('165', null, 'afula-emek'),   -- ניר יפה
    ('452', null, 'afula-emek'),   -- יזרעאל
    ('1154', null, 'afula-emek'),   -- מיטל
    ('1117', null, 'afula-emek'),   -- יעל
    ('141', null, 'afula-emek'),   -- ברק
    ('1186', null, 'nof-hagalil-migdal'),   -- הושעיה
    ('613', null, 'nof-hagalil-migdal'),   -- ציפורי
    ('1257', null, 'nof-hagalil-migdal'),   -- חנתון
    ('1162', null, 'nof-hagalil-migdal'),   -- בית רימון
    ('1190', null, 'nof-hagalil-migdal'),   -- מצפה נטופה
    ('813', null, 'akko-nahariya'),   -- עין יעקב
    ('1314', null, 'akko-nahariya'),   -- נווה זיו
    ('1208', null, 'akko-nahariya'),   -- הילה
    ('1205', null, 'akko-nahariya'),   -- מנות
    ('755', null, 'akko-nahariya'),   -- גורן
    ('614', null, 'akko-nahariya'),   -- שומרה
    ('1081', null, 'akko-nahariya'),   -- אבן מנחם
    ('1045', null, 'akko-nahariya'),   -- שתולה
    ('1147', null, 'akko-nahariya'),   -- נטועה
    ('1130', null, 'akko-nahariya'),   -- כפר רוזנואלד (זרעית)
    ('1220', null, 'akko-nahariya'),   -- אבירים
    ('1219', null, 'akko-nahariya'),   -- גורנות הגליל
    ('1206', null, 'akko-nahariya'),   -- גיתה
    ('603', null, 'akko-nahariya'),   -- אלקוש
    ('1184', null, 'akko-nahariya'),   -- מתת
    ('1173', null, 'akko-nahariya'),   -- לפידות
    ('795', null, 'akko-nahariya'),   -- יערה
    ('892', null, 'akko-nahariya'),   -- עבדון
    ('570', null, 'akko-nahariya'),   -- מעונה
    ('774', null, 'akko-nahariya'),   -- צוריאל
    ('662', null, 'akko-nahariya'),   -- חוסן
    ('281', null, 'akko-nahariya'),   -- פקיעין חדשה
    ('1199', null, 'karmiel-misgav'),   -- עדי
    ('527', null, 'karmiel-misgav')   -- שזור
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_0 integer;
  v_1 integer;
  v_2 integer;
  v_3 integer;
  v_other integer;
begin
  select count(*) filter (where v.m = 'afula-emek' and c.market_slug = 'afula-emek'),
         count(*) filter (where v.m = 'nof-hagalil-migdal' and c.market_slug = 'nof-hagalil-migdal'),
         count(*) filter (where v.m = 'akko-nahariya' and c.market_slug = 'akko-nahariya'),
         count(*) filter (where v.m = 'karmiel-misgav' and c.market_slug = 'karmiel-misgav'),
         count(*) filter (where c.market_slug is distinct from v.m)
    into v_0, v_1, v_2, v_3, v_other
    from public.cities c
    join (values
      ('80', 'afula-emek'),
      ('134', 'afula-emek'),
      ('133', 'afula-emek'),
      ('126', 'afula-emek'),
      ('92', 'afula-emek'),
      ('132', 'afula-emek'),
      ('135', 'afula-emek'),
      ('104', 'afula-emek'),
      ('85', 'afula-emek'),
      ('86', 'afula-emek'),
      ('82', 'afula-emek'),
      ('89', 'afula-emek'),
      ('84', 'afula-emek'),
      ('442', 'afula-emek'),
      ('242', 'afula-emek'),
      ('1110', 'afula-emek'),
      ('269', 'afula-emek'),
      ('339', 'afula-emek'),
      ('164', 'afula-emek'),
      ('2054', 'afula-emek'),
      ('2053', 'afula-emek'),
      ('113', 'afula-emek'),
      ('1069', 'afula-emek'),
      ('457', 'afula-emek'),
      ('146', 'afula-emek'),
      ('436', 'afula-emek'),
      ('407', 'afula-emek'),
      ('165', 'afula-emek'),
      ('452', 'afula-emek'),
      ('1154', 'afula-emek'),
      ('1117', 'afula-emek'),
      ('141', 'afula-emek'),
      ('1186', 'nof-hagalil-migdal'),
      ('613', 'nof-hagalil-migdal'),
      ('1257', 'nof-hagalil-migdal'),
      ('1162', 'nof-hagalil-migdal'),
      ('1190', 'nof-hagalil-migdal'),
      ('813', 'akko-nahariya'),
      ('1314', 'akko-nahariya'),
      ('1208', 'akko-nahariya'),
      ('1205', 'akko-nahariya'),
      ('755', 'akko-nahariya'),
      ('614', 'akko-nahariya'),
      ('1081', 'akko-nahariya'),
      ('1045', 'akko-nahariya'),
      ('1147', 'akko-nahariya'),
      ('1130', 'akko-nahariya'),
      ('1220', 'akko-nahariya'),
      ('1219', 'akko-nahariya'),
      ('1206', 'akko-nahariya'),
      ('603', 'akko-nahariya'),
      ('1184', 'akko-nahariya'),
      ('1173', 'akko-nahariya'),
      ('795', 'akko-nahariya'),
      ('892', 'akko-nahariya'),
      ('570', 'akko-nahariya'),
      ('774', 'akko-nahariya'),
      ('662', 'akko-nahariya'),
      ('281', 'akko-nahariya'),
      ('1199', 'karmiel-misgav'),
      ('527', 'karmiel-misgav')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'afula-emek: %; nof-hagalil-migdal: %; akko-nahariya: %; karmiel-misgav: %', v_0, v_1, v_2, v_3;
  if v_other > 0 then
    raise warning '% יישובים משויכים לשוק אחר או חסרים ברישום - לא נדרסו. לבדוק ביד.', v_other;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270621090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

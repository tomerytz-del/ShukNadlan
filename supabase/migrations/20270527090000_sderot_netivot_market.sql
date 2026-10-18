-- ===========================================================================
-- שוק חדש: "שדרות, נתיבות ואופקים" (sderot-netivot) - לא חי
--
-- 14ב בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"), שפוצל מקריית גת
-- (20270526090000). שדרות, נתיבות, אופקים, ו-72 יישובי שער הנגב, שדות נגב,
-- מרחבים ואשכול - הנגב המערבי. כ-195 אלף תושבים רשומים (20270114096000).
-- נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- שלוש הערים הן מרכזי הקנייה של הנגב המערבי, והמועצות שסביבן: שער הנגב (בנפת
-- אשקלון), ושדות נגב, מרחבים ואשכול (בנפת באר שבע). החלוקה גאוגרפית - סמל
-- המועצה אינו ברישום.
--
-- **לא כאן:**
--   - רהט, תל שבע, חורה, כסיפה, ערערה-בנגב, לקיה, שגב-שלום והיישובים
--     הבדואים - אותו כלל של הערים הערביות: נכנסים כשיש בהם משרדים.
--   - יישובי בני שמעון ורמת נגב שליד באר שבע (בית קמה, להב, שובל, נבטים,
--     חצרים, משמר הנגב, כרמים...) - באר שבע והסביבה, הבא בתור.
--   - יישובי הערבה ותמר.
--   - יישובים מתחת ל-300 תושבים רשומים - לא נבדקו אחד-אחד.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשלוש הערים, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'sderot-netivot'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('1031', 'sderot'),
    ('246', 'netivot'),
    ('31', 'ofakim'),
    -- שער הנגב
    ('428', null), ('67', null), ('845', null), ('668', null), ('336', null), ('362', null),
    ('811', null), ('348', null), ('714', null), ('424', null), ('844', null), ('338', null),
    -- שדות נגב
    ('398', null), ('665', null), ('1065', null), ('761', null), ('1095', null), ('415', null),
    ('803', null), ('723', null), ('1083', null), ('1082', null), ('2014', null), ('1377', null),
    -- מרחבים
    ('736', null), ('749', null), ('748', null), ('2050', null), ('2049', null), ('2059', null),
    ('2060', null), ('2062', null), ('2064', null), ('2061', null), ('1080', null), ('2044', null),
    ('2047', null), ('2048', null), ('414', null), ('789', null), ('750', null), ('762', null),
    -- אשכול
    ('399', null), ('602', null), ('69', null), ('676', null), ('840', null), ('695', null),
    ('402', null), ('413', null), ('403', null), ('713', null), ('1058', null), ('1051', null),
    ('1237', null), ('829', null), ('318', null), ('916', null), ('1046', null), ('1241', null),
    ('1232', null), ('1364', null), ('1363', null), ('1366', null), ('1085', null), ('1311', null),
    ('1227', null), ('1223', null), ('1136', null), ('1240', null), ('71', null), ('352', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'sderot-netivot'),
         count(*) filter (where market_slug is distinct from 'sderot-netivot')
    into v_in, v_other
    from public.cities
   where muni_code in ('1031', '246', '31',
                       '428', '67', '845', '668', '336', '362', '811', '348', '714', '424', '844', '338',
                       '398', '665', '1065', '761', '1095', '415', '803', '723', '1083', '1082', '2014', '1377',
                       '736', '749', '748', '2050', '2049', '2059', '2060', '2062', '2064', '2061', '1080', '2044',
                       '2047', '2048', '414', '789', '750', '762',
                       '399', '602', '69', '676', '840', '695', '402', '413', '403', '713', '1058', '1051',
                       '1237', '829', '318', '916', '1046', '1241', '1232', '1364', '1363', '1366', '1085', '1311',
                       '1227', '1223', '1136', '1240', '71', '352');
  raise notice 'sderot-netivot: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270526090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

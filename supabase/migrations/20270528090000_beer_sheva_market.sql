-- ===========================================================================
-- שוק חדש: "באר שבע והסביבה" (beer-sheva) - לא חי
--
-- הדרומי ביותר בתוכנית (docs/regional-pages.md, "ההתפרסות דרומה"). באר שבע,
-- עומר, מיתר, להבים, ו-10 יישובי בני שמעון שסביב העיר. כ-273 אלף תושבים
-- רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- באר שבע ושלוש המועצות המקומיות שצמודות אליה, ויישובי בני שמעון שבין
-- העיר לקריית גת ולרהט: בית קמה, להב, דביר, שובל, נבטים, חצרים, משמר
-- הנגב, כרמים, גבעות בר ושומריה.
--
-- **לא כאן:**
--   - דימונה וירוחם - 35 ק"מ מבאר שבע (החלטה של 18.10.2026).
--   - יישובי רמת נגב (שדה בוקר, מדרשת בן גוריון, טללים, משאבי שדה,
--     רתמים) - מעבר לירוחם.
--   - באר אורה - ליד אילת.
--   - רהט, תל שבע, לקיה, חורה, כסיפה, ערערה-בנגב, שגב-שלום והיישובים
--     הבדואים - אותו כלל של הערים הערביות.
--
-- **ובאותה מיגרציה - תפרח לשדרות, נתיבות ואופקים:** יישוב של מרחבים ליד
-- גילת, שנשמט מ-20270527090000. ‏market_slug רק אם ריק.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לארבע הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, v.market),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('9000', 'beer-sheva', 'beer-sheva'),
    ('666', 'omer', 'beer-sheva'),
    ('1268', 'meitar', 'beer-sheva'),
    ('1271', 'lehavim', 'beer-sheva'),
    -- בני שמעון
    ('598', null, 'beer-sheva'),   -- בית קמה
    ('2023', null, 'beer-sheva'),  -- להב
    ('849', null, 'beer-sheva'),   -- דביר
    ('394', null, 'beer-sheva'),   -- שובל
    ('396', null, 'beer-sheva'),   -- נבטים
    ('397', null, 'beer-sheva'),   -- חצרים
    ('395', null, 'beer-sheva'),   -- משמר הנגב
    ('1198', null, 'beer-sheva'),  -- כרמים
    ('1344', null, 'beer-sheva'),  -- גבעות בר
    ('1265', null, 'beer-sheva'),  -- שומריה
    -- תפרח (מרחבים) - לשדרות, נתיבות ואופקים
    ('709', null, 'sderot-netivot')
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_sd    integer;
  v_other integer;
begin
  select count(*) filter (where muni_code <> '709' and market_slug = 'beer-sheva'),
         count(*) filter (where muni_code = '709' and market_slug = 'sderot-netivot'),
         count(*) filter (where (muni_code <> '709' and market_slug is distinct from 'beer-sheva')
                             or (muni_code = '709' and market_slug is distinct from 'sderot-netivot'))
    into v_in, v_sd, v_other
    from public.cities
   where muni_code in ('9000', '666', '1268', '1271', '598', '2023', '849', '394', '396', '397',
                       '395', '1198', '1344', '1265', '709');
  raise notice 'beer-sheva: % יישובים בשוק; sderot-netivot: % נוסף', v_in, v_sd;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270527090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

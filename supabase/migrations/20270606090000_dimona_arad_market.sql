-- ===========================================================================
-- שוק חדש: "דימונה, ערד וירוחם" (dimona-arad) - לא חי
--
-- 21 בתוכנית (docs/regional-pages.md, החלטה של 18.10.2026): דימונה, ערד,
-- ירוחם, מצפה רמון, יישובי רמת נגב ויישובי תמר וים המלח. כ-102 אלף תושבים
-- רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- ארבע הרשויות, יישובי מועצת רמת נגב (משאבי שדה ורביבים ועד ניצנה, כמהין
-- ועזוז במערב), ויישובי תמר (נווה זוהר, עין גדי, נאות הכיכר, עין תמר, הר
-- עמשא).
--
-- **לא כאן:**
--   - אילת, חבל אילות, באר אורה והערבה התיכונה - אילת והסביבה, הבא בתור.
--   - היישובים הבדואים - אותו כלל של הערים הערביות.
--   - מחנות צה"ל (יתיר, טלי, יוכבד, יפה).
--
-- **ובאותה מיגרציה - שבעה יישובים שנשמטו מהשווקים השכנים** (‏market_slug רק
-- אם ריק):
--   - לשדרות, נתיבות ואופקים (20270527090000): סעד, עלומים ושיבולים (שדות
--     נגב), וסופה, חולית ופרי גן (אשכול).
--   - לבאר שבע והסביבה (20270528090000): אשל הנשיא.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏slug אמיתי לארבע הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, v.market),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('2200', 'dimona', 'dimona-arad'),
    ('2560', 'arad', 'dimona-arad'),
    ('831', 'yeruham', 'dimona-arad'),
    ('99', 'mitzpe-ramon', 'dimona-arad'),
    -- רמת נגב
    ('421', null, 'dimona-arad'),  ('354', null, 'dimona-arad'),  ('1177', null, 'dimona-arad'),
    ('885', null, 'dimona-arad'),  ('1140', null, 'dimona-arad'), ('1260', null, 'dimona-arad'),
    ('1152', null, 'dimona-arad'), ('1340', null, 'dimona-arad'), ('1291', null, 'dimona-arad'),
    ('328', null, 'dimona-arad'),  ('1278', null, 'dimona-arad'), ('1195', null, 'dimona-arad'),
    ('1280', null, 'dimona-arad'), ('1373', null, 'dimona-arad'), ('1341', null, 'dimona-arad'),
    -- תמר וים המלח
    ('2042', null, 'dimona-arad'), ('1124', null, 'dimona-arad'), ('1251', null, 'dimona-arad'),
    ('1057', null, 'dimona-arad'), ('1261', null, 'dimona-arad'),
    -- שנשמטו: שדות נגב ואשכול לשדרות, נתיבות ואופקים; אשל הנשיא לבאר שבע
    ('419', null, 'sderot-netivot'),  ('1146', null, 'sderot-netivot'), ('865', null, 'sderot-netivot'),
    ('1238', null, 'sderot-netivot'), ('1239', null, 'sderot-netivot'), ('1231', null, 'sderot-netivot'),
    ('2021', null, 'beer-sheva')
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_sd    integer;
  v_bs    integer;
  v_other integer;
begin
  select count(*) filter (where m = 'dimona-arad' and market_slug = 'dimona-arad'),
         count(*) filter (where m = 'sderot-netivot' and market_slug = 'sderot-netivot'),
         count(*) filter (where m = 'beer-sheva' and market_slug = 'beer-sheva'),
         count(*) filter (where market_slug is distinct from m)
    into v_in, v_sd, v_bs, v_other
    from public.cities c
    join (values
      ('2200', 'dimona-arad'), ('2560', 'dimona-arad'), ('831', 'dimona-arad'), ('99', 'dimona-arad'),
      ('421', 'dimona-arad'), ('354', 'dimona-arad'), ('1177', 'dimona-arad'), ('885', 'dimona-arad'),
      ('1140', 'dimona-arad'), ('1260', 'dimona-arad'), ('1152', 'dimona-arad'), ('1340', 'dimona-arad'),
      ('1291', 'dimona-arad'), ('328', 'dimona-arad'), ('1278', 'dimona-arad'), ('1195', 'dimona-arad'),
      ('1280', 'dimona-arad'), ('1373', 'dimona-arad'), ('1341', 'dimona-arad'),
      ('2042', 'dimona-arad'), ('1124', 'dimona-arad'), ('1251', 'dimona-arad'), ('1057', 'dimona-arad'),
      ('1261', 'dimona-arad'),
      ('419', 'sderot-netivot'), ('1146', 'sderot-netivot'), ('865', 'sderot-netivot'),
      ('1238', 'sderot-netivot'), ('1239', 'sderot-netivot'), ('1231', 'sderot-netivot'),
      ('2021', 'beer-sheva')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'dimona-arad: % יישובים בשוק; sderot-netivot: % נוספו; beer-sheva: % נוסף', v_in, v_sd, v_bs;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270605090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

-- ===========================================================================
-- שוק חדש: "חדרה והסביבה" (hadera) - לא חי
--
-- חדרה, חריש, פרדס חנה-כרכור, אור עקיבא, בנימינה-גבעת עדה, זכרון יעקב,
-- קיסריה ושדות ים; 24 יישובי מנשה; דרום חוף הכרמל; ואלונה. כ-325 אלף
-- תושבים רשומים (20270114096000). נולד **לא חי** - "נפתחים בקרוב" ב-noindex, לגיוס
-- המשרדים (הסקיל new-market).
--
-- ## איך נבחרו הערים
--
-- הקונה בחדרה מחפש/ת דרומה ומזרחה: פרדס חנה-כרכור, אור עקיבא, חריש,
-- קיסריה ובנימינה - כך בשיחה עם מי שעובד/ת בשוק, וכך גם יד 2 ("חדרה
-- והסביבה"). ‏**קיסריה ושדות ים** הן יישובי המועצה חוף הכרמל, שהשארנו מחוץ
-- לחיפה ב-20270114101000 בדיוק בשביל השוק הזה. **מנשה** נכנסת לפי המועצה
-- (כולל מייסר, אום אל-קוטוף ואל-עריאן שבה), כמו מטה אשר ומשגב.
--
-- **זכרון יעקב, ואיתה דרום חוף הכרמל ואלונה** - בהחלטה בשיחה. יד 2 מחזיק
-- "זכרון וחוף הכרמל" כאזור נפרד, אבל אצלנו מתחילים בשווקים גדולים ומפצלים
-- כשיש מלאי (docs/regional-pages.md), וזכרון צמודה לבנימינה. עם זכרון באים
-- שמונת יישובי דרום חוף הכרמל שנשארו מחוץ לחיפה ב-20270114101000 (מעגן
-- מיכאל, מעיין צבי, בית חנניה, מאיר שפיה, בת שלמה, דור, נחשולים, בית צבי),
-- ושלושת יישובי אלונה (עמיקם, אביאל, גבעת ניל"י) - כולם בינה לבין בנימינה.
--
-- **לא כאן:**
--   - נתניה - עיר גדולה מספיק לשוק משלה.
--   - ג'סר א-זרקא, פוריידיס ויישובי ואדי ערה - אותו כלל של עכו, כרמיאל
--     ונצרת: עיר ערבית עצמאית נכנסת כשיש בה משרדים.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק.
--   - ‏slug אמיתי לשבע הערים, רק כשהוא עדיין זמני. שאר היישובים נשארים עם
--     הזמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'hadera'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('6500', 'hadera'),
    ('1247', 'harish'),
    ('7800', 'pardes-hanna-karkur'),
    ('1020', 'or-akiva'),
    ('9800', 'binyamina-givat-ada'),
    ('1167', 'caesarea'),
    ('9300', 'zichron-yaakov'),
    ('327',  null),  -- שדות ים
    -- דרום חוף הכרמל
    ('33',   null), ('102',  null), ('212',  null), ('290',  null),
    ('433',  null), ('694',  null), ('738',  null), ('800',  null),
    -- אלונה
    ('360',  null), ('679',  null), ('773',  null),
    -- מנשה (24 יישובים)
    ('72',   null), ('139',  null), ('189',  null), ('213',  null),
    ('223',  null), ('225',  null), ('310',  null), ('344',  null),
    ('375',  null), ('444',  null), ('617',  null), ('648',  null),
    ('649',  null), ('715',  null), ('868',  null), ('921',  null),
    ('1128', null), ('1243', null), ('1316', null), ('1370', null),
    ('2003', null), ('2008', null), ('2024', null), ('2055', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'hadera'),
         count(*) filter (where market_slug is distinct from 'hadera')
    into v_in, v_other
    from public.cities
   where muni_code in ('6500','1247','7800','1020','9800','1167','9300','327',
                       '33','102','212','290','433','694','738','800','360','679','773',
                       '72','139','189','213','223','225','310','344','375','444',
                       '617','648','649','715','868','921','1128','1243','1316','1370',
                       '2003','2008','2024','2055');
  raise notice 'hadera: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270114098000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

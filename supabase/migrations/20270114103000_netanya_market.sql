-- ===========================================================================
-- שוק חדש: "נתניה והסביבה" (netanya) - לא חי
--
-- נתניה, כפר יונה, קדימה-צורן, תל מונד, אבן יהודה, פרדסיה ואליכין; 44
-- יישובי עמק חפר ו-18 יישובי לב השרון, לפי המועצה. כ-458 אלף תושבים
-- רשומים (20270114096000). נולד **לא חי** - "נפתחים בקרוב" ב-noindex,
-- לגיוס המשרדים (הסקיל new-market).
--
-- ## איך נבחרו הערים
--
-- נתניה והשרון הצפוני שסביבה: הקונה בנתניה מחפש/ת גם בכפר יונה, בקדימה,
-- באבן יהודה ובתל מונד, ובמושבי עמק חפר ולב השרון. מתחילים גדול ומפצלים
-- כשיש מלאי (docs/regional-pages.md).
--
-- **עמק חפר - כולה כאן**, לפי כלל המועצה ולפי הנפה (השרון). צפון העמק
-- (גבעת חיים, עין החורש, מכמורת, כפר הרא"ה) ואליכין צמודים לחדרה, ונקודת
-- GPS שם נופלת בתיבה של חדרה - אותו מחיר של הכלל כמו דרום מטה אשר מול
-- הקריות. אם יתברר שהקונים שם מחפשים בחדרה - update נפרד.
--
-- **לא כאן:**
--   - חוף השרון (שפיים, רשפון, געש...) - דרומה, לכיוון הרצליה ורעננה.
--   - טייבה, קלנסווה, טירה וזמר - עיר ערבית עצמאית נכנסת כשיש בה משרדים.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק.
--   - ‏slug אמיתי לשבע הערים, רק כשהוא עדיין זמני. יישובי המועצות נשארים
--     עם הזמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'netanya'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('7400', 'netanya'),
    ('168', 'kfar-yona'),
    ('195', 'kadima-tzoran'),
    ('154', 'tel-mond'),
    ('182', 'even-yehuda'),
    ('171', 'pardesia'),
    ('41', 'elyakhin'),
    -- עמק חפר (קוד מועצה 16)
    ('115', null), ('167', null), ('173', null), ('175', null),
    ('186', null), ('190', null), ('191', null), ('193', null),
    ('194', null), ('197', null), ('200', null), ('204', null),
    ('205', null), ('217', null), ('219', null), ('224', null),
    ('233', null), ('235', null), ('252', null), ('326', null),
    ('373', null), ('377', null), ('382', null), ('387', null),
    ('422', null), ('423', null), ('680', null), ('697', null),
    ('698', null), ('734', null), ('737', null), ('758', null),
    ('807', null), ('850', null), ('872', null), ('877', null),
    ('897', null), ('1077', null), ('1102', null), ('1318', null),
    ('1319', null), ('1361', null), ('2018', null), ('2043', null),
    -- לב השרון (קוד מועצה 18)
    ('157', null), ('162', null), ('170', null), ('187', null),
    ('276', null), ('379', null), ('386', null), ('425', null),
    ('447', null), ('549', null), ('661', null), ('753', null),
    ('767', null), ('837', null), ('851', null), ('880', null),
    ('1044', null), ('2002', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'netanya'),
         count(*) filter (where market_slug is distinct from 'netanya')
    into v_in, v_other
    from public.cities
   where muni_code in ('7400', '168', '195', '154', '182', '171', '41', '115', '167', '173',
                       '175', '186', '190', '191', '193', '194', '197', '200', '204', '205',
                       '217', '219', '224', '233', '235', '252', '326', '373', '377', '382',
                       '387', '422', '423', '680', '697', '698', '734', '737', '758', '807',
                       '850', '872', '877', '897', '1077', '1102', '1318', '1319', '1361', '2018',
                       '2043', '157', '162', '170', '187', '276', '379', '386', '425', '447',
                       '549', '661', '753', '767', '837', '851', '880', '1044', '2002');
  raise notice 'netanya: % יישובים בשוק', v_in;
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

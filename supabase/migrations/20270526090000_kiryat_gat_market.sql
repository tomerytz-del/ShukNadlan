-- ===========================================================================
-- שוק חדש: "קריית גת והסביבה" (kiryat-gat) - לא חי
--
-- הארבעה-עשר בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). קריית גת
-- ו-47 יישובי לכיש, שפיר ויואב שסביבה. כ-115 אלף תושבים רשומים
-- (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## למה קריית גת לבד (שינוי מהתוכנית)
--
-- התוכנית שמה את קריית גת, שדרות, נתיבות ואופקים בשוק אחד - כ-40 ק"מ משני
-- אשכולות שונים. קריית גת וכפרי לכיש, שפיר ויואב הם שוק אחד; שדרות, נתיבות,
-- אופקים ושער הנגב הם השוק הבא.
--
-- **ובאותה מיגרציה - שדה עוזיהו לאשדוד והסביבה:** יישוב של באר טוביה, צמוד
-- לקריית מלאכי, שלא נכלל ב-20270524090000. ‏market_slug רק אם ריק.
--
-- **לא כאן:** שדרות ויישובי שער הנגב (ברור חיל, אור הנר, כפר עזה, מפלסים,
-- דורות, רוחמה, יכיני, ניר עם, ארז, גבים, נחל עוז, איבים) - השוק הבא; מחנה
-- מרים (בסיס).
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לעיר, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, v.market),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('2630', 'kiryat-gat', 'kiryat-gat'),
    -- לכיש, שפיר ויואב
    ('1368', null, 'kiryat-gat'), ('400', null, 'kiryat-gat'),  ('1145', null, 'kiryat-gat'),
    ('274', null, 'kiryat-gat'),  ('309', null, 'kiryat-gat'),  ('315', null, 'kiryat-gat'),
    ('340', null, 'kiryat-gat'),  ('1369', null, 'kiryat-gat'), ('692', null, 'kiryat-gat'),
    ('564', null, 'kiryat-gat'),  ('1365', null, 'kiryat-gat'), ('1374', null, 'kiryat-gat'),
    ('622', null, 'kiryat-gat'),  ('814', null, 'kiryat-gat'),  ('888', null, 'kiryat-gat'),
    ('24', null, 'kiryat-gat'),   ('815', null, 'kiryat-gat'),  ('37', null, 'kiryat-gat'),
    ('818', null, 'kiryat-gat'),  ('393', null, 'kiryat-gat'),  ('16', null, 'kiryat-gat'),
    ('2045', null, 'kiryat-gat'), ('553', null, 'kiryat-gat'),  ('7', null, 'kiryat-gat'),
    ('620', null, 'kiryat-gat'),  ('873', null, 'kiryat-gat'),  ('36', null, 'kiryat-gat'),
    ('32', null, 'kiryat-gat'),   ('827', null, 'kiryat-gat'),  ('293', null, 'kiryat-gat'),
    ('18', null, 'kiryat-gat'),   ('2030', null, 'kiryat-gat'), ('1233', null, 'kiryat-gat'),
    ('2051', null, 'kiryat-gat'), ('2046', null, 'kiryat-gat'), ('11', null, 'kiryat-gat'),
    ('775', null, 'kiryat-gat'),  ('55', null, 'kiryat-gat'),   ('821', null, 'kiryat-gat'),
    ('766', null, 'kiryat-gat'),  ('619', null, 'kiryat-gat'),  ('15', null, 'kiryat-gat'),
    ('826', null, 'kiryat-gat'),  ('44', null, 'kiryat-gat'),   ('1133', null, 'kiryat-gat'),
    ('23', null, 'kiryat-gat'),   ('1339', null, 'kiryat-gat'),
    -- שדה עוזיהו (באר טוביה) - לאשדוד והסביבה
    ('739', null, 'ashdod')
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_ashd  integer;
  v_other integer;
begin
  select count(*) filter (where muni_code <> '739' and market_slug = 'kiryat-gat'),
         count(*) filter (where muni_code = '739' and market_slug = 'ashdod'),
         count(*) filter (where (muni_code <> '739' and market_slug is distinct from 'kiryat-gat')
                             or (muni_code = '739' and market_slug is distinct from 'ashdod'))
    into v_in, v_ashd, v_other
    from public.cities
   where muni_code in ('2630', '1368', '400', '1145', '274', '309', '315', '340', '1369', '692',
                       '564', '1365', '1374', '622', '814', '888', '24', '815', '37', '818',
                       '393', '16', '2045', '553', '7', '620', '873', '36', '32', '827', '293',
                       '18', '2030', '1233', '2051', '2046', '11', '775', '55', '821', '766',
                       '619', '15', '826', '44', '1133', '23', '1339', '739');
  raise notice 'kiryat-gat: % יישובים בשוק; ashdod: % נוסף', v_in, v_ashd;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270525090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

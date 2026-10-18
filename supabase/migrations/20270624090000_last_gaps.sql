-- ===========================================================================
-- השלמות אחרונות: שישה יישובים יהודיים שנשמטו מחיפה, אשקלון וירושלים
--
-- בבדיקת הפערים השנייה של 18.10.2026 (docs/regional-pages.md, "מה נשאר בלי
-- שוק") כל מה שנשאר בלי market_slug היה יישוב ערבי, בדואי או דרוזי - שנשארים
-- מחוץ לשווקים בהחלטה - ועוד שישה יישובים יהודיים:
--   - haifa: אלוני אבא, כפר החורש, הרדוף ובית שערים - הכפרים שסביב קריית
--     טבעון (החלטה של 18.10.2026). ב-GPS הם נופלים בעפולה או בשוק הקרוב.
--   - ashkelon: באר גנים (ברישום תחת נפת באר שבע, אבל היא צמודה לאשקלון).
--   - jerusalem: גבעות עדן.
-- מחנות צבא ומוסדות (כדורי, קרית יערים-מוסד, כפר עבודה ועוד) - בכוונה לא.
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
    ('429', null, 'haifa'),   -- אלוני אבא
    ('192', null, 'haifa'),   -- כפר החורש
    ('1249', null, 'haifa'),   -- הרדוף
    ('248', null, 'haifa'),   -- בית שערים
    ('1376', null, 'ashkelon'),   -- באר גנים
    ('1362', null, 'jerusalem')   -- גבעות עדן
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_0 integer;
  v_1 integer;
  v_2 integer;
  v_other integer;
begin
  select count(*) filter (where v.m = 'haifa' and c.market_slug = 'haifa'),
         count(*) filter (where v.m = 'ashkelon' and c.market_slug = 'ashkelon'),
         count(*) filter (where v.m = 'jerusalem' and c.market_slug = 'jerusalem'),
         count(*) filter (where c.market_slug is distinct from v.m)
    into v_0, v_1, v_2, v_other
    from public.cities c
    join (values
      ('429', 'haifa'),
      ('192', 'haifa'),
      ('1249', 'haifa'),
      ('248', 'haifa'),
      ('1376', 'ashkelon'),
      ('1362', 'jerusalem')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'haifa: %; ashkelon: %; jerusalem: %', v_0, v_1, v_2;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270623090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

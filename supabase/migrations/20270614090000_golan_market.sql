-- ===========================================================================
-- שוק חדש: "רמת הגולן וקצרין" (golan) - לא חי
--
-- השלישי משלושת שווקי הגליל העליון והגולן (החלטה של 18.10.2026,
-- docs/regional-pages.md): קצרין ו-33 יישובי מועצת גולן, מעין זיוון ונווה
-- אטי"ב בצפון ועד מבוא חמה וכפר חרוב בדרום. כ-30 אלף תושבים רשומים
-- (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- **לא כאן:** מג'דל שמס, בוקעאתא, מסעדה, עין קנייא וע'ג'ר - אותו כלל של
-- היישובים הערביים והדרוזיים.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, v.market),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('4100', 'katzrin', 'golan'),
    ('4005', null, 'golan'),   -- חספין
    ('4015', null, 'golan'),   -- בני יהודה
    ('4304', null, 'golan'),   -- נוב
    ('4011', null, 'golan'),   -- אבני איתן
    ('4006', null, 'golan'),   -- קשת
    ('4007', null, 'golan'),   -- יונתן
    ('4701', null, 'golan'),   -- רמת מגשימים
    ('4026', null, 'golan'),   -- חד-נס
    ('4101', null, 'golan'),   -- מרום גולן
    ('4021', null, 'golan'),   -- גבעת יואב
    ('4025', null, 'golan'),   -- קדמת צבי
    ('4551', null, 'golan'),   -- נאות גולן
    ('4014', null, 'golan'),   -- נטור
    ('4702', null, 'golan'),   -- רמות
    ('4008', null, 'golan'),   -- מעלה גמלא
    ('4204', null, 'golan'),   -- מבוא חמה
    ('4004', null, 'golan'),   -- כפר חרוב
    ('4002', null, 'golan'),   -- אלי-עד
    ('4003', null, 'golan'),   -- אל-רום
    ('4012', null, 'golan'),   -- אניעם
    ('4017', null, 'golan'),   -- אלוני הבשן
    ('4028', null, 'golan'),   -- כנף
    ('4024', null, 'golan'),   -- קלע
    ('4301', null, 'golan'),   -- אפיק
    ('4009', null, 'golan'),   -- שעל
    ('4022', null, 'golan'),   -- גשור
    ('4013', null, 'golan'),   -- אורטל
    ('4019', null, 'golan'),   -- מיצר
    ('4010', null, 'golan'),   -- אודם
    ('4303', null, 'golan'),   -- נווה אטי"ב
    ('4029', null, 'golan'),   -- רמת הנשיא טראמפ
    ('4035', null, 'golan'),   -- נמרוד
    ('4503', null, 'golan')   -- עין זיוון
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_0 integer;
  v_other integer;
begin
  select count(*) filter (where v.m = 'golan' and c.market_slug = 'golan'),
         count(*) filter (where c.market_slug is distinct from v.m)
    into v_0, v_other
    from public.cities c
    join (values
      ('4100', 'golan'),
      ('4005', 'golan'),
      ('4015', 'golan'),
      ('4304', 'golan'),
      ('4011', 'golan'),
      ('4006', 'golan'),
      ('4007', 'golan'),
      ('4701', 'golan'),
      ('4026', 'golan'),
      ('4101', 'golan'),
      ('4021', 'golan'),
      ('4025', 'golan'),
      ('4551', 'golan'),
      ('4014', 'golan'),
      ('4702', 'golan'),
      ('4008', 'golan'),
      ('4204', 'golan'),
      ('4004', 'golan'),
      ('4002', 'golan'),
      ('4003', 'golan'),
      ('4012', 'golan'),
      ('4017', 'golan'),
      ('4028', 'golan'),
      ('4024', 'golan'),
      ('4301', 'golan'),
      ('4009', 'golan'),
      ('4022', 'golan'),
      ('4013', 'golan'),
      ('4019', 'golan'),
      ('4010', 'golan'),
      ('4303', 'golan'),
      ('4029', 'golan'),
      ('4035', 'golan'),
      ('4503', 'golan')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'golan: %', v_0;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270613090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

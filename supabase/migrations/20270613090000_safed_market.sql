-- ===========================================================================
-- שוק חדש: "צפת, ראש פינה וחצור" (safed) - לא חי
--
-- השני משלושת שווקי הגליל העליון והגולן (החלטה של 18.10.2026,
-- docs/regional-pages.md): צפת, חצור הגלילית, ראש פינה, ו-30 יישובי מרום
-- הגליל ומבואות החרמון. כ-75 אלף תושבים רשומים (20270114096000). נולד **לא
-- חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- החלק הדרומי והמערבי של נפת צפת - העיר, חצור וראש פינה, יישובי מרום הגליל
-- עד גבול הלבנון (סאסא, ברעם, יראון, אביבים), ויישובי מבואות החרמון שמדרום
-- לעמק החולה (איילת השחר, כפר הנשיא, מחניים, משמר הירדן, גדות). **לא כאן:**
-- עמק החולה ואצבע הגליל - קריית שמונה והגליל העליון (20270612090000);
-- ריחאניה, ג'ש וטובא-זנגריה - אותו כלל של היישובים הערביים.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשלוש הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, v.market),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('8000', 'safed', 'safed'),
    ('2034', 'hatzor-haglilit', 'safed'),
    ('26', 'rosh-pina', 'safed'),
    ('1191', null, 'safed'),   -- בר יוחאי
    ('607', null, 'safed'),   -- מירון
    ('609', null, 'safed'),   -- כפר חושן
    ('368', null, 'safed'),   -- ביריה
    ('688', null, 'safed'),   -- עלמה
    ('1064', null, 'safed'),   -- אמירים
    ('730', null, 'safed'),   -- אליפלט
    ('1297', null, 'safed'),   -- כפר חנניה
    ('599', null, 'safed'),   -- פרוד
    ('667', null, 'safed'),   -- ברעם
    ('385', null, 'safed'),   -- עמיעד
    ('1294', null, 'safed'),   -- אור הגנוז
    ('664', null, 'safed'),   -- כרם בן זמרה
    ('605', null, 'safed'),   -- כפר שמאי
    ('1210', null, 'safed'),   -- כחל
    ('1115', null, 'safed'),   -- אביבים
    ('1252', null, 'safed'),   -- כורזים
    ('578', null, 'safed'),   -- סאסא
    ('846', null, 'safed'),   -- שפר
    ('1067', null, 'safed'),   -- דוב"ב
    ('1213', null, 'safed'),   -- צבעון
    ('623', null, 'safed'),   -- יראון
    ('431', null, 'safed'),   -- דלתון
    ('1338', null, 'safed'),   -- כדיתה
    ('1212', null, 'safed'),   -- עמוקה
    ('443', null, 'safed'),   -- כפר הנשיא
    ('77', null, 'safed'),   -- איילת השחר
    ('308', null, 'safed'),   -- מחניים
    ('732', null, 'safed'),   -- משמר הירדן
    ('35', null, 'safed')   -- גדות
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_0 integer;
  v_other integer;
begin
  select count(*) filter (where v.m = 'safed' and c.market_slug = 'safed'),
         count(*) filter (where c.market_slug is distinct from v.m)
    into v_0, v_other
    from public.cities c
    join (values
      ('8000', 'safed'),
      ('2034', 'safed'),
      ('26', 'safed'),
      ('1191', 'safed'),
      ('607', 'safed'),
      ('609', 'safed'),
      ('368', 'safed'),
      ('688', 'safed'),
      ('1064', 'safed'),
      ('730', 'safed'),
      ('1297', 'safed'),
      ('599', 'safed'),
      ('667', 'safed'),
      ('385', 'safed'),
      ('1294', 'safed'),
      ('664', 'safed'),
      ('605', 'safed'),
      ('1210', 'safed'),
      ('1115', 'safed'),
      ('1252', 'safed'),
      ('578', 'safed'),
      ('846', 'safed'),
      ('1067', 'safed'),
      ('1213', 'safed'),
      ('623', 'safed'),
      ('431', 'safed'),
      ('1338', 'safed'),
      ('1212', 'safed'),
      ('443', 'safed'),
      ('77', 'safed'),
      ('308', 'safed'),
      ('732', 'safed'),
      ('35', 'safed')
    ) as v(muni_code, m) on v.muni_code = c.muni_code;
  raise notice 'safed: %', v_0;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270612090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

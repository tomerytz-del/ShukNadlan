-- ===========================================================================
-- שוק חדש: "אילת והסביבה" (eilat) - לא חי
--
-- 22 בתוכנית (docs/regional-pages.md), שוק נפרד (החלטה של 18.10.2026): אילת,
-- באר אורה, יישובי חבל אילות והערבה התיכונה. כ-81 אלף תושבים רשומים
-- (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- אילת, 13 יישובי חבל אילות (באר אורה, יטבתה, קטורה, אילות, גרופית, יהל,
-- סמר, לוטן, נאות סמדר, אליפז, שחרות, נווה חריף, שיטים), ו-10 יישובי הערבה
-- התיכונה (עין יהב, חצבה, פארן, צופר, ספיר, עידן, צוקים, עין חצבה, עיר
-- אובות, שיזף) - הערבה התיכונה כאן ולא בדימונה (החלטה של 18.10.2026).
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לעיר, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'eilat'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('2600', 'eilat'),
    -- חבל אילות
    ('21', null), ('866', null), ('1052', null), ('1126', null), ('1129', null), ('1158', null),
    ('1156', null), ('1255', null), ('1197', null), ('1248', null), ('1266', null), ('1279', null),
    ('1267', null),
    -- הערבה התיכונה
    ('806', null), ('13', null), ('1151', null), ('1150', null), ('1176', null), ('1175', null),
    ('1262', null), ('1053', null), ('1187', null), ('1378', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'eilat'),
         count(*) filter (where market_slug is distinct from 'eilat')
    into v_in, v_other
    from public.cities
   where muni_code in ('2600',
                       '21', '866', '1052', '1126', '1129', '1158', '1156', '1255', '1197', '1248',
                       '1266', '1279', '1267',
                       '806', '13', '1151', '1150', '1176', '1175', '1262', '1053', '1187', '1378');
  raise notice 'eilat: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270606090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

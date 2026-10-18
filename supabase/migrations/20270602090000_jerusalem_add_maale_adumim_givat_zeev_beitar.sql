-- ===========================================================================
-- ירושלים והסביבה: מעלה אדומים, גבעת זאב וביתר עילית (החלטה של 18.10.2026)
--
-- שלוש הערים שהקונים בהן מחפשים בירושלים, ושלא נכללו ב-20270529090000 (שם
-- יישובי יהודה ושומרון נשארו "לא הוחלט"). כ-143 אלף תושבים רשומים
-- (20270114096000). שאר יישובי יהודה ושומרון - עדיין לא בשום שוק.
--
-- ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת); slug אמיתי רק כשהוא
-- עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'jerusalem'),
       slug        = case when c.slug = 'c-' || c.muni_code then v.slug else c.slug end
  from (values
    ('3616', 'maale-adumim'),
    ('3730', 'givat-zeev'),
    ('3780', 'beitar-illit')
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'jerusalem'),
         count(*) filter (where market_slug is distinct from 'jerusalem')
    into v_in, v_other
    from public.cities
   where muni_code in ('3616', '3730', '3780');
  raise notice 'jerusalem: % מתוך 3 נוספו', v_in;
  if v_other > 0 then
    raise warning '% ערים משויכות לשוק אחר או חסרות ברישום - לא נדרסו. לבדוק ביד.', v_other;
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
-- רחובות: הערים ייקלטו בסבב ה-gov הבא (כמו ב-20270530090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

-- ===========================================================================
-- שוק חדש: "חולון ובת ים" (holon-bat-yam) - לא חי
--
-- השביעי בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). חולון, בת
-- ים, אזור ומקווה ישראל - כל נפת חולון, כ-387 אלף תושבים רשומים
-- (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- **לא כאן:** יפו (שכונה של תל אביב-יפו) וראשון לציון (השוק הבא).
--
-- כולן כבר ברישום (20270114095000) - ולכן update. ‏market_slug רק אם ריק,
-- slug אמיתי לשלוש הרשויות רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'holon-bat-yam'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('6600', 'holon'),
    ('6200', 'bat-yam'),
    ('565', 'azor'),
    ('22', null)   -- מקווה ישראל
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'holon-bat-yam'),
         count(*) filter (where market_slug is distinct from 'holon-bat-yam')
    into v_in, v_other
    from public.cities
   where muni_code in ('6600', '6200', '565', '22');
  raise notice 'holon-bat-yam: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270518090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

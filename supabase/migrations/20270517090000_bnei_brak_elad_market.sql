-- ===========================================================================
-- שוק חדש: "בני ברק ואלעד" (bnei-brak-elad) - לא חי
--
-- החמישי בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). בני ברק
-- ואלעד, כ-296 אלף תושבים רשומים (20270114096000). נולד **לא חי** (הסקיל
-- new-market).
--
-- ## למה שתי ערים רחוקות בשוק אחד
--
-- זה שוק של קהל ולא של מקום: הקונה החרדי/ת מבני ברק מחפש/ת גם באלעד, ולהפך,
-- והמתווכים בשתיהן עובדים על אותו קהל (החלטה של 17.10.2026). ולכן ב-
-- assets/markets.js שתי תיבות locate נפרדות, ופתח תקווה וראש העין שביניהן
-- אינן בשוק.
--
-- **לא כאן:** אלעד עוברת מהשוק המתוכנן של פתח תקווה וראש העין.
--
-- שתיהן כבר ברישום (20270114095000) - ולכן update. ‏market_slug רק אם ריק,
-- slug אמיתי רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'bnei-brak-elad'),
       slug        = case when c.slug = 'c-' || c.muni_code then v.slug else c.slug end
  from (values
    ('6100', 'bnei-brak'),
    ('1309', 'elad')
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'bnei-brak-elad'),
         count(*) filter (where market_slug is distinct from 'bnei-brak-elad')
    into v_in, v_other
    from public.cities
   where muni_code in ('6100', '1309');
  raise notice 'bnei-brak-elad: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270516090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

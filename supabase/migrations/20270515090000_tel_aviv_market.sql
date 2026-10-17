-- ===========================================================================
-- שוק חדש: "תל אביב-יפו" (tel-aviv) - לא חי
--
-- השלישי בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). העיר לבדה -
-- כ-600 אלף תושבים רשומים (20270114096000), שוק בפני עצמו בגודל של שלושה
-- שווקים בצפון. נולד **לא חי** (הסקיל new-market).
--
-- **לא כאן:** רמת גן, גבעתיים, בני ברק, חולון ובת ים - כל אחת בשוק שלה
-- בתוכנית. כל השכונות של תל אביב ויפו (הצפון הישן, רמת אביב, יפו, שכונת
-- התקווה) הן שכונות של אותה עיר, ונכנסות בייבוא השכונות מ-GovMap.
--
-- העיר כבר ברישום (20270114095000, סמל 5000, slug זמני c-5000) - ולכן update.
-- ‏market_slug רק אם ריק, slug אמיתי רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'tel-aviv'),
       slug        = case when c.slug = 'c-' || c.muni_code then 'tel-aviv' else c.slug end
 where c.muni_code = '5000';

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'tel-aviv'),
         count(*) filter (where market_slug is distinct from 'tel-aviv')
    into v_in, v_other
    from public.cities
   where muni_code = '5000';
  raise notice 'tel-aviv: % יישובים בשוק', v_in;
  if v_other > 0 or v_in = 0 then
    raise warning 'תל אביב-יפו משויכת לשוק אחר או חסרה ברישום - לא נדרסה. לבדוק ביד.';
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
-- רחובות: העיר תיקלט בסבב ה-gov הבא (כמו ב-20270514090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

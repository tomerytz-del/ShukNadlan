-- ===========================================================================
-- שוק חדש: "רמת גן וגבעתיים" (ramat-gan) - לא חי
--
-- הרביעי בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). רמת גן,
-- גבעתיים, קריית אונו, אור יהודה, יהוד-מונוסון, סביון וגני תקווה. כ-440 אלף
-- תושבים רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו הערים
--
-- רמת גן וגבעתיים הן שוק אחד - הקונה בגבעתיים מחפש/ת גם ברמת גן. קריית אונו,
-- גני תקווה וסביון צמודות להן ממזרח, ואור יהודה ויהוד-מונוסון מדרום-מזרח.
--
-- **לא כאן:** בני ברק (שוק בני ברק ואלעד, החלטה של 17.10.2026), גבעת שמואל
-- (פתח תקווה וראש העין), וחולון ואזור (חולון ובת ים).
--
-- ## כולן כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשבע הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'ramat-gan'),
       slug        = case when c.slug = 'c-' || c.muni_code then v.slug else c.slug end
  from (values
    ('8600', 'ramat-gan'),
    ('6300', 'givatayim'),
    ('2620', 'kiryat-ono'),
    ('2400', 'or-yehuda'),
    ('9400', 'yehud-monosson'),
    ('587', 'savyon'),
    ('229', 'ganei-tikva')
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'ramat-gan'),
         count(*) filter (where market_slug is distinct from 'ramat-gan')
    into v_in, v_other
    from public.cities
   where muni_code in ('8600', '6300', '2620', '2400', '9400', '587', '229');
  raise notice 'ramat-gan: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270515090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

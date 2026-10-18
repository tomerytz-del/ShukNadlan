-- ===========================================================================
-- שוק חדש: "לוד ורמלה" (lod-ramla) - לא חי
--
-- האחד-עשר בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). לוד, רמלה,
-- באר יעקב, כפר חב"ד, בית דגן, ו-30 יישובי עמק לוד, גזר, חבל מודיעין המערבי
-- ובני שמעון-נחשון שבנפת רמלה. כ-264 אלף תושבים רשומים (20270114096000).
-- נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- כל מה שנשאר בנפת רמלה אחרי מודיעין והסביבה (20270522090000): לוד ורמלה
-- הן המרכז, באר יעקב, כפר חב"ד ובית דגן צמודות אליהן, ויישובי המועצות סביבן.
--
-- **לא כאן:** היישובים שכבר במודיעין והסביבה (שוהם, בן שמן, כפר טרומן,
-- חדיד, שעלבים, נוף איילון ועוד) - נשארים שם.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לחמש הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'lod-ramla'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('7000', 'lod'),
    ('8500', 'ramla'),
    ('2530', 'beer-yaakov'),
    ('696', 'kfar-chabad'),
    ('466', 'beit-dagan'),
    -- יישובי המועצות בנפה
    ('1050', null), ('797', null), ('158', null), ('1264', null), ('563', null),
    ('160', null), ('757', null), ('331', null), ('804', null), ('64', null),
    ('801', null), ('711', null), ('435', null), ('610', null), ('788', null),
    ('828', null), ('729', null), ('594', null), ('743', null), ('798', null),
    ('839', null), ('759', null), ('2010', null), ('838', null), ('735', null),
    ('301', null), ('370', null), ('670', null), ('836', null), ('1103', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'lod-ramla'),
         count(*) filter (where market_slug is distinct from 'lod-ramla')
    into v_in, v_other
    from public.cities
   where muni_code in ('7000', '8500', '2530', '696', '466',
                       '1050', '797', '158', '1264', '563', '160', '757', '331', '804', '64',
                       '801', '711', '435', '610', '788', '828', '729', '594', '743', '798',
                       '839', '759', '2010', '838', '735', '301', '370', '670', '836', '1103');
  raise notice 'lod-ramla: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270522090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

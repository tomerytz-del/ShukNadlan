-- ===========================================================================
-- שוק חדש: "הרצליה ורמת השרון" (herzliya) - לא חי
--
-- השני בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). הרצליה, רמת
-- השרון, כפר שמריהו, גליל ים, והחצי החופי של חוף השרון. כ-195 אלף תושבים
-- רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו הערים
--
-- הרצליה, הרצליה פיתוח, רמת השרון וכפר שמריהו הם שוק אחד, יקר משכניו
-- ממזרח, ולכן לא חלק מכפר סבא ורעננה (החלטה של 17.10.2026).
--
-- **חוף השרון - לפי הגאוגרפיה, כמו דרום השרון** (20270512090000): המועצה
-- נמתחת מארסוף ועד כפר נטר, ושני החצאים שלה הם שני אזורי קנייה.
--   - החופי, צמוד להרצליה: שפיים, געש, רשפון, ארסוף, יקום - **כאן**.
--   - הפנימי, בקצה הדרומי של נתניה ואבן יהודה: כפר נטר, אודים, תל יצחק,
--     בית יהושע, בני ציון, בצרה, חרוצים - **לנתניה**, שעד היום לא כללה
--     את חוף השרון כלל ("לכיוון הרצליה", 20270114103000).
--
-- **לא כאן:** קריית שלמה (8 תושבים רשומים, ולא ברור לאיזו מועצה) וכפר
-- עבודה (אין נתוני אוכלוסייה) - נשארים בלי שוק עד שיהיה בהם נכס.
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
    ('6400', 'herzliya', 'herzliya'),
    ('2650', 'ramat-hasharon', 'herzliya'),
    ('267', 'kfar-shmaryahu', 'herzliya'),
    ('346', null, 'herzliya'),  -- גליל ים
    -- חוף השרון, החצי החופי
    ('232', null, 'herzliya'),  -- שפיים
    ('842', null, 'herzliya'),  -- געש
    ('247', null, 'herzliya'),  -- רשפון
    ('1324', null, 'herzliya'), -- ארסוף
    ('417', null, 'herzliya'),  -- יקום
    -- חוף השרון, החצי הפנימי - לנתניה
    ('316', null, 'netanya'),   -- כפר נטר
    ('446', null, 'netanya'),   -- אודים
    ('287', null, 'netanya'),   -- תל יצחק
    ('288', null, 'netanya'),   -- בית יהושע
    ('418', null, 'netanya'),   -- בני ציון
    ('389', null, 'netanya'),   -- בצרה
    ('1024', null, 'netanya')   -- חרוצים
  ) as v(muni_code, slug, market)
 where c.muni_code = v.muni_code;

do $$
declare
  v_h     integer;
  v_n     integer;
  v_other integer;
begin
  select count(*) filter (where muni_code in ('6400', '2650', '267', '346', '232', '842', '247', '1324', '417')
                            and market_slug = 'herzliya'),
         count(*) filter (where muni_code in ('316', '446', '287', '288', '418', '389', '1024')
                            and market_slug = 'netanya'),
         count(*) filter (where (muni_code in ('6400', '2650', '267', '346', '232', '842', '247', '1324', '417')
                                 and market_slug is distinct from 'herzliya')
                             or (muni_code in ('316', '446', '287', '288', '418', '389', '1024')
                                 and market_slug is distinct from 'netanya'))
    into v_h, v_n, v_other
    from public.cities
   where muni_code in ('6400', '2650', '267', '346', '232', '842', '247', '1324', '417',
                       '316', '446', '287', '288', '418', '389', '1024');
  raise notice 'herzliya: % יישובים בשוק; netanya: % יישובים נוספו', v_h, v_n;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270512090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

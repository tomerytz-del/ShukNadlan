-- ===========================================================================
-- שוק חדש: "מודיעין והסביבה" (modiin) - לא חי
--
-- העשירי בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). מודיעין-
-- מכבים-רעות, שוהם, ו-16 יישובי חבל מודיעין וגזר שביניהן. כ-152 אלף תושבים
-- רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- מודיעין ושוהם, ויישובי חבל מודיעין שצמודים אליהן (בן שמן, כפר טרומן, חדיד,
-- בית עריף, בית נחמיה, גינתון, כפר דניאל, גמזו), יישובי מודיעין שבצפון
-- (שילת, לפיד, כפר רות, מבוא מודיעים), ושעלבים ונוף איילון מגזר - שם
-- הקונים מחפשים במודיעין.
--
-- **לא כאן:**
--   - כפר שמואל, משמר איילון, כפר בן נון ושאר יישובי גזר שליד רמלה, ואחיעזר
--     (ליד השדה) - לוד ורמלה, הבא בתור.
--   - חשמונאים, כפר האורנים ומתתיהו - מעבר לקו הירוק, לא ברשימה הזו.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשתי הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'modiin'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('1200', 'modiin'),
    ('1304', 'shoham'),
    ('604', null),   -- בית עריף
    ('784', null),   -- בית נחמיה
    ('618', null),   -- חדיד
    ('673', null),   -- כפר טרומן
    ('2013', null),  -- בן שמן (מושב)
    ('1084', null),  -- בן שמן (כפר נוער)
    ('88', null),    -- כרם בן שמן
    ('863', null),   -- גינתון
    ('707', null),   -- כפר דניאל
    ('745', null),   -- גמזו
    ('1165', null),  -- שילת
    ('1310', null),  -- לפיד
    ('1166', null),  -- כפר רות
    ('1141', null),  -- מבוא מודיעים
    ('856', null),   -- שעלבים
    ('1333', null)   -- נוף איילון
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'modiin'),
         count(*) filter (where market_slug is distinct from 'modiin')
    into v_in, v_other
    from public.cities
   where muni_code in ('1200', '1304', '604', '784', '618', '673', '2013', '1084', '88',
                       '863', '707', '745', '1165', '1310', '1166', '1141', '856', '1333');
  raise notice 'modiin: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270521090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

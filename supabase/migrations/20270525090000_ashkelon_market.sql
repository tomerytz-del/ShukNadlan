-- ===========================================================================
-- שוק חדש: "אשקלון והסביבה" (ashkelon) - לא חי
--
-- השלושה-עשר בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). אשקלון
-- ו-19 יישובי חוף אשקלון שסביבה. כ-208 אלף תושבים רשומים
-- (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- אותה חלוקה גאוגרפית של נפת אשקלון (20270524090000): כאן היישובים שסביב
-- אשקלון, מניצנים בצפון ועד נתיב העשרה וזיקים בדרום.
--
-- **לא כאן:** יישובי חוף אשקלון הצפוניים (ניצן, ניצן ב' - אשדוד והסביבה),
-- ויישובי שער הנגב, שפיר, לכיש ויואב - קריית גת ושדרות, הבא בתור.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לעיר, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'ashkelon'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('7100', 'ashkelon'),
    ('747', null),   -- בית שקמה
    ('746', null),   -- ברכיה
    ('706', null),   -- גיאה
    ('726', null),   -- הודיה
    ('584', null),   -- זיקים
    ('820', null),   -- חלץ
    ('824', null),   -- כוכב מיכאל
    ('768', null),   -- כרמיה
    ('573', null),   -- מבקיעים
    ('791', null),   -- משען
    ('359', null),   -- ניצנים
    ('1242', null),  -- נתיב העשרה
    ('744', null),   -- תלמי יפה
    ('358', null),   -- יד מרדכי
    ('107', null),   -- כפר סילבר
    ('1323', null),  -- בת הדר
    ('1149', null),  -- עזר
    ('342', null),   -- גברעם
    ('699', null)    -- ניר ישראל
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'ashkelon'),
         count(*) filter (where market_slug is distinct from 'ashkelon')
    into v_in, v_other
    from public.cities
   where muni_code in ('7100', '747', '746', '706', '726', '584', '820', '824', '768', '573',
                       '791', '359', '1242', '744', '358', '107', '1323', '1149', '342', '699');
  raise notice 'ashkelon: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270524090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

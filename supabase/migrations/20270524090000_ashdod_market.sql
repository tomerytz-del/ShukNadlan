-- ===========================================================================
-- שוק חדש: "אשדוד והסביבה" (ashdod) - לא חי
--
-- השנים-עשר בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). אשדוד,
-- קריית מלאכי, ו-24 יישובי באר טוביה וחוף אשקלון הצפוני שביניהן. כ-317 אלף
-- תושבים רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- נפת אשקלון מתחלקת לשלושה שווקים: אשדוד, אשקלון, וקריית גת ושדרות. החלוקה
-- גאוגרפית ולא לפי מועצה (סמל המועצה אינו ברישום): כאן היישובים שבין אשדוד
-- לקריית מלאכי ולגבול רחובות ונס ציונה.
--
-- **קריית מלאכי כאן ולא בקריית גת** (שינוי מהתוכנית): היא 10 ק"מ מאשדוד,
-- מוקפת ביישובי באר טוביה, והקונים בה מחפשים באשדוד ובגדרה.
--
-- **לא כאן:**
--   - מחנה מרים (1414) - בסיס.
--   - יישובי חוף אשקלון שליד אשקלון, ויישובי שפיר, לכיש, יואב ושער הנגב -
--     אשקלון, וקריית גת ושדרות, הבאים בתור.
--   - גן יבנה, גדרה ובני עי"ש - כבר ברחובות ונס ציונה.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשתי הערים, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'ashdod'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('70', 'ashdod'),
    ('1034', 'kiryat-malachi'),
    ('406', null),   -- חצור-אשדוד
    ('817', null),   -- עזריקם
    ('772', null),   -- אמונים
    ('155', null),   -- באר טוביה
    ('234', null),   -- ביצרון
    ('320', null),   -- כפר ורבורג
    ('756', null),   -- בית עזרא
    ('700', null),   -- חצב
    ('593', null),   -- ערוגות
    ('793', null),   -- גבעתי
    ('690', null),   -- כפר אחים
    ('819', null),   -- אביגדור
    ('163', null),   -- תימורים
    ('763', null),   -- שתולים
    ('2011', null),  -- ינון
    ('2006', null),  -- כנות
    ('2012', null),  -- אורות
    ('727', null),   -- תלמי יחיאל
    ('392', null),   -- קדמה
    ('1157', null),  -- אחווה
    ('1098', null),  -- מרכז שפירא
    ('351', null),   -- ניצן
    ('1419', null)   -- ניצן ב'
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'ashdod'),
         count(*) filter (where market_slug is distinct from 'ashdod')
    into v_in, v_other
    from public.cities
   where muni_code in ('70', '1034', '406', '817', '772', '155', '234', '320', '756', '700',
                       '593', '793', '690', '819', '163', '763', '2011', '2006', '2012', '727',
                       '392', '1157', '1098', '351', '1419');
  raise notice 'ashdod: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270523090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

-- ===========================================================================
-- שוק חדש: "רחובות ונס ציונה" (rehovot) - לא חי
--
-- התשיעי בדרך דרומה (docs/regional-pages.md, "ההתפרסות דרומה"). נפת רחובות
-- כולה: רחובות, נס ציונה, יבנה, גדרה, גן יבנה, מזכרת בתיה, קריית עקרון, בני
-- עי"ש, ו-39 יישובי גן רווה, ברנר, חבל יבנה וגדרות. כ-415 אלף תושבים רשומים
-- (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו הערים
--
-- לפי הנפה, כמו בחדרה: רחובות היא המרכז, ונס ציונה, מזכרת בתיה, קריית עקרון
-- ויבנה צמודות לה. גדרה, גן יבנה ובני עי"ש בקצה הדרומי - עדיין חלק מאזור
-- הקנייה של רחובות ולא של אשדוד.
--
-- **לא כאן:**
--   - מחנה תל נוף ומחנה הילה (1412, 1411) - בסיסים, לא יישובים לנדל"ן.
--   - באר יעקב (נפת רמלה) - לוד ורמלה, כפי שבתוכנית.
--   - ראשון לציון (שוק משלה) ואשדוד (שוק משלה, בתור).
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשמונה הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'rehovot'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('8400', 'rehovot'),
    ('2660', 'yavne'),
    ('7200', 'ness-ziona'),
    ('2550', 'gedera'),
    ('166', 'gan-yavne'),
    ('28', 'mazkeret-batya'),
    ('469', 'kiryat-ekron'),
    ('1066', 'bnei-ayish'),
    -- יישובי המועצות בנפה
    ('577', null), ('147', null), ('615', null), ('562', null), ('588', null),
    ('720', null), ('1336', null), ('177', null), ('853', null), ('2033', null),
    ('571', null), ('592', null), ('591', null), ('582', null), ('1371', null),
    ('440', null), ('597', null), ('760', null), ('685', null), ('334', null),
    ('857', null), ('174', null), ('765', null), ('363', null), ('731', null),
    ('764', null), ('144', null), ('862', null), ('159', null), ('1372', null),
    ('555', null), ('1072', null), ('848', null), ('196', null), ('311', null),
    ('202', null), ('1094', null), ('156', null), ('1111', null)
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'rehovot'),
         count(*) filter (where market_slug is distinct from 'rehovot')
    into v_in, v_other
    from public.cities
   where muni_code in ('8400', '2660', '7200', '2550', '166', '28', '469', '1066',
                       '577', '147', '615', '562', '588', '720', '1336', '177', '853', '2033',
                       '571', '592', '591', '582', '1371', '440', '597', '760', '685', '334',
                       '857', '174', '765', '363', '731', '764', '144', '862', '159', '1372',
                       '555', '1072', '848', '196', '311', '202', '1094', '156', '1111');
  raise notice 'rehovot: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270520090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

-- ===========================================================================
-- שוק חדש: "כפר סבא ורעננה" (kfar-saba-raanana) - לא חי
--
-- הראשון מהשווקים שבדרך דרומה, עד באר שבע (docs/regional-pages.md, "ההתפרסות
-- דרומה"). כפר סבא, רעננה, הוד השרון, כוכב יאיר-צור יגאל, צור יצחק, מתן,
-- ו-22 יישובי צפון דרום השרון. כ-330 אלף תושבים רשומים (20270114096000).
-- נולד **לא חי** - "נפתחים בקרוב" ב-noindex, לגיוס המשרדים (הסקיל new-market).
--
-- ## איך נבחרו הערים
--
-- שלוש הערים הן שוק אחד: הקונה בכפר סבא מחפש/ת גם ברעננה ובהוד השרון, ו-
-- המושבים שביניהן (נווה ירק, צופית, שדה ורבורג, רמות השבים) נמכרים
-- כ"ליד כפר סבא". כוכב יאיר-צור יגאל וצור יצחק צמודים לכפר סבא מזרחה.
--
-- **דרום השרון - לפי הגאוגרפיה, לא לפי המועצה**, בניגוד לעמק חפר בנתניה:
-- המועצה נמתחת מגן חיים ועד גבעת השלושה, והחצי הדרומי שלה (כפר סירקין,
-- נחשונים, מגשימים, גבעת השלושה, עינת, מזור, נחלים, טירת יהודה, בני
-- עטרות, רינתיה, גבעת כ"ח, מעש, בארות יצחק, נופך, גת רימון, ברקת) צמוד
-- לפתח תקווה ולראש העין, ושם הוא יישב (השוק הבא בתור באזור).
--
-- **לא כאן:**
--   - הרצליה, רמת השרון וחוף השרון - שוק משלהם, בתור.
--   - ג'לג'וליה, כפר קאסם, כפר ברא, טייבה וטירה - אותו כלל של נתניה: עיר
--     ערבית עצמאית נכנסת כשיש בה משרדים.
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לשש הרשויות, רק כשהוא עדיין זמני. יישובי המועצה נשארים
--     עם הזמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'kfar-saba-raanana'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('6900', 'kfar-saba'),
    ('8700', 'raanana'),
    ('9700', 'hod-hasharon'),
    ('1224', 'kochav-yair-tzur-yigal'),
    ('1345', 'tzur-yitzhak'),
    ('1315', 'matan'),
    -- דרום השרון, החצי הצפוני
    ('858', null),  -- נווה ירק
    ('686', null),  -- נווה ימין
    ('284', null),  -- שדה ורבורג
    ('206', null),  -- רמות השבים
    ('718', null),  -- ירחיב
    ('198', null),  -- צופית
    ('1236', null), -- נירית
    ('717', null),  -- חגור
    ('716', null),  -- אייל
    ('808', null),  -- ניר אליהו
    ('218', null),  -- גני עם
    ('98', null),   -- כפר מל"ל
    ('1148', null), -- צור נתן
    ('355', null),  -- חורשים
    ('183', null),  -- ירקונה
    ('207', null),  -- גבעת ח"ן
    ('2035', null), -- עדנים
    ('841', null),  -- אלישמע
    ('2015', null), -- שדי חמד
    ('184', null),  -- רמת הכובש
    ('1076', null), -- בית ברל
    ('239', null)   -- גן חיים
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'kfar-saba-raanana'),
         count(*) filter (where market_slug is distinct from 'kfar-saba-raanana')
    into v_in, v_other
    from public.cities
   where muni_code in ('6900', '8700', '9700', '1224', '1345', '1315', '858', '686', '284', '206',
                       '718', '198', '1236', '717', '716', '808', '218', '98', '1148', '355',
                       '183', '207', '2035', '841', '2015', '184', '1076', '239');
  raise notice 'kfar-saba-raanana: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270114103000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

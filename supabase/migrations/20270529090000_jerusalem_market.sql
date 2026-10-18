-- ===========================================================================
-- שוק חדש: "ירושלים והסביבה" (jerusalem) - לא חי
--
-- 16 בתוכנית (docs/regional-pages.md, "ההתפרסות דרומה"). ירושלים, מבשרת ציון,
-- קריית יערים, צור הדסה, ו-22 יישובי מטה יהודה שבהרים סביב העיר. כ-1.18
-- מיליון תושבים רשומים (20270114096000). נולד **לא חי** (הסקיל new-market).
--
-- ## איך נבחרו היישובים
--
-- נפת ירושלים מתחלקת לשני שווקים: ירושלים, ובית שמש (17, הבא בתור). החלוקה
-- גאוגרפית - סמל המועצה אינו ברישום: כאן היישובים שהדרך שלהם היא לירושלים
-- (כביש 1 עד שורש, כבישים 386 ו-395 עד רמת רזיאל, כסלון ובר גיורא, וצור
-- הדסה ומבוא ביתר בדרום). ממערב להם - שער הגיא, עמק האלה ויישובי השפלה -
-- בית שמש.
--
-- **לא כאן:**
--   - אבו גוש (החלטה של 18.10.2026), עין נקובא ועין ראפה - אותו כלל של
--     הערים הערביות: נכנסים כשיש בהם משרדים.
--   - בית שמש, ויישובי מטה יהודה שממערב (צרעה, אשתאול, נחשון, הראל, מסילת
--     ציון, מטע, צפרירים, עמק האלה...) - בית שמש והסביבה, הבא בתור.
--   - יישובי יהודה ושומרון (מעלה אדומים, גבעת זאב, ביתר עילית, גוש עציון) -
--     לא הוחלט.
--   - מוסדות ויישובים זעירים (קרית יערים (מוסד), עין כרם-בי"ס חקלאי, דייר
--     ראפאת).
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לארבע הרשויות, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'jerusalem'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('3000', 'jerusalem'),
    ('1015', 'mevaseret-zion'),
    ('1137', 'kiryat-yearim'),
    ('1113', 'tzur-hadassah'),
    -- מטה יהודה
    ('208', null),   -- מוצא עילית
    ('710', null),   -- בית זית
    ('780', null),   -- אורה
    ('779', null),   -- עמינדב
    ('783', null),   -- אבן ספיר
    ('127', null),   -- רמת רחל
    ('465', null),   -- צובה
    ('78', null),    -- קרית ענבים
    ('286', null),   -- מעלה החמישה
    ('456', null),   -- שורש
    ('741', null),   -- שואבה
    ('405', null),   -- נווה אילן
    ('787', null),   -- גבעת יערים
    ('1134', null),  -- יד השמונה
    ('1254', null),  -- נטף
    ('672', null),   -- בית נקופה
    ('751', null),   -- בית מאיר
    ('460', null),   -- רמת רזיאל
    ('859', null),   -- כסלון
    ('823', null),   -- בר גיורא
    ('825', null),   -- נס הרים
    ('771', null)    -- מבוא ביתר
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'jerusalem'),
         count(*) filter (where market_slug is distinct from 'jerusalem')
    into v_in, v_other
    from public.cities
   where muni_code in ('3000', '1015', '1137', '1113', '208', '710', '780', '779', '783', '127',
                       '465', '78', '286', '456', '741', '405', '787', '1134', '1254', '672',
                       '751', '460', '859', '823', '825', '771');
  raise notice 'jerusalem: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270528090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

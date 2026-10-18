-- ===========================================================================
-- שוק חדש: "בית שמש והסביבה" (beit-shemesh) - לא חי
--
-- 17 בתוכנית (docs/regional-pages.md, "ההתפרסות דרומה"), שוק נפרד מירושלים
-- (החלטה של 17.10.2026). בית שמש ו-34 יישובי מטה יהודה שממערב להרי ירושלים.
-- כ-227 אלף תושבים רשומים (20270114096000). נולד **לא חי** (הסקיל
-- new-market).
--
-- ## איך נבחרו היישובים
--
-- החצי השני של נפת ירושלים (20270529090000): היישובים שהדרך שלהם היא לבית
-- שמש - שער הגיא ולטרון (נחשון, נווה שלום, מסילת ציון, הראל), יישובי השפלה
-- שסביב העיר (צרעה, אשתאול, תעוז, טל שחר, כפר אוריה, ישעי, תרום, בקוע), ועמק
-- האלה ודרומה (זכריה, צפרירים, שריגים, אדרת, נווה מיכאל, אביעזר, לוזית, מטע,
-- נתיב הל"ה, גבעת ישעיהו, תירוש, גפן, שדות מיכה). החלוקה גאוגרפית - סמל
-- המועצה אינו ברישום.
--
-- **לא כאן:**
--   - יישובי מטה יהודה שבהרים (שורש, רמת רזיאל, כסלון, בר גיורא, מבוא ביתר,
--     צור הדסה) - כבר בירושלים והסביבה.
--   - אבו גוש, עין נקובא ועין ראפה - אותו כלל של הערים הערביות.
--   - גבעות עדן (1362) - מיקומו לא אומת, ולכן לא שויך. ‏market_slug ביד
--     כשיתברר.
--   - מוסדות (איתנים, גבעת שמש).
--
-- ## כולם כבר ברישום (20270114095000) - ולכן update ולא insert
--
--   - ‏market_slug - רק אם ריק (לא דורסים החלטה של מנהל/ת).
--   - ‏slug אמיתי לעיר, רק כשהוא עדיין זמני.
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'beit-shemesh'),
       slug        = case when v.slug is not null and c.slug = 'c-' || c.muni_code
                          then v.slug else c.slug end
  from (values
    ('2610', 'beit-shemesh'),
    -- שער הגיא ולטרון
    ('777', null),   -- נחשון
    ('1259', null),  -- נווה שלום
    ('742', null),   -- מסילת ציון
    ('464', null),   -- הראל
    -- סביב העיר
    ('567', null),   -- צרעה
    ('740', null),   -- אשתאול
    ('752', null),   -- תעוז
    ('462', null),   -- טל שחר
    ('364', null),   -- כפר אוריה
    ('805', null),   -- ישעי
    ('778', null),   -- תרום
    ('864', null),   -- בקוע
    ('809', null),   -- נחם
    ('816', null),   -- זנוח
    ('796', null),   -- צלפון
    ('776', null),   -- מחסיה
    ('1144', null),  -- ידידה
    -- עמק האלה ודרומה
    ('799', null),   -- זכריה
    ('1079', null),  -- צפרירים
    ('1114', null),  -- שריגים (לי-און)
    ('1123', null),  -- אדרת
    ('1071', null),  -- נווה מיכאל
    ('1070', null),  -- אביעזר
    ('52', null),    -- לוזית
    ('822', null),   -- מטע
    ('693', null),   -- נתיב הל"ה
    ('919', null),   -- גבעת ישעיהו
    ('59', null),    -- נחושה
    ('794', null),   -- עגור
    ('10', null),    -- תירוש
    ('39', null),    -- גפן
    ('27', null),    -- שדות מיכה
    ('1043', null),  -- גיזו
    ('1325', null)   -- כפר זוהרים
  ) as v(muni_code, slug)
 where c.muni_code = v.muni_code;

do $$
declare
  v_in    integer;
  v_other integer;
begin
  select count(*) filter (where market_slug = 'beit-shemesh'),
         count(*) filter (where market_slug is distinct from 'beit-shemesh')
    into v_in, v_other
    from public.cities
   where muni_code in ('2610', '777', '1259', '742', '464', '567', '740', '752', '462', '364',
                       '805', '778', '864', '809', '816', '796', '776', '1144', '799', '1079',
                       '1114', '1123', '1071', '1070', '52', '822', '693', '919', '59', '794',
                       '10', '39', '27', '1043', '1325');
  raise notice 'beit-shemesh: % יישובים בשוק', v_in;
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
-- רחובות: ערי השוק ייקלטו בסבב ה-gov הבא (כמו ב-20270529090000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

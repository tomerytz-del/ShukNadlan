-- ===========================================================================
-- שני תיקונים בחלוקת השווקים, אחרי השוואה לחלוקה של יד 2 (26.9.2026)
--
-- ## 1. "נצרת ונוף הגליל" → "נוף הגליל ומגדל העמק" (nof-hagalil-migdal)
--
-- ב-20270114100000 נצרת נכנסה לשוק אחד עם נוף הגליל ומגדל העמק. זו הייתה
-- טעות במבחן של השוק עצמו - החלופות של הקונה: היישובים הערביים והיהודיים
-- בצפון הם ברובם שני שוקי דיור נפרדים (קונים שכמעט אינם עוברים ביניהם,
-- ומתווכים אחרים), וכך בדיוק מחלק גם יד 2 ("נצרת - שפרעם והסביבה" לחוד).
--
--   - נצרת יוצאת מהשוק (market_slug = null) - update מפורש, כי זו החלטה.
--     היא תיכנס לשוק "נצרת, שפרעם והסביבה" כשיהיו בו משרדים. ה-slug
--     `nazareth` נשאר: הוא אמיתי, ואינו משתנה לעולם.
--   - נוף הגליל ומגדל העמק עוברות ל-slug החדש. השוק לא היה חי ולא שותף
--     (שעה אחת כ"נפתחים בקרוב", noindex), ולכן זה הרגע הזול לשנות; הכתובת
--     הקודמת מפנה לחדשה ב-_redirects.
--
-- ## 2. צפון חוף הכרמל → "חיפה והקריות"
--
-- עתלית, עין הוד ושכנותיהן 10-20 דקות מחיפה ומטירת כרמל, והקונים שם
-- מחפשים גם שם. **לא כל המועצה**, למרות כלל המועצה של מטה אשר ומשגב: חוף
-- הכרמל נמשכת עד קיסריה (כ-40 ק"מ מחיפה), ועשרת היישובים הדרומיים שלה -
-- קיסריה, שדות ים, מעגן מיכאל, מעיין צבי, בית חנניה, מאיר שפיה, בת שלמה,
-- דור, נחשולים ובית צבי - שייכים לשוק של חדרה או של זכרון, כשיקום. בינתיים
-- הם בלי שוק. 16 היישובים כאן: כ-24 אלף תושבים (20270114096000).
--
-- **כולם כבר ברישום (20270114095000)** - update לפי סמל יישוב, market_slug
-- רק אם ריק. יישובי המועצה נשארים עם ה-slug הזמני, כמו מטה אשר.
-- ===========================================================================

-- 1. נוף הגליל ומגדל העמק - רק ממה שהמיגרציה הקודמת כתבה, לא דורסים שיוך אחר
update public.cities
   set market_slug = 'nof-hagalil-migdal'
 where muni_code in ('1061', '874')
   and market_slug = 'nazareth-nof-hagalil';

update public.cities
   set market_slug = null
 where muni_code = '7300'
   and market_slug = 'nazareth-nof-hagalil';

-- 2. צפון חוף הכרמל (קוד מועצה 15)
update public.cities c
   set market_slug = coalesce(c.market_slug, 'haifa-krayot')
 where c.muni_code in ('53',   -- עתלית
                       '74',   -- עין הוד
                       '1320', -- עין חוד
                       '769',  -- ניר עציון
                       '689',  -- מגדים
                       '427',  -- כפר גלים
                       '434',  -- החותרים
                       '317',  -- בית אורן
                       '426',  -- עין כרמל
                       '312',  -- נווה ים
                       '683',  -- גבע כרמל
                       '612',  -- צרופה
                       '580',  -- כרם מהר"ל
                       '810',  -- עופר
                       '687',  -- עין איילה
                       '675'); -- הבונים

do $$
declare
  v_nof    integer;
  v_left   integer;
  v_carmel integer;
begin
  select count(*) into v_nof from public.cities where market_slug = 'nof-hagalil-migdal';
  select count(*) into v_left from public.cities where market_slug = 'nazareth-nof-hagalil';
  select count(*) into v_carmel from public.cities
   where market_slug = 'haifa-krayot'
     and muni_code in ('53','74','1320','769','689','427','434','317','426','312',
                       '683','612','580','810','687','675');
  raise notice 'nof-hagalil-migdal: % ערים; חוף הכרמל בחיפה: % מתוך 16', v_nof, v_carmel;
  if v_left > 0 then
    raise warning '% ערים עדיין משויכות ל-nazareth-nof-hagalil - לבדוק ביד.', v_left;
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
-- רחובות: עתלית ושכנותיה ייקלטו בסבב ה-gov הבא (כמו ב-20270114098000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

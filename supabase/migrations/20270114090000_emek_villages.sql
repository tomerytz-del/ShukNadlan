-- ===========================================================================
-- יישובי העמק מצטרפים לשוק "עפולה והעמק"
--
-- עד היום השוק נשא שתי ערים בלבד (עפולה, היוגב), ובמאגר העסקאות הרשמי
-- ישבו 12 יישובים סביב עפולה בלי שיוך לשום שוק: 687 עסקאות שתצוגת המנהל/ת
-- לא ספרה, ושנכס עתידי בהם לא היה משויך לעפולה והעמק. כולם בתוך תיבת
-- הזיהוי של השוק ב-assets/markets.js (ממוצע הפינים של העסקאות שלהם נבדק,
-- 26.9.2026), כך שה-GPS כבר שולח אותם לעפולה - זה רק מיישר את המסד.
--
-- **שורה ידנית נושאת שם, אזור, slug ושוק בלבד** (הסקיל new-market): בלי
-- קואורדינטות, סמל יישוב או אוכלוסייה. אותה תבנית בדיוק כמו
-- 20270112090000_markets.sql, כולל ה-coalesce שאינו דורס שיוך קיים.
--
-- ‏"מרחביה (מושב)" ו"מרחביה (קיבוץ)" הן שתי רשויות שונות בדיוק כפי שהן
-- כתובות במאגר רשות המיסים - ולכן שתי שורות, עם השם כלשונו.
--
-- ‏docs/regional-pages.md (טבלת השווקים).
-- ===========================================================================

insert into public.cities (area_id, name, slug, market_slug, source)
select a.id, v.name, v.slug, 'afula-emek', 'manual'
  from (values
    ('אחוזת ברק',      'ahuzat-barak'),
    ('גן נר',          'gan-ner'),
    ('כפר תבור',       'kfar-tavor'),
    ('מרחביה (מושב)',  'merhavia-moshav'),
    ('מרחביה (קיבוץ)', 'merhavia-kibbutz'),
    ('תל עדשים',       'tel-adashim'),
    ('נורית',          'nurit'),
    ('אומן',           'omen'),
    ('בלפוריה',        'balfouria'),
    ('גדיש',           'gadish'),
    ('מגן שאול',       'magen-shaul'),
    ('כפר גדעון',      'kfar-gidon')
  ) as v(name, slug)
  join public.areas a on a.slug = 'emakim'
on conflict (slug) do update
   set market_slug = coalesce(public.cities.market_slug, excluded.market_slug);

-- ---------------------------------------------------------------------------
-- ההשלמה - בדיוק כמו ב-20270112090000: נכסים, משרדים ושכונות שכבר קיימים
-- ביישובים האלה מקבלים city_id. היום אין אף נכס בהם, ולכן זו בעיקר הגנה
-- על מה שייכנס מחר.
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

-- ===========================================================================
-- שווקים מקומיים: שיוך עיר לשוק, והערים של שני השווקים הראשונים
--
-- ‏"שוק" (market) הוא יחידת התצוגה: מה הגולש/ת רואה כשהאתר נפתח - "עפולה
-- והעמק", "חיפה והקריות". הוא **אינו** `areas`: לאזור יש תפקיד אחר (היקף
-- השת״פ במסלול Pay&GO), והוא רחב בכוונה - "חיפה והגליל המערבי" כולל גם את
-- נהריה ועכו. ‏docs/regional-pages.md.
--
-- ## למה עמודת טקסט ולא טבלת markets
--
-- רשימת השווקים, הטקסטים וה-SEO שלהם יושבים בריפו
-- (`netlify/edge-functions/lib/markets.ts`), כי ה-edge מזריק אותם בלי רשת:
-- תקלה ב-Supabase אסור שתאחד את כל השווקים לדף הבית. המסד מחזיק רק את מה
-- שהמסד צריך - **איזו עיר שייכת לאיזה שוק** - כי הסינון של הנכסים נעשה בו.
-- ‏`scripts/check_markets.py` מצליב את שני הצדדים.
--
-- עיר שייכת לשוק אחד לכל היותר, ו-`null` הוא מצב תקין: נכס בעיר בלי שוק
-- נשמר ומופיע בחיפוש הכללי, לא נחסם.
--
-- ## הערים נוספות כאן ידנית, ומיגרציית ההזנה מהלמ"ס תשלים אותן
--
-- ‏`cities` ריקה, והזנת 1,484 היישובים מחכה לקובץ הלמ"ס
-- (`scripts/seed_cities.py`). תשע השורות כאן נושאות **שם, אזור, slug ושוק
-- בלבד**: בלי `muni_code`, בלי קואורדינטות ובלי אוכלוסייה - כל אלה עובדות
-- שמגיעות מהקובץ ולא מהזיכרון (docs/cities-and-regions.md, "הזנת הערים").
-- ‏`is_live` נשאר `false`, ולכן `cities_public` נשארת ריקה והאתר הציבורי
-- מתנהג בדיוק כמו קודם.
--
-- ההזנה מזהה את השורות האלה לפי `name_key` וממלאת בהן את `muni_code` ואת
-- העובדות, **בלי לגעת** ב-`slug`, ב-`area_id` וב-`market_slug` - אותו כלל
-- של `street_registry_absorb`: החלטה ידנית אינה רעש.
-- ===========================================================================

alter table public.cities add column if not exists market_slug text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cities'::regclass
                    and conname  = 'cities_market_slug_chk') then
    -- אותה צורה כמו SLUG_RE ב-assets/city-context.js: מה שהמסד מקבל, הדפדפן
    -- מסוגל לקרוא בחזרה.
    alter table public.cities add constraint cities_market_slug_chk
      check (market_slug is null or market_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
end $$;

create index if not exists cities_market_slug_idx
  on public.cities (market_slug) where market_slug is not null;

comment on column public.cities.market_slug is
  'השוק המקומי שהעיר שייכת אליו (afula-emek, haifa-krayot). הרשימה עצמה בריפו: netlify/edge-functions/lib/markets.ts. null - עיר בלי שוק, והנכסים בה עדיין נשמרים.';

-- ---------------------------------------------------------------------------
-- הערים
--
-- ‏`do update` נוגע ב-`market_slug` בלבד, ורק כשהוא ריק: שיוך שמנהל/ת
-- פלטפורמה שינה/תה ביד אינו נדרס בהרצה חוזרת.
-- ---------------------------------------------------------------------------
insert into public.cities (area_id, name, slug, market_slug, source)
select a.id, v.name, v.slug, v.market, 'manual'
  from (values
    ('emakim',          'עפולה',        'afula',          'afula-emek'),
    ('emakim',          'היוגב',        'hayogev',        'afula-emek'),
    ('haifa-galil-mar', 'חיפה',         'haifa',          'haifa-krayot'),
    ('haifa-galil-mar', 'נשר',          'nesher',         'haifa-krayot'),
    ('haifa-galil-mar', 'קריית אתא',    'kiryat-ata',     'haifa-krayot'),
    ('haifa-galil-mar', 'קריית ביאליק', 'kiryat-bialik',  'haifa-krayot'),
    ('haifa-galil-mar', 'קריית מוצקין', 'kiryat-motzkin', 'haifa-krayot'),
    ('haifa-galil-mar', 'קריית ים',     'kiryat-yam',     'haifa-krayot'),
    ('haifa-galil-mar', 'טירת כרמל',    'tirat-carmel',   'haifa-krayot')
  ) as v(area_slug, name, slug, market)
  join public.areas a on a.slug = v.area_slug
on conflict (slug) do update
   set market_slug = coalesce(public.cities.market_slug, excluded.market_slug);

-- ---------------------------------------------------------------------------
-- ‏cities_public: ‏market_slug נוסף **בסוף**, כי `create or replace view`
-- נופל על עמודה באמצע.
-- ---------------------------------------------------------------------------
create or replace view public.cities_public as
select c.id, c.slug, c.name, c.display_label,
       c.lat, c.lng, c.default_zoom,
       c.area_id,   a.slug as area_slug,   a.name as area_name,
       c.region_id, r.slug as region_slug, r.name as region_name,
       a.sort_order as area_sort, r.sort_order as region_sort,
       c.updated_at,
       c.market_slug
  from public.cities c
  join public.areas   a on a.id = c.area_id   and a.active
  join public.regions r on r.id = c.region_id and r.active
 where c.active and c.is_live;

grant select on public.cities_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ההשלמה: עכשיו שיש ערים, שלוש הפונקציות שנכתבו מראש עושות את עבודתן
--
-- ‏properties במנות, כמו שתוכנן ב-20261211090000: 11 טריגרים יורים על כל
-- עדכון, ומה שמונע גל התראות הוא האידמפוטנטיות שלהם (docs/geocoding.md).
-- ‏118 שורות היום.
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

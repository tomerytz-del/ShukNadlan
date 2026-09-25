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

-- ===========================================================================
-- ‏platform_market_report - תצוגת השוק של מנהל/ת הפלטפורמה
--
-- ב-CRM, בתצוגת מנהל/ת, בוחרים שוק ורואים רק אותו: כמה נכסים ומשרדים יש
-- בו, כמה חסר עד שהוא יכול להידלק (משרד אחד ו-10 נכסים פעילים), אילו ערים
-- ומשרדים, ומה נכנס לאחרונה. ‏docs/regional-pages.md.
--
-- אותה תבנית בדיוק של `platform_admin_monthly_report`, ומאותה סיבה: ה-RLS
-- חוסם מנהל/ת פלטפורמה מ-`leads` ומ-`agency_members` כמו כל אחד אחר, וזה
-- נכון. לכן `security definer` שמחזיר **מספרים ושמות פומביים בלבד** - שם
-- משרד, כותרת נכס, שם עיר. אין שם של פונה, אין טלפון ואין אימייל. השורה
-- הראשונה היא בדיקת ההרשאה, והיא מסרבת ב-42501.
--
-- השוק מזוהה ב-slug, והערים שלו נקראות מ-`cities.market_slug` - אותו שיוך
-- שהסינון של האתר נשען עליו, כך שהתצוגה כאן והאתר אינם יכולים להיפרד.
-- ===========================================================================
create or replace function public.platform_market_report(p_market text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_city_ids uuid[];
  v_result   jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.id), '{}')
    into v_city_ids
    from public.cities c
   where c.market_slug = p_market;

  with
  props as (
    select p.id, p.title, p.city, p.city_id, p.price, p.deal_type, p.status,
           p.created_at, p.agency_id, (p.lat is not null and p.lng is not null) as has_pin
      from public.properties p
     where p.city_id = any (v_city_ids)
  ),
  ags as (
    select a.id, a.name, a.slug, a.created_at, a.city_id
      from public.agencies a
     where a.city_id = any (v_city_ids)
  ),
  members as (
    select m.agency_id, count(*) as n
      from public.agency_members m
     where m.active and m.released_at is null
       and m.agency_id in (select id from ags)
     group by m.agency_id
  ),
  market_leads as (
    select l.id, l.created_at, l.unlocked_at
      from public.leads l
      left join public.properties p on p.id = l.property_id
     where coalesce(p.city_id, public.city_id_for_name(l.city)) = any (v_city_ids)
  ),
  hoods as (
    select n.id, n.city_id,
           (jsonb_typeof(to_jsonb(n.boundary)) = 'array'
            and jsonb_array_length(to_jsonb(n.boundary)) >= 3) as marked
      from public.neighborhoods n
     where n.city_id = any (v_city_ids)
  )
  select jsonb_build_object(
    'market', p_market,
    'generated_at', now(),
    'totals', jsonb_build_object(
      'props_active',   (select count(*) from props where status = 'active'),
      'props_new_30d',  (select count(*) from props where created_at > now() - interval '30 days'),
      'props_no_pin',   (select count(*) from props where status = 'active' and not has_pin),
      'agencies',       (select count(*) from ags),
      'agents',         (select coalesce(sum(n), 0) from members),
      'leads_30d',      (select count(*) from market_leads where created_at > now() - interval '30 days'),
      'leads_open',     (select count(*) from market_leads where unlocked_at is null),
      'neighborhoods',  (select count(*) from hoods),
      'hoods_marked',   (select count(*) from hoods where marked),
      'deals_official', (select count(*) from public.market_deals_official o
                          where public.city_id_for_name(o.city) = any (v_city_ids))
    ),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', c.name,
               'is_live', c.is_live,
               'props_active', (select count(*) from props p where p.city_id = c.id and p.status = 'active'),
               'agencies', (select count(*) from ags a where a.city_id = c.id),
               'neighborhoods', (select count(*) from hoods h where h.city_id = c.id)
             ) order by c.name)
        from public.cities c
       where c.id = any (v_city_ids)
    ), '[]'::jsonb),
    'agencies', coalesce((
      select jsonb_agg(x order by (x->>'props_active')::int desc, x->>'name')
        from (
          select jsonb_build_object(
                   'id', a.id, 'name', a.name, 'slug', a.slug, 'created_at', a.created_at,
                   'city', (select c.name from public.cities c where c.id = a.city_id),
                   'agents', coalesce((select n from members m where m.agency_id = a.id), 0),
                   'props_active', (select count(*) from props p where p.agency_id = a.id and p.status = 'active')
                 ) as x
            from ags a
        ) s
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'city', r.city, 'price', r.price,
               'deal_type', r.deal_type, 'status', r.status,
               'created_at', r.created_at, 'has_pin', r.has_pin
             ) order by r.created_at desc)
        from (select * from props order by created_at desc limit 8) r
    ), '[]'::jsonb),
    -- ‏נכסים פעילים שאינם שייכים לאף שוק - עיר שלא הוכרה, או עיר בלי שוק.
    -- לא של השוק הזה, אבל זה המקום שבו מנהל/ת מגלה אותם.
    'unassigned', coalesce((
      select jsonb_agg(jsonb_build_object('city', u.city, 'n', u.n) order by u.n desc)
        from (
          select coalesce(nullif(btrim(p.city), ''), '(ללא עיר)') as city, count(*) as n
            from public.properties p
            left join public.cities c on c.id = p.city_id
           where p.status = 'active' and c.market_slug is null
           group by 1
        ) u
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

comment on function public.platform_market_report(text) is
  'תצוגת שוק מקומי למנהל/ת הפלטפורמה: מספרים, ערים, משרדים ונכסים אחרונים. security definer שמחזיר מספרים ושמות פומביים בלבד; מסרב ב-42501 למי שאינו/ה מנהל/ת.';

revoke all on function public.platform_market_report(text) from public, anon, authenticated;
grant execute on function public.platform_market_report(text) to authenticated;

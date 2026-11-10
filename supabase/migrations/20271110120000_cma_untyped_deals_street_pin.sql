-- ===========================================================================
-- דוח ה-CMA בעיר גדולה: עסקה בלי סוג נכס נחשבת דירה, ונכס בלי פין מקבל פין
-- משוער על הרחוב (החלטת תומר, 10.11.2026, לקראת תל אביב וגבעתיים)
--
-- ## 1. עסקה בלי סוג
--
-- ‏GovMap מחזיר "-" בסוג הנכס לחלק גדול מהעסקאות, והסוכן כותב אותן עם
-- ‏property_type = null. ‏property_type_class(null) הוא null, ולכן הן נפלו
-- מכל דוח: בתל אביב 734 מתוך 1,855 (40%), ברמת גן 463 מתוך 1,629. לכולן יש
-- מספר חדרים. ההחלטה: עסקה בלי סוג **ועם חדרים** נחשבת דירה (dwelling, unit)
-- בבריכה של הדוח ובשכבת השכונה. ‏property_type_class עצמה לא משתנה - היא
-- משרתת גם את האתר ואת deals_engine, ו-check_deals_normalize.py מצליב אותה -
-- אלא שתי עטיפות לעסקאות: deal_type_class ו-deal_property_kind.
-- עסקה כזו מתנהגת מכאן ואילך בדיוק כמו עסקת "דירה": גן/גג מהקומה, ובית לפי
-- החלקה (בלי קומה, היחידה בחלקה עד 1,500 מ"ר) - בכוונה, כי "דירה" ב-GovMap
-- היא ממילא ברירת המחדל לכל מגורים, ו"-" הוא אותו דבר בלי שנכתב.
--
-- ## 2. פין משוער לכל נכס בארץ בלי כתובת מדויקת, ברמה הכי מדויקת שיש
--
-- מחוץ לעפולה אין ספק גאוקוד בשרת (GovMap אסור בשרת - הסקיל govmap), ולכן
-- נכס שנוצר בוואטסאפ או יובא בקובץ נולד בלי פין עד שהסוכן/ת פותח/ת את
-- ה-CRM. בלי פין: לא על המפה, ואין דוח CMA (no_location). ב-9.11.2026: 19
-- מתוך 33 נכסים פעילים מחוץ לעפולה, ו-92 נכסים בלי פין בכל הארץ (45 עם
-- רחוב, 18 עם שכונה, 44 עם יישוב בלבד). ההחלטה (תומר, 10.11.2026): פין
-- משוער לכל נכס, ברמה הכי מדויקת שיש - property_approx_location:
--
--   street        - cma_locate_address: עסקה בכתובת, מרכז החלקה, מספר בית
--                   קרוב (עד 80) או מרכז העסקאות ברחוב
--   neighborhood  - נקודה במצולע השכונה (neighborhood_approx_point, המנגנון
--                   של zone לכל שכונה); אזור תעשייה נשאר 'zone'
--   city          - מרכז היישוב משכבת החלקות הפתוחה (city_approx_point): ב-
--                   cities אין קואורדינטות לאף יישוב, והחלקות מכסות 1,042
--
-- כולן באותה משפחה של 'zone' ו-'parcel' (docs/property-map.md, "מיקום
-- משוער"): תגית "מיקום משוער" בכל מפה, עיגול במקום פין בדף הנכס, ובלי
-- ניווט. פין אמיתי שמגיע אחר כך (GovMap בדפדפן, הגאוקוד העירוני בעפולה,
-- הזנה ידנית) מחליף אותו ל-'exact', ושלושת התורים רואים פין משוער כ"חסר".
--
-- **לא** פין משוער שנראה מדויק: ההכרעה מ-12.10.2026 על אזורי תעשייה חלה כאן.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. 'street', 'neighborhood' ו-'city' ב-location_precision
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.properties'::regclass
                and conname = 'properties_location_precision_chk'
                and pg_get_constraintdef(oid) not like '%neighborhood%') then
    alter table public.properties drop constraint properties_location_precision_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.properties'::regclass
                    and conname = 'properties_location_precision_chk') then
    alter table public.properties
      add constraint properties_location_precision_chk
      check (location_precision is null or location_precision in ('exact', 'zone', 'parcel', 'street', 'neighborhood', 'city'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. סוג העסקה: בלי סוג אבל עם חדרים = דירה
-- ---------------------------------------------------------------------------
create or replace function public.deal_type_class(p_type text, p_rooms numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.property_type_class(p_type),
                  case when nullif(btrim(coalesce(p_type, '')), '') is null or btrim(p_type) = '-'
                        then case when p_rooms > 0 then 'dwelling' end
                  end);
$$;

comment on function public.deal_type_class(text, numeric) is
  'מחלקת עסקה רשמית לדוח ה-CMA: property_type_class, ועסקה בלי סוג (GovMap "-") עם חדרים היא dwelling. "בנין" נשאר null. 20271110120000.';

create or replace function public.deal_property_kind(p_type text, p_rooms numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.property_kind(p_type),
                  case when public.deal_type_class(p_type, p_rooms) = 'dwelling' then 'unit' end);
$$;

comment on function public.deal_property_kind(text, numeric) is
  'תת-סוג עסקה לדוח ה-CMA: property_kind, ועסקה בלי סוג שנחשבת דירה היא unit (גן/גג עדיין מהקומה ב-cma_deal_pool). 20271110120000.';

-- ---------------------------------------------------------------------------
-- 3. cma_deal_pool - מהגרסה ב-20271105140000, עם שתי ההחלפות בלבד
-- ---------------------------------------------------------------------------
create or replace function public.cma_deal_pool(
  p_lat           double precision,
  p_lng           double precision,
  p_cutoff        date,
  p_max_radius    numeric,
  p_exclude       uuid,
  p_subject_type  text,
  p_subject_rooms numeric
)
returns table (
  id              uuid,
  source          text,
  price_basis     text,
  property_type   text,
  rooms           numeric,
  sale_price      numeric,
  sold_at         date,
  size_sqm        numeric,
  same_type       boolean,
  rooms_diff      numeric,
  price_per_sqm   numeric,
  distance_meters numeric,
  floor_group     text,
  kind            text,
  plot_sqm        numeric
)
language sql
stable
set search_path = ''
as $$
  with s as (
    -- הנכס: פעם אחת לבריכה, לא לכל עסקה
    select public.property_type_class(p_subject_type) as s_cls,
           public.property_kind(p_subject_type)       as s_kind
  ), d as (
    select b.*
      from (
        select md.id, md.source, md.price_basis, md.property_type, md.rooms,
               md.sale_price, md.sold_at,
               rp.lat, rp.lng,
               coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) as size_sqm,
               rp.floor::text as floor,
               -- בעסקת פלטפורמה מספר הקומות בבניין רשום בנכס עצמו
               rp.total_floors::integer as top_floor,
               null::text as gush, null::text as helka
          from public.market_deals md
          join public.properties rp on rp.id = md.related_property_id
         where md.related_property_id is distinct from p_exclude

        union all

        select o.id, o.source, 'official'::text, o.property_type, o.rooms,
               o.sale_price, o.sold_at, o.lat, o.lng, o.size_sqm, o.floor,
               null::integer, o.gush, o.helka
          from public.market_deals_official o
      ) b
     where b.lat is not null and b.lng is not null
       and b.sold_at >= p_cutoff
       and public.geo_distance_meters(p_lat, p_lng, b.lat, b.lng) <= p_max_radius
  ), tops as (
    -- הקומה העליונה שנמכרה בכל בניין, וגם השטח החציוני ומספר העסקאות בו -
    -- פעם אחת לבניין, ורק לפנטהאוז (20271105140000: פנטהאוז לפי גודל)
    select o2.gush, o2.helka, max(public.floor_num(o2.floor)) as top_floor,
           percentile_cont(0.5) within group (order by o2.size_sqm)
             filter (where o2.size_sqm > 0) as med_size,
           count(*) filter (where o2.size_sqm > 0) as n_sized
      from public.market_deals_official o2
     where (select s.s_kind from s) = 'roof'
       and (o2.gush, o2.helka) in (select d.gush, d.helka from d
                                    where d.gush is not null and d.helka is not null)
     group by o2.gush, o2.helka
  ), hp as (
    -- בית לפי החלקה (20271105090000): עסקה בלי קומה, היחידה שנרשמה אי פעם
    -- בחלקה שלה, וחלקה עד 1,500 מ"ר או בלי שטח ידוע. פעם אחת **לחלקה**,
    -- ורק כשהנכס בית. הספירה לפי gush/helka הגולמיים - שם האינדקס
    -- (market_deals_official_parcel_idx), וכל הערכים במאגר ספרות נקיות.
    select x.gush, x.helka, po.legal_area
      from (
        select distinct d.gush, d.helka
          from d
         where (select s.s_kind from s) = 'house'
           and d.gush is not null and d.helka is not null
           and nullif(btrim(d.floor), '') is null
      ) x
      cross join lateral (
        select count(*) as n
          from public.market_deals_official o3
         where o3.gush = x.gush and o3.helka = x.helka
      ) c
      left join public.parcels_open po
        on po.gush = public.land_parcel_num(x.gush)
       and po.helka = public.land_parcel_num(x.helka)
       and po.gush_suffix = 0
     where c.n = 1
       and (po.legal_area is null or po.legal_area <= 1500)
  )
  select d.id,
         d.source,
         d.price_basis,
         d.property_type,
         nullif(d.rooms, 0) as rooms,
         d.sale_price,
         d.sold_at,
         d.size_sqm,
         -- בית ודירה אינם אותו סוג גם כששניהם dwelling (20270226090000)
         coalesce(f.cls = s.s_cls
                  and (s.s_cls <> 'dwelling'
                       or (g.dk = 'house') = (s.s_kind = 'house')), false) as same_type,
         abs(nullif(d.rooms, 0) - nullif(p_subject_rooms, 0)) as rooms_diff,
         case when d.size_sqm > 0 then round(d.sale_price / d.size_sqm) end as price_per_sqm,
         round(public.geo_distance_meters(p_lat, p_lng, d.lat, d.lng))::numeric as distance_meters,
         f.fg as floor_group,
         case
           -- בית: בית לפי הסוג, או בית לפי החלקה
           when s.s_kind = 'house' then
             case when g.by_parcel then 'house_parcel' when g.dk = 'house' then 'house' end
           -- תת-הסוג, רק לנכס גן/גג. לעסקה "דירה" - בקירוב מהקומה.
           when s.s_kind is null or s.s_kind not in ('garden', 'roof') then null
           when f.pk is distinct from 'unit' then f.pk
           when d.floor ~ 'גג' then 'roof'
           -- עסקת פלטפורמה: מספר הקומות רשום בנכס, ואין נתוני בניין - כמו קודם
           when d.gush is null and d.top_floor >= 3
            and public.floor_num(d.floor) = d.top_floor then 'roof'
           -- עסקה רשמית (20271105140000): הקומה העליונה **וגם** גדולה בלפחות
           -- רבע מהחציון של הבניין, מתוך 3 עסקאות לפחות. "הקומה העליונה" לבדה
           -- תפסה דירות רגילות בקומה העליונה של בניינים ישנים: בעפולה 358
           -- עסקאות, חציון 110 מ"ר ו-1.24 מיליון, מול פנטהאוזים של 150-178 מ"ר.
           when t.top_floor >= 3
            and public.floor_num(d.floor) = t.top_floor
            and t.n_sized >= 3
            and d.size_sqm >= 1.25 * t.med_size then 'roof'
           when f.fg = 'ground' then 'garden'
           else 'unit'
         end as kind,
         case when g.by_parcel then h.legal_area end as plot_sqm
    from d
    cross join s
    -- העסקה: כל פונקציה פעם אחת, ורק כשהנכס צריך אותה
    cross join lateral (
      select public.deal_type_class(d.property_type, d.rooms) as cls,
             case when s.s_cls = 'dwelling'
                  then public.deal_property_kind(d.property_type, d.rooms) end as pk,
             case when s.s_cls = 'commercial' or s.s_kind in ('garden', 'roof')
                  then public.floor_group(d.floor) end as fg
    ) f
    left join tops t on t.gush = d.gush and t.helka = d.helka
    left join hp h on h.gush = d.gush and h.helka = d.helka
    cross join lateral (
      select (s.s_kind = 'house' and f.pk = 'unit' and h.gush is not null) is true as by_parcel
    ) g0
    cross join lateral (
      select g0.by_parcel,
             case when g0.by_parcel then 'house' else f.pk end as dk
    ) g;
$$;

comment on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) is
  'עסקה בלי סוג נכס אבל עם חדרים נחשבת דירה (20271110120000). פנטהאוז לעסקה רשמית: הקומה העליונה וגדולה פי 1.25 מהחציון בבניין (20271105140000). בני ההשוואה לדוח CMA: איחוד market_deals ו-market_deals_official ברדיוס ובחלון הזמן, עם מרחק, התאמת מחלקה, הפרש חדרים, קבוצת קומה (מסחרי, גן/גג) ותת-סוג. לבית: עסקת "דירה" בלי קומה שהיא היחידה בחלקה שלה (עד 1,500 מ"ר) נחשבת לבית (kind = house_parcel, plot_sqm מ-parcels_open). 20271105090000.';

revoke all on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 4. cma_report_core - מהגרסה ב-20270819090000, עם ההחלפות בשכבת השכונה
--    ו-location_precision בנכס הנושא
-- ---------------------------------------------------------------------------
create or replace function public.cma_report_core(
  p_agent_id uuid,
  p_prop     public.properties
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prop          public.properties := p_prop;
  v_subject_size  numeric;
  v_subject_rooms numeric;
  -- הממד שהסולם מסנן לפיו (20270226090000): חדרים לנכס מגורים, קבוצת
  -- קומה לנכס מסחרי. ‏v_band_rooms הוא מספר החדרים **שמסננים לפיו** -
  -- null בנכס מסחרי, גם כשרשום לו מספר חדרים.
  v_subject_class text;
  v_dim           text;
  v_band_rooms    numeric;
  v_subject_floor text;
  v_base_radius   numeric;
  v_min_comps     integer;
  v_max_age       integer;
  v_similar_max   numeric;   -- עד לאן מרחיבים כדי לשמור על התאמת חדרים
  v_commercial_max numeric;  -- הרדיוס המרבי לנכס מסחרי (cma_commercial_max_radius_meters)
  v_rare_max      numeric;   -- הרדיוס המורחב לבית, דירת גן ודירת גג (cma_rare_type_radius_meters)
  v_subject_kind  text;      -- property_kind של הנכס: house / garden / roof / unit
  v_kinds         boolean[]; -- לכל שלב: האם דורש תת-סוג תואם
  v_used_kind     boolean := false;
  v_cutoff        date;
  v_pool_radius   numeric;
  v_counts        integer[];
  v_bands         numeric[];
  v_radii         numeric[];
  v_i             integer;
  v_used_radius   numeric := null;
  v_used_band     numeric := null;
  v_band_reason   text    := null;
  v_comps         jsonb   := '[]'::jsonb;
  v_city_comps    jsonb   := '[]'::jsonb;
  v_n             integer := 0;   -- מה שנכנס לסטטיסטיקה: מחלקה **וגם** חדרים
  v_n_class       integer := 0;   -- מחלקה תואמת ברדיוס, בלי סינון חדרים
  v_n_all         integer := 0;   -- כל מה שנפל ברדיוס, לתצוגה בלבד
  v_city_n        integer := 0;
  v_city_limit    integer;
  v_stats         jsonb;
  v_planning      jsonb;
  v_coverage      text;
  v_sources       jsonb;
  v_asking_n      integer := 0;
  -- שכבת השוק: נכסים פעילים למכירה, כלומר מחירים **מבוקשים**
  v_market_radius numeric := null;
  v_market_pool   jsonb   := '[]'::jsonb;
  v_market_comps  jsonb   := '[]'::jsonb;
  v_market_stats  jsonb   := null;
  v_market_n      integer := 0;
  v_market_feat_n integer := 0;
  v_subject_feat_n integer := 0;
  v_market_reason text    := null;
  v_min_market    integer;
  v_feat_min      numeric;
  v_market_limit  integer;
  -- שכבת השכונה: עסקאות רשמיות **בלי פין** באותה שכונה (20270114091000)
  v_hood_id       uuid    := null;
  v_hood_name     text    := null;
  v_hood_band     numeric := null;
  v_hood_comps    jsonb   := '[]'::jsonb;
  v_hood_stats    jsonb   := null;
  v_hood_total    integer := 0;
  v_hood_in       integer := 0;
begin
  v_subject_size  := coalesce(v_prop.built_size_sqm, v_prop.size_sqm, v_prop.area_sqm);
  v_subject_rooms := nullif(v_prop.rooms, 0);
  v_subject_class := public.property_type_class(v_prop.property_type);
  v_dim           := case when v_subject_class = 'commercial' then 'floor' else 'rooms' end;
  v_band_rooms    := case when v_dim = 'rooms' then v_subject_rooms end;
  v_subject_floor := case when v_dim = 'floor' then public.floor_group(v_prop.floor::text) end;
  v_subject_kind  := public.property_kind(v_prop.property_type);

  select coalesce(max(value) filter (where key = 'cma_default_radius_meters'), 500),
         coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_max_deal_age_months'), 24),
         coalesce(max(value) filter (where key = 'cma_city_comparables_limit'), 12),
         coalesce(max(value) filter (where key = 'cma_similar_radius_meters'), 1000),
         coalesce(max(value) filter (where key = 'cma_min_market_comparables'), 3),
         coalesce(max(value) filter (where key = 'cma_feature_match_min'), 0.6),
         coalesce(max(value) filter (where key = 'cma_market_comparables_limit'), 12),
         coalesce(max(value) filter (where key = 'cma_commercial_max_radius_meters'), 2000),
         coalesce(max(value) filter (where key = 'cma_rare_type_radius_meters'), 2000)
    into v_base_radius, v_min_comps, v_max_age, v_city_limit, v_similar_max,
         v_min_market, v_feat_min, v_market_limit, v_commercial_max, v_rare_max
    from public.pricing_config;

  v_cutoff := (current_date - (v_max_age || ' months')::interval)::date;

  -- כמה מאפיינים **נספרים** יש לנכס עצמו. אפס פירושו שאי אפשר למדוד
  -- דמיון בכלל, וזו אמירה אחרת לגמרי מ"לא נמצאו נכסים דומים".
  select count(distinct x) into v_subject_feat_n
    from unnest(coalesce(v_prop.features, '{}'::text[])) x
   where x = any (public.cma_price_features());

  -- הסולם, מפורש. שני ממדים: התאמת חדרים (הדוק לרופף) ורדיוס (קרוב
  -- לרחוק), וכל קבוצת חדרים ממצה את הרדיוס המורחב **לפני** שמרפים ממנה.
  -- ‏null בעמודת הבנד = בלי סינון חדרים, כלומר התנהגות הדוח עד כאן.
  v_bands := array[0,             0,             0.5,           0.5,
                   1,             1,             null,          null,
                   null,          null,          null]::numeric[];
  v_radii := array[v_base_radius, v_similar_max, v_base_radius, v_similar_max,
                   v_base_radius, v_similar_max, v_base_radius, v_base_radius*2,
                   v_base_radius*3, v_base_radius*4, v_base_radius*6]::numeric[];

  -- ונכס מסחרי: סולם משלו, עד `cma_commercial_max_radius_meters` (2,000 מ').
  -- עסקאות מסחריות דלילות בסדר גודל מדירות, ולכן גם השלב המסונן (אותה
  -- קבוצת קומה) מתרחב עד הקצה **לפני** שמוותרים על הקומה - אותו עיקרון
  -- של סולם החדרים: מרחק הוא הוויתור הזול. ומעבר ל-2,000 מ' אין המשך:
  -- חנות במרכז העיר וחנות באזור תעשייה בקצה השני אינן שוק אחד, ומוטב
  -- `insufficient` מממוצע שמערבב אותן.
  if v_dim = 'floor' then
    v_bands := array[0,             0,             0,
                     null,          null,          null]::numeric[];
    v_radii := array[v_base_radius, v_similar_max, v_commercial_max,
                     v_base_radius, v_similar_max, v_commercial_max]::numeric[];
  end if;

  -- ונכס מגורים מיוחד (20270226090000). לבית, לדירת גן ולפנטהאוז יש מעט
  -- עסקאות, והן שוק אחר: ממוצע של דירות רגילות מתמחר פנטהאוז כדירה.
  --
  --   בית           - בית מושווה רק לבתים (same_type), ולכן הסולם הרגיל,
  --                   עם שלב נוסף ב-2,000 מ' בכל רמת חדרים.
  --   גן / גג       - קודם אותו תת-סוג (בקירוב, ראו property_kind) בטווח
  --                   ‎±1‎ חדר, ב-1,000 ואז ב-2,000 מ'; אחר כך אותו תת-סוג
  --                   בכל גודל ב-2,000 מ'; ורק אז הסולם הרגיל של דירות -
  --                   ואז הדוח אומר שלא נמצאו עסקאות מאותו סוג.
  if v_dim = 'rooms' and v_subject_kind = 'house' then
    v_bands := array[0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1,
                     null, null, null, null, null]::numeric[];
    v_radii := array[v_base_radius, v_similar_max, v_rare_max,
                     v_base_radius, v_similar_max, v_rare_max,
                     v_base_radius, v_similar_max, v_rare_max,
                     v_base_radius, v_base_radius*2, v_base_radius*3,
                     v_base_radius*4, v_base_radius*6]::numeric[];
  elsif v_dim = 'rooms' and v_subject_kind in ('garden', 'roof') then
    v_kinds := array[true, true, true]
               || array_fill(null::boolean, array[array_length(v_radii, 1)]);
    v_bands := array[1, 1, null]::numeric[] || v_bands;
    v_radii := array[v_similar_max, v_rare_max, v_rare_max]::numeric[] || v_radii;
  end if;
  v_kinds := coalesce(v_kinds, array_fill(null::boolean, array[array_length(v_radii, 1)]));
  v_pool_radius := (select max(x) from unnest(v_radii) x);

  if v_prop.lat is not null and v_prop.lng is not null then
    -- הבריכה נשלפת **פעם אחת** (‏materialized), וכל שלב בסולם סופר ממנה.
    -- הספירה נשענת על v_bands/v_radii ולא על קבועים, כי לנכס מסחרי יש
    -- סולם באורך אחר (20270226090000).
    with pool as materialized (
      -- ‏band_diff: המרחק מהנכס בממד של הסולם. חדרים - ההפרש; קומה - 0
      -- באותה קבוצה ו-1 בקבוצה אחרת. ‏null כשלאחד הצדדים חסר הנתון, ואז
      -- העסקה אינה נכנסת לשום שלב מסונן - בדיוק כמו rooms_diff.
      select p.same_type, p.distance_meters, p.kind,
             case when v_dim = 'floor'
                  then case when p.floor_group is null or v_subject_floor is null then null
                            when p.floor_group = v_subject_floor then 0 else 1 end
                  else p.rooms_diff end as band_diff
        from public.cma_deal_pool(v_prop.lat, v_prop.lng, v_cutoff, v_pool_radius,
                                  v_prop.id, v_prop.property_type, v_band_rooms) p
    )
    select array_agg(k.n order by g.i)
      into v_counts
      from generate_subscripts(v_radii, 1) g(i)
      cross join lateral (
        select count(*)::integer as n
          from pool c
         where c.same_type
           and (not coalesce(v_kinds[g.i], false) or c.kind = v_subject_kind)
           and (v_bands[g.i] is null or c.band_diff <= v_bands[g.i])
           and c.distance_meters <= v_radii[g.i]
      ) k;

    for v_i in 1 .. array_length(v_radii, 1) loop
      -- נכס בלי מספר חדרים מדלג על השלבים המסוננים במקום לצבור בהם אפסים
      continue when v_bands[v_i] is not null and v_dim = 'rooms' and v_subject_rooms is null;
      -- ונכס מסחרי בלי קומה רשומה - אותו דבר בשלבי הקומה
      continue when v_bands[v_i] is not null and v_dim = 'floor' and v_subject_floor is null;
      v_used_band   := v_bands[v_i];
      v_used_kind   := coalesce(v_kinds[v_i], false);
      v_used_radius := v_radii[v_i];
      v_n           := v_counts[v_i];
      exit when v_n >= v_min_comps;
    end loop;

    v_band_reason := case
      -- נכס מיוחד שנמצאו לו די עסקאות מאותו תת-סוג
      when v_used_kind then case when v_used_band is null then 'kind_any_rooms' else 'kind_rooms' end
      when v_dim = 'floor' then case
        when v_used_band = 0           then 'floor_exact'
        when v_subject_floor is null   then 'subject_floor_missing'
        else                                'no_similar_floor'
      end
      when v_used_band = 0           then 'exact'
      when v_used_band is not null   then 'relaxed'
      when v_subject_rooms is null   then 'subject_rooms_missing'
      else                                'no_similar_rooms'
    end;

    -- והרדיוס שנבחר, הפעם עם השורות עצמן. ‏`in_stats` נושא לכל עסקה אם
    -- היא זו שהמספרים נשענים עליה - התצוגה מסמנת לפיו, ואין בה לוגיקה
    -- משלה שתוכל להיפרד מהחישוב.
    select coalesce(jsonb_agg(c order by c.distance_meters), '[]'::jsonb),
           count(*),
           count(*) filter (where c.same_type),
           count(*) filter (where c.in_stats)
      into v_comps, v_n_all, v_n_class, v_n
      from (
        -- ‏coalesce ולא רק ה-and: עסקה בלי מספר חדרים נותנת
        -- ‏`true and null` = null, ותצוגה שבודקת `=== false` לא הייתה
        -- מסמנת אותה. שלושה ערכים לדגל בוליאני הם באג שממתין.
        select p.*,
               coalesce(p.same_type
                        and (not v_used_kind or p.kind = v_subject_kind)
                        and (v_used_band is null
                             or (v_dim = 'rooms' and p.rooms_diff <= v_used_band)
                             or (v_dim = 'floor' and p.floor_group = v_subject_floor)), false) as in_stats
          from public.cma_deal_pool(v_prop.lat, v_prop.lng, v_cutoff, v_used_radius,
                                    v_prop.id, v_prop.property_type, v_band_rooms) p
      ) c;

    -- ---- שכבת השוק: מול מי הנכס הזה מתחרה עכשיו ----
    --
    -- הרדיוס הוא לפחות `cma_similar_radius_meters`, כי מלאי פעיל דליל
    -- בסדר גודל מעסקאות: 1,512 עסקאות מול 31 מודעות באותה עיר.
    v_market_radius := greatest(coalesce(v_used_radius, v_base_radius), v_similar_max);

    select coalesce(jsonb_agg(c order by c.feature_match desc nulls last, c.distance_meters), '[]'::jsonb)
      into v_market_pool
      from (
        select m.id,
               m.title,
               m.rooms,
               m.price,
               m.size_sqm,
               case when m.size_sqm > 0 then round(m.price / m.size_sqm) end as price_per_sqm,
               m.features,
               m.is_own,
               public.cma_feature_similarity(v_prop.features, m.features) as feature_match,
               round(public.geo_distance_meters(v_prop.lat, v_prop.lng, m.lat, m.lng))::numeric
                 as distance_meters
          from (
            select p.id, p.title, nullif(p.rooms, 0) as rooms, p.price, p.features, p.floor,
                   p.property_type,
                   p.lat, p.lng, (p.agent_id = p_agent_id) as is_own,
                   coalesce(p.built_size_sqm, p.size_sqm, p.area_sqm) as size_sqm
              from public.properties p
             where p.status = 'active'
               and p.deal_type = 'sale'
               and p.id is distinct from v_prop.id
               and p.price > 0
               and p.lat is not null and p.lng is not null
               and public.property_type_class(p.property_type)
                   = public.property_type_class(v_prop.property_type)
          ) m
         where public.geo_distance_meters(v_prop.lat, v_prop.lng, m.lat, m.lng) <= v_market_radius
           and (v_used_band is null
                or (v_dim = 'rooms' and m.rooms is not null and v_subject_rooms is not null
                    and abs(m.rooms - v_subject_rooms) <= v_used_band)
                or (v_dim = 'floor' and public.floor_group(m.floor::text) = v_subject_floor))
           -- נכס מיוחד שהשוואת העסקאות שלו נשענה על אותו תת-סוג: גם המתחרים
           and (not v_used_kind or public.property_kind(m.property_type) = v_subject_kind)
      ) c;

    select count(*), count(*) filter (where (x->>'feature_match')::numeric >= v_feat_min)
      into v_market_n, v_market_feat_n
      from jsonb_array_elements(v_market_pool) x;

    v_market_reason := case
      when v_market_n < v_min_market       then 'too_few'
      when v_market_feat_n >= v_min_market then 'features'
      when v_subject_feat_n = 0            then 'subject_features_missing'
      else                                      'rooms_only'
    end;

    -- החציון מושתק מתחת לסף, והרשימה לא: כל שורה בה היא נכס אחד עם
    -- מחיר אחד - עובדה - וחציון משתי מודעות הוא סטטיסטיקה שאין עליה
    -- על מה להישען. אותה הבחנה בדיוק שבין `comparables` ל-`stats`.
    if v_market_reason <> 'too_few' then
      select jsonb_build_object(
               'count',                count(*),
               'median_price',         round(percentile_cont(0.5) within group (order by (x->>'price')::numeric)::numeric),
               'min_price',            min((x->>'price')::numeric),
               'max_price',            max((x->>'price')::numeric),
               'median_price_per_sqm', round(percentile_cont(0.5) within group (
                                          order by (x->>'price_per_sqm')::numeric)
                                          filter (where x->>'price_per_sqm' is not null)::numeric),
               'sqm_sample_size',      count(*) filter (where x->>'price_per_sqm' is not null),
               'own_count',            count(*) filter (where (x->>'is_own')::boolean),
               'feature_matched',      (v_market_reason = 'features')
             )
        into v_market_stats
        from jsonb_array_elements(v_market_pool) x
       where v_market_reason <> 'features'
          or (x->>'feature_match')::numeric >= v_feat_min;
    end if;

    select coalesce(jsonb_agg(s.x || jsonb_build_object('in_market_stats',
             v_market_reason <> 'too_few'
             and (v_market_reason <> 'features'
                  or coalesce((s.x->>'feature_match')::numeric, -1) >= v_feat_min))
             order by s.ord), '[]'::jsonb)
      into v_market_comps
      from (select x, ord
              from jsonb_array_elements(v_market_pool) with ordinality t(x, ord)
             order by ord
             limit v_market_limit) s;
  end if;

  -- ---- שכבת השכונה: עסקאות בלי פין, באותה שכונה ----
  --
  -- עסקה רשמית בלי פין אינה יכולה להיכנס לרדיוס, אבל לרובן יש שם שכונה
  -- מהמאגר (market_deals_official.neighborhood_ids). כאן הן נאספות לפי
  -- השכונה של הנכס - **בלי מרחק ובלי מיקום מומצא**, ובנפרד מ-stats: זו
  -- השוואה מסוג אחר ("באותה שכונה") ולא עוד שורות ברדיוס.
  --
  -- השכונה של הנכס: השיוך שלו, ואם אין - המצולע שהפין שלו נופל בו (אחד
  -- בלבד, כמו תמיד ב-neighborhood_for_point). כך השכבה עובדת גם לנכס בלי
  -- פין שיש לו שכונה, שבו כל הדוח שמעליו ריק.
  v_hood_id := coalesce(
    v_prop.neighborhood_id,
    case when v_prop.lat is not null and v_prop.lng is not null
         then public.neighborhood_for_point(v_prop.city, v_prop.lat, v_prop.lng) end);

  if v_hood_id is not null then
    select n.name into v_hood_name from public.neighborhoods n where n.id = v_hood_id;

    -- החדרים: אותו בנד שהרדיוס בחר, ואם הרדיוס לא הגביל (או לא רץ -
    -- נכס בלי פין) אז ±1, השלב הרופף ביותר שעדיין מסנן. נכס בלי מספר
    -- חדרים - בלי סינון, ואז גם אין מה לומר על חדרים.
    v_hood_band := case when v_band_rooms is null then null
                        else coalesce(v_used_band, 1) end;

    select coalesce(jsonb_agg((to_jsonb(c) - 'rn' - 'total') order by c.sold_at desc), '[]'::jsonb),
           coalesce(max(c.total), 0)
      into v_hood_comps, v_hood_total
      from (
        select h.*, row_number() over (order by h.sold_at desc) as rn,
               count(*) over () as total
          from (
            select o.id, o.property_type, nullif(o.rooms, 0) as rooms, o.sale_price, o.sold_at,
                   o.size_sqm, o.source, 'official'::text as price_basis,
                   case when o.size_sqm > 0 then round(o.sale_price / o.size_sqm) end as price_per_sqm,
                   -- שם שמכסה כמה שכונות (כינוי משותף, "הדר"): העסקה אינה
                   -- ממוקמת בשכונה הזו דווקא, והתצוגה אומרת זאת.
                   (cardinality(o.neighborhood_ids) > 1) as shared_neighborhood,
                   coalesce(public.deal_type_class(o.property_type, o.rooms)
                            = public.property_type_class(v_prop.property_type), false) as same_type,
                   coalesce(public.deal_type_class(o.property_type, o.rooms)
                              = public.property_type_class(v_prop.property_type)
                            and (v_hood_band is null
                                 or abs(nullif(o.rooms, 0) - v_band_rooms) <= v_hood_band), false) as in_stats
              from public.market_deals_official o
             where v_hood_id = any(o.neighborhood_ids)
               and o.lat is null
               and o.sold_at >= v_cutoff
          ) h
      ) c
     where c.rn <= v_city_limit;

    select count(*) into v_hood_in
      from public.market_deals_official o
     where v_hood_id = any(o.neighborhood_ids)
       and o.lat is null
       and o.sold_at >= v_cutoff
       and coalesce(public.deal_type_class(o.property_type, o.rooms)
                      = public.property_type_class(v_prop.property_type)
                    and (v_hood_band is null
                         or abs(nullif(o.rooms, 0) - v_band_rooms) <= v_hood_band), false);

    -- אותה השתקה בדיוק כמו ב-stats: מתחת ל-cma_min_comparables אין חציון,
    -- רק השורות. החציון על **כל** השורות שנספרות, לא רק על המוצגות.
    if v_hood_in >= v_min_comps then
      select jsonb_build_object(
               'count',                count(*),
               'median_price',         round(percentile_cont(0.5) within group (order by o.sale_price)::numeric),
               'min_price',            min(o.sale_price),
               'max_price',            max(o.sale_price),
               'median_price_per_sqm', round(percentile_cont(0.5) within group (
                                          order by o.sale_price / o.size_sqm)
                                          filter (where o.size_sqm > 0)::numeric),
               'sqm_sample_size',      count(*) filter (where o.size_sqm > 0),
               'rooms_band',           v_hood_band
             )
        into v_hood_stats
        from public.market_deals_official o
       where v_hood_id = any(o.neighborhood_ids)
         and o.lat is null
         and o.sold_at >= v_cutoff
         and coalesce(public.deal_type_class(o.property_type, o.rooms)
                        = public.property_type_class(v_prop.property_type)
                      and (v_hood_band is null
                           or abs(nullif(o.rooms, 0) - v_band_rooms) <= v_hood_band), false);
    end if;
  end if;

  -- עסקאות באותה עיר שאי אפשר למקם — מוחזרות בנפרד, לא מעורבבות ברדיוס
  -- ולא נכנסות לסטטיסטיקה. מה שכבר מוצג בשכבת השכונה אינו חוזר כאן.
  select coalesce(jsonb_agg((to_jsonb(c) - 'rn') order by c.sold_at desc), '[]'::jsonb),
         max(c.total)
    into v_city_comps, v_city_n
    from (
      select w.*, row_number() over (order by w.sold_at desc) as rn,
             count(*) over () as total
        from (
      select md.id, md.property_type, md.rooms, md.sale_price, md.sold_at,
             md.source, md.price_basis
        from public.market_deals md
        left join public.properties rp on rp.id = md.related_property_id
       where md.city = v_prop.city
         and md.sold_at >= v_cutoff
         and (rp.id is null or rp.lat is null or rp.lng is null)

      union all

      select o.id, o.property_type, o.rooms, o.sale_price, o.sold_at,
             o.source, 'official'::text
        from public.market_deals_official o
       where o.city = v_prop.city
         and o.sold_at >= v_cutoff
         and (o.lat is null or o.lng is null)
         and (v_hood_id is null or not (v_hood_id = any(coalesce(o.neighborhood_ids, '{}'::uuid[]))))
        ) w
    ) c
   where c.rn <= v_city_limit;

  v_coverage := case
    when v_prop.lat is null or v_prop.lng is null then 'no_location'
    when v_n = 0                                  then 'none'
    when v_n < v_min_comps                        then 'insufficient'
    else 'ok'
  end;

  -- ההשתקה. ממוצע מ-2 עסקאות אינו "ממוצע עם אזהרה" — הוא מספר שאסור לו
  -- לצאת מה-RPC, כי כל מי שיקבל אותו יציג אותו.
  if v_coverage = 'ok' then
    select jsonb_build_object(
             'comparables_count',    count(*),
             'avg_price',            round(avg((x->>'sale_price')::numeric)),
             'median_price',         round(percentile_cont(0.5) within group (order by (x->>'sale_price')::numeric)::numeric),
             'min_price',            min((x->>'sale_price')::numeric),
             'max_price',            max((x->>'sale_price')::numeric),
             'avg_price_per_sqm',    round(avg((x->>'price_per_sqm')::numeric) filter (where x->>'price_per_sqm' is not null)),
             -- השטח הממוצע של ההשוואות: זה מה שמסביר פער כולל שרחוק
             -- מהפער למ"ר, ובלעדיו שורת ההסבר טוענת בלי להראות.
             'avg_size_sqm',         round(avg((x->>'size_sqm')::numeric) filter (where x->>'size_sqm' is not null)),
             'sqm_sample_size',      count(*) filter (where x->>'price_per_sqm' is not null),
             'same_type_count',      count(*) filter (where (x->>'same_type')::boolean),
             'rooms_band',           case when v_dim = 'rooms' then v_used_band end,
             'asking_basis_count',   count(*) filter (where x->>'price_basis' = 'asking'),
             'official_basis_count', count(*) filter (where x->>'price_basis' = 'official')
           )
      into v_stats
      from jsonb_array_elements(v_comps) x
     where (x->>'in_stats')::boolean;
  else
    v_stats := jsonb_build_object('comparables_count', v_n, 'sample_too_small', true);
  end if;

  select count(*) into v_asking_n
    from jsonb_array_elements(v_comps || v_city_comps || v_hood_comps) x
   where x->>'price_basis' = 'asking';

  select coalesce(jsonb_agg(jsonb_build_object(
           'source', s.source,
           'label',  case s.source
                       when 'platform_derived' then 'עסקאות שנסגרו דרך שוק נדל״ן'
                       when 'tax_authority'    then 'רשות המיסים - מאגר עסקאות מקרקעין'
                       else s.source end,
           'deals',  s.n) order by s.n desc), '[]'::jsonb)
    into v_sources
    from (
      select x->>'source' as source, count(*) as n
        from jsonb_array_elements(v_comps || v_city_comps || v_hood_comps) x
       group by 1
    ) s;

  select to_jsonb(i) - 'property_id' into v_planning
    from public.property_planning_info i where i.property_id = v_prop.id;

  return jsonb_build_object(
    'generated_at', now(),
    'subject', jsonb_build_object(
      'id', v_prop.id, 'title', v_prop.title, 'address', v_prop.address,
      'city', v_prop.city, 'property_type', v_prop.property_type,
      'deal_type', v_prop.deal_type, 'price', v_prop.price, 'rooms', v_prop.rooms,
      'size_sqm', v_subject_size,
      'price_per_sqm', case when v_subject_size > 0 then round(v_prop.price / v_subject_size) end,
      'features', to_jsonb(coalesce(v_prop.features, '{}'::text[])),
      'lat', v_prop.lat, 'lng', v_prop.lng,
      'location_precision', v_prop.location_precision
    ),
    'planning', v_planning,
    'radius_meters_used', v_used_radius,
    'radius_exhausted', (v_used_radius is not null and v_n < v_min_comps),
    'comparables', v_comps,
    'city_comparables', v_city_comps,
    -- שכבת השוק. **מחירים מבוקשים**, ולכן היא לעולם אינה נוגעת ב-stats.
    'market_comparables', v_market_comps,
    'market_stats', v_market_stats,
    -- שכבת השכונה. עסקאות רשמיות בלי פין; **לעולם אינה נוגעת ב-stats**.
    'neighborhood_comparables', v_hood_comps,
    'neighborhood_stats', v_hood_stats,
    'stats', v_stats,
    'data_coverage', jsonb_build_object(
      'status',             v_coverage,
      'comparables_found',  v_n,
      'comparables_in_radius', v_n_all,
      'comparables_same_type', v_n_class,
      'excluded_other_type', greatest(v_n_all - v_n_class, 0),
      -- מה שנשאר בחוץ בגלל מספר החדרים. דוח שמשתיק נתונים חייב לומר
      -- שהשתיק, בדיוק כמו excluded_other_type שלידו.
      'excluded_other_rooms', case when v_used_band is null or v_dim <> 'rooms' or v_used_kind then 0
                                   else greatest(v_n_class - v_n, 0) end,
      'subject_rooms',      v_subject_rooms,
      'rooms_band',         case when v_dim = 'rooms' then v_used_band end,
      'rooms_band_reason',  v_band_reason,
      'similar_radius_meters', v_similar_max,
      'min_required',       v_min_comps,
      'max_deal_age_months',v_max_age,
      'oldest_considered',  v_cutoff,
      'asking_basis_count', v_asking_n,
      'city_comparables_total', coalesce(v_city_n, 0),
      'city_comparables_shown', jsonb_array_length(v_city_comps),
      'has_statistics',     (v_coverage = 'ok'),
      -- שכבת השוק מדווחת את עצמה באותה מידה: כמה יש, כמה תואמים
      -- במאפיינים, על מה החציון נשען, וכמה מאפיינים בכלל רשומים לנכס.
      'market_comparables_total', v_market_n,
      'market_comparables_shown', jsonb_array_length(v_market_comps),
      'market_feature_matched',   v_market_feat_n,
      'market_band_reason',       v_market_reason,
      'market_radius_meters',     v_market_radius,
      'min_market_required',      v_min_market,
      'feature_match_min',        v_feat_min,
      'subject_features_counted', v_subject_feat_n,
      'has_market_statistics',    (v_market_stats is not null),
      'neighborhood_id',                 v_hood_id,
      'neighborhood_name',               v_hood_name,
      'neighborhood_comparables_total',  v_hood_total,
      'neighborhood_comparables_shown',  jsonb_array_length(v_hood_comps),
      'neighborhood_comparables_counted', v_hood_in,
      'neighborhood_rooms_band',         v_hood_band,
      'neighborhood_shared_count',       (select count(*) from jsonb_array_elements(v_hood_comps) x
                                           where (x->>'shared_neighborhood')::boolean),
      'has_neighborhood_statistics',     (v_hood_stats is not null),
      -- הממד של הסולם (20270226090000). ‏rooms_band_reason נושא ערכי
      -- floor_* כש-band_dimension = 'floor'.
      'subject_class',          v_subject_class,
      'band_dimension',         v_dim,
      'subject_floor_group',    v_subject_floor,
      'excluded_other_floor',   case when v_used_band is null or v_dim <> 'floor' then 0
                                     else greatest(v_n_class - v_n, 0) end,
      -- הרדיוס הרחוק ביותר שהסולם בודק: 2,000 מ' בנכס מסחרי
      'max_radius_meters',      (select max(x) from unnest(v_radii) x),
      -- תת-הסוג של נכס מגורים, והאם הממוצע נשען על אותו תת-סוג
      'subject_kind',           v_subject_kind,
      'kind_matched',           v_used_kind,
      'excluded_other_kind',    case when v_used_kind then greatest(v_n_class - v_n, 0) else 0 end
    ),
    'sources', v_sources
  );
end;
$$;

comment on function public.cma_report_core(uuid, public.properties) is
  'עסקה בלי סוג בשכבת השכונה נחשבת דירה, והנכס מחזיר location_precision (20271110120000). הגוף של דוח ה-CMA: נכס נושא (שורת properties, גם כזו שנבנתה בזיכרון בלי id) → עסקאות, סולם, שכבות ו-stats. בלי גייט ובלי שליפה - אלה בעטיפות agent_cma_report ו-agent_cma_report_address. docs/cma.md';

revoke all on function public.cma_report_core(uuid, public.properties) from public, anon, authenticated;
grant execute on function public.cma_report_core(uuid, public.properties) to service_role;

-- ---------------------------------------------------------------------------
-- 5. פין משוער לכל נכס בלי פין, בדיוק הכי טוב שיש (תומר, 10.11.2026):
--    רחוב (עסקאות) ← שכונה (מצולע או מרכז ורדיוס) ← עיר (מרכז החלקות של
--    היישוב). כל רמה מסומנת ב-location_precision משלה, וכל מפה אומרת זאת.
-- ---------------------------------------------------------------------------

-- נקודה בתוך שכונה - כל שכונה, לא רק אזור תעשייה. הגוף של zone_approx_point
-- (20270430090000) בלי הסינון is_industrial; zone_approx_point נשארת עטיפה
-- לאזורי תעשייה, כדי שהטריגר הישן ימשיך לעבוד בדיוק כמו קודם.
create or replace function public.neighborhood_approx_point(p_hood uuid, p_seed uuid)
returns table (lat double precision, lng double precision, radius_m integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h       record;
  v_ring  jsonb;
  v_clat  double precision;
  v_clng  double precision;
  v_max   double precision := 0;
  v_r     double precision;
  v_n     integer;
  i       integer;
  v_hash  text;
  u1      double precision;
  u2      double precision;
  v_dist  double precision;
  v_ang   double precision;
  c_lat   double precision;
  c_lng   double precision;
  k_m     constant double precision := 111320;   -- מטרים למעלת רוחב
begin
  select n.boundary, n.lat, n.lng, n.radius_m
    into h
    from public.neighborhoods n
   where n.id = p_hood;
  if not found then
    return;
  end if;

  if jsonb_typeof(h.boundary) = 'array' and jsonb_array_length(h.boundary) >= 3 then
    v_ring := h.boundary;
    v_n := jsonb_array_length(v_ring);
    if h.lat is not null and h.lng is not null and public.point_in_ring(v_ring, h.lat, h.lng) then
      v_clat := h.lat; v_clng := h.lng;
    else
      select avg((e ->> 0)::double precision), avg((e ->> 1)::double precision)
        into v_clat, v_clng
        from jsonb_array_elements(v_ring) e;
    end if;
    for i in 0 .. v_n - 1 loop
      v_max := greatest(v_max, sqrt(
        power(((v_ring -> i ->> 0)::double precision - v_clat) * k_m, 2) +
        power(((v_ring -> i ->> 1)::double precision - v_clng) * k_m * cos(radians(v_clat)), 2)));
    end loop;
  elsif h.lat is not null and h.lng is not null and h.radius_m is not null then
    v_clat := h.lat; v_clng := h.lng; v_max := h.radius_m;
  else
    return;
  end if;

  v_r := least(1000, greatest(v_max, 50));

  for i in 0 .. 63 loop
    v_hash := md5(coalesce(p_seed::text, '') || ':' || i);
    u1 := ('x' || substr(v_hash, 1, 8))::bit(32)::bigint / 4294967295.0;
    u2 := ('x' || substr(v_hash, 9, 8))::bit(32)::bigint / 4294967295.0;
    v_dist := v_r * sqrt(u1);
    v_ang  := 2 * pi() * u2;
    c_lat := v_clat + (v_dist * cos(v_ang)) / k_m;
    c_lng := v_clng + (v_dist * sin(v_ang)) / (k_m * cos(radians(v_clat)));
    if v_ring is null or public.point_in_ring(v_ring, c_lat, c_lng) then
      lat := round(c_lat::numeric, 6); lng := round(c_lng::numeric, 6); radius_m := round(v_r);
      return next;
      return;
    end if;
  end loop;

  -- אף הגרלה לא נפלה בגבול (אזור צר ומפותל): המרכז
  lat := round(v_clat::numeric, 6); lng := round(v_clng::numeric, 6); radius_m := round(v_r);
  return next;
end $$;

comment on function public.neighborhood_approx_point(uuid, uuid) is
  'נקודה דטרמיניסטית (לפי seed) בתוך שכונה: במצולע שלה, או ברדיוס סביב מרכזה. הבסיס של zone_approx_point (אזורי תעשייה) ושל הפין המשוער לכל נכס. 20271110120000.';

revoke all on function public.neighborhood_approx_point(uuid, uuid) from public, anon, authenticated;

create or replace function public.zone_approx_point(p_hood uuid, p_seed uuid)
returns table (lat double precision, lng double precision, radius_m integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.lat, a.lng, a.radius_m
    from public.neighborhoods n
    cross join lateral public.neighborhood_approx_point(n.id, p_seed) a
   where n.id = p_hood and n.is_industrial;
$$;

revoke all on function public.zone_approx_point(uuid, uuid) from public, anon, authenticated;

-- מרכז היישוב, משכבת החלקות הפתוחה (parcels_open, 1,042 יישובים). ב-cities אין
-- עדיין קואורדינטות לאף יישוב, והחלקות הן המקור הפתוח היחיד שמכסה את הארץ.
-- הרדיוס: פי 1.5 מפיזור החלקות, בין 300 ל-1,000 מ' (התקרה שהתצוגה מציירת).
create or replace function public.city_approx_point(p_city_id uuid)
returns table (lat double precision, lng double precision, radius_m integer)
language sql
stable
security definer
set search_path = ''
as $$
  select round(avg(po.lat)::numeric, 6)::double precision,
         round(avg(po.lng)::numeric, 6)::double precision,
         least(1000, greatest(300, round(1.5 * greatest(
           coalesce(stddev_pop(po.lat), 0) * 111320,
           coalesce(stddev_pop(po.lng), 0) * 111320 * cos(radians(avg(po.lat)))))))::integer
    from public.cities c
    join public.parcels_open po on po.locality_code = c.muni_code::integer
   where c.id = p_city_id
     and c.muni_code ~ '^\d+$'
     and po.lat is not null and po.lng is not null
  having count(*) > 0;
$$;

comment on function public.city_approx_point(uuid) is
  'מרכז היישוב ורדיוס הפיזור, מהחלקות הפתוחות של מפ"י. הרמה האחרונה של הפין המשוער. 20271110120000.';

revoke all on function public.city_approx_point(uuid) from public, anon, authenticated;

-- הבחירה: הרמה הכי מדויקת שיש לנכס. אותה פונקציה לטריגר ולהשלמה למפרע.
create or replace function public.property_approx_location(
  p_city         text,
  p_street       text,
  p_house_number text,
  p_neighborhood uuid,
  p_city_id      uuid,
  p_seed         uuid
)
returns table (lat double precision, lng double precision, kind text, radius_m integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_loc jsonb;
  v_pt  record;
begin
  -- 1. הרחוב: עסקה בכתובת, מרכז החלקה, מספר בית קרוב, או מרכז הרחוב
  if nullif(btrim(coalesce(p_street, '')), '') is not null
     and nullif(btrim(coalesce(p_city, '')), '') is not null then
    begin
      v_loc := public.cma_locate_address(p_city, p_street, p_house_number);
    exception when others then
      v_loc := null;
    end;
    if v_loc is not null and (v_loc->>'lat') is not null and (v_loc->>'lng') is not null then
      lat := (v_loc->>'lat')::double precision;
      lng := (v_loc->>'lng')::double precision;
      kind := 'street';
      radius_m := case v_loc->>'precision'
                    when 'address_deal'   then 80
                    when 'parcel'         then 80
                    when 'street_nearest' then 150
                    else 300
                  end;
      return next;
      return;
    end if;
  end if;

  -- 2. השכונה (אזור תעשייה נשאר 'zone' - אותה תצוגה ואותו טריגר כמו קודם)
  if p_neighborhood is not null then
    select a.lat, a.lng, a.radius_m, n.is_industrial
      into v_pt
      from public.neighborhoods n
      cross join lateral public.neighborhood_approx_point(n.id, p_seed) a
     where n.id = p_neighborhood;
    if found and v_pt.lat is not null then
      lat := v_pt.lat; lng := v_pt.lng;
      kind := case when v_pt.is_industrial then 'zone' else 'neighborhood' end;
      radius_m := v_pt.radius_m;
      return next;
      return;
    end if;
  end if;

  -- 3. היישוב
  if p_city_id is not null then
    select c.lat, c.lng, c.radius_m into v_pt from public.city_approx_point(p_city_id) c;
    if found and v_pt.lat is not null then
      lat := v_pt.lat; lng := v_pt.lng;
      kind := 'city';
      radius_m := v_pt.radius_m;
      return next;
      return;
    end if;
  end if;
  return;
end $$;

comment on function public.property_approx_location(text, text, text, uuid, uuid, uuid) is
  'הפין המשוער של נכס בלי פין: רחוב (מהעסקאות) ← שכונה ← יישוב, עם location_precision ורדיוס לכל רמה. docs/property-map.md, "מיקום משוער". 20271110120000.';

revoke all on function public.property_approx_location(text, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- הטריגר. לפני properties_set_neighborhood_trg (לפי שם: "locate" < "set"), כדי
-- שהפין שנקבע כאן יקבל שכונה באותה כתיבה, ולפני properties_zone_location_trg
-- ("locate" < "zone"): שם, lat/lng שזזו עם location_precision שלא השתנה
-- הופכים ל-'exact' - בדיוק מה שקורה כשפין אמיתי מחליף את זה המשוער. כאן
-- הדיוק נכתב יחד עם הנקודה, ולכן הטריגר ההוא אינו נוגע בה (ולפין משוער
-- שחושב מחדש אחרי שינוי כתובת יש שם חריג, סעיף 6ב).
--
-- אחרי properties_set_city_id_trg? לא: "locate" < "set_city". ולכן city_id
-- נפתר כאן בעצמו כשהוא עדיין ריק (אותה פונקציה, city_id_for_name).
--
-- מתי: ביצירה, או כשפין משוער קיים והכתובת/השכונה השתנו (מחשבים מחדש).
-- פין אמיתי - לא נוגעים. נכס שאין לו רחוב, שכונה ולא יישוב מוכר - נשאר
-- בלי פין. רק ביצירה ובשינוי, לא בכל שמירה: החיפוש ברחוב עובר על עסקאות
-- העיר, ושמירת מחיר בנכס שאין ברחובו עסקה לא צריכה להריץ אותו שוב.
create or replace function public.properties_locate_street()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pt record;
  v_changed boolean := false;
  v_city_id uuid := new.city_id;
begin
  if tg_op = 'UPDATE' then
    v_changed := new.street is distinct from old.street
              or new.house_number is distinct from old.house_number
              or new.city is distinct from old.city
              or new.neighborhood_id is distinct from old.neighborhood_id;
    -- פין משוער והמקור שלו השתנה: מחשבים מחדש. פין אמיתי - לא נוגעים.
    if v_changed and old.location_precision in ('street', 'neighborhood', 'city')
       and new.lat is not distinct from old.lat and new.lng is not distinct from old.lng then
      new.lat := null; new.lng := null;
      new.location_precision := null; new.location_radius_m := null;
    end if;
  end if;

  if (tg_op = 'INSERT' or v_changed) and (new.lat is null or new.lng is null) then
    if v_city_id is null and nullif(btrim(coalesce(new.city, '')), '') is not null then
      v_city_id := public.city_id_for_name(new.city);
    end if;
    select * into v_pt
      from public.property_approx_location(new.city, new.street, new.house_number,
                                           new.neighborhood_id, v_city_id, new.id);
    if found and v_pt.lat is not null then
      new.lat := v_pt.lat;
      new.lng := v_pt.lng;
      new.location_precision := v_pt.kind;
      new.location_radius_m := v_pt.radius_m;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.properties_locate_street() is
  'נכס בלי פין מקבל פין משוער ברמה הכי מדויקת שיש (property_approx_location): רחוב, שכונה או יישוב. פין אמיתי מחליף אותו. 20271110120000, docs/property-map.md.';

revoke all on function public.properties_locate_street() from public, anon, authenticated;

drop trigger if exists properties_locate_street_trg on public.properties;
create trigger properties_locate_street_trg
  before insert or update of lat, lng, street, house_number, city, neighborhood_id on public.properties
  for each row execute function public.properties_locate_street();

-- ---------------------------------------------------------------------------
-- 6. govmap_admin_save - מהגרסה ב-20270103090000: פין מ-GovMap מחליף גם פין
--    משוער על הרחוב, לא רק פין חסר
-- ---------------------------------------------------------------------------
create or replace function public.govmap_admin_save(p_property_id uuid, p_record jsonb)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_lat     numeric;
  v_lng     numeric;
  v_paid    boolean;
  v_result  text;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  if not exists (select 1 from public.properties p where p.id = p_property_id) then
    raise exception 'no_such_property';
  end if;

  -- ‏null או {} = GovMap ענה ואין שם כלום. נרשם, כדי שהנכס לא יחזור מחר.
  if p_record is null or p_record = '{}'::jsonb then
    insert into public.govmap_backfill_attempts (property_id, attempted_at, result)
    values (p_property_id, now(), 'not_found')
    on conflict (property_id) do update set attempted_at = now(), result = 'not_found';
    return 'not_found';
  end if;

  -- הפין: **רק כשחסר.** פין קיים אולי הוזז ידנית, וזו החלטה של הסוכן/ת
  -- (אותו כלל כמו geocode-backfill, docs/geocoding.md).
  if jsonb_typeof(p_record->'pin_lat') = 'number' and jsonb_typeof(p_record->'pin_lng') = 'number' then
    v_lat := (p_record->>'pin_lat')::numeric;
    v_lng := (p_record->>'pin_lng')::numeric;
    if v_lat not between 29.3 and 33.5 or v_lng not between 34.2 and 35.95 then
      raise exception 'bad_coordinates';
    end if;
    -- פין מ-GovMap הוא מדויק: גם כשהוא מחליף פין משוער על הרחוב, הדיוק נכתב
    -- כאן במפורש ולא נשען על הטריגר שהופך lat/lng שזזו ל-'exact'.
    update public.properties
       set lat = v_lat, lng = v_lng, location_precision = 'exact', location_radius_m = null
     where id = p_property_id
       and (lat is null or lng is null or location_precision in ('street', 'neighborhood', 'city'));
  end if;

  select exists (select 1 from public.properties p
                   join public.agency_members m on m.id = p.agent_id
                  where p.id = p_property_id and m.active = true
                    and m.billing_status = 'active'
                    and m.tier in ('mid', 'premium'))
    into v_paid;

  if v_paid and p_record ? 'planning' and jsonb_typeof(p_record->'planning') = 'object' then
    perform public.govmap_planning_write(p_property_id, p_record->'planning');
    v_result := 'saved';
  else
    v_result := 'pin_only';
  end if;

  insert into public.govmap_backfill_attempts (property_id, attempted_at, result)
  values (p_property_id, now(), v_result)
  on conflict (property_id) do update set attempted_at = now(), result = excluded.result;

  return v_result;
end;
$$;

comment on function public.govmap_admin_save(uuid, jsonb) is
  'השלמת GovMap לנכס קיים: פין רק אם חסר או משוער על הרחוב (20271110120000), מידע תכנוני רק למסלול בתשלום פעיל, ורישום הניסיון. מנהל/ת פלטפורמה בלבד.';

revoke all on function public.govmap_admin_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.govmap_admin_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6ב. מה שקורא "אין פין" חייב להכיר גם 'street' (מביקורת הקוד, 10.11.2026):
--     אחרת פין משוער היה מסתיר לתמיד את הפין המדויק שהיה מגיע אחריו.
-- ---------------------------------------------------------------------------

-- פין משוער על הרחוב שחושב מחדש אחרי שינוי כתובת (properties_locate_street
-- רץ לפני, ומשאיר 'street') זז - אבל לא למקום אמיתי. הטריגר הזה היה הופך
-- אותו ל-'exact', כי הדיוק "לא השתנה". הגוף מהגרסה החיה (20270430090000),
-- עם התנאי הנוסף בלבד.
create or replace function public.properties_zone_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved boolean := false;
  z       record;
begin
  if tg_op = 'UPDATE' then
    v_moved := new.lat is distinct from old.lat or new.lng is distinct from old.lng;
    if v_moved and new.location_precision is not distinct from old.location_precision
       and not (old.location_precision in ('street', 'neighborhood', 'city')
                and (new.street is distinct from old.street
                     or new.house_number is distinct from old.house_number
                     or new.city is distinct from old.city
                     or new.neighborhood_id is distinct from old.neighborhood_id)) then
      if new.lat is not null and new.lng is not null then
        new.location_precision := 'exact';
      else
        new.location_precision := null;
      end if;
      new.location_radius_m := null;
    end if;
    if not v_moved and old.location_precision = 'zone'
       and new.location_precision is not distinct from 'zone'
       and new.neighborhood_id is distinct from old.neighborhood_id then
      new.lat := null; new.lng := null;
      new.location_precision := null; new.location_radius_m := null;
    end if;
  end if;

  if new.location_precision = 'exact' then
    new.location_radius_m := null;
  end if;

  if (new.lat is null or new.lng is null) and new.neighborhood_id is not null then
    select * into z from public.zone_approx_point(new.neighborhood_id, new.id);
    if found and z.lat is not null then
      new.lat := z.lat; new.lng := z.lng;
      new.location_precision := 'zone';
      new.location_radius_m := z.radius_m;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.properties_zone_location() from public, anon, authenticated;

-- תור הגאוקוד בשרת (עפולה): נכס עם פין משוער על הרחוב עדיין מחכה לפין
-- המדויק מהשכבה העירונית. הגוף מהגרסה החיה (20261201090000), עם התנאי בלבד.
create or replace function public.geocode_backfill_queue(
  p_limit        integer  default 25,
  p_max_attempts smallint default 3,
  p_retry_after  interval default interval '20 hours'
)
returns table (id uuid, street text, house_number text, kind text, city text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.street, q.house_number, q.kind, q.city
    from (
      select p.id, p.street, p.house_number, 'property'::text as kind, p.city,
             p.geocode_attempted_at, p.created_at as ordered_at
        from public.properties p
        join public.city_geocode_sources s
          on s.city_key = public.city_name_key(p.city) and s.active
       where p.status = 'active'
         and (p.lat is null or p.lng is null or p.location_precision in ('street', 'neighborhood', 'city'))
         and nullif(btrim(coalesce(p.street, '')), '')       is not null
         and nullif(btrim(coalesce(p.house_number, '')), '') is not null
         and p.geocode_attempts < p_max_attempts
         and (p.geocode_attempted_at is null
              or p.geocode_attempted_at < now() - p_retry_after)

      union all

      select o.id, o.street, o.house_number, 'official_deal'::text as kind, o.city,
             o.geocode_attempted_at, o.imported_at as ordered_at
        from public.market_deals_official o
        join public.city_geocode_sources s
          on s.city_key = public.city_name_key(o.city) and s.active
       where (o.lat is null or o.lng is null)
         and nullif(btrim(coalesce(o.street, '')), '')       is not null
         and nullif(btrim(coalesce(o.house_number, '')), '') is not null
         and o.geocode_attempts < p_max_attempts
         and (o.geocode_attempted_at is null
              or o.geocode_attempted_at < now() - p_retry_after)
    ) q
   order by q.geocode_attempted_at asc nulls first, q.ordered_at desc
   limit greatest(p_limit, 0);
$$;

revoke all on function public.geocode_backfill_queue(integer, smallint, interval) from public, anon, authenticated;
grant execute on function public.geocode_backfill_queue(integer, smallint, interval) to service_role;

-- תוצאת הגאוקוד היא פין מדויק: נכתב במפורש, גם כשהיא מחליפה פין משוער.
create or replace function public.geocode_record_result(
  p_id    uuid,
  p_lat   double precision,
  p_lng   double precision,
  p_error text,
  p_kind  text default 'property'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'official_deal' then
    update public.market_deals_official
       set lat                  = coalesce(p_lat, lat),
           lng                  = coalesce(p_lng, lng),
           geocode_attempted_at = now(),
           geocode_attempts     = case when p_error = 'address_not_found'
                                       then geocode_attempts + 1
                                       else geocode_attempts end,
           geocode_error        = p_error
     where id = p_id;
  else
    update public.properties
       set lat                  = coalesce(p_lat, lat),
           lng                  = coalesce(p_lng, lng),
           location_precision   = case when p_lat is not null and p_lng is not null
                                       then 'exact' else location_precision end,
           location_radius_m    = case when p_lat is not null and p_lng is not null
                                       then null else location_radius_m end,
           geocode_attempted_at = now(),
           geocode_attempts     = case when p_error = 'address_not_found'
                                       then geocode_attempts + 1
                                       else geocode_attempts end,
           geocode_error        = p_error
     where id = p_id;
  end if;
end;
$$;

revoke all on function public.geocode_record_result(uuid, double precision, double precision, text, text) from public, anon, authenticated;
grant execute on function public.geocode_record_result(uuid, double precision, double precision, text, text) to service_role;

-- התור של ההשלמה מ-GovMap בדפדפן (מנהל/ת): פין משוער על הרחוב הוא "חסר פין".
-- בלעדיו הענף החדש ב-govmap_admin_save לא היה מגיע אף פעם. הגוף מהגרסה
-- החיה (20270103090000), עם התנאי בלבד.
create or replace function public.govmap_backfill_candidates(p_limit integer default 40)
returns table (
  id            uuid,
  city          text,
  street        text,
  house_number  text,
  need_pin      boolean,
  need_planning boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  return query
  with base as (
    select p.id, btrim(p.city) as city, btrim(p.street) as street, btrim(p.house_number) as house_number,
           (p.lat is null or p.lng is null or p.location_precision in ('street', 'neighborhood', 'city')) as need_pin,
           (not exists (select 1 from public.property_planning_info i
                         where i.property_id = p.id and i.gush is not null)
            and exists (select 1 from public.agency_members m
                         where m.id = p.agent_id and m.active = true
                           and m.billing_status = 'active'
                           and m.tier in ('mid', 'premium'))) as need_planning
      from public.properties p
     where p.status = 'active'
       and nullif(btrim(coalesce(p.city, '')), '') is not null
       and btrim(p.city) <> 'עפולה'
       and nullif(btrim(coalesce(p.street, '')), '') is not null
       and nullif(btrim(coalesce(p.house_number, '')), '') is not null
       and not exists (select 1 from public.govmap_backfill_attempts a
                        where a.property_id = p.id
                          and a.attempted_at > now() - interval '7 days')
  )
  select b.id, b.city, b.street, b.house_number, b.need_pin, b.need_planning
    from base b
   where b.need_pin or b.need_planning
   order by b.need_pin desc, b.id
   limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$$;

revoke all on function public.govmap_backfill_candidates(integer) from public, anon, authenticated;
grant execute on function public.govmap_backfill_candidates(integer) to authenticated;

-- המפה בדף הנכס: גם מיקום משוער על הרחוב מוצג (כעיגול), כמו zone ו-parcel.
-- הגוף מהגרסה החיה (20270430090000), עם הערך הנוסף בלבד.
create or replace function public.property_map_enabled(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    where p.id = p_property_id
      and p.status = 'active'
      and m.active = true
      and m.tier in ('mid', 'premium')
      and m.billing_status = 'active'
      and p.lat is not null
      and p.lng is not null
      and (
        (p.house_number is not null and (p.street is not null or p.address is not null))
        or p.location_precision in ('zone', 'parcel', 'street', 'neighborhood', 'city')
      )
  );
$$;

revoke all on function public.property_map_enabled(uuid) from public, anon, authenticated;
grant execute on function public.property_map_enabled(uuid) to anon, authenticated, service_role;

-- cma_locate_address מסננת לפי city ו-street_name_key(street), והאינדקס הקיים
-- הוא על property_text_key - מפתח אחר. בעיר של 1,855 עסקאות (וגדלה) כל
-- קריאה סרקה את כל העיר; הטריגר קורא לה בכל יצירת נכס.
create index if not exists market_deals_official_city_street_name_idx
  on public.market_deals_official (city, public.street_name_key(street));

-- ---------------------------------------------------------------------------
-- 7. השלמה למפרע: כל נכס פעיל או טיוטה בלי פין, בכל הארץ. אותה פונקציה של
--    הטריגר, ישירות (הטריגר רץ רק ביצירה ובשינוי). מי שאין לו רחוב עם
--    עסקאות, שכונה עם גבול או יישוב בשכבת החלקות - נשאר בלי פין.
-- ---------------------------------------------------------------------------
do $$
declare
  v_before integer;
  v_done   integer;
  v_by     text;
begin
  select count(*) into v_before
    from public.properties
   where (lat is null or lng is null) and status in ('active', 'unpublished');

  with located as (
    select p.id, a.lat, a.lng, a.kind, a.radius_m
      from public.properties p
      cross join lateral public.property_approx_location(
        p.city, p.street, p.house_number, p.neighborhood_id,
        coalesce(p.city_id, public.city_id_for_name(p.city)), p.id) a
     where (p.lat is null or p.lng is null) and p.status in ('active', 'unpublished')
  )
  update public.properties p
     set lat = l.lat, lng = l.lng,
         location_precision = l.kind,
         location_radius_m  = l.radius_m
    from located l
   where l.id = p.id and l.lat is not null;
  get diagnostics v_done = row_count;

  select string_agg(location_precision || ': ' || n, ', ')
    into v_by
    from (select location_precision, count(*) as n
            from public.properties
           where location_precision in ('street', 'neighborhood', 'zone', 'city')
           group by 1) s;

  raise notice 'פין משוער: % נכסים בלי פין, % קיבלו פין (%), % נשארו',
    v_before, v_done, coalesce(v_by, ''), v_before - v_done;
end $$;

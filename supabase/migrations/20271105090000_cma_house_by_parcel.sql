-- ============================================================================
-- הערכת שווי לבית צמוד קרקע: מיקום לפי גוש/חלקה, בית לפי החלקה, וגודל המגרש
--
-- ## מה קרה (4.11.2026)
--
-- סוכן ביקש מגבריאלה להעריך בית צמוד קרקע בעפולה, ושלוש פעמים ברצף קיבל
-- "אני לא יכולה להעריך מחיר". שתי סיבות, ושתיהן במסד:
--
--   1. **אין מיקום לחלקה בלי עסקה.** ‏`agent_market_deals_by_parcel` גזרה את
--      מרכז החלקה רק ממיקום העסקאות שנרשמו בה. בחלקה 16774/281 לא נמכר
--      כלום, ולכן לא היה מרכז, לא היה רדיוס ולא הייתה השוואה - למרות
--      שבשכבת החלקות הפתוחה (‏`parcels_open`, מפ"י דרך data.gov.il) החלקה
--      קיימת, עם נקודה ועם שטח רשום של 342 מ"ר (בדיוק מה שבנסח).
--   2. **בית אינו "בית" במאגר.** רשות המיסים רושמת כמעט כל בית צמוד קרקע
--      כ"דירה", ו-`cma_deal_pool` משווה בית לבתים בלבד (20270226090000).
--      כלומר לבית בעפולה כמעט אף פעם אין ממוצע, גם כשנמכרו עשרה בתים
--      ברחוב.
--
-- ## מה כאן
--
-- 1. ‏`cma_deal_pool` - **בית לפי החלקה**: עסקת "דירה" בלי קומה, שהיא העסקה
--    היחידה שנרשמה אי פעם בחלקה שלה, ושהחלקה עד 1,500 מ"ר (או ששטחה אינו
--    ידוע) - נחשבת לבית, אבל רק כשהנכס עצמו בית. ‏`kind = 'house_parcel'`
--    מסמן אותה, ו-`plot_sqm` (עמודה חדשה, בסוף) נושא את שטח החלקה.
-- 2. ‏`agent_market_deals_by_parcel` - המרכז קודם כול מ-`parcels_open`, ורק
--    אחר כך מהעסקאות. העיר - מהעסקאות בגוש, ואם אין - מהשכבה. וחוזר
--    ‏`parcel_layer`: השטח הרשום, הסטטוס והיישוב, או null כשהחלקה אינה
--    קיימת בשכבה (ואז כנראה ספרות שהתחלפו).
-- 3. ‏`cma_house_context` - לבית: שטח המגרש של הנכס מול חציון המגרשים של
--    הבתים שנספרו, מושתק מתחת ל-`cma_min_comparables` כמו כל מספר בדוח.
--    רץ על כל ה-`comparables` **לפני** החיתוך של `cma_report_finish`.
-- 4. ‏`agent_cma_report_address` - מקבלת גם גוש/חלקה (במקום רחוב) וגודל
--    מגרש. מיקום מ-`parcels_open`, ‏`location_precision = 'parcel'`.
--    ‏`agent_cma_report_full` - קוראת ל-`cma_house_context` עם שטח החלקה של
--    הנכס מהמידע התכנוני.
--
-- ## למה כך מזהים בית - נמדד בפרודקשן (5.11.2026)
--
-- עסקאות "דירה" בלי קומה, בחלקה שאין בה אף עסקה אחרת: 2,679 חלקות. עד
-- 1,500 מ"ר הן נראות כמו בתים - חציון 178-190 מ"ר בנוי, 5.2-5.4 חדרים -
-- ומעל זה הן מתערבבות בבניינים ובמשקים. בגוש 16774 שמונה העסקאות בלי
-- קומה יושבות על חלקות של 229-462 מ"ר, ובנייני הארז שלידן על 5,800-9,600.
--
-- זה קירוב ולא עובדה (בניין קטן שנמכרה בו דירה אחת בלי קומה ייראה כמו
-- בית), ולכן הדוח אומר כמה מהבתים זוהו כך (‏`houses_by_parcel`).
-- דו-משפחתי על חלקה משותפת, או בית שנמכר פעמיים, לא ייספר - בכוונה:
-- עדיף לפספס בית מאשר לספור בניין.
--
-- ## בשרת, בלי GovMap
--
-- ‏`parcels_open` היא אותה שכבת חלקות של מפ"י שב-GovMap (‏`PARCEL_ALL`),
-- מהמאגר הפתוח. GovMap עצמו אסור מהשרת (הסקיל `govmap`, `docs/parcels-open.md`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ‏cma_deal_pool - עמודה חדשה (‏plot_sqm), ולכן drop + create
--
-- זהה ל-20270302090000 בכל עמודה קיימת ובכל נכס שאינו בית. לבית: CTE ‏`hp`
-- (החלקות שבהן עסקת "דירה" היא בית) - פעם אחת **לחלקה**, ורק לבית, לפי
-- הכלל של הסקיל `cma-report` (סעיף 6).
-- ---------------------------------------------------------------------------
drop function if exists public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric);

create function public.cma_deal_pool(
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
    -- הקומה העליונה שנמכרה בכל בניין - פעם אחת לבניין, ורק לפנטהאוז
    -- (20270302090000, ללא שינוי)
    select o2.gush, o2.helka, max(public.floor_num(o2.floor)) as top_floor
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
           when coalesce(d.top_floor, t.top_floor) >= 3
            and public.floor_num(d.floor) = coalesce(d.top_floor, t.top_floor) then 'roof'
           when f.fg = 'ground' then 'garden'
           else 'unit'
         end as kind,
         case when g.by_parcel then h.legal_area end as plot_sqm
    from d
    cross join s
    -- העסקה: כל פונקציה פעם אחת, ורק כשהנכס צריך אותה
    cross join lateral (
      select public.property_type_class(d.property_type) as cls,
             case when s.s_cls = 'dwelling'
                  then public.property_kind(d.property_type) end as pk,
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
  'בני ההשוואה לדוח CMA: איחוד market_deals ו-market_deals_official ברדיוס ובחלון הזמן, עם מרחק, התאמת מחלקה, הפרש חדרים, קבוצת קומה (מסחרי, גן/גג) ותת-סוג. לבית: עסקת "דירה" בלי קומה שהיא היחידה בחלקה שלה (עד 1,500 מ"ר) נחשבת לבית (kind = house_parcel, plot_sqm מ-parcels_open). 20271105090000.';

revoke all on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 2. עסקאות לפי גוש/חלקה - המרכז מ-parcels_open
-- ---------------------------------------------------------------------------
create or replace function public.agent_market_deals_by_parcel(
  p_agent_id uuid,
  p_gush     text,
  p_helka    text    default null,
  p_months   integer default 24,
  p_limit    integer default 5,
  p_radius_m integer default 300
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_tier    text;
  v_gush    integer := public.land_parcel_num(p_gush);
  v_helka   integer := public.land_parcel_num(p_helka);
  v_months  integer := least(greatest(coalesce(p_months, 24), 1), 120);
  v_limit   integer := least(greatest(coalesce(p_limit, 5), 1), 50);
  v_cutoff  date;
  v_deals   jsonb;
  v_total   integer;
  v_all     integer;
  v_lat     double precision;
  v_lng     double precision;
  v_center  text := null;
  v_city    text;
  v_nearby  jsonb := null;
  v_po      record;
  v_layer   jsonb := null;
  v_in_layer boolean := false;
begin
  if p_agent_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select m.tier into v_tier
    from public.agency_members m
   where m.id = p_agent_id and m.active = true and m.billing_status = 'active';

  if v_tier is distinct from 'premium' then
    return jsonb_build_object(
      'error',         'tier_required',
      'required_tier', 'premium',
      'detail',        'שאילתת עסקאות היסטוריות זמינה במסלול Elite.');
  end if;

  if v_gush is null then
    return jsonb_build_object('error', 'gush_required', 'detail', 'צריך מספר גוש.');
  end if;

  v_cutoff := (current_date - (v_months || ' months')::interval)::date;

  -- 1. בחלקה עצמה (או בגוש כולו)
  with pool as (
    select o.city, o.street, o.house_number, o.gush, o.helka,
           o.property_type, o.rooms, o.floor, o.size_sqm, o.sale_price, o.sold_at,
           case when o.size_sqm > 0 then round(o.sale_price / o.size_sqm) end as price_per_sqm
      from public.market_deals_official o
     where public.land_parcel_num(o.gush) = v_gush
       and (v_helka is null or public.land_parcel_num(o.helka) = v_helka)
       and o.sold_at >= v_cutoff
  )
  select coalesce(jsonb_agg((to_jsonb(d) - 'rn' - 'total') order by d.rn), '[]'::jsonb),
         max(d.total)
    into v_deals, v_total
    from (select p.*, row_number() over (order by p.sold_at desc) as rn,
                 count(*) over () as total
            from pool p) d
   where d.rn <= v_limit;

  select count(*) into v_all
    from public.market_deals_official o
   where public.land_parcel_num(o.gush) = v_gush
     and (v_helka is null or public.land_parcel_num(o.helka) = v_helka);

  -- 2. המרכז. קודם שכבת החלקות של מפ"י (‏parcels_open): היא יודעת איפה
  -- החלקה גם כשלא נמכר בה כלום - וזה בדיוק המקרה שבו המיקום חסר.
  if v_helka is not null then
    select po.lat, po.lng, po.legal_area, po.status_text, po.locality_name
      into v_po
      from public.parcels_open po
     where po.gush = v_gush and po.helka = v_helka and po.gush_suffix = 0;
    if found then
      v_in_layer := true;
      v_layer := jsonb_build_object(
        'legal_area', v_po.legal_area,
        'status',     v_po.status_text,
        'locality',   v_po.locality_name);
      if v_po.lat is not null and v_po.lng is not null then
        v_lat := v_po.lat; v_lng := v_po.lng; v_center := 'parcel_layer';
      end if;
    end if;
  else
    select exists (select 1 from public.parcels_open po where po.gush = v_gush and po.gush_suffix = 0)
      into v_in_layer;
  end if;

  -- ואחריה מיקום העסקאות בחלקה
  if v_lat is null and v_helka is not null then
    select avg(o.lat), avg(o.lng) into v_lat, v_lng
      from public.market_deals_official o
     where public.land_parcel_num(o.gush) = v_gush
       and public.land_parcel_num(o.helka) = v_helka
       and o.lat is not null and o.lng is not null;
    if v_lat is not null then v_center := 'parcel'; end if;
  end if;

  -- ובגוש: העסקאות, ואם אין - מרכז החלקות שלו בשכבה
  if v_lat is null then
    select avg(o.lat), avg(o.lng) into v_lat, v_lng
      from public.market_deals_official o
     where public.land_parcel_num(o.gush) = v_gush
       and o.lat is not null and o.lng is not null;
    if v_lat is not null then v_center := 'gush'; end if;
  end if;
  if v_lat is null then
    select avg(po.lat), avg(po.lng) into v_lat, v_lng
      from public.parcels_open po
     where po.gush = v_gush and po.gush_suffix = 0
       and po.lat is not null and po.lng is not null;
    if v_lat is not null then v_center := 'gush_layer'; end if;
  end if;

  -- העיר: הנפוצה בעסקאות בגוש (כך היא כתובה במאגר, והרדיוס מסנן לפיה),
  -- ואם אין עסקאות בגוש - היישוב משכבת החלקות.
  select o.city into v_city
    from public.market_deals_official o
   where public.land_parcel_num(o.gush) = v_gush and o.city is not null
   group by o.city order by count(*) desc limit 1;

  if v_city is null then
    select po.locality_name into v_city
      from public.parcels_open po
     where po.gush = v_gush and po.gush_suffix = 0 and po.locality_name is not null
     group by po.locality_name order by count(*) desc limit 1;
  end if;

  -- 3. ברדיוס סביב המרכז - דרך הפונקציה הקיימת, לא עותק שלה.
  if v_lat is not null and v_city is not null then
    v_nearby := public.agent_market_deals_lookup(
      p_agent_id, v_city, v_lat, v_lng, null, null, p_radius_m, v_months, v_limit, null);
  end if;

  return jsonb_build_object(
    'ok',               true,
    'mode',             case when v_helka is null then 'gush' else 'parcel' end,
    'gush',             v_gush,
    'helka',            v_helka,
    'city',             v_city,
    'months',           v_months,
    'oldest_considered', v_cutoff,
    'in_parcel',        coalesce(v_deals, '[]'::jsonb),
    'in_parcel_total',  coalesce(v_total, 0),
    'in_parcel_all_time', v_all,
    'center',           case when v_lat is null then null
                             else jsonb_build_object('lat', v_lat, 'lng', v_lng, 'from', v_center) end,
    -- החלקה בשכבה של מפ"י: שטח רשום (= המגרש), סטטוס ויישוב. null = לא קיימת
    'parcel_layer',     v_layer,
    'in_parcel_layer',  v_in_layer,
    'nearby',           v_nearby,
    'source',           'רשות המיסים - מאגר עסקאות מקרקעין');
end $$;

comment on function public.agent_market_deals_by_parcel(uuid, text, text, integer, integer, integer) is
  'עסקאות לפי גוש/חלקה: בחלקה עצמה, ומסביב למרכז שלה (parcels_open קודם, ואז העסקאות). מחזירה גם את החלקה בשכבה (parcel_layer). Elite בלבד. 20271105090000.';

revoke all on function public.agent_market_deals_by_parcel(uuid, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.agent_market_deals_by_parcel(uuid, text, text, integer, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. ‏cma_house_context - המגרש, לבית בלבד
--
-- רץ על p_r **לפני** cma_report_finish, כלומר על כל ה-comparables ולא על 8
-- המוצגים. החציון מושתק מתחת ל-cma_min_comparables, כמו כל מספר בדוח.
-- ---------------------------------------------------------------------------
create or replace function public.cma_house_context(
  p_r            jsonb,
  p_subject_plot numeric,
  p_plot_source  text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_min     integer;
  v_inf     integer;
  v_n       integer;
  v_median  numeric;
begin
  if p_r is null or p_r ? 'error'
     or (p_r->'data_coverage'->>'subject_kind') is distinct from 'house' then
    return p_r;
  end if;

  select coalesce(max(value) filter (where key = 'cma_min_comparables'), 5)
    into v_min from public.pricing_config;

  select count(*) filter (where c->>'kind' = 'house_parcel'),
         count(*) filter (where nullif(c->>'plot_sqm', '') is not null),
         percentile_cont(0.5) within group (order by nullif(c->>'plot_sqm', '')::numeric)
    into v_inf, v_n, v_median
    from jsonb_array_elements(coalesce(p_r->'comparables', '[]'::jsonb)) c
   where (c->>'in_stats')::boolean;

  return jsonb_set(p_r, '{data_coverage}', (p_r->'data_coverage') || jsonb_build_object(
      'houses_by_parcel', coalesce(v_inf, 0)))
    || jsonb_build_object('house_plots', jsonb_build_object(
      'subject_plot_sqm', nullif(p_subject_plot, 0),
      'subject_plot_source', case when nullif(p_subject_plot, 0) is not null then p_plot_source end,
      'comparables_with_plot', coalesce(v_n, 0),
      'min_required', v_min,
      'median_plot_sqm', case when v_n >= v_min then round(v_median) end));
end;
$$;

comment on function public.cma_house_context(jsonb, numeric, text) is
  'לדוח CMA של בית: כמה מהבתים שנספרו זוהו לפי החלקה (houses_by_parcel), ושטח המגרש של הנכס מול חציון המגרשים שלהם (מושתק מתחת לסף). על כל ה-comparables, לפני cma_report_finish. 20271105090000.';

revoke all on function public.cma_house_context(jsonb, numeric, text) from public, anon, authenticated;
grant execute on function public.cma_house_context(jsonb, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4א. ‏agent_cma_report_full - עם המגרש לבית
-- ---------------------------------------------------------------------------
create or replace function public.agent_cma_report_full(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_r     jsonb;
  v_gush  text;
  v_helka text;
  v_plot  numeric;
begin
  v_r := public.agent_cma_report(p_agent_id, p_property_id);

  -- שגיאה (מסלול, נכס לא נמצא, שכירות) חוזרת כמו שהיא.
  if v_r ? 'error' then
    return v_r;
  end if;

  select i.gush, i.helka
    into v_gush, v_helka
    from public.property_planning_info i
   where i.property_id = p_property_id;

  -- המגרש של בית: השטח הרשום של החלקה שלו
  if (v_r->'data_coverage'->>'subject_kind') = 'house' and v_gush is not null and v_helka is not null then
    select po.legal_area into v_plot
      from public.parcels_open po
     where po.gush = public.land_parcel_num(v_gush)
       and po.helka = public.land_parcel_num(v_helka)
       and po.gush_suffix = 0;
  end if;

  v_r := public.cma_house_context(v_r, v_plot, 'parcel');
  return public.cma_report_finish(v_r, v_gush, v_helka);
end;
$$;

revoke all on function public.agent_cma_report_full(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report_full(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4ב. ‏agent_cma_report_address - גם לפי גוש/חלקה, וגודל מגרש
--
-- שלושה פרמטרים חדשים בסוף, ולכן drop: עם ברירות מחדל, שתי הגרסאות היו
-- מתאימות לאותה קריאה של 12 ארגומנטים ("function is not unique").
-- ‏`cma_report_address` (ה-CRM) קוראת ב-12 ארגומנטים ומגיעה לגרסה החדשה.
-- ---------------------------------------------------------------------------
drop function if exists public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision);

create or replace function public.agent_cma_report_address(
  p_agent_id      uuid,
  p_city          text,
  p_street        text,
  p_house_number  text,
  p_property_type text    default 'דירה',
  p_rooms         numeric default null,
  p_size_sqm      numeric default null,
  p_floor         integer default null,
  p_price         numeric default null,
  p_features      text[]  default null,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_gush          text    default null,
  p_helka         text    default null,
  p_plot_sqm      numeric default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_tier      text;
  v_city      text := nullif(btrim(coalesce(p_city, '')), '');
  v_street    text := nullif(btrim(coalesce(p_street, '')), '');
  v_num       text := nullif(btrim(coalesce(p_house_number, '')), '');
  v_type      text := coalesce(nullif(btrim(coalesce(p_property_type, '')), ''), 'דירה');
  v_gush      integer := public.land_parcel_num(p_gush);
  v_helka     integer := public.land_parcel_num(p_helka);
  v_lat       double precision := p_lat;
  v_lng       double precision := p_lng;
  v_precision text := case when p_lat is not null and p_lng is not null then 'geocoded' end;
  v_loc       jsonb;
  v_parcel    jsonb;
  v_po        record;
  v_in_layer  boolean := false;
  v_plot      numeric := nullif(p_plot_sqm, 0);
  v_plot_src  text := case when nullif(p_plot_sqm, 0) is not null then 'agent' end;
  v_address   text;
  v_prop      public.properties;
  v_r         jsonb;
begin
  if p_agent_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  -- אותו גייט של agent_market_deals_lookup: Elite, פעיל, ומנוי בתוקף
  select m.tier into v_tier
    from public.agency_members m
   where m.id = p_agent_id and m.active = true and m.billing_status = 'active';

  if v_tier is distinct from 'premium' then
    return jsonb_build_object(
      'error',         'tier_required',
      'required_tier', 'premium',
      'detail',        'דוח CMA לכל כתובת, גם לנכס שאינו במערכת, זמין במסלול Elite.');
  end if;

  if public.property_type_class(v_type) is null then
    return jsonb_build_object('error', 'unknown_property_type',
      'detail', 'סוג הנכס "' || v_type || '" אינו מוכר לדוח. אפשר: דירה, דירת גן, פנטהאוז, בית פרטי, דו משפחתי, חנות, משרד, מגרש.');
  end if;

  -- גוש/חלקה: החלקה בשכבה של מפ"י נותנת מיקום, יישוב ושטח מגרש - גם כשלא
  -- נמכר בה כלום (20271105090000)
  if v_gush is not null and v_helka is not null then
    select po.lat, po.lng, po.legal_area, po.locality_name
      into v_po
      from public.parcels_open po
     where po.gush = v_gush and po.helka = v_helka and po.gush_suffix = 0;
    v_in_layer := found;
    if not v_in_layer and v_street is null then
      return jsonb_build_object('error', 'parcel_not_found',
        'detail', 'גוש ' || v_gush || ' חלקה ' || v_helka || ' אינם בשכבת החלקות של המרכז למיפוי ישראל. '
                  || 'כדאי לבדוק את המספרים מול הנסח - ספרות שהתחלפו הן הטעות הנפוצה.');
    end if;
    v_parcel := jsonb_build_object('gush', v_gush::text, 'helka', v_helka::text);
    if v_in_layer then
      v_city := coalesce(v_city, v_po.locality_name);
      if v_plot is null and v_po.legal_area > 0 then
        v_plot := v_po.legal_area; v_plot_src := 'parcel';
      end if;
      if (v_lat is null or v_lng is null) and v_po.lat is not null and v_po.lng is not null then
        v_lat := v_po.lat; v_lng := v_po.lng; v_precision := 'parcel';
      end if;
    end if;
  elsif v_city is null or v_street is null then
    return jsonb_build_object('error', 'address_required',
      'detail', 'צריך עיר ורחוב (ועדיף מספר בית), או גוש וחלקה, כדי להפיק דוח לכתובת.');
  end if;

  -- מיקום: מה שהקורא כבר מצא (גאוקוד), ואם אין - מהמסד
  if (v_lat is null or v_lng is null) and v_city is not null and v_street is not null then
    v_loc := public.cma_locate_address(v_city, v_street, v_num);
    v_lat := (v_loc->>'lat')::double precision;
    v_lng := (v_loc->>'lng')::double precision;
    v_precision := v_loc->>'precision';
  end if;

  -- הבניין: גוש/חלקה שנמסרו, ואם לא - מעסקאות שנרשמו בכתובת
  if v_parcel is null and v_num is not null and v_street is not null then
    v_parcel := public.address_parcel_from_deals(v_city, v_street, v_num);
  end if;

  -- מגרש של בית בכתובת: השטח הרשום של החלקה שלו
  if v_plot is null and v_parcel is not null and public.property_kind(v_type) = 'house' then
    select po.legal_area into v_plot
      from public.parcels_open po
     where po.gush = public.land_parcel_num(v_parcel->>'gush')
       and po.helka = public.land_parcel_num(v_parcel->>'helka')
       and po.gush_suffix = 0
       and po.legal_area > 0;
    if v_plot is not null then v_plot_src := 'parcel'; end if;
  end if;

  v_address := coalesce(btrim(v_street || ' ' || coalesce(v_num, '')),
                        'גוש ' || v_gush || ' חלקה ' || v_helka);

  -- הנכס בזיכרון. בלי id: הליבה מטפלת ב-null (is distinct from), ושום
  -- שורה לא נכתבת. ‏deal_type תמיד sale - המאגר הוא מאגר מכר.
  v_prop := jsonb_populate_record(null::public.properties, jsonb_build_object(
    'agent_id',      p_agent_id,
    'title',         v_type || ', ' || v_address,
    'city',          v_city,
    'street',        v_street,
    'house_number',  v_num,
    'address',       v_address,
    'property_type', v_type,
    'deal_type',     'sale',
    'price',         nullif(p_price, 0),
    'rooms',         nullif(p_rooms, 0),
    'size_sqm',      nullif(p_size_sqm, 0),
    'floor',         p_floor,
    'features',      to_jsonb(coalesce(p_features, '{}'::text[])),
    'lat',           v_lat,
    'lng',           v_lng
  ));

  v_r := public.cma_report_core(p_agent_id, v_prop);
  v_r := public.cma_house_context(v_r, v_plot, v_plot_src);
  v_r := public.cma_report_finish(v_r, v_parcel->>'gush', v_parcel->>'helka');

  -- הדוח אומר שהוא דוח לכתובת, ועד כמה המיקום מדויק
  return jsonb_set(
    jsonb_set(v_r, '{subject}', (v_r->'subject') || jsonb_build_object(
      'source',            'address',
      'street',            v_street,
      'house_number',      v_num,
      'floor',             p_floor,
      'gush',              v_parcel->>'gush',
      'helka',             v_parcel->>'helka',
      'plot_sqm',          case when public.property_kind(v_type) = 'house' then v_plot end,
      'location_precision', v_precision,
      'nearest_house_number', v_loc->>'nearest_house_number')),
    '{data_coverage}', (v_r->'data_coverage') || jsonb_build_object(
      'location_precision', v_precision));
end;
$$;

comment on function public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision, text, text, numeric) is
  'דוח CMA לכתובת או לגוש/חלקה, גם לנכס שאינו במערכת. Elite בלבד (tier_required). מיקום, יישוב ושטח מגרש מ-parcels_open כשנמסרו גוש וחלקה. אותה ליבה ואותו סיום כמו agent_cma_report_full. docs/cma.md';

revoke all on function public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision, text, text, numeric) from public, anon, authenticated;
grant execute on function public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision, text, text, numeric) to service_role;

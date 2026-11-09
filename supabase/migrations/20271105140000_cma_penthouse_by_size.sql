-- ============================================================================
-- פנטהאוז בדוח ה-CMA: הקומה העליונה **וגם** גדולה מהשאר בבניין
--
-- ## מה היה
--
-- במאגר הרשמי אין "פנטהאוז" - הכול "דירה". ‏cma_deal_pool (20270226090000)
-- קירב: הדירה בקומה העליונה שנמכרה באותו גוש+חלקה, בבניין של 3 קומות ומעלה.
-- נמדד בעפולה (5.11.2026, שנתיים): זה תופס בעיקר דירות רגילות בקומה העליונה
-- של בניינים ישנים - 358 עסקאות, חציון 110 מ"ר, 1.24 מיליון ₪, ומחיר למ"ר
-- **נמוך** מהדירות האחרות. ארבעת הפנטהאוזים הפעילים באתר (150-178 מ"ר,
-- 2.2-2.5 מיליון) הושוו אליהן, ויצאו יקרים פי שניים מ"השוק".
--
-- ## מה כאן
--
-- עסקה רשמית היא פנטהאוז (‏kind = 'roof') כשהיא בקומה העליונה שנמכרה בבניין,
-- בבניין של 3 קומות ומעלה, **ושטחה לפחות פי 1.25 מהחציון של העסקאות בבניין**
-- (מתוך 3 עסקאות עם שטח לפחות). בעפולה: 27 עסקאות, חציון 153 מ"ר, 2.18
-- מיליון, 5.2 חדרים - כמו הפנטהאוזים באתר. "גג" מפורש בקומה - כמו קודם.
-- עסקת פלטפורמה (נכס מקושר, בלי גוש/חלקה) - כמו קודם.
--
-- מה שנשאר פחות מדי: פנטהאוז שאין לו די כאלה עד 2,000 מ' חוזר לדירות רגילות,
-- והדוח אומר זאת (‏kindFallback, ‏comparability_guidance) - בלי שינוי.
-- דירת גן נשארת "קומת קרקע": דרישת גודל השאירה 4 עסקאות בשנתיים בעפולה.
--
-- ‏`tops` עדיין פעם אחת לבניין ורק לפנטהאוז (הסקיל cma-report, סעיף 6).
-- אותו טיפוס החזרה, ולכן create or replace.
-- ============================================================================

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
  'פנטהאוז לעסקה רשמית: הקומה העליונה וגדולה פי 1.25 מהחציון בבניין (20271105140000). בני ההשוואה לדוח CMA: איחוד market_deals ו-market_deals_official ברדיוס ובחלון הזמן, עם מרחק, התאמת מחלקה, הפרש חדרים, קבוצת קומה (מסחרי, גן/גג) ותת-סוג. לבית: עסקת "דירה" בלי קומה שהיא היחידה בחלקה שלה (עד 1,500 מ"ר) נחשבת לבית (kind = house_parcel, plot_sqm מ-parcels_open). 20271105090000.';

revoke all on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) to service_role;


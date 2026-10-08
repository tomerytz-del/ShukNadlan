-- ============================================================================
-- ‏cma_deal_pool: כל פונקציה פעם אחת לכל עסקה, ורק כשהנכס צריך אותה
--
-- ## מה נמדד
--
-- אחרי 20270226090000 הבריכה עלתה מכ-270ms לכ-880ms (עפולה, רדיוס 4,500 מ',
-- ‏1,185 עסקאות; EXPLAIN ANALYZE על הפרודקשן, 5.10.2026), והיא נקראת פעמיים
-- בכל דוח: דירה 1.2 שניות, בית 3.4. הסינון לפי מרחק עצמו לוקח 158ms. השאר
-- הוא קריאות לפונקציות העזר - כ-12 לכל עסקה, וכל אחת כ-47 מיקרו-שניות:
--
--   - ‏`property_type_class(p_subject_type)` ו-`property_kind(p_subject_type)`
--     חושבו **מחדש לכל עסקה**, למרות שהם תלויים רק בנכס.
--   - ‏`property_kind(d.property_type)` נקרא עד ארבע פעמים לאותה שורה.
--   - ‏`floor_group` ותת-הסוג חושבו לכל נכס, ונדרשים רק לנכס מסחרי (קומה)
--     ולדירת גן / פנטהאוז (תת-סוג).
--
-- פונקציות SQL עם `set search_path` אינן מוטמעות (inlined) בתוכנית, ולכן כל
-- קריאה היא קריאת פונקציה של ממש. את `set search_path` לא מורידים - זו
-- ההגנה של כל הפונקציות בריפו - אלא מצמצמים את מספר הקריאות.
--
-- ## מה כאן
--
-- ‏`floor_num` נכתבת מחדש (ראו למטה), ו-`cma_deal_pool` -
-- אותה פונקציה, אותה חתימה ואותו טיפוס החזרה (ולכן `create or replace`),
-- ואותן תוצאות בדיוק בכל עמודה שהדוח קורא:
--
--   - ‏`s` - המחלקה ותת-הסוג של הנכס, פעם אחת לבריכה.
--   - ‏`f` - המחלקה של העסקה פעם אחת; תת-הסוג שלה רק כשהנכס מגורים (בית
--     מול דירה); ‏`floor_group` רק כשהנכס מסחרי או גן/גג.
--   - ‏`kind` מחושב רק לנכס גן/גג - הנכסים היחידים שהסולם שלהם קורא אותו.
--     לשאר הוא `null`, וכך גם היה בפועל: הסולם לא נגע בו.
--   - הקומה העליונה בבניין - פעם אחת **לבניין** (‏`tops`), ורק לפנטהאוז. עד
--     כאן היא נשאלה לכל עסקה מחדש, על כל הבניין שלה: בחלקה של 640 עסקאות
--     (‏16547/5 בנוף הגליל) זה מאות אלפי חישובי קומה לדוח אחד. עוד לא קרה
--     רק כי אין היום פנטהאוז פעיל עם מיקום.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ‏floor_num: regex אחד במקום ארבעים
--
-- ‏20270226090000 הריצה ביטוי נפרד לכל מילה (40 ביטויים לכל קריאה) - כ-0.57
-- מילי-שנייה לעסקה, 682ms ל-1,200 עסקאות. כאן ביטוי אחד מחלץ את המילים
-- והמיפוי הוא השוואת מחרוזות: 115ms לאותן 1,200. **אותה תוצאה בדיוק** על
-- כל 281 ערכי הקומה השונים שבמאגר (נבדק בפרודקשן, 5.10.2026).
-- ---------------------------------------------------------------------------
create or replace function public.floor_num(p_floor text)
returns integer
language sql
immutable
set search_path to ''
as $$
  select max(v)
    from (
      -- ספרות: "קומה 3", "-1", "קרקע+1+2+3"
      select (m[1])::integer as v
        from regexp_matches(coalesce(p_floor, ''), '(-?[0-9]{1,2})(?![0-9])', 'g') m
      union all
      -- מילים: regex **אחד** שמחלץ את כל המילים, והמיפוי בהשוואת מחרוזות.
      -- הגרסה הקודמת הריצה 40 ביטויים נפרדים לכל קריאה - כחצי מילי-שנייה
      -- לעסקה, כלומר כ-0.7 שנייה לבריכה של 1,200 עסקאות (20270302090000).
      select case
               when t ~ '^(עשרים|שלושים|ארבעים)' then
                 (case when t like 'עשרים%' then 20 when t like 'שלושים%' then 30 else 40 end)
                 + coalesce((case substring(t from '^(?:עשרים|שלושים|ארבעים)ו(.*)$')
                               when 'אחת' then 1 when 'אחד' then 1 when 'שתיים' then 2 when 'שתים' then 2
                               when 'שלוש' then 3 when 'ארבע' then 4 when 'חמש' then 5 when 'שש' then 6
                               when 'שבע' then 7 when 'שמונה' then 8 when 'תשע' then 9 end), 0)
               when t like '%עשרה' then
                 10 + (case left(t, length(t) - 4)
                         when 'אחת' then 1 when 'אחד' then 1 when 'שתים' then 2 when 'שלוש' then 3
                         when 'ארבע' then 4 when 'חמש' then 5 when 'שש' then 6 when 'שבע' then 7
                         when 'שמונה' then 8 when 'תשע' then 9 end)
               else case t
                      when 'קרקע' then 0 when 'מרתף' then -1
                      when 'ראשונה' then 1 when 'ראשנה' then 1
                      when 'שניה' then 2 when 'שנייה' then 2 when 'שניייה' then 2
                      when 'שלישית' then 3 when 'שלשית' then 3
                      when 'רביעית' then 4 when 'רביעת' then 4
                      when 'חמישית' then 5 when 'חמשית' then 5 when 'חמישי' then 5
                      when 'שישית' then 6 when 'ששית' then 6
                      when 'שביעית' then 7 when 'שמינית' then 8 when 'תשיעית' then 9
                      when 'עשירית' then 10
                    end
             end as v
        from regexp_matches(coalesce(p_floor, ''),
               '((?:עשרים|שלושים|ארבעים)(?: ו(?:אחת|אחד|שתיים|שתים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע))?'
               || '|(?:אחת|אחד|שתים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע)[ -]?עשרה'
               || '|ראשונה|ראשנה|שניייה|שנייה|שניה|שלישית|שלשית|רביעית|רביעת|חמישית|חמשית|חמישי'
               || '|שישית|ששית|שביעית|שמינית|תשיעית|עשירית|קרקע|מרתף)', 'g') w,
             lateral (select regexp_replace(w[1], '[ -]', '', 'g') as t) n
    ) x;
$$;

comment on function public.floor_num(text) is
  'הקומה הגבוהה ביותר שמוזכרת בטקסט קומה חופשי (רשות המיסים) או במספר. קרקע = 0, מרתף = -1, null כשאין. משמשת לזיהוי הקומה העליונה בבניין (property_kind).';

revoke all on function public.floor_num(text) from public, anon;
grant execute on function public.floor_num(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ‏cma_deal_pool
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
  kind            text
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
    -- הקומה העליונה שנמכרה בכל בניין (גוש+חלקה) שיש לו עסקה בבריכה - פעם
    -- אחת **לבניין**, ורק לפנטהאוז. שאילתה לכל עסקה הייתה עוברת על כל
    -- הבניין שלה שוב ושוב: בחלקה של 640 עסקאות זה 400 אלף חישובי קומה.
    select o2.gush, o2.helka, max(public.floor_num(o2.floor)) as top_floor
      from public.market_deals_official o2
     where (select s.s_kind from s) = 'roof'
       and (o2.gush, o2.helka) in (select d.gush, d.helka from d
                                    where d.gush is not null and d.helka is not null)
     group by o2.gush, o2.helka
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
                       or (f.dk = 'house') = (s.s_kind = 'house')), false) as same_type,
         abs(nullif(d.rooms, 0) - nullif(p_subject_rooms, 0)) as rooms_diff,
         case when d.size_sqm > 0 then round(d.sale_price / d.size_sqm) end as price_per_sqm,
         round(public.geo_distance_meters(p_lat, p_lng, d.lat, d.lng))::numeric as distance_meters,
         f.fg as floor_group,
         -- תת-הסוג, רק לנכס גן/גג. לעסקה "דירה" - בקירוב מהקומה.
         case
           when s.s_kind is null or s.s_kind not in ('garden', 'roof') then null
           when f.dk is distinct from 'unit' then f.dk
           when d.floor ~ 'גג' then 'roof'
           when coalesce(d.top_floor, t.top_floor) >= 3
            and public.floor_num(d.floor) = coalesce(d.top_floor, t.top_floor) then 'roof'
           when f.fg = 'ground' then 'garden'
           else 'unit'
         end as kind
    from d
    cross join s
    -- העסקה: כל פונקציה פעם אחת, ורק כשהנכס צריך אותה
    cross join lateral (
      select public.property_type_class(d.property_type) as cls,
             case when s.s_cls = 'dwelling'
                  then public.property_kind(d.property_type) end as dk,
             case when s.s_cls = 'commercial' or s.s_kind in ('garden', 'roof')
                  then public.floor_group(d.floor) end as fg
    ) f
    left join tops t on t.gush = d.gush and t.helka = d.helka;
$$;

comment on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) is
  'בני ההשוואה לדוח CMA: איחוד market_deals ו-market_deals_official ברדיוס ובחלון הזמן, עם מרחק, התאמת מחלקה, הפרש חדרים, קבוצת קומה (לנכס מסחרי ולגן/גג) ותת-סוג (לגן/גג). כל פונקציית עזר נקראת פעם אחת לעסקה, ורק כשהנכס צריך אותה (20270302090000).';

revoke all on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) to service_role;

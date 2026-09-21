-- ============================================================================
-- ‏1,512 עסקאות נכנסו, והדוח עדיין ריק. שתי סיבות, ואף אחת מהן אינה הרדיוס
--
-- ההזנה הידנית הראשונה של עפולה עברה: 1,512 עסקאות, כולן בחלון 24 החודשים.
-- והדוח ממשיך לומר "עסקאות שנמצאו בסביבה: 0". נמדד:
--
--   סה"כ                                     1,512
--   עם lat/lng                                   0
--   עם רחוב ומספר בית (ניתנות לגאוקוד)       1,046
--   בלי כתובת ("אין מידע")                     466
--   ניסיונות גאוקוד שנעשו                        0
--
-- **חיפוש הרדיוס מסנן `d.lat is not null`.** אפס פינים פירושו אפס בני
-- השוואה בכל רדיוס שהוא, ולכן הגדלת הרדיוס לא הייתה עוזרת כלל - היא
-- הייתה רק מרחיבה חיפוש בקבוצה ריקה.
--
-- ## סיבה 1: קצב הגאוקוד, ו-42 השעות
--
-- ‏`geocode-backfill` רץ **פעם בשעה** (`41 * * * *`) עם אצווה של 25.
-- ‏1,046 עסקאות בקצב הזה הן **כ-42 שעות**, ורק אז הדוח מתחיל לעבוד.
--
-- הקצב הזה נקבע כשהתור היה נכסים בלבד - עשרות בודדות שנכנסות בזרם דקיק,
-- שבהן סבב בשעה הוא יותר מדי ולא פחות מדי. הזנה ידנית של עיר שלמה היא
-- דפוס אחר לגמרי: אלף שורות בבת אחת, ואז שקט עד הרבעון הבא.
--
-- **התזמון עובר ל-`*/5`, והאצווה נשארת 25.** שתי החלטות נפרדות:
--
-- * **תדירות ולא גודל אצווה.** ‏`DEADLINE_MS` בשרת הוא 20 שניות (מתחת
--   ל-30 של ה-cron), וכל כתובת עולה עד שמונה שאילתות `streetVariants`.
--   האצווה ממילא אינה מסתיימת בתוך התקציב, ולכן הגדלתה אינה מוסיפה דבר -
--   היא רק מגדילה את מה שנחתך.
-- * **וזה אינו עומס.** לכל ה-cron בפרויקט יש תנאי דליקה, וכאן הוא
--   `geocode_backfill_pending()`: כשהתור ריק ה-`http_post` אינו נשלח
--   כלל. סבב כל חמש דקות עולה **אפס** בכל יום שבו אין מה לעשות, וזה
--   רוב הימים.
--
-- הקצב החדש: כ-300 לשעה, כלומר 1,046 בכ-**3.5 שעות** במקום 42.
--
-- > **‏466 העסקאות בלי כתובת לא ייפתרו כך לעולם.** ‏GovMap מחזיר "אין
-- > מידע" ככתובת, ולשורות האלה יש גוש וחלקה בלבד. הנתיב הקדסטרי
-- > (`gushHelkaToParcel`) קיים ב-`afula-planning.ts` ואינו מחובר לתור
-- > הזה. זה זרם נפרד, והוא מתועד ב-docs/geocoding.md.
--
-- ## סיבה 2: רשימת עסקאות העיר חזרה בלי תקרה
--
-- ‏`city_comparables` היא הרשימה של עסקאות באותה עיר שאי אפשר למקם.
-- היא נועדה להיות הערת שוליים כנה - "יש עוד, ואי אפשר למדוד מהן מרחק" -
-- ולא הייתה לה **שום הגבלה**.
--
-- כל עוד המאגר היה ריק זה היה `[]`. עכשיו זה **1,512 אובייקטים בכל
-- קריאה לדוח**: מטען שמנפח כל בקשה, וקיר טקסט שאיש לא יקרא. והוא גם
-- מסתיר את מה שכן מעניין באותו מסך.
--
-- מוחזרות 12 האחרונות (`cma_city_comparables_limit`), והמספר המלא מדווח
-- ב-`data_coverage.city_comparables_total`. **דוח שחותך רשימה חייב לומר
-- שחתך**, כמו `excluded_other_type` שלידו.
-- ============================================================================

-- התזמון מחדש. ‏unschedule לפני schedule כי cron.schedule על שם קיים
-- מעדכן, אבל ההסרה המפורשת הופכת את המיגרציה לקריאה: מה שהיה, ומה שיש.
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/geocode-backfill';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('geocode-backfill')
    where exists (select 1 from cron.job where jobname = 'geocode-backfill');

  perform cron.schedule('geocode-backfill', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where public.geocode_backfill_pending()
  $cron$, v_url));
end $$;

-- התקרה כשורת תצורה ולא כקבוע בקוד, כמו שלושת הסף שלידה.
insert into public.pricing_config (key, value)
values ('cma_city_comparables_limit', 12)
on conflict (key) do nothing;

create or replace function public.agent_cma_report(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent        record;
  v_prop         record;
  v_subject_size numeric;
  v_base_radius  numeric;
  v_min_comps    integer;
  v_max_age      integer;
  v_cutoff       date;
  v_radius       numeric;
  v_used_radius  numeric := null;
  v_comps        jsonb   := '[]'::jsonb;
  v_city_comps   jsonb   := '[]'::jsonb;
  v_n            integer := 0;   -- בני השוואה **מאותה מחלקה**
  v_n_all        integer := 0;   -- כל מה שנפל ברדיוס, לתצוגה בלבד
  v_city_n       integer := 0;   -- כמה עסקאות עיר שאי אפשר למקם קיימות
  v_city_limit   integer;        -- כמה מהן מוחזרות בפועל
  v_stats        jsonb;
  v_planning     jsonb;
  v_coverage     text;
  v_sources      jsonb;
  v_asking_n     integer := 0;
begin
  select m.id, m.tier, m.active
    into v_agent
    from public.agency_members m
   where m.id = p_agent_id;

  if not found or not v_agent.active then
    return jsonb_build_object('error', 'no_matching_agent_profile');
  end if;

  if v_agent.tier not in ('mid', 'premium') then
    return jsonb_build_object(
      'error',  'upgrade_required',
      'detail', 'דוח CMA זמין רק למנוי Mid/Premium',
      'cta',    'שדרג למנוי Mid או Premium כדי להפיק דוחות CMA'
    );
  end if;

  select p.* into v_prop
    from public.properties p
   where p.id = p_property_id
     and (p.agent_id = v_agent.id or p.status = 'active');

  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  -- שני המאגרים הם מאגרי מכר. השוואת שכ״ד חודשי מולם אינה "דוח עם מדגם
  -- קטן" אלא מספר חסר משמעות.
  if v_prop.deal_type = 'rent' then
    return jsonb_build_object(
      'error',  'rent_not_supported',
      'detail', 'דוח CMA מבוסס על עסקאות מכר בלבד. במאגר אין עסקאות שכירות להשוואה, ולכן לא ניתן להפיק דוח לנכס להשכרה.'
    );
  end if;

  v_subject_size := coalesce(v_prop.built_size_sqm, v_prop.size_sqm, v_prop.area_sqm);

  select coalesce(max(value) filter (where key = 'cma_default_radius_meters'), 500),
         coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_max_deal_age_months'), 24),
         coalesce(max(value) filter (where key = 'cma_city_comparables_limit'), 12)
    into v_base_radius, v_min_comps, v_max_age, v_city_limit
    from public.pricing_config;

  v_cutoff := (current_date - (v_max_age || ' months')::interval)::date;

  if v_prop.lat is not null and v_prop.lng is not null then
    foreach v_radius in array array[v_base_radius, v_base_radius*2, v_base_radius*3, v_base_radius*4, v_base_radius*6]
    loop
      select coalesce(jsonb_agg(c order by c.distance_meters), '[]'::jsonb),
             count(*) filter (where c.same_type),
             count(*)
        into v_comps, v_n, v_n_all
        from (
          select d.id,
                 d.source,
                 d.price_basis,
                 d.property_type,
                 d.rooms,
                 d.sale_price,
                 d.sold_at,
                 d.size_sqm,
                 coalesce(public.property_type_class(d.property_type)
                          = public.property_type_class(v_prop.property_type), false) as same_type,
                 case when d.size_sqm > 0 then round(d.sale_price / d.size_sqm) end as price_per_sqm,
                 round(public.geo_distance_meters(v_prop.lat, v_prop.lng, d.lat, d.lng)) as distance_meters
            from (
              -- עסקאות הפלטפורמה: המיקום והשטח יושבים על הנכס המקושר
              select md.id, md.source, md.price_basis, md.property_type, md.rooms,
                     md.sale_price, md.sold_at,
                     rp.lat, rp.lng,
                     coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) as size_sqm
                from public.market_deals md
                join public.properties rp on rp.id = md.related_property_id
               where md.related_property_id <> p_property_id

              union all

              -- עסקאות רשמיות: נושאות מיקום ושטח משל עצמן
              select o.id, o.source, 'official'::text, o.property_type, o.rooms,
                     o.sale_price, o.sold_at, o.lat, o.lng, o.size_sqm
                from public.market_deals_official o
            ) d
           where d.lat is not null and d.lng is not null
             and d.sold_at >= v_cutoff
             and public.geo_distance_meters(v_prop.lat, v_prop.lng, d.lat, d.lng) <= v_radius
        ) c;

      v_used_radius := v_radius;
      exit when v_n >= v_min_comps;
    end loop;
  end if;

  -- עסקאות באותה עיר שאי אפשר למקם — מוחזרות בנפרד, לא מעורבבות ברדיוס
  -- ולא נכנסות לסטטיסטיקה.
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
             'sqm_sample_size',      count(*) filter (where x->>'price_per_sqm' is not null),
             'same_type_count',      count(*) filter (where (x->>'same_type')::boolean),
             'asking_basis_count',   count(*) filter (where x->>'price_basis' = 'asking'),
             'official_basis_count', count(*) filter (where x->>'price_basis' = 'official')
           )
      into v_stats
      from jsonb_array_elements(v_comps) x
     where (x->>'same_type')::boolean;
  else
    v_stats := jsonb_build_object('comparables_count', v_n, 'sample_too_small', true);
  end if;

  select count(*) into v_asking_n
    from jsonb_array_elements(v_comps || v_city_comps) x
   where x->>'price_basis' = 'asking';

  select coalesce(jsonb_agg(jsonb_build_object(
           'source', s.source,
           'label',  case s.source
                       when 'platform_derived' then 'עסקאות שנסגרו דרך שוק נדל״ן'
                       when 'tax_authority'    then 'רשות המיסים — מאגר עסקאות מקרקעין'
                       else s.source end,
           'deals',  s.n) order by s.n desc), '[]'::jsonb)
    into v_sources
    from (
      select x->>'source' as source, count(*) as n
        from jsonb_array_elements(v_comps || v_city_comps) x
       group by 1
    ) s;

  select to_jsonb(i) - 'property_id' into v_planning
    from public.property_planning_info i where i.property_id = p_property_id;

  return jsonb_build_object(
    'generated_at', now(),
    'subject', jsonb_build_object(
      'id', v_prop.id, 'title', v_prop.title, 'address', v_prop.address,
      'city', v_prop.city, 'property_type', v_prop.property_type,
      'deal_type', v_prop.deal_type, 'price', v_prop.price, 'rooms', v_prop.rooms,
      'size_sqm', v_subject_size,
      'price_per_sqm', case when v_subject_size > 0 then round(v_prop.price / v_subject_size) end,
      'lat', v_prop.lat, 'lng', v_prop.lng
    ),
    'planning', v_planning,
    'radius_meters_used', v_used_radius,
    'radius_exhausted', (v_used_radius is not null and v_n < v_min_comps),
    'comparables', v_comps,
    'city_comparables', v_city_comps,
    'stats', v_stats,
    'data_coverage', jsonb_build_object(
      'status',             v_coverage,
      'comparables_found',  v_n,
      'comparables_in_radius', v_n_all,
      'excluded_other_type', greatest(v_n_all - v_n, 0),
      'min_required',       v_min_comps,
      'max_deal_age_months',v_max_age,
      'oldest_considered',  v_cutoff,
      'asking_basis_count', v_asking_n,
      'city_comparables_total', coalesce(v_city_n, 0),
      'city_comparables_shown', jsonb_array_length(v_city_comps),
      'has_statistics',     (v_coverage = 'ok')
    ),
    'sources', v_sources
  );
end;
$$;
comment on function public.agent_cma_report(uuid, uuid) is
  'דוח CMA לפי מזהה סוכן/ת מפורש. מאחד את עסקאות הפלטפורמה (market_deals) עם המאגר הרשמי (market_deals_official). הסטטיסטיקה מחושבת על מחלקת נכס תואמת בלבד (property_type_class), ורשימת עסקאות העיר חתוכה ל-cma_city_comparables_limit. סטטיסטיקה חוזרת רק כש-data_coverage.status=ok.';

revoke all on function public.agent_cma_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;

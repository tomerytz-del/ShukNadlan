-- ============================================================================
-- דוח CMA לכל כתובת - במסלול Elite, באתר ובגבריאלה
--
-- ## מה היה
--
-- הדוח קיבל **מזהה נכס** בלבד. סוכן/ת שביקש/ה מגבריאלה "דוח CMA לרוטשילד 1
-- בראשון לציון" על נכס שאינו אצלו/ה במערכת קיבל/ה "אפשר להפיק רק על נכס
-- שקיים אצלך", ובמקומו רשימת עסקאות לפי שם הרחוב - בלי ממוצע, בלי סולם
-- חדרים ובלי השוואה. וזה בדיוק הרגע שבו הדוח שווה הכי הרבה: לפני שהנכס
-- נלקח, מול בעלים שעוד מתלבטים.
--
-- ## מה כאן
--
-- 1. ‏`cma_report_core(p_agent_id, p_prop)` - **הגוף של `agent_cma_report`
--    כמו שהוא** (20270226090000), רק שהנכס נכנס כפרמטר (שורה מסוג
--    ‏`public.properties`) במקום להישלף לפי מזהה. ארבעה שינויים בלבד, וכולם
--    מכנית: ‏`p_property_id` → ‏`v_prop.id` (שלוש קריאות ושאילתת המידע
--    התכנוני), ‏`p.id <> p_property_id` → ‏`is distinct from` - לנכס בלי מזהה
--    ‏`<> null` היה מוחק את כל שכבת השוק בשקט - ו-`v_agent.id` → ‏`p_agent_id`.
-- 2. ‏`agent_cma_report` - הגייט, השליפה ובדיקת השכירות, ואז הליבה. התוצאה
--    זהה בייט-בייט לגרסה הקודמת.
-- 3. ‏`cma_report_finish(p_r, p_gush, p_helka)` - הגוף של
--    ‏`agent_cma_report_full` (20270227090000) אחרי הקריאה לדוח: בעלות, טווח
--    למ"ר, אחוזון ובחירת 8 העסקאות. הגוש והחלקה נכנסים כפרמטר במקום להישלף
--    מ-`property_planning_info`. ‏`agent_cma_report_full` היא עכשיו עטיפה.
-- 4. ‏`cma_locate_address` - מיקום לכתובת **מהמסד בלבד**, למקרה שהגאוקוד
--    בשרת אינו מכיר את העיר (ובשרת אסור GovMap - הסקיל `govmap`): עסקה
--    שנרשמה בכתובת עצמה, מרכז החלקה מ-`parcels_open`, ואז מספר הבית הקרוב
--    ביותר באותו רחוב. הדיוק חוזר (‏`location_precision`) והדוח אומר אותו.
-- 5. ‏`agent_cma_report_address` / ‏`cma_report_address` - הדוח לכתובת.
--    **Elite בלבד** (‏`tier_required`), כמו שאילתת העסקאות שהיא אחותה.
--    הנכס נבנה בזיכרון (‏`jsonb_populate_record`), עובר את אותה ליבה ואותו
--    סיום - כלומר אותו סולם, אותה השתקה מתחת לסף ואותם מספרים כמו בדוח על
--    נכס במערכת. לא נכתבת אף שורה.
--
-- ## ומה לא השתנה, בכוונה
--
-- ‏`agent_cma_report` עצמה נשארת ב-PROFESSIONAL וב-Elite, על נכס של הסוכן/ת
-- או על כל נכס פעיל באתר. נכס פעיל של משרד אחר היה זמין לדוח כבר קודם; מה
-- שחסר היה הדרך לבקש אותו מגבריאלה (‏agent.ts).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הליבה
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
                   coalesce(public.property_type_class(o.property_type)
                            = public.property_type_class(v_prop.property_type), false) as same_type,
                   coalesce(public.property_type_class(o.property_type)
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
       and coalesce(public.property_type_class(o.property_type)
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
         and coalesce(public.property_type_class(o.property_type)
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
      'lat', v_prop.lat, 'lng', v_prop.lng
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
  'הגוף של דוח ה-CMA: נכס נושא (שורת properties, גם כזו שנבנתה בזיכרון בלי id) → עסקאות, סולם, שכבות ו-stats. בלי גייט ובלי שליפה - אלה בעטיפות agent_cma_report ו-agent_cma_report_address. docs/cma.md';

revoke all on function public.cma_report_core(uuid, public.properties) from public, anon, authenticated;
grant execute on function public.cma_report_core(uuid, public.properties) to service_role;

-- ---------------------------------------------------------------------------
-- 2. ‏agent_cma_report - הגייט והשליפה, ואז הליבה
-- ---------------------------------------------------------------------------
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
  v_agent record;
  v_prop  public.properties;
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

  return public.cma_report_core(v_agent.id, v_prop);
end;
$$;

revoke all on function public.agent_cma_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. הסיום: בעלות, טווח, אחוזון ובחירת העסקאות להצגה
-- ---------------------------------------------------------------------------
create or replace function public.cma_report_finish(
  p_r     jsonb,
  p_gush  text,
  p_helka text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_r        jsonb;
  v_as_of    timestamptz;
  v_loaded   boolean;
  v_min      integer;
  v_listed   integer;
  v_subject  jsonb := null;
  v_counts   jsonb;
  v_split    jsonb := null;
  v_p_n      integer;
  v_s_n      integer;
  v_size     numeric;
  v_range    jsonb := null;
  v_of       integer;
  -- הבניין של הנכס. נכס במערכת - מהמידע התכנוני; כתובת - מעסקאות שנרשמו בה
  v_gush     text := nullif(btrim(p_gush), '');
  v_helka    text := nullif(btrim(p_helka), '');
  v_psm      numeric;  -- המחיר המבוקש למ"ר של הנכס
begin
  v_r := p_r;

  select coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_comparables_listed'), 8)
    into v_min, v_listed
    from public.pricing_config;

  -- ---- שכבת הבעלות (20270115091000, ללא שינוי) ----
  select l.source_modified into v_as_of
    from public.land_ownership_loads l
   where l.status = 'done'
   order by l.finished_at desc
   limit 1;
  -- ‏found ולא `v_as_of is null`: טעינה מ-source_url ידני מצליחה בלי תאריך.
  v_loaded := found;

  if v_loaded then
    select jsonb_build_object('ownership', o.ownership, 'mixed_units', o.mixed_units)
      into v_subject
      from public.land_ownership o
     where o.gush  = public.land_parcel_num(v_gush)
       and o.helka = public.land_parcel_num(v_helka);

    v_r := jsonb_set(v_r, '{comparables}',              public.cma_annotate_ownership(v_r->'comparables'));
    v_r := jsonb_set(v_r, '{neighborhood_comparables}', public.cma_annotate_ownership(v_r->'neighborhood_comparables'));
    v_r := jsonb_set(v_r, '{city_comparables}',         public.cma_annotate_ownership(v_r->'city_comparables'));

    -- על מה הממוצע נשען, לפי בעלות. רק עסקאות שנספרות ב-stats (‏in_stats),
    -- וכולן - **לפני** החיתוך למטה.
    select jsonb_build_object(
             'in_stats',  count(*),
             'private',   count(*) filter (where x->>'ownership' = 'P'),
             'state',     count(*) filter (where x->>'ownership' = 'S'),
             'local',     count(*) filter (where x->>'ownership' = 'L'),
             'other',     count(*) filter (where x->>'ownership' in ('M', 'O')),
             'unknown',   count(*) filter (where x->>'ownership' is null)),
           count(*) filter (where x->>'ownership' = 'P' and x->>'price_per_sqm' is not null),
           count(*) filter (where x->>'ownership' = 'S' and x->>'price_per_sqm' is not null)
      into v_counts, v_p_n, v_s_n
      from jsonb_array_elements(v_r->'comparables') x
     where (x->>'in_stats')::boolean;

    if v_p_n >= v_min and v_s_n >= v_min then
      select jsonb_build_object(
               'private_median_price_per_sqm', round(percentile_cont(0.5) within group (
                   order by (x->>'price_per_sqm')::numeric) filter (where x->>'ownership' = 'P')::numeric),
               'state_median_price_per_sqm',   round(percentile_cont(0.5) within group (
                   order by (x->>'price_per_sqm')::numeric) filter (where x->>'ownership' = 'S')::numeric),
               'private_sample', v_p_n,
               'state_sample',   v_s_n)
        into v_split
        from jsonb_array_elements(v_r->'comparables') x
       where (x->>'in_stats')::boolean
         and x->>'price_per_sqm' is not null;
    end if;
  end if;

  -- ---- 1. טווח השוק למ"ר ----
  --
  -- רק מעל הסף, כמו כל מספר אחר בדוח: רבעונים משלוש עסקאות הם רעש
  -- שנראה כמו טווח.
  if (v_r->'data_coverage'->>'has_statistics')::boolean then
    select case when count(*) >= v_min then jsonb_build_object(
             'p25_price_per_sqm',    round(percentile_cont(0.25) within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'median_price_per_sqm', round(percentile_cont(0.5)  within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'p75_price_per_sqm',    round(percentile_cont(0.75) within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'min_price_per_sqm',    min((x->>'price_per_sqm')::numeric),
             'max_price_per_sqm',    max((x->>'price_per_sqm')::numeric)) end
      into v_range
      from jsonb_array_elements(v_r->'comparables') x
     where (x->>'in_stats')::boolean
       and x->>'price_per_sqm' is not null;

    -- והאחוזון של הנכס בתוך הטווח: כמה מהעסקאות זולות ממנו למ"ר (שוויון
    -- נספר בחצי). זה המספר שהשעון בתצוגה מראה - "יקר מ-72% מהעסקאות
    -- הדומות" - ובאותו סף כמו הרבעונים.
    v_psm := nullif((v_r->'subject'->>'price_per_sqm')::numeric, 0);
    if v_range is not null and v_psm is not null then
      select v_range || jsonb_build_object('subject_percentile', round(100.0 *
               (count(*) filter (where (x->>'price_per_sqm')::numeric < v_psm)
                + 0.5 * count(*) filter (where (x->>'price_per_sqm')::numeric = v_psm))
               / count(*)))
        into v_range
        from jsonb_array_elements(v_r->'comparables') x
       where (x->>'in_stats')::boolean
         and x->>'price_per_sqm' is not null;
    end if;

    if v_range is not null then
      v_r := jsonb_set(v_r, '{stats}', (v_r->'stats') || v_range);
    end if;
  end if;

  -- ---- 2. העסקאות להצגה: הדומות ביותר, לא כולן ----
  --
  -- **ואותו בניין קודם.** אין במאגר שנת בנייה (0 מתוך 23 אלף), ולכן עסקה
  -- באותו גוש+חלקה היא הקירוב הטוב ביותר לגיל ולרמת הבנייה של הנכס: אותו
  -- בניין, אותו גיל, אותו מפרט. היא מסומנת `same_building` ומקבלת עדיפות
  -- שקולה ל-40% פער בשטח או ל-800 מ׳ - כלומר עסקה בבניין גוברת כמעט תמיד.
  v_size := nullif((v_r->'subject'->>'size_sqm')::numeric, 0);
  v_of   := jsonb_array_length(coalesce(v_r->'comparables', '[]'::jsonb));

  v_r := jsonb_set(v_r, '{comparables}', coalesce((
    select jsonb_agg(z.x || jsonb_build_object('similarity_rank', z.rn, 'same_building', z.same_building)
                     order by z.rn)
      from (
        select t.x, b.same_building,
               coalesce((t.x->>'in_stats')::boolean, false) as in_stats,
               bool_or(coalesce((t.x->>'in_stats')::boolean, false)) over () as any_in_stats,
               row_number() over (
                 order by
                   -- מה שנספר בממוצע קודם: הטבלה מראה על מה המספר נשען
                   case when coalesce((t.x->>'in_stats')::boolean, false) then 0 else 1 end,
                   -- שטח לא ידוע (של הנכס או של העסקה) = פער בינוני, לא אפס:
                   -- עסקה בלי שטח אינה "זהה בגודל"
                   coalesce(abs((t.x->>'size_sqm')::numeric - v_size) / v_size, 0.35)
                   + 0.5 * coalesce((t.x->>'distance_meters')::numeric, 1000) / 1000.0
                   + 0.4 * coalesce((current_date - (t.x->>'sold_at')::date), 365) / 365.0
                   - case when b.same_building then 0.4 else 0 end,
                   t.ord) as rn
          from jsonb_array_elements(coalesce(v_r->'comparables', '[]'::jsonb))
               with ordinality t(x, ord)
          cross join lateral (
            -- גוש וחלקה כמספרים (land_parcel_num), כמו בשכבת הבעלות:
            -- "016720" במאגר ו-"16720" במידע התכנוני הם אותה חלקה.
            select coalesce(v_gush is not null and exists (
                     select 1 from public.market_deals_official d
                      where d.id = nullif(t.x->>'id', '')::uuid
                        and public.land_parcel_num(d.gush)  = public.land_parcel_num(v_gush)
                        and public.land_parcel_num(d.helka) = public.land_parcel_num(v_helka)), false)
                   as same_building
          ) b
      ) z
     -- כשיש עסקאות שנספרות - רק הן. השלמה בעסקאות מסוג אחר הייתה ממלאת
     -- את הטבלה בשורות "סוג אחר" שהממוצע אינו נשען עליהן.
     where z.rn <= v_listed
       and (z.in_stats or not z.any_in_stats)), '[]'::jsonb));

  v_r := jsonb_set(v_r, '{data_coverage}', (v_r->'data_coverage') || jsonb_build_object(
    'comparables_listed',    jsonb_array_length(v_r->'comparables'),
    'comparables_listed_of', v_of));

  if not v_loaded then
    -- עוד לא נטען כלום: ownership: null אומר לתצוגה לשתוק.
    return v_r || jsonb_build_object('ownership', null);
  end if;

  return v_r || jsonb_build_object('ownership', jsonb_build_object(
    'as_of',        v_as_of,
    'subject',      v_subject,
    'counts',       v_counts,
    'split',        v_split,
    'min_required', v_min
  ));
end;
$$;

comment on function public.cma_report_finish(jsonb, text, text) is
  'השלב האחרון של דוח ה-CMA: שכבת הבעלות, טווח שוק למ"ר ואחוזון (מעל הסף), ו-comparables מצומצם ל-cma_comparables_listed הדומות ביותר (אותו בניין לפי p_gush/p_helka קודם). docs/cma.md';

revoke all on function public.cma_report_finish(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.cma_report_finish(jsonb, text, text) to service_role;

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

  return public.cma_report_finish(v_r, v_gush, v_helka);
end;
$$;

revoke all on function public.agent_cma_report_full(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report_full(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. מיקום לכתובת, מהמסד בלבד
--
-- הגאוקוד בשרת (‏geocodeInCity) מכיר רק ערים שיש להן ספק פתוח, ו-GovMap
-- אסור מהשרת. אבל במאגר העסקאות כבר יש נקודות: 1,176 מתוך 1,516 העסקאות
-- בראשון לציון ממוקמות. הסדר הוא מהמדויק לפחות מדויק, וכל אחד אומר מה הוא:
--
--   address_deal    - עסקה שנרשמה בכתובת הזו בדיוק ויש לה מיקום
--   parcel          - הגוש/חלקה של הכתובת (מעסקאות בה) ומרכז החלקה ממאגר
--                     החלקות הפתוח - מדויק לבניין
--   street_nearest  - מספר הבית הקרוב ביותר באותו רחוב (עד 30 מספרים).
--                     ברחוב ארוך זה יכול להיות כמה מאות מטרים, ולכן הדוח
--                     אומר את זה ולא מציג את המיקום כמדויק
--   street          - בלי מספר בית: מרכז העסקאות ברחוב. הכי פחות מדויק
-- ---------------------------------------------------------------------------
create or replace function public.cma_locate_address(
  p_city         text,
  p_street       text,
  p_house_number text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_city  text := btrim(coalesce(p_city, ''));
  v_sk    text := public.street_name_key(p_street);
  v_num   text := btrim(coalesce(p_house_number, ''));
  v_n     integer := nullif(substring(btrim(coalesce(p_house_number, '')) from '^\d+'), '')::integer;
  v_cid   uuid;
  v_names text[];
  v_out   jsonb;
  v_parcel jsonb;
begin
  if v_city = '' or coalesce(v_sk, '') = '' then return null; end if;

  -- שמות העיר כפי שהם רשומים בעסקאות - אותו היגיון של address_parcel_from_deals
  if exists (select 1 from public.market_deals_official m where m.city = v_city limit 1) then
    v_names := array[v_city];
  else
    v_cid := public.city_id_for_name(v_city);
    if v_cid is null then return null; end if;
    with k as (
      select public.city_name_key(c.name) as key from public.cities c where c.id = v_cid
      union
      select a.alias_key from public.city_aliases a where a.city_id = v_cid
    ), names as materialized (
      select distinct m.city as name from public.market_deals_official m where m.city is not null
    )
    select array_agg(n.name) into v_names from names n where public.city_name_key(n.name) in (select key from k);
    if v_names is null then return null; end if;
  end if;

  -- 1. עסקה בכתובת עצמה
  if v_num <> '' then
    select jsonb_build_object('lat', avg(m.lat), 'lng', avg(m.lng), 'precision', 'address_deal')
      into v_out
      from public.market_deals_official m
     where m.city = any (v_names)
       and btrim(m.house_number) = v_num
       and public.street_name_key(m.street) = v_sk
       and m.lat is not null and m.lng is not null
    having count(*) > 0;
    if v_out is not null then return v_out; end if;

    -- 2. מרכז החלקה
    v_parcel := public.address_parcel_from_deals(v_city, p_street, v_num);
    if v_parcel is not null then
      select jsonb_build_object('lat', avg(po.lat)::double precision, 'lng', avg(po.lng)::double precision,
                                'precision', 'parcel')
        into v_out
        from public.parcels_open po
       where po.gush  = (v_parcel->>'gush')::integer
         and po.helka = (v_parcel->>'helka')::integer
         and po.lat is not null and po.lng is not null
      having count(*) > 0;
      if v_out is not null then return v_out; end if;
    end if;
  end if;

  -- 3. בלי מספר בית - מרכז העסקאות ברחוב
  if v_n is null then
    select jsonb_build_object('lat', avg(m.lat), 'lng', avg(m.lng), 'precision', 'street')
      into v_out
      from public.market_deals_official m
     where m.city = any (v_names)
       and public.street_name_key(m.street) = v_sk
       and m.lat is not null and m.lng is not null
    having count(*) > 0;
    return v_out;
  end if;

  -- 4. מספר הבית הקרוב באותו רחוב
  select jsonb_build_object('lat', s.lat, 'lng', s.lng, 'precision', 'street_nearest',
                            'nearest_house_number', s.house_number)
    into v_out
    from (
      select m.lat, m.lng, btrim(m.house_number) as house_number,
             abs(nullif(substring(btrim(m.house_number) from '^\d+'), '')::integer - v_n) as diff
        from public.market_deals_official m
       where m.city = any (v_names)
         and public.street_name_key(m.street) = v_sk
         and m.lat is not null and m.lng is not null
         and btrim(coalesce(m.house_number, '')) ~ '^\d+'
    ) s
   where s.diff <= 30
   order by s.diff,
            -- אותו צד של הרחוב (זוגי/אי-זוגי) קודם
            case when (s.diff % 2) = 0 then 0 else 1 end
   limit 1;

  return v_out;
end;
$$;

comment on function public.cma_locate_address(text, text, text) is
  'lat/lng לכתובת מהמסד בלבד (עסקה בכתובת, מרכז החלקה מ-parcels_open, מספר הבית הקרוב ברחוב), עם precision. null = לא נמצא. service_role בלבד.';

revoke all on function public.cma_locate_address(text, text, text) from public, anon, authenticated;
grant execute on function public.cma_locate_address(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. הדוח לכתובת - Elite
-- ---------------------------------------------------------------------------
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
  p_lng           double precision default null
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
  v_lat       double precision := p_lat;
  v_lng       double precision := p_lng;
  v_precision text := case when p_lat is not null and p_lng is not null then 'geocoded' end;
  v_loc       jsonb;
  v_parcel    jsonb;
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

  -- סוג שאינו מוכר חוזר null מ-property_type_class ונופל מכל השוואה בלי
  -- שגיאה - דוח ריק שנראה כמו "אין עסקאות". מוטב לומר.
  if public.property_type_class(v_type) is null then
    return jsonb_build_object('error', 'unknown_property_type',
      'detail', 'סוג הנכס "' || v_type || '" אינו מוכר לדוח. אפשר: דירה, דירת גן, פנטהאוז, בית פרטי, דו משפחתי, חנות, משרד, מגרש.');
  end if;

  if v_city is null or v_street is null then
    return jsonb_build_object('error', 'address_required',
      'detail', 'צריך עיר ורחוב (ועדיף מספר בית) כדי להפיק דוח לכתובת.');
  end if;

  -- מיקום: מה שהקורא כבר מצא (גאוקוד), ואם אין - מהמסד
  if v_lat is null or v_lng is null then
    v_loc := public.cma_locate_address(v_city, v_street, v_num);
    v_lat := (v_loc->>'lat')::double precision;
    v_lng := (v_loc->>'lng')::double precision;
    v_precision := v_loc->>'precision';
  end if;

  -- הבניין: גוש/חלקה מעסקאות שנרשמו בכתובת. משמש לסוג הבעלות ול"אותו בניין"
  if v_num is not null then
    v_parcel := public.address_parcel_from_deals(v_city, v_street, v_num);
  end if;

  v_address := btrim(v_street || ' ' || coalesce(v_num, ''));

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
      'location_precision', v_precision,
      'nearest_house_number', v_loc->>'nearest_house_number')),
    '{data_coverage}', (v_r->'data_coverage') || jsonb_build_object(
      'location_precision', v_precision));
end;
$$;

comment on function public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision) is
  'דוח CMA לכתובת, גם לנכס שאינו במערכת. Elite בלבד (tier_required). אותה ליבה ואותו סיום כמו agent_cma_report_full; הנכס נבנה בזיכרון. docs/cma.md';

revoke all on function public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision) from public, anon, authenticated;
grant execute on function public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision) to service_role;

-- העטיפה לדפדפן: המזהה מה-JWT, והמיקום מ-GovMap בדפדפן כשיש
create or replace function public.cma_report_address(
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
  p_lng           double precision default null
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select public.agent_cma_report_address(public.current_agent_id(), p_city, p_street, p_house_number,
           p_property_type, p_rooms, p_size_sqm, p_floor, p_price, p_features, p_lat, p_lng);
$$;

revoke all on function public.cma_report_address(text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision) from public, anon;
grant execute on function public.cma_report_address(text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision) to authenticated, service_role;

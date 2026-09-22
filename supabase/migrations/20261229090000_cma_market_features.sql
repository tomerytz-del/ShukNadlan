-- ============================================================================
-- דוח CMA: שכבת השוק, ובה המאפיינים שקובעים מחיר
--
-- ## מה התבקש, ולמה הוא אינו יכול לשבת במקום המתבקש
--
-- התבקש לשקלל בבחירת בני ההשוואה גם מאפיינים - ממ"ד, מרפסת, מעלית.
-- **ולמאגר העסקאות אין ולו מאפיין אחד:**
--
--   עסקאות רשמיות (רשות המיסים)    1,512    מאפיינים: אין עמודה בכלל
--   עסקאות פלטפורמה                    3    מאפיינים: 0 (וגם בלי מיקום)
--   נכסים פעילים למכירה               31    מאפיינים: 18
--
-- כלומר סינון מאפיינים על בני ההשוואה של היום היה מוציא **את כולם**.
-- מה שכן קיים הוא מה שביקשתם: **הנכסים שמוצעים בשוק עכשיו**, ולהם יש
-- ממ"ד (14), מרפסת (16), מעלית (15), חניה (20) ומחסן (6).
--
-- לכן נוספת כאן **שכבה שלישית ונפרדת**, ולא סינון על הקיימת:
--
--   | שכבה | מה זה | המחיר |
--   | עסקאות בסביבה | מה **נסגר** | מחיר עסקה |
--   | עסקאות העיר | מה נסגר ואי אפשר למקם | מחיר עסקה |
--   | **נכסים בשוק** | מול **מי מתחרים** עכשיו | **מחיר מבוקש** |
--
-- ## ולמה היא לא מתערבבת בממוצע, בשום תנאי
--
-- מחיר מבוקש אינו מחיר עסקה - זו האבחנה ש-`20261130090000` נבנתה כדי
-- לשמור עליה, אחרי שפער המיקוח נכנס למאגר כאילו היה מחיר סגירה. שכבת
-- השוק היא **כולה** מחירים מבוקשים, ולכן היא אינה נוגעת ב-`stats`:
-- ‏`avg_price` ו-`median_price` נשארים מה שהיו. היא עונה על שאלה אחרת
-- לגמרי, וטובה בה: **איפה המחיר שלנו יושב מול מה שהקונה רואה היום**.
-- ההשוואה כאן היא מבוקש מול מבוקש, ולכן היא הוגנת.
--
-- ## הסולם, מאותה משפחה כמו סולם החדרים
--
--   1. אותו בנד חדרים **וגם** התאמת מאפיינים מעל `cma_feature_match_min`
--   2. אותו בנד חדרים בלבד - והדוח אומר שהמאפיינים לא שימשו
--   3. פחות מ-`cma_min_market_comparables` - **אין חציון**, רק הרשימה
--
-- שלב 3 הוא המצב של היום ברוב הנכסים, וזה בסדר גמור: 19 המודעות
-- המגואקדות נותנות 0 עד 3 התאמות חדרים+מאפיינים ברדיוס קילומטר. הרשימה
-- עצמה כן מוצגת - כל שורה בה היא נכס אמיתי עם מחיר אמיתי, וזו עובדה ולא
-- סטטיסטיקה - ומה שמושתק הוא **החציון**, בדיוק באותו היגיון שבו
-- ‏`data_coverage` משתיק ממוצע ממדגם קטן.
--
-- **וזה נדלק מעצמו ככל שהמלאי גדל.** אין כאן קוד מת אלא מנגנון שעובד על
-- הנתונים של היום ומגיע לסף שלו מאוחר יותר - ההבדל מ`year_built`, שאין
-- לו נתון בשום צד ולכן לא נכתב לו גייט.
--
-- ## אילו מאפיינים נחשבים, ואיזה נפסל
--
-- ‏`cma_price_features()` מונה תשעה מאפיינים **פיזיים** שמזיזים מחיר.
-- ומה שלא ברשימה מעניין יותר:
--
-- * ‏`exclusive` ו-`price_dropped` הם **סטטוס שיווקי ולא תכונה של הנכס**.
--   בלי ההוצאה הזו שתי מודעות בבלעדיות היו נראות "דומות" זו לזו בלי שום
--   סיבה שקשורה למחיר - הטיה שקטה שמייצרת את עצמה.
-- * ‏`ac` נמצא ב-24 מתוך 31 המודעות. מאפיין שכמעט לכולם יש אינו מבדיל
--   בין נכסים, והוא רק מדלל את המנה.
-- * ‏`loading_ramp` ו-`comms` הם מסחריים.
--
-- ## והדמיון הוא `null` ולא אפס כשאין נתון
--
-- מודעה בלי מאפיינים רשומים אינה מודעה בלי מאפיינים. ‏Jaccard שהיה
-- מחזיר 0 היה מדרג אותה אחרונה ומוציא אותה מהחציון - כלומר **מנחש**
-- שאין לה ממ"ד. היא חוזרת עם `feature_match: null`, מופיעה ברשימה
-- ומסומנת, ואינה נכנסת לתת-הקבוצה של ההתאמה. זה אותו כלל בדיוק שבגללו
-- ‏`rooms = 0` מנוטרל ל-`null` ב-`cma_deal_pool`.
--
-- תלויות: `agent_cma_report` כפי שהוגדרה ב-`20261228090000`,
-- ‏`property_type_class`, ‏`geo_distance_meters`, ‏`cma_deal_pool`.
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- שלוש שורות תצורה, כולן ניתנות לכוונון בלי פריסה - וזה בדיוק מה
-- שיידרש כשהמלאי יגדל.
insert into public.pricing_config (key, value) values
  ('cma_min_market_comparables', 3),
  ('cma_feature_match_min',      0.6),
  ('cma_market_comparables_limit', 12)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. המאפיינים שנחשבים
--
-- פונקציה ולא קבוע בגוף הדוח, כדי שהרשימה תהיה ניתנת לקריאה, לבדיקה
-- ולשינוי במקום אחד. ראו בראש הקובץ למה `exclusive`, `price_dropped`
-- ו-`ac` אינם כאן.
-- ---------------------------------------------------------------------------
create or replace function public.cma_price_features()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    'mamad',              -- ממ"ד
    'mamak',              -- ממ"ק
    'building_shelter',   -- מקלט בבניין
    'elevator',           -- מעלית
    'parking',            -- חניה
    'balcony',            -- מרפסת
    'sun_balcony',        -- מרפסת שמש
    'storage',            -- מחסן
    'accessible',         -- נגישות
    'renovated_feature'   -- משופץ
  ]::text[];
$$;

comment on function public.cma_price_features() is
  'המאפיינים הפיזיים שנספרים בדמיון בין נכסים בדוח CMA. סטטוס שיווקי (exclusive, price_dropped) ומאפיין שכמעט לכל המודעות יש (ac) אינם כאן בכוונה - הראשון אינו תכונה של הנכס, והשני אינו מבדיל.';

-- ---------------------------------------------------------------------------
-- 2. הדמיון עצמו
--
-- ‏Jaccard על המאפיינים שברשימה בלבד: |חיתוך| / |איחוד|.
--
-- **‏`null` ולא 0 כשלצד אחד אין מאפיינים רשומים** - "לא נרשם" אינו "אין",
-- והפרש בין השניים הוא ניחוש. כך גם `count(distinct)`: מאפיין שנרשם
-- פעמיים לא ינפח את המונה.
-- ---------------------------------------------------------------------------
create or replace function public.cma_feature_similarity(p_a text[], p_b text[])
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when a.n = 0 or b.n = 0 then null
           else round(i.n::numeric / (a.n + b.n - i.n)::numeric, 3)
         end
    from (select count(distinct x) n from unnest(coalesce(p_a, '{}'::text[])) x
           where x = any (public.cma_price_features())) a,
         (select count(distinct x) n from unnest(coalesce(p_b, '{}'::text[])) x
           where x = any (public.cma_price_features())) b,
         (select count(distinct x) n from unnest(coalesce(p_a, '{}'::text[])) x
           where x = any (public.cma_price_features())
             and x = any (coalesce(p_b, '{}'::text[]))) i;
$$;

comment on function public.cma_feature_similarity(text[], text[]) is
  'דמיון Jaccard בין שתי קבוצות מאפיינים, מוגבל ל-cma_price_features(). מחזיר null כשלאחד הצדדים אין אף מאפיין רשום - "לא נרשם" אינו "אין", ו-0 היה ניחוש.';

-- ---------------------------------------------------------------------------
-- 3. הדוח
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
  v_agent         record;
  v_prop          record;
  v_subject_size  numeric;
  v_subject_rooms numeric;
  v_base_radius   numeric;
  v_min_comps     integer;
  v_max_age       integer;
  v_similar_max   numeric;   -- עד לאן מרחיבים כדי לשמור על התאמת חדרים
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

  v_subject_size  := coalesce(v_prop.built_size_sqm, v_prop.size_sqm, v_prop.area_sqm);
  v_subject_rooms := nullif(v_prop.rooms, 0);

  select coalesce(max(value) filter (where key = 'cma_default_radius_meters'), 500),
         coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_max_deal_age_months'), 24),
         coalesce(max(value) filter (where key = 'cma_city_comparables_limit'), 12),
         coalesce(max(value) filter (where key = 'cma_similar_radius_meters'), 1000),
         coalesce(max(value) filter (where key = 'cma_min_market_comparables'), 3),
         coalesce(max(value) filter (where key = 'cma_feature_match_min'), 0.6),
         coalesce(max(value) filter (where key = 'cma_market_comparables_limit'), 12)
    into v_base_radius, v_min_comps, v_max_age, v_city_limit, v_similar_max,
         v_min_market, v_feat_min, v_market_limit
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
  v_pool_radius := greatest(v_base_radius * 6, v_similar_max);

  if v_prop.lat is not null and v_prop.lng is not null then
    -- מעבר **אחד** על הבריכה, ובו כל 11 הספירות. הגרסה הקודמת הריצה
    -- שאילתה לכל שלב בלולאה; 11 שאילתות היו הופכות את זה למחיר אמיתי.
    select array[
      count(*) filter (where c.same_type and c.rooms_diff <= 0   and c.distance_meters <= v_radii[1]),
      count(*) filter (where c.same_type and c.rooms_diff <= 0   and c.distance_meters <= v_radii[2]),
      count(*) filter (where c.same_type and c.rooms_diff <= 0.5 and c.distance_meters <= v_radii[3]),
      count(*) filter (where c.same_type and c.rooms_diff <= 0.5 and c.distance_meters <= v_radii[4]),
      count(*) filter (where c.same_type and c.rooms_diff <= 1   and c.distance_meters <= v_radii[5]),
      count(*) filter (where c.same_type and c.rooms_diff <= 1   and c.distance_meters <= v_radii[6]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[7]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[8]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[9]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[10]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[11])
    ]::integer[]
      into v_counts
      from public.cma_deal_pool(v_prop.lat, v_prop.lng, v_cutoff, v_pool_radius,
                                p_property_id, v_prop.property_type, v_subject_rooms) c;

    for v_i in 1 .. array_length(v_radii, 1) loop
      -- נכס בלי מספר חדרים מדלג על השלבים המסוננים במקום לצבור בהם אפסים
      continue when v_bands[v_i] is not null and v_subject_rooms is null;
      v_used_band   := v_bands[v_i];
      v_used_radius := v_radii[v_i];
      v_n           := v_counts[v_i];
      exit when v_n >= v_min_comps;
    end loop;

    v_band_reason := case
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
                        and (v_used_band is null or p.rooms_diff <= v_used_band), false) as in_stats
          from public.cma_deal_pool(v_prop.lat, v_prop.lng, v_cutoff, v_used_radius,
                                    p_property_id, v_prop.property_type, v_subject_rooms) p
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
            select p.id, p.title, nullif(p.rooms, 0) as rooms, p.price, p.features,
                   p.lat, p.lng, (p.agent_id = v_agent.id) as is_own,
                   coalesce(p.built_size_sqm, p.size_sqm, p.area_sqm) as size_sqm
              from public.properties p
             where p.status = 'active'
               and p.deal_type = 'sale'
               and p.id <> p_property_id
               and p.price > 0
               and p.lat is not null and p.lng is not null
               and public.property_type_class(p.property_type)
                   = public.property_type_class(v_prop.property_type)
          ) m
         where public.geo_distance_meters(v_prop.lat, v_prop.lng, m.lat, m.lng) <= v_market_radius
           and (v_used_band is null
                or (m.rooms is not null and v_subject_rooms is not null
                    and abs(m.rooms - v_subject_rooms) <= v_used_band))
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
             -- השטח הממוצע של ההשוואות: זה מה שמסביר פער כולל שרחוק
             -- מהפער למ"ר, ובלעדיו שורת ההסבר טוענת בלי להראות.
             'avg_size_sqm',         round(avg((x->>'size_sqm')::numeric) filter (where x->>'size_sqm' is not null)),
             'sqm_sample_size',      count(*) filter (where x->>'price_per_sqm' is not null),
             'same_type_count',      count(*) filter (where (x->>'same_type')::boolean),
             'rooms_band',           v_used_band,
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
    'stats', v_stats,
    'data_coverage', jsonb_build_object(
      'status',             v_coverage,
      'comparables_found',  v_n,
      'comparables_in_radius', v_n_all,
      'comparables_same_type', v_n_class,
      'excluded_other_type', greatest(v_n_all - v_n_class, 0),
      -- מה שנשאר בחוץ בגלל מספר החדרים. דוח שמשתיק נתונים חייב לומר
      -- שהשתיק, בדיוק כמו excluded_other_type שלידו.
      'excluded_other_rooms', case when v_used_band is null then 0
                                   else greatest(v_n_class - v_n, 0) end,
      'subject_rooms',      v_subject_rooms,
      'rooms_band',         v_used_band,
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
      'has_market_statistics',    (v_market_stats is not null)
    ),
    'sources', v_sources
  );
end;
$$;

comment on function public.agent_cma_report(uuid, uuid) is
  'דוח CMA לפי מזהה סוכן/ת מפורש. שלוש שכבות: עסקאות שנסגרו ברדיוס (market_deals + market_deals_official, מחיר עסקה), עסקאות עיר שאי אפשר למקם, ונכסים פעילים למכירה בסביבה (market_comparables - **מחיר מבוקש**, ולכן לעולם אינם נכנסים ל-stats). הסטטיסטיקה מחושבת על מחלקת נכס תואמת ומספר חדרים תואם לפי סולם שמרחיב קודם את הרדיוס; שכבת השוק מדורגת לפי דמיון מאפיינים (cma_feature_similarity) וחציון מוחזר רק מעל cma_min_market_comparables.';

revoke all on function public.cma_price_features() from public, anon, authenticated;
grant execute on function public.cma_price_features() to service_role;

revoke all on function public.cma_feature_similarity(text[], text[]) from public, anon, authenticated;
grant execute on function public.cma_feature_similarity(text[], text[]) to service_role;

revoke all on function public.agent_cma_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;

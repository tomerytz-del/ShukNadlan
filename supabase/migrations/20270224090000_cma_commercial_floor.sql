-- ===========================================================================
-- דוח CMA לנכס מסחרי: "בנין" אינו מסחרי, וקומה במקום חדרים
--
-- ## מה היה שבור
--
-- ‏`property_type_class` מיפתה את "בנין" של GovMap ל-`commercial`. במאגר
-- הרשמי יש רק שלושה סוגים - דירה, בנין, קרקע - ולכן "בנין" היה בן ההשוואה
-- **היחיד** של כל חנות ומשרד. נבדק ב-4.10.2026 על כל 5 הנכסים המסחריים
-- שמוצעים למכירה: ארבעה קיבלו `status = 'ok'` עם ממוצע, ו-100% מהעסקאות
-- שבממוצע היו "בנין". חנות של 120 מ"ר ב-1.92 מיליון יצאה ‎+186%‎ מהשוק.
--
-- אבל "בנין" אינו סוג מסחרי. ‏768 עסקאות ב-24 החודשים האחרונים, ורובן
-- בקומות עליונות - עד הקומה ה-11:
--
--   | קומה      | עסקאות | חציון למ"ר |
--   | קרקע      | 78     | 16,786     |
--   | ראשונה    | 199    | 12,821     |
--   | שנייה     | 109    | 11,894     |
--   | רביעית    | 40     | 11,883     |
--
-- כלומר תערובת של דירות, משרדים וחנויות, שאין בה דרך לדעת מי מהן. ממוצע
-- עליה אינו "ממוצע מסחרי עם רעש" אלא מספר שאינו מתאר שום דבר, והוא חזר
-- בלי שום סימן שהוא כזה. מאותו כלל שבגללו סוג ריק מוחזר `null` ולא מנוחש:
-- **"בנין" חוזר `null`**. נכס מסחרי יקבל עכשיו `none`/`insufficient` במקום
-- ממוצע, עד שיגיע מקור שמבחין בין חנות למשרד (deals_engine כבר ממפה את
-- זה; ראו סעיף 1).
--
-- ## מה כאן
--
-- 1. ‏`property_type_class` - "בנין" יוצא; נכנסים הסוגים שהאתר ומנוע
--    העסקאות כבר כותבים ושנפלו ל-`null` בשקט: "בית פרטי" (יש עסקת פלטפורמה
--    כזו היום, והיא לא נספרה בשום דוח), "דירת גג", "מסחרי", וסוגי הטופס
--    המסחריים (אולמות, קליניקות, מחסנים...).
-- 2. ‏`floor_group` - טקסט קומה חופשי (‏"קרקע וראשונה", "קומה 3", "מרתף -1")
--    או מספר, לשלוש קבוצות: below / ground / upper. נבדק על כל 23,722
--    השורות במאגר: ‏38 below, ‏1,493 ground, ‏18,975 upper, ו-3,216 ה-null הם
--    ריקים או "מסד", "עמודים", "דירה ומחסן".
-- 3. ‏`cma_deal_pool` - עמודה חדשה `floor_group`. ‏drop ו-create כי טיפוס
--    ההחזרה משתנה (`create or replace` אינו יכול לשנות `returns table`).
-- 4. ‏`agent_cma_report` - בנכס מסחרי הסולם מסנן לפי **קבוצת קומה** ולא לפי
--    חדרים: אותה קבוצה ב-750 ואז ב-1,000 מ', ואז בלי סינון. חנות בקומת
--    קרקע ומשרד בקומה שלישית אינם אותו נכס - הפער בטבלה למעלה הוא כ-40%.
--    ‏`rooms_band_reason` מקבל שלושה ערכים חדשים (`floor_exact`,
--    ‏`no_similar_floor`, ‏`subject_floor_missing`), ו-`data_coverage` נושא
--    ‏`band_dimension`, ‏`subject_class`, ‏`subject_floor_group` ו-
--    ‏`excluded_other_floor`. נכס מגורים - ללא שינוי בתו.
--
-- ## ומה שאינו כאן, בכוונה
--
-- הקומה **אינה** נכנסת לסולם של נכס מגורים. בדירות היא משפיעה פחות
-- מהחדרים, ושינוי הסולם הקיים דורש מדידה משלו על 22 המודעות - כמו שנמדד
-- סולם החדרים ב-20261228090000. כאן היא רק לנכס מסחרי, שאין לו חדרים.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. מחלקת סוג הנכס
-- ---------------------------------------------------------------------------
create or replace function public.property_type_class(p_type text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when nullif(btrim(coalesce(p_type, '')), '') is null or btrim(p_type) = '-'
      then null
    when btrim(p_type) in ('דירה', 'דירת גן', 'גג/פנטהאוז', 'דו משפחתי',
                           'בית פרטי/קוטג''', 'יחידת דיור', 'דירות',
                           'פנטהאוז', 'קוטג''', 'וילה', 'טריפלקס', 'דופלקס',
                           'בית פרטי', 'דירת גג', 'מרתף/פרטר', 'סטודיו/לופט')
      then 'dwelling'
    -- ‏"בנין"/"בניין" **אינם** כאן (20270224090000): ב-GovMap זה סוג שמערבב
    -- דירות, משרדים וחנויות, ורובו בקומות עליונות.
    when btrim(p_type) in ('חנויות/שטח מסחרי', 'משרדים', 'מבני תעשייה',
                           'מחסן', 'חנות', 'משרד', 'מבנה מסחרי', 'אולם',
                           'מסחרי', 'אולמות', 'חלל עבודה משותף', 'בניין משרדים',
                           'מחסנים', 'סטודיו', 'קליניקות')
      then 'commercial'
    when btrim(p_type) in ('מגרש', 'מגרשים', 'קרקע', 'קרקעות', 'נחלה', 'משק')
      then 'land'
    else null   -- סוג שאיננו מכירים - וגם "בנין" - אינו מנוחש למחלקה
  end;
$$;

comment on function public.property_type_class(text) is
  'מחלקת השוואה לסוג נכס: dwelling / commercial / land, או null כשהסוג ריק, לא מוכר, או "בנין" של GovMap (שמערבב דירות, משרדים וחנויות). מגשרת בין אוצר המילים של האתר, של GovMap ושל deals_engine.';

revoke all on function public.property_type_class(text) from public, anon;
grant execute on function public.property_type_class(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. קבוצת קומה
--
-- סדר הבדיקות הוא ההכרעה: עסקה שאחת מקומותיה היא קרקע ("קרקע וראשונה",
-- "קרקע וגלריה") היא ground - זו החזית לרחוב, וזה מה שקובע את מחיר החנות.
-- אחר כך upper, ורק אז below: "מרתף ושנייה" היא יחידה בקומה שנייה עם
-- מחסן. צורות זכר ("מרתף שני", "מרתף שלישי") **אינן** ברשימת upper בכוונה -
-- הן מרתפים. "קרקע מפולשת" היא עמודים ולא קומה, ולכן נמחקת לפני הבדיקה.
-- ---------------------------------------------------------------------------
create or replace function public.floor_group(p_floor text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when s ~ '^-?[0-9]{1,3}$' then case when s::int < 0 then 'below'
                                         when s::int = 0 then 'ground'
                                         else 'upper' end
    when s ~ 'קרקע|קומה 0([^0-9]|$)|תחתונה' then 'ground'
    when s ~ 'ראשונה|ראשנה|שניה|שנייה|שלישית|שלשית|רביעית|רביעת|חמישית|חמשית|שישית|ששית|שביעית|שמינית|תשיעית|עשירית|עשרה|עשרים|שלושים|ארבעים|עליונה|קומה [1-9]'
      then 'upper'
    when s ~ 'מרתף|מקלט|קומה -' then 'below'
  end
  from (select btrim(regexp_replace(coalesce(p_floor, ''), 'קרקע\s*מפולשת|מפולשת', ' ', 'g')) as s) t;
$$;

comment on function public.floor_group(text) is
  'קבוצת קומה להשוואת נכסים מסחריים: below / ground / upper, או null כשאי אפשר לדעת. מקבלת טקסט חופשי של רשות המיסים ("קרקע וראשונה", "קומה 3") או מספר (properties.floor::text).';

revoke all on function public.floor_group(text) from public, anon;
grant execute on function public.floor_group(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. ‏cma_deal_pool - עם floor_group
--
-- זהה ל-20261228090000, ועמודה אחת נוספת בסוף. עסקת פלטפורמה לוקחת את
-- הקומה מהנכס המקושר, כמו המיקום והשטח.
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
  floor_group     text
)
language sql
stable
set search_path = ''
as $$
  select d.id,
         d.source,
         d.price_basis,
         d.property_type,
         nullif(d.rooms, 0) as rooms,
         d.sale_price,
         d.sold_at,
         d.size_sqm,
         coalesce(public.property_type_class(d.property_type)
                  = public.property_type_class(p_subject_type), false) as same_type,
         abs(nullif(d.rooms, 0) - nullif(p_subject_rooms, 0)) as rooms_diff,
         case when d.size_sqm > 0 then round(d.sale_price / d.size_sqm) end as price_per_sqm,
         round(public.geo_distance_meters(p_lat, p_lng, d.lat, d.lng))::numeric as distance_meters,
         public.floor_group(d.floor) as floor_group
    from (
      select md.id, md.source, md.price_basis, md.property_type, md.rooms,
             md.sale_price, md.sold_at,
             rp.lat, rp.lng,
             coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) as size_sqm,
             rp.floor::text as floor
        from public.market_deals md
        join public.properties rp on rp.id = md.related_property_id
       where md.related_property_id is distinct from p_exclude

      union all

      select o.id, o.source, 'official'::text, o.property_type, o.rooms,
             o.sale_price, o.sold_at, o.lat, o.lng, o.size_sqm, o.floor
        from public.market_deals_official o
    ) d
   where d.lat is not null and d.lng is not null
     and d.sold_at >= p_cutoff
     and public.geo_distance_meters(p_lat, p_lng, d.lat, d.lng) <= p_max_radius;
$$;

comment on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) is
  'בני ההשוואה לדוח CMA: איחוד market_deals ו-market_deals_official ברדיוס ובחלון הזמן, עם מרחק, התאמת מחלקה, הפרש חדרים וקבוצת קומה מול נכס הנושא. נקראת פעמיים מ-agent_cma_report - לספירת שלבי הסולם ולשליפת הרדיוס שנבחר.';

revoke all on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) to service_role;

-- ===========================================================================
-- 4. ‏agent_cma_report - סולם קומה לנכס מסחרי
--
-- הגרסה המלאה מ-20270114091000_deals_neighborhood.sql. השינויים: הממד של
-- הסולם (v_dim), ‏band_diff בספירה, ‏in_stats, סינון שכבת השוק, ‏v_band_rooms
-- בשכבת השכונה, ‏rooms_band רק בממד חדרים, וארבעה שדות בסוף data_coverage.
-- ===========================================================================
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
  -- הממד שהסולם מסנן לפיו (20270224090000): חדרים לנכס מגורים, קבוצת
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
  v_subject_class := public.property_type_class(v_prop.property_type);
  v_dim           := case when v_subject_class = 'commercial' then 'floor' else 'rooms' end;
  v_band_rooms    := case when v_dim = 'rooms' then v_subject_rooms end;
  v_subject_floor := case when v_dim = 'floor' then public.floor_group(v_prop.floor::text) end;

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
      count(*) filter (where c.same_type and c.band_diff <= 0   and c.distance_meters <= v_radii[1]),
      count(*) filter (where c.same_type and c.band_diff <= 0   and c.distance_meters <= v_radii[2]),
      count(*) filter (where c.same_type and c.band_diff <= 0.5 and c.distance_meters <= v_radii[3]),
      count(*) filter (where c.same_type and c.band_diff <= 0.5 and c.distance_meters <= v_radii[4]),
      count(*) filter (where c.same_type and c.band_diff <= 1   and c.distance_meters <= v_radii[5]),
      count(*) filter (where c.same_type and c.band_diff <= 1   and c.distance_meters <= v_radii[6]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[7]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[8]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[9]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[10]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[11])
    ]::integer[]
      into v_counts
      from (
        -- ‏band_diff: המרחק מהנכס בממד של הסולם. חדרים - ההפרש; קומה - 0
        -- באותה קבוצה ו-1 בקבוצה אחרת. ‏null כשלאחד הצדדים חסר הנתון, ואז
        -- העסקה אינה נכנסת לשום שלב מסונן - בדיוק כמו rooms_diff.
        select p.*,
               case when v_dim = 'floor'
                    then case when p.floor_group is null or v_subject_floor is null then null
                              when p.floor_group = v_subject_floor then 0 else 1 end
                    else p.rooms_diff end as band_diff
          from public.cma_deal_pool(v_prop.lat, v_prop.lng, v_cutoff, v_pool_radius,
                                    p_property_id, v_prop.property_type, v_band_rooms) p
      ) c;

    for v_i in 1 .. array_length(v_radii, 1) loop
      -- נכס בלי מספר חדרים מדלג על השלבים המסוננים במקום לצבור בהם אפסים
      continue when v_bands[v_i] is not null and v_dim = 'rooms' and v_subject_rooms is null;
      -- ובנכס מסחרי: לקומה יש שלב אחד בלבד (אותה קבוצה), ואין "‎±0.5‎
      -- קומה". בלי קומה רשומה - גם הוא מדולג.
      continue when v_bands[v_i] is not null and v_dim = 'floor'
                and (v_subject_floor is null or v_bands[v_i] > 0);
      v_used_band   := v_bands[v_i];
      v_used_radius := v_radii[v_i];
      v_n           := v_counts[v_i];
      exit when v_n >= v_min_comps;
    end loop;

    v_band_reason := case
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
                        and (v_used_band is null
                             or (v_dim = 'rooms' and p.rooms_diff <= v_used_band)
                             or (v_dim = 'floor' and p.floor_group = v_subject_floor)), false) as in_stats
          from public.cma_deal_pool(v_prop.lat, v_prop.lng, v_cutoff, v_used_radius,
                                    p_property_id, v_prop.property_type, v_band_rooms) p
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
                or (v_dim = 'rooms' and m.rooms is not null and v_subject_rooms is not null
                    and abs(m.rooms - v_subject_rooms) <= v_used_band)
                or (v_dim = 'floor' and public.floor_group(m.floor::text) = v_subject_floor))
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
                       when 'tax_authority'    then 'רשות המיסים — מאגר עסקאות מקרקעין'
                       else s.source end,
           'deals',  s.n) order by s.n desc), '[]'::jsonb)
    into v_sources
    from (
      select x->>'source' as source, count(*) as n
        from jsonb_array_elements(v_comps || v_city_comps || v_hood_comps) x
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
      'excluded_other_rooms', case when v_used_band is null or v_dim <> 'rooms' then 0
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
      -- הממד של הסולם (20270224090000). ‏rooms_band_reason נושא ערכי
      -- floor_* כש-band_dimension = 'floor'.
      'subject_class',          v_subject_class,
      'band_dimension',         v_dim,
      'subject_floor_group',    v_subject_floor,
      'excluded_other_floor',   case when v_used_band is null or v_dim <> 'floor' then 0
                                     else greatest(v_n_class - v_n, 0) end
    ),
    'sources', v_sources
  );
end;
$$;

comment on function public.agent_cma_report(uuid, uuid) is
  'דוח CMA לפי מזהה סוכן/ת מפורש. שכבות: עסקאות שנסגרו ברדיוס (market_deals + market_deals_official, מחיר עסקה), עסקאות בלי פין באותה שכונה, עסקאות עיר שאי אפשר למקם, ונכסים פעילים למכירה (מחיר מבוקש, לעולם לא ב-stats). הסטטיסטיקה מחושבת על מחלקת נכס תואמת ולפי סולם שמרחיב קודם את הרדיוס: מספר חדרים לנכס מגורים, קבוצת קומה (floor_group) לנכס מסחרי.';

revoke all on function public.agent_cma_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;

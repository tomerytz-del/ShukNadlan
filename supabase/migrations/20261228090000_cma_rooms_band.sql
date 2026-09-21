-- ============================================================================
-- דוח CMA: דירת 5 חדרים מושווית לדירות 5 חדרים
--
-- ## מה שבור היום, ובכמה
--
-- ‏`agent_cma_report` מסננת בני השוואה בשני ממדים: **מחלקת נכס**
-- (`property_type_class`, מאז `20261221090000`) ו**מרחק**. מספר החדרים
-- מוצג בטבלה ואינו מסנן דבר. כלומר הממוצע שהדוח מציג כ"מחיר ממוצע
-- בסביבה" מערבב דירות 3 חדרים עם דירות 5 חדרים, ואז מודד מולו את הנכס.
--
-- בעפולה, 24 החודשים האחרונים, מאגר רשות המיסים:
--
--   3 חדרים   301 עסקאות   73 מ"ר בממוצע    13,564 ש"ח למ"ר   ~990,000 ש"ח
--   4 חדרים   632 עסקאות  106 מ"ר בממוצע    13,259 ש"ח למ"ר  ~1,400,000 ש"ח
--   5 חדרים   379 עסקאות  143 מ"ר בממוצע    13,043 ש"ח למ"ר  ~1,860,000 ש"ח
--
-- **המחיר למ"ר כמעט זהה בשלושתן, והמחיר הכולל נבדל פי שניים.** ולכן
-- דווקא המספר שסוכן/ת מדפיס/ה ושולח/ת ללקוח/ה - "גבוה ב-X% מהממוצע" -
-- הוא המספר שהערבוב הורס. זה נמדד על **כל 22 המודעות הפעילות למכירה**
-- (21.9.2026), ואלה התוצאות החריפות:
--
--   מודעה  חדרים  מבוקש      הפער היום       הפער אחרי
--   1079   5      1,900,000  ‎+99%‎            ‎+2%‎
--   1145   5      1,850,000  ‎+62%‎            ‎+13%‎
--   1110   5      1,900,000  ‎+52%‎            ‎-1%‎
--   1101   5      1,460,000  ‎+24%‎            ‎-21%‎   ← היפוך סימן
--   1097   4      1,570,000  ‎+31%‎            ‎-7%‎    ← היפוך סימן
--   1104   3      1,200,000  ‎-8%‎             ‎+33%‎   ← היפוך סימן
--   1141   3        815,000  ‎-35%‎            ‎-13%‎
--
-- ‏**חמש מתוך 20 המודעות שיש להן מספר חדרים החליפו סימן** - הדוח אמר
-- "מתחת לשוק" על נכס שמעליו, ולהפך. זו אינה אי-דיוק בשוליים אלא המלצת
-- תמחור הפוכה.
--
-- ושימו לב ל-1079: ‎+99%‎. דירת 5 חדרים ב-1.9 מיליון, מול ממוצע של
-- ‏954,667 ש"ח שנבנה מ-60 עסקאות שרובן דירות 3 חדרים. סוכן/ת שהדפיס/ה
-- את הדוח הזה הראה/תה ללקוח/ה שהנכס מתומחר בכפול מהשוק.
--
-- ## והתיקון מיישב את שני מספרי הפער זה עם זה
--
-- ‏`20261224090000` הוסיפה פער שני (למ"ר) מפני שהראשון (הכולל) הטעה
-- כששטחי ההשוואה שונים משטח הנכס, ושורת הסבר לכך ששניהם רחוקים זה מזה.
-- הסיבה לריחוק הייתה הערבוב עצמו: מודעה 1139 (80 מ"ר, 3 חדרים) הושוותה
-- לעסקאות ששטחן הממוצע 112 מ"ר. עם סינון חדרים השטח הממוצע בהשוואות
-- יורד ל-72 מ"ר, והמרחק בין שני הפערים מצטמצם מ-39 נקודות אחוז ל-14.
--
-- שורת ההסבר נשארת - היא עדיין נכונה כשהנכס גדול או קטן מהטיפוסי
-- בקבוצת החדרים שלו - אבל היא חוזרת להיות החריג ולא ברירת המחדל.
--
-- ## הסולם: קודם מרחיבים רדיוס, ורק אחר כך מוותרים על ההתאמה
--
-- סינון שאין לו מדרג היה הופך דוחות עובדים ל-`insufficient`: לדירת 4.5
-- חדרים אין ולו עסקה אחת של 4.5 חדרים ברדיוס קילומטר, ולדירת 8 חדרים
-- אין כזו בעיר כולה. לכן הסולם הוא **שני ממדים ולא אחד**:
--
--   1. אותו מספר חדרים בדיוק, ברדיוס הבסיס         (750 מ')
--   2. אותו מספר חדרים בדיוק, ברדיוס המורחב        (1,000 מ')
--   3. ‎±0.5‎ חדרים, ברדיוס הבסיס, ואז ברדיוס המורחב
--   4. ‎±1‎ חדר, ברדיוס הבסיס, ואז ברדיוס המורחב
--   5. בלי סינון חדרים - סולם הרדיוס הישן במלואו (עד פי 6)
--
-- **מרחק הוא הוויתור הזול, והתאמת הנכס היא הוויתור היקר.** דירת 5 חדרים
-- קילומטר משם היא בת השוואה טובה בהרבה מדירת 3 חדרים ברחוב הסמוך, כי
-- מחיר המ"ר כמעט אינו משתנה בין קבוצות החדרים ואילו המחיר הכולל משתנה
-- פי שניים. לכן כל קבוצת חדרים ממצה את הרדיוס המורחב לפני שמרפים ממנה.
--
-- הרדיוס המורחב הוא שורת תצורה חדשה, `cma_similar_radius_meters`,
-- וברירת המחדל 1,000 מ' - בדיוק הערך ש-`20261223090000` ניסתה ו-
-- ‏`20261224090000` החזירה ל-750. ההחזרה ההיא נכונה **כברירת מחדל**
-- (בעפולה מחיר המ"ר נע בין 9,000 ל-15,000 בתוך קילומטר, והרדיוס הרחב
-- מערבב שכונות), והרחבה **בשירות התאמה מדויקת יותר** היא עסקה אחרת:
-- מוותרים על מעט הומוגניות גיאוגרפית ומקבלים הומוגניות של סוג הנכס.
--
-- בפועל, מתוך 20 המודעות עם מספר חדרים: 18 קיבלו התאמה מדויקת, 17 מהן
-- כבר ב-750 מ' ושתיים דרשו את הקילומטר; אחת (4.5 חדרים) ירדה ל-‎±0.5‎,
-- אחת (6 חדרים) ל-‎±1‎, ואחת (8 חדרים) נשארה בלי סינון חדרים כי אין לה
-- בת השוואה בעיר.
--
-- ## מה שהדוח אומר עכשיו בקול
--
-- שני מצבים שבהם הסטטיסטיקה **אינה** מסוננת לפי חדרים, ובשניהם שתיקה
-- הייתה מחזירה בדיוק את המספר המטעה של היום בלי שאיש יֵדע:
--
-- * `no_similar_rooms` - אין די עסקאות דומות בשום שלב. הדוח אומר שהממוצע
--   מערבב גדלים, ושהמחיר למ"ר הוא ההשוואה המהימנה כאן.
-- * `subject_rooms_missing` - **לנכס עצמו אין מספר חדרים רשום.** כך
--   מודעה 1090 (עלייה 20, 1,650,000 ש"ח) קיבלה ‎+32%‎ מול 175 עסקאות
--   מעורבות. כאן התיקון אינו במסד אלא בכרטיס הנכס, ולכן הדוח מבקש
--   להשלים את מספר החדרים במקום להסתפק בהסתייגות.
--
-- ## ושנת בנייה - לא נכנסה, ולמה
--
-- התבקשה גם העדפה לעסקאות מאותה שנת בנייה. **אין נתון כזה בשום צד:**
-- ל-`properties` אין עמודת שנת בנייה כלל, ול-3,024 השורות ב-
-- ‏`market_deals_official` יש עמודה `year_built` ריקה לחלוטין (0 מלאות),
-- כי מסלול הקליטה היחיד הפעיל הוא ההדבקה מ-GovMap ובטבלה שלה אין עמודת
-- שנה. גייט על נתון שאינו קיים אינו מסנן - הוא קוד מת שנראה כמו יכולת.
-- מה שנדרש כדי שזה יעבוד כתוב ב-docs/cma.md תחת "שנת בנייה".
--
-- תלויות: `property_type_class`, `geo_distance_meters`, `pricing_config`.
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- הרדיוס שמותר להרחיב אליו כדי לשמור על התאמת החדרים. שורת תצורה ולא
-- קבוע בקוד, כמו ארבעת הספים שלידה: ניתן לכוונן בלי פריסה.
insert into public.pricing_config (key, value)
values ('cma_similar_radius_meters', 1000)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. בריכת בני ההשוואה
--
-- הוצאה לפונקציה משלה מפני שהיא נקראת **פעמיים** בדוח: פעם לספירת
-- השלבים בסולם, ופעם לשליפת העסקאות ברדיוס שנבחר. שני עותקים של איחוד
-- בן 20 שורות באותה פונקציה היו מתפצלים בסוף מעצמם, וזו בדיוק הסיבה
-- ש-`geo_distance_meters` הוצאה ב-`20261201090000`.
--
-- **אינה `security definer`**, וזה מכוון: היא נקראת מתוך
-- ‏`agent_cma_report` שהיא כן, ולכן היא ממילא רצה שם בהרשאות הבעלים.
-- הפיכתה לכזו הייתה יוצרת נקודת קצה שנייה למאגר הרשמי, והפעם בלי
-- הגייט למסלול.
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
  distance_meters numeric
)
language sql
stable
set search_path = ''
as $$
  select d.id,
         d.source,
         d.price_basis,
         d.property_type,
         -- אפס חדרים במקור אינו "נכס בלי חדרים" אלא "לא ידוע": כל 41
         -- השורות עם rooms=0 בעפולה הן מסוג "בנין". שורה כזו לא תתאים
         -- לשום נכס דרך ההפרש, ולכן היא מנוטרלת כאן ולא בכל שימוש.
         nullif(d.rooms, 0) as rooms,
         d.sale_price,
         d.sold_at,
         d.size_sqm,
         coalesce(public.property_type_class(d.property_type)
                  = public.property_type_class(p_subject_type), false) as same_type,
         -- ‏null כשלאחד הצדדים אין מספר חדרים, וכל השוואה מול null היא
         -- false. כלומר עסקה בלי חדרים אינה נכנסת לשלב מסונן, לעולם.
         abs(nullif(d.rooms, 0) - nullif(p_subject_rooms, 0)) as rooms_diff,
         case when d.size_sqm > 0 then round(d.sale_price / d.size_sqm) end as price_per_sqm,
         -- ‏`::numeric` מפורש: `round(double precision)` מחזיר double,
         -- ופונקציית SQL עם `returns table` דורשת את הטיפוס המוצהר ואינה
         -- מתקנת לבד. ‏geo_distance_meters היא double (זה הטיפוס של
         -- ‏properties.lat/lng), ולכן זה המקום היחיד שבו זה צץ.
         round(public.geo_distance_meters(p_lat, p_lng, d.lat, d.lng))::numeric as distance_meters
    from (
      -- עסקאות הפלטפורמה: המיקום והשטח יושבים על הנכס המקושר
      select md.id, md.source, md.price_basis, md.property_type, md.rooms,
             md.sale_price, md.sold_at,
             rp.lat, rp.lng,
             coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) as size_sqm
        from public.market_deals md
        join public.properties rp on rp.id = md.related_property_id
       where md.related_property_id is distinct from p_exclude

      union all

      -- עסקאות רשמיות: נושאות מיקום ושטח משל עצמן
      select o.id, o.source, 'official'::text, o.property_type, o.rooms,
             o.sale_price, o.sold_at, o.lat, o.lng, o.size_sqm
        from public.market_deals_official o
    ) d
   where d.lat is not null and d.lng is not null
     and d.sold_at >= p_cutoff
     and public.geo_distance_meters(p_lat, p_lng, d.lat, d.lng) <= p_max_radius;
$$;

comment on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) is
  'בני ההשוואה לדוח CMA: איחוד market_deals ו-market_deals_official ברדיוס ובחלון הזמן, עם מרחק, התאמת מחלקה והפרש חדרים מול נכס הנושא. נקראת פעמיים מ-agent_cma_report - לספירת שלבי הסולם ולשליפת הרדיוס שנבחר.';

revoke all on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.cma_deal_pool(double precision, double precision, date, numeric, uuid, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 2. הדוח
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
         coalesce(max(value) filter (where key = 'cma_similar_radius_meters'), 1000)
    into v_base_radius, v_min_comps, v_max_age, v_city_limit, v_similar_max
    from public.pricing_config;

  v_cutoff := (current_date - (v_max_age || ' months')::interval)::date;

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
      'has_statistics',     (v_coverage = 'ok')
    ),
    'sources', v_sources
  );
end;
$$;

comment on function public.agent_cma_report(uuid, uuid) is
  'דוח CMA לפי מזהה סוכן/ת מפורש. מאחד את עסקאות הפלטפורמה (market_deals) עם המאגר הרשמי (market_deals_official). הסטטיסטיקה מחושבת על מחלקת נכס תואמת (property_type_class) **ועל מספר חדרים תואם**, לפי סולם שמרחיב קודם את הרדיוס (עד cma_similar_radius_meters) ורק אחר כך מרפה מהתאמת החדרים; data_coverage.rooms_band_reason אומר איפה נעצר. סטטיסטיקה חוזרת רק כש-data_coverage.status=ok.';

revoke all on function public.agent_cma_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;

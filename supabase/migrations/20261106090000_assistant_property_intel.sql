-- ============================================================================
-- העוזר בוואטסאפ: דוח CMA ומידע תכנוני לנכס מסוים
--
-- הסוכן/ת יושב/ת מול לקוח/ה ושואל/ת בוואטסאפ "מה המחיר באזור?" או "מה מותר
-- לבנות במגרש הזה?". שתי התשובות כבר קיימות במסד ומוצגות בדשבורד — אבל שתיהן
-- נעולות מאחורי `current_agent_id()`, כלומר מאחורי JWT. ה-Edge Function של
-- הוואטסאפ מזהה את הסוכן/ת לפי **מספר הטלפון** ורצה עם `service_role`, ולכן
-- ‏`auth.uid()` שלה הוא `null` ושתי הפונקציות מחזירות לה שגיאת הרשאה.
--
-- זו בדיוק אותה בעיה שנפתרה ב-20261029090000 עבור הלקוחות וההתאמות, ואותו
-- פתרון: גרסה שמקבלת `p_agent_id` מפורש, ‏`security definer`, ומוענקת
-- ל-`service_role` בלבד. פונקציה שמקבלת מזהה סוכן/ת בפרמטר ופתוחה לדפדפן היא
-- דלת עקיפה ל-RLS.
--
-- ## למה `cma_report` עוברת דירה ולא משוכפלת
--
-- כל ההיגיון של הדוח — הרחבת הרדיוס עד שיש מספיק השוואות, מחיר למ״ר, עסקאות
-- שאי אפשר למקם — יושב היום בגוף `cma_report`. העתקה שלו לפונקציה שנייה
-- הייתה יוצרת שני דוחות שמתפצלים תוך חודש, והסוכן/ת היה מקבל/ת בוואטסאפ
-- מספר אחר מזה שבמסך. לכן ההיגיון עובר כולו ל-`agent_cma_report`,
-- ו-`cma_report` נשארת בדיוק באותה חתימה ועם אותם קודי שגיאה — עוטפת אותה
-- עם `current_agent_id()`. ‏`crm.html` לא משתנה.
--
-- ## המידע התכנוני — מה יוצא ולמי
--
-- ‏`property_planning_public` מצנזרת גוש, חלקה, שטח חלקה וגאומטריה, כי היא
-- מגישה את דף הנכס ל-`anon` (‏`docs/land-planning.md`). לסוכן/ת **על הנכס
-- שלו/ה** אין מה לצנזר — זה המידע שהוא/היא רואה בפאנל "מידע תכנוני" ב-CRM
-- ושהזין/ה בעצמו/ה בטופס. על נכס של עמית/ה במשרד, או על נכס פעיל כלשהו,
-- חוזר בדיוק מה שהאתר הפומבי מראה.
--
-- הגבול הזה נשאר ב-SQL ולא עובר ל-Edge Function מאותה סיבה שהוא לא בצד
-- הלקוח: רשימת שדות אסורים שיושבת בשני מקומות מתפצלת בסוף מעצמה.
--
-- ## תלויות קיימות
--
-- ‏`properties`, ‏`market_deals`, ‏`property_planning_info`, ‏`pricing_config`,
-- ‏`agency_members`, ‏`current_agent_id()`.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. דוח CMA לפי מזהה סוכן/ת מפורש
--
-- הגוף זהה ל-`cma_report` שהיה כאן עד עכשיו, בשני הבדלים: הסוכן/ת מגיע/ה
-- בפרמטר במקום מ-`current_agent_id()`, והשמות מוסמכים במלואם כי
-- ‏`search_path` ריק.
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
  v_agent        record;
  v_prop         record;
  v_subject_size numeric;
  v_base_radius  numeric;
  v_min_comps    integer;
  v_radius       numeric;
  v_used_radius  numeric := null;
  v_comps        jsonb   := '[]'::jsonb;
  v_city_comps   jsonb   := '[]'::jsonb;
  v_n            integer := 0;
  v_stats        jsonb;
  v_planning     jsonb;
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

  -- אותה נראות שה-RLS נותן לסוכן: נכס שלו, או נכס פעיל כלשהו.
  select p.* into v_prop
    from public.properties p
   where p.id = p_property_id
     and (p.agent_id = v_agent.id or p.status = 'active');

  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  v_subject_size := coalesce(v_prop.built_size_sqm, v_prop.size_sqm, v_prop.area_sqm);

  select coalesce(max(value) filter (where key = 'cma_default_radius_meters'), 500),
         coalesce(max(value) filter (where key = 'cma_min_comparables'), 5)
    into v_base_radius, v_min_comps
    from public.pricing_config;

  -- הרחבת רדיוס עד שיש מספיק השוואות (או עד תקרה של פי 6).
  if v_prop.lat is not null and v_prop.lng is not null then
    foreach v_radius in array array[v_base_radius, v_base_radius*2, v_base_radius*3, v_base_radius*4, v_base_radius*6]
    loop
      select coalesce(jsonb_agg(c order by c.distance_meters), '[]'::jsonb), count(*)
        into v_comps, v_n
        from (
          select d.id,
                 d.property_type,
                 d.rooms,
                 d.sale_price,
                 d.sold_at,
                 round(
                   6371000 * 2 * asin(sqrt(
                     power(sin(radians(rp.lat - v_prop.lat) / 2), 2) +
                     cos(radians(v_prop.lat)) * cos(radians(rp.lat)) *
                     power(sin(radians(rp.lng - v_prop.lng) / 2), 2)
                   ))
                 ) as distance_meters,
                 coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) as size_sqm,
                 case when coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) > 0
                      then round(d.sale_price / coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm))
                 end as price_per_sqm
            from public.market_deals d
            join public.properties rp on rp.id = d.related_property_id
           where rp.lat is not null and rp.lng is not null
             and d.related_property_id <> p_property_id
             and 6371000 * 2 * asin(sqrt(
                   power(sin(radians(rp.lat - v_prop.lat) / 2), 2) +
                   cos(radians(v_prop.lat)) * cos(radians(rp.lat)) *
                   power(sin(radians(rp.lng - v_prop.lng) / 2), 2)
                 )) <= v_radius
        ) c;

      v_used_radius := v_radius;
      exit when v_n >= v_min_comps;
    end loop;
  end if;

  -- עסקאות באותה עיר שאי אפשר למקם — מוחזרות בנפרד, לא מעורבבות ברדיוס.
  select coalesce(jsonb_agg(c order by c.sold_at desc), '[]'::jsonb)
    into v_city_comps
    from (
      select d.id, d.property_type, d.rooms, d.sale_price, d.sold_at
        from public.market_deals d
        left join public.properties rp on rp.id = d.related_property_id
       where d.city = v_prop.city
         and (rp.id is null or rp.lat is null or rp.lng is null)
    ) c;

  select jsonb_build_object(
           'comparables_count',   count(*),
           'avg_price',           round(avg((x->>'sale_price')::numeric)),
           'median_price',        round(percentile_cont(0.5) within group (order by (x->>'sale_price')::numeric)::numeric),
           'min_price',           min((x->>'sale_price')::numeric),
           'max_price',           max((x->>'sale_price')::numeric),
           'avg_price_per_sqm',   round(avg((x->>'price_per_sqm')::numeric) filter (where x->>'price_per_sqm' is not null)),
           'sqm_sample_size',     count(*) filter (where x->>'price_per_sqm' is not null)
         )
    into v_stats
    from jsonb_array_elements(v_comps) x;

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
    'stats', coalesce(v_stats, jsonb_build_object('comparables_count', 0))
  );
end;
$$;

comment on function public.agent_cma_report(uuid, uuid) is
  'דוח CMA לפי מזהה סוכן/ת מפורש — הגרסה של cma_report לשרת (העוזר בוואטסאפ), שאין לו JWT. זהו מקור האמת לדוח; cma_report עוטפת אותה.';

revoke all on function public.agent_cma_report(uuid, uuid) from public;
revoke all on function public.agent_cma_report(uuid, uuid) from anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. ‏cma_report נשארת החתימה שהדשבורד מכיר, ומאצילה את התוכן
--
-- אותם קודי שגיאה בדיוק (`no_matching_agent_profile`, ‏`upgrade_required`,
-- ‏`property_not_found`) — ‏`openCmaReport` ב-`crm.html` ממפה אותם להודעות,
-- ושינוי שלהם היה מפיל את הדוח בדשבורד בלי להיראות בקוד שלו.
--
-- ‏`current_agent_id()` שמחזירה null נכנסת ל-`agent_cma_report` ולא נמצאת
-- שם — כלומר `no_matching_agent_profile`, כמו קודם.
-- ---------------------------------------------------------------------------
create or replace function public.cma_report(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.agent_cma_report(public.current_agent_id(), p_property_id);
$$;

comment on function public.cma_report(uuid) is
  'דוח CMA לנכס עבור הסוכן/ת המחובר/ת. עוטפת את agent_cma_report עם current_agent_id() — כל ההיגיון שם, כדי שהדשבורד והעוזר בוואטסאפ יראו אותו דוח.';

revoke all on function public.cma_report(uuid) from public;
revoke all on function public.cma_report(uuid) from anon;
grant execute on function public.cma_report(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. מידע תכנוני לנכס, לפי מזהה סוכן/ת מפורש
--
-- ‏`own` מחזיר את המידע המלא — גוש, חלקה ושטח החלקה הרשום. זה מה שהסוכן/ת
-- רואה ממילא בפאנל "מידע תכנוני" ב-CRM על הנכס שלו/ה.
--
-- נכס שאינו שלו/ה (של עמית/ה במשרד, או כל נכס פעיל) מחזיר בדיוק את מה
-- ש-`property_planning_public` מגישה לגולש/ת אנונימי/ת: ייעוד, זכויות,
-- סטטוס חלקה ותוכניות חלות — בלי המזהים שמובילים לחלקה עצמה.
--
-- ‏`geometry_wgs84` ו-`lat/lng` של החלקה אינם יוצאים בשום מצב: אלה הכתובת
-- המדויקת בתחפושת, והם חסרי ערך בהודעת וואטסאפ ממילא.
-- ---------------------------------------------------------------------------
create or replace function public.agent_property_planning(
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
  v_agent  record;
  v_prop   record;
  v_info   public.property_planning_info%rowtype;
  v_own    boolean;
  v_plans  jsonb;
  v_zoning text;
begin
  select m.id, m.tier, m.active
    into v_agent
    from public.agency_members m
   where m.id = p_agent_id;

  if not found or not v_agent.active then
    return jsonb_build_object('error', 'no_matching_agent_profile');
  end if;

  -- אותו גידור של מפת המיקום והמידע התכנוני בדף הנכס (`property_map_view`).
  if v_agent.tier not in ('mid', 'premium') then
    return jsonb_build_object(
      'error',  'upgrade_required',
      'detail', 'מידע תכנוני זמין ב-PROFESSIONAL וב-Elite'
    );
  end if;

  select p.* into v_prop
    from public.properties p
   where p.id = p_property_id
     and (p.agent_id = v_agent.id or p.status = 'active');

  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  v_own := (v_prop.agent_id = v_agent.id);

  select * into v_info
    from public.property_planning_info i
   where i.property_id = p_property_id;

  -- מהתוכנית נשארים מספר, תיאור ושנה. ‏`area_sqm` של תוכנית הוא מפתח הצטרפות
  -- ל-GIS הפומבי ואינו יוצא גם לסוכן/ת — אין לו שימוש והוא רק מרחיב חשיפה.
  v_plans := coalesce((
    select jsonb_agg(jsonb_build_object(
             'number',      pl->>'number',
             'description', nullif(btrim(coalesce(pl->>'description', '')), ''),
             'year',        nullif(left(coalesce(pl->>'date', ''), 4), '')))
      from jsonb_array_elements(coalesce(v_info.applicable_plans, '[]'::jsonb)) pl
     where nullif(btrim(coalesce(pl->>'number', '')), '') is not null
  ), '[]'::jsonb);

  v_zoning := coalesce(
    nullif(btrim(v_prop.land_zoning), ''),
    nullif(btrim(v_info.land_use_designation), '')
  );

  return jsonb_build_object(
    'property_id',   v_prop.id,
    'title',         v_prop.title,
    'address',       v_prop.address,
    'city',          v_prop.city,
    'property_type', v_prop.property_type,
    'is_land',       public.is_land_property_type(v_prop.property_type),
    'is_own',        v_own,
    -- מה שהסוכן/ת הצהיר/ה בטופס הנכס
    'declared', jsonb_build_object(
      'land_zoning',              nullif(btrim(v_prop.land_zoning), ''),
      'building_rights_pct',      v_prop.land_building_rights_pct,
      'max_units',                v_prop.land_max_units,
      'max_floors',               v_prop.land_max_floors,
      'planning_notes',           nullif(btrim(v_prop.land_planning_notes), '')
    ),
    -- מה שנקלט מה-GIS של עיריית עפולה
    'gis', case when v_info.property_id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'land_use_designation', nullif(btrim(v_info.land_use_designation), ''),
      'parcel_status',        nullif(btrim(v_info.parcel_status), ''),
      'applicable_plans',     v_plans,
      'looked_up_at',         v_info.looked_up_at,
      'gush',                 case when v_own then v_info.gush end,
      'helka',                case when v_own then v_info.helka end,
      'parcel_area_sqm',      case when v_own then v_info.parcel_area_sqm end
    )) end,
    'effective_zoning', v_zoning,
    'has_data', (v_zoning is not null
                 or v_prop.land_building_rights_pct is not null
                 or v_prop.land_max_units is not null
                 or v_prop.land_max_floors is not null
                 or jsonb_array_length(v_plans) > 0
                 or nullif(btrim(v_info.parcel_status), '') is not null),
    'disclaimer', 'המידע כללי, מבוסס על שכבות ה-GIS של עיריית עפולה, ואינו תחליף לבדיקה מול הוועדה המקומית לתכנון ובנייה.'
  );
end;
$$;

comment on function public.agent_property_planning(uuid, uuid) is
  'מידע תכנוני לנכס לפי מזהה סוכן/ת מפורש, לעוזר בוואטסאפ. נכס של הסוכן/ת — מידע מלא כולל גוש וחלקה; כל נכס אחר — בדיוק מה ש-property_planning_public מגישה לגולש/ת.';

revoke all on function public.agent_property_planning(uuid, uuid) from public;
revoke all on function public.agent_property_planning(uuid, uuid) from anon, authenticated;
grant execute on function public.agent_property_planning(uuid, uuid) to service_role;

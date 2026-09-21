-- ============================================================================
-- הסטטיסטיקה של דוח ה-CMA מושווית לסוג נכס תואם
--
-- ‏`agent_cma_report` חישבה עד כה `avg_price` ו-`avg_price_per_sqm` על **כל**
-- העסקאות שנפלו ברדיוס, בלי שום סינון לסוג. ‏`same_type` היה מחושב ומדווח
-- כמונה, ולא שימש כמסנן.
--
-- כל עוד המאגר הרשמי היה ריק זה לא הזיק: עסקאות הפלטפורמה הן נכסים שלנו,
-- ובעיר אחת הן דומות זו לזו. ברגע שמאגר רשות המיסים נכנס זה נשבר, ובאופן
-- קיצוני. מתוך ההדבקה הראשונה של עפולה:
--
--   גוש חלקה        סוג     מ"ר    מחיר          מחיר למ"ר
--   16746-151-1     קרקע      1    7,500,000     **7,500,000**
--   16658-6-2       קרקע      1      375,000     **375,000**
--   16712-57-3      קרקע    100    2,800,000     28,000
--
-- דירה בעפולה נעה סביב 10,000 עד 17,000 ש"ח למ"ר. **שורת קרקע אחת של מטר
-- אחד ברדיוס 500 מ' מזיזה את הממוצע למ"ר בסדר גודל**, והדוח מציג אותו
-- כעובדה למתווך/ת שמתמחר/ת דירה. זה בדיוק הכשל השקט: המספר חוזר, נראה
-- תקין, ואין שום סימן שהוא שגוי.
--
-- ## למה מחלקה ולא השוואת טקסט
--
-- ‏`property_type` הוא **שני אוצרות מילים שונים**, ונמדד:
--
--   באתר       דירה · דירת גן · גג/פנטהאוז · דו משפחתי · בית פרטי/קוטג' ·
--              יחידת דיור · חנויות/שטח מסחרי · משרדים · מבני תעשייה ·
--              מגרש · מגרשים
--   ב-GovMap   דירה · בנין · קרקע · (ריק)
--
-- ‏`is not distinct from` בין השניים היה מתאים **רק** `דירה` מול `דירה`,
-- ומוציא דירת גן, פנטהאוז, קוטג' ודו משפחתי - כולם בני השוואה מצוינים
-- לדירה. כלומר סינון תמים היה מחליף הטיה אחת בהטיה הפוכה, וגרוע מכך:
-- הוא היה מרוקן את המדגם ומחזיר `insufficient` לנצח.
--
-- לכן ההשוואה היא על **מחלקה**: מגורים, מסחרי, קרקע.
--
-- ## וסוג ריק אינו מחלקה
--
-- ‏GovMap משאיר את הסוג ריק בצד השני של עסקה דו-צדדית. ‏`property_type_class`
-- מחזירה `null` על ריק, וההשוואה `=` על `null` אינה אמת - כלומר שורה
-- כזו **אינה נכנסת לסטטיסטיקה**. היא עדיין חוזרת ברשימת ההשוואות, כדי
-- שהסוכן/ת יראה/תראה אותה. מוטב לא לספור מאשר לספור לפי ניחוש.
--
-- ## מה עוד משתנה, ומה לא
--
-- ‏`v_n` - המונה שמרחיב את הרדיוס ומכריע `ok` מול `insufficient` - סופר
-- עכשיו **מחלקה תואמת**. בלי זה הרדיוס היה נעצר על חמש עסקאות שמתוכן
-- אחת רלוונטית, והסטטיסטיקה הייתה רצה על שורה אחת.
--
-- ‏`data_coverage` מדווח את שני המספרים: `comparables_in_radius` (הכול) ו-
-- `excluded_other_type` (מה שהוצא). דוח שמשתיק נתונים חייב לומר שהשתיק.
--
-- **לא השתנו:** החתימה, קודי השגיאה, מבנה ה-jsonb, ורשימת `comparables`
-- עצמה - היא ממשיכה להחזיר את כל מה שברדיוס, מתויג ב-`same_type`. ‏`crm.html`,
-- ‏`assets/crm.js` ו-`toolCmaReport` אינם משתנים.
-- ============================================================================

-- ‏`immutable`: היא נקראת בתוך תת-שאילתה של הדוח לכל שורת עסקה, והיא
-- מיפוי טהור של טקסט.
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
                           'פנטהאוז', 'קוטג''', 'וילה', 'טריפלקס', 'דופלקס')
      then 'dwelling'
    when btrim(p_type) in ('חנויות/שטח מסחרי', 'משרדים', 'מבני תעשייה',
                           'בנין', 'בניין', 'מחסן', 'חנות', 'משרד',
                           'מבנה מסחרי', 'אולם')
      then 'commercial'
    when btrim(p_type) in ('מגרש', 'מגרשים', 'קרקע', 'קרקעות', 'נחלה', 'משק')
      then 'land'
    else null   -- סוג שאיננו מכירים אינו מנוחש למחלקה
  end;
$$;

comment on function public.property_type_class(text) is
  'מחלקת השוואה לסוג נכס: dwelling / commercial / land, או null כשהסוג ריק או לא מוכר. מגשרת בין אוצר המילים של האתר לזה של GovMap.';

revoke all on function public.property_type_class(text) from public, anon;
grant execute on function public.property_type_class(text) to authenticated, service_role;

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
         coalesce(max(value) filter (where key = 'cma_max_deal_age_months'), 24)
    into v_base_radius, v_min_comps, v_max_age
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
  select coalesce(jsonb_agg(c order by c.sold_at desc), '[]'::jsonb)
    into v_city_comps
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
    ) c;

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
      'has_statistics',     (v_coverage = 'ok')
    ),
    'sources', v_sources
  );
end;
$$;
comment on function public.agent_cma_report(uuid, uuid) is
  'דוח CMA לפי מזהה סוכן/ת מפורש. מאחד את עסקאות הפלטפורמה (market_deals) עם המאגר הרשמי (market_deals_official). הסטטיסטיקה מחושבת על מחלקת נכס תואמת בלבד (property_type_class). סטטיסטיקה חוזרת רק כש-data_coverage.status=ok.';

revoke all on function public.agent_cma_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;

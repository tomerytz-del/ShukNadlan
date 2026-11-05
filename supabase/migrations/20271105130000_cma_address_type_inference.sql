-- ============================================================================
-- דוח CMA לכתובת: סוג נכס שלא נמסר - שואלים, עם רמז מהחלקה ומהייעוד
--
-- ## מה קרה (5.11.2026)
--
-- "דוח CMA לאגוז 6 בעפולה" ואחריו "תפיק" יצאו כדוח של **דירה**: ברירת המחדל
-- של p_property_type. רחוב האגוז הוא רחוב של בתים צמודי קרקע, והדוח השווה
-- ל-137 דירות - חציון 1.18 מיליון ₪. כבית: 5 בתים ב-750 מ', חציון 2.9 מיליון.
--
-- ## מה כאן
--
-- ‏`agent_cma_report_address` בלי סוג (‏null או ריק) מחזירה ‏`type_required`,
-- וגבריאלה שואלת: בית צמוד קרקע, דירה, פנטהאוז או דירת גן. לא מנחשים: דוח
-- של בית ושל דירה שונים פי שניים, ובבניין יושבים גם פנטהאוז ודירת גן.
-- השאלה נושאת רמזים: ‏`parcel_hint` (‏house / building, מהעסקאות בחלקה),
-- ‏`land_use` (הייעוד, אם נשמר אצלנו מידע תכנוני לחלקה - "מגורים א" הוא בדרך
-- כלל צמודי קרקע), ו-`street_house_like` מתוך `street_deals`.
--
-- ה-CRM (‏cma_report_address, ‏cma_link_share) מעביר תמיד סוג מהטופס - ללא שינוי.
-- ============================================================================

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
  -- בלי סוג: מסיקים מהעסקאות בחלקה של הכתובת, ואם אי אפשר - שואלים (20271105130000)
  v_type      text := nullif(btrim(coalesce(p_property_type, '')), '');
  v_pdeals    integer;
  v_pfloor    integer;
  v_parea     numeric;
  v_st_n      integer;
  v_st_house  integer;
  v_land_use  text;
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

  if v_type is not null and public.property_type_class(v_type) is null then
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

  -- סוג שלא נמסר (20271105130000). עד כאן הוא נפל ל"דירה", ובית צמוד קרקע
  -- ברחוב האגוז בעפולה הושווה ל-134 דירות: חציון 1.18 מיליון מול 2.9 של
  -- הבתים בסביבה. **לא מנחשים** - בבניין עם עסקאות בקומות יכולים לשבת גם
  -- פנטהאוז ודירת גן, והדוח של כל אחד מהם שונה. חוזרת שאלה אחת, עם שני רמזים:
  --   - העסקאות בחלקה של הכתובת, באותו כלל של cma_deal_pool: עסקה עם קומה =
  --     בניין; כולן בלי קומה בחלקה עד 1,500 מ"ר = בית.
  --   - הייעוד, אם המידע התכנוני של החלקה כבר נשמר אצלנו (planning_lookups,
  --     property_planning_info - נשמרים מהדפדפן; GovMap אסור בשרת).
  --     "מגורים א" הוא בדרך כלל צמודי קרקע, אבל זה רמז ולא החלטה.
  if v_type is null then
    if v_parcel is not null then
      select count(*), count(*) filter (where nullif(btrim(o.floor), '') is not null)
        into v_pdeals, v_pfloor
        from public.market_deals_official o
       where public.land_parcel_num(o.gush)  = public.land_parcel_num(v_parcel->>'gush')
         and public.land_parcel_num(o.helka) = public.land_parcel_num(v_parcel->>'helka');
      select po.legal_area into v_parea
        from public.parcels_open po
       where po.gush  = public.land_parcel_num(v_parcel->>'gush')
         and po.helka = public.land_parcel_num(v_parcel->>'helka')
         and po.gush_suffix = 0;
      select u.land_use into v_land_use
        from (
          select l.land_use_designation as land_use, l.looked_up_at as at
            from public.planning_lookups l
           where public.land_parcel_num(l.gush::text)  = public.land_parcel_num(v_parcel->>'gush')
             and public.land_parcel_num(l.helka::text) = public.land_parcel_num(v_parcel->>'helka')
             and l.land_use_designation is not null
          union all
          select i.land_use_designation, null
            from public.property_planning_info i
           where public.land_parcel_num(i.gush::text)  = public.land_parcel_num(v_parcel->>'gush')
             and public.land_parcel_num(i.helka::text) = public.land_parcel_num(v_parcel->>'helka')
             and i.land_use_designation is not null
        ) u
       order by u.at desc nulls last
       limit 1;
    end if;
    if v_street is not null and v_city is not null then
      select count(*),
             count(*) filter (where nullif(btrim(o.floor), '') is null
                                and not exists (select 1 from public.market_deals_official o2
                                                 where o2.gush = o.gush and o2.helka = o.helka
                                                   and o2.id <> o.id))
        into v_st_n, v_st_house
        from public.market_deals_official o
       where public.city_name_key(o.city) = public.city_name_key(v_city)
         and public.street_name_key(o.street) = public.street_name_key(v_street);
    end if;
    return jsonb_build_object('error', 'type_required',
      'detail', 'צריך לדעת את סוג הנכס - הדוח משווה לנכסים מאותו סוג.',
      'parcel_hint', case
        when v_pfloor > 0 then 'building'
        when v_pdeals > 0 and (v_parea is null or v_parea <= 1500) then 'house'
      end,
      'parcel_area', v_parea,
      'land_use', v_land_use,
      'street_deals', coalesce(v_st_n, 0),
      'street_house_like', coalesce(v_st_house, 0));
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
  'דוח CMA לכתובת או לגוש/חלקה, גם לנכס שאינו במערכת. Elite בלבד. סוג שלא נמסר - מהחלקה של הכתובת, ואחרת type_required (20271105130000). docs/cma.md';

revoke all on function public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision, text, text, numeric) from public, anon, authenticated;
grant execute on function public.agent_cma_report_address(uuid, text, text, text, text, numeric, numeric, integer, numeric, text[], double precision, double precision, text, text, numeric) to service_role;

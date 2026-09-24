-- ============================================================================
-- מידע תכנוני מ-GovMap: מקור רשום, ושמירה דרך פונקציה שאוכפת את המסלול
--
-- ## למה
--
-- עד היום המידע התכנוני הגיע משכבת ה-WFS של עיריית עפולה בלבד, דרך
-- ‏afula-planning-lookup - ולכן נכס בכל עיר אחרת קיבל "לא נמצא מידע".
-- ‏GovMap נותן את אותם נתונים לכל הארץ (‏PARCEL_ALL, ‏retzefMigrashim,
-- ‏neighborhoods_area), והשוויון מול עפולה נמדד ב-24.9.2026 על שתי חלקות
-- ייחוס: גוש, חלקה, שטח רשום, סטטוס וייעוד זהים. ‏docs/govmap.md.
--
-- ## למה הדפדפן, ולמה זה מחייב פונקציה
--
-- הטוקן של GovMap נעול לדומיין האתר ועובד מהדפדפן. האם הוא עובד מהשרת
-- תלוי בתשובה של מפ"י, ולכן השליפה רצה בטופס הנכס ב-CRM.
--
-- ‏afula-planning-lookup אוכפת את המסלול (‏mid/premium) **בשרת**, לפני
-- השליפה. כשהשליפה בדפדפן, אין "לפני" שאפשר לסמוך עליו - ולכן הגייט עובר
-- לנקודה היחידה שבשליטתנו: **השמירה**. ‏`govmap_save_planning` בודקת
-- בעלות על הנכס, מסלול, `billing_status` ו-`active`, ומאמתת כל שדה לפני
-- שהוא נכתב, כי מה שמגיע מהדפדפן אינו מקור אמין.
--
-- > **פער שקיים לפני המיגרציה הזו ואינו נסגר בה:** ה-RLS על
-- > ‏property_planning_info מתיר לסוכן/ת לכתוב ישירות לשורה של נכס שלו/ה,
-- > בלי בדיקת מסלול, ו-crm.js עושה זאת בשלושה מקומות (שמירת תוצאת
-- > afula-planning-lookup ושתי עריכות ידניות). סגירה שלו שוברת את שלושתם,
-- > ולכן היא שייכת ל-PR נפרד. מתועד ב-docs/govmap.md.
--
-- ## ‏`source`
--
-- ‏`municipal_wfs` / `govmap` - אותו אוצר מילים של city_geocode_sources.kind.
-- ‏`null` לשורות שנכתבו לפני המיגרציה (כולן מ-WFS עפולה, אבל עדיף "לא
-- ידוע" על פני ניחוש). העמודה היא מה שיאפשר את ההשוואה בין שני הספקים
-- בעפולה לפני שמעבירים אותה - "התנאי לניתוק עפולה" ב-docs/govmap.md.
-- ============================================================================

alter table public.property_planning_info
  add column if not exists source            text,
  add column if not exists neighborhood_name text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.property_planning_info'::regclass
                    and conname  = 'property_planning_info_source_chk') then
    alter table public.property_planning_info
      add constraint property_planning_info_source_chk
      check (source is null or source in ('municipal_wfs', 'govmap'));
  end if;
end $$;

comment on column public.property_planning_info.source is
  'מאיפה המידע: municipal_wfs (שכבת העירייה) או govmap. null = נכתב לפני שהעמודה נוספה.';
comment on column public.property_planning_info.neighborhood_name is
  'שם השכונה משכבת neighborhoods_area של GovMap. לא כל נקודה מכוסה.';

-- ---------------------------------------------------------------------------
-- הכתיבה עצמה: אימות + upsert, בלי שאלת "מי מותר"
--
-- פונקציה פנימית אחת, ששתי הדלתות קוראות לה: ‏govmap_save_planning (סוכן/ת,
-- על נכס שלו/ה) ו-govmap_admin_save (מנהל/ת פלטפורמה, השלמה לנכסים
-- קיימים, מיגרציה 20270103090000). אימות בשני עותקים היה נפרד ביום
-- הראשון שמישהו מתקן אחד מהם. **אין לה הרשאת הרצה לאף תפקיד חיצוני.**
-- ---------------------------------------------------------------------------
create or replace function public.govmap_planning_write(p_property_id uuid, p_record jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_gush     text := nullif(btrim(coalesce(p_record->>'gush', '')), '');
  v_helka    text := nullif(btrim(coalesce(p_record->>'helka', '')), '');
  v_area     numeric;
  v_lat      numeric;
  v_lng      numeric;
  v_plans    jsonb := coalesce(p_record->'applicable_plans', '[]'::jsonb);
  v_geom     jsonb := p_record->'geometry_wgs84';
begin
  -- אימות: הדפדפן אינו מקור אמין. ערך שאינו עובר - נזרק ולא "מתוקן".
  if v_gush is not null and v_gush !~ '^\d{1,7}$' then raise exception 'bad_gush'; end if;
  if v_helka is not null and v_helka !~ '^\d{1,5}$' then raise exception 'bad_helka'; end if;

  if p_record ? 'parcel_area_sqm' and jsonb_typeof(p_record->'parcel_area_sqm') = 'number' then
    v_area := (p_record->>'parcel_area_sqm')::numeric;
    if v_area < 0 or v_area > 100000000 then raise exception 'bad_area'; end if;
  end if;

  if jsonb_typeof(p_record->'lat') = 'number' and jsonb_typeof(p_record->'lng') = 'number' then
    v_lat := (p_record->>'lat')::numeric;
    v_lng := (p_record->>'lng')::numeric;
    -- תיבת ישראל גסה. פין מחוץ לה הוא תרגום שקרס (docs/property-map.md)
    if v_lat not between 29.3 and 33.5 or v_lng not between 34.2 and 35.95 then
      raise exception 'bad_coordinates';
    end if;
  end if;

  if jsonb_typeof(v_plans) <> 'array' or jsonb_array_length(v_plans) > 30 then
    raise exception 'bad_plans';
  end if;

  if v_geom is not null and jsonb_typeof(v_geom) <> 'null' then
    if jsonb_typeof(v_geom) <> 'object'
       or coalesce(v_geom->>'type', '') not in ('Polygon', 'MultiPolygon')
       or length(v_geom::text) > 200000 then
      raise exception 'bad_geometry';
    end if;
  else
    v_geom := null;
  end if;

  insert into public.property_planning_info as t (
    property_id, gush, helka, parcel_area_sqm, parcel_status,
    land_use_designation, applicable_plans, geometry_wgs84, lat, lng,
    looked_up_at, source, neighborhood_name)
  values (
    p_property_id, v_gush, v_helka, v_area,
    left(nullif(btrim(coalesce(p_record->>'parcel_status', '')), ''), 100),
    left(nullif(btrim(coalesce(p_record->>'land_use_designation', '')), ''), 200),
    v_plans, v_geom, v_lat, v_lng,
    now(), 'govmap',
    left(nullif(btrim(coalesce(p_record->>'neighborhood', '')), ''), 200))
  on conflict (property_id) do update set
    gush                 = excluded.gush,
    helka                = excluded.helka,
    parcel_area_sqm      = excluded.parcel_area_sqm,
    parcel_status        = excluded.parcel_status,
    land_use_designation = excluded.land_use_designation,
    applicable_plans     = excluded.applicable_plans,
    geometry_wgs84       = excluded.geometry_wgs84,
    lat                  = excluded.lat,
    lng                  = excluded.lng,
    looked_up_at         = excluded.looked_up_at,
    source               = excluded.source,
    neighborhood_name    = excluded.neighborhood_name;

  return true;
end;
$$;

comment on function public.govmap_planning_write(uuid, jsonb) is
  'פנימית: אימות ו-upsert של שורת תכנון מ-GovMap. בלי בדיקת הרשאה - נקראת רק מ-govmap_save_planning ומ-govmap_admin_save.';

revoke all on function public.govmap_planning_write(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- הדלת של הסוכן/ת: בעלות + מסלול, ואז הכתיבה
-- ---------------------------------------------------------------------------
create or replace function public.govmap_save_planning(p_property_id uuid, p_record jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_agent_id uuid := public.current_agent_id();
begin
  if v_agent_id is null then
    raise exception 'not_authenticated';
  end if;

  -- הנכס של הסוכן/ת, ולא נכס של מישהו אחר במשרד
  if not exists (select 1 from public.properties p
                  where p.id = p_property_id and p.agent_id = v_agent_id) then
    raise exception 'not_your_property';
  end if;

  -- הגייט: אותו מסלול כמו afula-planning-lookup, ומסלול שפג אינו מסלול
  if not exists (select 1 from public.agency_members m
                  where m.id = v_agent_id
                    and m.active = true
                    and m.billing_status = 'active'
                    and m.tier in ('mid', 'premium')) then
    raise exception 'upgrade_required';
  end if;

  return public.govmap_planning_write(p_property_id, p_record);
end;
$$;

comment on function public.govmap_save_planning(uuid, jsonb) is
  'שמירת מידע תכנוני שנשלף מ-GovMap בדפדפן. אוכפת בעלות על הנכס ומסלול mid/premium פעיל, ומאמתת כל שדה. docs/govmap.md.';

revoke all on function public.govmap_save_planning(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.govmap_save_planning(uuid, jsonb) to authenticated;

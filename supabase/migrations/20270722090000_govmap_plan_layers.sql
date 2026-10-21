-- ============================================================================
-- תוכניות ארציות, כוללניות והודעות 77-78 מ-GovMap (שכבות 203 ו-14)
--
-- ## למה
--
-- ‏`applicable_plans` מחזיקה היום בעפולה את התוכניות של שכבת העירייה, ומחוץ
-- לעפולה תוכנית אחת - זו שקבעה את המגרש (‏`tochnit` של retzefMigrashim).
-- מפ"י הפנו (12.10.2026) לשכבה 203 (גבולות התוכניות) ולשכבה 14 (ייעודי
-- מבא"ת), והן נמדדו ב-22.10.2026 על שתי חלקות ייחוס בעפולה. מה שהן מוסיפות
-- ואין בשכבת העירייה: תוכניות מתאר ארציות, התוכנית הכוללנית, **הודעות לפי
-- סעיף 77-78** (תוכנית בהכנה שמגבילה היתרים), האם מכוח התוכנית ניתן להוציא
-- היתר, וקישור ישיר למבא"ת. ‏docs/govmap.md, "plans-probe.js".
--
-- ## למה עמודה נפרדת ולא עוד שורות ב-applicable_plans
--
-- בעפולה `applicable_plans` נכתבת בשרת (‏afula-planning-lookup,
-- ‏planning_record_result), ו-203 נשלפת בדפדפן בלבד (מפ"י אינם מתירים קריאת
-- שרת). שני כותבים לאותה עמודה פירושו שכל שליפה עירונית מוחקת את מה שהדפדפן
-- הוסיף. ‏`govmap_plans` נכתבת רק כאן, והאיחוד נעשה בקריאה
-- (‏`planning_plans_merged`), כדי שלכל צרכן יהיה אותו איחוד.
--
-- ## הדפדפן אינו מקור אמין
--
-- ‏`govmap_plans_write` בונה כל איבר מחדש משדות מותרים בלבד, חותכת אורכים,
-- ומקבלת קישור רק לדומיין של מבא"ת. איבר שאינו עובר - נזרק בשקט; מבנה
-- שאינו מערך - נדחה.
-- ============================================================================

alter table public.property_planning_info
  add column if not exists govmap_plans    jsonb,
  add column if not exists govmap_plans_at timestamptz;

comment on column public.property_planning_info.govmap_plans is
  'תוכניות משכבות 203/14 של GovMap: ארציות, כוללניות והודעות 77-78. נכתבת רק דרך govmap_plans_write. [] = נבדק ואין. docs/govmap.md.';
comment on column public.property_planning_info.govmap_plans_at is
  'מתי נשלפו govmap_plans. null = לא נבדק עדיין.';

-- ---------------------------------------------------------------------------
-- הכתיבה: אימות ו-upsert. פנימית, בלי הרשאת הרצה לאף תפקיד חיצוני
-- ---------------------------------------------------------------------------
create or replace function public.govmap_plans_write(p_property_id uuid, p_plans jsonb)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_clean jsonb;
begin
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) > 40 then
    raise exception 'bad_plans';
  end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'number',      left(btrim(pl->>'number'), 100),
           'name',        left(nullif(btrim(coalesce(pl->>'name', '')), ''), 200),
           'kind',        left(nullif(btrim(coalesce(pl->>'kind', '')), ''), 100),
           'stage',       case when pl->>'stage' in ('approved', 'deposited', 'notice') then pl->>'stage' end,
           'date',        case when coalesce(pl->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then pl->>'date' end,
           'permits',     case when jsonb_typeof(pl->'permits') = 'boolean' then pl->'permits' end,
           'notice',      case when jsonb_typeof(pl->'notice') = 'boolean' then pl->'notice' end,
           'url',         case when coalesce(pl->>'url', '') ~ '^https://mavat\.iplan\.gov\.il/[A-Za-z0-9/]{1,200}$' then pl->>'url' end,
           'designation', left(nullif(btrim(coalesce(pl->>'designation', '')), ''), 100)))
           order by ord), '[]'::jsonb)
    into v_clean
    from jsonb_array_elements(p_plans) with ordinality t(pl, ord)
   where jsonb_typeof(pl) = 'object'
     and nullif(btrim(coalesce(pl->>'number', '')), '') is not null;

  insert into public.property_planning_info as t (property_id, govmap_plans, govmap_plans_at)
  values (p_property_id, v_clean, now())
  on conflict (property_id) do update set
    govmap_plans    = excluded.govmap_plans,
    govmap_plans_at = excluded.govmap_plans_at;

  return jsonb_array_length(v_clean);
end;
$$;

comment on function public.govmap_plans_write(uuid, jsonb) is
  'פנימית: אימות ושמירה של govmap_plans. בלי בדיקת הרשאה - נקראת רק מ-govmap_save_plans ומ-govmap_admin_save_plans.';

revoke all on function public.govmap_plans_write(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- הדלת של הסוכן/ת: אותה בעלות ואותו מסלול כמו govmap_save_planning
-- ---------------------------------------------------------------------------
create or replace function public.govmap_save_plans(p_property_id uuid, p_plans jsonb)
returns integer
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
  if not exists (select 1 from public.properties p
                  where p.id = p_property_id and p.agent_id = v_agent_id) then
    raise exception 'not_your_property';
  end if;
  if not exists (select 1 from public.agency_members m
                  where m.id = v_agent_id
                    and m.active = true
                    and m.billing_status = 'active'
                    and m.tier in ('mid', 'premium')) then
    raise exception 'upgrade_required';
  end if;
  return public.govmap_plans_write(p_property_id, p_plans);
end;
$$;

comment on function public.govmap_save_plans(uuid, jsonb) is
  'שמירת התוכניות משכבות 203/14 של GovMap לנכס של הסוכן/ת. מסלול mid/premium פעיל. docs/govmap.md.';

revoke all on function public.govmap_save_plans(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.govmap_save_plans(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- השלמה לנכסים קיימים - מנהל/ת הפלטפורמה, בדפדפן (כמו govmap_backfill_candidates)
--
-- **כולל עפולה:** כאן אין התנגשות עם שכבת העירייה - היא אינה נותנת את
-- התוכניות האלה. נכס עם פין, שלבעלי/ות שלו מסלול בתשלום פעיל, שלא נבדק או
-- שנבדק לפני יותר מ-90 יום (הודעת 77-78 נולדת ופגה; תוכנית מאושרת).
-- כל תשובה, כולל [], נרשמת ב-govmap_plans_at ולכן מוציאה את הנכס מהתור.
-- ---------------------------------------------------------------------------
create or replace function public.govmap_plans_candidates(p_limit integer default 40)
returns table (id uuid, lat numeric, lng numeric, city text)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  return query
  select p.id, p.lat::numeric, p.lng::numeric, btrim(p.city)
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    left join public.property_planning_info i on i.property_id = p.id
   where p.status = 'active'
     and p.lat is not null and p.lng is not null
     and m.active = true and m.billing_status = 'active' and m.tier in ('mid', 'premium')
     and (i.govmap_plans_at is null or i.govmap_plans_at < now() - interval '90 days')
   order by i.govmap_plans_at nulls first, p.id
   limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$$;

comment on function public.govmap_plans_candidates(integer) is
  'נכסים פעילים עם פין, למסלול בתשלום פעיל, שהתוכניות משכבות 203/14 לא נבדקו להם ב-90 הימים האחרונים. מנהל/ת פלטפורמה בלבד.';

revoke all on function public.govmap_plans_candidates(integer) from public, anon, authenticated;
grant execute on function public.govmap_plans_candidates(integer) to authenticated;

create or replace function public.govmap_admin_save_plans(p_property_id uuid, p_plans jsonb)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  -- אותו תנאי של התור: ההשלמה אינה דרך עקיפה לתת את היכולת בחינם
  if not exists (select 1 from public.properties p
                   join public.agency_members m on m.id = p.agent_id
                  where p.id = p_property_id
                    and m.active = true and m.billing_status = 'active'
                    and m.tier in ('mid', 'premium')) then
    raise exception 'upgrade_required';
  end if;
  return public.govmap_plans_write(p_property_id, p_plans);
end;
$$;

comment on function public.govmap_admin_save_plans(uuid, jsonb) is
  'שמירת התוכניות משכבות 203/14 מההשלמה של מנהל/ת הפלטפורמה. docs/govmap.md.';

revoke all on function public.govmap_admin_save_plans(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.govmap_admin_save_plans(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- האיחוד: מקור אחד לדף הנכס ולגבריאלה
--
-- סדר: התוכניות המפורטות (העירייה או retzefMigrashim) קודם, אחריהן ארציות
-- וכוללניות, והודעות 77-78 בסוף. תוכנית שמופיעה בשתיהן (‏215-0898114 בעפולה)
-- מופיעה פעם אחת, עם השדות של 203. המפתח - המספר בלי רווחים: ‏203 כותבת
-- "תמא/ 15/ ד" והעירייה "תמא/15/ד".
--
-- מה שיוצא מכל תוכנית: מספר, תיאור, שנה, סוג, שלב, הודעה, היתרים, קישור
-- וייעוד. כולם ברמת התוכנית - אזור שלם ולא חלקה - ולכן אינם מפתח הצטרפות
-- לחלקה. ‏area_sqm של תוכנית עדיין אינו יוצא (20260910090000).
-- ---------------------------------------------------------------------------
create or replace function public.planning_plans_merged(p_applicable jsonb, p_govmap jsonb)
returns jsonb
language sql
immutable
set search_path to ''
as $$
  with a as (
    select pl, ord, regexp_replace(pl->>'number', '\s', '', 'g') as k
      from jsonb_array_elements(case when jsonb_typeof(p_applicable) = 'array' then p_applicable else '[]'::jsonb end)
           with ordinality t(pl, ord)
     where nullif(btrim(coalesce(pl->>'number', '')), '') is not null
  ), g as (
    select pl, ord, regexp_replace(pl->>'number', '\s', '', 'g') as k
      from jsonb_array_elements(case when jsonb_typeof(p_govmap) = 'array' then p_govmap else '[]'::jsonb end)
           with ordinality t(pl, ord)
     where nullif(btrim(coalesce(pl->>'number', '')), '') is not null
  ), rows as (
    select 0 as grp, a.ord, a.pl as ap, g.pl as gp
      from a left join g on g.k = a.k
    union all
    select case when g.pl->>'notice' = 'true' then 2 else 1 end, g.ord, null, g.pl
      from g
     where not exists (select 1 from a where a.k = g.k)
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'number',      coalesce(ap->>'number', gp->>'number'),
           'description', coalesce(nullif(btrim(coalesce(ap->>'description', '')), ''), gp->>'name'),
           'year',        nullif(left(coalesce(ap->>'date', gp->>'date', ''), 4), ''),
           'kind',        gp->>'kind',
           'stage',       gp->>'stage',
           'notice',      case when gp->>'notice' = 'true' then true end,
           'permits',     gp->'permits',
           'url',         gp->>'url',
           'designation', gp->>'designation'))
           order by grp, ord), '[]'::jsonb)
    from rows;
$$;

comment on function public.planning_plans_merged(jsonb, jsonb) is
  'איחוד applicable_plans (העירייה / retzefMigrashim) עם govmap_plans (203/14), בלי כפילויות. מקור אחד לדף הנכס ולעוזר בוואטסאפ.';

revoke all on function public.planning_plans_merged(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- דף הנכס: אותה חתימה, ‏plans מהאיחוד
-- ---------------------------------------------------------------------------
create or replace function public.property_planning_public(p_property_id uuid)
returns table (
  land_zoning         text,
  building_rights_pct numeric,
  max_units           smallint,
  max_floors          smallint,
  planning_notes      text,
  parcel_status       text,
  plans               jsonb,
  updated_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(nullif(btrim(p.land_zoning), ''), nullif(btrim(i.land_use_designation), '')),
    p.land_building_rights_pct,
    p.land_max_units,
    p.land_max_floors,
    nullif(btrim(p.land_planning_notes), ''),
    nullif(btrim(i.parcel_status), ''),
    public.planning_plans_merged(i.applicable_plans, i.govmap_plans),
    greatest(i.looked_up_at, i.govmap_plans_at)
  from public.properties p
  left join public.property_planning_info i on i.property_id = p.id
  where p.id = p_property_id
    and p.status = 'active';
$$;

comment on function public.property_planning_public(uuid) is
  'מידע תכנוני כללי לדף הנכס הפומבי. ללא גוש, חלקה, שטח חלקה, קואורדינטות וגאומטריה.';

grant execute on function public.property_planning_public(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- גבריאלה: אותה פונקציה כמו 20261108090000, ‏v_plans מהאיחוד
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

  -- ‏`area_sqm` של תוכנית הוא מפתח הצטרפות ל-GIS הפומבי ואינו יוצא גם
  -- לסוכן/ת. האיחוד עם 203/14 - אותו של דף הנכס (planning_plans_merged).
  v_plans := public.planning_plans_merged(v_info.applicable_plans, v_info.govmap_plans);

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
    -- מה שנקלט מה-GIS (שכבת העירייה בעפולה, GovMap בשאר הארץ ובשכבות 203/14)
    'gis', case when v_info.property_id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'land_use_designation', nullif(btrim(v_info.land_use_designation), ''),
      'parcel_status',        nullif(btrim(v_info.parcel_status), ''),
      'applicable_plans',     v_plans,
      'looked_up_at',         greatest(v_info.looked_up_at, v_info.govmap_plans_at),
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
    'disclaimer', 'המידע כללי, מבוסס על שכבות ה-GIS של העירייה ושל GovMap (המרכז למיפוי ישראל), ואינו תחליף לבדיקה מול הוועדה המקומית לתכנון ובנייה.'
  );
end;
$$;

comment on function public.agent_property_planning(uuid, uuid) is
  'מידע תכנוני לנכס לפי מזהה סוכן/ת מפורש, לעוזר בוואטסאפ. נכס של הסוכן/ת — מידע מלא כולל גוש וחלקה; כל נכס אחר — בדיוק מה ש-property_planning_public מגישה לגולש/ת.';

revoke all on function public.agent_property_planning(uuid, uuid) from public;
revoke all on function public.agent_property_planning(uuid, uuid) from anon, authenticated;
grant execute on function public.agent_property_planning(uuid, uuid) to service_role;

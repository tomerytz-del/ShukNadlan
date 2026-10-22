-- ============================================================================
-- קישור לבדיקה תכנונית - דף קל במקום ה-CRM, והתוצאה חוזרת לוואטסאפ
--
-- ## למה
--
-- כשגבריאלה לא יכולה לענות מהשרת (כתובת בלי עסקה, מחוץ לעפולה), היא שלחה
-- קישור לכלי התכנון ב-CRM. הקישור עובד, אבל טוען את כל ה-CRM - כניסה, כ-1.5MB
-- קוד ודשבורד - לפני שהבדיקה רצה, וסוכנים נטשו באמצע (תומר, 22.10.2026).
--
-- עכשיו גבריאלה יוצרת שורה כאן ושולחת /plan?k=<id>: דף קטן שטוען רק את
-- GovMap, מריץ את הבדיקה מיד בדפדפן (צד לקוח - מה שמפ"י מתירים), ושולח את
-- התוצאה ל-planning-link. שם היא נשמרת במטמון הכתובות (‏govmap_address_planning)
-- ונשלחת לסוכן/ת בוואטסאפ.
--
-- ## ההרשאות
--
-- הטבלה והפונקציות ל-service_role בלבד: הדף מדבר רק עם planning-link, שמאמתת
-- את הקישור. הקישור הוא המפתח - 32 תווים אקראיים, 7 ימים, ותוצאה **אחת**:
-- מי שמחזיק/ה בו יכול/ה לכתוב פעם אחת את המידע של הכתובת הזו, ולא יותר.
--
-- ## והשמירה עצמה
--
-- ‏govmap_address_save (מנהל/ת פלטפורמה, ההשלמה ב-CRM) והקישור שומרים דרך
-- אותה פונקציה פנימית, _govmap_address_store - אותן בדיקות לכל שדה. הגוף שלה
-- הוא בדיוק הגוף של govmap_address_save מ-20270731090000, בלי בדיקת המנהל/ת.
-- ============================================================================

create table if not exists public.planning_links (
  id            text        primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  agent_id      uuid        not null references public.agency_members(id) on delete cascade,
  city          text,
  street        text,
  house_number  text,
  gush          text,
  helka         text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  opened_at     timestamptz,
  result_status text,
  result        jsonb,
  result_at     timestamptz,
  notified_at   timestamptz,
  notify_error  text
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.planning_links'::regclass
                    and conname = 'planning_links_target_chk') then
    alter table public.planning_links add constraint planning_links_target_chk check (
      (city is not null and street is not null and house_number is not null)
      -- ‏coalesce: בלעדיו גוש וחלקה ריקים נותנים null, ו-check על null עובר
      or (coalesce(gush, '') ~ '^\d{1,7}$' and coalesce(helka, '') ~ '^\d{1,5}$'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.planning_links'::regclass
                    and conname = 'planning_links_status_chk') then
    alter table public.planning_links add constraint planning_links_status_chk
      check (result_status is null or result_status in ('found', 'not_found'));
  end if;
end $$;

create index if not exists planning_links_agent_idx on public.planning_links (agent_id, created_at desc);

comment on table public.planning_links is
  'קישורים לדף הבדיקה התכנונית (/plan?k=). גבריאלה יוצרת, planning-link מאמתת ושומרת. docs/govmap.md.';

alter table public.planning_links enable row level security;
revoke all on table public.planning_links from public, anon, authenticated;
grant select, insert, update, delete on table public.planning_links to service_role;

-- ---------------------------------------------------------------------------
-- השמירה למטמון הכתובות - פנימית, משותפת להשלמה ב-CRM ולקישור
-- ---------------------------------------------------------------------------
create or replace function public._govmap_address_store(
  p_city text, p_street text, p_house_number text, p_record jsonb)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cid    uuid;
  v_sk     text := public.street_name_key(p_street);
  v_num    text := btrim(coalesce(p_house_number, ''));
  v_gush   text;
  v_helka  text;
  v_clean  jsonb;
  v_plans  jsonb;
  v_gplans jsonb;
  v_lat    numeric;
  v_lng    numeric;
begin
  v_cid := public.city_id_for_name(btrim(coalesce(p_city, '')));
  if v_cid is null then raise exception 'unknown_city'; end if;
  if coalesce(v_sk, '') = '' or v_num !~ '^\d{1,4}[א-ת]?$' then raise exception 'bad_address'; end if;

  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    insert into public.govmap_address_planning as g
      (city_id, street_key, house_number, city, street, status, gush, helka, record, fetched_at)
    values (v_cid, v_sk, v_num, btrim(p_city), btrim(p_street), 'not_found', null, null, null, now())
    on conflict (city_id, street_key, house_number) do update set
      status = 'not_found', gush = null, helka = null, record = null, fetched_at = now();
    return 'not_found';
  end if;

  v_gush  := nullif(btrim(coalesce(p_record->>'gush', '')), '');
  v_helka := nullif(btrim(coalesce(p_record->>'helka', '')), '');
  if v_gush is not null and v_gush !~ '^\d{1,7}$' then raise exception 'bad_gush'; end if;
  if v_helka is not null and v_helka !~ '^\d{1,5}$' then raise exception 'bad_helka'; end if;

  if jsonb_typeof(p_record->'lat') = 'number' and jsonb_typeof(p_record->'lng') = 'number' then
    v_lat := (p_record->>'lat')::numeric;
    v_lng := (p_record->>'lng')::numeric;
    if v_lat not between 29.3 and 33.5 or v_lng not between 34.2 and 35.95 then
      raise exception 'bad_coordinates';
    end if;
  end if;

  -- התוכנית המפורטת (retzefMigrashim): מספר ותאריך בלבד
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'number', left(btrim(pl->>'number'), 100),
           'date',   case when coalesce(pl->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then pl->>'date' end))), '[]'::jsonb)
    into v_plans
    from jsonb_array_elements(case when jsonb_typeof(p_record->'applicable_plans') = 'array'
                                   then p_record->'applicable_plans' else '[]'::jsonb end) pl
   where jsonb_typeof(pl) = 'object' and nullif(btrim(coalesce(pl->>'number', '')), '') is not null;

  -- שכבות 203/14: אותם שדות מותרים כמו govmap_plans_write (20270724090000)
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
    into v_gplans
    from jsonb_array_elements(case when jsonb_typeof(p_record->'govmap_plans') = 'array'
                                   then p_record->'govmap_plans' else '[]'::jsonb end) with ordinality t(pl, ord)
   where jsonb_typeof(pl) = 'object' and nullif(btrim(coalesce(pl->>'number', '')), '') is not null;

  if jsonb_array_length(v_plans) > 30 or jsonb_array_length(v_gplans) > 40 then
    raise exception 'bad_plans';
  end if;

  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'parcel_area_sqm',      case when jsonb_typeof(p_record->'parcel_area_sqm') = 'number'
                                  and (p_record->>'parcel_area_sqm')::numeric between 0 and 100000000
                                 then (p_record->>'parcel_area_sqm')::numeric end,
    'parcel_status',        left(nullif(btrim(coalesce(p_record->>'parcel_status', '')), ''), 100),
    'land_use_designation', left(nullif(btrim(coalesce(p_record->>'land_use_designation', '')), ''), 200),
    'neighborhood',         left(nullif(btrim(coalesce(p_record->>'neighborhood', '')), ''), 200),
    'pin_source',           case when p_record->>'pin_source' in ('address', 'parcel') then p_record->>'pin_source' end,
    'lat', v_lat, 'lng', v_lng,
    'applicable_plans', v_plans,
    'govmap_plans', case when jsonb_typeof(p_record->'govmap_plans') = 'array' then v_gplans end));

  insert into public.govmap_address_planning as g
    (city_id, street_key, house_number, city, street, status, gush, helka, record, fetched_at)
  values (v_cid, v_sk, v_num, btrim(p_city), btrim(p_street), 'found', v_gush, v_helka, v_clean, now())
  on conflict (city_id, street_key, house_number) do update set
    status = 'found', gush = excluded.gush, helka = excluded.helka,
    record = excluded.record, fetched_at = excluded.fetched_at,
    city = excluded.city, street = excluded.street;
  return 'found';
end;
$$;

comment on function public._govmap_address_store(text, text, text, jsonb) is
  'פנימית: אימות ושמירה של רשומת GovMap במטמון הכתובות. רק דרך govmap_address_save או planning_link_complete.';

revoke all on function public._govmap_address_store(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public._govmap_address_store(text, text, text, jsonb) to service_role;

create or replace function public.govmap_address_save(
  p_city text, p_street text, p_house_number text, p_record jsonb)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  return public._govmap_address_store(p_city, p_street, p_house_number, p_record);
end;
$$;

revoke all on function public.govmap_address_save(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.govmap_address_save(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- יצירת קישור - גבריאלה. עד 40 ליום לסוכן/ת: קישור הוא גם הרשאת כתיבה
-- למטמון, ואין סיבה שיהיו ממנו מאות.
-- ---------------------------------------------------------------------------
create or replace function public.planning_link_create(
  p_agent uuid, p_city text, p_street text, p_house_number text, p_gush text, p_helka text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id    text;
  v_city  text := nullif(btrim(coalesce(p_city, '')), '');
  v_st    text := nullif(btrim(coalesce(p_street, '')), '');
  v_num   text := nullif(btrim(coalesce(p_house_number, '')), '');
  v_gush  text := nullif(regexp_replace(coalesce(p_gush, ''), '\D', '', 'g'), '');
  v_helka text := nullif(regexp_replace(coalesce(p_helka, ''), '\D', '', 'g'), '');
begin
  if p_agent is null then return null; end if;
  if (select count(*) from public.planning_links
       where agent_id = p_agent and created_at > now() - interval '1 day') >= 40 then
    return null;
  end if;
  -- אותו קישור לאותה שאלה בשעה האחרונה, אם עוד לא נענה: לא מייצרים כפילויות
  select l.id into v_id from public.planning_links l
   where l.agent_id = p_agent and l.result_at is null and l.expires_at > now()
     and l.created_at > now() - interval '1 hour'
     and coalesce(l.city, '') = coalesce(v_city, '') and coalesce(l.street, '') = coalesce(v_st, '')
     and coalesce(l.house_number, '') = coalesce(v_num, '')
     and coalesce(l.gush, '') = coalesce(v_gush, '') and coalesce(l.helka, '') = coalesce(v_helka, '')
   order by l.created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.planning_links (agent_id, city, street, house_number, gush, helka)
  values (p_agent, left(v_city, 80), left(v_st, 120), left(v_num, 10), left(v_gush, 7), left(v_helka, 5))
  returning id into v_id;
  return v_id;
exception when check_violation then
  return null;
end;
$$;

revoke all on function public.planning_link_create(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.planning_link_create(uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- פתיחה - הדף. ‏null = אין קישור כזה, או שפג. מחזירה רק את הכתובת.
-- ---------------------------------------------------------------------------
create or replace function public.planning_link_open(p_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v public.planning_links;
begin
  if coalesce(p_id, '') !~ '^[0-9a-f]{32}$' then return null; end if;
  update public.planning_links l set opened_at = coalesce(l.opened_at, now())
   where l.id = p_id and l.expires_at > now()
  returning * into v;
  if v.id is null then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'city', v.city, 'street', v.street, 'house_number', v.house_number,
    'gush', v.gush, 'helka', v.helka, 'done', v.result_at is not null,
    'result', v.result));
end;
$$;

revoke all on function public.planning_link_open(text) from public, anon, authenticated;
grant execute on function public.planning_link_open(text) to service_role;

-- ---------------------------------------------------------------------------
-- תוצאה - הדף, דרך planning-link. פעם אחת לקישור. כתובת נשמרת גם במטמון של
-- גבריאלה (‏_govmap_address_store, אותן בדיקות כמו ההשלמה ב-CRM). מחזירה את
-- מה ש-planning-link צריכה כדי לשלוח את ההודעה, או null.
-- ---------------------------------------------------------------------------
create or replace function public.planning_link_complete(p_id text, p_record jsonb, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v       public.planning_links;
  v_stat  text;
  v_phone text;
begin
  if coalesce(p_id, '') !~ '^[0-9a-f]{32}$' then return null; end if;
  select * into v from public.planning_links l
   where l.id = p_id and l.expires_at > now() and l.result_at is null
   for update;
  if v.id is null then return null; end if;

  if v.city is not null then
    v_stat := public._govmap_address_store(v.city, v.street, v.house_number, p_record);
  else
    v_stat := case when p_record is null or jsonb_typeof(p_record) <> 'object' then 'not_found' else 'found' end;
  end if;

  update public.planning_links l
     set result_status = v_stat,
         result = case when jsonb_typeof(p_result) = 'object' and length(p_result::text) < 20000 then p_result end,
         result_at = now()
   where l.id = v.id;

  select m.phone_e164 into v_phone from public.agency_members m where m.id = v.agent_id;
  return jsonb_strip_nulls(jsonb_build_object(
    'status', v_stat, 'phone', v_phone, 'agent_id', v.agent_id,
    'city', v.city, 'street', v.street, 'house_number', v.house_number,
    'gush', v.gush, 'helka', v.helka));
end;
$$;

revoke all on function public.planning_link_complete(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.planning_link_complete(text, jsonb, jsonb) to service_role;

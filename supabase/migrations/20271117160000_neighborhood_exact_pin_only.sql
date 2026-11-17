-- ============================================================================
-- שיוך שכונה רק מפין מדויק, ושם של אזור בתכנון לא יוצא לציבור
--
-- ## מה נשבר
--
-- נכס שהגאוקוד שלו נכשל מקבל location_precision = 'city' ואת מרכז עפולה
-- (32.616817, 35.302557). הנקודה הזו נופלת במצולע "B1 אזור בתכנון"
-- (is_planned). הטריגר properties_set_neighborhood_trg מילא neighborhood_id
-- מהפין בלי לשאול אם הפין הוא כתובת, ו-37 נכסים קיבלו את השם התכנוני
-- ככותרת בתמונה השיווקית, בפוסט, בסטורי, בדף הנכס ובוואטסאפ.
--
-- המצולע אינו אזור התעשייה. "אזור התעשייה" הוא מצולע נפרד, והמרכז העירוני
-- אינו בתוכו. לכן לא משנים את השם ל"אזור התעשייה": זה היה מאחד שני שטחים
-- שונים. is_planned כבר מסמן אזור תכנון. הציבור לא רואה את השם, והמצולע
-- נשאר.
--
-- null ב-location_precision נשאר ניתן לשיוך. זה פין ישן שלא סווג, לא מרכז
-- עיר. הערכים שאינם מדויקים הם city, street, neighborhood, zone, parcel.
--
-- ## הניקוי
--
-- neighborhood_id מתאפס בשיוך למצולע הזה כשהדיוק אינו exact ואינו null.
-- פין exact שנשאר על B1 מחושב מחדש: neighborhood_for_city_point, והשיוך
-- הוא המצולע היחיד שהנקודה נופלת בו, או null. המלאכה 25 (1476) נופלת
-- באזור התעשייה ולא ב-B1. חוץ ממודעות 1306, 1307, 1315, 1316. שאר
-- העמודות לא נכתבות, חוץ ממונה הגאוקוד של מי שיש לו רחוב ומספר בית
-- (התור הקיים, geocode_backfill_queue) וחוץ מטביעת התיאור, שהטריגר
-- מחשב כי neighborhood_id הוא חלק ממנה.
--
-- הטריגרים של התראות חיפוש, התאמות, ומיקום משוער כבויים למשך העדכון.
-- כיבוי טריגר הוא בתוך הטרנזקציה: כשל מחזיר אותם. אין שורת תור לתיאור
-- ואין insert ל-notifications.
--
-- תיעוד: docs/neighborhood-assignment.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- דיוק שממנו מותר לגזור שכונה
-- ---------------------------------------------------------------------------
create or replace function public.location_pin_is_exact(p_precision text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_precision is null or p_precision = 'exact';
$$;

comment on function public.location_pin_is_exact(text) is
  'true לפין מדויק ולפין ישן שלא סווג (null). false ל-city, street, neighborhood, zone, parcel. מרכז עיר אינו כתובת.';

revoke all on function public.location_pin_is_exact(text) from public, anon, authenticated;
grant execute on function public.location_pin_is_exact(text) to service_role;

-- ---------------------------------------------------------------------------
-- שם שכונה לציבור. אזור בתכנון יוצא ריק, בלי לגעת בשם שבטבלה.
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_public_name(p_is_planned boolean, p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_is_planned, false) then null
    else nullif(btrim(coalesce(p_name, '')), '')
  end;
$$;

comment on function public.neighborhood_public_name(boolean, text) is
  'השם שמותר להציג. is_planned מחזיר null. השם התכנוני נשאר ב-neighborhoods.name.';

revoke all on function public.neighborhood_public_name(boolean, text) from public, anon, authenticated;
grant execute on function public.neighborhood_public_name(boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- הטריגר: לא ממלאים שכונה מפין משוער
-- ---------------------------------------------------------------------------
create or replace function public.properties_set_neighborhood()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.location_pin_is_exact(new.location_precision) then
    return new;
  end if;
  new.neighborhood_id := public.neighborhood_for_city_point(
    new.city_id, new.city, new.lat, new.lng);
  -- מילוי שכונה לנכס שכבר קיים אינו אירוע התאמה. הדגל נקרא בטריגרי
  -- ההתראה של אותו update (גאוקוד שהצליח אחרי שהשיוך אופס).
  if tg_op = 'UPDATE'
     and old.neighborhood_id is null
     and new.neighborhood_id is not null then
    perform set_config('app.neighborhood_autofill', '1', true);
  end if;
  return new;
end $$;

comment on function public.properties_set_neighborhood() is
  'ממלא neighborhood_id חסר מהפין רק כשהדיוק exact או null, ורק במצולע אחד. אינו דורס שיוך קיים.';

revoke all on function public.properties_set_neighborhood() from public, anon, authenticated;

-- מילוי שכונה לנכס קיים (הגאוקוד החזיר exact והטריגר מילא neighborhood_id
-- שהיה ריק) אינו נכס חדש. הטריגר לא נורה. שינוי משכונה אחרת, או שינוי
-- מחיר באותו update, כן. הרשימה היא זו שרצה בפרודקשן, עם התנאי על השכונה.
drop trigger if exists properties_saved_search_alerts_upd on public.properties;
create trigger properties_saved_search_alerts_upd
  after update on public.properties
  for each row
  when (
    new.status = 'active'
    and (
      old.status is distinct from new.status
      or old.price is distinct from new.price
      or old.rooms is distinct from new.rooms
      or old.size_sqm is distinct from new.size_sqm
      or old.area_sqm is distinct from new.area_sqm
      or old.floor is distinct from new.floor
      or old.city is distinct from new.city
      or old.property_type is distinct from new.property_type
      or old.deal_type is distinct from new.deal_type
      or old.category is distinct from new.category
      or old.condition is distinct from new.condition
      or old.features is distinct from new.features
      or (
        old.neighborhood_id is distinct from new.neighborhood_id
        and not (
          old.neighborhood_id is null
          and new.neighborhood_id is not null
          and pg_catalog.current_setting('app.neighborhood_autofill', true) = '1'
        )
      )
    )
  )
  execute function public.properties_saved_search_alerts();

drop trigger if exists properties_client_match_alerts_upd on public.properties;
create trigger properties_client_match_alerts_upd
  after update on public.properties
  for each row
  when (
    new.status = 'active'
    and (
      old.status is distinct from new.status
      or old.price is distinct from new.price
      or old.rooms is distinct from new.rooms
      or old.size_sqm is distinct from new.size_sqm
      or old.floor is distinct from new.floor
      or old.city is distinct from new.city
      or old.property_type is distinct from new.property_type
      or old.deal_type is distinct from new.deal_type
      or old.category is distinct from new.category
      or old.features is distinct from new.features
      or (
        old.neighborhood_id is distinct from new.neighborhood_id
        and not (
          old.neighborhood_id is null
          and new.neighborhood_id is not null
          and pg_catalog.current_setting('app.neighborhood_autofill', true) = '1'
        )
      )
    )
  )
  execute function public.properties_client_match_alerts();

-- ---------------------------------------------------------------------------
-- הדוח וההחלה: פין משוער הוא approx_pin, ולא fill
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_assignment_report(p_city text)
returns table (
  property_id  uuid,
  street       text,
  house_number text,
  assigned_now text,
  computed     text,
  computed_id  uuid,
  n_matches    integer,
  verdict      text)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select p.id, p.street, p.house_number, p.lat, p.lng, p.neighborhood_id,
           p.location_precision,
           (select array_agg(n.id order by n.name)
              from public.neighborhoods n
             where n.city = p_city
               and n.boundary is not null
               and public.point_in_ring(n.boundary, p.lat, p.lng)) as hits
      from public.properties p
     where p.status = 'active' and p.city = p_city)
  select m.id, m.street, m.house_number,
         (select n.name from public.neighborhoods n where n.id = m.neighborhood_id),
         (select string_agg(n.name, ' + ' order by n.name)
            from public.neighborhoods n where n.id = any(coalesce(m.hits, '{}'::uuid[]))),
         case when array_length(m.hits, 1) = 1 then m.hits[1] end,
         coalesce(array_length(m.hits, 1), 0),
         case
           when m.lat is null or m.lng is null                         then 'no_pin'
           when not public.location_pin_is_exact(m.location_precision) then 'approx_pin'
           when coalesce(array_length(m.hits, 1), 0) = 0               then 'no_polygon'
           when array_length(m.hits, 1) > 1                            then 'ambiguous'
           when m.neighborhood_id is null                              then 'fill'
           when m.neighborhood_id <> m.hits[1]                         then 'change'
           else 'ok'
         end
    from m
   order by 8, 2, 3;
$$;

comment on function public.neighborhood_assignment_report(text) is
  'דוח שיוך שכונות מהפין. approx_pin אינו נכתב: פין city/street/neighborhood/zone/parcel אינו כתובת.';

revoke all on function public.neighborhood_assignment_report(text) from public, anon, authenticated;
grant execute on function public.neighborhood_assignment_report(text) to service_role;

create or replace function public.neighborhood_apply_from_point(p_city text)
returns table (filled integer, changed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fill    integer := 0;
  v_change  integer := 0;
begin
  perform public.notification_push_suppress(true);
  with r as (
    select report.property_id, report.computed_id
      from public.neighborhood_assignment_report(p_city) report
      join public.properties p on p.id = report.property_id
     where report.verdict = 'fill'
       and report.computed_id is not null
       and public.location_pin_is_exact(p.location_precision))
  update public.properties p
     set neighborhood_id = r.computed_id
    from r
   where p.id = r.property_id
     and p.neighborhood_id is null
     and public.location_pin_is_exact(p.location_precision);
  get diagnostics v_fill = row_count;

  with r as (
    select report.property_id, report.computed_id
      from public.neighborhood_assignment_report(p_city) report
      join public.properties p on p.id = report.property_id
     where report.verdict = 'change'
       and report.computed_id is not null
       and public.location_pin_is_exact(p.location_precision))
  update public.properties p
     set neighborhood_id = r.computed_id
    from r
   where p.id = r.property_id
     and public.location_pin_is_exact(p.location_precision);
  get diagnostics v_change = row_count;

  return query select v_fill, v_change;
end $$;

comment on function public.neighborhood_apply_from_point(text) is
  'מחילה fill ו-change רק על פין exact או null. פין משוער נשאר בלי שכונה מהמצולע.';

revoke all on function public.neighborhood_apply_from_point(text) from public, anon, authenticated;
grant execute on function public.neighborhood_apply_from_point(text) to service_role;

-- ---------------------------------------------------------------------------
-- עובדות לתיאור, לפוסט ולתור הפרסום: בלי שם של אזור בתכנון
-- ---------------------------------------------------------------------------
create or replace function public.property_marketing_facts(p_property_id uuid)
returns table (
  property_id       uuid,
  listing_number    bigint,
  title             text,
  description       text,
  marketing_description text,
  post_text         text,
  property_type     text,
  deal_type         text,
  category          text,
  price             numeric,
  rooms             numeric,
  size_sqm          numeric,
  built_size_sqm    numeric,
  garden_sqm        numeric,
  floor             int,
  total_floors      smallint,
  city              text,
  neighborhood      text,
  street            text,
  features          text[],
  condition         text,
  project_status    text,
  move_in_date      date,
  furniture_details text,
  land_zoning       text,
  land_building_rights_pct numeric,
  land_max_units    smallint,
  land_max_floors   smallint,
  land_planning_notes text,
  agent_name        text,
  agency_name       text,
  marketing_description_source text,
  marketing_description_stale  boolean,
  living_room_sqm   numeric,
  air_directions    text[]
)
language sql
security definer
set search_path = ''
as $$
  select
    p.id, p.listing_number, p.title, p.description,
    p.marketing_description, p.post_text,
    p.property_type, p.deal_type, p.category,
    p.price, p.rooms::numeric,
    coalesce(p.size_sqm, p.area_sqm)::numeric, p.built_size_sqm, p.garden_sqm,
    p.floor::int, p.total_floors,
    p.city, public.neighborhood_public_name(n.is_planned, n.name), p.street,
    p.features, p.condition, p.project_status, p.move_in_date, p.furniture_details,
    p.land_zoning, p.land_building_rights_pct, p.land_max_units,
    p.land_max_floors, p.land_planning_notes,
    m.display_name, a.name,
    p.marketing_description_source, p.marketing_description_stale,
    p.living_room_sqm, p.air_directions
    from public.properties p
    left join public.neighborhoods  n on n.id = p.neighborhood_id
    left join public.agency_members m on m.id = p.agent_id
    left join public.agencies       a on a.id = p.agency_id
   where p.id = p_property_id;
$$;

revoke all on function public.property_marketing_facts(uuid) from public, anon, authenticated;
grant execute on function public.property_marketing_facts(uuid) to service_role;

comment on function public.property_marketing_facts(uuid) is
  'כל מה שנכנס לתיאור השיווקי. שכונה עם is_planned אינה נכנסת לשורת המיקום.';

create or replace function public.pending_property_publications(
  p_limit integer default 10,
  p_property_id uuid default null,
  p_channels text[] default array['facebook_page']
)
returns table (
  publication_id uuid,
  property_id uuid,
  listing_number bigint,
  title text,
  description text,
  marketing_description text,
  post_text text,
  property_type text,
  deal_type text,
  category text,
  price numeric,
  rooms numeric,
  size_sqm numeric,
  garden_sqm numeric,
  floor integer,
  total_floors smallint,
  city text,
  neighborhood text,
  street text,
  features text[],
  condition text,
  move_in_date date,
  furniture_details text,
  images text[],
  marketing_image text,
  agent_name text,
  agent_phone text,
  agency_name text,
  channel text
)
language sql
security definer
set search_path = ''
as $$
  with posted_today as (
    select pp.channel, count(*) as n
      from public.property_publications pp
     where pp.status = 'posted' and pp.posted_at > now() - interval '24 hours'
     group by pp.channel
  )
  select
    pub.id, p.id, p.listing_number, p.title, p.description,
    p.marketing_description, p.post_text,
    p.property_type, p.deal_type, p.category,
    p.price, p.rooms::numeric,
    coalesce(p.size_sqm, p.area_sqm)::numeric, p.garden_sqm,
    p.floor::int, p.total_floors,
    p.city, public.neighborhood_public_name(n.is_planned, n.name), p.street,
    p.features, p.condition, p.move_in_date, p.furniture_details,
    p.images, p.marketing_image,
    m.display_name, coalesce(m.phone_e164, m.phone), a.name,
    pub.channel
    from public.property_publications pub
    join public.properties p on p.id = pub.property_id
    left join public.neighborhoods  n on n.id = p.neighborhood_id
    left join public.agency_members m on m.id = p.agent_id
    left join public.agencies       a on a.id = p.agency_id
    left join posted_today          t on t.channel = pub.channel
   where pub.status = 'pending'
     and p.status = 'active'
     and pub.channel = any(coalesce(p_channels, array['facebook_page']))
     and public.property_has_publishable_image(p.images, p.marketing_image)
     and (p_property_id is null or p.id = p_property_id)
     and (p_property_id is not null or pub.publish_after <= now())
     and (p_property_id is not null
          or coalesce(t.n, 0) < case pub.channel
               when 'instagram' then
                 coalesce((select value::int from public.pricing_config
                            where key = 'instagram_autopost_daily_cap'), 12)
               else
                 coalesce((select value::int from public.pricing_config
                            where key = 'facebook_autopost_daily_cap'), 12)
             end)
     and (p_property_id is not null
          or public.publication_channel_enabled(pub.channel))
   order by pub.publish_after, pub.channel
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

revoke all on function public.pending_property_publications(integer, uuid, text[]) from public, anon, authenticated;
grant execute on function public.pending_property_publications(integer, uuid, text[]) to service_role;

create or replace function public.instagram_feed(p_limit integer default 30)
returns table (
  property_id uuid,
  listing_number bigint,
  title text,
  deal_type text,
  category text,
  property_type text,
  price numeric,
  price_includes_vat boolean,
  rooms numeric,
  size_sqm numeric,
  city text,
  neighborhood text,
  image text,
  posted_at timestamp with time zone,
  price_unit text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.listing_number, p.title, p.deal_type, p.category, p.property_type,
         p.price, p.price_includes_vat, p.rooms::numeric,
         coalesce(p.size_sqm, p.area_sqm)::numeric,
         p.city, public.neighborhood_public_name(n.is_planned, n.name),
         coalesce(p.images[1], p.marketing_image),
         pub.posted_at,
         p.price_unit
    from public.property_publications pub
    join public.properties p on p.id = pub.property_id
    left join public.neighborhoods n on n.id = p.neighborhood_id
   where pub.channel = 'instagram'
     and pub.status = 'posted'
     and p.status = 'active'
   order by pub.posted_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 60);
$$;

-- הדף הציבורי קורא לפונקציה בלי התחברות. ההרשאה הזו כבר הייתה, ו-replace שומר אותה.
revoke all on function public.instagram_feed(integer) from public;
grant execute on function public.instagram_feed(integer) to anon, authenticated, service_role;

create or replace function public.saved_search_pending_alerts(p_limit integer default 50)
returns table (
  alert_id uuid,
  search_id uuid,
  full_name text,
  phone_e164 text,
  email text,
  contact_channel text,
  label text,
  unsubscribe_token text,
  click_token text,
  property_id uuid,
  title text,
  price numeric,
  rooms numeric,
  size_sqm numeric,
  floor integer,
  city text,
  neighborhood text,
  street text,
  property_type text,
  deal_type text,
  image_url text
)
language sql
security definer
set search_path = ''
as $$
  with cap as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'saved_search_daily_cap'), 5) as daily_cap
  ),
  sent_today as (
    select a.search_id, count(*)::int as n
      from public.saved_search_alerts a
     where a.status = 'sent' and a.sent_at > now() - interval '24 hours'
     group by a.search_id
  ),
  ready as (
    select
      a.id as alert_id,
      s.id as search_id,
      s.full_name,
      s.phone_e164,
      s.email,
      s.contact_channel,
      s.label,
      s.unsubscribe_token,
      a.click_token,
      p.id as property_id,
      p.title,
      p.price,
      p.rooms::numeric as rooms,
      coalesce(p.size_sqm, p.area_sqm)::numeric as size_sqm,
      p.floor::int as floor,
      p.city,
      public.neighborhood_public_name(n.is_planned, n.name) as neighborhood,
      p.street,
      p.property_type,
      p.deal_type,
      (case when array_length(p.images, 1) > 0 then p.images[1] else null end) as image_url,
      a.created_at,
      row_number() over (partition by a.search_id order by a.created_at, a.id) as rn,
      coalesce(t.n, 0) as sent_n,
      cap.daily_cap
    from public.saved_search_alerts a
    join public.saved_searches s on s.id = a.search_id
    join public.properties p on p.id = a.property_id
    left join public.neighborhoods n on n.id = p.neighborhood_id
    cross join cap
    left join sent_today t on t.search_id = a.search_id
    where a.status = 'pending'
      and s.status = 'active'
      and p.status = 'active'
      and not public.saved_search_quiet_now()
  )
  select
    alert_id, search_id, full_name, phone_e164, email, contact_channel,
    label, unsubscribe_token, click_token, property_id, title, price, rooms,
    size_sqm, floor, city, neighborhood, street, property_type, deal_type, image_url
  from ready
  where rn <= greatest(daily_cap - sent_n, 0)
  order by created_at, alert_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.saved_search_pending_alerts(integer) from public, anon, authenticated;
grant execute on function public.saved_search_pending_alerts(integer) to service_role;

create or replace function public.customer_due_alerts(p_limit integer default 50)
returns table (
  alert_id uuid,
  search_id uuid,
  full_name text,
  phone_e164 text,
  email text,
  contact_channel text,
  label text,
  unsubscribe_token text,
  click_token text,
  property_id uuid,
  title text,
  price numeric,
  rooms numeric,
  size_sqm numeric,
  floor integer,
  city text,
  neighborhood text,
  street text,
  property_type text,
  deal_type text,
  image_url text,
  whatsapp_status text,
  email_status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.customer_prepare(pg_catalog.now());
  return query
    select a.id, s.id, s.full_name, s.phone_e164, s.email, s.contact_channel,
           s.label, s.unsubscribe_token, a.click_token,
           p.id, p.title, p.price, p.rooms::numeric,
           coalesce(p.size_sqm, p.area_sqm)::numeric, p.floor::int,
           p.city, public.neighborhood_public_name(n.is_planned, n.name),
           p.street, p.property_type, p.deal_type,
           (case when array_length(p.images, 1) > 0 then p.images[1] else null end),
           a.whatsapp_status, a.email_status
      from public.saved_search_alerts a
      join public.saved_searches s on s.id = a.search_id
      join public.properties p on p.id = a.property_id
      left join public.neighborhoods n on n.id = p.neighborhood_id
     where a.status = 'pending'
       and s.status = 'active'
       and p.status = 'active'
     order by a.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.customer_due_alerts(integer) from public, anon, authenticated;
grant execute on function public.customer_due_alerts(integer) to service_role;

-- ---------------------------------------------------------------------------
-- ניקוי השיוך השגוי. בלי התראות ובלי הזזת הפין.
-- ---------------------------------------------------------------------------
do $$
declare
  v_hood uuid;
  v_rows bigint;
begin
  select n.id into v_hood
    from public.neighborhoods n
   where n.city = 'עפולה'
     and n.name = 'B1 אזור בתכנון'
     and n.is_planned
   limit 1;
  if v_hood is null then
    raise notice 'B1 אזור בתכנון לא נמצא. אין מה לנקות.';
    return;
  end if;

  perform public.notification_push_suppress(true);

  -- התראה על שינוי שכונה, ומחיקת פין משוער כשהשכונה זזה.
  alter table public.properties disable trigger properties_saved_search_alerts_upd;
  alter table public.properties disable trigger properties_client_match_alerts_upd;
  alter table public.properties disable trigger properties_prune_stale_alerts;
  alter table public.properties disable trigger properties_locate_street_trg;
  alter table public.properties disable trigger properties_zone_location_trg;

  update public.properties p
     set neighborhood_id = null,
         geocode_attempts = case
           when nullif(btrim(coalesce(p.street, '')), '') is not null
            and nullif(btrim(coalesce(p.house_number, '')), '') is not null
           then 0
           else p.geocode_attempts
         end,
         geocode_attempted_at = case
           when nullif(btrim(coalesce(p.street, '')), '') is not null
            and nullif(btrim(coalesce(p.house_number, '')), '') is not null
           then null
           else p.geocode_attempted_at
         end,
         geocode_error = case
           when nullif(btrim(coalesce(p.street, '')), '') is not null
            and nullif(btrim(coalesce(p.house_number, '')), '') is not null
           then null
           else p.geocode_error
         end
   where p.neighborhood_id = v_hood
     and not public.location_pin_is_exact(p.location_precision)
     and p.listing_number not in (1306, 1307, 1315, 1316);
  get diagnostics v_rows = row_count;
  raise notice 'שיוך B1 הוסר מ-% נכסים עם פין שאינו מדויק', v_rows;

  -- פין exact שעדיין על B1: הנקודה כבר לא המרכז העירוני. שיוך מחדש
  -- למצולע היחיד, או null כשאין מצולע אחד. הפין לא זז.
  -- properties_track_marketing_copy לא משכתב את טביעת האצבע כשהטקסט
  -- לא השתנה. הטביעה השמורה (עם B1) שונה מהטביעה החדשה (השכונה הנכונה),
  -- ולכן marketing_description_stale נשאר דולק. לא כותבים את הדגל ביד:
  -- הטריגר הוא מי שקובע אותו, ודריסה ידנית הייתה נמחקת באותו before.
  update public.properties p
     set neighborhood_id = public.neighborhood_for_city_point(
           p.city_id, p.city, p.lat, p.lng)
   where p.neighborhood_id = v_hood
     and p.location_precision = 'exact'
     and p.listing_number not in (1306, 1307, 1315, 1316)
     and p.neighborhood_id is distinct from public.neighborhood_for_city_point(
           p.city_id, p.city, p.lat, p.lng);
  get diagnostics v_rows = row_count;
  raise notice 'שיוך B1 חושב מחדש ל-% נכסים עם פין מדויק', v_rows;

  -- פין exact שהמצולע היחיד שלו הוא עדיין B1, והנוסח מצטט את השם:
  -- הטביעה זזה כדי שהטריגר יסמן stale. הטקסט עצמו לא נמחק.
  update public.properties p
     set marketing_description_fingerprint =
           md5(coalesce(p.marketing_description_fingerprint, '') || '|planned-hood')
   where p.neighborhood_id = v_hood
     and p.listing_number not in (1306, 1307, 1315, 1316)
     and (
       position('B1' in coalesce(p.marketing_description, '') || coalesce(p.post_text, '')) > 0
       or position('בתכנון' in coalesce(p.marketing_description, '') || coalesce(p.post_text, '')) > 0
     );
  get diagnostics v_rows = row_count;
  raise notice 'טביעת תיאור סומנה לחידוש ב-% נכסים שנשארו על B1 והנוסח מצטט אותו', v_rows;

  alter table public.properties enable trigger properties_saved_search_alerts_upd;
  alter table public.properties enable trigger properties_client_match_alerts_upd;
  alter table public.properties enable trigger properties_prune_stale_alerts;
  alter table public.properties enable trigger properties_locate_street_trg;
  alter table public.properties enable trigger properties_zone_location_trg;

  if exists (
    select 1
      from public.properties p
     where p.neighborhood_id = v_hood
       and not public.location_pin_is_exact(p.location_precision)
       and p.listing_number not in (1306, 1307, 1315, 1316)
  ) then
    raise exception 'נשארו נכסים עם פין שאינו מדויק על B1 אזור בתכנון';
  end if;

  if exists (
    select 1
      from public.properties p
     where p.neighborhood_id = v_hood
       and p.location_precision = 'exact'
       and p.listing_number not in (1306, 1307, 1315, 1316)
       and p.neighborhood_id is distinct from public.neighborhood_for_city_point(
             p.city_id, p.city, p.lat, p.lng)
  ) then
    raise exception 'פין מדויק על B1 לא תואם את המצולע';
  end if;
end $$;

-- סיכום השיתוף בוואטסאפ. אותו גוף כמו 20271117140000, והשכונה עוברת
-- ב-neighborhood_public_name כדי שאזור בתכנון לא ייכנס להודעה.

create or replace function public.share_digest_preview()
returns table (
  agent_first_name text,
  sharer_first_name text,
  property_type text,
  price text,
  property_id uuid,
  city text,
  deal_type text,
  rooms numeric,
  neighborhood text,
  summary text
)
language sql
stable
security definer
set search_path = ''
as $$
  with cut as (
    select s.enabled_at as since
      from public.share_digest_state s
     where s.id = 1
       and s.enabled_at is not null
  )
  select split_part(btrim(coalesce(m.display_name, '')), ' ', 1),
         coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד'),
         coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
         case
           when p.price is null or p.price <= 0 then 'מחיר לא צוין'
           else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
         end,
         p.id,
         nullif(btrim(coalesce(p.city, '')), ''),
         nullif(btrim(coalesce(p.deal_type, '')), ''),
         case when p.rooms is null or p.rooms <= 0 then null else p.rooms end,
         public.neighborhood_public_name(nb.is_planned, nb.name),
         public.share_digest_describe(
           coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
           nullif(btrim(coalesce(p.deal_type, '')), ''),
           nullif(btrim(coalesce(p.city, '')), ''),
           public.neighborhood_public_name(nb.is_planned, nb.name),
           case when p.rooms is null or p.rooms <= 0 then null else p.rooms end,
           case
             when p.price is null or p.price <= 0 then 'מחיר לא צוין'
             else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
           end
         ) || E'\nשותף ע"י ' || coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד')
    from public.notifications n
    join public.agency_members m on m.id = n.agent_id
    join public.properties p on p.id = n.related_property_id
    left join public.neighborhoods nb on nb.id = p.neighborhood_id
    left join lateral (
      select ps.owner_agent_id
        from public.property_shares ps
        join public.agency_members recv on recv.id = n.agent_id
       where ps.property_id = p.id
         and ps.shared_with_agency_id = recv.agency_id
       limit 1
    ) share on true
    left join public.agency_members sh on sh.id = share.owner_agent_id
    cross join cut
   where n.type = 'system'
     and n.title = 'נכס חדש שותף איתך'
     and n.related_property_id is not null
     and n.created_at > cut.since
     and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                   where r.agent_id = n.agent_id), cut.since)
     and not exists (
       select 1 from public.notification_push_log l
        where n.id = any (l.notification_ids))
     and not exists (
       select 1 from public.share_digest_lines sl
        where sl.source_notification_id = n.id);
$$;


comment on function public.share_digest_preview() is
  'תצוגה יבשה של הסיכום הבא. שם פרטי, סוג, מחיר, עיר, עסקה, חדרים, שכונה, והמשפט. לא כותבת.';

revoke all on function public.share_digest_preview() from public, anon, authenticated;
grant execute on function public.share_digest_preview() to service_role;

create or replace function public.share_digest_build()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on       int;
  v_since    timestamptz;
  v_local    timestamp;
  v_today    date;
  v_now_min  int;
  v_hhmm     int;
  v_tgt      int;
  v_delta    int;
  v_sent     int := 0;
  v_nid      uuid;
  v_n        int;
  v_lines    int;
  v_slot     int;
  v_quiet    boolean;
  v_dow      int;
  v_hour     int;
  v_suppress boolean;
  v_rows     jsonb;
  v_body     text;
  v_path     text;
  v_prop     uuid;
  ag         record;
begin
  v_on := coalesce((select value from public.pricing_config
                     where key = 'share_digest_enabled'), 0);
  if v_on <> 1 then
    return 0;
  end if;

  select s.enabled_at into v_since
    from public.share_digest_state s
   where s.id = 1
     and s.enabled_at is not null;
  if v_since is null then
    return 0;
  end if;

  v_local := pg_catalog.now() at time zone 'Asia/Jerusalem';
  v_today := v_local::date;
  v_now_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_hhmm := coalesce((select value from public.pricing_config
                       where key = 'share_digest_hhmm'), 1230);
  if v_hhmm < 0 or v_hhmm > 2359 or (v_hhmm % 100) > 59 then
    v_hhmm := 1230;
  end if;
  v_tgt := (v_hhmm / 100) * 60 + (v_hhmm % 100);
  v_delta := (v_now_min - v_tgt + 1440) % 1440;
  -- 12:30 עד 13:00. דקה שפוספסת נתפסת בהמשך החלון, לא הולכת לאיבוד.
  if v_delta >= 30 then
    return 0;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('share_digest_build')::bigint);

  for ag in
    select m.id,
           m.tier,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone,
           coalesce(
             (select c.last_message_at > pg_catalog.now() - interval '23 hours'
                from public.whatsapp_conversations c
               where c.agent_id = m.id),
             false) as in_window,
           coalesce(rp.quiet_from_hour, 21) as quiet_from,
           coalesce(rp.quiet_to_hour, 8) as quiet_to,
           coalesce(rp.quiet_days, '{5,6}'::smallint[]) as quiet_days
      from public.agency_members m
      left join public.agent_reminder_preferences rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and exists (
         select 1
           from public.notifications n
          where n.agent_id = m.id
            and n.type = 'system'
            and n.title = 'נכס חדש שותף איתך'
            and n.related_property_id is not null
            and n.created_at > v_since
            and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                          where r.agent_id = m.id), v_since)
            and not exists (
              select 1 from public.notification_push_log l
               where n.id = any (l.notification_ids))
            and not exists (
              select 1 from public.share_digest_lines sl
               where sl.source_notification_id = n.id)
       )
  loop
    -- שש משבצות של 5 דקות. אחרי שהמשבצת נפתחה, כל דקה בחלון עדיין תופסת.
    v_slot := mod(pg_catalog.hashtext(ag.id::text)::bigint, 6);
    if v_slot < 0 then
      v_slot := v_slot + 6;
    end if;
    if v_delta < v_slot * 5 then
      continue;
    end if;

    -- שישי עד 13:00 פתוח גם כש-quiet_days כולל 5. שבת סגורה.
    -- חלון 1 קבוע: הדגל הגלובלי של #1049 לא חוסם את הסיכום של 12:30.
    v_quiet := false;
    if to_regprocedure('public.notification_agent_send_quiet(integer,integer,smallint[],timestamp with time zone,integer)') is not null then
      execute 'select public.notification_agent_send_quiet($1, $2, $3, $4, 1)'
        into v_quiet
        using ag.quiet_from, ag.quiet_to, ag.quiet_days, pg_catalog.now();
    else
      v_dow := extract(dow from v_local)::int;
      v_hour := extract(hour from v_local)::int;
      if v_dow = 6 or (v_dow = 5 and v_hour >= 13) or v_hour < 8 or v_hour >= 21 then
        v_quiet := true;
      else
        v_quiet := public.agent_reminder_quiet_now(
          ag.quiet_from,
          ag.quiet_to,
          array_remove(coalesce(ag.quiet_days, '{5,6}'::smallint[]), 5::smallint));
      end if;
    end if;
    if v_quiet then
      continue;
    end if;

    if exists (
      select 1 from public.share_digest_runs r
       where r.agent_id = ag.id
         and (r.ran_at at time zone 'Asia/Jerusalem')::date = v_today
    ) then
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'source_id', n.id,
             'property_id', p.id,
             'sharer', coalesce(nullif(split_part(btrim(coalesce(sh.display_name, '')), ' ', 1), ''), 'משרד'),
             'ptype', coalesce(nullif(btrim(p.property_type), ''), 'נכס'),
             'price', case
               when p.price is null or p.price <= 0 then 'מחיר לא צוין'
               else trim(to_char(p.price, 'FM999,999,999')) || ' ₪'
             end,
             'city', nullif(btrim(coalesce(p.city, '')), ''),
             'deal', nullif(btrim(coalesce(p.deal_type, '')), ''),
             'rooms', case when p.rooms is null or p.rooms <= 0 then null else p.rooms end,
             'neighborhood', public.neighborhood_public_name(nb.is_planned, nb.name)
           )), '[]'::jsonb)
      into v_rows
      from public.notifications n
      join public.properties p on p.id = n.related_property_id
      left join public.neighborhoods nb on nb.id = p.neighborhood_id
      left join lateral (
      select ps.owner_agent_id
        from public.property_shares ps
        join public.agency_members recv on recv.id = n.agent_id
       where ps.property_id = p.id
         and ps.shared_with_agency_id = recv.agency_id
       limit 1
    ) share on true
    left join public.agency_members sh on sh.id = share.owner_agent_id
     where n.agent_id = ag.id
       and n.type = 'system'
       and n.title = 'נכס חדש שותף איתך'
       and n.related_property_id is not null
       and n.created_at > v_since
       and n.created_at > coalesce((select max(r.ran_at) from public.share_digest_runs r
                                     where r.agent_id = ag.id), v_since)
       and not exists (
         select 1 from public.notification_push_log l
          where n.id = any (l.notification_ids))
       and not exists (
         select 1 from public.share_digest_lines sl
          where sl.source_notification_id = n.id);

    v_n := coalesce(jsonb_array_length(v_rows), 0);
    if v_n = 0 then
      continue;
    end if;

    select case when count(*) = 1 then (array_agg(x.property_id))[1] else null end
      into v_prop
      from jsonb_to_recordset(v_rows) as x(
        source_id uuid, property_id uuid, sharer text, ptype text, price text,
        city text, deal text, rooms numeric, neighborhood text
      );
    v_path := case
      when v_n = 1 then '/crm?goto=accSharedWithMe&property=' || v_prop::text
      else '/crm?goto=accSharedWithMe'
    end;
    select left(coalesce(string_agg(
             public.share_digest_describe(
               x.ptype, x.deal, x.city, x.neighborhood, x.rooms, x.price
             ) || E'\nשותף ע"י ' || x.sharer,
             E'\n\n' order by x.sharer, x.ptype, x.property_id::text
           ), 'נכס חדש שותף איתך'), 2000)
      into v_body
      from jsonb_to_recordset(v_rows) as x(
        source_id uuid, property_id uuid, sharer text, ptype text, price text,
        city text, deal text, rooms numeric, neighborhood text
      );

    -- מסלול free ומי שמחוץ לחלון 24 השעות: פעמון בלבד. בלי תבנית.
    v_suppress := ag.tier is distinct from 'mid' and ag.tier is distinct from 'premium'
      or ag.phone is null
      or not ag.in_window;

    insert into public.notifications (
      agent_id, type, title, body, suppress_push, action_path, related_property_id
    )
    values (
      ag.id,
      'share_digest',
      case
        when v_n = 1 then 'נכס חדש שותף איתך'
        else v_n::text || ' נכסים חדשים שותפו איתך'
      end,
      v_body,
      v_suppress,
      v_path,
      v_prop
    )
    returning id into v_nid;

    insert into public.share_digest_lines (
      notification_id, source_notification_id, property_id,
      sharer_first_name, property_type, price_label,
      city, deal_type, rooms, neighborhood
    )
    select v_nid, x.source_id, x.property_id, x.sharer, x.ptype, x.price,
           x.city, x.deal, x.rooms, x.neighborhood
      from jsonb_to_recordset(v_rows) as x(
        source_id uuid, property_id uuid, sharer text, ptype text, price text,
        city text, deal text, rooms numeric, neighborhood text
      );
    get diagnostics v_lines = row_count;
    if coalesce(v_lines, 0) <> v_n then
      raise exception 'share_digest lines missing for %', ag.id;
    end if;

    insert into public.share_digest_runs (agent_id, ran_at, notification_id)
    values (ag.id, pg_catalog.now(), v_nid);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

comment on function public.share_digest_build() is
  'סיכום שיתופים אחד לסוכן/ת. שכונה עם is_planned אינה נכנסת לגוף ההודעה.';

revoke all on function public.share_digest_build() from public, anon, authenticated;
grant execute on function public.share_digest_build() to service_role;



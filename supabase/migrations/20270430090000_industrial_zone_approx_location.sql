-- ============================================================================
-- אזורי תעשייה ומיקום משוער
--
-- ## הבעיה
--
-- נכס באזור תעשייה כמעט אף פעם אינו מקבל פין: אין לו מספר בית (הגאוקוד
-- דורש אותו), חלקה של יותר מ-250 מ' נפסלת (assets/govmap.js), ורוב
-- המתווכים אינם מזינים כתובת מדויקת או גוש/חלקה כדי לא לחשוף את הנכס.
-- נכס בלי lat/lng אינו מופיע באף מפה - והגולש/ת שמחפש/ת מחסן בעמק לא
-- רואה שיש מחסנים בעמק. הכרעת מנהל הפלטפורמה (12.10.2026): פין משוער.
--
-- ## מה נוסף
--
-- 1. ‏`neighborhoods.is_industrial` - אזור תעשייה הוא שכונה (יש לה גבול, עיר
--    ושם), מסומנת. 15 השכונות ששמן "אזור תעשייה..." מסומנות כאן; חדשות -
--    מהתיבה בניהול השכונות ב-CRM.
-- 2. ‏`properties.location_precision`:
--      null / 'exact' - הפין הוא המיקום (כתובת, חלקה קטנה, הזנה ידנית). כל
--                       הנכסים הקיימים - null, ושום דבר אצלם לא משתנה.
--      'zone'         - נקודה אקראית בתוך אזור התעשייה שהנכס משויך אליו.
--      'parcel'       - מרכז חלקה גדולה (מעל 250 מ', עד 2 ק"מ).
--    ‏`location_radius_m` - הרדיוס שבו הנכס נמצא באמת (עד 1,000), לעיגול בדף
--    הנכס. שני הערכים המשוערים מוצגים כ"מיקום משוער" ולא כפין מדויק.
-- 3. ‏`zone_approx_point(hood, seed)` - נקודה **דטרמיניסטית** (לפי id הנכס, כדי
--    שהפין לא יקפוץ בין טעינות) בתוך גבול האזור ועד 1,000 מ' ממרכזו.
-- 4. הטריגר `properties_zone_location_trg`, שחל על כל מסלול שבו נכס נוצר
--    (CRM, גבריאלה, ייבוא): נכס בלי lat/lng שמשויך לאזור תעשייה מקבל את
--    הנקודה. מיקום אמיתי שנכתב אחר כך מחליף אותה ומסומן 'exact'.
-- 5. ‏`property_map_enabled` - מפה בדף הנכס גם בלי מספר בית כשהמיקום משוער
--    (בלי שינוי בגייט המסלול). עד היום גם נכס שמוקם לפי גוש/חלקה בלי מספר
--    בית לא קיבל מפה, בניגוד למה שהטופס הבטיח.
--
-- ## פרטיות
--
-- רק הנקודה המשוערת נשמרת. lat/lng קריאים ל-anon בכל נכס פעיל
-- (docs/property-map.md), ולכן מיקום מדויק "מאחורי הקלעים" היה נחשף.
--
-- תיעוד: docs/property-map.md, "מיקום משוער"
-- ============================================================================

alter table public.neighborhoods
  add column if not exists is_industrial boolean not null default false;

comment on column public.neighborhoods.is_industrial is
  'אזור תעשייה: נכס בלי מיקום שמשויך אליו מקבל פין משוער בתוכו (zone_approx_point). docs/property-map.md';

update public.neighborhoods
   set is_industrial = true
 where not is_industrial
   and name ~ '^אזור (ה)?תעשי';

alter table public.properties
  add column if not exists location_precision text,
  add column if not exists location_radius_m integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'properties_location_precision_chk') then
    alter table public.properties add constraint properties_location_precision_chk
      check (location_precision is null or location_precision in ('exact', 'zone', 'parcel'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_location_radius_chk') then
    alter table public.properties add constraint properties_location_radius_chk
      check (location_radius_m is null or location_radius_m between 1 and 5000);
  end if;
end $$;

comment on column public.properties.location_precision is
  'null/exact - הפין הוא המיקום. zone - נקודה משוערת בתוך אזור תעשייה. parcel - מרכז חלקה גדולה. docs/property-map.md';
comment on column public.properties.location_radius_m is
  'לפין משוער: הרדיוס שבו הנכס נמצא (עד 1,000 מ''). null לפין מדויק.';

-- ---------------------------------------------------------------------------
-- נקודה משוערת בתוך אזור תעשייה
--
-- המרכז: ה-lat/lng של השכונה כשהם בתוך הגבול, אחרת ממוצע הקודקודים. הרדיוס:
-- המרחק מהמרכז לקודקוד הרחוק, ולא יותר מ-1,000 מ'. מגרילים עד 64 נקודות
-- בעיגול (שורש לפיזור אחיד בשטח) ולוקחים את הראשונה שבתוך הגבול. ההגרלה
-- נגזרת מ-md5 של seed (id הנכס), ולכן אותו נכס תמיד באותה נקודה.
-- שכונה בלי גבול אבל עם lat/lng/radius_m - עיגול בלבד. בלי שניהם - כלום.
-- ---------------------------------------------------------------------------
create or replace function public.zone_approx_point(p_hood uuid, p_seed uuid)
returns table (lat double precision, lng double precision, radius_m integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h       record;
  v_ring  jsonb;
  v_clat  double precision;
  v_clng  double precision;
  v_max   double precision := 0;
  v_r     double precision;
  v_n     integer;
  i       integer;
  v_hash  text;
  u1      double precision;
  u2      double precision;
  v_dist  double precision;
  v_ang   double precision;
  c_lat   double precision;
  c_lng   double precision;
  k_m     constant double precision := 111320;   -- מטרים למעלת רוחב
begin
  select n.boundary, n.lat, n.lng, n.radius_m
    into h
    from public.neighborhoods n
   where n.id = p_hood and n.is_industrial;
  if not found then
    return;
  end if;

  if jsonb_typeof(h.boundary) = 'array' and jsonb_array_length(h.boundary) >= 3 then
    v_ring := h.boundary;
    v_n := jsonb_array_length(v_ring);
    if h.lat is not null and h.lng is not null and public.point_in_ring(v_ring, h.lat, h.lng) then
      v_clat := h.lat; v_clng := h.lng;
    else
      select avg((e ->> 0)::double precision), avg((e ->> 1)::double precision)
        into v_clat, v_clng
        from jsonb_array_elements(v_ring) e;
    end if;
    for i in 0 .. v_n - 1 loop
      v_max := greatest(v_max, sqrt(
        power(((v_ring -> i ->> 0)::double precision - v_clat) * k_m, 2) +
        power(((v_ring -> i ->> 1)::double precision - v_clng) * k_m * cos(radians(v_clat)), 2)));
    end loop;
  elsif h.lat is not null and h.lng is not null and h.radius_m is not null then
    v_clat := h.lat; v_clng := h.lng; v_max := h.radius_m;
  else
    return;
  end if;

  v_r := least(1000, greatest(v_max, 50));

  for i in 0 .. 63 loop
    v_hash := md5(coalesce(p_seed::text, '') || ':' || i);
    u1 := ('x' || substr(v_hash, 1, 8))::bit(32)::bigint / 4294967295.0;
    u2 := ('x' || substr(v_hash, 9, 8))::bit(32)::bigint / 4294967295.0;
    v_dist := v_r * sqrt(u1);
    v_ang  := 2 * pi() * u2;
    c_lat := v_clat + (v_dist * cos(v_ang)) / k_m;
    c_lng := v_clng + (v_dist * sin(v_ang)) / (k_m * cos(radians(v_clat)));
    if v_ring is null or public.point_in_ring(v_ring, c_lat, c_lng) then
      lat := round(c_lat::numeric, 6); lng := round(c_lng::numeric, 6); radius_m := round(v_r);
      return next;
      return;
    end if;
  end loop;

  -- אף הגרלה לא נפלה בגבול (אזור צר ומפותל): המרכז
  lat := round(v_clat::numeric, 6); lng := round(v_clng::numeric, 6); radius_m := round(v_r);
  return next;
end $$;

comment on function public.zone_approx_point(uuid, uuid) is
  'נקודה משוערת דטרמיניסטית (לפי seed) בתוך גבול אזור תעשייה, עד 1,000 מ'' ממרכזו. מהטריגר properties_zone_location_trg. docs/property-map.md';

revoke all on function public.zone_approx_point(uuid, uuid) from public, anon, authenticated;
grant execute on function public.zone_approx_point(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- הטריגר
--
-- 1. מיקום אמיתי שנכתב (lat/lng השתנו בלי שהכותב/ת קבע/ה דיוק אחר) - 'exact'.
-- 2. נכס 'zone' שעבר שכונה בלי שהפין זז - הפין הישן אינו נכון יותר: נמחק,
--    וסעיף 3 מציב חדש אם גם השכונה החדשה היא אזור תעשייה.
-- 3. אין lat/lng ויש שכונה שהיא אזור תעשייה - נקודה משוערת.
-- נכס 'parcel' שעבר שכונה נשאר: מרכז החלקה אינו תלוי בשכונה.
-- ---------------------------------------------------------------------------
create or replace function public.properties_zone_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved boolean := false;
  z       record;
begin
  if tg_op = 'UPDATE' then
    v_moved := new.lat is distinct from old.lat or new.lng is distinct from old.lng;
    if v_moved and new.location_precision is not distinct from old.location_precision then
      if new.lat is not null and new.lng is not null then
        new.location_precision := 'exact';
      else
        new.location_precision := null;
      end if;
      new.location_radius_m := null;
    end if;
    if not v_moved and old.location_precision = 'zone'
       and new.location_precision is not distinct from 'zone'
       and new.neighborhood_id is distinct from old.neighborhood_id then
      new.lat := null; new.lng := null;
      new.location_precision := null; new.location_radius_m := null;
    end if;
  end if;

  if new.location_precision = 'exact' then
    new.location_radius_m := null;
  end if;

  if (new.lat is null or new.lng is null) and new.neighborhood_id is not null then
    select * into z from public.zone_approx_point(new.neighborhood_id, new.id);
    if found and z.lat is not null then
      new.lat := z.lat; new.lng := z.lng;
      new.location_precision := 'zone';
      new.location_radius_m := z.radius_m;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.properties_zone_location() from public, anon, authenticated;

drop trigger if exists properties_zone_location_trg on public.properties;
create trigger properties_zone_location_trg
  before insert or update of lat, lng, neighborhood_id, location_precision, location_radius_m
  on public.properties
  for each row execute function public.properties_zone_location();

-- ---------------------------------------------------------------------------
-- המפה בדף הנכס: גם בלי מספר בית כשהמיקום משוער
-- ---------------------------------------------------------------------------
create or replace function public.property_map_enabled(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    where p.id = p_property_id
      and p.status = 'active'
      and m.active = true
      and m.tier in ('mid', 'premium')
      and m.billing_status = 'active'
      and p.lat is not null
      and p.lng is not null
      and (
        (p.house_number is not null and (p.street is not null or p.address is not null))
        or p.location_precision in ('zone', 'parcel')
      )
  );
$$;

revoke all on function public.property_map_enabled(uuid) from public;
grant execute on function public.property_map_enabled(uuid) to anon, authenticated;

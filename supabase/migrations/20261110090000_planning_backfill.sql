-- ============================================================================
-- השלמת מידע תכנוני לנכסים שכבר במסד
--
-- ‏property_planning_info נכתבת היום בנקודה אחת בלבד: טופס הנכס ב-CRM, בעת
-- קליטה או כשהכתובת משתנה. נכס שנכנס בדרך אחרת — אשף הייבוא מקובץ, או
-- העוזר בוואטסאפ — לא נוגע בה מעולם.
--
-- התוצאה נמדדה: 70 נכסים פעילים בעפולה עם כתובת מלאה, ו-**2 שורות** בטבלה.
--
-- זה אותו כשל בדיוק שכבר תועד על הגיאוקוד ב-docs/geocoding.md: "תיקון באשף
-- לבדו לא היה מספיק — הוא לא נוגע במה שכבר במסד". ושם גם הפתרון שהוכיח את
-- עצמו: סורק, שהוא המקום היחיד שבו "יש כתובת ואין מידע" נסגר ללא תלות
-- במסלול שדרכו הנכס נוצר.
--
-- התור מוגדר כאן ולא בפונקציה, כדי שהתנאי שלפיו ה-cron דולק והתנאי שלפיו
-- נבחרות שורות יהיו אותו תנאי בדיוק. אותה תבנית כמו geocode_backfill_queue.
-- ============================================================================

alter table public.properties
  add column if not exists planning_attempts     smallint    not null default 0,
  add column if not exists planning_error        text,
  add column if not exists planning_attempted_at timestamptz;

comment on column public.properties.planning_attempts is
  'כמה פעמים planning-backfill ניסה ונכשל סופית. 3 ויוצאים מהתור.';

-- ---------------------------------------------------------------------------
-- התור
--
-- נכס נכנס אם יש לו כתובת מלאה בעפולה, אין לו עדיין שורת תכנון עם גוש,
-- הוא לא מיצה את הניסיונות, וחלף חלון ההמתנה מאז הניסיון האחרון.
--
-- ‏`gush is not null` ולא עצם קיום השורה: שורה שנוצרה מניסיון חלקי אינה
-- מידע תכנוני, ואסור שתיראה כמו כזה.
-- ---------------------------------------------------------------------------
create or replace function public.planning_backfill_queue(
  p_limit        integer  default 25,
  p_max_attempts smallint default 3,
  p_retry_after  interval default '20 hours'
)
returns table (id uuid, street text, house_number text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.street, p.house_number
  from public.properties p
  where p.city = 'עפולה'
    and p.status = 'active'
    and coalesce(btrim(p.street), '') <> ''
    and coalesce(btrim(p.house_number), '') <> ''
    and p.planning_attempts < p_max_attempts
    and (p.planning_attempted_at is null or p.planning_attempted_at < now() - p_retry_after)
    and not exists (
      select 1 from public.property_planning_info ppi
      where ppi.property_id = p.id and ppi.gush is not null
    )
  order by p.planning_attempted_at nulls first, p.created_at
  limit greatest(p_limit, 1);
$$;

comment on function public.planning_backfill_queue(integer, smallint, interval) is
  'נכסים שממתינים להשלמת מידע תכנוני. אותו תנאי משמש את תנאי ההדלקה של ה-cron.';

revoke all on function public.planning_backfill_queue(integer, smallint, interval) from public, anon, authenticated;
grant execute on function public.planning_backfill_queue(integer, smallint, interval) to service_role;

create or replace function public.planning_backfill_pending()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.planning_backfill_queue(1));
$$;

comment on function public.planning_backfill_pending() is
  'האם יש נכס שממתין. תנאי ההדלקה של ה-cron — כשאין, גם לא מעירים את השרת.';

revoke all on function public.planning_backfill_pending() from public, anon, authenticated;
grant execute on function public.planning_backfill_pending() to service_role;

-- ---------------------------------------------------------------------------
-- רישום התוצאה
--
-- הצלחה מאפסת את המונה; כישלון סופי מעלה אותו. תקלת תקשורת **אינה** מעלה
-- אותו — ‏WFS שנפל אינו ראיה על הכתובת — והיא מסומנת ב-p_transient.
-- ---------------------------------------------------------------------------
create or replace function public.planning_record_result(
  p_id        uuid,
  p_record    jsonb   default null,
  p_error     text    default null,
  p_transient boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_record is not null then
    insert into public.property_planning_info as ppi (
      property_id, gush, helka, parcel_area_sqm, parcel_status,
      land_use_designation, applicable_plans, geometry_wgs84, lat, lng, looked_up_at
    )
    values (
      p_id,
      p_record->>'gush',
      p_record->>'helka',
      (p_record->>'parcel_area_sqm')::numeric,
      p_record->>'parcel_status',
      p_record->>'land_use_designation',
      p_record->'applicable_plans',
      p_record->'geometry_wgs84',
      (p_record->>'lat')::numeric,
      (p_record->>'lng')::numeric,
      coalesce((p_record->>'looked_up_at')::timestamptz, now())
    )
    on conflict (property_id) do update set
      gush = excluded.gush,
      helka = excluded.helka,
      parcel_area_sqm = excluded.parcel_area_sqm,
      parcel_status = excluded.parcel_status,
      land_use_designation = excluded.land_use_designation,
      applicable_plans = excluded.applicable_plans,
      geometry_wgs84 = excluded.geometry_wgs84,
      lat = excluded.lat,
      lng = excluded.lng,
      looked_up_at = excluded.looked_up_at;

    update public.properties
       set planning_attempts = 0,
           planning_error = null,
           planning_attempted_at = now()
     where id = p_id;
  else
    update public.properties
       set planning_attempts = case when p_transient then planning_attempts else planning_attempts + 1 end,
           planning_error = left(coalesce(p_error, 'unknown'), 300),
           planning_attempted_at = now()
     where id = p_id;
  end if;
end;
$$;

comment on function public.planning_record_result(uuid, jsonb, text, boolean) is
  'רושם תוצאת סבב. הצלחה מאפסת את המונה, כישלון סופי מעלה, תקלת תקשורת לא.';

revoke all on function public.planning_record_result(uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.planning_record_result(uuid, jsonb, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- התזמון
--
-- שעתי, ומותנה. ‏timeout_milliseconds של 60 שניות: כל נכס הוא כמה שאילתות
-- WFS סדרתיות, ולסבב יש תקציב זמן משלו מתחת לזה.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/planning-backfill';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('planning-backfill')
    where exists (select 1 from cron.job where jobname = 'planning-backfill');

  perform cron.schedule('planning-backfill', '17 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 60000
    )
    where public.planning_backfill_pending()
  $cron$, v_url));
end $$;

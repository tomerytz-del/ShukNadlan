-- ===========================================================================
-- נכס בלי תמונה לא יוצא לפוסט
--
-- עד כאן נכס בלי תמונות נשלח ל-Make כמו כל נכס אחר, עם `images: []`, ושם
-- מודול "Create a Post with Photos" נפל על
-- `Missing value of required parameter 'url'` — השדה Photos הוא חובה. שתי
-- תוצאות, שתיהן רעות: התרחיש ב-Make נכבה אחרי כשלונות חוזרים ועצר את כל
-- התור (‏9.9.2026, ‏14 נכסים נתקעו), והפתרון החלופי — פוסט קישור בלי תמונה —
-- הוא ממילא שיווק חלש.
--
-- ההחלטה: נכס בלי תמונה **אינו נבחר לפרסום**. הוא נשאר `pending` וממתין,
-- כי ברוב המקרים התמונות עולות מאוחר יותר באותו יום; ברגע שהתמונה הראשונה
-- נכנסת הוא חוזר למסלול מעצמו.
--
-- שלוש נגיעות:
--   1. `property_has_publishable_image` — הגדרה אחת ל"יש תמונה", שמשקפת
--      בדיוק את הסינון בשרת (‏`^https?://`).
--   2. `pending_property_publications` מסננת לפיה — גם במסלול האוטומטי וגם
--      בידני. זו לא הגנת קצב כמו התקרה היומית, שאדם רשאי לעקוף: בלי תמונה
--      **אין פוסט להרכיב**, ולכן הכלל חל על שני המסלולים.
--   3. חלון ההשהיה נספר מרגע שהנכס נעשה בר-פרסום ולא מרגע היצירה. בלי זה
--      נכס שקיבל תמונה שבוע אחרי היצירה היה יוצא לפוסט תוך חמש דקות — עם
--      תמונה אחת מתוך שבע, באמצע ההעלאה.
--
-- ובנוסף, בלי קשר לתמונות: ה-cron יורה ל-Edge Function רק כשיש שורה בשלה.
-- עד כאן הוא ירה כל חמש דקות ללא תנאי — ‏8,640 קריאות בחודש, שמתוכן 0.3%
-- עשו עבודה כלשהי.
--
-- אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. "יש תמונה" — הגדרה אחת
--
-- משקפת את הסינון ב-property-marketing-publish/index.ts: רק מחרוזת שהיא
-- כתובת http(s) נספרת, והתמונה השיווקית המעוצבת נחשבת כמו תמונת גלריה.
-- אם השניים ייפרדו, נכס ייבחר לפרסום ויישלח ל-Make עם מערך ריק — כלומר
-- בדיוק התקלה שהמיגרציה הזו סוגרת. הביטוי כאן הוא מקור האמת.
-- ---------------------------------------------------------------------------
create or replace function public.property_has_publishable_image(
  p_images          text[],
  p_marketing_image text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_marketing_image ~ '^https?://', false)
      or exists (
           select 1
             from unnest(coalesce(p_images, '{}'::text[])) as img(url)
            where img.url ~ '^https?://'
         );
$$;

comment on function public.property_has_publishable_image(text[], text) is
  'true אם לנכס יש לפחות תמונה אחת שאפשר לפרסם. משקפת את הסינון בשרת — כתובת http(s) בלבד, כולל התמונה השיווקית המעוצבת.';

revoke all on function public.property_has_publishable_image(text[], text) from public;
revoke all on function public.property_has_publishable_image(text[], text) from anon, authenticated;
grant execute on function public.property_has_publishable_image(text[], text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. משיכת התור — נכס בלי תמונה אינו נבחר
--
-- זהה למקור (מיגרציה 20260906092000 §4) פרט לשורת התמונה. היא יושבת עם
-- `p.status = 'active'` ולא עם תנאי ה-`p_property_id is null`, ובכוונה:
-- ההשהיה, התקרה והמתג הם מדיניות קצב שאדם רשאי לעקוף, ואילו נכס בלי תמונה
-- פשוט אין ממה להרכיב לו פוסט.
-- ---------------------------------------------------------------------------
create or replace function public.pending_property_publications(
  p_limit       int default 10,
  p_property_id uuid default null
)
returns table (
  publication_id  uuid,
  property_id     uuid,
  listing_number  bigint,
  title           text,
  description     text,
  marketing_description text,
  post_text       text,
  property_type   text,
  deal_type       text,
  category        text,
  price           numeric,
  rooms           numeric,
  size_sqm        numeric,
  garden_sqm      numeric,
  floor           int,
  total_floors    smallint,
  city            text,
  neighborhood    text,
  street          text,
  features        text[],
  condition       text,
  move_in_date    date,
  furniture_details text,
  images          text[],
  marketing_image text,
  agent_name      text,
  agent_phone     text,
  agency_name     text
)
language sql
security definer
set search_path = ''
as $$
  with cap as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'facebook_autopost_daily_cap'), 12) as daily_cap
  ),
  posted_today as (
    select count(*) as n
      from public.property_publications
     where status = 'posted' and posted_at > now() - interval '24 hours'
  )
  select
    pub.id, p.id, p.listing_number, p.title, p.description,
    p.marketing_description, p.post_text,
    p.property_type, p.deal_type, p.category,
    p.price, p.rooms::numeric,
    coalesce(p.size_sqm, p.area_sqm)::numeric, p.garden_sqm,
    p.floor::int, p.total_floors,
    p.city, n.name, p.street,
    p.features, p.condition, p.move_in_date, p.furniture_details,
    p.images, p.marketing_image,
    m.display_name, coalesce(m.phone_e164, m.phone), a.name
    from public.property_publications pub
    join public.properties p on p.id = pub.property_id
    left join public.neighborhoods  n on n.id = p.neighborhood_id
    left join public.agency_members m on m.id = p.agent_id
    left join public.agencies       a on a.id = p.agency_id
   cross join cap
   cross join posted_today
   where pub.status = 'pending'
     and p.status = 'active'
     and public.property_has_publishable_image(p.images, p.marketing_image)
     and (p_property_id is null or p.id = p_property_id)
     and (p_property_id is not null or pub.publish_after <= now())
     and (p_property_id is not null or posted_today.n < cap.daily_cap)
     and (p_property_id is not null
          or coalesce((select value::int from public.pricing_config
                        where key = 'facebook_autopost_enabled'), 1) = 1)
   order by pub.publish_after
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

comment on function public.pending_property_publications(int, uuid) is
  'הנכסים שמותר לפרסם עכשיו, עם כל מה שדרוש לתיאור השיווקי ולפוסט. מסננת נכסים לא פעילים, נכסים בלי תמונה, השהיה, מתג כיבוי ותקרה יומית — למעט בקשה ידנית לנכס מסוים, שעוקפת את השלושה האחרונים בלבד.';

revoke all on function public.pending_property_publications(int, uuid) from public;
revoke all on function public.pending_property_publications(int, uuid) from anon, authenticated;
grant execute on function public.pending_property_publications(int, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. חלון ההשהיה נספר מרגע שיש תמונה
--
-- ‏`publish_after` נקבע ביצירה ל-now()+20 דקות. נכס שנוצר בלי תמונות ומקבל
-- אותן מאוחר יותר כבר עבר את החלון הזה מזמן, ולכן היה יוצא לפוסט בהרצת
-- ה-cron הבאה — עד חמש דקות אחרי התמונה הראשונה, כשהסוכן/ת עוד באמצע
-- ההעלאה. הטריגר מחזיר את החלון: 20 דקות מהתמונה הראשונה.
--
-- הבדיקה על ה-old היא מה שמונע איפוס אינסופי — העלאת שבע תמונות היא שבעה
-- עדכונים, ורק הראשון הופך את הנכס מ"בלי" ל"עם".
-- ---------------------------------------------------------------------------
create or replace function public.properties_publication_image_delay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delay int;
begin
  if public.property_has_publishable_image(old.images, old.marketing_image)
     or not public.property_has_publishable_image(new.images, new.marketing_image) then
    return null;
  end if;

  v_delay := coalesce((select value::int from public.pricing_config
                        where key = 'facebook_autopost_delay_minutes'), 20);

  update public.property_publications
     set publish_after = now() + make_interval(mins => greatest(v_delay, 0))
   where property_id = new.id
     and status = 'pending'
     and publish_after <= now() + make_interval(mins => greatest(v_delay, 0));

  return null;
exception when others then
  -- כמו בטריגר הכניסה לתור: פרסום ברשתות לא ימנע מסוכן/ת לשמור נכס.
  raise warning 'properties_publication_image_delay נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.properties_publication_image_delay() is
  'מחדשת את חלון ההשהיה כשנכס מקבל את תמונתו הראשונה, כדי שהפוסט לא ייצא באמצע העלאת הגלריה.';

revoke all on function public.properties_publication_image_delay() from public;
revoke all on function public.properties_publication_image_delay() from anon, authenticated;

drop trigger if exists properties_publication_image_delay on public.properties;
create trigger properties_publication_image_delay
  after update of images, marketing_image on public.properties
  for each row
  execute function public.properties_publication_image_delay();

-- ---------------------------------------------------------------------------
-- 4. ניקוי — נכס שתמונה לא הגיעה אליו לעולם
--
-- שורה שממתינה לתמונה שלא באה הייתה נשארת pending לנצח. שבוע הוא הגבול:
-- מודעה בת שבוע שיוצאת כ"חדשה בשוק" היא ממילא לא הפוסט שרצינו. מי שיעלה
-- תמונות אחר כך ויבקש לפרסם — `queue_property_publication(..., true)`.
-- ---------------------------------------------------------------------------
create or replace function public.expire_property_publications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inactive int;
  v_no_image int;
begin
  update public.property_publications pub
     set status = 'skipped',
         last_error = coalesce(pub.last_error, 'הנכס כבר אינו פעיל')
    from public.properties p
   where p.id = pub.property_id
     and pub.status = 'pending'
     and p.status is distinct from 'active'
     and pub.created_at < now() - interval '2 days';
  get diagnostics v_inactive = row_count;

  update public.property_publications pub
     set status = 'skipped',
         last_error = 'נכס בלי תמונה — לא מפרסמים פוסט בלי תמונות'
    from public.properties p
   where p.id = pub.property_id
     and pub.status = 'pending'
     and p.status = 'active'
     and not public.property_has_publishable_image(p.images, p.marketing_image)
     and pub.created_at < now() - interval '7 days';
  get diagnostics v_no_image = row_count;

  return v_inactive + v_no_image;
end;
$$;

comment on function public.expire_property_publications() is
  'מסמנת skipped שורות שממתינות על נכס שכבר אינו פעיל (יומיים), ושורות שממתינות לתמונה שלא הגיעה (שבוע). שומרת על התור נקי.';

revoke all on function public.expire_property_publications() from public;
revoke all on function public.expire_property_publications() from anon, authenticated;
grant execute on function public.expire_property_publications() to service_role;

-- ---------------------------------------------------------------------------
-- 5. תזמון — יורים רק כשיש מה לפרסם
--
-- אותו קצב של חמש דקות, אותן הגנות, אבל `net.http_post` מופעל רק אם קיימת
-- שורה בשלה. התנאי הוא superset מכוון של מה שהפונקציה תמשוך בפועל: הוא
-- מתעלם מהתקרה היומית וממתג הכיבוי, ולכן עלול לירות לשווא ביום עמוס — אבל
-- לעולם לא יפספס שורה. הבדיקה נשענת על property_publications_queue_idx.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/property-marketing-publish';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את property-marketing-publish בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('property-marketing-publish')
    where exists (select 1 from cron.job where jobname = 'property-marketing-publish');

  perform cron.schedule('property-marketing-publish', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (
      select 1
        from public.property_publications pub
        join public.properties p on p.id = pub.property_id
       where pub.status = 'pending'
         and pub.publish_after <= now()
         and p.status = 'active'
         and public.property_has_publishable_image(p.images, p.marketing_image)
    );
  $cron$, v_url));
end;
$$;

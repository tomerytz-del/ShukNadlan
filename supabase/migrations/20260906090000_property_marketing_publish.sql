-- ============================================================================
-- פרסום אוטומטי של נכס חדש לדף הפייסבוק של האתר
--
-- שני שלבים שרצים כאחד על כל נכס שנכנס לפלטפורמה:
--
--   1. **תיאור שיווקי** — נכס שנשמר בלי `marketing_description` מקבל אותו
--      מ-Claude, יחד עם `post_text` (נוסח קצר לרשתות). שני השדות כבר קיימים
--      בטבלה (מיגרציה 20260827140000) ושניהם ניתנים לעריכה ידנית — מה
--      שהסוכן/ת כתב/ה לא נדרס לעולם.
--   2. **פרסום** — אותו נכס עולה כפוסט בדף הפייסבוק של האתר, עם התמונות
--      וקישור לעמוד הנכס.
--
-- שלוש החלטות שכדאי להכיר:
--
--   א. **תור, לא קריאת HTTP מהטריגר.** אותה בחירה כמו בהתראות הסוכן החכם
--      (20260830090000): נפילה של Meta או של Anthropic לא יכולה להפיל שמירת
--      נכס, וניסיון חוזר הוא שאילתה ולא קוד.
--   ב. **השהיה מכוונת לפני הפרסום.** נכס נשמר לרוב לפני שהתמונות עלו ולפני
--      שהטקסט לוטש. `facebook_autopost_delay_minutes` (ברירת מחדל 20) נותן
--      לסוכן/ת חלון לסיים, וכך הפוסט יוצא עם הגלריה המלאה ולא עם מודעה חצי
--      ריקה — פוסט בפייסבוק לא ניתן "לעדכן" בדיעבד בלי לאבד את הלייקים.
--   ג. **שורה אחת לכל נכס לכל החיים.** ‏unique (property_id, channel) הוא מה
--      שמבטיח שאותו נכס לא יפורסם פעמיים — גם אם הוא הועבר ל-sold וחזר
--      ל-active, וגם אם שתי הרצות של השרת חופפות.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. פרמטרים עסקיים
--
-- כמו כל מספר עסקי בפרויקט — ב-pricing_config ולא בקוד. `enabled` הוא מתג
-- הכיבוי: אפשר לעצור את הפרסום האוטומטי מיד, בלי פריסה מחדש.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('facebook_autopost_enabled', 1,
   'פרסום אוטומטי של נכס חדש לדף הפייסבוק של האתר (1=פעיל, 0=כבוי)'),
  ('facebook_autopost_delay_minutes', 20,
   'כמה דקות ממתינים אחרי פרסום הנכס לפני הפוסט — חלון להעלאת תמונות וללטש הטקסט'),
  ('facebook_autopost_daily_cap', 12,
   'תקרת פוסטים ליממה בדף הפייסבוק. עודף נשאר בתור ויוצא למחרת'),
  ('facebook_autopost_max_attempts', 5,
   'כמה ניסיונות פרסום לפני שהשורה מסומנת failed')
on conflict (key) do update
  set description = excluded.description;

-- ---------------------------------------------------------------------------
-- 1. התור
--
-- ‏channel קיים כבר עכשיו כדי שאינסטגרם או קבוצת וואטסאפ ייכנסו כערוץ נוסף
-- בלי מיגרציית טבלה — אבל בכוונה עם check צר, כך שערוץ חדש הוא החלטה
-- מפורשת ולא טעות הקלדה.
-- ---------------------------------------------------------------------------
create table if not exists public.property_publications (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  channel       text not null default 'facebook_page'
                check (channel in ('facebook_page')),

  status        text not null default 'pending'
                check (status in ('pending','posted','failed','skipped')),

  -- מתי מותר לפרסם. הטריגר קובע אותו קדימה (ראו §0), ואפשר לדחות ידנית.
  publish_after timestamptz not null default now(),

  -- מה יצא בפועל. נשמר על השורה ולא מחושב מחדש: הפוסט בפייסבוק כבר לא
  -- ישתנה גם אם המודעה תתעדכן מחר, וכשמישהו שואל "מה פרסמנו עליו" זו
  -- התשובה.
  message       text,
  post_id       text,
  post_url      text,

  -- האם התיאור השיווקי נוצר כאן. מבדיל בין נכס שהגיע עם נוסח של הסוכן/ת
  -- לנכס שקיבל נוסח מ-Claude — שאלה ראשונה בכל בדיקת איכות של הטקסטים.
  description_generated boolean not null default false,

  attempts      smallint not null default 0,
  last_error    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  posted_at     timestamptz,

  constraint property_publications_unique unique (property_id, channel)
);

comment on table public.property_publications is
  'תור הפרסום לרשתות. שורה אחת לכל צמד נכס–ערוץ לכל החיים — היא גם התור וגם היומן של מה שפורסם.';
comment on column public.property_publications.status is
  'pending = ממתין · posted = פורסם · failed = נכשל אחרי מלוא הניסיונות · skipped = לא יפורסם (הנכס כבר לא פעיל).';
comment on column public.property_publications.publish_after is
  'לא מפרסמים לפני הזמן הזה. נותן לסוכן/ת חלון להעלות תמונות וללטש טקסט לפני שהפוסט יוצא.';
comment on column public.property_publications.description_generated is
  'true = התיאור השיווקי נוצר על ידי Claude במסלול הזה. false = הגיע כתוב מהסוכן/ת.';

create index if not exists property_publications_queue_idx
  on public.property_publications (publish_after)
  where status = 'pending';
create index if not exists property_publications_posted_idx
  on public.property_publications (posted_at desc)
  where status = 'posted';

drop trigger if exists property_publications_set_updated_at on public.property_publications;
create trigger property_publications_set_updated_at
  before update on public.property_publications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. הרשאות
--
-- הכתיבה כולה עוברת בפונקציות שלמטה (service_role), ולכן אין כאן policy של
-- insert/update לאף אחד. מנהל/ת הפלטפורמה רואה את היומן ויכול/ה לדחות או
-- לבטל שורה — זה הפיד של "מה פורסם ומה נתקע".
-- ---------------------------------------------------------------------------
alter table public.property_publications enable row level security;
revoke all on public.property_publications from anon, authenticated;
grant select, update on public.property_publications to authenticated;

drop policy if exists "platform admin reads publications" on public.property_publications;
create policy "platform admin reads publications"
  on public.property_publications for select
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

drop policy if exists "platform admin updates publications" on public.property_publications;
create policy "platform admin updates publications"
  on public.property_publications for update
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true))
  with check (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

-- ---------------------------------------------------------------------------
-- 3. כניסה לתור
--
-- ‏queue_property_publication היא נקודת הכניסה היחידה — גם לטריגר וגם
-- לפרסום ידני חוזר מהשרת. `p_force` מחזיר שורה שנכשלה או פורסמה לתור;
-- בלעדיו קריאה חוזרת על נכס שכבר פורסם לא עושה כלום.
-- ---------------------------------------------------------------------------
create or replace function public.queue_property_publication(
  p_property_id uuid,
  p_channel     text default 'facebook_page',
  p_force       boolean default false,
  p_delay_minutes int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delay int;
  v_id    uuid;
begin
  if not exists (select 1 from public.properties where id = p_property_id) then
    return null;
  end if;

  v_delay := coalesce(
    p_delay_minutes,
    (select value::int from public.pricing_config
      where key = 'facebook_autopost_delay_minutes'),
    20);

  insert into public.property_publications (property_id, channel, publish_after)
  values (p_property_id, p_channel, now() + make_interval(mins => greatest(v_delay, 0)))
  on conflict (property_id, channel) do update
    set status        = case when p_force then 'pending' else public.property_publications.status end,
        attempts      = case when p_force then 0 else public.property_publications.attempts end,
        last_error    = case when p_force then null else public.property_publications.last_error end,
        publish_after = case when p_force then now() else public.property_publications.publish_after end
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.queue_property_publication(uuid, text, boolean, int) is
  'מכניסה נכס לתור הפרסום. נקודת הכניסה היחידה — לטריגר ולפרסום ידני חוזר. בלי p_force לא נוגעת בשורה קיימת.';

revoke all on function public.queue_property_publication(uuid, text, boolean, int) from public;
revoke all on function public.queue_property_publication(uuid, text, boolean, int) from anon, authenticated;
grant execute on function public.queue_property_publication(uuid, text, boolean, int) to service_role;

-- 3ב. הטריגר עצמו
--
-- "נכס חדש" הוא נכס שנעשה active — בהוספה או במעבר סטטוס. עדכון מחיר,
-- תמונות או טקסט על נכס פעיל לא מייצר פוסט נוסף, ובזכות ה-unique גם נכס
-- שנמכר וחזר לשוק לא יפורסם פעמיים.
--
-- כמו בטריגר ההדמיות: כל הגוף עטוף ב-exception handler. פרסום ברשתות הוא
-- פיצ'ר שיווקי, ואסור לו למנוע מסוכן/ת לשמור נכס.
create or replace function public.properties_queue_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select value::int from public.pricing_config
                where key = 'facebook_autopost_enabled'), 1) <> 1 then
    return null;
  end if;

  perform public.queue_property_publication(new.id);
  return null;
exception when others then
  raise warning 'properties_queue_publication נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.properties_queue_publication() is
  'מכניסה נכס שנעשה active לתור הפרסום לפייסבוק. no-op שקט כש-facebook_autopost_enabled כבוי.';

revoke all on function public.properties_queue_publication() from public;
revoke all on function public.properties_queue_publication() from anon, authenticated;

drop trigger if exists properties_queue_publication_ins on public.properties;
create trigger properties_queue_publication_ins
  after insert on public.properties
  for each row
  when (new.status = 'active')
  execute function public.properties_queue_publication();

drop trigger if exists properties_queue_publication_upd on public.properties;
create trigger properties_queue_publication_upd
  after update of status on public.properties
  for each row
  when (new.status = 'active' and old.status is distinct from 'active')
  execute function public.properties_queue_publication();

-- ---------------------------------------------------------------------------
-- 4. משיכת התור
--
-- אותה תבנית כמו saved_search_pending_alerts: הצהרה אחת שמחזירה בדיוק את
-- מה שדרוש להרכבת הפוסט, כולל השדות שנכנסים לתיאור השיווקי. כל תנאי
-- "מותר לפרסם עכשיו" יושב כאן ולא בשרת — מקור אמת אחד.
--
-- ‏p_property_id הוא המסלול הידני: מנהל/ת פלטפורמה שמבקש/ת לפרסם נכס מסוים
-- עוקף/ת את ההשהיה, את התקרה היומית ואת מתג הכיבוי — כולם הגנות על פרסום
-- אוטומטי, ואין להן משמעות כשאדם ביקש במפורש. מה שהם *לא* עוקפים: הנכס
-- חייב להיות פעיל, והשורה חייבת להיות pending.
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
  'הנכסים שמותר לפרסם עכשיו, עם כל מה שדרוש לתיאור השיווקי ולפוסט. מסננת נכסים לא פעילים, השהיה, מתג כיבוי ותקרה יומית — למעט בקשה ידנית לנכס מסוים.';

revoke all on function public.pending_property_publications(int, uuid) from public;
revoke all on function public.pending_property_publications(int, uuid) from anon, authenticated;
grant execute on function public.pending_property_publications(int, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. תפיסת השורה
--
-- מפרידה בין "התחלתי לטפל" לבין "סיימתי", ובכך פותרת את הבעיה היחידה
-- שבאמת כואבת בפרסום לרשתות: פוסט כפול. שתי הרצות חופפות של השרת מושכות
-- את אותה שורה מהתור, ובלי תפיסה שתיהן היו מפרסמות אותה מודעה.
--
-- ה-update המותנה הוא הנעילה: הראשון שמצליח דוחה את publish_after בחצי
-- שעה, והשני מקבל false ומדלג. אותה חצי שעה היא גם ה-backoff — היא נקבעת
-- *לפני* הפרסום, כך שגם קריסה של השרת באמצע לא מחזירה את הנכס לתור מיד.
-- ---------------------------------------------------------------------------
create or replace function public.claim_property_publication(p_publication_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  update public.property_publications
     set attempts      = attempts + 1,
         publish_after = now() + interval '30 minutes'
   where id = p_publication_id
     and status = 'pending'
     and publish_after <= now();

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

comment on function public.claim_property_publication(uuid) is
  'תופסת שורה מהתור לפני הפרסום ומונעת פוסט כפול בשתי הרצות חופפות. הדחייה בחצי שעה היא גם ה-backoff לניסיון הבא.';

revoke all on function public.claim_property_publication(uuid) from public;
revoke all on function public.claim_property_publication(uuid) from anon, authenticated;
grant execute on function public.claim_property_publication(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. סימון התוצאה
--
-- ‏status נגזר כאן ולא מתקבל מהשרת: "נכשל סופית" הוא החלטה של מדיניות
-- (‏facebook_autopost_max_attempts) ולא של הקריאה הבודדת שנפלה. את המונה
-- מקדמת התפיסה שלמעלה ולא הפונקציה הזו — אחרת ניסיון שהשרת קרס באמצעו לא
-- היה נספר כלל, והתור היה מנסה אותו לנצח.
-- ---------------------------------------------------------------------------
create or replace function public.mark_property_publication(
  p_publication_id uuid,
  p_ok             boolean,
  p_message        text default null,
  p_post_id        text default null,
  p_post_url       text default null,
  p_error          text default null,
  p_description_generated boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max      int;
  v_status   text;
  v_attempts smallint;
begin
  v_max := coalesce((select value::int from public.pricing_config
                      where key = 'facebook_autopost_max_attempts'), 5);

  select attempts into v_attempts
    from public.property_publications where id = p_publication_id;
  if v_attempts is null then
    return null;
  end if;

  v_status := case
    when p_ok then 'posted'
    when v_attempts >= v_max then 'failed'
    else 'pending'
  end;

  update public.property_publications
     set status     = v_status,
         message    = coalesce(p_message, message),
         post_id    = coalesce(p_post_id, post_id),
         post_url   = coalesce(p_post_url, post_url),
         last_error = case when p_ok then null else p_error end,
         posted_at  = case when p_ok then now() else posted_at end,
         description_generated = description_generated or coalesce(p_description_generated, false)
   where id = p_publication_id;

  return v_status;
end;
$$;

comment on function public.mark_property_publication(uuid, boolean, text, text, text, text, boolean) is
  'מסמנת את תוצאת הפרסום. failed נקבע לפי מדיניות הניסיונות ולא לפי הקריאה הבודדת; כישלון זמני נדחה בחצי שעה.';

revoke all on function public.mark_property_publication(uuid, boolean, text, text, text, text, boolean) from public;
revoke all on function public.mark_property_publication(uuid, boolean, text, text, text, text, boolean) from anon, authenticated;
grant execute on function public.mark_property_publication(uuid, boolean, text, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7. ניקוי
--
-- נכס שנמכר או הועבר לארכיון לפני שהגיע תורו לא יפורסם לעולם — הוא היה
-- נשאר pending לנצח ומזהם את התור. הפונקציה מסמנת אותו skipped.
-- ---------------------------------------------------------------------------
create or replace function public.expire_property_publications()
returns integer
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.property_publications pub
       set status = 'skipped',
           last_error = coalesce(pub.last_error, 'הנכס כבר אינו פעיל')
      from public.properties p
     where p.id = pub.property_id
       and pub.status = 'pending'
       and p.status is distinct from 'active'
       and pub.created_at < now() - interval '2 days'
    returning 1
  )
  select count(*)::int from done;
$$;

comment on function public.expire_property_publications() is
  'מסמנת skipped שורות שממתינות על נכס שכבר אינו פעיל. שומרת על התור נקי.';

revoke all on function public.expire_property_publications() from public;
revoke all on function public.expire_property_publications() from anon, authenticated;
grant execute on function public.expire_property_publications() to service_role;

-- ---------------------------------------------------------------------------
-- 8. תזמון
--
-- אותה תבנית כמו saved-search-notify (§8 במיגרציה 20260830090000):
-- ‏pg_cron קורא ל-Edge Function דרך pg_net, והסוד ל-header נקרא מ-Vault.
-- כל חמש דקות — קצב שמכבד גם את ההשהיה של 20 הדקות וגם את התקרה היומית.
--
-- אם הסוד לא הוגדר, ה-header יוצא ריק והשרת פועל בלי אימות (בדיוק כמו
-- בהתראות). ההידוק הוא צעד אחד בתיעוד: docs/facebook-auto-publish.md
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
  perform cron.unschedule('property-publications-expire')
    where exists (select 1 from cron.job where jobname = 'property-publications-expire');

  perform cron.schedule('property-marketing-publish', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    );
  $cron$, v_url));

  perform cron.schedule('property-publications-expire', '41 * * * *',
                        'select public.expire_property_publications()');
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. הנכסים שכבר בפלטפורמה
--
-- המנגנון מתחיל מכאן והלאה בכוונה: 61 נכסים פעילים שיוצאים כפוסטים ברצף
-- הם הצפה של הדף ולא שיווק. הנכסים הקיימים נכנסים לתור סטטוס skipped, כדי
-- שיהיה מתועד שהם לא פורסמו ולא ייכנסו בטעות מחר — ומי שרוצה לפרסם נכס
-- ותיק יריץ ידנית:
--
--   select public.queue_property_publication('<property-id>', 'facebook_page', true);
-- ---------------------------------------------------------------------------
insert into public.property_publications (property_id, channel, status, last_error)
select p.id, 'facebook_page', 'skipped', 'נכס קיים מלפני הפעלת הפרסום האוטומטי'
  from public.properties p
 where p.created_at < now()
on conflict (property_id, channel) do nothing;

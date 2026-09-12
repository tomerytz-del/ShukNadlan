-- ============================================================================
-- תיאור שיווקי לנכס — מנגנון עצמאי, מקצה לקצה
--
-- מה כבר היה כאן (‏20260906092000): התיאור השיווקי נכתב **כתוצר לוואי של
-- הפוסט בפייסבוק**. זה עבד, אבל רק במסלול הזה — ולכן היו לו ארבעה חורים:
--
--   1. אם אף ערוץ פרסום לא מחובר, ‏property-marketing-publish מחזירה
--      ‏publish_not_configured **לפני** שהיא מגיעה לכתיבת הטקסט. כלומר בלי
--      פייסבוק אין תיאור שיווקי בכלל.
--   2. ‏61 הנכסים שהיו בפלטפורמה נכנסו לתור הפרסום כ-skipped (‏§9 שם, כדי לא
--      להציף את הדף) — ולכן לא קיבלו תיאור לעולם. עשרה מהם עדיין בלי תיאור.
--   3. שורת הפרסום היא unique לכל החיים: אחרי `posted` הנכס יוצא מהתור, וגם
--      אם המחיר, השטח או המאפיינים ישתנו מחר — הטקסט יישאר של אתמול.
--   4. לסוכן/ת לא הייתה שום דרך לבקש נוסח חדש. ‏`force` היה קיים, אבל רק
--      למנהל/ת פלטפורמה, ורק דרך פרסום חוזר לפייסבוק.
--
-- מה שהקובץ הזה עושה: מוציא את התיאור השיווקי מהפרסום ומעמיד אותו כמנגנון
-- בפני עצמו, עם שני מסלולים:
--
--   • **אוטומטי** — נכס שנשמר בלי תיאור שיווקי נכנס לתור, וכעבור עשר דקות
--     ‏Claude כותב לו אחד מהנתונים שהסוכן/ת הזין/ה. נשמר על `properties`,
--     ולכן זמין מיד לדף הנכס, ל-CRM, לפוסט בפייסבוק ולכל ערוץ עתידי.
--   • **הצעה לרענון** — נכס שהנתונים שלו השתנו אחרי שהתיאור נכתב מסומן
--     ‏`marketing_description_stale`, וה-CRM מציע לסוכן/ת נוסח חדש. ההצעה
--     אף פעם לא מתבצעת מאליה: תיאור קיים לא נדרס בלי לחיצה מפורשת.
--
-- שלוש החלטות שכדאי להכיר:
--
--   א. **טקסט של אדם לא נדרס. נקודה.** המסלול האוטומטי מסונן בשאילתה אחת
--      (‏§5) — נכס שיש לו תיאור פשוט לא חוזר מהתור. זה לא תנאי בשרת שאפשר
--      לשכוח, אלא התנאי היחיד שדרכו התור מדבר.
--   ב. **טביעת אצבע ולא `updated_at`.** "הנתונים השתנו" נמדד מול hash של
--      השדות שבאמת נכנסים לטקסט. העלאת תמונה, הקפצה או קידום משנים את
--      ‏`updated_at` ולא את הטקסט — ואילו שינוי מחיר או תוספת מרפסת כן.
--      בלי ההבחנה הזו כל נכס בפלטפורמה היה מסומן "מומלץ לרענן" תוך יום.
--   ג. **מי כתב, נשמר.** ‏`marketing_description_source` מבדיל בין נוסח של
--      הסוכן/ת לנוסח של Claude. זו השאלה הראשונה בכל בדיקת איכות של
--      הטקסטים, והיא גם מה שמאפשר להציג "נכתב אוטומטית — כדאי לעבור עליו".
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. פרמטרים עסקיים
--
-- כמו כל מספר עסקי בפרויקט — ב-pricing_config ולא בקוד. ‏`enabled` הוא מתג
-- הכיבוי: אפשר לעצור את הכתיבה האוטומטית מיד, בלי פריסה מחדש.
--
-- ההשהיה כאן קצרה מזו של הפוסט (‏20 דקות): פוסט בפייסבוק ממתין לגלריה
-- המלאה כי אי אפשר לתקן אותו בדיעבד, ואילו טקסט על הנכס אפשר לרענן בלחיצה.
-- עשר דקות הן חלון לסוכן/ת לתקן מחיר או שטח שהוקלדו שגוי בשמירה הראשונה.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('marketing_description_auto_enabled', 1,
   'כתיבה אוטומטית של תיאור שיווקי לנכס שנשמר בלעדיו (1=פעיל, 0=כבוי)'),
  ('marketing_description_delay_minutes', 10,
   'כמה דקות ממתינים משמירת הנכס לפני כתיבת התיאור — חלון לתיקון נתונים שהוקלדו שגוי'),
  ('marketing_description_daily_cap', 80,
   'תקרת כתיבות ליממה (אוטומטיות וידניות יחד). הגנת עלות מול Anthropic'),
  ('marketing_description_max_attempts', 4,
   'כמה ניסיונות כתיבה לפני שהשורה מסומנת failed'),
  ('marketing_description_manual_cooldown_seconds', 45,
   'המתנה מזערית בין שתי בקשות רענון של הסוכן/ת לאותו נכס')
on conflict (key) do update
  set description = excluded.description;

-- ---------------------------------------------------------------------------
-- 1. מה ידוע על התיאור עצמו
--
-- ארבע עמודות על `properties` ולא טבלה נפרדת: כולן תכונות של המודעה עצמה,
-- וכל אחת מהן נקראת בדיוק במקום שבו הטקסט נקרא — ‏CRM, דף הנכס, הפוסט.
-- טבלה נפרדת הייתה מוסיפה join לכל אחת מהקריאות האלה בלי להוסיף מידע.
--
-- ‏`marketing_description_stale` מוחזק על ידי הטריגר שב-§2 ולא מחושב בשאילתה:
-- ה-CRM צריך לסנן ולמיין לפיו, ו-RLS על `properties` כבר עונה על השאלה
-- "מי רשאי לראות את זה".
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists marketing_description_source      text,
  add column if not exists marketing_description_at          timestamptz,
  add column if not exists marketing_description_fingerprint text,
  add column if not exists marketing_description_stale       boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'properties_marketing_description_source_check') then
    alter table public.properties
      add constraint properties_marketing_description_source_check
      check (marketing_description_source is null
             or marketing_description_source in ('agent','ai'));
  end if;
end $$;

comment on column public.properties.marketing_description_source is
  'מי כתב את התיאור השיווקי: agent = הסוכן/ת · ai = נכתב אוטומטית מנתוני הנכס.';
comment on column public.properties.marketing_description_at is
  'מתי נכתב התיאור השיווקי הנוכחי. מתעדכן בכל שינוי שלו, בין אם ידני ובין אם אוטומטי.';
comment on column public.properties.marketing_description_fingerprint is
  'טביעת אצבע של נתוני הנכס ברגע שהתיאור נכתב. ההשוואה מולה היא מה שמזהה שהטקסט התיישן.';
comment on column public.properties.marketing_description_stale is
  'true = נתוני הנכס השתנו מאז שהתיאור נכתב, וכדאי לרענן אותו. לא גורם לשום כתיבה אוטומטית.';

-- 1ב. טביעת האצבע
--
-- רק השדות שבאמת נכנסים לטקסט (‏facts() ב-_shared/marketing-copy.ts). תמונות,
-- קידום, הקפצה, שיתוף ומספר הצפיות אינם כאן בכוונה — הם משנים את הנכס ולא
-- את מה שיש לכתוב עליו.
--
-- ‏features ממוינים לפני ה-hash: הטופס בונה את המערך לפי סדר תיבות הסימון,
-- וסימון מחדש של אותם מאפיינים בסדר אחר אינו שינוי תוכן.
create or replace function public.property_marketing_fingerprint(p public.properties)
returns text
language sql
immutable
as $$
  select md5(concat_ws('|',
    p.title, p.description, p.property_type, p.deal_type, p.category,
    p.price::text, p.rooms::text,
    coalesce(p.size_sqm, p.area_sqm)::text, p.built_size_sqm::text, p.garden_sqm::text,
    p.floor::text, p.total_floors::text,
    p.city, p.neighborhood_id::text, p.street, p.house_number,
    (select string_agg(f, ',' order by f)
       from unnest(coalesce(p.features, '{}'::text[])) as t(f)),
    p.condition, p.project_status,
    p.move_in_date::text, p.move_in_soon::text, p.furniture_details,
    p.restrooms_location, p.storage_location, p.mamad_location,
    p.land_zoning, p.land_building_rights_pct::text,
    p.land_max_units::text, p.land_max_floors::text, p.land_planning_notes
  ));
$$;

comment on function public.property_marketing_fingerprint(public.properties) is
  'טביעת אצבע של השדות שנכנסים לתיאור השיווקי. שינוי בה = הטקסט התיישן; שינוי בתמונות או בקידום אינו נוגע בה.';

-- ‏revoke מ-anon/authenticated לא רק מגביל הרשאה: הוא גם מונע מ-PostgREST
-- לחשוף את הפונקציה כ"עמודה מחושבת" על properties לכל גולש/ת.
revoke all on function public.property_marketing_fingerprint(public.properties) from public;
revoke all on function public.property_marketing_fingerprint(public.properties) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. מי כתב, מתי, והאם התיישן
--
-- טריגר BEFORE אחד מחזיק את שלוש המטא-עמודות. למה בטריגר ולא בקוד: התיאור
-- השיווקי נכתב היום משלושה מקומות (טופס ה-CRM, אשף הייבוא, השרת) ומחר
-- יהיה רביעי. שכחה של אחד מהם הייתה משאירה מטא-דאטה שקרית — וזו בדיוק
-- מטא-דאטה שאיש לא בודק עד שהיא כבר שגויה.
--
-- ההבחנה בין "הסוכן/ת כתב/ה" ל"Claude כתב" נעשית דרך משתנה סשן שהפונקציה
-- ב-§6 מדליקה (‏`app.marketing_copy_writer`). לא לפי `source` שנשלח בעדכון:
-- עדכון שמשאיר את `source` על ערכו הקודם היה נקרא בטעות כהצהרה מפורשת,
-- והטקסט של הסוכן/ת היה נרשם על שם המכונה. ברירת המחדל היא תמיד "אדם".
-- ---------------------------------------------------------------------------
create or replace function public.properties_track_marketing_copy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_writer  text := coalesce(nullif(current_setting('app.marketing_copy_writer', true), ''), 'agent');
  v_text    text := nullif(btrim(coalesce(new.marketing_description, '')), '');
  v_changed boolean;
begin
  v_changed := case tg_op
    when 'INSERT' then v_text is not null
    else new.marketing_description is distinct from old.marketing_description
  end;

  if v_changed then
    if v_text is null then
      -- התיאור נמחק: אין למי לייחס אותו ואין מה להשוות מולו. הנכס חוזר
      -- להיות "בלי תיאור", והטריגר שב-§4 יכניס אותו לתור.
      new.marketing_description_source      := null;
      new.marketing_description_at          := null;
      new.marketing_description_fingerprint := null;
    else
      new.marketing_description_source      := case when v_writer = 'ai' then 'ai' else 'agent' end;
      new.marketing_description_at          := now();
      new.marketing_description_fingerprint := public.property_marketing_fingerprint(new);
    end if;
  end if;

  new.marketing_description_stale := v_text is not null
    and new.marketing_description_fingerprint is not null
    and new.marketing_description_fingerprint
        is distinct from public.property_marketing_fingerprint(new);

  return new;
end;
$$;

comment on function public.properties_track_marketing_copy() is
  'מחזיקה את מקור התיאור השיווקי, מועדו וטביעת האצבע שלו, ומסמנת אותו כמיושן כשנתוני הנכס משתנים.';

revoke all on function public.properties_track_marketing_copy() from public;
revoke all on function public.properties_track_marketing_copy() from anon, authenticated;

drop trigger if exists properties_track_marketing_copy on public.properties;
create trigger properties_track_marketing_copy
  before insert or update on public.properties
  for each row execute function public.properties_track_marketing_copy();

-- ---------------------------------------------------------------------------
-- 3. התור
--
-- שורה אחת לכל נכס, שנעשה בה שימוש חוזר — בניגוד ל-property_publications,
-- שם ה-unique נועד למנוע פוסט שני. כאן כתיבה חוזרת היא בדיוק מה שמבקשים:
-- ‏`reason` אומר למה הנכס בתור, ו-`updated_at` הוא גם ה-cooldown של הבקשה
-- הידנית (‏§7).
-- ---------------------------------------------------------------------------
create table if not exists public.property_description_jobs (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,

  status        text not null default 'pending'
                check (status in ('pending','done','failed','skipped')),

  -- ‏missing = הנכס נשמר בלי תיאור · manual = הסוכן/ת ביקש/ה נוסח חדש ·
  -- ‏backfill = נכס שהיה בפלטפורמה לפני שהמנגנון הזה נולד.
  reason        text not null default 'missing'
                check (reason in ('missing','manual','backfill')),

  run_after     timestamptz not null default now(),
  attempts      smallint not null default 0,
  last_error    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,

  constraint property_description_jobs_unique unique (property_id)
);

comment on table public.property_description_jobs is
  'תור כתיבת התיאורים השיווקיים. שורה אחת לכל נכס, בשימוש חוזר — היא גם התור, גם היומן וגם ה-cooldown של בקשת רענון.';
comment on column public.property_description_jobs.reason is
  'missing = נשמר בלי תיאור · manual = הסוכן/ת ביקש/ה רענון · backfill = נכס מלפני הפעלת המנגנון.';
comment on column public.property_description_jobs.run_after is
  'לא כותבים לפני הזמן הזה. נותן לסוכן/ת חלון לתקן נתונים שהוקלדו שגוי בשמירה הראשונה.';

create index if not exists property_description_jobs_queue_idx
  on public.property_description_jobs (run_after)
  where status = 'pending';

drop trigger if exists property_description_jobs_set_updated_at on public.property_description_jobs;
create trigger property_description_jobs_set_updated_at
  before update on public.property_description_jobs
  for each row execute function public.set_updated_at();

-- 3ב. הרשאות
--
-- הכתיבה כולה עוברת בפונקציות שלמטה, ולכן אין policy של insert/update לאיש.
-- הקריאה פתוחה לסוכן/ת על הנכסים שלו/ה — זה מה שמאפשר ל-CRM להראות
-- "ממתין לכתיבה…" על כרטיס נכס חדש במקום שקט.
alter table public.property_description_jobs enable row level security;
revoke all on public.property_description_jobs from anon, authenticated;
grant select on public.property_description_jobs to authenticated;

drop policy if exists "agent reads own description jobs" on public.property_description_jobs;
create policy "agent reads own description jobs"
  on public.property_description_jobs for select
  using (exists (
    select 1 from public.properties p
     where p.id = property_description_jobs.property_id
       and (p.agent_id = (select public.current_agent_id())
            or p.agency_id = (select agency_id from public.agency_members
                               where id = (select public.current_agent_id())))));

drop policy if exists "platform admin reads description jobs" on public.property_description_jobs;
create policy "platform admin reads description jobs"
  on public.property_description_jobs for select
  using (exists (
    select 1 from public.agency_members
     where agency_members.user_id = (select auth.uid())
       and agency_members.is_platform_admin = true));

-- ---------------------------------------------------------------------------
-- 4. כניסה לתור
--
-- נקודת כניסה אחת לשלושת המסלולים — הטריגר, הבקשה הידנית וה-backfill.
-- ‏`p_force` מחזיר לתור שורה שכבר טופלה; בלעדיו קריאה חוזרת על נכס שכבר
-- קיבל תיאור לא עושה כלום.
-- ---------------------------------------------------------------------------
create or replace function public.queue_property_description(
  p_property_id   uuid,
  p_reason        text default 'missing',
  p_force         boolean default false,
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
      where key = 'marketing_description_delay_minutes'),
    10);

  insert into public.property_description_jobs (property_id, reason, run_after)
  values (p_property_id, p_reason, now() + make_interval(mins => greatest(v_delay, 0)))
  on conflict (property_id) do update
    set status       = case when p_force then 'pending' else public.property_description_jobs.status end,
        reason       = case when p_force then p_reason else public.property_description_jobs.reason end,
        attempts     = case when p_force then 0 else public.property_description_jobs.attempts end,
        last_error   = case when p_force then null else public.property_description_jobs.last_error end,
        completed_at = case when p_force then null else public.property_description_jobs.completed_at end,
        run_after    = case when p_force
                            then now() + make_interval(mins => greatest(v_delay, 0))
                            else public.property_description_jobs.run_after end
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.queue_property_description(uuid, text, boolean, int) is
  'מכניסה נכס לתור כתיבת התיאור השיווקי. נקודת הכניסה היחידה — לטריגר, לבקשה הידנית ול-backfill.';

revoke all on function public.queue_property_description(uuid, text, boolean, int) from public;
revoke all on function public.queue_property_description(uuid, text, boolean, int) from anon, authenticated;
grant execute on function public.queue_property_description(uuid, text, boolean, int) to service_role;

-- 4ב. הטריגר
--
-- "נכס שצריך תיאור" הוא נכס שנשמר בלי `marketing_description` — בהוספה, או
-- בעדכון שמחק את הטקסט או החזיר את הנכס לפרסום. שינוי מחיר או מאפיינים על
-- נכס שכבר יש לו תיאור **אינו** מכניס אותו לתור: זו בדיוק ההצעה לרענון,
-- והיא נשארת בידי הסוכן/ת (‏marketing_description_stale ב-§2).
--
-- כמו בטריגר הפרסום: כל הגוף עטוף ב-exception handler. כתיבת טקסט היא
-- פיצ'ר שיווקי, ואסור לה למנוע מסוכן/ת לשמור נכס.
create or replace function public.properties_queue_description()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select value::int from public.pricing_config
                where key = 'marketing_description_auto_enabled'), 1) <> 1 then
    return null;
  end if;

  -- ‏p_force: הטריגר יורה רק כשאין תיאור, ולכן שורה ישנה במצב done חייבת
  -- לחזור לתור — אחרת נכס שהטקסט שלו נמחק לא יקבל חדש לעולם.
  perform public.queue_property_description(new.id, 'missing', true);
  return null;
exception when others then
  raise warning 'properties_queue_description נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.properties_queue_description() is
  'מכניסה נכס פעיל שאין לו תיאור שיווקי לתור הכתיבה. no-op שקט כשהמתג כבוי.';

revoke all on function public.properties_queue_description() from public;
revoke all on function public.properties_queue_description() from anon, authenticated;

drop trigger if exists properties_queue_description_ins on public.properties;
create trigger properties_queue_description_ins
  after insert on public.properties
  for each row
  when (new.status = 'active'
        and nullif(btrim(coalesce(new.marketing_description, '')), '') is null)
  execute function public.properties_queue_description();

drop trigger if exists properties_queue_description_upd on public.properties;
create trigger properties_queue_description_upd
  after update on public.properties
  for each row
  when (new.status = 'active'
        and nullif(btrim(coalesce(new.marketing_description, '')), '') is null
        and (nullif(btrim(coalesce(old.marketing_description, '')), '') is not null
             or old.status is distinct from 'active'))
  execute function public.properties_queue_description();

-- ---------------------------------------------------------------------------
-- 5. משיכת התור
--
-- כאן יושב **הכלל היחיד שבאמת חשוב במנגנון הזה**: נכס שיש לו תיאור שיווקי
-- לא חוזר מהתור. לא תנאי בשרת שאפשר לשכוח בגרסה הבאה, אלא התנאי שדרכו התור
-- מדבר — כל מסלול אוטומטי, קיים או עתידי, עובר דרך השאילתה הזו.
--
-- שאר התנאים הם אותם שומרי סף כמו בתור הפרסום: הנכס פעיל, הזמן הגיע, המתג
-- דלוק, והתקרה היומית לא נשברה.
-- ---------------------------------------------------------------------------
create or replace function public.pending_property_descriptions(p_limit int default 5)
returns table (job_id uuid, property_id uuid, reason text)
language sql
security definer
set search_path = ''
as $$
  with cap as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'marketing_description_daily_cap'), 80) as daily_cap
  ),
  written_today as (
    select count(*) as n
      from public.property_description_jobs
     where status = 'done' and completed_at > now() - interval '24 hours'
  )
  select j.id, p.id, j.reason
    from public.property_description_jobs j
    join public.properties p on p.id = j.property_id
   cross join cap
   cross join written_today
   where j.status = 'pending'
     and j.run_after <= now()
     and p.status = 'active'
     and nullif(btrim(coalesce(p.marketing_description, '')), '') is null
     and written_today.n < cap.daily_cap
     and coalesce((select value::int from public.pricing_config
                    where key = 'marketing_description_auto_enabled'), 1) = 1
   order by j.run_after
   limit least(greatest(coalesce(p_limit, 5), 1), 25);
$$;

comment on function public.pending_property_descriptions(int) is
  'הנכסים שמותר לכתוב להם תיאור עכשיו. נכס שכבר יש לו תיאור אינו חוזר מכאן — זו ההגנה שמונעת דריסת טקסט של אדם.';

revoke all on function public.pending_property_descriptions(int) from public;
revoke all on function public.pending_property_descriptions(int) from anon, authenticated;
grant execute on function public.pending_property_descriptions(int) to service_role;

-- 5ב. עובדות הנכס
--
-- אותו סט שדות שנכנס לפרומפט, במקום אחד. נפרד ממשיכת התור כי הוא נדרש גם
-- למסלול הידני — שם אין שורת תור ממתינה, יש נכס ובקשה.
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
  marketing_description_stale  boolean
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
    p.city, n.name, p.street,
    p.features, p.condition, p.project_status, p.move_in_date, p.furniture_details,
    p.land_zoning, p.land_building_rights_pct, p.land_max_units,
    p.land_max_floors, p.land_planning_notes,
    m.display_name, a.name,
    p.marketing_description_source, p.marketing_description_stale
    from public.properties p
    left join public.neighborhoods  n on n.id = p.neighborhood_id
    left join public.agency_members m on m.id = p.agent_id
    left join public.agencies       a on a.id = p.agency_id
   where p.id = p_property_id;
$$;

comment on function public.property_marketing_facts(uuid) is
  'כל מה שנכנס לתיאור השיווקי של נכס אחד. מקור אמת יחיד לשני המסלולים — האוטומטי והידני.';

revoke all on function public.property_marketing_facts(uuid) from public;
revoke all on function public.property_marketing_facts(uuid) from anon, authenticated;
grant execute on function public.property_marketing_facts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. תפיסה, שמירה וסימון
--
-- אותה תבנית כמו בתור הפרסום: תפיסה שמפרידה בין "התחלתי" ל"סיימתי" ומונעת
-- שתי קריאות ל-Claude על אותו נכס בשתי הרצות חופפות.
-- ---------------------------------------------------------------------------
create or replace function public.claim_property_description(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  update public.property_description_jobs
     set attempts  = attempts + 1,
         run_after = now() + interval '15 minutes'
   where id = p_job_id
     and status = 'pending'
     and run_after <= now();

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

comment on function public.claim_property_description(uuid) is
  'תופסת שורה מהתור לפני הקריאה ל-Claude. הדחייה ברבע שעה היא גם ה-backoff לניסיון הבא.';

revoke all on function public.claim_property_description(uuid) from public;
revoke all on function public.claim_property_description(uuid) from anon, authenticated;
grant execute on function public.claim_property_description(uuid) to service_role;

-- 6ב. השמירה
--
-- הדרך היחידה שבה טקסט נשמר על שם המכונה. משתנה הסשן שנדלק כאן הוא מה
-- שהטריגר שב-§2 קורא, ולכן אי אפשר "בטעות" לרשום נוסח של סוכן/ת כאוטומטי:
-- זה דורש קריאה לפונקציה הזו, שפתוחה ל-service_role בלבד.
--
-- ‏post_text של הסוכן/ת נשאר שלו/ה גם בכתיבה מחדש: המערכת משלימה מה שחסר,
-- לא מחליפה מה שנכתב ביד.
create or replace function public.apply_property_marketing_description(
  p_property_id uuid,
  p_description text,
  p_post_text   text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  if nullif(btrim(coalesce(p_description, '')), '') is null then
    return false;
  end if;

  perform set_config('app.marketing_copy_writer', 'ai', true);

  update public.properties
     set marketing_description = btrim(p_description),
         post_text = case
           when nullif(btrim(coalesce(post_text, '')), '') is not null then post_text
           else nullif(btrim(coalesce(p_post_text, '')), '')
         end
   where id = p_property_id;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.apply_property_marketing_description(uuid, text, text) is
  'שומרת תיאור שיווקי שנכתב אוטומטית ומסמנת אותו ככזה. לא נוגעת ב-post_text שנכתב ביד.';

revoke all on function public.apply_property_marketing_description(uuid, text, text) from public;
revoke all on function public.apply_property_marketing_description(uuid, text, text) from anon, authenticated;
grant execute on function public.apply_property_marketing_description(uuid, text, text) to service_role;

-- 6ג. סימון התוצאה
--
-- ‏status נגזר כאן ולא מתקבל מהשרת: "נכשל סופית" הוא החלטה של מדיניות
-- (‏marketing_description_max_attempts) ולא של הקריאה הבודדת שנפלה.
--
-- ההתראה נשלחת רק במסלול האוטומטי ורק לנכס של סוכן/ת קיים/ת: סוכן/ת
-- שביקש/ה רענון בעצמו/ה כבר רואה את התוצאה על המסך.
create or replace function public.mark_property_description(
  p_job_id uuid,
  p_ok     boolean,
  p_error  text default null
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
  v_reason   text;
  v_agent    uuid;
  v_title    text;
begin
  v_max := coalesce((select value::int from public.pricing_config
                      where key = 'marketing_description_max_attempts'), 4);

  select j.attempts, j.reason, p.agent_id, p.title
    into v_attempts, v_reason, v_agent, v_title
    from public.property_description_jobs j
    join public.properties p on p.id = j.property_id
   where j.id = p_job_id;
  if v_attempts is null then
    return null;
  end if;

  v_status := case
    when p_ok then 'done'
    when v_attempts >= v_max then 'failed'
    else 'pending'
  end;

  update public.property_description_jobs
     set status       = v_status,
         last_error   = case when p_ok then null else p_error end,
         completed_at = case when p_ok then now() else completed_at end
   where id = p_job_id;

  if p_ok and v_reason <> 'manual' and v_agent is not null then
    insert into public.notifications (agent_id, type, title, body)
    values (v_agent, 'marketing_copy', 'נכתב תיאור שיווקי לנכס',
            coalesce(v_title, 'לנכס שלך') ||
            ' — המערכת כתבה תיאור שיווקי מנתוני המודעה. כדאי לעבור עליו בכרטיס הנכס ולערוך אם צריך.');
  end if;

  return v_status;
end;
$$;

comment on function public.mark_property_description(uuid, boolean, text) is
  'מסמנת את תוצאת הכתיבה ומודיעה לסוכן/ת על תיאור שנכתב אוטומטית. failed נקבע לפי מדיניות הניסיונות.';

revoke all on function public.mark_property_description(uuid, boolean, text) from public;
revoke all on function public.mark_property_description(uuid, boolean, text) from anon, authenticated;
grant execute on function public.mark_property_description(uuid, boolean, text) to service_role;

-- 6ד. סוג ההתראה החדש
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert',
                  'client_match','review_new','deal_closed','lead_unrouted',
                  'marketing_copy'));

-- ---------------------------------------------------------------------------
-- 7. הבקשה הידנית של הסוכן/ת
--
-- זו הפונקציה שהכפתור "רענון תיאור שיווקי" ב-CRM עומד עליו. היא לא כותבת
-- כלום — היא רק עונה "מותר לך, וזה הנכס". הכתיבה עצמה היא ב-Edge Function,
-- כי היא קריאה ל-Anthropic ואין לה מה לחסום טרנזקציה במסד.
--
-- שלוש בדיקות, בסדר הזה: מי את/ה, האם הנכס שלך, ומתי ביקשת לאחרונה.
-- ה-cooldown הוא הגנת עלות אמיתית: לחיצה כפולה על הכפתור היא שתי קריאות
-- ל-Claude, ולחיצה חוזרת מתוך סקרנות היא עשר.
--
-- ההרשאה רחבה מזו של bump_property בכוונה — גם שותפ/ה במשרד וגם מנהל/ת
-- פלטפורמה רשאים/ות. עריכת הנכס פתוחה לאותו מעגל ממילא, וטקסט שיווקי הוא
-- פעולה חלשה יותר מעריכת מחיר.
-- ---------------------------------------------------------------------------
create or replace function public.request_property_description(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent    uuid;
  v_agency   uuid;
  v_admin    boolean;
  v_prop     record;
  v_cooldown int;
  v_last     timestamptz;
  v_job      uuid;
begin
  select m.id, m.agency_id, coalesce(m.is_platform_admin, false)
    into v_agent, v_agency, v_admin
    from public.agency_members m
   where m.user_id = (select auth.uid())
     and m.active = true;

  if v_agent is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select id, agent_id, agency_id, status into v_prop
    from public.properties where id = p_property_id;
  if v_prop.id is null then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  if not (v_admin or v_prop.agent_id = v_agent
          or (v_agency is not null and v_prop.agency_id = v_agency)) then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  v_cooldown := coalesce((select value::int from public.pricing_config
                           where key = 'marketing_description_manual_cooldown_seconds'), 45);

  select updated_at into v_last
    from public.property_description_jobs where property_id = p_property_id;
  if v_last is not null and v_last > now() - make_interval(secs => greatest(v_cooldown, 0)) then
    return jsonb_build_object('error', 'cooldown_active', 'retry_after_seconds',
      ceil(extract(epoch from (v_last + make_interval(secs => v_cooldown)) - now()))::int);
  end if;

  v_job := public.queue_property_description(p_property_id, 'manual', true, 0);
  return jsonb_build_object('success', true, 'job_id', v_job);
end;
$$;

comment on function public.request_property_description(uuid) is
  'בקשת רענון תיאור שיווקי מהסוכן/ת: בודקת הרשאה ו-cooldown ופותחת שורת תור. הכתיבה עצמה ב-Edge Function.';

revoke all on function public.request_property_description(uuid) from public;
revoke all on function public.request_property_description(uuid) from anon;
grant execute on function public.request_property_description(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. ניקוי
--
-- שורה שממתינה על נכס שכבר אינו פעיל, או שבינתיים קיבל תיאור מהסוכן/ת,
-- תישאר pending לנצח ותזהם את התור. שעה של חסד לפני הסימון — מספיק זמן
-- לשמירה חוזרת של אותו טופס, מעט מכדי להיתקע.
-- ---------------------------------------------------------------------------
create or replace function public.expire_property_descriptions()
returns integer
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.property_description_jobs j
       set status = 'skipped',
           last_error = coalesce(j.last_error,
             case when p.status is distinct from 'active'
                  then 'הנכס כבר אינו פעיל'
                  else 'הנכס קיבל תיאור שיווקי בדרך אחרת' end)
      from public.properties p
     where p.id = j.property_id
       and j.status = 'pending'
       and j.created_at < now() - interval '1 hour'
       and (p.status is distinct from 'active'
            or nullif(btrim(coalesce(p.marketing_description, '')), '') is not null)
    returning 1
  )
  select count(*)::int from done;
$$;

comment on function public.expire_property_descriptions() is
  'מסמנת skipped שורות שממתינות על נכס לא פעיל או על נכס שכבר קיבל תיאור. שומרת על התור נקי.';

revoke all on function public.expire_property_descriptions() from public;
revoke all on function public.expire_property_descriptions() from anon, authenticated;
grant execute on function public.expire_property_descriptions() to service_role;

-- ---------------------------------------------------------------------------
-- 9. תזמון
--
-- אותה תבנית כמו saved-search-notify ו-property-marketing-publish: ‏pg_cron
-- קורא ל-Edge Function דרך pg_net, והסוד ל-header נקרא מ-Vault.
--
-- הדקה מוזזת ב-2 ביחס לפרסום (‏*/5 מול 2-59/5) כדי ששתי הפונקציות שקוראות
-- ל-Anthropic לא ייצאו באותה שנייה. ההשהיה של עשר הדקות ממילא לא מרגישה
-- את ההפרש.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/property-description';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את property-description בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('property-description')
    where exists (select 1 from cron.job where jobname = 'property-description');
  perform cron.unschedule('property-descriptions-expire')
    where exists (select 1 from cron.job where jobname = 'property-descriptions-expire');

  perform cron.schedule('property-description', '2-59/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    );
  $cron$, v_url));

  perform cron.schedule('property-descriptions-expire', '47 * * * *',
                        'select public.expire_property_descriptions()');
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. הנכסים שכבר בפלטפורמה
--
-- כאן ההפך מ-§9 של מיגרציית הפרסום: שם הנכסים הקיימים נכנסו כ-skipped, כי
-- ‏61 פוסטים ברצף הם הצפה של דף הפייסבוק. תיאור שיווקי אינו מתפרסם לשום
-- מקום ברעש — הוא נשמר על המודעה — ולכן דווקא הנכסים הוותיקים הם מי שהכי
-- צריך אותו: הם אלה שהמנגנון הישן דילג עליהם.
--
-- שני חלקים:
--   א. **קו הבסיס** לנכסים שכבר יש להם תיאור. בלעדיו כולם היו מסומנים
--      "מומלץ לרענן" ברגע ההתקנה, וההצעה הייתה מאבדת כל משמעות. המקור
--      נקרא מיומן הפרסום: נכס שסומן שם description_generated הוא נוסח של
--      ‏Claude, וכל השאר — עד שיוכח אחרת — נוסח של אדם.
--   ב. **התור** לנכסים הפעילים שאין להם תיאור. הם נכנסים מפוזרים על פני
--      השעות הקרובות (‏run_after עולה בדקה לכל נכס), כך שהתקרה היומית לא
--      נשברת והעומס על Anthropic נשאר אחיד.
-- ---------------------------------------------------------------------------
update public.properties p
   set marketing_description_fingerprint = public.property_marketing_fingerprint(p),
       marketing_description_at          = coalesce(p.marketing_description_at, p.updated_at),
       marketing_description_source      = coalesce(
         p.marketing_description_source,
         case when exists (select 1 from public.property_publications pub
                            where pub.property_id = p.id
                              and pub.description_generated = true)
              then 'ai' else 'agent' end),
       marketing_description_stale       = false
 where nullif(btrim(coalesce(p.marketing_description, '')), '') is not null
   and p.marketing_description_fingerprint is null;

insert into public.property_description_jobs (property_id, reason, run_after)
select p.id, 'backfill',
       now() + make_interval(mins => (row_number() over (order by p.created_at desc))::int)
  from public.properties p
 where p.status = 'active'
   and nullif(btrim(coalesce(p.marketing_description, '')), '') is null
on conflict (property_id) do nothing;

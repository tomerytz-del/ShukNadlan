-- ---------------------------------------------------------------------------
-- וואטסאפ כערוץ ברירת המחדל להתראות של הסוכנים
--
-- עד היום היו שני ערוצים יוצאים, ושניהם נולדו כבויים בוואטסאפ:
--
--   ‏· הפעמון (`agent_notification_preferences.whatsapp_types`) — רשימת
--     **מאושרים**: שום סוג לא יצא בוואטסאפ עד שסומן, חוץ מ-agenda_reminder.
--   ‏· התזכורות והטיפים (`agent_reminder_preferences.channels`) — ברירת
--     המחדל `{email}`.
--
-- ההחלטה העסקית התהפכה: ברירת המחדל היא וואטסאפ, ומי שרוצה מוסיף/ה לעצמו/ה
-- גם מייל. ולכולם הקיימים - עוברים עכשיו לוואטסאפ.
--
-- הפעמון: כל סוג דלוק בוואטסאפ עד שמכבים אותו. ‏`whatsapp_off_types`, שנולדה
-- ב-20270125090000 בשביל agenda_reminder בלבד, היא עכשיו הרשימה היחידה שקובעת,
-- ו-`whatsapp_types` נשארת בטבלה בלי קורא. "כל הסוגים" נגזר מ-
-- ‏`notifications_type_check` עצמו (‏`notification_known_types`), ולכן סוג
-- שייכנס בעתיד דלוק בוואטסאפ אוטומטית, בלי מיגרציה ובלי רשימה שנייה שתתפצל.
--
-- מה לא השתנה: השער של המסלול (‏mid/premium בחיוב פעיל), המספר על הכרטיס,
-- שעות השקט, מרווח הקיבוץ, התקרה היומית וגג הכשלים. ‏agenda_reminder עדיין
-- היחיד שעוקף שקט ומרווח.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. כל סוגי ההתראה שהמסד מכיר
--
-- נקרא מהאילוץ ולא מרשימה כאן: האילוץ מוחלף בכל מיגרציה שמוסיפה סוג, ורשימה
-- שנייה הייתה נשכחת בפעם הראשונה - והסוג החדש היה נשאר כבוי בוואטסאפ בשקט.
-- ---------------------------------------------------------------------------
create or replace function public.notification_known_types()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}'::text[])
    from pg_catalog.pg_constraint c
    cross join lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid),
                                      '''([a-z0-9_]+)''', 'g') as m
   where c.conrelid = 'public.notifications'::regclass
     and c.conname  = 'notifications_type_check';
$$;

comment on function public.notification_known_types() is
  'כל סוגי ההתראה ש-notifications_type_check מתיר. מקור "הכול" של ערוץ הוואטסאפ, שדלוק כברירת מחדל.';

revoke all on function public.notification_known_types() from public, anon, authenticated;
grant execute on function public.notification_known_types() to service_role;

-- ---------------------------------------------------------------------------
-- 2. הרשימה האפקטיבית: הכול, פחות מה שכובה
--
-- החתימה לא השתנתה, ולכן `notification_push_ready` ו-`notification_push_claim`
-- עובדות בלי שינוי. השינוי היחיד מול 20270125090000 הוא חישוב `whatsapp_types`.
-- ---------------------------------------------------------------------------
comment on column public.agent_notification_preferences.whatsapp_off_types is
  'סוגי התראה שכובו בוואטסאפ. רשימת מושתקים: כל סוג דלוק בוואטסאפ כברירת מחדל (20270303090000).';
comment on column public.agent_notification_preferences.whatsapp_types is
  'לא בשימוש מאז 20270303090000 - וואטסאפ דלוק כברירת מחדל, ומה שקובע הוא whatsapp_off_types.';

create or replace function public.notification_push_due_agents()
returns table (
  agent_id       uuid,
  display_name   text,
  phone_e164     text,
  whatsapp_types text[],
  in_service_window boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_gap_minutes'), 10)      as gap_min,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_per_day'), 12)      as cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_failures_24h'), 3)  as max_fail,
           -- עוקפים שקט ומרווח. ראו סעיף 9 ב-20270125090000.
           array['agenda_reminder']::text[]                            as urgent,
           public.notification_known_types()                          as known
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           array(
             select t from unnest((select known from cfg)) t
              where t <> all (coalesce(np.whatsapp_off_types, '{}'::text[]))
           )                                             as whatsapp_types,
           coalesce(rp.quiet_from_hour, 21)              as quiet_from,
           coalesce(rp.quiet_to_hour,   8)               as quiet_to
      from public.agency_members m
      left join public.agent_notification_preferences np on np.agent_id = m.id
      left join public.agent_reminder_preferences     rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ),
  recent as (
    select l.agent_id,
           max(l.created_at) as last_at,
           count(*) filter (
             where public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as n24,
           count(*) filter (
             where not public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as fails24
      from public.notification_push_log l
     group by l.agent_id
  ),
  shaped as (
    select a.id, a.display_name, a.phone_e164,
           case
             when public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to)
               or (r.last_at is not null
                   and r.last_at >= now() - make_interval(mins => cfg.gap_min))
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             else a.whatsapp_types
           end as types,
           r.n24, r.fails24, cfg.cap, cfg.max_fail
      from agents a
      cross join cfg
      left join recent r on r.agent_id = a.id
  )
  select s.id, s.display_name, s.phone_e164, s.types,
         coalesce(
           (select c.last_message_at > now() - interval '23 hours'
              from public.whatsapp_conversations c
             where c.agent_id = s.id),
           false)
    from shaped s
   where coalesce(array_length(s.types, 1), 0) > 0
     and s.phone_e164 is not null
     and coalesce(s.n24, 0) < s.cap
     and coalesce(s.fails24, 0) < s.max_fail;
$$;

comment on function public.notification_push_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן עכשיו הודעת וואטסאפ, והסוגים שמותרים ברגע הזה: כל סוג שלא כובה (whatsapp_off_types), מסלול mid/premium בחיוב פעיל, מספר, תקרה יומית וגג כשלים. בשעות השקט ובתוך מרווח הקיבוץ - רק הסוגים הדחופים (agenda_reminder).';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 3. ביטול מול Meta (131050) מכבה את כל הסוגים
--
-- עד היום הפונקציה ניקתה את `whatsapp_types` - ומכיוון שהערוץ דלוק עכשיו
-- כברירת מחדל, ניקוי כזה כבר אינו מכבה דבר. הכיבוי הוא לכתוב את כל הסוגים
-- לרשימת הכבויים. ‏upsert ולא update: לרוב הסוכנים אין שורה, והערוץ דלוק
-- אצלם בלעדיה. (זה גם סוגר את agenda_reminder, שהגרסה הקודמת השאירה דלוק.)
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_opt_out(p_agent_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.agent_notification_preferences
    (agent_id, whatsapp_types, whatsapp_off_types, updated_at)
  values (p_agent_id, '{}'::text[], public.notification_known_types(), now())
  on conflict (agent_id) do update
     set whatsapp_types     = '{}'::text[],
         whatsapp_off_types = public.notification_known_types(),
         updated_at         = now();
$$;

comment on function public.notification_push_opt_out(uuid) is
  'מכבה את ערוץ הוואטסאפ של ההתראות לסוכן/ת אחד/ת (כל הסוגים ל-whatsapp_off_types), אחרי שגיאת 131050 מ-Meta. הפעמון בדשבורד אינו נוגע בזה.';

revoke all on function public.notification_push_opt_out(uuid) from public, anon, authenticated;
grant execute on function public.notification_push_opt_out(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. כולם עוברים לוואטסאפ בפעמון
--
-- ‏muted_types לא נוגע: סוג שכובה בפעמון אינו נוצר בכלל, ולכן גם לא יוצא.
-- ---------------------------------------------------------------------------
update public.agent_notification_preferences
   set whatsapp_types     = '{}'::text[],
       whatsapp_off_types = '{}'::text[],
       updated_at         = now()
 where whatsapp_types <> '{}'::text[]
    or whatsapp_off_types <> '{}'::text[];

-- ---------------------------------------------------------------------------
-- 5. התזכורות והטיפים: וואטסאפ כברירת מחדל, וכולם עוברים אליו
--
-- מייל נשאר ערוץ שמוסיפים בטופס. ‏`where` כדי שהרצה חוזרת לא תדרוס בחירה
-- שנעשתה אחרי המיגרציה - היא נוגעת רק בשורה שאין בה וואטסאפ ושאינה ריקה
-- (מערך ריק = "בלי הודעות", בחירה מפורשת שנשמרת).
-- ---------------------------------------------------------------------------
alter table public.agent_reminder_preferences
  alter column channels set default '{whatsapp}';

comment on column public.agent_reminder_preferences.channels is
  'תת-קבוצה של {email,whatsapp}, ברירת מחדל {whatsapp}. מערך ריק = בלי הודעות בכלל; הממצאים עדיין מוצגים בדשבורד. וואטסאפ בלי מספר על הכרטיס נופל למייל (agent_reminder_due_agents).';
comment on table public.agent_reminder_preferences is
  'שליטת הסוכן/ת בתזכורות: ערוצים, קצב, תקרה, סוגים מושתקים ושעות שקט. היעדר שורה = ברירות המחדל (וואטסאפ, שבועי, 6 ב-30 יום, הכול מופעל).';

update public.agent_reminder_preferences
   set channels   = '{whatsapp}'::text[],
       updated_at = now()
 where channels <> '{}'::text[]
   and not ('whatsapp' = any(channels));

-- ---------------------------------------------------------------------------
-- 6. מי בשל/ה לתזכורת - ברירת המחדל וואטסאפ, ונפילה למייל בלי מספר
--
-- שני שינויים מול 20261101090000, ושאר הפונקציה זהה:
--
--   ‏· `coalesce(p.channels, array['whatsapp'])` - היעדר שורה = וואטסאפ.
--   ‏· סוכן/ת שהערוץ שלו/ה וואטסאפ ואין מספר על הכרטיס מקבל/ת את ההודעה
--     במייל. בלי זה, המעבר לברירת המחדל החדשה היה משתיק בשקט כל מי שעוד
--     לא הזין/ה מספר - וזה בדיוק סוג הכשל שאין לו סימן.
--
-- ‏`agent_reminders_claim` וה-Edge Function קוראות את `channels` שחוזר מכאן,
-- ולכן הנפילה למייל עוברת אליהן בלי שינוי.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_due_agents()
returns table (
  agent_id        uuid,
  display_name    text,
  email           text,
  phone_e164      text,
  channels        text[],
  muted_kinds     text[],
  cadence         text,
  last_sent_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with dflt as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'agent_reminder_default_cap'), 6) as cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'reminder_max_failures_24h'), 3)  as max_fail
  ),
  raw as (
    select
      m.id, m.display_name,
      nullif(btrim(coalesce(m.email, '')), '')      as email,
      nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
      coalesce(p.channels,        array['whatsapp']::text[]) as channels,
      coalesce(p.muted_kinds,     '{}'::text[])              as muted_kinds,
      coalesce(p.cadence,         'weekly')                  as cadence,
      coalesce(p.max_per_30_days, d.cap)                     as cap,
      coalesce(p.quiet_from_hour, 21)                        as quiet_from,
      coalesce(p.quiet_to_hour,   8)                         as quiet_to
      from public.agency_members m
      cross join dflt d
      left join public.agent_reminder_preferences p on p.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
  ),
  agents as (
    select r.id, r.display_name, r.email, r.phone_e164,
           case
             when 'whatsapp' = any(r.channels)
              and r.phone_e164 is null
              and r.email is not null
              and not ('email' = any(r.channels))
             then r.channels || array['email']::text[]
             else r.channels
           end as channels,
           r.muted_kinds, r.cadence, r.cap, r.quiet_from, r.quiet_to
      from raw r
  ),
  -- ‏`last_at` ו-`n30` סופרים רק שורות שיצאו או שיוצאות עכשיו. סבב שנחתך
  -- לא ישתיק סוכן/ת לשישה ימים ולא יבזבז מקום בתקרת 30 הימים.
  -- ‏`fails24` הוא הגג מהצד השני: ערוץ ששבר שלוש פעמים ביממה נעצר.
  recent as (
    select l.agent_id,
           max(l.created_at) filter (
             where public.agent_reminder_log_holds(l.email_status, l.whatsapp_status, l.created_at)
           ) as last_at,
           count(*) filter (
             where public.agent_reminder_log_holds(l.email_status, l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '30 days'
           ) as n30,
           count(*) filter (
             where not public.agent_reminder_log_holds(l.email_status, l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as fails24
      from public.agent_reminder_log l
     group by l.agent_id
  )
  select a.id, a.display_name, a.email, a.phone_e164,
         a.channels, a.muted_kinds, a.cadence, r.last_at
    from agents a
    cross join dflt d
    left join recent r on r.agent_id = a.id
   where a.cadence <> 'off'
     and a.cap > 0
     and coalesce(array_length(a.channels, 1), 0) > 0
     -- ערוץ בלי כתובת אינו ערוץ. בלי הבדיקה הזו היינו מעירים את השרת בכל
     -- שעה בשביל סוכן/ת שביקש/ה וואטסאפ ולא הזין/ה מספר.
     and (('email'    = any(a.channels) and a.email      is not null)
       or ('whatsapp' = any(a.channels) and a.phone_e164 is not null))
     and not public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to)
     and coalesce(r.n30, 0) < a.cap
     and coalesce(r.fails24, 0) < d.max_fail
     -- ‏20 שעות ל"יומי" ולא 24: דייג'סט שיצא ב-9:05 לא אמור לחסום את זה של
     -- מחר ב-9:00 ולהזליג את השעה יום אחר יום. אותו היגיון ל"שבועי".
     and (r.last_at is null
          or r.last_at < now() - case a.cadence
                                   when 'daily' then interval '20 hours'
                                   else              interval '6 days'
                                 end);
$$;

comment on function public.agent_reminder_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן הודעת תזכורת עכשיו — ערוצים (ברירת מחדל וואטסאפ, ובלי מספר נופל למייל), קצב, תקרת 30 יום, שעות שקט וגג הכשלים היומי. סופרת רק שורות יומן שיצאו או שיוצאות עכשיו. אינה בודקת אם יש ממצא; זה החלק היקר ונשאר ב-claim.';

revoke all on function public.agent_reminder_due_agents() from public, anon, authenticated;
grant execute on function public.agent_reminder_due_agents() to service_role;

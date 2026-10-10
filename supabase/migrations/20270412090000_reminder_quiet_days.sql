-- ---------------------------------------------------------------------------
-- ימים שקטים בתזכורות ובהתראות
--
-- עד היום היה רק חלון שעות (‏quiet_from_hour → quiet_to_hour) שחוזר כל יום.
-- סוכנים ביקשו לבחור גם ימים שלמים - בעיקר שישי ושבת - שבהם לא תצא שום
-- הודעה. הודעה שהגיע זמנה ביום שקט ממתינה, בדיוק כמו בשעות השקט, לשעה
-- הראשונה שאינה שקטה.
--
-- ‏`quiet_days` היא רשימת ימי שבוע לפי `extract(dow)` של Postgres: 0 = ראשון
-- ... 5 = שישי, 6 = שבת. יום נקבע לפי שעון ישראל. מערך ריק (ברירת המחדל) =
-- בלי ימים שקטים, ולכן שום סוכן/ת קיים/ת לא מרגיש/ה שינוי.
--
-- העמודה יושבת ב-`agent_reminder_preferences`, ליד שעות השקט, ושני השולחים
-- קוראים אותה משם - בדיוק כמו את השעות:
--
--   ‏· `agent_reminder_due_agents`   - התזכורות והטיפים.
--   ‏· `notification_push_due_agents` - התראות הפעמון בוואטסאפ. ‏agenda_reminder
--     עדיין עוקף שקט (סעיף 9 ב-20270125090000): "ביטלתי" שעה לפני פגישה בשבת
--     הוא בדיוק ההודעה שצריכה לצאת.
--
-- שתי הפונקציות מועתקות מ-20270303090000, והשינוי היחיד בהן הוא הקריאה
-- לגרסה בת שלושת הפרמטרים של `agent_reminder_quiet_now`.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

alter table public.agent_reminder_preferences
  add column if not exists quiet_days smallint[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'agent_reminder_prefs_quiet_days_chk'
       and conrelid = 'public.agent_reminder_preferences'::regclass
  ) then
    alter table public.agent_reminder_preferences
      add constraint agent_reminder_prefs_quiet_days_chk
      check (quiet_days <@ array[0,1,2,3,4,5,6]::smallint[]);
  end if;
end $$;

comment on column public.agent_reminder_preferences.quiet_days is
  'ימי שבוע שקטים (0=ראשון ... 5=שישי, 6=שבת), שעון ישראל. ביום כזה לא יוצאות תזכורות ולא התראות וואטסאפ (חוץ מ-agenda_reminder). מערך ריק = בלי ימים שקטים.';

-- ---------------------------------------------------------------------------
-- 1. שקט עכשיו: שעות או יום
--
-- גרסה חדשה לצד הקיימת ולא במקומה - שתי פונקציות עם אותו שם וחתימה שונה.
-- הגרסה בת שני הפרמטרים נשארת כמו שהיא, וזו בת השלושה מוסיפה רק את בדיקת
-- היום. פונקציה טהורה מאותה סיבה שבגרסה המקורית.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_quiet_now(p_from int, p_to int, p_days smallint[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.agent_reminder_quiet_now(p_from, p_to)
      or extract(dow from (now() at time zone 'Asia/Jerusalem'))::smallint
         = any(coalesce(p_days, '{}'::smallint[]));
$$;

comment on function public.agent_reminder_quiet_now(int, int, smallint[]) is
  'האם אנחנו בתוך שעות השקט או ביום שקט של הסוכן/ת (שעון ישראל). ימים לפי extract(dow): 0=ראשון, 6=שבת.';

-- ---------------------------------------------------------------------------
-- 2. התראות הפעמון בוואטסאפ
-- ---------------------------------------------------------------------------
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
           coalesce(rp.quiet_to_hour,   8)               as quiet_to,
           coalesce(rp.quiet_days, '{}'::smallint[])     as quiet_days
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
             when public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to, a.quiet_days)
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
  'הסוכנים שמותר לשלוח להם/ן עכשיו הודעת וואטסאפ, והסוגים שמותרים ברגע הזה: כל סוג שלא כובה (whatsapp_off_types), מסלול mid/premium בחיוב פעיל, מספר, תקרה יומית וגג כשלים. בשעות השקט, בימים השקטים ובתוך מרווח הקיבוץ - רק הסוגים הדחופים (agenda_reminder).';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 3. התזכורות והטיפים
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
      coalesce(p.quiet_to_hour,   8)                         as quiet_to,
      coalesce(p.quiet_days,      '{}'::smallint[])          as quiet_days
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
           r.muted_kinds, r.cadence, r.cap, r.quiet_from, r.quiet_to, r.quiet_days
      from raw r
  ),
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
     and (('email'    = any(a.channels) and a.email      is not null)
       or ('whatsapp' = any(a.channels) and a.phone_e164 is not null))
     and not public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to, a.quiet_days)
     and coalesce(r.n30, 0) < a.cap
     and coalesce(r.fails24, 0) < d.max_fail
     and (r.last_at is null
          or r.last_at < now() - case a.cadence
                                   when 'daily' then interval '20 hours'
                                   else              interval '6 days'
                                 end);
$$;

comment on function public.agent_reminder_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן הודעת תזכורת עכשיו — ערוצים (ברירת מחדל וואטסאפ, ובלי מספר נופל למייל), קצב, תקרת 30 יום, שעות שקט, ימים שקטים וגג הכשלים היומי. סופרת רק שורות יומן שיצאו או שיוצאות עכשיו. אינה בודקת אם יש ממצא; זה החלק היקר ונשאר ב-claim.';

revoke all on function public.agent_reminder_due_agents() from public, anon, authenticated;
grant execute on function public.agent_reminder_due_agents() to service_role;

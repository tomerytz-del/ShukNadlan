-- מסלול חינם לא מקבל וואטסאפ מתזכורות.
--
-- agent-reminders (כל שעה ב-:15) שולח ישירות ל-Meta לפי הערוצים ש-
-- agent_reminder_due_agents מחזירה. ברירת המחדל היא {whatsapp}
-- (20270303090000), ואין שם בדיקת מסלול. בשבוע האחרון יצאו תזכורות
-- וואטסאפ לסוכנים במסלול חינם.
--
-- אותו תנאי כמו notification_push_due_agents: וואטסאפ רק כש-
-- tier in ('mid', 'premium'). מסלול חינם, וגם tier ריק, לא מקבל
-- וואטסאפ. בלי שורת העדפות הערוץ הוא מייל אם יש כתובת, ואחרת
-- אין שליחה. מי שבחר/ה וואטסאפ במפורש מקבל/ת מייל במקום, אם יש
-- כתובת. מערך ערוצים ריק נשאר בלי שליחה. הנפילה למייל כשאין
-- מספר, בלי להחליף וואטסאפ, נשארת רק במסלול בתשלום.
-- זה חל על כל סוג בתוך ההודעה, כולל unpublished_listings.
--
-- אידמפוטנטית: create or replace של אותה חתימה.

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
      m.id, m.display_name, m.tier,
      nullif(btrim(coalesce(m.email, '')), '')      as email,
      nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
      coalesce(p.channels,        array['whatsapp']::text[]) as channels,
      coalesce(p.muted_kinds,     '{}'::text[])              as muted_kinds,
      coalesce(p.cadence,         'weekly')                  as cadence,
      coalesce(p.max_per_30_days, d.cap)                     as cap,
      coalesce(p.quiet_from_hour, 21)                        as quiet_from,
      coalesce(p.quiet_to_hour,   8)                         as quiet_to,
      coalesce(p.quiet_days,      '{5,6}'::smallint[])          as quiet_days
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
             when r.tier in ('mid', 'premium') then
               case
                 when 'whatsapp' = any(r.channels)
                  and r.phone_e164 is null
                  and r.email is not null
                  and not ('email' = any(r.channels))
                 then r.channels || array['email']::text[]
                 else r.channels
               end
             else array_remove(r.channels, 'whatsapp')
                  || case
                       when r.email is not null
                        and 'whatsapp' = any(r.channels)
                        and not ('email' = any(r.channels))
                       then array['email']::text[]
                       else '{}'::text[]
                     end
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
  'הסוכנים שמותר לשלוח להם/ן הודעת תזכורת עכשיו. וואטסאפ רק ב-mid וב-premium. במסלול אחר, כולל מסלול ריק, וואטסאפ הופך למייל אם יש כתובת. בלי מספר, מסלול בתשלום נופל למייל בלי לוותר על וואטסאפ. קצב, תקרה, שעות שקט וגג כשלים כמו קודם.';

revoke all on function public.agent_reminder_due_agents() from public, anon, authenticated;
grant execute on function public.agent_reminder_due_agents() to service_role;

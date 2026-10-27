-- גבריאלה: תקציר התראות. הכל כבוי בברירת המחדל.
--
-- notif_digest_enabled = 0: אותה התנהגות כמו 20270825090000.
-- כשהדגל 1: התראות שאינן בעדיפות יוצאות רק בחלון (08:30, 13:00, 17:30
-- שעון ישראל, ברירת רדיוס 15 דקות) ועם תקרה יומית 4 במקום 12.
-- notif_stop_131049 = 0: לא נוגעים. כשהוא 1, מי שקיבל 131049 בחלון
-- ההמתנה לא מקבל תבנית שיווקית מחוץ לחלון 24 השעות. בתוך החלון הטקסט
-- יוצא כרגיל.
-- "פחות כאלה" נשמר ב-agent_notif_less ומפחית סוג שאינו ברשימת
-- notification_push_less_kept_types: הוא יוצא רק בחלון תקציר, ופעם
-- אחת בחלון, ל-30 יום. הרשימה מפורשת, בלי התאמת תת-מחרוזת:
-- new_lead, lead_unrouted, showcase_meeting, agenda_reminder
-- (זו ההודעה של משימת "לחזור לליד"; lead_followup אינו סוג התראה),
-- security_alert, budget_alert, ops_alert.
-- לא מוגנים: lead_prefs_default, onboarding_lead, open_demand.
-- כשהדגל 0, המרווח, התקרה, פער התבנית וחלון 12 השעות זהים
-- ל-20270825090000. הרחבה שלהם, וחלון 7 הימים לסוג רגיל, רק כשהדגל 1.
-- התראה מופחתת שנוצרה אחרי 17:30 לא נזרקת: notification_push_less_hold
-- שומר אותה עד 7 ימים, ורק כשהדגל דלוק. בלי שורות בטבלה אין שינוי.
-- התראות שלא נשלחו ובנות יותר מ-12 שעות (חוץ מעדיפות ומ-quiet_hold)
-- נרשמות skipped, כדי ששום דבר ישן לא ייצא כשהדגל יידלק אחר כך.

insert into public.pricing_config (key, value, description) values
  ('notif_digest_enabled', 0, '1: התראות שאינן בעדיפות יוצאות רק בחלונות התקציר, עם תקרה יומית נמוכה יותר.'),
  ('notif_digest_daily_cap', 4, 'תקרה יומית כש-notif_digest_enabled = 1. כשהדגל 0 נשארת notif_push_max_per_day.'),
  ('notif_digest_window_1', 510, 'דקות מחצות, שעון ישראל. 510 = 08:30.'),
  ('notif_digest_window_2', 780, 'דקות מחצות, שעון ישראל. 780 = 13:00.'),
  ('notif_digest_window_3', 1050, 'דקות מחצות, שעון ישראל. 1050 = 17:30.'),
  ('notif_digest_window_minutes', 15, 'כמה דקות סביב כל חלון תקציר ההתראה עדיין יוצאת.'),
  ('notif_stop_131049', 0, '1: לא שולחים תבנית שיווקית למי שקיבל 131049 לאחרונה, מחוץ לחלון 24 השעות.'),
  ('notif_131049_hold_hours', 72, 'כמה שעות אחרי 131049 לא שולחים תבנית, כש-notif_stop_131049 = 1.'),
  ('notif_topic_group', 0, '1: הודעת הוואטסאפ מקבצת לפי נושא. דורש גם notif_digest_enabled = 1.')
on conflict (key) do nothing;

create table if not exists public.agent_notif_less (
  agent_id    uuid not null references public.agency_members(id) on delete cascade,
  notif_type  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days'),
  primary key (agent_id, notif_type),
  constraint agent_notif_less_type_chk check (notif_type ~ '^[a-z][a-z0-9_]{0,39}$')
);

alter table public.agent_notif_less
  add column if not exists expires_at timestamptz;
update public.agent_notif_less
   set expires_at = created_at + interval '30 days'
 where expires_at is null;
alter table public.agent_notif_less
  alter column expires_at set default (now() + interval '30 days');
alter table public.agent_notif_less
  alter column expires_at set not null;

comment on table public.agent_notif_less is
  'סוג שהסוכן/ת ביקש/ה פחות ממנו. לא משתיק: סוג שאינו דחוף יוצא רק בחלון תקציר, פעם בחלון, עד expires_at. מחיקת השורה מחזירה את הקצב.';
comment on column public.agent_notif_less.expires_at is
  'אחרי המועד הזה השורה לא מפחיתה. ברירת המחדל 30 יום מהשמירה.';

alter table public.agent_notif_less enable row level security;

-- pg_default_acl ב-public נותן ל-authenticated את arwdDxtm. revoke מ-public
-- אינו מוריד הרשאה ישירה, ולכן קודם revoke all משלושת התפקידים.
revoke all on table public.agent_notif_less from public, anon, authenticated;
grant select, delete on table public.agent_notif_less to authenticated;
grant select, insert, update, delete on table public.agent_notif_less to service_role;

drop policy if exists "agent reads own less notifications" on public.agent_notif_less;
create policy "agent reads own less notifications"
  on public.agent_notif_less for select
  using (agent_id = public.current_agent_id());

drop policy if exists "agent deletes own less notifications" on public.agent_notif_less;
create policy "agent deletes own less notifications"
  on public.agent_notif_less for delete
  using (agent_id = public.current_agent_id());

create or replace function public.notif_il_digest_open(p_window_minutes integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with clock as (
    select
      extract(hour from (now() at time zone 'Asia/Jerusalem'))::int * 60
      + extract(minute from (now() at time zone 'Asia/Jerusalem'))::int as minute
  ),
  wins as (
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_1'), 510) as w
    union all
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_2'), 780)
    union all
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_3'), 1050)
  )
  select exists (
    select 1
      from clock, wins
     where abs(clock.minute - wins.w) <= greatest(0, least(coalesce(p_window_minutes, 15), 120))
  );
$$;

comment on function public.notif_il_digest_open(integer) is
  'האם עכשיו בתוך אחד מחלון תקציר ההתראות, שעון ישראל. נקראת רק מ-notification_push_due_agents.';

revoke all on function public.notif_il_digest_open(integer) from public, anon, authenticated;
grant execute on function public.notif_il_digest_open(integer) to service_role;

-- הרשימה הסגורה זהה ל-LESS_KEPT_TYPES. בלי התאמת תת-מחרוזת:
-- lead_prefs_default, onboarding_lead ו-open_demand אינם ליד שמחכה.
-- lead_followup אינו ב-notifications_type_check; ההודעה היא agenda_reminder.
create or replace function public.notification_push_less_kept_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'agenda_reminder',
    'showcase_meeting',
    'new_lead',
    'lead_unrouted',
    'security_alert',
    'budget_alert',
    'ops_alert'
  ]::text[];
$$;

comment on function public.notification_push_less_kept_types() is
  'סוגים ש"פחות כאלה" אינו מפחית ושחלון התקציר אינו דוחה. זהה ל-LESS_KEPT_TYPES. בלי lead_prefs_default, onboarding_lead, open_demand.';

revoke all on function public.notification_push_less_kept_types() from public, anon, authenticated;
grant execute on function public.notification_push_less_kept_types() to service_role;

create or replace function public.notification_push_less_kept(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type = any(public.notification_push_less_kept_types());
$$;

comment on function public.notification_push_less_kept(text) is
  'סוג שלא מופחת ולא נדחה לחלון התקציר. רק הרשימה המפורשת, בלי תת-מחרוזת.';

revoke all on function public.notification_push_less_kept(text) from public, anon, authenticated;
grant execute on function public.notification_push_less_kept(text) to service_role;

-- התראה מופחתת מחכה לחלון הבא עד 7 ימים. חלון המבט הרגיל הוא 12 שעות,
-- ושישי-שבת מוציאים רק דחוף, אז בלי זה העותק לוואטסאפ אובד.
create or replace function public.notification_push_less_hold(
  p_type    text,
  p_agent   uuid,
  p_created timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_created is not null
     and p_created > now() - interval '7 days'
     and not public.notification_push_less_kept(p_type)
     and exists (
       select 1
         from public.agent_notif_less less
        where less.agent_id = p_agent
          and less.notif_type = p_type
          and less.expires_at > now()
     );
$$;

comment on function public.notification_push_less_hold(text, uuid, timestamptz) is
  'התראה מופחתת שעוד לא נשלחה, עד 7 ימים, כדי שתצא בחלון התקציר הבא ולא תיעלם אחרי 12 שעות.';

revoke all on function public.notification_push_less_hold(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_push_less_hold(text, uuid, timestamptz) to service_role;

-- הגוף מ-20270825090000, עם שלושה תנאים שקטים כשהדגלים 0:
-- תקרת התקציר, חלון התקציר, ועצירת תבנית אחרי 131049.
create or replace function public.notification_push_due_agents()
returns table (agent_id uuid, display_name text, phone_e164 text,
               whatsapp_types text[], in_service_window boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg0 as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_gap_minutes'), 10)      as gap_min,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_per_day'), 12)      as cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_failures_24h'), 3)  as max_fail,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_template_gap_minutes'), 240) as tpl_gap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_enabled'), 0)         as digest_on,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_daily_cap'), 4)       as digest_cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_window_minutes'), 15) as digest_win,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_stop_131049'), 0)            as stop_131049,
           greatest(1, least(
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_131049_hold_hours'), 72),
             24 * 30))                                                as hold_hours,
           array['agenda_reminder']::text[]                            as urgent,
           public.notification_push_priority_types()                  as priority,
           public.notification_known_types()                          as known
  ),
  cfg as (
    select cfg0.*,
           public.notif_il_digest_open(cfg0.digest_win) as digest_open
      from cfg0
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           array(
             select t from unnest((select known from cfg)) t
              where t <> all (coalesce(np.whatsapp_off_types, '{}'::text[]))
           )                                             as whatsapp_types,
           array(
             select less.notif_type
               from public.agent_notif_less less
              where less.agent_id = m.id
                and less.expires_at > now()
                and not public.notification_push_less_kept(less.notif_type)
           )                                             as less_types,
           coalesce(rp.quiet_from_hour, 21)              as quiet_from,
           coalesce(rp.quiet_to_hour,   8)               as quiet_to,
           coalesce(rp.quiet_days, '{5,6}'::smallint[])     as quiet_days,
           coalesce(
             (select c.last_message_at > now() - interval '23 hours'
                from public.whatsapp_conversations c
               where c.agent_id = m.id),
             false)                                      as in_window
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
           max(l.created_at) filter (
             where l.channel_mode = 'template'
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
           ) as last_tpl_at,
           count(*) filter (
             where public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as n24,
           count(*) filter (
             where not public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as fails24,
           bool_or(
             position('131049' in coalesce(l.last_error, '')) > 0
             and l.created_at > now() - make_interval(hours => (select hold_hours from cfg))
           ) as hit_131049
      from public.notification_push_log l
     group by l.agent_id
  ),
  shaped as (
    select a.id, a.display_name, a.phone_e164, a.in_window,
           case
             when public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to, a.quiet_days)
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             when cfg.stop_131049 = 1
              and not a.in_window
              and coalesce(r.hit_131049, false)
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or public.notification_push_less_kept(t)
             )
             when cfg.digest_on = 1
              and not cfg.digest_open
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or public.notification_push_less_kept(t)
             )
             when (r.last_at is not null
                   and r.last_at >= now() - make_interval(mins => cfg.gap_min))
               or coalesce(r.n24, 0) >= case
                    when cfg.digest_on = 1 then least(cfg.digest_cap, cfg.cap)
                    else cfg.cap
                  end
               or (not a.in_window
                   and r.last_tpl_at is not null
                   and r.last_tpl_at >= now() - make_interval(mins => cfg.tpl_gap))
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or (cfg.digest_on = 1 and public.notification_push_less_kept(t))
             )
             else a.whatsapp_types
           end as raw_types,
           a.less_types,
           cfg.digest_open,
           cfg.digest_win,
           r.last_at,
           r.fails24, cfg.max_fail
      from agents a
      cross join cfg
      left join recent r on r.agent_id = a.id
  ),
  gated as (
    select s.id, s.display_name, s.phone_e164, s.in_window, s.fails24, s.max_fail,
           case
             when s.digest_open
              and (s.last_at is null
                   or s.last_at < now() - make_interval(mins => greatest(s.digest_win, 1) * 2))
             then s.raw_types
             else array(
               select t from unnest(s.raw_types) t
                where t <> all (coalesce(s.less_types, '{}'::text[]))
             )
           end as types
      from shaped s
  )
  select g.id, g.display_name, g.phone_e164, g.types, g.in_window
    from gated g
   where coalesce(array_length(g.types, 1), 0) > 0
     and g.phone_e164 is not null
     and coalesce(g.fails24, 0) < g.max_fail;
$$;

comment on function public.notification_push_due_agents() is
  'סוכנים שמותר לשלוח להם עכשיו התראות בוואטסאפ, ואילו סוגים. דגלי התקציר ו-131049 כבויים בברירת המחדל ומשאירים את 20270825090000. agent_notif_less מפחית סוג שאינו דחוף לחלון אחד, עד שפג תוקף השורה.';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- אותו claim כמו 20271027150050, עם meeting_id, ועם החזקה של התראה
-- מופחתת עד 7 ימים. סוג מוגן נשמר 72 שעות כמו עדיפות, כדי שתקרה יומית
-- לא תמחק ליד או התראת אבטחה אחרי 12 שעות.
create or replace function public.notification_push_claim(p_limit int default 20)
returns table (log_id uuid, agent_id uuid, display_name text, phone_e164 text,
               channel_mode text, items jsonb, item_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         record;
  v_items   jsonb;
  v_ids     uuid[];
  v_types   text[];
  v_log     uuid;
  v_mode    text;
  v_taken   int := 0;
  v_cap     int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_look    int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_lookback_hours'), 12);
  v_look_p  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_priority_lookback_hours'), 72);
  v_prio    text[] := public.notification_push_priority_types();
  v_digest_on int := coalesce((select value::int from public.pricing_config
                                where key = 'notif_digest_enabled'), 0);
  v_digest  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_ambient_digest_minutes'), 180);
  v_wake    boolean;
begin
  perform pg_advisory_xact_lock(hashtext('notification_push_claim'));
  perform public.notification_push_reconcile();

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    select jsonb_agg(jsonb_build_object(
             'type',        n.type,
             'title',       n.title,
             'body',        n.body,
             'property_id', n.related_property_id,
             'client_id',   coalesce(n.related_client_id,
                                     (select s.client_id from public.client_showcases s
                                       where s.id = n.related_showcase_id)),
             'lead_id',     n.related_lead_id,
             'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                 from public.properties p where p.id = n.related_property_id),
             'agenda_item_id', n.related_agenda_item_id,
             'agreement_id',  n.related_agreement_id,
             'meeting_id',    n.related_meeting_id,
             'review_id', (select rv.id from public.reviews rv
                            where rv.id = n.related_review_id and rv.status = 'pending'
                              and rv.agent_id is distinct from n.agent_id),
             'review_agent_slug', (select m.slug from public.reviews rv
                                     join public.agency_members m on m.id = rv.agent_id
                                    where rv.id = n.related_review_id and rv.status = 'published')
           ) order by n.created_at desc),
           array_agg(n.id order by n.created_at desc),
           array_agg(distinct n.type),
           bool_or(not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
                   or n.created_at <= now() - make_interval(mins => v_digest))
      into v_items, v_ids, v_types, v_wake
      from public.notifications n
     where n.agent_id = a.agent_id
       and not n.read
       and n.type = any(a.whatsapp_types)
       and (n.created_at > now() - make_interval(hours =>
              case
                when n.type = any(v_prio) then v_look_p
                when v_digest_on = 1 and public.notification_push_less_kept(n.type) then v_look_p
                when v_digest_on = 1 then 24 * 7
                else v_look
              end)
            or public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at)
            or (v_digest_on = 1 and public.notification_push_less_hold(n.type, n.agent_id, n.created_at)))
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
       and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at);

    continue when v_items is null or not v_wake;

    v_mode := case when a.in_service_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.notification_push_claim(int) is
  'כמו 20271027150050 כש-notif_digest_enabled = 0: עדיפות 72 שעות, כל השאר 12, ו-quiet_hold. כשהדגל 1 סוג רגיל נשמר 7 ימים לחלון הבא, ו-less_hold חל.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

-- skipped חוסם שליחה חוזרת כמו sent, בלי להיספר כהודעה שיצאה.
-- שורת היומן נרשמת 25 שעות אחורה, כדי שלא תזיז את המרווח ואת התקרה.
alter table public.notification_push_log drop constraint if exists notification_push_log_status_chk;
alter table public.notification_push_log add constraint notification_push_log_status_chk
  check (whatsapp_status in ('pending','sent','failed','skipped'));

create or replace function public.notification_push_log_holds(
  p_status  text,
  p_created timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('sent', 'skipped')
      or (p_status = 'pending'
          and p_created > now() - make_interval(mins => coalesce(
                (select value::int from public.pricing_config
                  where key = 'notif_push_pending_grace_minutes'), 30)));
$$;

comment on function public.notification_push_log_holds(text, timestamptz) is
  'האם שורת יומן דחיפה חוסמת הודעה נוספת על אותן התראות. sent ו-skipped חוסמים תמיד. pending חוסם רק בחלון החסד.';

revoke all on function public.notification_push_log_holds(text, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_push_log_holds(text, timestamptz) to service_role;

-- התראות שלא נשלחו ובנות יותר מ-12 שעות, חוץ מעדיפות ומ-quiet_hold
-- (אלה עדיין יוצאות היום). כך הדלקה מאוחרת של התקציר לא שופכת אותן.
insert into public.notification_push_log
  (agent_id, notification_ids, types, channel_mode, whatsapp_status, last_error, created_at)
select n.agent_id,
       array_agg(n.id),
       array_agg(distinct n.type),
       'text',
       'skipped',
       'older than 12h at digest migration; not pushed',
       now() - interval '25 hours'
  from public.notifications n
 where not n.read
   and n.created_at <= now() - interval '12 hours'
   and not (n.type = any(public.notification_push_priority_types()))
   and not public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at)
   and not exists (
     select 1 from public.notification_push_log l
      where l.agent_id = n.agent_id
        and n.id = any(l.notification_ids)
        and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
   )
 group by n.agent_id;

-- מחיקת שורת "פחות כאלה". דגל כבוי: מה שכבר מעל 12 שעות מסומן skipped
-- ולא נשאר בלימבו. דגל דלוק: מה שבתוך 7 ימים יוצא בחלון הבא, ומה
-- שמעבר לזה מסומן skipped. p_type null משחרר את כל הסוגים של הסוכן/ת.
create or replace function public.notification_push_less_release(
  p_agent uuid,
  p_type  text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on    int := coalesce((select value::int from public.pricing_config
                            where key = 'notif_digest_enabled'), 0);
  v_types text[];
  v_cut   interval;
begin
  if p_agent is null then
    return false;
  end if;
  if public.current_agent_id() is not null
     and p_agent is distinct from public.current_agent_id() then
    return false;
  end if;

  select coalesce(array_agg(less.notif_type), '{}'::text[])
    into v_types
    from public.agent_notif_less less
   where less.agent_id = p_agent
     and (p_type is null or less.notif_type = p_type);
  if coalesce(array_length(v_types, 1), 0) = 0 then
    return false;
  end if;

  v_cut := case when v_on = 1 then interval '7 days' else interval '12 hours' end;
  insert into public.notification_push_log
    (agent_id, notification_ids, types, channel_mode, whatsapp_status, last_error, created_at)
  select n.agent_id,
         array_agg(n.id),
         array_agg(distinct n.type),
         'text',
         'skipped',
         'released from less-of-these after the send window',
         now() - interval '25 hours'
    from public.notifications n
   where n.agent_id = p_agent
     and not n.read
     and n.type = any(v_types)
     and n.created_at <= now() - v_cut
     and not (n.type = any(public.notification_push_priority_types()))
     and not public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at)
     and not exists (
       select 1 from public.notification_push_log l
        where l.agent_id = n.agent_id
          and n.id = any(l.notification_ids)
          and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
     )
   group by n.agent_id;

  delete from public.agent_notif_less less
   where less.agent_id = p_agent
     and less.notif_type = any(v_types);
  return true;
end;
$$;

comment on function public.notification_push_less_release(uuid, text) is
  'מוחק שורת הפחתה. דגל כבוי מסמן skipped את מה שכבר מעל 12 שעות. דגל דלוק משאיר עד 7 ימים לחלון הבא ומסמן skipped רק את מה שכבר מעבר. אין grant ל-anon. authenticated רק כש-p_agent הוא current_agent_id(), כי service_role קורא בלי JWT.';

revoke all on function public.notification_push_less_release(uuid, text) from public, anon, authenticated;
grant execute on function public.notification_push_less_release(uuid, text) to authenticated, service_role;

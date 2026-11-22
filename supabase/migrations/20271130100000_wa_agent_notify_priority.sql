-- ---------------------------------------------------------------------------
-- וואטסאפ לסוכנים: סדר משבצות, עצירת 131049, והדלקת התקציר.
--
-- 1. משבצת התבנית מוגבלת (1 ביום, שניה אחרי 8 שעות, גג 2). השורה הגבוהה
--    יוצאת קודם. שורה נמוכה לא נכנסת לאותה תבנית כשיש שורה גבוהה ממתינה:
--    new_lead / showcase_meeting / agenda_reminder / ops_alert, ואז
--    open_demand, ואז match_digest ושאר הסיכומים. מה שנדחה נשאר בפעמון
--    ויוצא בתקציר. השקט, שישי מ-13:00 והשבת, ותקרות 1/8/2 לא משתנים.
--    הפיצול עצמו ב-notification-push (template-priority.ts), כי שם נבנית
--    ההודעה. כאן רק השערים שהמסד כבר מחזיק.
--
-- 2. 131049 של Meta נשמר ב-delivery_detail כשהסטטוס sent, לא ב-last_error.
--    notification_log_hit_131049 קורא את שניהם. notif_stop_131049 = 1.
--    ההחזקה היא notif_131049_hold_hours (72). מחוץ לחלון 24 השעות אין
--    תבנית בכלל, גם לא לליד. ההתראה נשארת בפעמון. הודעה נכנסת לגבריאלה
--    פותחת את החלון, והמותר יוצא כטקסט שיחה.
--
-- 3. notif_digest_enabled = 1. סוגי שורה 1 לא מחכים לחלון. ביקוש פתוח
--    שלא נכנס למשבצת, match_digest וסיכומים יוצאים בחלון 08:30 / 13:00 /
--    17:30. רק מה שנוצר אחרי notif_digest_enabled_at, ולא ישן מ-24 שעות.
--    ישן מזה נשאר בפעמון. תקציר אחד לסוכן/ת בחלון. הדגל מדליק גם את
--    whatsapp_template_cap_on, כי דגל התקרה כבר true.
--
-- אין מחיקה. כיבוי: מיגרציה שמחזירה את שני הדגלים ל-0.
-- ---------------------------------------------------------------------------

create or replace function public.notification_log_hit_131049(
  p_error text,
  p_detail text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select position('131049' in coalesce(p_error, '')) > 0
      or position('131049' in coalesce(p_detail, '')) > 0;
$$;

comment on function public.notification_log_hit_131049(text, text) is
  'האם שורת יומן נחסמה ב-131049. הקוד יושב ב-last_error או ב-delivery_detail (סטטוס sent).';

revoke all on function public.notification_log_hit_131049(text, text) from public, anon, authenticated;
grant execute on function public.notification_log_hit_131049(text, text) to service_role;

insert into public.pricing_config (key, value, description) values
  ('notif_digest_enabled', 1, '1: התראות שאינן בעדיפות יוצאות רק בחלונות התקציר.'),
  ('notif_stop_131049', 1, '1: אין תבנית למי שקיבל 131049 בחלון ההחזקה, מחוץ לחלון 24 השעות.')
on conflict (key) do update
  set value = excluded.value
  where public.pricing_config.value is distinct from excluded.value;

-- חותמת ההדלקה. ריצה חוזרת לא מזיזה אותה, כדי שלא לאסוף את מה שכבר נוצר.
insert into public.app_config (key, value, description) values
  ('notif_digest_enabled_at',
   to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'תקציר הוואטסאפ אוסף רק התראות שנוצרו אחרי החותמת, ולא ישנות מ-24 שעות.')
on conflict (key) do nothing;

create or replace function public.notification_wa_digest_type(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in (
    'open_demand',
    'match_digest', 'client_match', 'listing_match',
    'share_digest', 'system', 'platform_signup',
    'leads_digest', 'digest', 'burst_digest', 'deal_sync_summary'
  );
$$;

comment on function public.notification_wa_digest_type(text) is
  'סוג שנכנס לתקציר הוואטסאפ. שורה 1 (ליד, סיור, תזכורת, ops_alert) אינה כאן.';

revoke all on function public.notification_wa_digest_type(text) from public, anon, authenticated;
grant execute on function public.notification_wa_digest_type(text) to service_role;

create or replace function public.notification_wa_digest_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'open_demand',
    'match_digest', 'client_match', 'listing_match',
    'share_digest', 'system', 'platform_signup',
    'leads_digest', 'digest', 'burst_digest', 'deal_sync_summary'
  ]::text[];
$$;

revoke all on function public.notification_wa_digest_types() from public, anon, authenticated;
grant execute on function public.notification_wa_digest_types() to service_role;

-- המאוחר מבין חותמת ההדלקה ו-24 שעות אחורה. חותמת חסרה או שבורה: עכשיו,
-- כדי שלא לאסוף היסטוריה.
create or replace function public.notification_digest_since()
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
  v_at timestamptz;
  v_day timestamptz := pg_catalog.now() - interval '24 hours';
begin
  select c.value into v
    from public.app_config c
   where c.key = 'notif_digest_enabled_at';
  if v is null or btrim(v) = '' then
    return pg_catalog.now();
  end if;
  begin
    v_at := v::timestamptz;
  exception when others then
    return pg_catalog.now();
  end;
  if v_at > v_day then
    return v_at;
  end if;
  return v_day;
end;
$$;

comment on function public.notification_digest_since() is
  'מתאריך זה נאסף תקציר: אחרי ההדלקה, ולא לפני 24 שעות.';

revoke all on function public.notification_digest_since() from public, anon, authenticated;
grant execute on function public.notification_digest_since() to service_role;

-- שורה 1 תמיד. תקציר רק מ-notification_digest_since. שאר הסוגים לא נחתכים.
create or replace function public.notification_digest_collectable(
  p_type text,
  p_created timestamptz
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_type in ('new_lead', 'showcase_meeting', 'agenda_reminder', 'ops_alert') then true
    when public.notification_wa_digest_type(p_type)
      then coalesce(p_created >= public.notification_digest_since(), false)
    else true
  end;
$$;

comment on function public.notification_digest_collectable(text, timestamptz) is
  'האם מותר לאסוף את ההתראה לוואטסאפ. שורה 1 תמיד. תקציר רק אחרי ההדלקה ובתוך 24 שעות.';

revoke all on function public.notification_digest_collectable(text, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_digest_collectable(text, timestamptz) to service_role;

create or replace function public.notification_digest_sent_this_window(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.whatsapp_template_cap_digest_open_at(pg_catalog.now())
     and exists (
       select 1
         from public.notification_push_log l
        where l.agent_id = p_agent
          and l.whatsapp_status in ('sent', 'pending')
          and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
          and l.created_at > pg_catalog.now() - make_interval(mins =>
                greatest(0, least(coalesce(
                  (select value::int from public.pricing_config
                    where key = 'notif_digest_window_minutes'), 15), 120)) * 2 + 5)
          and public.whatsapp_template_cap_digest_open_at(l.created_at)
          and l.types && public.notification_wa_digest_types()
     );
$$;

comment on function public.notification_digest_sent_this_window(uuid) is
  'כבר יצא תקציר לסוכן/ת בחלון הפתוח. לא יוצא עוד אחד עד החלון הבא.';

revoke all on function public.notification_digest_sent_this_window(uuid) from public, anon, authenticated;
grant execute on function public.notification_digest_sent_this_window(uuid) to service_role;

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
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_send_window_friday_enabled'), 0) as window_on,
           greatest(1, least(
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_131049_hold_hours'), 72),
             24 * 30))                                                as hold_hours,
           array['agenda_reminder']::text[]                            as urgent,
           public.notification_push_priority_types()                  as priority,
           public.whatsapp_template_cap_on()                          as cap_on,
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
           max(l.created_at) filter (
             where not c.cap_on
                or l.whatsapp_status not in ('skipped', 'skipped_template_cap')
           ) as last_at,
           max(l.created_at) filter (
             where l.channel_mode = 'template'
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and (
                 not c.cap_on
                 or l.whatsapp_status in ('sent', 'pending')
               )
           ) as last_tpl_at,
           count(*) filter (
             where public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
               and (
                 not c.cap_on
                 or l.whatsapp_status in ('sent', 'pending')
               )
           ) as n24,
           count(*) filter (
             where l.whatsapp_status = 'failed'
               and l.created_at > now() - interval '24 hours'
           ) as fails24,
           bool_or(
             public.notification_log_hit_131049(l.last_error, l.delivery_detail)
             and l.created_at > now() - make_interval(hours => (select hold_hours from cfg))
           ) as hit_131049
      from public.notification_push_log l
     cross join cfg c
     -- 20271109130000: רק השורות שמישהו למטה קורא. החלון רחב מכל השוואה
     -- (מרווח, תקציר, מרווח תבנית, 24 שעות, 131049), ולכן התוצאה זהה.
     where l.created_at > pg_catalog.now() - greatest(
             make_interval(hours => greatest(c.hold_hours, 24)),
             make_interval(mins => greatest(c.tpl_gap, c.gap_min,
                                            greatest(c.digest_win, 1) * 2)))
     group by l.agent_id
  ),
  shaped as (
    select a.id, a.display_name, a.phone_e164, a.in_window,
           case
             when public.notification_agent_send_quiet(
                    a.quiet_from, a.quiet_to, a.quiet_days, now(), cfg.window_on)
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             when coalesce((select value::int from public.pricing_config
                             where key = 'agent_holiday_window_enabled'), 0) = 1
              and public.agent_backlog_waiting(a.id, pg_catalog.now())
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
             )
             when cfg.stop_131049 = 1
              and not a.in_window
              and coalesce(r.hit_131049, false)
             -- 20271130100000: אין תבנית למי שמטא חסמה. ההתראות נשארות בפעמון.
             -- בתוך חלון 24 השעות הענף הזה לא חל, והשליחה היא טקסט שיחה.
             then '{}'::text[]
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
  select s.id, s.display_name, s.phone_e164, s.types, s.in_window
    from (
      select g.id, g.display_name, g.phone_e164, g.in_window, g.fails24, g.max_fail,
             case
               when public.notification_digest_sent_this_window(g.id)
               then array(
                 select t from unnest(g.types) t
                  where not public.notification_wa_digest_type(t)
               )
               else g.types
             end as types
        from gated g
    ) s
   where coalesce(array_length(s.types, 1), 0) > 0
     and s.phone_e164 is not null
     and coalesce(s.fails24, 0) < s.max_fail;
$$;

comment on function public.notification_push_due_agents() is
  'גוף 20271109130000. 20271130100000: 131049 נקרא גם מ-delivery_detail. מחוץ לחלון 24 השעות אין תבנית למי שנחסם. השקט, השבת והתקרות לא השתנו.';


revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- איסוף התקציר: רק אחרי ההדלקה ובתוך 24 שעות. שורה 1 לא נחתכת.
-- ---------------------------------------------------------------------------

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
  v_stale   int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_stale_hours'), 12));
  v_urgent  int := greatest(v_stale, coalesce((select value::int from public.pricing_config where key = 'notif_burst_urgent_hours'), 72));
  v_max_items int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_max_items'), 24));
  v_hour_cap int;
  v_day_cap int;
  v_sent_hour int;
  v_sent_day int;
  v_all_lead boolean;
  v_all_showing boolean;
  v_over boolean;
  v_digest_sent boolean;
  v_guard int;
  v_manual int;
  v_breaker int;
  v_pending_max int;
  v_pause boolean;
  v_ex_items jsonb;
  v_ex_ids uuid[];
  v_ex_types text[];
  v_gen_ids uuid[];
  v_gen_types text[];
  v_gen_n int;
  v_agent_hot boolean;
  v_too_many boolean;
  v_hold_general boolean;
  v_lane_over boolean;
  v_cap_ok boolean;
  v_cap_held boolean;
  v_digest_kind text;
begin
  perform public.notification_push_burst_prepare();

  select coalesce((select value::int from public.pricing_config where key = 'notification_burst_guard_enabled'), 0),
         coalesce((select value::int from public.pricing_config where key = 'notif_burst_manual_pause'), 0),
         coalesce((select value::int from public.pricing_config where key = 'notif_burst_breaker'), 0),
         greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_agent_pending'), 30))
    into v_guard, v_manual, v_breaker, v_pending_max;
  v_pause := v_guard = 1 and (v_manual = 1 or v_breaker = 1);

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    select jsonb_agg(s.item order by s.created_at desc),
           array_agg(s.id order by s.created_at desc),
           array_agg(distinct s.type),
           bool_or(s.wake_part),
           jsonb_agg(s.item order by s.created_at desc) filter (where s.exempt),
           array_agg(s.id order by s.created_at desc) filter (where s.exempt),
           array_agg(distinct s.type) filter (where s.exempt),
           array_agg(s.id order by s.created_at desc) filter (where not s.exempt),
           array_agg(distinct s.type) filter (where not s.exempt),
           (count(*) filter (where not s.exempt))::int
      into v_items, v_ids, v_types, v_wake,
           v_ex_items, v_ex_ids, v_ex_types,
           v_gen_ids, v_gen_types, v_gen_n
      from (
        select n.id, n.type, n.created_at,
               public.notification_push_burst_exempt(n.type, ld.source) as exempt,
               (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
                 or n.created_at <= now() - make_interval(mins => v_digest)) as wake_part,
               jsonb_build_object(
                 'id',          n.id,
                 'type',        n.type,
                 'title',       n.title,
                 'body',        n.body,
                 'source',      ld.source,
                 'property_id', n.related_property_id,
                 'client_id',   coalesce(n.related_client_id,
                                         (select sc.client_id from public.client_showcases sc
                                           where sc.id = n.related_showcase_id)),
                 'lead_id',     n.related_lead_id,
                 'action_path', n.action_path,
                 'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                     from public.properties p where p.id = n.related_property_id),
                 'agenda_item_id', n.related_agenda_item_id,
                 'agreement_id',  n.related_agreement_id,
                 'meeting_id',    n.related_meeting_id,
                 'showcase_id',   n.related_showcase_id,
                 'review_id', (select rv.id from public.reviews rv
                                where rv.id = n.related_review_id and rv.status = 'pending'
                                  and rv.agent_id is distinct from n.agent_id),
                 'review_agent_slug', (select m.slug from public.reviews rv
                                         join public.agency_members m on m.id = rv.agent_id
                                        where rv.id = n.related_review_id and rv.status = 'published')
               ) as item
          from public.notifications n
          left join public.leads ld on ld.id = n.related_lead_id
         where n.agent_id = a.agent_id
           and not n.read
           and not n.suppress_push
           and n.type = any(a.whatsapp_types)
           and public.notification_digest_collectable(n.type, n.created_at)
           and public.notification_push_lead_wa_sendable(n.agent_id, n.type, n.created_at)
           and not (
             public.notif_cadence_button_on()
             and not public.whatsapp_template_cap_on()
             and exists (
               select 1 from public.notification_push_log lcap
                where lcap.agent_id = n.agent_id
                  and n.id = any(lcap.notification_ids)
                  and lcap.whatsapp_status = 'skipped_template_cap'
                  and public.whatsapp_template_local_day(lcap.created_at)
                      = public.whatsapp_template_local_day(pg_catalog.now())
             )
             and not public.lead_wa_digest_cap_allows(n.agent_id, null)
           )
           and (n.created_at > now() - make_interval(hours =>
                  case
                    when n.type = any(v_prio) then least(v_look_p, v_urgent)
                    when v_digest_on = 1 and public.notification_push_less_kept(n.type) then least(v_look_p, v_urgent)
                    else least(v_look, v_stale)
                  end)
                or (v_digest_on = 0 and public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at))
                or (
                  public.whatsapp_template_cap_on()
                  and v_digest_on = 1
                  and n.created_at > pg_catalog.now() - interval '72 hours'
                  and exists (
                    select 1 from public.notification_push_log lheld
                     where lheld.agent_id = n.agent_id
                       and n.id = any(lheld.notification_ids)
                       and lheld.whatsapp_status = 'skipped_template_cap'
                       and lheld.created_at > pg_catalog.now() - interval '72 hours'
                  )
                ))
           and not exists (
             select 1 from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any(l.notification_ids)
                and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
           and (
             not public.whatsapp_template_cap_on()
             or not exists (
               select 1 from public.notification_push_log lcap
                where lcap.agent_id = n.agent_id
                  and n.id = any(lcap.notification_ids)
                  and lcap.whatsapp_status = 'skipped_template_cap'
             )
             or (
               v_digest_on = 1
               and public.notif_il_digest_open(coalesce(
                     (select value::int from public.pricing_config
                       where key = 'notif_digest_window_minutes'), 15))
               and (
                 a.in_service_window
                 or public.whatsapp_template_cap_digest_kind(
                      pg_catalog.now(),
                      (select u.last_at from public.whatsapp_template_cap_usage(a.agent_id, null) u),
                      coalesce((select u.n from public.whatsapp_template_cap_usage(a.agent_id, null) u), 0),
                      public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null)
                    ) in ('normal', 'reserved')
               )
             )
           )
           and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
      ) s;

    continue when v_items is null or not v_wake;

    -- פריט שנעצר בתקרה יוצא רק בחלון תקציר (08:30, 13:00, 17:30).
    -- תבנית רק אם decide מרשה (גג 2, מרווח 8 שעות, הפטור יוצא תמיד ונחשב).
    -- תקרה מלאה ובחלון 24 השעות: טקסט חופשי. בלי חלון: נשאר בפעמון
    -- עד התקציר הראשון של היום הבא. לא פרץ וואטסאפ ולא תבנית שלישית.
    v_cap_held := public.whatsapp_template_cap_on()
      and v_digest_on = 1
      and coalesce(array_length(v_ids, 1), 0) > 0
      and not exists (
        select 1 from unnest(v_ids) as held(id)
         where not exists (
           select 1 from public.notification_push_log lheld
            where lheld.agent_id = a.agent_id
              and held.id = any(lheld.notification_ids)
              and lheld.whatsapp_status = 'skipped_template_cap'
              and lheld.created_at > pg_catalog.now() - interval '72 hours'
         )
      );

    -- המפסק והמפסק הידני נבדקים תמיד. פריט תקרה מדלג רק על תקרת השעה, היום ומספר הפריטים.
    if v_guard = 1 then
      if v_pause then
        if coalesce(array_length(v_ex_ids, 1), 0) = 0 then
          continue;
        end if;
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif not v_cap_held then
      v_hour_cap := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_hour_cap'), 12));
      v_day_cap := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_day_cap'), 30));

      select count(*) filter (where l.created_at > now() - interval '1 hour'),
             count(*) filter (where l.created_at > now() - interval '1 day')
        into v_sent_hour, v_sent_day
        from public.notification_push_log l
       where l.agent_id = a.agent_id
         and l.whatsapp_status = 'sent';

      v_over := v_sent_hour >= v_hour_cap or v_sent_day >= v_day_cap;
      v_digest_sent := exists (
        select 1 from public.notification_push_log l
         where l.agent_id = a.agent_id
           and l.created_at > now() - interval '1 hour'
           and l.whatsapp_status in ('sent', 'pending')
           and 'burst_digest' = any(l.types));
      v_agent_hot := coalesce(v_gen_n, 0) > v_pending_max;
      v_too_many := coalesce(v_gen_n, 0) > v_max_items;
      v_hold_general := v_agent_hot or v_over or v_too_many;

      v_all_lead := coalesce(array_length(v_ex_ids, 1), 0) > 0
        and coalesce(v_gen_n, 0) = 0
        and not exists (select 1 from unnest(v_ex_types) t where t is distinct from 'new_lead');
      v_all_showing := coalesce(array_length(v_ex_ids, 1), 0) > 0
        and coalesce(v_gen_n, 0) = 0
        and not exists (select 1 from unnest(v_ex_types) t where t is distinct from 'showcase_meeting');
      v_lane_over := false;
      if v_all_lead then
        v_lane_over := v_sent_hour >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_hour_cap'), 20))
          or v_sent_day >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_day_cap'), 40));
      elsif v_all_showing then
        v_lane_over := v_sent_hour >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_showing_hour_cap'), 20))
          or v_sent_day >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_showing_day_cap'), 40));
      end if;

      if v_lane_over then
        -- תקרת המסלול של ליד או סיור: נדחה, לא תקציר ולא skipped.
        continue;
      elsif v_hold_general and coalesce(array_length(v_ex_ids, 1), 0) > 0 then
        -- ערבוב: המוגן יוצא עכשיו בפרטים. השאר מחכה לתקציר, בלי להירשם.
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif v_hold_general and v_digest_sent then
        -- overflow_defer: מחכה לתקציר הבא. לא skipped.
        continue;
      elsif v_hold_general then
        v_items := jsonb_build_array(jsonb_build_object(
          'type', 'burst_digest',
          'title', 'יש לך ' || coalesce(v_gen_n, 0) || ' התראות חדשות באתר',
          'body', null,
          'count', coalesce(v_gen_n, 0)));
        v_ids := v_gen_ids;
        v_types := coalesce(v_gen_types, '{}') || array['burst_digest'];
      end if;
      end if;
    end if;

    v_digest_kind := 'wait';
    if v_cap_held and public.whatsapp_template_cap_on() then
      select public.whatsapp_template_cap_digest_kind(
               pg_catalog.now(), u.last_at, u.n,
               public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null))
        into v_digest_kind
        from public.whatsapp_template_cap_usage(a.agent_id, null) u;
      v_mode := public.whatsapp_template_cap_digest_channel(a.in_service_window, v_digest_kind);
      if v_mode = 'none' then
        continue;
      end if;
      if v_digest_kind = 'reserved' and v_mode = 'template' then
        v_types := coalesce(v_types, '{}'::text[]) || array['template_cap_digest_reserved']::text[];
      end if;
    else
      v_mode := case when a.in_service_window then 'text' else 'template' end;
    end if;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    -- תקרת התבניות, פעם אחת לסוכן/ת בסבב. כבויה: כל שורה עוברת.
    v_cap_ok := true;
    if v_mode = 'template' then
      begin
        v_cap_ok := public.whatsapp_template_cap_allow(v_log);
      exception when others then
        v_cap_ok := true;
        raise warning 'whatsapp template cap: %', sqlerrm;
      end;
    end if;
    if not v_cap_ok then
      continue;
    end if;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;


comment on function public.notification_push_claim(int) is
  'גוף 20271031300000. 20271130100000: תקציר נאסף רק מ-notification_digest_collectable. שורה 1 תמיד.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

create or replace function public.notification_push_has_backlog(p_exempt_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select pg_catalog.now() - make_interval(hours => greatest(
             72,
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_push_priority_lookback_hours'), 72),
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_push_lookback_hours'), 12))) as since
  )
  select exists (
    select 1
      from public.notification_push_due_agents() a
     where exists (
       select 1
         from public.notifications n
         left join public.leads ld on ld.id = n.related_lead_id
        where n.agent_id = a.agent_id
          and not n.read
          and not n.suppress_push
          -- 20271109130000: חלון גס וזול לפני כל קריאה לפונקציה, על האינדקס
          -- notifications_push_window_idx. ‏greatest אינו קטן מ-coalesce של
          -- הענף הראשון ולא מ-created_at של השני, ולכן אינו משנה את התוצאה.
          and greatest(n.created_at, n.push_deferred_at) > (select g.since from g)
          and n.type = any(a.whatsapp_types)
          and public.notification_digest_collectable(n.type, n.created_at)
          and not (
            public.notif_cadence_button_on()
            and not public.whatsapp_template_cap_on()
            and exists (
              select 1 from public.notification_push_log lcad
               where lcad.agent_id = n.agent_id
                 and n.id = any(lcad.notification_ids)
                 and lcad.whatsapp_status = 'skipped_template_cap'
                 and public.whatsapp_template_local_day(lcad.created_at)
                     = public.whatsapp_template_local_day(pg_catalog.now())
            )
            and not public.lead_wa_digest_cap_allows(n.agent_id, null)
          )
          and (not coalesce(p_exempt_only, false)
               or public.notification_push_burst_exempt(n.type, ld.source))
          and (
            (
              coalesce(n.push_deferred_at, n.created_at) > now() - make_interval(hours =>
                  case when n.type = any(public.notification_push_priority_types())
                       then coalesce((select value::int from public.pricing_config
                                       where key = 'notif_push_priority_lookback_hours'), 72)
                       else coalesce((select value::int from public.pricing_config
                                       where key = 'notif_push_lookback_hours'), 12)
                  end)
              and not (
                public.whatsapp_template_cap_on()
                and exists (
                  select 1 from public.notification_push_log lheld
                   where lheld.agent_id = n.agent_id
                     and n.id = any(lheld.notification_ids)
                     and lheld.whatsapp_status = 'skipped_template_cap'
                     and lheld.created_at > pg_catalog.now() - interval '72 hours'
                )
              )
            )
            or (
              public.whatsapp_template_cap_on()
              and public.notif_il_digest_open(coalesce(
                    (select value::int from public.pricing_config
                      where key = 'notif_digest_window_minutes'), 15))
              and n.created_at > pg_catalog.now() - interval '72 hours'
              and exists (
                select 1 from public.notification_push_log lheld
                 where lheld.agent_id = n.agent_id
                   and n.id = any(lheld.notification_ids)
                   and lheld.whatsapp_status = 'skipped_template_cap'
                   and lheld.created_at > pg_catalog.now() - interval '72 hours'
              )
              and (
                a.in_service_window
                or public.whatsapp_template_cap_digest_kind(
                     pg_catalog.now(),
                     (select u.last_at from public.whatsapp_template_cap_usage(a.agent_id, null) u),
                     coalesce((select u.n from public.whatsapp_template_cap_usage(a.agent_id, null) u), 0),
                     public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null)
                   ) in ('normal', 'reserved')
              )
            )
          )
          and not exists (
            select 1 from public.notification_push_log l
             where l.agent_id = n.agent_id
               and n.id = any(l.notification_ids)
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
          and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
          and (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
               or n.created_at <= now() - make_interval(mins =>
                    coalesce((select value::int from public.pricing_config
                               where key = 'notif_push_ambient_digest_minutes'), 180)))
     )
  );
$$;


comment on function public.notification_push_has_backlog(boolean) is
  'גוף 20271109130000. 20271130100000: אותו חיתוך איסוף כמו ב-claim, כדי שהקרון לא יתעורר על תקציר ישן.';

revoke all on function public.notification_push_has_backlog(boolean) from public, anon, authenticated;
grant execute on function public.notification_push_has_backlog(boolean) to service_role;

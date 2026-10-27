-- מדידת לחיצה על כפתור וואטסאפ עד שהיעד נראה ב-CRM.
-- wc הוא מזהה אטום (לא טלפון ולא מזהה סוכן). השורה נכתבת רק דרך dl_add.
-- אנונימי ומי שמחובר כותבים את השורה שלהם; אין קריאה מלבד service_role
-- ומנהל/ת פלטפורמה (deeplink_timing_report). 90 יום, המדיניות דולקת כי
-- אין כאן פרט אישי.

insert into public.pricing_config (key, value, description) values
  ('deeplink_timing_enabled', 1, 'מדידת זמן לחיצה על כפתור עד היעד. 0 עוצר כתיבה בלי דיפלוי.')
on conflict (key) do nothing;

create table if not exists public.deeplink_timings (
  wc          text primary key,
  msg_type    text,
  target      text,
  agent_id    uuid,
  ttfb_ms     integer,
  fcp_ms      integer,
  auth_ms     integer,
  route_ms    integer,
  visible_ms  integer,
  outcome     text not null,
  ua_class    text not null,
  created_at  timestamptz not null default now(),
  constraint deeplink_timings_wc_chk
    check (wc ~ '^[a-f][a-f0-9]{11}$'),
  constraint deeplink_timings_outcome_chk
    check (outcome in ('reached', 'login_wall', 'error', 'abandoned')),
  constraint deeplink_timings_ua_chk
    check (ua_class in ('whatsapp_inapp', 'chrome', 'ios', 'other'))
);

comment on table public.deeplink_timings is
  'לחיצה אחת על כפתור לסוכן/ת: זמנים מהניווט עד שהיעד נראה. בלי שם, טלפון או מזהה גולש.';

create index if not exists deeplink_timings_agent_created_idx
  on public.deeplink_timings (agent_id, created_at desc);
create index if not exists deeplink_timings_anon_created_idx
  on public.deeplink_timings (created_at desc) where agent_id is null;

-- קריאות ל-dl_add, לא שורות. ספירת השורות אינה רואה עדכון של wc קיים,
-- ולכן תקרת 120 הדקה נעקפת בלולאה על אותו מזהה. נמחקת מתוך הפונקציה
-- אחרי שעה, והשמירה של 90 יום מוחקת את מה שנשאר.
create table if not exists public.deeplink_timing_calls (
  id         bigint generated always as identity primary key,
  called_at  timestamptz not null default now(),
  agent_id   uuid
);

comment on table public.deeplink_timing_calls is
  'קריאה ל-dl_add בשעה האחרונה. סופרת גם עדכון, כדי שהתקרה לא תיעקף.';

create index if not exists deeplink_timing_calls_agent_idx
  on public.deeplink_timing_calls (agent_id, called_at desc);
create index if not exists deeplink_timing_calls_anon_idx
  on public.deeplink_timing_calls (called_at desc) where agent_id is null;

alter table public.deeplink_timing_calls enable row level security;
revoke all on table public.deeplink_timing_calls from public, anon, authenticated;
grant select, insert, update, delete on table public.deeplink_timing_calls to service_role;

alter table public.deeplink_timings enable row level security;
revoke all on table public.deeplink_timings from public, anon, authenticated;
grant select, insert, update, delete on table public.deeplink_timings to service_role;

-- אין policy ל-anon ול-authenticated: גם אם יוענק grant אחר כך, RLS שולל קריאה.

alter table public.notification_push_log
  add column if not exists click_tokens jsonb not null default '[]'::jsonb;

comment on column public.notification_push_log.click_tokens is
  'מזהי wc שנשלחו על כפתורי ההודעה, כדי לחבר sent_at ללחיצה. מערך של {wc,wt,target}.';

create index if not exists notification_push_log_click_tokens_idx
  on public.notification_push_log using gin (click_tokens);

create or replace function public.dl_add(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent   uuid;
  v_n       integer;
  v_wc      text;
  v_type    text;
  v_target  text;
  v_outcome text;
  v_ua      text;
  v_ttfb    integer;
  v_fcp     integer;
  v_auth    integer;
  v_route   integer;
  v_visible integer;
begin
  if coalesce((select c.value::int from public.pricing_config c
                where c.key = 'deeplink_timing_enabled'), 1) <> 1 then
    return;
  end if;
  if jsonb_typeof(p) is distinct from 'array' then
    return;
  end if;
  v_wc := lower(coalesce(p->>0, ''));
  if v_wc !~ '^[a-f][a-f0-9]{11}$' then
    return;
  end if;
  v_outcome := case coalesce(p->>9, '')
    when 'r' then 'reached'
    when 'l' then 'login_wall'
    when 'e' then 'error'
    when 'a' then 'abandoned'
    else null
  end;
  if v_outcome is null then
    return;
  end if;
  v_type := lower(coalesce(p->>1, ''));
  if v_type !~ '^[a-z0-9_]{1,40}$' then
    v_type := '';
  end if;
  v_target := coalesce(p->>2, '');
  if v_target !~ '^[A-Za-z0-9]{1,40}$' then
    v_target := '';
  end if;
  v_ua := case coalesce(p->>10, '')
    when 'w' then 'whatsapp_inapp'
    when 'i' then 'ios'
    when 'c' then 'chrome'
    else 'other'
  end;
  v_ttfb := case when coalesce(p->>3, '') !~ '^[0-9]{1,7}$' then null else least(600000, (p->>3)::integer) end;
  v_fcp := case when coalesce(p->>4, '') !~ '^[0-9]{1,7}$' then null else least(600000, (p->>4)::integer) end;
  v_auth := case when coalesce(p->>5, '') !~ '^[0-9]{1,7}$' then null else least(600000, (p->>5)::integer) end;
  v_route := case when coalesce(p->>6, '') !~ '^[0-9]{1,7}$' then null else least(600000, (p->>6)::integer) end;
  v_visible := case when coalesce(p->>7, '') !~ '^[0-9]{1,7}$' then null else least(600000, (p->>7)::integer) end;

  v_agent := public.current_agent_id();

  -- בלי סוכן/ת: רק wc שנשלח (יומן הדחיפה), שלא פג. אחרת אנונימי ממלא
  -- את תקרת 120 הדקה בשורות מזויפות, כ-170 אלף ביום, וחוסם מדידה אמיתית.
  -- שורה אחת ל-wc: המפתח הראשי. עדכון של אותו wc עדיין נספר בתקרה.
  if v_agent is null then
    if not exists (
      select 1 from public.notification_push_log l
       where l.whatsapp_status = 'sent'
         and l.sent_at is not null
         and l.sent_at > now() - interval '30 days'
         and l.click_tokens @> jsonb_build_array(jsonb_build_object('wc', v_wc))
    ) then
      return;
    end if;
  end if;

  delete from public.deeplink_timing_calls c
   where c.called_at < now() - interval '1 hour';

  if v_agent is not null then
    select count(*) into v_n from public.deeplink_timing_calls c
     where c.agent_id = v_agent and c.called_at > now() - interval '1 hour';
    if v_n >= 60 then
      return;
    end if;
  else
    select count(*) into v_n from public.deeplink_timing_calls c
     where c.agent_id is null and c.called_at > now() - interval '1 minute';
    if v_n >= 120 then
      return;
    end if;
  end if;

  insert into public.deeplink_timing_calls (agent_id) values (v_agent);

  insert into public.deeplink_timings (
    wc, msg_type, target, agent_id,
    ttfb_ms, fcp_ms, auth_ms, route_ms, visible_ms,
    outcome, ua_class
  ) values (
    v_wc, nullif(v_type, ''), nullif(v_target, ''), v_agent,
    v_ttfb, v_fcp, v_auth, v_route, v_visible,
    v_outcome, v_ua
  )
  on conflict (wc) do update set
    agent_id = coalesce(public.deeplink_timings.agent_id, excluded.agent_id),
    msg_type = coalesce(public.deeplink_timings.msg_type, excluded.msg_type),
    target = coalesce(public.deeplink_timings.target, excluded.target),
    ttfb_ms = coalesce(public.deeplink_timings.ttfb_ms, excluded.ttfb_ms),
    fcp_ms = coalesce(public.deeplink_timings.fcp_ms, excluded.fcp_ms),
    auth_ms = coalesce(public.deeplink_timings.auth_ms, excluded.auth_ms),
    route_ms = coalesce(public.deeplink_timings.route_ms, excluded.route_ms),
    visible_ms = coalesce(public.deeplink_timings.visible_ms, excluded.visible_ms),
    outcome = case
      when public.deeplink_timings.outcome = 'reached' then public.deeplink_timings.outcome
      when excluded.outcome = 'reached' then excluded.outcome
      when public.deeplink_timings.outcome = 'error' then public.deeplink_timings.outcome
      when excluded.outcome = 'error' then excluded.outcome
      when public.deeplink_timings.outcome = 'login_wall' and excluded.outcome = 'abandoned'
        then public.deeplink_timings.outcome
      else excluded.outcome
    end
  where public.deeplink_timings.outcome is distinct from 'reached';
end $$;

comment on function public.dl_add(jsonb) is
  'שורה אחת ל-wc. אנונימי רק אם wc נשלח ב-30 הימים האחרונים. agent_id רק מ-current_agent_id(). עד 60 בשעה לסוכן/ת, 120 בדקה בלי סוכן/ת, גם על עדכון. שמירה 90 יום. דגל deeplink_timing_enabled.';

revoke all on function public.dl_add(jsonb) from public, anon, authenticated;
grant execute on function public.dl_add(jsonb) to anon, authenticated;

create or replace view public.deeplink_timing_daily
  with (security_invoker = true) as
with taps as (
  select (t.created_at at time zone 'Asia/Jerusalem')::date as day,
         t.target,
         t.msg_type,
         count(*)::integer as n,
         percentile_cont(0.5) within group (order by t.visible_ms)
           filter (where t.outcome = 'reached' and t.visible_ms is not null) as p50_visible_ms,
         percentile_cont(0.9) within group (order by t.visible_ms)
           filter (where t.outcome = 'reached' and t.visible_ms is not null) as p90_visible_ms,
         round((100.0 * count(*) filter (where t.outcome = 'abandoned')
                / nullif(count(*), 0))::numeric, 1) as abandoned_pct,
         round((100.0 * count(*) filter (where t.outcome = 'login_wall')
                / nullif(count(*), 0))::numeric, 1) as login_wall_pct,
         percentile_cont(0.5) within group (order by d.delay_ms)
           filter (where d.delay_ms is not null) as p50_sent_to_tap_ms,
         percentile_cont(0.9) within group (order by d.delay_ms)
           filter (where d.delay_ms is not null) as p90_sent_to_tap_ms
    from public.deeplink_timings t
    left join lateral (
      select greatest(0::numeric, (
        extract(epoch from (t.created_at - l.sent_at)) * 1000
        - coalesce(t.visible_ms, t.route_ms, 0)
      )) as delay_ms
        from public.notification_push_log l
       where l.sent_at is not null
         and l.whatsapp_status = 'sent'
         and l.click_tokens @> jsonb_build_array(jsonb_build_object('wc', t.wc))
       order by l.sent_at desc
       limit 1
    ) d on true
   group by 1, 2, 3
),
sends as (
  select (l.sent_at at time zone 'Asia/Jerusalem')::date as day,
         nullif(tok->>'target', '') as target,
         nullif(tok->>'wt', '') as msg_type,
         count(*)::integer as sends,
         count(*) filter (
           where exists (select 1 from public.deeplink_timings t where t.wc = tok->>'wc')
         )::integer as taps
    from public.notification_push_log l
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(l.click_tokens) = 'array' then l.click_tokens else '[]'::jsonb end
    ) tok
   where l.whatsapp_status = 'sent'
     and l.sent_at is not null
   group by 1, 2, 3
)
select coalesce(taps.day, sends.day) as day,
       coalesce(taps.target, sends.target) as target,
       coalesce(taps.msg_type, sends.msg_type) as msg_type,
       coalesce(taps.n, 0) as n,
       taps.p50_visible_ms,
       taps.p90_visible_ms,
       taps.abandoned_pct,
       taps.login_wall_pct,
       taps.p50_sent_to_tap_ms,
       taps.p90_sent_to_tap_ms,
       coalesce(sends.sends, 0) as sends,
       coalesce(sends.taps, 0) as taps,
       case when coalesce(sends.sends, 0) > 0
         then round((100.0 * sends.taps / sends.sends)::numeric, 1)
       end as tap_pct
  from taps
  full join sends
    on taps.day = sends.day
   and taps.target is not distinct from sends.target
   and taps.msg_type is not distinct from sends.msg_type;

comment on view public.deeplink_timing_daily is
  'לפי יום, יעד וסוג: p50/p90 עד שהיעד נראה, אחוז נטישה, אחוז מסך כניסה, וזמן משליחה ללחיצה. service_role בלבד.';

revoke all on table public.deeplink_timing_daily from public, anon, authenticated;
grant select on table public.deeplink_timing_daily to service_role;

create or replace function public.deeplink_timing_report()
returns setof public.deeplink_timing_daily
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_is_platform_admin(), false) is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.deeplink_timing_daily;
end $$;

comment on function public.deeplink_timing_report() is
  'אותה תמונה של deeplink_timing_daily, רק למנהל/ת פלטפורמה.';

revoke all on function public.deeplink_timing_report() from public, anon, authenticated;
grant execute on function public.deeplink_timing_report() to authenticated;

insert into public.data_retention_settings (policy, keep_for, enabled, description)
values (
  'deeplink_timings',
  interval '90 days',
  true,
  'מדידת לחיצה על כפתור עד היעד. אין פרט אישי. נמחק אחרי 90 יום.'
)
on conflict (policy) do nothing;

create or replace function public.data_retention_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s         record;
  v_cut     timestamptz;
  v_n       integer;
  v_parts   jsonb;
  v_out     jsonb := '{}'::jsonb;
  v_warn    integer;
begin
  for s in select * from public.data_retention_settings order by policy loop
    v_cut := now() - s.keep_for;
    v_parts := '{}'::jsonb;

    if s.policy = 'leads_pii' then
      -- ליד שקשור לחוזה נשאר כמו שהוא: החוזה הוא רשומה של עסקה, והסוכן/ת
      -- צריך/ה לדעת מול מי.
      select count(*) into v_n from public.leads l
       where l.created_at < v_cut
         and (l.raw_name is not null or l.raw_phone is not null
              or l.raw_message is not null or l.property_details is not null)
         and not exists (select 1 from public.contracts k where k.lead_id = l.id);
      v_parts := v_parts || jsonb_build_object('leads', v_n);
      select count(*) into v_n from public.mortgage_leads m
       where m.created_at < v_cut and m.full_name <> 'נמחק';
      v_parts := v_parts || jsonb_build_object('mortgage_leads', v_n);
      select count(*) into v_n from public.project_leads p
       where p.created_at < v_cut and p.full_name <> 'נמחק';
      v_parts := v_parts || jsonb_build_object('project_leads', v_n);
      select count(*) into v_n from public.ads_leads a
       where a.received_at < v_cut and a.field_data <> '{}'::jsonb;
      v_parts := v_parts || jsonb_build_object('ads_leads', v_n);
      select count(*) into v_n from public.rss_leads r
       where r.created_at < v_cut and r.raw_content is not null;
      v_parts := v_parts || jsonb_build_object('rss_leads', v_n);
      select count(*) into v_n from public.lead_routing_log g
       where g.created_at < v_cut and g.summary is not null;
      v_parts := v_parts || jsonb_build_object('lead_routing_log', v_n);

      if s.enabled then
        update public.leads l
           set raw_name = null, raw_phone = null, raw_message = null, property_details = null
         where l.created_at < v_cut
           and (l.raw_name is not null or l.raw_phone is not null
                or l.raw_message is not null or l.property_details is not null)
           and not exists (select 1 from public.contracts k where k.lead_id = l.id);
        -- ‏full_name ו-phone הם not null (ו-full_name באורך 2 לפחות)
        update public.mortgage_leads
           set full_name = 'נמחק', phone = '', email = null
         where created_at < v_cut and full_name <> 'נמחק';
        update public.project_leads
           set full_name = 'נמחק', phone = '', phone_e164 = null, email = null, message = null
         where created_at < v_cut and full_name <> 'נמחק';
        update public.ads_leads set field_data = '{}'::jsonb
         where received_at < v_cut and field_data <> '{}'::jsonb;
        update public.rss_leads set raw_content = null, raw_title = null
         where created_at < v_cut and raw_content is not null;
        update public.lead_routing_log set summary = null
         where created_at < v_cut and summary is not null;
      end if;

    elsif s.policy = 'whatsapp_bodies' then
      select count(*) into v_n from public.whatsapp_messages w
       where w.created_at < v_cut and (w.body is not null or w.media_url is not null);
      v_parts := v_parts || jsonb_build_object('whatsapp_messages', v_n);
      select count(*) into v_n from public.whatsapp_conversations c
       where c.last_message_at < v_cut and c.history <> '[]'::jsonb;
      v_parts := v_parts || jsonb_build_object('whatsapp_conversations', v_n);
      select count(*) into v_n from public.whatsapp_public_conversations c
       where c.last_message_at < v_cut and c.history <> '[]'::jsonb;
      v_parts := v_parts || jsonb_build_object('whatsapp_public_conversations', v_n);

      if s.enabled then
        update public.whatsapp_messages set body = null, media_url = null
         where created_at < v_cut and (body is not null or media_url is not null);
        update public.whatsapp_conversations set history = '[]'::jsonb
         where last_message_at < v_cut and history <> '[]'::jsonb;
        update public.whatsapp_public_conversations set history = '[]'::jsonb
         where last_message_at < v_cut and history <> '[]'::jsonb;
      end if;

    elsif s.policy = 'call_transcripts' then
      select count(*) into v_n from public.agent_calls k
       where k.created_at < v_cut
         and (k.transcript is not null or k.summary is not null or k.extracted is not null);
      v_parts := v_parts || jsonb_build_object('agent_calls', v_n);
      if s.enabled then
        update public.agent_calls set transcript = null, summary = null, extracted = null
         where created_at < v_cut
           and (transcript is not null or summary is not null or extracted is not null);
      end if;

    elsif s.policy = 'clients_inactive' then
      -- שני שלבים: התראה כשנשאר שבוע, ומחיקה רק אם ההתראה יצאה לפני שבוע
      -- לפחות **ואין פעילות מאז**. כל עדכון בכרטיס אחרי ההתראה מאפס.
      create temp table _ret_clients on commit drop as
        select c.id, c.agent_id, c.full_name, public._client_last_activity(c.id) as last_at
          from public.agent_clients c;

      select count(*) into v_warn from _ret_clients r
       where r.last_at < v_cut + interval '7 days'
         and not exists (select 1 from public.data_retention_client_warnings w
                          where w.client_id = r.id and w.warned_at > r.last_at);
      select count(*) into v_n from _ret_clients r
        join public.data_retention_client_warnings w on w.client_id = r.id
       where r.last_at < v_cut
         and w.warned_at > r.last_at
         and w.warned_at < now() - interval '7 days';
      -- בהרצת יבש עוד לא יצאה אף התראה, ולכן "היה נמחק" = כרטיסים שכבר
      -- עברו את הסף. זה המספר שיימחק שבוע אחרי ההדלקה.
      if not s.enabled then
        select count(*) into v_n from _ret_clients r where r.last_at < v_cut;
      end if;
      v_parts := v_parts || jsonb_build_object('agent_clients', v_n, 'warnings', v_warn);

      if s.enabled then
        delete from public.agent_clients c
         using _ret_clients r, public.data_retention_client_warnings w
         where c.id = r.id and w.client_id = r.id
           and r.last_at < v_cut
           and w.warned_at > r.last_at
           and w.warned_at < now() - interval '7 days';

        -- suppress_push בעמודות: זו התראה חיה (שבוע לפני מחיקה), לא מילוי
        -- היסטוריה. false משאיר אותה לדחיפה. בלי העמודה הבדיקה חוסמת
        -- את הקובץ, כי הוא אחרי 20271028140000.
        insert into public.notifications (agent_id, type, title, body, related_client_id, suppress_push)
        select r.agent_id, 'retention_warning',
               'כרטיס לקוח/ה יימחק בעוד שבוע',
               'הכרטיס של ' || coalesce(nullif(r.full_name, ''), 'לקוח/ה') ||
               ' לא היה פעיל שנתיים, ולכן יימחק בעוד שבוע לפי מדיניות השמירה. '
               || 'כל עדכון בכרטיס משאיר אותו.',
               r.id,
               false
          from _ret_clients r
         where r.agent_id is not null
           and r.last_at < v_cut + interval '7 days'
           and not exists (select 1 from public.data_retention_client_warnings w
                            where w.client_id = r.id and w.warned_at > r.last_at);

        -- אותו תנאי כמו ההתראה שלמעלה: רק מי שאין לו/ה התראה מאז הפעילות
        -- האחרונה. ‏(הכרטיסים שנמחקו כבר אינם - ה-FK היה נכשל עליהם.)
        insert into public.data_retention_client_warnings (client_id, warned_at)
        select r.id, now() from _ret_clients r
         where r.last_at < v_cut + interval '7 days'
           and exists (select 1 from public.agent_clients c where c.id = r.id)
           and not exists (select 1 from public.data_retention_client_warnings w
                            where w.client_id = r.id and w.warned_at > r.last_at)
        on conflict (client_id) do update set warned_at = excluded.warned_at;
      end if;
      drop table if exists _ret_clients;

    elsif s.policy = 'whatsapp_pending_actions' then
      -- נשמר מ-20271028165000. בלי הענף הזה ההחלפה של הפונקציה מוחקת את הניקוי.
      select count(*) into v_n from public.whatsapp_pending_actions a
       where (a.executed_at is not null and a.executed_at < v_cut)
          or (a.executed_at is null and a.expires_at < v_cut);
      v_parts := v_parts || jsonb_build_object('whatsapp_pending_actions', v_n);
      if s.enabled then
        delete from public.whatsapp_pending_actions a
         where (a.executed_at is not null and a.executed_at < v_cut)
            or (a.executed_at is null and a.expires_at < v_cut);
      end if;

    elsif s.policy = 'search_misses' then
      select count(*) into v_n from public.agent_search_misses m
       where m.created_at < v_cut;
      v_parts := v_parts || jsonb_build_object('agent_search_misses', v_n);
      if s.enabled then
        delete from public.agent_search_misses
         where created_at < v_cut;
      end if;

    elsif s.policy = 'deeplink_timings' then
      select count(*) into v_n from public.deeplink_timings d
       where d.created_at < v_cut;
      v_parts := v_parts || jsonb_build_object('deeplink_timings', v_n);
      if s.enabled then
        delete from public.deeplink_timings
         where created_at < v_cut;
        delete from public.deeplink_timing_calls
         where called_at < v_cut;
      end if;
    end if;

    v_n := (select coalesce(sum(value::int), 0) from jsonb_each_text(v_parts)
             where key <> 'warnings');
    insert into public.data_retention_runs (policy, dry_run, affected, details)
    values (s.policy, not s.enabled, v_n, v_parts);
    v_out := v_out || jsonb_build_object(s.policy, v_parts || jsonb_build_object('dry_run', not s.enabled));
  end loop;
  return v_out;
end $$;

revoke all on function public.data_retention_run() from public, anon, authenticated;

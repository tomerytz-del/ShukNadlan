-- =============================================================================
-- גבריאלה - KPI שבועי קבוע (docs/gabriela-turn-timing.md, "KPI שבועי").
--
-- ‏למה: אבחון גבריאלה (27.10-22.11.2026) נמדד בשאילתות kpi_weekly.sql /
-- kpi_extra.sql שאינן בריפו, ולכן ההשוואה בין שבועות נעשתה בכל פעם בהגדרה
-- קצת אחרת. ה-view הזה קובע הגדרה אחת. ספירות בלבד: בלי תוכן, טלפון או מזהה.
--
-- ‏שבוע = ראשון עד שבת בשעון ישראל (office_coach_week_start), 8 שבועות אחורה,
-- השבוע הנוכחי חלקי. כל טבלה נקראת פעם אחת מתחילת החלון, והשבוע מחושב מ-
-- created_at (ל-whatsapp_messages ול-notification_push_log אין אינדקס על
-- created_at, וצירוף לכל אחד משמונת השבועות היה סורק אותן שמונה פעמים).
-- ‏מה כל עמודה סופרת:
--   agents / inbound  - הודעות נכנסות מסוכנים (whatsapp_messages, direction='in'),
--                       בלי מנהלי/ות פלטפורמה. כולל לחיצות כפתור.
--   pushes ...         - notification_push_log שיצאו (whatsapp_status='sent');
--                       read_pct ו-failed_pct מתוך אלה שיש להן delivery_status.
--   fail_131049        - כשל מסירה בקוד 131049 של Meta (מגבלת תבניות שיווקיות).
--   agent_usd          - עלות המודל לעוזרת הסוכנים (gabriela_agent*, כולל חימום
--                       ותור מוגבל). **אותו תמחור בדיוק כמו ai_usage_costs** (הפאנל
--                       "עלויות" ב-CRM, 20270622090000): מחיר לפי ההתאמה הארוכה
--                       ביותר של שם המודל, units לפי unit_usd, ומטמון של שעה בלי
--                       מחיר = input * 2. מי שמשנה את התמחור שם משנה גם כאן.
--   prefix_tokens      - גודל הקידומת הקבועה (כלים + SYSTEM_STATIC), לפי קריאות
--                       החימום, שאין בהן היסטוריה. 94% מכל קריאה ב-11.2026.
--   *_p50_s / p90_s    - gabriela_turn_timings, תורים שהסתיימו ok (מ-24.11.2026).
--   match_*            - client_match_feedback לפי updated_at (מ-20271204100000).
-- =============================================================================

create or replace view public.gabriela_weekly_kpi
with (security_invoker = true) as
with b as (
  select gs::date as week_start
    from generate_series(public.office_coach_week_start() - 49,
                         public.office_coach_week_start(), interval '7 days') gs
),
lo as (
  select (min(week_start)::timestamp at time zone 'Asia/Jerusalem') as t from b
),
msg as (
  select wk.d - extract(dow from wk.d)::int as week_start,
         count(distinct m.agent_id) as agents, count(*) as inbound
    from lo
    join public.whatsapp_messages m on m.created_at >= lo.t
    cross join lateral (select (m.created_at at time zone 'Asia/Jerusalem')::date as d) wk
   where m.direction = 'in'
     and m.agent_id is not null
     and m.agent_id not in (select id from public.agency_members where is_platform_admin)
   group by 1
),
push as (
  -- avg מדלג על null: read_pct ו-failed_pct מתוך ההתראות שיש להן delivery_status
  select wk.d - extract(dow from wk.d)::int as week_start,
         count(*) as sent,
         round(100.0 * avg((p.delivery_status = 'read')::int), 1)   as read_pct,
         round(100.0 * avg((p.delivery_status = 'failed')::int), 1) as failed_pct,
         count(*) filter (where p.delivery_status = 'failed'
                            and p.delivery_detail like '%131049%') as fail_131049
    from lo
    join public.notification_push_log p on p.created_at >= lo.t
    cross join lateral (select (p.created_at at time zone 'Asia/Jerusalem')::date as d) wk
   where p.whatsapp_status = 'sent'
   group by 1
),
cost as (
  select wk.d - extract(dow from wk.d)::int as week_start,
         count(*) filter (where l.feature = 'gabriela_agent') as agent_calls,
         round(sum(case
                 when pr.model is null then null
                 when l.units is not null then l.units * pr.unit_usd
                 when pr.input_usd_mtok is null then null
                 else (k.u * pr.input_usd_mtok + k.cr * pr.cache_read_usd_mtok
                       + k.cw * pr.cache_write_usd_mtok
                       + k.cw1h * coalesce(pr.cache_write_1h_usd_mtok, pr.input_usd_mtok * 2)
                       + k.o * pr.output_usd_mtok) / 1000000.0 end)::numeric, 2) as agent_usd,
         round(avg(k.u + k.cr + k.cw + k.cw1h)
               filter (where l.feature = 'gabriela_agent_warm')) as prefix_tokens
    from lo
    join public.ai_usage_log l on l.created_at >= lo.t
    cross join lateral (select (l.created_at at time zone 'Asia/Jerusalem')::date as d) wk
    cross join lateral (
      select coalesce(l.uncached_input_tokens, 0) as u, coalesce(l.cache_read_tokens, 0) as cr,
             coalesce(l.cache_write_tokens, 0) as cw, coalesce(l.cache_write_1h_tokens, 0) as cw1h,
             coalesce(l.output_tokens, 0) as o
    ) k
    left join lateral (
      select * from public.ai_model_prices mp
       where l.model = mp.model or l.model like mp.model || '-%'
       order by length(mp.model) desc limit 1
    ) pr on true
   where l.feature like 'gabriela_agent%'
     and l.model is not null and l.model <> 'copy'
   group by 1
),
tm as (
  -- אותו סף של 30 שניות כמו gabriela_turn_timing_report
  select wk.d - extract(dow from wk.d)::int as week_start,
         round((percentile_cont(0.5) within group (order by t.total_ms)
                filter (where t.kind = 'text') / 1000)::numeric, 1)  as text_p50_s,
         round((percentile_cont(0.9) within group (order by t.total_ms)
                filter (where t.kind = 'text') / 1000)::numeric, 1)  as text_p90_s,
         round((percentile_cont(0.5) within group (order by t.total_ms)
                filter (where t.kind = 'voice') / 1000)::numeric, 1) as voice_p50_s,
         round((percentile_cont(0.9) within group (order by t.total_ms)
                filter (where t.kind = 'voice') / 1000)::numeric, 1) as voice_p90_s,
         round(100.0 * avg((t.total_ms > 30000)::int), 1) as pct_over_30s
    from lo
    join public.gabriela_turn_timings t
      on t.created_at >= lo.t and t.outcome = 'ok' and t.kind in ('text', 'voice')
    cross join lateral (select (t.created_at at time zone 'Asia/Jerusalem')::date as d) wk
   group by 1
),
fb as (
  select wk.d - extract(dow from wk.d)::int as week_start,
         count(*) filter (where f.feedback = 'relevant')     as relevant,
         count(*) filter (where f.feedback = 'not_relevant') as not_relevant
    from lo
    join public.client_match_feedback f on f.updated_at >= lo.t
    cross join lateral (select (f.updated_at at time zone 'Asia/Jerusalem')::date as d) wk
   group by 1
)
select b.week_start,
       msg.agents,
       msg.inbound,
       push.sent as pushes,
       push.read_pct,
       push.failed_pct,
       push.fail_131049,
       cost.agent_calls,
       cost.agent_usd,
       round(cost.agent_usd / nullif(msg.inbound, 0), 3) as usd_per_inbound,
       cost.prefix_tokens,
       tm.text_p50_s,
       tm.text_p90_s,
       tm.voice_p50_s,
       tm.voice_p90_s,
       tm.pct_over_30s,
       coalesce(fb.relevant, 0)     as match_relevant,
       coalesce(fb.not_relevant, 0) as match_not_relevant
  from b
  left join msg  using (week_start)
  left join push using (week_start)
  left join cost using (week_start)
  left join tm   using (week_start)
  left join fb   using (week_start)
 order by b.week_start desc;

comment on view public.gabriela_weekly_kpi is
  'KPI שבועי של גבריאלה לסוכנים (ראשון-שבת בשעון ישראל, 8 שבועות). ספירות בלבד. העלות בתמחור של ai_usage_costs. docs/gabriela-turn-timing.md, "KPI שבועי".';

revoke all on public.gabriela_weekly_kpi from public, anon, authenticated;
grant select on public.gabriela_weekly_kpi to service_role;

-- =============================================================================
-- גבריאלה - KPI שבועי קבוע (docs/gabriela-turn-timing.md, "KPI שבועי").
--
-- ‏למה: אבחון גבריאלה (27.10-22.11.2026) נמדד בשאילתות kpi_weekly.sql /
-- kpi_extra.sql שאינן בריפו, ולכן ההשוואה בין שבועות נעשתה בכל פעם בהגדרה
-- קצת אחרת. ה-view הזה קובע הגדרה אחת. ספירות בלבד: בלי תוכן, טלפון או מזהה.
--
-- ‏שבוע = ראשון עד שבת בשעון ישראל, 8 שבועות אחורה, השבוע הנוכחי חלקי.
-- ‏מה כל עמודה סופרת:
--   agents / inbound  - הודעות נכנסות מסוכנים (whatsapp_messages, direction='in'),
--                       בלי מנהלי/ות פלטפורמה. כולל לחיצות כפתור.
--   pushes ...         - notification_push_log שיצאו (whatsapp_status='sent');
--                       read_pct ו-failed_pct מתוך אלה שיש להן delivery_status.
--   fail_131049        - כשל מסירה בקוד 131049 של Meta (מגבלת תבניות שיווקיות).
--   agent_usd          - עלות המודל לעוזרת הסוכנים (gabriela_agent*, כולל חימום
--                       ותור מוגבל), לפי ai_model_prices.
--   prefix_tokens      - גודל הקידומת הקבועה (כלים + SYSTEM_STATIC), לפי קריאות
--                       החימום, שאין בהן היסטוריה. 94% מכל קריאה ב-11.2026.
--   *_p50_s / p90_s    - gabriela_turn_timings, תורים שהסתיימו ok (מ-24.11.2026).
--   match_*            - client_match_feedback לפי updated_at (מ-20271204100000).
-- =============================================================================

create or replace view public.gabriela_weekly_kpi
with (security_invoker = true) as
with w as (
  select gs::date as week_start
    from generate_series(
           ((now() at time zone 'Asia/Jerusalem')::date
              - extract(dow from (now() at time zone 'Asia/Jerusalem'))::int - 7 * 7),
           ((now() at time zone 'Asia/Jerusalem')::date
              - extract(dow from (now() at time zone 'Asia/Jerusalem'))::int),
           interval '7 days') gs
),
b as (
  select week_start,
         (week_start::timestamp at time zone 'Asia/Jerusalem')       as lo,
         ((week_start + 7)::timestamp at time zone 'Asia/Jerusalem') as hi
    from w
),
adm as (select id from public.agency_members where is_platform_admin),
msg as (
  select b.week_start, count(distinct m.agent_id) as agents, count(*) as inbound
    from b
    join public.whatsapp_messages m on m.created_at >= b.lo and m.created_at < b.hi
   where m.direction = 'in'
     and m.agent_id is not null
     and m.agent_id not in (select id from adm)
   group by 1
),
push as (
  select b.week_start,
         count(*) as sent,
         round(100.0 * avg((p.delivery_status = 'read')::int)
               filter (where p.delivery_status is not null), 1) as read_pct,
         round(100.0 * avg((p.delivery_status = 'failed')::int)
               filter (where p.delivery_status is not null), 1) as failed_pct,
         count(*) filter (where p.delivery_status = 'failed'
                            and p.delivery_detail like '%131049%') as fail_131049
    from b
    join public.notification_push_log p on p.created_at >= b.lo and p.created_at < b.hi
   where p.whatsapp_status = 'sent'
   group by 1
),
cost as (
  select b.week_start,
         count(*) filter (where l.feature = 'gabriela_agent') as agent_calls,
         round((sum((coalesce(l.uncached_input_tokens, 0) * pr.input_usd_mtok
                    + coalesce(l.output_tokens, 0) * pr.output_usd_mtok
                    + coalesce(l.cache_read_tokens, 0) * pr.cache_read_usd_mtok
                    + coalesce(l.cache_write_tokens, 0) * pr.cache_write_usd_mtok
                    + coalesce(l.cache_write_1h_tokens, 0)
                        * coalesce(pr.cache_write_1h_usd_mtok, pr.cache_write_usd_mtok)) / 1e6)
                filter (where l.feature like 'gabriela_agent%'))::numeric, 2) as agent_usd,
         round(avg(coalesce(l.uncached_input_tokens, 0) + coalesce(l.cache_read_tokens, 0)
                   + coalesce(l.cache_write_tokens, 0) + coalesce(l.cache_write_1h_tokens, 0))
               filter (where l.feature = 'gabriela_agent_warm')) as prefix_tokens
    from b
    join public.ai_usage_log l on l.created_at >= b.lo and l.created_at < b.hi
    left join public.ai_model_prices pr on pr.model = l.model
   group by 1
),
tm as (
  select b.week_start,
         round((percentile_cont(0.5) within group (order by t.total_ms)
                filter (where t.kind = 'text') / 1000)::numeric, 1)  as text_p50_s,
         round((percentile_cont(0.9) within group (order by t.total_ms)
                filter (where t.kind = 'text') / 1000)::numeric, 1)  as text_p90_s,
         round((percentile_cont(0.5) within group (order by t.total_ms)
                filter (where t.kind = 'voice') / 1000)::numeric, 1) as voice_p50_s,
         round((percentile_cont(0.9) within group (order by t.total_ms)
                filter (where t.kind = 'voice') / 1000)::numeric, 1) as voice_p90_s,
         round(100.0 * avg((t.total_ms > 30000)::int)
               filter (where t.kind in ('text', 'voice')), 1) as pct_over_30s
    from b
    join public.gabriela_turn_timings t
      on t.created_at >= b.lo and t.created_at < b.hi and t.outcome = 'ok'
   group by 1
),
fb as (
  select b.week_start,
         count(*) filter (where f.feedback = 'relevant')     as relevant,
         count(*) filter (where f.feedback = 'not_relevant') as not_relevant
    from b
    join public.client_match_feedback f on f.updated_at >= b.lo and f.updated_at < b.hi
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
  left join fb   using (week_start);

comment on view public.gabriela_weekly_kpi is
  'KPI שבועי של גבריאלה לסוכנים (ראשון-שבת בשעון ישראל, 8 שבועות). ספירות בלבד. docs/gabriela-turn-timing.md, "KPI שבועי".';

revoke all on public.gabriela_weekly_kpi from public, anon, authenticated;
grant select on public.gabriela_weekly_kpi to service_role;

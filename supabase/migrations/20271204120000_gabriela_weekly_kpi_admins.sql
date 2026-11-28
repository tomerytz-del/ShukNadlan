-- =============================================================================
-- gabriela_weekly_kpi - שני תיקוני דיוק מהסקירה של #1441.
--
--   1. מנהלי/ות פלטפורמה מחוץ גם להתראות (push) ולמשוב על התאמות (fb), כמו
--      שהכותרת של 20271204110000 מבטיחה לכל העמודות. notification_push_log.agent_id
--      ו-client_match_feedback.agent_id הם not null.
--   2. unpriced_calls סופר כל שורה שהעלות שלה null ב-agent_usd: גם מודל תואם בלי
--      המחיר הרלוונטי, ולא רק מודל שאין לו שורה (ב-28.11.2026 אין כאלה בפרודקשן).
--
-- העתק מלא של ה-view מ-20271204110000, אותן עמודות באותו סדר (create or replace
-- view דורש זאת), ושלושה שינויים: שתי שורות סינון ותנאי ה-unpriced_calls.
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
-- מנהלי/ות פלטפורמה בודקים את גבריאלה, ולכן הם מחוץ לכל העמודות (הודעות, עלות
-- וזמנים) - אחרת עלות להודעה הייתה זזה לפי כמה הם בדקו באותו שבוע.
adm as (select id from public.agency_members where is_platform_admin),
msg as (
  select wk.d - extract(dow from wk.d)::int as week_start,
         count(distinct m.agent_id) as agents, count(*) as inbound
    from lo
    join public.whatsapp_messages m on m.created_at >= lo.t
    cross join lateral (select (m.created_at at time zone 'Asia/Jerusalem')::date as d) wk
   where m.direction = 'in'
     and m.agent_id is not null
     and m.agent_id not in (select id from adm)
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
     and p.agent_id not in (select id from adm)
   group by 1
),
cost as (
  select wk.d - extract(dow from wk.d)::int as week_start,
         -- קריאות של תורים (וואטסאפ, ומייל/קובץ בתור המוגבל); החימום רק בעלות
         count(*) filter (where l.feature in ('gabriela_agent', 'gabriela_agent_limited')) as agent_calls,
         -- שורות שה-case למטה מחזיר עליהן null: אין מודל תואם ב-ai_model_prices, או
         -- שיש ואין לו המחיר הרלוונטי (unit_usd לשורה עם units, input_usd_mtok לטוקנים).
         -- העלות שלהן חסרה ב-agent_usd.
         count(*) filter (where pr.model is null
                             or (l.units is not null and pr.unit_usd is null)
                             or (l.units is null and pr.input_usd_mtok is null)) as unpriced_calls,
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
     and (l.agent_id is null or l.agent_id not in (select id from adm))
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
         round(100.0 * count(*) filter (where t.total_ms > 30000) / nullif(count(*), 0), 1) as pct_over_30s
    from lo
    join public.gabriela_turn_timings t
      on t.created_at >= lo.t and t.outcome = 'ok' and t.kind in ('text', 'voice')
     and (t.agent_id is null or t.agent_id not in (select id from adm))
    cross join lateral (select (t.created_at at time zone 'Asia/Jerusalem')::date as d) wk
   group by 1
),
fb as (
  select wk.d - extract(dow from wk.d)::int as week_start,
         count(*) filter (where f.feedback = 'relevant')     as relevant,
         count(*) filter (where f.feedback = 'not_relevant') as not_relevant
    from lo
    join public.client_match_feedback f on f.updated_at >= lo.t
     and f.agent_id not in (select id from adm)
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
       cost.unpriced_calls,
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

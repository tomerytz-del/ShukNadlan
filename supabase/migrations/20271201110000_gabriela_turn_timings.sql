-- ============================================================================
-- רישום זמנים לתור של גבריאלה (הסוכנים): איפה הולכות 25-33 השניות של ה-p90.
--
-- version 20271201110000: מעל 20271201100000 שב-main.
--
-- למה: בדוח האבחון p90 של זמן תגובה הוא 25-33 שניות, ו-17% מההודעות הקוליות מעל 30 שניות,
-- בלי פירוק. ‏ai_usage_log מחזיקה טוקנים ולא משכי זמן, וה-`llm ... ms=` שביומן הפונקציה נעלם
-- אחרי ימים ואי אפשר לשאול אותו. בלי פירוק (המתנה לרצף, תמלול, מודל, כלים, שליחה) קיצור הפרומפט
-- (כ-55K טוקנים לקריאה) הוא ניחוש.
--
-- שורה לתור. **בלי תוכן הודעה, בלי טלפון ובלי טקסט**: מזהה סוכן/ת, מספרים, וסוג התור. שמות
-- כלים בלבד (רשימה סגורה בקוד). הכתיבה רק מ-service_role, ישירות מהוובהוק.
-- דגל gabriela_turn_timing_enabled ב-pricing_config עוצר כתיבה בלי דיפלוי. נולד דולק: אין כאן
-- פרט אישי. שמירה 90 יום (docs/data-retention.md).
--
-- אידמפוטנטית.
-- ============================================================================

insert into public.pricing_config (key, value, description) values
  ('gabriela_turn_timing_enabled', 1, '1: רישום זמני תור של גבריאלה (המתנה, תמלול, מודל, כלים, שליחה). 0 עוצר כתיבה בלי דיפלוי.')
on conflict (key) do nothing;

create table if not exists public.gabriela_turn_timings (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  agent_id      uuid,
  channel       text not null default 'whatsapp',
  kind          text not null,
  outcome       text not null,
  wait_ms       integer,
  transcribe_ms integer,
  prep_ms       integer,
  llm_ms        integer,
  llm_calls     smallint,
  tool_ms       integer,
  tool_calls    smallint,
  tool_names    text[],
  in_tokens     integer,
  cache_read    integer,
  cache_write   integer,
  out_tokens    integer,
  send_ms       integer,
  total_ms      integer,
  constraint gabriela_turn_timings_kind_chk
    check (kind in ('text', 'voice', 'audio_file', 'image', 'document', 'button', 'other')),
  constraint gabriela_turn_timings_outcome_chk
    check (outcome in ('ok', 'error', 'aborted')),
  constraint gabriela_turn_timings_channel_chk
    check (channel in ('whatsapp', 'email'))
);

comment on table public.gabriela_turn_timings is
  'תור אחד של גבריאלה: משכי זמן במילישניות לפי שלב. בלי תוכן, טלפון או טקסט. docs/gabriela-turn-timing.md';

create index if not exists gabriela_turn_timings_created_idx
  on public.gabriela_turn_timings (created_at desc);
create index if not exists gabriela_turn_timings_agent_created_idx
  on public.gabriela_turn_timings (agent_id, created_at desc);

alter table public.gabriela_turn_timings enable row level security;
revoke all on table public.gabriela_turn_timings from public, anon, authenticated;
grant select, insert, update, delete on table public.gabriela_turn_timings to service_role;

-- פירוק לפי סוג תור: p50/p90 ושיעור מעל 30 שניות, ל-30 הימים האחרונים. לקריאה ב-SQL ידני.
create or replace view public.gabriela_turn_timing_report
with (security_invoker = true) as
select
  kind,
  count(*)                                                        as turns,
  round(((percentile_cont(0.5) within group (order by total_ms::float8)) / 1000.0)::numeric, 1) as total_p50_s,
  round(((percentile_cont(0.9) within group (order by total_ms::float8)) / 1000.0)::numeric, 1) as total_p90_s,
  round(100.0 * count(*) filter (where total_ms > 30000) / count(*), 1)      as pct_over_30s,
  round(((percentile_cont(0.9) within group (order by wait_ms::float8)) / 1000.0)::numeric, 1)       as wait_p90_s,
  round(((percentile_cont(0.9) within group (order by transcribe_ms::float8)) / 1000.0)::numeric, 1) as transcribe_p90_s,
  round(((percentile_cont(0.9) within group (order by llm_ms::float8)) / 1000.0)::numeric, 1)        as llm_p90_s,
  round(((percentile_cont(0.9) within group (order by tool_ms::float8)) / 1000.0)::numeric, 1)       as tool_p90_s,
  round(avg(llm_calls), 2)                                         as avg_llm_calls
from public.gabriela_turn_timings
where created_at > now() - interval '30 days' and outcome = 'ok'
group by kind;

revoke all on public.gabriela_turn_timing_report from public, anon, authenticated;
grant select on public.gabriela_turn_timing_report to service_role;

-- שמירה 90 יום: מחיקה יומית מ-cron. כאן ולא ב-data_retention_run: זו מדידה בלי פרט אישי, והפונקציה
-- ההיא ארוכה ושינוי בה מסכן את שאר המדיניות. docs/data-retention.md.
do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - מחיקת gabriela_turn_timings אחרי 90 יום לא תוזמנה';
    return;
  end if;

  perform cron.unschedule('gabriela-turn-timings-retention')
    where exists (select 1 from cron.job where jobname = 'gabriela-turn-timings-retention');
  perform cron.schedule('gabriela-turn-timings-retention', '17 3 * * *', $cron$
    delete from public.gabriela_turn_timings where created_at < now() - interval '90 days'
  $cron$);
end
$do$;

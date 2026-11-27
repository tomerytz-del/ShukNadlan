-- ============================================================================
-- תובנות מהקלטות של צוות ההטמעה: מה שהמנטור מוציא מכל שיחה, והזיכרון המצטבר
--
--   1. csm_calls.review / reviewed_at / review_error: ניתוח המנטור לשיחה (התנגדויות, שאלות,
--      חלופות שעלו, הערות על התסריט, ומה שהמנטור לא ידע). נכתב ב-service_role
--      בלבד (_shared/csm-review.ts) אחרי שהסיכום הרגיל כבר שמור.
--   2. csm_call_insights: אותו ניתוח כשורות מנורמלות, כדי לרכז לפי סוג בעיה, סוג
--      פתרון ונושא שאלה. ההקלטה נמחקת = השורות נמחקות (cascade).
--   3. csm_insight_reports: הניתוח הכולל - מה עובד, תשובות להתנגדויות ושיפורים
--      בתסריט, לפי כל השיחות בטווח. נכתב ב-service_role בלבד.
--   4. csm_insights_overview(p_days): הספירות לאזור (לצוות ההטמעה ול-service_role).
--
-- אותה הרשאה לכל טבלת csm_*: current_is_csm(). אין כתיבה מהדפדפן. אידמפוטנטית.
-- ============================================================================

alter table public.csm_calls add column if not exists review jsonb;
alter table public.csm_calls add column if not exists reviewed_at timestamptz;
-- סיבת הכשל של ניתוח המנטור (נמחקת בהצלחה): בלי זה "המנטור עובר על השיחה" לא נבדל מ"נכשל"
alter table public.csm_calls add column if not exists review_error text;

create table if not exists public.csm_call_insights (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid not null references public.csm_calls(id) on delete cascade,
  staff_id       uuid references public.csm_staff(id) on delete set null,
  agent_id       uuid references public.agency_members(id) on delete set null,
  kind           text not null check (kind in ('objection', 'question', 'competitor', 'gap')),
  -- התנגדות: סוג הבעיה. שאלה: הנושא. (רשימה סגורה ב-csm-review-format.ts)
  problem_type   text,
  solution_type  text,
  -- well | partial | not_handled: האם נענתה בשיחה
  outcome        text check (outcome is null or outcome in ('well', 'partial', 'not_handled')),
  text           text not null check (char_length(text) between 2 and 600),
  reply          text check (reply is null or char_length(reply) <= 800),
  system_feature text check (system_feature is null or char_length(system_feature) <= 80),
  competitor     text check (competitor is null or char_length(competitor) <= 80),
  created_at     timestamptz not null default now()
);

create index if not exists csm_call_insights_call_idx on public.csm_call_insights (call_id);
create index if not exists csm_call_insights_kind_idx on public.csm_call_insights (kind, problem_type, created_at desc);
create index if not exists csm_call_insights_agent_idx on public.csm_call_insights (agent_id) where agent_id is not null;

comment on table public.csm_call_insights is
  'התנגדויות, שאלות, חלופות ופערי ידע שהמנטור הוציא מהקלטות הטמעה (_shared/csm-review.ts). docs/csm-adoption.md';

create table if not exists public.csm_insight_reports (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid references public.csm_staff(id) on delete set null,
  status       text not null default 'processing' check (status in ('processing', 'done', 'failed')),
  error        text,
  days         integer not null default 90 check (days between 7 and 365),
  calls_count  integer not null default 0,
  report       jsonb,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists csm_insight_reports_created_idx on public.csm_insight_reports (created_at desc);

comment on table public.csm_insight_reports is
  'ניתוח כולל של שיחות ההטמעה: תשובות להתנגדויות ושיפורים בתסריט (_shared/csm-insights.ts). docs/csm-adoption.md';

alter table public.csm_call_insights enable row level security;
alter table public.csm_insight_reports enable row level security;

revoke all on table public.csm_call_insights from public, anon, authenticated;
revoke all on table public.csm_insight_reports from public, anon, authenticated;
grant select on table public.csm_call_insights to authenticated;
grant select on table public.csm_insight_reports to authenticated;
grant select, insert, update, delete on table public.csm_call_insights to service_role;
grant select, insert, update, delete on table public.csm_insight_reports to service_role;

drop policy if exists "csm reads call insights" on public.csm_call_insights;
create policy "csm reads call insights" on public.csm_call_insights for select to authenticated
  using (public.current_is_csm());
drop policy if exists "csm reads insight reports" on public.csm_insight_reports;
create policy "csm reads insight reports" on public.csm_insight_reports for select to authenticated
  using (public.current_is_csm());

-- ---------------------------------------------------------------------------
-- הספירות: אחת לכל הצרכנים (הלשונית "תובנות", והמנטור דרך service_role)
-- ---------------------------------------------------------------------------
create or replace function public.csm_insights_overview(p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 90), 7), 365);
  v_from timestamptz;
  v_out  jsonb;
begin
  if not (public.current_is_csm() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_from := now() - make_interval(days => v_days);

  select jsonb_build_object(
    'days', v_days,
    'calls_total',    (select count(*) from public.csm_calls c where c.status = 'done' and c.created_at >= v_from),
    'calls_reviewed', (select count(*) from public.csm_calls c where c.reviewed_at is not null and c.created_at >= v_from),
    'objections', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select i.problem_type, count(*) as n,
                     count(*) filter (where i.outcome = 'not_handled') as missed,
                     count(*) filter (where i.outcome = 'well') as handled,
                     count(distinct i.agent_id) as agents
                from public.csm_call_insights i
               where i.kind = 'objection' and i.created_at >= v_from
               group by i.problem_type) x), '[]'::jsonb),
    'solutions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select i.solution_type, count(*) as n,
                     count(*) filter (where i.outcome = 'well') as handled
                from public.csm_call_insights i
               where i.kind = 'objection' and i.solution_type is not null and i.created_at >= v_from
               group by i.solution_type) x), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select i.problem_type as topic, count(*) as n,
                     count(*) filter (where i.outcome is distinct from 'well') as unanswered
                from public.csm_call_insights i
               where i.kind = 'question' and i.created_at >= v_from
               group by i.problem_type) x), '[]'::jsonb),
    'open_questions', coalesce((
      select jsonb_agg(to_jsonb(x))
        from (select i.text, i.problem_type as topic, i.reply, i.created_at
                from public.csm_call_insights i
               where i.kind = 'question' and i.outcome is distinct from 'well' and i.created_at >= v_from
               order by i.created_at desc limit 10) x), '[]'::jsonb),
    'competitors', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select lower(i.competitor) as name, count(*) as n
                from public.csm_call_insights i
               where i.kind = 'competitor' and i.competitor is not null and i.created_at >= v_from
               group by lower(i.competitor)) x), '[]'::jsonb),
    'features', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select i.system_feature as name, count(*) as n
                from public.csm_call_insights i
               where i.kind = 'objection' and i.system_feature is not null and i.created_at >= v_from
               group by i.system_feature order by count(*) desc limit 8) x), '[]'::jsonb),
    'gaps', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select lower(i.text) as text, count(*) as n
                from public.csm_call_insights i
               where i.kind = 'gap' and i.created_at >= v_from
               group by lower(i.text) order by count(*) desc limit 12) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

comment on function public.csm_insights_overview(integer) is
  'ספירות התובנות מהקלטות ההטמעה: התנגדויות לפי סוג, פתרונות, שאלות, חלופות ופערי ידע. לצוות ההטמעה ול-service_role.';

revoke all on function public.csm_insights_overview(integer) from public, anon, authenticated;
grant execute on function public.csm_insights_overview(integer) to authenticated, service_role;

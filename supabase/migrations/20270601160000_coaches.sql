-- ===========================================================================
-- שלושה מאמני AI: הסוכן/ת (יומי), מנהל/ת הצוות (שבועי) והמשרד (שבועי)
-- ---------------------------------------------------------------------------
-- שלב 6 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 6;
-- docs/coaches.md). ‏office-coach היא עדיין הפונקציה היחידה שקוראת למודל,
-- עם ?kind=agent|team|office, ושלושתם כותבים את אותו חוזה פלט (v2):
-- סיכום, חוזקה, פוקוס ועד שלושה צעדים, שלכל אחד כפתור מרשימה סגורה.
--
-- מה בקובץ:
--   1. ‏_my_dashboard_core(p_agent, p_from, p_to): הגוף של my_dashboard בלי
--      current_agent_id(), כדי שמאמן הסוכן/ת (ב-service_role, בלי משתמש/ת
--      מחובר/ת) יחשב בדיוק את המספרים שהסוכן/ת רואה בדשבורד האישי.
--      ‏my_dashboard() הופכת לעטיפה - אותו דפוס כמו _office_dashboard_core.
--      הגוף הועתק כלשונו מ-20270601130000 (ההגדרה האחרונה).
--   2. ‏actions_done ב-office_coach_summaries, ושתי טבלאות חדשות:
--      ‏team_coach_summaries (שבוע לצוות) ו-agent_coach_summaries (יום לסוכן/ת).
--      קריאה לפי RLS, ואין כתיבה מהדפדפן בכלל - רק הפונקציה, ו"בוצע" דרך
--      coach_action_done.
--   3. ‏team_coach_due() ו-agent_coach_due(): מי מחכה לסיכום.
--   4. ‏coach_action_done(): "סמן כבוצע".
--   5. ‏pg_cron: ‏team-coach ביום ראשון לצד office-coach, ו-agent-coach כל בוקר.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. הדשבורד האישי: גוף ועטיפה
-- ---------------------------------------------------------------------------
create or replace function public._my_dashboard_core(p_agent uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_me     uuid := p_agent;
  v_agency uuid;
  v_name   text;
  v_len    int;
  v_pfrom  date;
  v_pto    date;
  v_m0     date;
  v_n      int;
  v_today  date := (now() at time zone 'Asia/Jerusalem')::date;
  v_result jsonb;
begin
  if v_me is null then
    raise exception 'my_dashboard: no agent' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'my_dashboard: bad period' using errcode = '22023';
  end if;

  select m.agency_id, m.display_name into v_agency, v_name
    from public.agency_members m where m.id = v_me;

  v_len   := (p_to - p_from) + 1;
  v_pto   := p_from - 1;
  v_pfrom := p_from - v_len;
  v_m0    := (date_trunc('month', p_to) - interval '11 months')::date;

  -- הסף של שלושה סוכנים והממוצע עצמו - רק סוכנים פעילים (is_active_agent,
  -- ‏20270601130000). מנהל/ת שאינו/ה עובד/ת כמתווך/ת היה מושך/ת את הממוצע לאפס.
  select count(*) into v_n
    from public.agency_members m where m.agency_id = v_agency and m.active and m.is_active_agent;

  with
  cur  as (select * from public._agent_period_stats(v_agency, p_from, p_to)),
  prev as (select * from public._agent_period_stats(v_agency, v_pfrom, v_pto)),
  mine as (select c.stats from cur c where c.agent_id = v_me),
  mine_prev as (select p.stats from prev p where p.agent_id = v_me),
  tgt as (
    select coalesce(sum(t.commission_target) filter (where t.period_kind = 'quarter'),
                    sum(t.commission_target) filter (where t.period_kind = 'month')) as commission_target
      from public.agent_targets t
     where t.agent_id = v_me
       and t.period_start >= p_from and t.period_start <= p_to
  ),
  -- ממוצע: אגרגט בלבד, משלושה סוכנים ומעלה. זמן התגובה משוקלל לפי מספר
  -- הלידים שנענו, כמו בדאשבורד המשרד.
  avg_row as (
    select jsonb_build_object(
             'agents',     count(*),
             'leads',      round(avg((c.stats->>'leads')::numeric), 1),
             'responded',  round(avg((c.stats->>'responded')::numeric), 1),
             'fast_15',    round(avg((c.stats->>'fast_15')::numeric), 1),
             'meetings',   round(avg((c.stats->>'meetings')::numeric), 1),
             'agreements', round(avg((c.stats->>'agreements')::numeric), 1),
             'recruited',  round(avg((c.stats->>'recruited')::numeric), 1),
             'exclusives', round(avg((c.stats->>'exclusives')::numeric), 1),
             'deals',      round(avg((c.stats->>'deals')::numeric), 1),
             'commission', round(avg((c.stats->>'commission')::numeric)),
             'avg_response_min',
               round(sum((c.stats->>'avg_response_min')::numeric * (c.stats->>'responded')::numeric)
                     / nullif(sum((c.stats->>'responded')::numeric)
                                filter (where c.stats->>'avg_response_min' is not null), 0))
           ) as j
      from cur c
     where c.agent_id in (select m.id from public.agency_members m
                           where m.agency_id = v_agency and m.is_active_agent)
    -- ‏having ולא where: אגרגט בלי שורות עדיין מחזיר שורה אחת (count = 0)
    having v_n >= 3
  ),
  my_leads as (
    select r.*, extract(epoch from (r.responded_at - r.created_at)) / 60.0 as resp_min
      from public._office_lead_rows(v_agency, v_m0, p_to) r
     where r.agent_id = v_me
  ),
  buckets as (
    select case when r.responded_at is null then 6
                when x.resp_min <= 5   then 1
                when x.resp_min <= 15  then 2
                when x.resp_min <= 60  then 3
                when x.resp_min <= 240 then 4
                else 5 end as o,
           (r.agent_id = v_me) as is_me
      from public._office_lead_rows(v_agency, p_from, p_to) r
      cross join lateral (select extract(epoch from (r.responded_at - r.created_at)) / 60.0 as resp_min) x
  ),
  months as (
    select gs::date as m_from, (gs + interval '1 month')::date as m_to
      from generate_series(v_m0::timestamp, date_trunc('month', p_to), interval '1 month') gs
  ),
  md as (select * from public._office_deal_rows(v_agency, v_m0, p_to) d where d.agent_id = v_me),
  mx as (
    select * from public._office_exclusive_rows(v_agency) x
     where x.agent_id = v_me and x.starts_on >= v_m0 and x.starts_on <= p_to
  ),
  monthly as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'month',      to_char(mo.m_from, 'YYYY-MM'),
             'leads',      (select count(*) from my_leads l where l.created_at >= mo.m_from and l.created_at < mo.m_to),
             'responded',  (select count(l.responded_at) from my_leads l where l.created_at >= mo.m_from and l.created_at < mo.m_to),
             'fast_15',    (select count(*) from my_leads l where l.created_at >= mo.m_from and l.created_at < mo.m_to and l.resp_min <= 15),
             'avg_response_min', (select round(avg(l.resp_min)) from my_leads l where l.created_at >= mo.m_from and l.created_at < mo.m_to),
             'recruited',  (select count(*) from public.properties p where p.agency_id = v_agency and p.agent_id = v_me
                              and p.created_at >= mo.m_from and p.created_at < mo.m_to),
             'exclusives', (select count(distinct x.property_id) from mx x where x.starts_on >= mo.m_from and x.starts_on < mo.m_to),
             'agreements', (select count(*) from public.agreements g where g.agent_id = v_me and g.status = 'signed'
                              and g.signed_at >= mo.m_from and g.signed_at < mo.m_to),
             'deals',      (select count(*) from md where md.closed_ts >= mo.m_from and md.closed_ts < mo.m_to),
             'commission', (select coalesce(round(sum(md.commission)), 0) from md where md.closed_ts >= mo.m_from and md.closed_ts < mo.m_to)
           ) order by mo.m_from), '[]'::jsonb) as j
      from months mo
  ),
  -- רצף ימים עם מענה תוך 15 דק׳ לכל הלידים של היום. יום בלי לידים לא
  -- סופר ולא שובר; ליד שעוד בתוך רבע השעה שלו אינו כישלון.
  streak_days as (
    select (l.created_at at time zone 'Asia/Jerusalem')::date as d,
           bool_and(l.first_response_at <= l.created_at + interval '15 minutes'
                    or (l.first_response_at is null and l.created_at > now() - interval '15 minutes')) as ok
      from public.leads l
     where l.agent_id = v_me and l.created_at >= now() - interval '60 days'
     group by 1
  ),
  best_q as (
    select max(q.c) as best
      from (select date_trunc('quarter', d.closed_ts) as q, sum(d.commission) as c
              from public._office_deal_rows(v_agency, (date_trunc('quarter', now()) - interval '2 years')::date, v_today) d
             where d.agent_id = v_me
             group by 1) q
  ),
  todo_leads as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'lead', 'ref_id', l.id, 'created_at', l.created_at,
             'lead_type', l.lead_type, 'city', coalesce(p.city, l.city), 'property', p.title)
             order by l.created_at desc), '[]'::jsonb) as j
      from (select * from public.leads l
             where l.agent_id = v_me
               and l.first_response_at is null
               and l.status = 'unlocked'
               and l.created_at >= now() - interval '30 days'
               and not exists (select 1 from public.lead_archives a where a.lead_id = l.id)
             order by l.created_at desc limit 5) l
      left join public.properties p on p.id = l.property_id
  ),
  todo_excl as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'exclusivity', 'ref_id', p.id, 'property', p.title, 'city', p.city,
             'ends_on', x.ends_on, 'days_on_market', v_today - p.created_at::date,
             'showings', (select count(*) from public.agent_agenda_items a
                           where a.property_id = p.id and a.kind = 'showing' and a.status <> 'canceled'))
             order by x.ends_on), '[]'::jsonb) as j
      from (select distinct on (e.property_id) e.*
              from public._office_exclusive_rows(v_agency) e
             where e.agent_id = v_me and e.active
               and e.ends_on between v_today and v_today + 30
             order by e.property_id, e.ends_on desc) x
      join public.properties p on p.id = x.property_id
     where p.status = 'active'
  ),
  todo_agr as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'agreement', 'ref_id', g.id, 'agreement_kind', g.kind,
             'property', p.title, 'sent_at', g.sent_at, 'viewed', g.viewed_at is not null)
             order by g.sent_at), '[]'::jsonb) as j
      from (select * from public.agreements g
             where g.agent_id = v_me
               and g.status not in ('signed', 'cancelled', 'draft')
               and g.sent_at is not null
             order by g.sent_at limit 5) g
      left join public.properties p on p.id = g.property_ids[1]
  ),
  todo_agenda as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'agenda', 'ref_id', a.id, 'agenda_kind', a.kind, 'title', a.title, 'due_at', a.due_at)
             order by a.due_at), '[]'::jsonb) as j
      from (select * from public.agent_agenda_items a
             where a.agent_id = v_me
               and a.status = 'open'
               and a.due_at < ((v_today + 1)::timestamp at time zone 'Asia/Jerusalem')
             order by a.due_at limit 6) a
  )
  select jsonb_build_object(
    'period',     jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_pfrom, 'prev_to', v_pto),
    'me', coalesce((select m.stats from mine m), '{}'::jsonb) || jsonb_build_object(
            'agent_id',               v_me,
            'agent',                  v_name,
            'first_name',             split_part(trim(coalesce(v_name, '')), ' ', 1),
            'leads_prev',             (select p.stats -> 'leads'            from mine_prev p),
            'responded_prev',         (select p.stats -> 'responded'        from mine_prev p),
            'fast_15_prev',           (select p.stats -> 'fast_15'          from mine_prev p),
            'meetings_prev',          (select p.stats -> 'meetings'         from mine_prev p),
            'recruited_prev',         (select p.stats -> 'recruited'        from mine_prev p),
            'exclusives_prev',        (select p.stats -> 'exclusives'       from mine_prev p),
            'agreements_prev',        (select p.stats -> 'agreements'       from mine_prev p),
            'deals_prev',             (select p.stats -> 'deals'            from mine_prev p),
            'commission_prev',        (select p.stats -> 'commission'       from mine_prev p),
            'avg_response_min_prev',  (select p.stats -> 'avg_response_min' from mine_prev p),
            'commission_target',      (select t.commission_target from tgt t),
            'open_unanswered',        (select count(*) from public.leads l
                                        where l.agent_id = v_me and l.first_response_at is null
                                          and l.created_at > now() - interval '30 days'
                                          and l.created_at < now() - interval '1 hour'),
            'active_listings',        (select count(*) from public.properties p
                                        where p.agent_id = v_me and p.status = 'active'),
            'fast_streak_days',       (select count(*) from streak_days s
                                        where s.d > coalesce((select max(s2.d) from streak_days s2 where not s2.ok), date '1900-01-01')),
            'best_quarter_commission', (select coalesce(round(b.best), 0) from best_q b)
          ),
    'office_avg',     (select a.j from avg_row a),
    'office_agents',  v_n,
    'my_buckets',     (select coalesce(jsonb_agg(jsonb_build_object('bucket_order', x.o, 'leads', x.n) order by x.o), '[]'::jsonb)
                         from (select b.o, count(*) as n from buckets b where b.is_me group by 1) x),
    'office_buckets', case when v_n >= 3 then
                        (select coalesce(jsonb_agg(jsonb_build_object('bucket_order', x.o, 'share', round(x.n::numeric / nullif(x.t, 0), 4)) order by x.o), '[]'::jsonb)
                           from (select b.o, count(*) as n, sum(count(*)) over () as t from buckets b group by 1) x)
                      end,
    'my_monthly',     (select m.j from monthly m),
    'todo', jsonb_build_object(
              'leads',       (select j from todo_leads),
              'exclusivity', (select j from todo_excl),
              'agreements',  (select j from todo_agr),
              'agenda',      (select j from todo_agenda)),
    'data_notes', jsonb_build_object('response_time_method', 'first_response_at',
                                     'commission_method', 'estimate',
                                     'office_avg_min_agents', 3)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public._my_dashboard_core(uuid, date, date) from public, anon, authenticated;
grant execute on function public._my_dashboard_core(uuid, date, date) to service_role;
comment on function public._my_dashboard_core(uuid, date, date) is
  'גוף הדשבורד האישי לסוכן/ת נתון/ה, בלי בדיקת זהות. ל-service_role בלבד (מאמן הסוכן/ת) ולעטיפה my_dashboard(). docs/coaches.md';

-- העטיפה: אותה חתימה, אותה הרשאה. ‏security definer כמו קודם - הממוצע של
-- המשרד נקרא משורות של סוכנים אחרים, ו-RLS חוסם אותן מהסוכן/ת.
create or replace function public.my_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_agent_id();
begin
  if v_me is null then
    raise exception 'my_dashboard: no agent' using errcode = '42501';
  end if;
  return public._my_dashboard_core(v_me, p_from, p_to);
end;
$$;
revoke all on function public.my_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.my_dashboard(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. הטבלאות
-- ---------------------------------------------------------------------------
-- "סמן כבוצע": האינדקסים (0-2) של הצעדים שסומנו. ‏smallint[] ולא jsonb,
-- כי זה כל המידע, ו-coach_action_done מעדכנת אותו בלי לגעת בסיכום עצמו.
alter table public.office_coach_summaries
  add column if not exists actions_done smallint[] not null default '{}';

create table if not exists public.team_coach_summaries (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  team_id       uuid not null references public.agency_teams (id) on delete cascade,
  week_start    date not null,
  -- חוזה v2 (docs/coaches.md), אחרי cleanSummaryV2
  summary       jsonb not null,
  model         text,
  input_tokens  int,
  output_tokens int,
  actions_done  smallint[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (team_id, week_start)
);
comment on table public.team_coach_summaries is
  'סיכום שבועי של מאמן מנהלי הצוותים (office-coach?kind=team). נכתב ב-service_role בלבד; מנהל/ת הצוות ומנהלי המשרד קוראים. docs/coaches.md';

alter table public.team_coach_summaries enable row level security;
drop policy if exists "team lead and managers read team coach" on public.team_coach_summaries;
create policy "team lead and managers read team coach" on public.team_coach_summaries
  for select to authenticated
  using (
    team_id = (select public.current_led_team_id())
    or ((select public.current_member_role()) = 'manager'
        and agency_id = (select public.current_agency_id()))
  );
revoke all on public.team_coach_summaries from anon, authenticated;
grant select on public.team_coach_summaries to authenticated;

create table if not exists public.agent_coach_summaries (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  agent_id      uuid not null references public.agency_members (id) on delete cascade,
  day           date not null,
  summary       jsonb not null,
  -- טביעת אצבע של הקלט: יום שבו לא השתנה דבר מאתמול מעתיק את הסיכום בלי
  -- קריאה למודל (model = 'copy', ‏0 טוקנים)
  input_hash    text,
  model         text,
  input_tokens  int,
  output_tokens int,
  actions_done  smallint[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (agent_id, day)
);
comment on table public.agent_coach_summaries is
  'סיכום יומי של מאמן הסוכנים (office-coach?kind=agent). נכתב ב-service_role בלבד; רק הסוכן/ת עצמו/ה קורא/ת - לא מנהלים. docs/coaches.md';

alter table public.agent_coach_summaries enable row level security;
-- פרטיות כמו בדשבורד האישי: מנהל/ת המשרד **לא** קורא/ת את זה
drop policy if exists "agent reads own coach" on public.agent_coach_summaries;
create policy "agent reads own coach" on public.agent_coach_summaries
  for select to authenticated
  using (agent_id = (select public.current_agent_id()));
revoke all on public.agent_coach_summaries from anon, authenticated;
grant select on public.agent_coach_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- 3. מי מחכה לסיכום
-- ---------------------------------------------------------------------------
-- היום בשעון ישראל, ליום של מאמן הסוכן/ת
create or replace function public.coach_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;
revoke all on function public.coach_today() from public, anon, authenticated;
grant execute on function public.coach_today() to service_role;

-- צוותים: יש מנהל/ת צוות פעיל/ה, יש בצוות סוכן/ת פעיל/ה, הייתה תנועה של
-- סוכני הצוות ב-30 הימים האחרונים, ועוד אין סיכום לשבוע הזה.
create or replace function public.team_coach_due(p_limit int default 25)
returns table (team_id uuid, agency_id uuid, team_name text, week_start date)
language sql
stable
set search_path = ''
as $$
  select t.id, t.agency_id, t.name, public.office_coach_week_start()
    from public.agency_teams t
    join public.agency_members l on l.id = t.lead_member_id and l.active
   where exists (select 1 from public.agency_members m
                  where m.team_id = t.id and m.active and m.is_active_agent)
     and (exists (select 1 from public.leads x
                   join public.agency_members m on m.id = x.agent_id
                  where m.team_id = t.id and x.created_at > now() - interval '30 days')
          or exists (select 1 from public.properties p
                      join public.agency_members m on m.id = p.agent_id
                     where m.team_id = t.id and p.updated_at > now() - interval '30 days'))
     and not exists (select 1 from public.team_coach_summaries s
                      where s.team_id = t.id and s.week_start = public.office_coach_week_start())
   order by t.id
   limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;
revoke all on function public.team_coach_due(int) from public, anon, authenticated;
grant execute on function public.team_coach_due(int) to service_role;

-- סוכנים: חשבון פעיל ומחובר, סוכן/ת פעיל/ה (לא מנהל/ת בלבד), תנועה ב-14
-- הימים האחרונים, ועוד אין סיכום להיום. כל שורה כאן היא קריאה למודל בכל
-- בוקר, ולכן הסינון הזה הוא כל בקרת העלות.
create or replace function public.agent_coach_due(p_limit int default 25)
returns table (agent_id uuid, agency_id uuid)
language sql
stable
set search_path = ''
as $$
  select m.id, m.agency_id
    from public.agency_members m
   where m.active and m.is_active_agent
     and m.user_id is not null and m.released_at is null and m.agency_id is not null
     and (exists (select 1 from public.leads l
                   where l.agent_id = m.id and l.created_at > now() - interval '14 days')
          or exists (select 1 from public.properties p
                      where p.agent_id = m.id and p.updated_at > now() - interval '14 days')
          or exists (select 1 from public.agent_agenda_items a
                      where a.agent_id = m.id and a.updated_at > now() - interval '14 days'))
     and not exists (select 1 from public.agent_coach_summaries s
                      where s.agent_id = m.id and s.day = public.coach_today())
   order by m.id
   limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;
revoke all on function public.agent_coach_due(int) from public, anon, authenticated;
grant execute on function public.agent_coach_due(int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. "סמן כבוצע"
-- ---------------------------------------------------------------------------
-- אותם תנאים של ה-RLS על כל טבלה, ובנוסף: רק actions_done משתנה. מחזירה את
-- המערך החדש; שורה שאינה של הקורא/ת היא 42501 (ולא 0 שורות בשקט).
create or replace function public.coach_action_done(p_kind text, p_summary_id uuid, p_index int, p_done boolean)
returns smallint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out smallint[];
  v_i   smallint;
begin
  if p_index is null or p_index not between 0 and 2 then
    raise exception 'coach_action_done: bad index' using errcode = '22023';
  end if;
  v_i := p_index::smallint;

  if p_kind = 'agent' then
    update public.agent_coach_summaries s
       set actions_done = case when coalesce(p_done, false)
                               then array(select distinct x from unnest(s.actions_done || v_i) x order by x)
                               else array_remove(s.actions_done, v_i) end
     where s.id = p_summary_id and s.agent_id = public.current_agent_id()
    returning s.actions_done into v_out;
  elsif p_kind = 'team' then
    update public.team_coach_summaries s
       set actions_done = case when coalesce(p_done, false)
                               then array(select distinct x from unnest(s.actions_done || v_i) x order by x)
                               else array_remove(s.actions_done, v_i) end
     where s.id = p_summary_id
       and (s.team_id = public.current_led_team_id()
            or (public.current_member_role() = 'manager' and s.agency_id = public.current_agency_id()))
    returning s.actions_done into v_out;
  elsif p_kind = 'office' then
    update public.office_coach_summaries s
       set actions_done = case when coalesce(p_done, false)
                               then array(select distinct x from unnest(s.actions_done || v_i) x order by x)
                               else array_remove(s.actions_done, v_i) end
     where s.id = p_summary_id
       and public.current_member_role() = 'manager' and s.agency_id = public.current_agency_id()
    returning s.actions_done into v_out;
  else
    raise exception 'coach_action_done: bad kind' using errcode = '22023';
  end if;

  if v_out is null then
    raise exception 'coach_action_done: not allowed' using errcode = '42501';
  end if;
  return v_out;
end;
$$;
revoke all on function public.coach_action_done(text, uuid, int, boolean) from public, anon, authenticated;
grant execute on function public.coach_action_done(text, uuid, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. התזמון
-- ---------------------------------------------------------------------------
-- ‏team-coach: באותן שעות של office-coach (יום ראשון, 05:10-09:10 UTC), עם
-- ‏?kind=team. ‏agent-coach: כל בוקר 03:10-05:10 UTC (‏06:10-08:10 בקיץ),
-- שלוש הרצות כי Edge Function נעצרת אחרי 150 שניות. בשתיהן: אין עבודה - אין
-- קריאה. מאמן הסוכן/ת כבוי עד שמדליקים את AGENT_COACH_ENABLED בפונקציה, ועד
-- אז ההרצה של הבוקר מחזירה disabled בלי לקרוא למודל.
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/office-coach';
  v_cmd text := $cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 120000
    )
    where exists (select 1 from public.%s(1));
  $cron$;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - יש לתזמן את team-coach ו-agent-coach בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('team-coach')
    where exists (select 1 from cron.job where jobname = 'team-coach');
  perform cron.schedule('team-coach', '10 5-9 * * 0',
    format(v_cmd, v_url || '?kind=team', 'team_coach_due'));

  perform cron.unschedule('agent-coach')
    where exists (select 1 from cron.job where jobname = 'agent-coach');
  perform cron.schedule('agent-coach', '10 3-5 * * *',
    format(v_cmd, v_url || '?kind=agent', 'agent_coach_due'));
end;
$$;

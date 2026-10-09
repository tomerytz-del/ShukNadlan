-- ===========================================================================
-- הדשבורד שלי — דשבורד אישי לכל סוכן/ת (accMyDashboard)
-- ---------------------------------------------------------------------------
-- "דוחות וביצועים" הציג לסוכן/ת גרף אחד: פוטנציאל העמלות. הדשבורד האישי
-- עונה על השאלות שעוזרות לגדול: מה לעשות היום, איפה אני חזק/ה, איפה יש מקום
-- לצמוח מול ממוצע המשרד, ומה כבר השגתי. ‏docs/my-dashboard.md
--
-- ‏my_dashboard(p_from, p_to) — security definer, ועובדת **רק על
-- current_agent_id()**. אין לה פרמטר של סוכן/ת, ולכן אין דרך לבקש בה נתונים
-- של מישהו/י אחר/ת. המספרים האישיים מגיעים מ-_agent_period_stats, אותה
-- פונקציה שמזינה את דאשבורד המשרד (20270404090000): שני הדאשבורדים מציגים
-- תמיד אותם מספרים לאותו/ה סוכן/ת.
--
-- **ממוצע המשרד הוא אגרגט בלבד, ורק משלושה סוכנים פעילים ומעלה.** במשרד של
-- שניים, ממוצע ועוד המספר שלי הם המספר של העמית/ה. אז office_avg ו-
-- office_buckets חוזרים null, והממשק משווה לתקופה הקודמת שלי במקום.
--
-- ‏todo[] — משימות אמיתיות מהמערכת, כל אחת עם המזהה שלה, כדי שהכפתור יפתח
-- את הפריט עצמו ולא קטגוריה: לידים בלי מענה, בלעדיות שפוקעת, הסכם שנשלח ולא
-- נחתם, ומה שפתוח ביומן להיום או באיחור. אין בהן שם או טלפון של פונה: ליד
-- מתואר לפי סוגו, העיר והנכס.
--
-- המיגרציה מוסיפה פונקציה בלבד. היא אידמפוטנטית.
-- ===========================================================================

create or replace function public.my_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := public.current_agent_id();
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
    raise exception 'my_dashboard: no agent' using errcode = '42501';
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

  select count(*) into v_n
    from public.agency_members m where m.agency_id = v_agency and m.active;

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

revoke all on function public.my_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.my_dashboard(date, date) to authenticated;

comment on function public.my_dashboard(date, date) is
  'הדשבורד האישי של הסוכן/ת המחובר/ת (current_agent_id בלבד, בלי פרמטר סוכן/ת): המדדים מ-_agent_period_stats מול התקופה הקודמת, ממוצע המשרד כאגרגט משלושה סוכנים ומעלה, 12 חודשים, רצף מענה מהיר, שיא רבעוני ומשימות להיום עם מזהי הפריטים. docs/my-dashboard.md';

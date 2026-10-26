-- ===========================================================================
-- ההסכמה לפעולות שיווק אינה נספרת כהסכם נוסף
--
-- מאז 20270829090000 כל בלעדיות היא שני הסכמים: marketing_sell/landlord
-- ואחריו exclusive_*. שניהם שורות ב-agreements, ולכן כל ספירה של "הסכמים
-- שנחתמו" ספרה בלעדיות פעמיים - בדאשבורד המשרד, בצוות, בדשבורד האישי
-- ובמאמני ה-AI (שקוראים את אותה ליבה). כאן שלוש הפונקציות שסופרות, כל אחת
-- העתק מלא מהמיגרציה האחרונה שהגדירה אותה, עם שורה אחת:
--   kind not in ('marketing_sell', 'marketing_landlord')
--
--   • _agent_period_stats      - מ-20270404090000 (המדד לכל סוכן/ת)
--   • _my_dashboard_core       - מ-20270601160000 (הגרף החודשי ו"ממתין לחתימה")
--   • _office_dashboard_core   - מ-20270601150000 (הגרף החודשי; העטיפה בת 3
--                                 הפרמטרים קוראת לגרסה הזו)
--
-- ומשימת "המשך טיפול אחרי חתימה" ביומן נוצרת על הבלעדיות בלבד - אחרת שתי
-- משימות לאותה בלעדיות.
-- ===========================================================================

create or replace function public._agent_period_stats(p_agency uuid, p_from date, p_to date)
returns table (agent_id uuid, stats jsonb)
language sql
stable
set search_path = ''
as $$
  with
  team as (
    select m.id from public.agency_members m where m.agency_id = p_agency and m.active
  ),
  lr as (
    select r.agent_id, r.responded_at,
           extract(epoch from (r.responded_at - r.created_at)) / 60.0 as resp_min
      from public._office_lead_rows(p_agency, p_from, p_to) r
  ),
  l as (
    select lr.agent_id,
           count(*)                                 as leads,
           count(lr.responded_at)                   as responded,
           count(*) filter (where lr.resp_min <= 15) as fast_15,
           round(avg(lr.resp_min))                  as avg_min,
           round((percentile_cont(0.5) within group (order by lr.resp_min))::numeric) as median_min
      from lr group by 1
  ),
  d as (
    select dr.agent_id, count(*) as deals, coalesce(round(sum(dr.commission)), 0) as commission
      from public._office_deal_rows(p_agency, p_from, p_to) dr group by 1
  ),
  ex as (
    select x.agent_id, count(distinct x.property_id) as n
      from public._office_exclusive_rows(p_agency) x
     where x.starts_on >= p_from and x.starts_on <= p_to
     group by 1
  ),
  ag as (
    select g.agent_id,
           count(*) as n,
           count(*) filter (where g.kind in ('sell', 'landlord', 'exclusive_sell', 'exclusive_landlord')) as sell,
           count(*) filter (where g.kind in ('buy', 'tenant')) as buy
      from public.agreements g
     where g.agency_id = p_agency
       and g.status = 'signed'
       -- ההסכמה לפעולות שיווק היא חלק מהבלעדיות, לא הסכם נוסף
       and g.kind not in ('marketing_sell', 'marketing_landlord')
       and g.signed_at >= p_from and g.signed_at < p_to + 1
     group by 1
  ),
  cal as (
    select a.agent_id,
           count(*) as meetings,
           count(*) filter (where a.kind = 'showing') as showings
      from public.agent_agenda_items a
     where a.agent_id in (select id from team)
       and a.kind in ('meeting', 'showing')
       and a.status <> 'canceled'
       and a.due_at >= p_from and a.due_at < p_to + 1
     group by 1
  ),
  calls as (
    select c.agent_id,
           count(*) filter (where c.direction = 'inbound') as inbound,
           count(*) filter (where c.direction = 'inbound' and c.status is distinct from 'answered') as missed
      from public.agent_calls c
     where c.agent_id in (select id from team)
       and c.created_at >= p_from and c.created_at < p_to + 1
     group by 1
  ),
  rec as (
    select p.agent_id, count(*) as n
      from public.properties p
     where p.agency_id = p_agency
       and p.created_at >= p_from and p.created_at < p_to + 1
     group by 1
  )
  select t.id,
         jsonb_build_object(
           'leads',               coalesce(l.leads, 0),
           'responded',           coalesce(l.responded, 0),
           'fast_15',             coalesce(l.fast_15, 0),
           'avg_response_min',    l.avg_min,
           'median_response_min', l.median_min,
           'recruited',           coalesce(rec.n, 0),
           'exclusives',          coalesce(ex.n, 0),
           'agreements',          coalesce(ag.n, 0),
           'agreements_sell',     coalesce(ag.sell, 0),
           'agreements_buy',      coalesce(ag.buy, 0),
           'meetings',            coalesce(cal.meetings, 0),
           'showings',            coalesce(cal.showings, 0),
           'deals',               coalesce(d.deals, 0),
           'commission',          coalesce(d.commission, 0),
           'calls_in',            coalesce(calls.inbound, 0),
           'calls_missed',        coalesce(calls.missed, 0)
         )
    from team t
    left join l     on l.agent_id     = t.id
    left join d     on d.agent_id     = t.id
    left join ex    on ex.agent_id    = t.id
    left join ag    on ag.agent_id    = t.id
    left join cal   on cal.agent_id   = t.id
    left join calls on calls.agent_id = t.id
    left join rec   on rec.agent_id   = t.id;
$$;

revoke all on function public._agent_period_stats(uuid, date, date)    from public, anon, authenticated;

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
                              and g.kind not in ('marketing_sell', 'marketing_landlord')
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
               -- הבלעדיות מייצגת את שני הטפסים; ההסכמה שלפניה אינה משימה נוספת
               and g.kind not in ('marketing_sell', 'marketing_landlord')
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

create or replace function public._office_dashboard_core(p_agency uuid, p_from date, p_to date, p_agent_ids uuid[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_agency uuid := p_agency;
  v_len    int;
  v_pfrom  date;
  v_pto    date;
  v_m0     date;
  v_result jsonb;
begin
  if v_agency is null then
    raise exception 'office_dashboard: no agency' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'office_dashboard: bad period' using errcode = '22023';
  end if;

  v_len   := (p_to - p_from) + 1;
  v_pto   := p_from - 1;
  v_pfrom := p_from - v_len;
  v_m0    := (date_trunc('month', p_to) - interval '11 months')::date;

  with
  members as (
    select m.id, m.display_name, m.role, m.photo_url, m.created_at, m.team_id
      from public.agency_members m
     where m.agency_id = v_agency and m.active
       and (p_agent_ids is null or m.id = any(p_agent_ids))
  ),
  cur  as (select * from public._agent_period_stats(v_agency, p_from, p_to)),
  prev as (select * from public._agent_period_stats(v_agency, v_pfrom, v_pto)),
  -- יעד לתקופה: יעדים רבעוניים שמתחילים בתוכה, ואם אין — חודשיים
  tgt as (
    select t.agent_id,
           coalesce(sum(t.commission_target) filter (where t.period_kind = 'quarter'),
                    sum(t.commission_target) filter (where t.period_kind = 'month')) as commission_target,
           coalesce(sum(t.deals_target)      filter (where t.period_kind = 'quarter'),
                    sum(t.deals_target)      filter (where t.period_kind = 'month')) as deals_target,
           coalesce(sum(t.recruited_target)  filter (where t.period_kind = 'quarter'),
                    sum(t.recruited_target)  filter (where t.period_kind = 'month')) as recruited_target
      from public.agent_targets t
     where t.agency_id = v_agency
       and t.period_start >= p_from and t.period_start <= p_to
     group by 1
  ),
  -- לידים פתוחים בלי תגובה: 30 הימים האחרונים, ותיקים משעה
  unanswered as (
    select r.agent_id, count(*) as n
      from public._office_lead_rows(v_agency, current_date - 30, current_date) r
     where r.responded_at is null
       and r.created_at < now() - interval '1 hour'
     group by 1
  ),
  listings as (
    select p.agent_id, count(*) as n
      from public.properties p
     where p.agency_id = v_agency and p.status = 'active'
     group by 1
  ),
  agents_json as (
    select coalesce(jsonb_agg(
             c.stats || jsonb_build_object(
               'agent_id',              m.id,
               'agent',                 coalesce(nullif(m.display_name, ''), 'ללא שם'),
               'role',                  m.role,
               'photo_url',             m.photo_url,
               'leads_prev',            p.stats -> 'leads',
               'recruited_prev',        p.stats -> 'recruited',
               'exclusives_prev',       p.stats -> 'exclusives',
               'agreements_prev',       p.stats -> 'agreements',
               'deals_prev',            p.stats -> 'deals',
               'commission_prev',       p.stats -> 'commission',
               'avg_response_min_prev', p.stats -> 'avg_response_min',
               'fast_15_prev',          p.stats -> 'fast_15',
               'commission_target',     t.commission_target,
               'deals_target',          t.deals_target,
               'recruited_target',      t.recruited_target,
               'open_unanswered',       coalesce(u.n, 0),
               'active_listings',       coalesce(l.n, 0),
               'team_id',               m.team_id
             ) order by m.display_name), '[]'::jsonb) as j
      from members m
      join cur c on c.agent_id = m.id
      left join prev p on p.agent_id = m.id
      left join tgt t on t.agent_id = m.id
      left join unanswered u on u.agent_id = m.id
      left join listings l on l.agent_id = m.id
  ),
  -- התפלגות זמני התגובה בתקופה, לפי סוכן/ת
  buckets_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'agent_id', b.agent_id, 'bucket_order', b.o, 'leads', b.n)
             order by b.agent_id, b.o), '[]'::jsonb) as j
      from (
        select r.agent_id,
               case when r.responded_at is null then 6
                    when r.responded_at <= r.created_at + interval '5 minutes'  then 1
                    when r.responded_at <= r.created_at + interval '15 minutes' then 2
                    when r.responded_at <= r.created_at + interval '1 hour'     then 3
                    when r.responded_at <= r.created_at + interval '4 hours'    then 4
                    else 5 end as o,
               count(*) as n
          from public._office_lead_rows(v_agency, p_from, p_to) r
         where r.agent_id in (select id from members)
         group by 1, 2
      ) b
  ),
  -- 12 חודשים שנגמרים בחודש של p_to, לכל סוכן/ת
  months as (
    select gs::date as m_from, (gs + interval '1 month')::date as m_to
      from generate_series(v_m0::timestamp, date_trunc('month', p_to), interval '1 month') gs
  ),
  -- כל מקור מסוכם לפי (סוכן/ת, חודש) פעם אחת, ואז מצורף לרשת החודשים
  mm as (
    select x.agent_id, x.m, sum(x.leads) as leads, sum(x.recruited) as recruited, sum(x.exclusives) as exclusives,
           sum(x.agreements) as agreements, sum(x.deals) as deals, sum(x.commission) as commission
      from (
        select r.agent_id, date_trunc('month', r.created_at)::date as m,
               1 as leads, 0 as recruited, 0 as exclusives, 0 as agreements, 0 as deals, 0::numeric as commission
          from public._office_lead_rows(v_agency, v_m0, p_to) r
        union all
        select p.agent_id, date_trunc('month', p.created_at)::date, 0, 1, 0, 0, 0, 0
          from public.properties p
         where p.agency_id = v_agency and p.created_at >= v_m0 and p.created_at < p_to + 1
        union all
        select e.agent_id, date_trunc('month', e.starts_on)::date, 0, 0, count(distinct e.property_id), 0, 0, 0
          from public._office_exclusive_rows(v_agency) e
         where e.starts_on >= v_m0 and e.starts_on <= p_to
         group by 1, 2
        union all
        select g.agent_id, date_trunc('month', g.signed_at)::date, 0, 0, 0, 1, 0, 0
          from public.agreements g
         where g.agency_id = v_agency and g.status = 'signed'
           and g.kind not in ('marketing_sell', 'marketing_landlord')
           and g.signed_at >= v_m0 and g.signed_at < p_to + 1
        union all
        select dr.agent_id, date_trunc('month', dr.closed_ts)::date, 0, 0, 0, 0, 1, dr.commission
          from public._office_deal_rows(v_agency, v_m0, p_to) dr
      ) x
     group by 1, 2
  ),
  monthly_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'month',      to_char(mo.m_from, 'YYYY-MM'),
             'agent_id',   m.id,
             'leads',      coalesce(mm.leads, 0),
             'recruited',  coalesce(mm.recruited, 0),
             'exclusives', coalesce(mm.exclusives, 0),
             'agreements', coalesce(mm.agreements, 0),
             'deals',      coalesce(mm.deals, 0),
             'commission', coalesce(round(mm.commission), 0)
           ) order by mo.m_from, m.display_name), '[]'::jsonb) as j
      from months mo
      cross join members m
      left join mm on mm.agent_id = m.id and mm.m = mo.m_from
  ),
  -- מקורות: הערוץ לפי lead_source_channel() — אותו מיפוי כמו דוח הלידים של
  -- הפלטפורמה, בלי מיפוי שני. "פגישות" = לידים שנפתחה עליהם פגישה או סיור.
  sources_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'source', s.channel, 'leads', s.n, 'responded', s.responded, 'meetings', s.meetings)
             order by s.n desc), '[]'::jsonb) as j
      from (
        select public.lead_source_channel(r.source) as channel,
               count(*) as n,
               count(*) filter (where r.responded_at is not null) as responded,
               count(*) filter (where exists (
                 select 1 from public.agent_agenda_items a
                  where a.lead_id = r.lead_id and a.kind in ('meeting', 'showing') and a.status <> 'canceled')) as meetings
          from public._office_lead_rows(v_agency, p_from, p_to) r
         where p_agent_ids is null or r.agent_id = any(p_agent_ids)
         group by 1
      ) s
  ),
  -- הצוותים (20270601150000): אגרגט לכל צוות במשרד - רק בתצוגת המשרד כולו.
  -- בדאשבורד הצוות (p_agent_ids לא null) המערך ריק: מנהל/ת צוות מקבל/ת על
  -- שאר הצוותים שם ואחוז בלבד (teams_progress ב-team_dashboard), לא את
  -- המספרים שלהם.
  teams_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'team_id',          t.id,
             'name',             t.name,
             'lead_member_id',   t.lead_member_id,
             'lead',             (select lm.display_name from public.agency_members lm where lm.id = t.lead_member_id),
             'agents',           x.agents,
             'commission',       x.commission,
             'deals',            x.deals,
             'leads',            x.leads,
             'recruited',        x.recruited,
             'exclusives',       x.exclusives,
             'avg_response_min', x.avg_response_min,
             'commission_target', x.target,
             'commission_in_target', x.done
           ) order by t.name), '[]'::jsonb) as j
      from public.agency_teams t
      cross join lateral (
        select count(m.id) as agents,
               coalesce(round(sum((c.stats->>'commission')::numeric)), 0) as commission,
               coalesce(sum((c.stats->>'deals')::numeric), 0) as deals,
               coalesce(sum((c.stats->>'leads')::numeric), 0) as leads,
               coalesce(sum((c.stats->>'recruited')::numeric), 0) as recruited,
               coalesce(sum((c.stats->>'exclusives')::numeric), 0) as exclusives,
               -- משוקלל לפי הלידים שנענו, כמו ממוצע המשרד
               round(sum((c.stats->>'avg_response_min')::numeric * (c.stats->>'responded')::numeric)
                     / nullif(sum((c.stats->>'responded')::numeric)
                                filter (where c.stats->>'avg_response_min' is not null), 0)) as avg_response_min,
               sum(tg.commission_target) as target,
               coalesce(round(sum((c.stats->>'commission')::numeric) filter (where tg.commission_target is not null)), 0) as done
          from members m
          left join cur c on c.agent_id = m.id
          left join tgt tg on tg.agent_id = m.id
         where m.team_id = t.id
      ) x
     where t.agency_id = v_agency and p_agent_ids is null
  ),
  expiring_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'property_id',     p.id,
             'property',        p.title,
             'city',            p.city,
             'agent_id',        x.agent_id,
             'exclusivity_end', x.ends_on,
             'asking_price',    p.price,
             'days_on_market',  current_date - p.created_at::date,
             'showings',        (select count(*) from public.agent_agenda_items a
                                  where a.property_id = p.id and a.kind = 'showing' and a.status <> 'canceled')
           ) order by x.ends_on), '[]'::jsonb) as j
      from (
        select distinct on (e.property_id) e.*
          from public._office_exclusive_rows(v_agency) e
         where e.active and e.ends_on between current_date and current_date + 30
         order by e.property_id, e.ends_on desc
      ) x
      join public.properties p on p.id = x.property_id
     where p.status = 'active'
       and (p_agent_ids is null or x.agent_id = any(p_agent_ids))
  )
  select jsonb_build_object(
           'period',           jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_pfrom, 'prev_to', v_pto),
           'office',           (select jsonb_build_object('id', a.id, 'name', a.name, 'logo_url', a.logo_url)
                                  from public.agencies a where a.id = v_agency),
           'agents',           (select j from agents_json),
           'response_buckets', (select j from buckets_json),
           'monthly',          (select j from monthly_json),
           'lead_sources',     (select j from sources_json),
           'expiring',         (select j from expiring_json),
           'teams',            (select j from teams_json),
           'data_notes',       jsonb_build_object('response_time_method', 'first_response_at',
                                                  'commission_method', 'estimate',
                                                  'commission_sale_rate', 0.02)
         )
    into v_result;

  return v_result;
end;
$$;

revoke all on function public._office_dashboard_core(uuid, date, date, uuid[]) from public, anon, authenticated;
grant execute on function public._office_dashboard_core(uuid, date, date, uuid[]) to service_role;

drop trigger if exists agreements_agenda_signed on public.agreements;
create trigger agreements_agenda_signed
  after update of status on public.agreements
  for each row when (new.status = 'signed' and old.status is distinct from 'signed'
                     and new.kind not in ('marketing_sell', 'marketing_landlord'))
  execute function public.agent_agenda_on_agreement_signed();

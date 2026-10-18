-- ============================================================================
-- דאשבורד המשרד: הצוותים (docs/office-dashboard.md, "צוותים")
-- ----------------------------------------------------------------------------
-- שלב 5 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 5). תלוי ב-
-- 20270601130000 (agency_teams, team_id) וב-20270601140000 (הליבה בת 4
-- הפרמטרים).
--
-- שני שינויים בליבה, והיא נשארת עותק אחד (הגרסה בת 3 הפרמטרים היא עדיין
-- העטיפה מ-20270601140000):
--   • ‏team_id לכל סוכן/ת ב-agents - כדי שהדאשבורד יוכל לסנן לפי צוות.
--   • ‏teams - אגרגט לכל צוות: מנהל/ת, סוכנים, עמלות, עסקאות, לידים, גיוסים,
--     בלעדיות, זמן תגובה ועמידה ביעד. **רק כש-p_agent_ids הוא null** (המשרד
--     כולו): דאשבורד הצוות לא מקבל את המספרים של צוותים אחרים.
--
-- הגוף מ-20270601140000_team_dashboard.sql, עם השינויים האלה בלבד.
-- ============================================================================

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

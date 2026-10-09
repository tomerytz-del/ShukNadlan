-- ===========================================================================
-- מאמן ה-AI השבועי לדאשבורד המשרד ("סיכום השבוע")
-- ---------------------------------------------------------------------------
-- פעם בשבוע, ביום ראשון בבוקר, כל משרד פעיל מקבל סיכום של שלוש נקודות:
-- מה עבד, מה תקוע, ועל מה כדאי לשים את השבוע. ה-Edge Function
-- ‏office-coach מחשבת את מספרי המשרד, שולחת ל-Claude **אגרגטים בלבד** (בלי
-- שם, טלפון או טקסט של פונה), ושומרת את התשובה כאן. הדאשבורד מציג אותה
-- ככרטיס "סיכום השבוע". ‏docs/office-coach.md
--
-- **פעם בשבוע ולא בכל טעינה.** סיכום בכל פתיחה של הדאשבורד היה קריאה למודל
-- על כל רענון; שבועי הוא קריאה אחת למשרד לשבוע, והמספרים שהוא מסכם ממילא
-- זזים בקצב של ימים.
--
-- מה בקובץ:
--   1. ‏_office_dashboard_core(p_agency, p_from, p_to) — גוף הדאשבורד בלי
--      בדיקת התפקיד, כדי שה-cron (בלי משתמש/ת מחובר/ת) יחשב בדיוק את אותם
--      מספרים. ‏office_dashboard() הופכת לעטיפה: בודקת שהקורא/ת מנהל/ת
--      ומעבירה את המשרד שלו/ה. הרשאה ל-service_role בלבד.
--   2. ‏office_coach_summaries — סיכום אחד למשרד לשבוע. מנהלי המשרד קוראים
--      (RLS), ואיש לא כותב מהדפדפן: רק ה-Edge Function, ב-service_role.
--   3. ‏office_coach_due() — המשרדים שצריכים סיכום השבוע: יש מנהל/ת פעיל/ה,
--      הייתה פעילות ב-30 הימים האחרונים, ועוד אין סיכום לשבוע הנוכחי.
--   4. ‏cron שבועי.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. גוף הדאשבורד, ועטיפת המנהל/ת
-- ---------------------------------------------------------------------------
create or replace function public._office_dashboard_core(p_agency uuid, p_from date, p_to date)
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
    select m.id, m.display_name, m.role, m.photo_url, m.created_at
      from public.agency_members m
     where m.agency_id = v_agency and m.active
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
               'active_listings',       coalesce(l.n, 0)
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
         group by 1
      ) s
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
           'data_notes',       jsonb_build_object('response_time_method', 'first_response_at',
                                                  'commission_method', 'estimate',
                                                  'commission_sale_rate', 0.02)
         )
    into v_result;

  return v_result;
end;
$$;

revoke all on function public._office_dashboard_core(uuid, date, date) from public, anon, authenticated;
grant execute on function public._office_dashboard_core(uuid, date, date) to service_role;

comment on function public._office_dashboard_core(uuid, date, date) is
  'גוף דאשבורד המשרד למשרד נתון, בלי בדיקת תפקיד. ל-service_role בלבד (office-coach) ולעטיפה office_dashboard(). docs/office-coach.md';

create or replace function public.office_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if public.current_member_role() is distinct from 'manager' or v_agency is null then
    raise exception 'office_dashboard: managers only' using errcode = '42501';
  end if;
  return public._office_dashboard_core(v_agency, p_from, p_to);
end;
$$;

revoke all on function public.office_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.office_dashboard(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. הסיכומים
-- ---------------------------------------------------------------------------
create table if not exists public.office_coach_summaries (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  week_start    date not null,
  -- ‏{headline, points: [{title, body, owner}]} - בדיוק מה שהמודל החזיר, אחרי בדיקה
  summary       jsonb not null,
  model         text,
  input_tokens  int,
  output_tokens int,
  created_at    timestamptz not null default now(),
  unique (agency_id, week_start)
);

comment on table public.office_coach_summaries is
  'סיכום שבועי של מאמן ה-AI למשרד (office-coach). נכתב ב-service_role בלבד; מנהלי המשרד קוראים. docs/office-coach.md';

alter table public.office_coach_summaries enable row level security;

drop policy if exists "managers read office coach" on public.office_coach_summaries;
create policy "managers read office coach" on public.office_coach_summaries
  for select to authenticated
  using (
    (select public.current_member_role()) = 'manager'
    and agency_id = (select public.current_agency_id())
  );

revoke all on public.office_coach_summaries from anon, authenticated;
grant select on public.office_coach_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- 3. מי צריך/ה סיכום השבוע
-- ---------------------------------------------------------------------------
-- שבוע מתחיל ביום ראשון (שעון ישראל), כמו שבוע העבודה כאן.
create or replace function public.office_coach_week_start()
returns date
language sql
stable
set search_path = ''
as $$
  select ((now() at time zone 'Asia/Jerusalem')::date
          - extract(dow from (now() at time zone 'Asia/Jerusalem'))::int);
$$;

revoke all on function public.office_coach_week_start() from public, anon, authenticated;
grant execute on function public.office_coach_week_start() to service_role;

create or replace function public.office_coach_due(p_limit int default 25)
returns table (agency_id uuid, agency_name text, week_start date)
language sql
stable
set search_path = ''
as $$
  select a.id, a.name, public.office_coach_week_start()
    from public.agencies a
   where exists (select 1 from public.agency_members m
                  where m.agency_id = a.id and m.active and m.role = 'manager')
     -- משרד שלא זז חודש לא מקבל סיכום: אין מה לסכם, וכל קריאה עולה כסף
     and (exists (select 1 from public.leads l
                   where l.agency_id = a.id and l.created_at > now() - interval '30 days')
          or exists (select 1 from public.properties p
                      where p.agency_id = a.id and p.updated_at > now() - interval '30 days'))
     and not exists (select 1 from public.office_coach_summaries s
                      where s.agency_id = a.id and s.week_start = public.office_coach_week_start())
   order by a.id
   limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.office_coach_due(int) from public, anon, authenticated;
grant execute on function public.office_coach_due(int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. התזמון: יום ראשון 05:10 UTC (‏08:10 בקיץ, 07:10 בחורף), ושוב בכל שעה
-- עד 09:10 UTC - משרד שנכשל בהרצה הראשונה (תקלת רשת, מגבלת קצב) נלקח בהרצה
-- הבאה, ומשרד שכבר קיבל סיכום לא נלקח שוב (office_coach_due).
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/office-coach';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - יש לתזמן את office-coach בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('office-coach')
    where exists (select 1 from cron.job where jobname = 'office-coach');

  perform cron.schedule('office-coach', '10 5-9 * * 0', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 120000
    )
    -- אין עבודה - אין קריאה: ארבע מתוך חמש ההרצות של יום ראשון ריקות בדרך כלל
    where exists (select 1 from public.office_coach_due(1));
  $cron$, v_url));
end;
$$;

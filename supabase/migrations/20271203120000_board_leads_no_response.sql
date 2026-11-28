-- ===========================================================================
-- לידים מהלוח (יד2 ומדלן) אינם "ללא מענה"
-- ---------------------------------------------------------------------------
-- ‏scraped_lead_add פותחת ליד מכל מודעה מהלוח שהותאמה לסוכן/ת: source
-- 'yad2'/'madlan', ‏quota_source 'yad2_free'/'madlan_free', ‏owner_inbound,
-- פתוח מראש, וברובו בלי טלפון. הוא נולד פתוח, ולכן leads_first_response לא
-- חל עליו, ו-first_response_at נשאר ריק עד חיוג או וואטסאפ. ההחלטה היא לפי
-- המקור ולא לפי הטלפון: גם ליד מהלוח עם מספר אינו פנייה שמחכה. התוצאה
-- ב-27.11.2026: 29 מ-41 הלידים "ללא מענה" בדשבורדים היו יד2, 92 מ-122
-- תזכורות "לחזור לליד חדש" היו עליהם, ו-37 משימות כאלה ישבו ביומן "באיחור".
--
-- החלטה (תומר, 27.11.2026): להוציא אותם מהחישוב, ולא לסמן אותם מטופלים
-- בכניסה. first_response_at ברגע הכניסה היה מענה של 0 דקות שמשפר בכזב את זמן
-- התגובה, ומטשטש את 22 לידי יד2 שכן קיבלו מענה אמיתי. שום ליד אינו משתנה.
--
-- ‏lead_is_board() היא ההגדרה האחת, ו-LEAD_BOARD_QUOTA ב-assets/crm-leads.js
-- הוא העותק שלה בדפדפן. היא חלה על:
--   1. ‏_office_lead_rows - הליד יוצא מהלידים של הדשבורדים (משרד, צוות, אישי,
--      מאמנים). לא רק מ"ללא מענה": כל שיעור שם מחושב מול מספר הלידים
--      (מענה, תוך 15 דק', המרה), וליד שנספר בלידים ולא במענה היה מוריד אותם.
--   2. ‏_my_dashboard_core - רצף הימים, "לטיפול" ו-open_unanswered, שקוראים
--      את leads ישירות.
--   3. ‏lead_response_escalations - תזכורת השעתיים וההסלמה למנהל/ת.
--   4. ‏team_leads - רשימת "ממתינים" של מנהל/ת הצוות.
--   5. ‏admin_command_center - מדד התגובה בלבד (resp). ספירת הביקוש נשארת.
--   6. ‏agent_agenda_on_new_lead - בלי משימת "לחזור לליד חדש". התראת
--      new_lead עצמה יוצאת כרגיל.
--   7. ביטול חד-פעמי של משימות follow-up פתוחות על לידים כאלה (37 ביום
--      הכתיבה, כולן באיחור, אף אחת לא ב-Google ואף אחת בלי client_notify).
--
-- כל גוף הוא העתק מלא של הגרסה בפרודקשן (md5 של prosrc ב-27.11.2026):
--   _office_lead_rows         87421dc430a100abc7be49747ab19ad6 (20270408090000)
--   _my_dashboard_core        eeb17282cc6e77b9b5b67879eb2a1870 (20270830090000)
--   lead_response_escalations e108c4fab2da2428432fdce79d1e577a (20271029250000)
--   team_leads                0e43c994ebda0686c989a812cf5ef7ca (20270601140000)
--   admin_command_center      5a3cdadc1aa12f4a7ac6e691bae15280 (20271027140000)
--   agent_agenda_on_new_lead  f006c79529557587e15e5949f5b9bbc7 (20270125090000)
-- בתוספת התנאי בלבד. ‏docs/scraped-leads.md, "לידים מהלוח ומענה".
-- ===========================================================================

create or replace function public.lead_is_board(p_quota_source text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_quota_source in ('yad2_free', 'madlan_free'), false);
$$;

comment on function public.lead_is_board(text) is
  'ליד שנפתח ממודעה בלוח (יד2/מדלן, scraped_lead_add). אינו נספר במענה הראשון, בהתראות ובמשימת follow-up. העותק בדפדפן: LEAD_BOARD_QUOTA ב-assets/crm-leads.js.';

revoke all on function public.lead_is_board(text) from public, anon, authenticated;
grant execute on function public.lead_is_board(text) to authenticated, service_role;

create or replace function public._office_lead_rows(p_agency uuid, p_from date, p_to date)
returns table (lead_id uuid, agent_id uuid, created_at timestamptz, source text,
               property_id uuid, responded_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select l.id, l.agent_id, l.created_at,
         coalesce(
           rl.source,
           nullif(btrim(l.source), ''),
           case l.lead_type
             when 'visualization'        then 'property_page_visualization'
             when 'property_inquiry'     then 'property_page_inquiry'
             when 'agent_direct_inquiry' then 'agent_page_direct'
             when 'owner_inbound'        then 'homepage_owner_wizard'
           end,
           'unattributed'
         ),
         l.property_id, l.first_response_at
    from public.leads l
    left join public.lead_routing_log rl
      on rl.lead_table = 'leads' and rl.lead_id = l.id
   where l.agency_id = p_agency
     -- מודעות יד2/מדלן מהלוח אינן פנייה שמחכה למענה (20271203120000)
     and not public.lead_is_board(l.quota_source)
     and l.created_at >= p_from
     and l.created_at <  p_to + 1;
$$;

revoke all on function public._office_lead_rows(uuid, date, date) from public, anon, authenticated;

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
                              and not public.agreement_is_consent(g.kind)
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
       and not public.lead_is_board(l.quota_source)
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
               and not public.lead_is_board(l.quota_source)
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
               and not public.agreement_is_consent(g.kind)
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
                                          and not public.lead_is_board(l.quota_source)
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

create or replace function public.lead_response_escalations(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag  int;
  v_n     int := 0;
  v_ins   int;
  v_since timestamptz;
begin
  v_flag := coalesce((select value::int from public.pricing_config
                       where key = 'notif_send_window_friday_enabled'), 0);
  if v_flag <> 1 or not public.notification_send_window_open(p_now) then
    return 0;
  end if;

  select s.enabled_at into v_since
    from public.notification_send_window_state s
   where s.id = 1;
  if v_since is null then
    insert into public.notification_send_window_state (id, enabled_at)
    values (1, p_now)
    on conflict (id) do update
      set enabled_at = coalesce(public.notification_send_window_state.enabled_at, excluded.enabled_at)
    returning enabled_at into v_since;
  end if;

  with demand as (
    select distinct on (ss.id)
           ss.id as search_id,
           sc.claimed_by,
           sc.claimed_at,
           l.id as lead_row,
           l.first_response_at,
           l.unlocked_by,
           l.unlocked_at,
           l.created_at as lead_created
      from public.saved_searches ss
      join public.social_leads sl
        on sl.kind = 'buyer'
       and sl.channel = ss.source
       and sl.status in ('routing', 'routed')
       and sl.received_at >= ss.created_at - interval '30 minutes'
       and sl.received_at <= ss.created_at + interval '30 minutes'
       and (
            (public.phone_tail9(sl.payload->>'phone') is not null
             and public.phone_tail9(sl.payload->>'phone')
                 = public.phone_tail9(coalesce(ss.phone_e164, ss.phone)))
         or (nullif(lower(btrim(coalesce(sl.payload->>'email', ''))), '') is not null
             and lower(btrim(sl.payload->>'email'))
                 = lower(btrim(coalesce(ss.email, ''))))
       )
      join public.scraped_leads sc
        on sc.source = ss.source
       and sc.external_ref = sl.zernio_id
       and sc.lead_type = 'seeker_inbound'
      left join public.leads l
        on l.source = sc.source
       and l.external_ref = sc.external_ref
     where ss.id in (select e.lead_id from public.lead_escalations e where e.resolution is null)
     order by ss.id, sl.received_at desc
  ),
  picked as (
    select e.lead_id,
           e.stage,
           case
             when a.lead_id is not null or da.lead_id is not null then 'closed'
             when l.first_response_at is not null or d.first_response_at is not null then 'opened'
             when d.claimed_by is not null
               or (d.unlocked_by is not null
                   and d.unlocked_at > d.lead_created + interval '1 second')
               or (l.unlocked_by is not null
                   and l.unlocked_at > l.created_at + interval '1 second')
             then 'claimed'
           end as resolution,
           case
             when a.lead_id is not null then a.archived_at
             when da.lead_id is not null then da.archived_at
             when l.first_response_at is not null then l.first_response_at
             when d.first_response_at is not null then d.first_response_at
             when d.claimed_by is not null then coalesce(d.claimed_at, p_now)
             when d.unlocked_by is not null
                  and d.unlocked_at > d.lead_created + interval '1 second'
               then d.unlocked_at
             when l.unlocked_by is not null
                  and l.unlocked_at > l.created_at + interval '1 second'
               then l.unlocked_at
           end as at
      from public.lead_escalations e
      left join public.leads l on l.id = e.lead_id
      left join public.lead_archives a on a.lead_id = e.lead_id
      left join demand d on d.search_id = e.lead_id
      left join public.lead_archives da on da.lead_id = d.lead_row
     where e.resolution is null
  )
  update public.lead_escalations e
     set resolution = p.resolution,
         resolved_at = p.at
    from picked p
   where e.lead_id = p.lead_id
     and e.stage = p.stage
     and p.resolution is not null;

  with due as (
    select l.id
      from public.leads l
      join public.agency_members m
        on m.id = l.agent_id and m.active and m.closed_at is null
     where l.agent_id is not null
       and l.first_response_at is null
       and not public.lead_is_board(l.quota_source)
       and l.created_at >= v_since
       and l.created_at > p_now - interval '7 days'
       and public.notification_business_elapsed(l.created_at, p_now) >= 2
       and not exists (select 1 from public.lead_archives a where a.lead_id = l.id)
       and not exists (
         select 1 from public.lead_escalations e
          where e.lead_id = l.id and e.stage = 'reminder_2h')
     order by l.created_at
     limit 10
  ),
  marked as (
    insert into public.lead_escalations (lead_id, stage, escalated_at, escalated_to_role)
    select d.id, 'reminder_2h', p_now, 'agent'
      from due d
    on conflict (lead_id, stage) do nothing
    returning lead_id
  )
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  select l.agent_id, 'lead_response_reminder',
         'ליד בלי מענה',
         'עברו שעתיים והליד עדיין בלי מענה.',
         l.id, false
    from marked m
    join public.leads l on l.id = m.lead_id;
  get diagnostics v_ins = row_count;
  v_n := v_n + v_ins;

  with due as (
    select l.id as lead_id,
           l.agent_id,
           mgr.id as manager_id,
           adm.id as admin_id
      from public.leads l
      join public.lead_escalations e
        on e.lead_id = l.id
       and e.stage = 'reminder_2h'
       and e.resolution is null
      left join lateral (
        select m.id
          from public.agency_members m
         where m.agency_id = coalesce(
                 l.agency_id,
                 (select am.agency_id from public.agency_members am where am.id = l.agent_id))
           and m.role = 'manager'
           and m.active
           and m.closed_at is null
         order by m.created_at asc nulls last, m.id asc
         limit 1
      ) mgr on true
      left join lateral (
        select m.id
          from public.agency_members m
         where m.is_platform_admin
           and m.active
           and m.closed_at is null
         order by m.created_at asc nulls last, m.id asc
         limit 1
      ) adm on true
     where l.first_response_at is null
       and not public.lead_is_board(l.quota_source)
       and l.created_at >= v_since
       and l.created_at > p_now - interval '7 days'
       and public.notification_business_elapsed(e.escalated_at, p_now) >= 2
       and not exists (select 1 from public.lead_archives a where a.lead_id = l.id)
       and not exists (
         select 1 from public.lead_escalations x
          where x.lead_id = l.id and x.stage = 'escalated_4h')
     order by e.escalated_at
     limit 10
  ),
  chosen as (
    select d.lead_id,
           d.agent_id,
           case
             when d.manager_id is not null and d.manager_id is distinct from d.agent_id
               then d.manager_id
             when d.admin_id is not null and d.admin_id is distinct from d.agent_id
               then d.admin_id
           end as recipient_id,
           case
             when d.manager_id is not null and d.manager_id is distinct from d.agent_id
               then 'manager'
             when d.admin_id is not null and d.admin_id is distinct from d.agent_id
               then 'platform_admin'
             when d.manager_id is not null then 'manager'
             else 'agent'
           end as dest_role
      from due d
  ),
  marked as (
    insert into public.lead_escalations (lead_id, stage, escalated_at, escalated_to_role)
    select c.lead_id, 'escalated_4h', p_now, c.dest_role
      from chosen c
    on conflict (lead_id, stage) do nothing
    returning lead_id
  )
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  select c.recipient_id, 'lead_response_escalation',
         'ליד בלי מענה - למנהל/ת',
         'עברו ארבע שעות פעילות בלי מענה לליד.',
         c.lead_id, false
    from marked m
    join chosen c on c.lead_id = m.lead_id
   where c.recipient_id is not null;
  get diagnostics v_ins = row_count;
  v_n := v_n + v_ins;

  insert into public.lead_escalations (lead_id, stage, escalated_at, escalated_to_role)
  select d.lead_id, 'escalated_4h', p_now, 'unclaimed'
    from (
      select distinct on (ss.id)
             ss.id as lead_id,
             ss.created_at,
             sc.claimed_by,
             sc.source,
             sc.external_ref
        from public.saved_searches ss
        join public.social_leads sl
          on sl.kind = 'buyer'
         and sl.channel = ss.source
         and sl.status in ('routing', 'routed')
         and ss.source ~ '^(facebook|instagram)_[a-z]{2,20}$'
         and sl.received_at >= ss.created_at - interval '30 minutes'
         and sl.received_at <= ss.created_at + interval '30 minutes'
         and (
              (public.phone_tail9(sl.payload->>'phone') is not null
               and public.phone_tail9(sl.payload->>'phone')
                   = public.phone_tail9(coalesce(ss.phone_e164, ss.phone)))
           or (nullif(lower(btrim(coalesce(sl.payload->>'email', ''))), '') is not null
               and lower(btrim(sl.payload->>'email'))
                   = lower(btrim(coalesce(ss.email, ''))))
         )
        join public.scraped_leads sc
          on sc.source = ss.source
         and sc.external_ref = sl.zernio_id
         and sc.status = 'open_demand'
         and sc.lead_type = 'seeker_inbound'
       where ss.agency_id is null
         and ss.sold_to_agent_id is null
         and ss.created_at >= v_since
         and ss.created_at <= p_now
         and ss.created_at > p_now - interval '7 days'
       order by ss.id, sl.received_at desc
    ) d
   where public.notification_business_elapsed(d.created_at, p_now) >= 4
     and d.claimed_by is null
     and not exists (
       select 1 from public.leads l
        where l.source = d.source
          and l.external_ref = d.external_ref
          and (
            l.first_response_at is not null
            or (l.unlocked_by is not null
                and l.unlocked_at > l.created_at + interval '1 second')
          )
     )
   order by d.created_at
   limit 10
  on conflict (lead_id, stage) do nothing;

  return v_n;
end;
$$;

revoke all on function public.lead_response_escalations(timestamptz) from public, anon, authenticated;
grant execute on function public.lead_response_escalations(timestamptz) to service_role;

create or replace function public.team_leads(p_from date, p_to date)
returns table (
  lead_id uuid, created_at timestamptz, lead_type text, deal_type text, city text,
  property_type text, property_details text, property_id uuid, property_title text,
  client_name text, locked boolean, agent_id uuid, agent_name text, stage text,
  first_response_at timestamptz, minutes_waiting integer, archived boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.created_at, l.lead_type, l.deal_type, l.city,
         l.property_type, l.property_details, l.property_id, p.title,
         case
           when l.status = 'unlocked' then l.raw_name
           when l.raw_name is null then null
           else left(split_part(l.raw_name, ' ', 1), 1)
                || repeat('*', greatest(length(split_part(l.raw_name, ' ', 1)) - 1, 0))
                || case when position(' ' in l.raw_name) > 0
                        then ' ' || left(split_part(l.raw_name, ' ', 2), 1)
                             || repeat('*', greatest(length(split_part(l.raw_name, ' ', 2)) - 1, 0))
                        else '' end
         end,
         l.status <> 'unlocked',
         l.agent_id, m.display_name, coalesce(w.stage, 'new'),
         l.first_response_at,
         case when l.first_response_at is null
              then floor(extract(epoch from (now() - l.created_at)) / 60)::int end,
         exists (select 1 from public.lead_archives a where a.lead_id = l.id)
    from public.leads l
    join public.agency_members m on m.id = l.agent_id
    left join public.lead_work w on w.lead_id = l.id and w.agent_id = l.agent_id
    left join public.properties p on p.id = l.property_id
   where m.team_id = public.current_led_team_id()
     and m.team_id is not null
     and p_from is not null and p_to is not null and p_to >= p_from and p_to - p_from <= 400
     and l.created_at >= p_from and l.created_at < p_to + 1
     and not public.lead_is_board(l.quota_source)
   order by l.created_at desc
   limit 500;
$$;

revoke all on function public.team_leads(date, date) from public, anon, authenticated;
grant execute on function public.team_leads(date, date) to authenticated;

create or replace function public.admin_command_center()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agents     int;
  v_props_new  int;
  v_leads      int;
  v_leads_prev int;
  v_paying     int;
  v_supply     numeric;
  v_demand     numeric;
  v_out        jsonb;
  v_run_max    bigint;
  v_run_span   bigint := 40000;
  v_bound_at   timestamptz;
  v_i          int;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  -- חלון ה-runid נמדד מהקצב, לא קבוע: שורת ה-PK בגבול חייבת להסתיים
  -- לפני 24 השעות, אחרת חלון צר מהקצב האמיתי מפיל כשלונות בשקט.
  -- שמונה הכפלות מ-40000 מכסות גם קצב של מאות אלפי הרצות ביום.
  select max(d.runid) into v_run_max from cron.job_run_details d;
  if v_run_max is not null then
    for v_i in 1..8 loop
      select coalesce(d.end_time, d.start_time) into v_bound_at
        from cron.job_run_details d
       where d.runid = v_run_max - v_run_span;
      exit when v_bound_at is null or v_bound_at <= now() - interval '24 hours';
      v_run_span := v_run_span * 2;
    end loop;
  end if;

  select count(*) into v_agents
    from public.agency_members m where m.active and m.released_at is null;
  select count(*) into v_props_new
    from public.properties p where p.created_at > now() - interval '30 days';
  select count(*) filter (where l.created_at > now() - interval '30 days'),
         count(*) filter (where l.created_at <= now() - interval '30 days')
    into v_leads, v_leads_prev
    from public.leads l where l.created_at > now() - interval '60 days';
  -- מנוי בתשלום = paid_tier בתוקף. הטבת ההשקה (promo_tier) אינה תשלום.
  select count(*) into v_paying
    from public.agency_members m
   where m.active and m.released_at is null and m.paid_tier is not null
     and (m.paid_tier_until is null or m.paid_tier_until > now());

  v_supply := case when v_agents > 0 then round(v_props_new::numeric / v_agents, 2) end;
  v_demand := case when v_agents > 0 then round(v_leads::numeric / v_agents, 2) end;

  with resp as (
    select l.created_at, l.first_response_at
      from public.leads l where l.created_at > now() - interval '30 days'
       and not public.lead_is_board(l.quota_source)
  )
  select jsonb_build_object(
    'generated_at', now(),
    'marketplace', jsonb_build_object(
      'agents_active',  v_agents,
      'agencies',       (select count(*) from public.agencies),
      'props_active',   (select count(*) from public.properties p where p.status = 'active'),
      'props_new_7d',   (select count(*) from public.properties p where p.created_at > now() - interval '7 days'),
      'props_new_30d',  v_props_new,
      'leads_30d',      v_leads,
      'leads_prev_30d', v_leads_prev,
      'paying',         v_paying,
      'on_promo',       (select count(*) from public.agency_members m
                          where m.active and m.released_at is null and m.promo_tier is not null
                            and m.promo_ended_at is null and m.promo_ends_at > now()),
      'supply_per_agent', v_supply,
      'demand_per_agent', v_demand,
      'supply_tag', case when v_agents < 10 then 'early'
                         when v_supply >= 1 then 'growing'
                         when v_supply >= 0.3 then 'stable' else 'weak' end,
      'demand_tag', case when v_agents < 10 then 'early'
                         when v_demand >= 3 or (v_leads_prev > 0 and v_leads >= v_leads_prev * 1.2) then 'growing'
                         when v_demand >= 1 then 'stable' else 'weak' end,
      'money_early', v_paying < 10,
      -- זמן התגובה עם המדגם שלו: כמה לידים בכלל סומנו כנענו
      'response', jsonb_build_object(
        'total',       (select count(*) from resp),
        'measured',    (select count(*) from resp where first_response_at is not null),
        'within_12h',  (select count(*) from resp where first_response_at - created_at <= interval '12 hours'),
        'median_hours',(select round((extract(epoch from percentile_cont(0.5) within group
                                     (order by first_response_at - created_at)) / 3600.0)::numeric, 1)
                          from resp where first_response_at is not null))
    ),
    'health', jsonb_build_object(
      'findings_high',   (select count(*) from public.ops_findings f
                           where f.resolved_at is null and f.severity in ('high', 'critical')
                             and (f.muted_until is null or f.muted_until < now())),
      'findings_medium', (select count(*) from public.ops_findings f
                           where f.resolved_at is null and f.severity = 'medium'
                             and (f.muted_until is null or f.muted_until < now())),
      -- אין אינדקס על end_time: הטבלה בבעלות supabase_admin.
      -- v_run_span מחושב למעלה כך שהגבול ישן מ-24 שעות, ו-end_time
      -- חותך את מה שבתוך החלון לכשלונות שהסתיימו ב-24 השעות האלה.
      'cron_failed_24h', coalesce((select jsonb_agg(distinct j.jobname)
                                     from cron.job_run_details d
                                     join cron.job j on j.jobid = d.jobid
                                    where d.runid > v_run_max - v_run_span
                                      and d.status = 'failed'
                                      and d.end_time >= now() - interval '24 hours'), '[]'::jsonb),
      'markets_oldest_hours', (select round((extract(epoch from now() - min(s.computed_at)) / 3600.0)::numeric, 1)
                                 from public.market_snapshots s),
      'markets_errors',  (select count(*) from public.market_snapshots s
                           where s.last_error_at is not null and (s.computed_at is null or s.last_error_at > s.computed_at)),
      'news_last_at',    (select max(n.created_at) from public.news_items n)
    ),
    -- מוכנות השווקים: המספרים שהסף בודק, מהתמונה השמורה (20270629090000).
    -- הסף עצמו ו"חי באתר" - בדפדפן (MARKET_GATE, assets/markets.js).
    'markets', coalesce((select jsonb_agg(jsonb_build_object(
                 'slug', s.market_slug,
                 'agencies', coalesce((s.data->'totals'->>'agencies')::int, 0),
                 'props_active', coalesce((s.data->'totals'->>'props_active')::int, 0),
                 'leads_30d', coalesce((s.data->'totals'->>'leads_30d')::int, 0),
                 'agents', coalesce((s.data->'totals'->>'agents')::int, 0)) order by s.market_slug)
               from public.market_snapshots s where s.data is not null), '[]'::jsonb),
    'broadcasts', coalesce((select jsonb_agg(jsonb_build_object('title', b.title, 'recipients', b.recipients,
                                                                 'created_at', b.created_at) order by b.created_at desc)
                              from (select * from public.admin_broadcasts order by created_at desc limit 3) b), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;


comment on function public.admin_command_center() is
  'מרכז הפיקוד של מנהל/ת הפלטפורמה: בריאות המרקטפלייס עם התגים, זמן התגובה עם המדגם שלו, בריאות המערכת, מוכנות השווקים וההודעות האחרונות. מנהל/ת פלטפורמה בלבד (42501). cron_failed_24h: end_time ב-24 השעות האחרונות, בתוך חלון runid שמוגדל עד שהגבול שלו ישן מ-24 שעות (20271027140000).';

revoke all on function public.admin_command_center() from public, anon, authenticated;
grant execute on function public.admin_command_center() to authenticated;


create or replace function public.agent_agenda_on_new_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- מודעה מהלוח (יד2/מדלן) אינה אדם שפנה ומחכה לשיחה חוזרת
  if new.related_lead_id is not null and exists (
       select 1 from public.leads l
        where l.id = new.related_lead_id and public.lead_is_board(l.quota_source)) then
    return null;
  end if;

  perform public.agent_agenda_add_auto(
    new.agent_id, 'lead_followup',
    'lead:' || coalesce(new.related_lead_id::text, new.id::text),
    'call',
    'לחזור לליד חדש',
    concat_ws(' · ', nullif(btrim(coalesce(new.title, '')), ''), nullif(btrim(coalesce(new.body, '')), '')),
    public.agent_agenda_business_time(now() + interval '1 hour'),
    'high', null, null, new.related_lead_id);
  return null;
end;
$$;

revoke all on function public.agent_agenda_on_new_lead() from public, anon, authenticated;

-- 7. משימות "לחזור לליד חדש" שכבר נפתחו על לידים מהלוח. canceled ולא מחיקה:
-- היומן נשאר. agent_agenda_items_alerts מוחק את התזכורות שלא נשלחו, ו-
-- agenda_first_response חל רק על done, כך ש-first_response_at לא נכתב.
update public.agent_agenda_items a
   set status = 'canceled'
  from public.leads l
 where l.id = a.lead_id
   and a.auto_kind = 'lead_followup'
   and a.status = 'open'
   and public.lead_is_board(l.quota_source);

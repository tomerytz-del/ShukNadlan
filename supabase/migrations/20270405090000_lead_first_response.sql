-- ===========================================================================
-- זמן תגובה אמיתי ללידים: leads.first_response_at
-- ---------------------------------------------------------------------------
-- דאשבורד המשרד (20270404090000) חישב זמן תגובה בקירוב: פתיחת הליד או השלמת
-- משימת ה-follow-up. רוב הלידים נולדים פתוחים, ולכן אצלם הקירוב לא ראה כלום
-- והם נספרו "ללא מענה מתועד" גם כשהסוכן/ת התקשר/ה תוך דקה.
--
-- מהיום יש עמודה אחת, first_response_at: **הרגע הראשון שבו הסוכן/ת פנה/תה
-- לליד.** היא נכתבת פעם אחת בלבד (רק כשהיא ריקה), מארבעה מקורות:
--
--   1. פתיחת ליד ממוסך (unlocked_at עובר מריק לערך, שנייה ומעלה אחרי
--      created_at). טריגר על leads, ולכן כל מסלול פתיחה מכוסה.
--   2. לחיצה על "חיוג" או "וואטסאפ" בכרטיס הליד ב-CRM → mark_lead_responded().
--   3. שיחה מהמספר של הליד למספר הווירטואלי של הסוכן/ת שנענתה, או שיחה
--      שלא נענתה וסומנה "חזרתי" (handled_at). טריגר על agent_calls, התאמה
--      לפי 9 הספרות האחרונות של הטלפון.
--   4. השלמת משימת ה-follow-up של הליד ביומן (auto_kind = 'lead_followup').
--
-- **שיחה יוצאת אינה מקור,** כי אין במערכת שיחות יוצאות: המספרים
-- הווירטואליים מקבלים שיחות בלבד, והסוכן/ת מתקשר/ת מהטלפון שלו/ה, וזה מה
-- שהכפתור "חיוג" מתעד. גם הבוט בוואטסאפ אינו שולח הודעות ללידים.
--
-- **העמודה נעולה לעדכון ישיר.** טריגר מחזיר אותה לערך הקודם כשמי שמעדכן הוא
-- authenticated או anon. רק פונקציות security definer וה-service_role כותבים
-- אותה. אחרת זמן התגובה, המדד שהמנהל/ת מודד/ת לפיו, היה ניתן לעריכה בידי
-- מי שנמדד/ת.
--
-- ‏backfill: לידים קיימים מקבלים את הקירוב הישן (פתיחה או follow-up), כדי
-- שהתקופה הקודמת בדאשבורד תושווה באותה יחידה.
--
-- המיגרציה אידמפוטנטית. ‏docs/office-dashboard.md, "זמן תגובה".
-- ===========================================================================

alter table public.leads add column if not exists first_response_at timestamptz;

comment on column public.leads.first_response_at is
  'הרגע הראשון שבו הסוכן/ת פנה/תה לליד: פתיחה, חיוג/וואטסאפ מה-CRM, שיחה שנענתה או הוחזרה, או השלמת ה-follow-up. נכתב פעם אחת; נעול לעדכון ישיר. docs/office-dashboard.md';

-- ספרות בלבד, תשע אחרונות: 050-1234567, ‎+972501234567‎ ו-0501234567 הם אותו מספר
create or replace function public.phone_tail9(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 9
              then right(regexp_replace(p, '\D', '', 'g'), 9) end;
$$;

revoke all on function public.phone_tail9(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. הטריגר על leads: נעילה + פתיחה כתגובה
-- ---------------------------------------------------------------------------
create or replace function public.leads_first_response()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- נעילה: מי שמחובר/ת מהדפדפן לא כותב/ת את העמודה ישירות
  if current_user in ('authenticated', 'anon')
     and new.first_response_at is distinct from old.first_response_at then
    new.first_response_at := old.first_response_at;
  end if;
  -- פתיחה של ליד שנכנס ממוסך היא פנייה. ליד שנולד פתוח לא עובר כאן כלל
  -- (זה insert ולא update), ופתיחה בתוך השנייה הראשונה אינה המתנה.
  if new.first_response_at is null
     and old.unlocked_at is null
     and new.unlocked_at is not null
     and new.unlocked_at > new.created_at + interval '1 second' then
    new.first_response_at := new.unlocked_at;
  end if;
  return new;
end;
$$;

revoke all on function public.leads_first_response() from public, anon, authenticated;

drop trigger if exists trg_leads_first_response on public.leads;
create trigger trg_leads_first_response
  before update on public.leads
  for each row execute function public.leads_first_response();

-- ---------------------------------------------------------------------------
-- 2. mark_lead_responded — הכפתורים בכרטיס הליד
-- ---------------------------------------------------------------------------
create or replace function public.mark_lead_responded(p_lead uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_agent_id();
begin
  if v_me is null then
    return false;
  end if;
  -- רק ליד שלי (או שמסרתי בהפנייה), רק פתוח, ורק בפעם הראשונה: לחיצה
  -- שנייה אחרי שבוע אינה זמן תגובה.
  update public.leads l
     set first_response_at = now()
   where l.id = p_lead
     and l.first_response_at is null
     and l.status = 'unlocked'
     and (l.agent_id = v_me or l.referred_by = v_me);
  return found;
end;
$$;

revoke all on function public.mark_lead_responded(uuid) from public, anon, authenticated;
grant execute on function public.mark_lead_responded(uuid) to authenticated;

comment on function public.mark_lead_responded(uuid) is
  'חותמת הפנייה הראשונה לליד מ-CRM (חיוג או וואטסאפ בכרטיס). פעם אחת, רק לבעלי הליד. docs/office-dashboard.md';

-- ---------------------------------------------------------------------------
-- 3. שיחה מהליד שנענתה או הוחזרה
-- ---------------------------------------------------------------------------
create or replace function public.agent_calls_first_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at   timestamptz;
  v_tail text := public.phone_tail9(new.from_number);
begin
  if new.direction is distinct from 'inbound' or v_tail is null or new.agent_id is null then
    return new;
  end if;
  if new.status = 'answered' then
    v_at := new.created_at;
  elsif new.handled_at is not null then
    v_at := new.handled_at;
  else
    return new;
  end if;
  update public.leads l
     set first_response_at = v_at
   where l.agent_id = new.agent_id
     and l.first_response_at is null
     and l.created_at <= v_at
     and l.created_at >  v_at - interval '30 days'
     and public.phone_tail9(l.raw_phone) = v_tail;
  return new;
end;
$$;

revoke all on function public.agent_calls_first_response() from public, anon, authenticated;

drop trigger if exists trg_agent_calls_first_response on public.agent_calls;
create trigger trg_agent_calls_first_response
  after insert or update of status, handled_at on public.agent_calls
  for each row execute function public.agent_calls_first_response();

-- ---------------------------------------------------------------------------
-- 4. השלמת ה-follow-up ביומן
-- ---------------------------------------------------------------------------
create or replace function public.agenda_first_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(new.completed_at, now());
begin
  if new.lead_id is null or new.auto_kind is distinct from 'lead_followup' or new.status <> 'done' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'done' then
    return new;
  end if;
  update public.leads l
     set first_response_at = v_at
   where l.id = new.lead_id
     and l.first_response_at is null
     and l.created_at <= v_at;
  return new;
end;
$$;

revoke all on function public.agenda_first_response() from public, anon, authenticated;

drop trigger if exists trg_agenda_first_response on public.agent_agenda_items;
create trigger trg_agenda_first_response
  after insert or update of status on public.agent_agenda_items
  for each row execute function public.agenda_first_response();

-- ---------------------------------------------------------------------------
-- 5. backfill — הקירוב הישן, כדי שהתקופה הקודמת תושווה באותה יחידה
-- ---------------------------------------------------------------------------
update public.leads l
   set first_response_at = least(
         case when l.unlocked_at > l.created_at + interval '1 second' then l.unlocked_at end,
         (select min(a.completed_at)
            from public.agent_agenda_items a
           where a.lead_id = l.id
             and a.auto_kind = 'lead_followup'
             and a.status = 'done'))
 where l.first_response_at is null
   and (l.unlocked_at > l.created_at + interval '1 second'
        or exists (select 1 from public.agent_agenda_items a
                    where a.lead_id = l.id and a.auto_kind = 'lead_followup'
                      and a.status = 'done' and a.completed_at is not null));

-- ---------------------------------------------------------------------------
-- 6. הדאשבורד עובר לעמודה
-- ---------------------------------------------------------------------------
create or replace function public._office_lead_rows(p_agency uuid, p_from date, p_to date)
returns table (lead_id uuid, agent_id uuid, created_at timestamptz, source text,
               property_id uuid, responded_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select l.id, l.agent_id, l.created_at, l.source, l.property_id, l.first_response_at
    from public.leads l
   where l.agency_id = p_agency
     and l.created_at >= p_from
     and l.created_at <  p_to + 1;
$$;

revoke all on function public._office_lead_rows(uuid, date, date) from public, anon, authenticated;

-- office_dashboard זהה לגרסה של 20270404090000, חוץ מ-data_notes, שמצהיר
-- עכשיו על response_time_method = 'first_response_at'. הממשק מוריד בעקבותיו
-- את הכוכבית ואת "משוער".
create or replace function public.office_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_len    int;
  v_pfrom  date;
  v_pto    date;
  v_m0     date;
  v_result jsonb;
begin
  if public.current_member_role() is distinct from 'manager' or v_agency is null then
    raise exception 'office_dashboard: managers only' using errcode = '42501';
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

revoke all on function public.office_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.office_dashboard(date, date) to authenticated;

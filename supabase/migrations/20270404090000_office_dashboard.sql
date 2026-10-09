-- ===========================================================================
-- דאשבורד משרד — לוח בקרה למנהל/ת משרד, עם חלוקה לכל סוכן/ת
-- ---------------------------------------------------------------------------
-- מנהל/ת משרד ראה/תה עד היום את הנכסים, הלידים וההסכמים של עצמו/ה, ואת
-- השיחות של הצוות (accOfficeCalls). השאלות שמנהלים משרד שואלים — מי גייס,
-- מי החתים, מי עונה לליד תוך רבע שעה ומי אחרי יומיים, איזו בלעדיות נגמרת
-- בשבוע הבא — לא היו נגישות בשום מקום. ‏docs/office-dashboard.md
--
-- מה בקובץ:
--
--   1. ‏properties.closed_at + טריגר — מתי נכס עבר ל-sold/rented. בלי זה
--      "עסקאות ברבעון" אינו מספר: אין חותמת זמן לשינוי סטטוס.
--   2. ‏agent_targets — יעדים חודשיים/רבעוניים שמנהל/ת המשרד קובע/ת.
--   3. ארבע פונקציות עזר (‏_office_*), security invoker ובלי הרשאה לאיש:
--      הן רצות רק מתוך office_dashboard (ובהמשך my_dashboard, ראו
--      docs/handoff/office-dashboard/HANDOFF.md סעיף 11), כדי ששני
--      הדאשבורדים יציגו תמיד אותם מספרים לאותו/ה סוכן/ת.
--   4. ‏office_dashboard(p_from, p_to) — ה-RPC היחיד שהדפדפן קורא.
--      ‏security definer כי leads, agreements ו-agent_agenda_items חסומים
--      ב-RLS בפני המנהל/ת לשורות של סוכן/ת אחר/ת, וזה נכון: הפונקציה
--      מחזירה **אגרגטים** ושמות סוכנים ונכסים בלבד — לא שם, טלפון או
--      טקסט של פונה. השורה הראשונה בגוף מסרבת (42501) למי שאינו/ה מנהל/ת.
--
-- שלוש החלטות שכדאי לדעת:
--
--   · **זמן תגובה הוא קירוב (proxy) בשלב הזה.** אין במסד רגע "פניתי
--     לליד". הקירוב: המוקדם מבין פתיחת הליד (unlocked_at, רק כשהוא אחרי
--     created_at בשנייה ומעלה — ליד שנולד פתוח אינו מודד תגובה, ראו
--     docs/lead-analytics.md) והשלמת משימת ה-follow-up של הליד ביומן
--     (auto_kind = 'lead_followup'). ‏data_notes.response_time_method
--     מצהיר על כך, והממשק מציג "משוער". העמודה האמיתית
--     (leads.first_response_at) נכנסת ב-PR נפרד.
--   · **בלעדיות נספרת מ-property_exclusivities, ומהסכם חתום כגיבוי.**
--     בזמן כתיבת הקובץ הטבלה ריקה, בעוד שיש הסכם בלעדיות חתום — הוא נחתם
--     לפני שהטבלה נולדה. בלי הגיבוי כל המשרדים היו מציגים 0 בלעדיות.
--   · **עמלה היא הערכה.** הסכם חתום על הנכס עם commission_amount (או
--     commission_pct במכירה) גובר; אחרת מכירה = 2% ממחיר הסגירה או
--     המבוקש, והשכרה = חודש שכירות. ‏0.02 הוא אותו קבוע כמו
--     COMMISSION_SALE_RATE ב-assets/crm.js — שינוי באחד מחייב את השני.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. properties.closed_at
-- ---------------------------------------------------------------------------
alter table public.properties add column if not exists closed_at timestamptz;

comment on column public.properties.closed_at is
  'מתי הנכס עבר ל-sold/rented. נכתב בטריגר properties_set_closed_at ומתאפס כשהנכס חוזר לשוק. מקור "עסקאות בתקופה" בדאשבורד המשרד.';

create or replace function public.properties_set_closed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('sold', 'rented') then
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.properties_set_closed_at() from public, anon, authenticated;

drop trigger if exists trg_properties_set_closed_at on public.properties;
create trigger trg_properties_set_closed_at
  before insert or update of status on public.properties
  for each row execute function public.properties_set_closed_at();

-- ‏backfill: תאריך הסגירה שהוזן כשיש, אחרת העדכון האחרון של השורה — הקירוב
-- הטוב ביותר שיש לשינוי סטטוס שקרה לפני שהעמודה נולדה.
update public.properties
   set closed_at = coalesce(sale_closed_on::timestamptz, updated_at)
 where status in ('sold', 'rented')
   and closed_at is null;

create index if not exists properties_agency_closed_idx
  on public.properties (agency_id, closed_at) where closed_at is not null;
create index if not exists properties_agency_created_idx on public.properties (agency_id, created_at);
create index if not exists leads_agency_created_idx      on public.leads (agency_id, created_at);
create index if not exists agreements_agency_signed_idx  on public.agreements (agency_id, signed_at);
-- ‏office_dashboard מחפש לכל ליד את משימת ה-follow-up שלו, לכל נכס את ההצגות
-- שלו, ולכל הסכם בלעדיות את השורה שלו ב-property_exclusivities. בלי שלושת
-- האינדקסים האלה כל חיפוש כזה הוא סריקה מלאה: בבדיקת עומס (20 סוכנים, שנה,
-- 20 אלף לידים) הדוח לקח 50 שניות.
create index if not exists agent_agenda_items_lead_idx
  on public.agent_agenda_items (lead_id) where lead_id is not null;
create index if not exists agent_agenda_items_property_idx
  on public.agent_agenda_items (property_id) where property_id is not null;
create index if not exists property_exclusivities_agreement_idx
  on public.property_exclusivities (agreement_id) where agreement_id is not null;
create index if not exists property_exclusivities_agency_idx
  on public.property_exclusivities (agency_id, starts_on);

-- ---------------------------------------------------------------------------
-- 2. agent_targets
-- ---------------------------------------------------------------------------
create table if not exists public.agent_targets (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id) on delete cascade,
  agent_id          uuid not null references public.agency_members (id) on delete cascade,
  period_kind       text not null check (period_kind in ('month', 'quarter')),
  period_start      date not null,
  commission_target numeric(12, 2) check (commission_target is null or commission_target >= 0),
  deals_target      int check (deals_target is null or deals_target >= 0),
  recruited_target  int check (recruited_target is null or recruited_target >= 0),
  created_by        uuid default public.current_agent_id(),
  updated_at        timestamptz not null default now(),
  unique (agent_id, period_kind, period_start)
);
-- ‏agent_id הוא המפתח הזר היחיד ל-agency_members כאן, בכוונה: created_by
-- נשאר uuid בלי FK, כדי ש-embed של agency_members(...) לא יהפוך לדו-משמעי
-- (PGRST201, ראו .claude/skills/new-migration סעיף 6).

comment on table public.agent_targets is
  'יעדי עמלות/עסקאות/גיוסים לסוכן/ת, לחודש או לרבעון. נכתב בידי מנהל/ת המשרד מתוך דאשבורד המשרד; סוכן/ת קורא/ת רק את שלו/ה. docs/office-dashboard.md';

alter table public.agent_targets enable row level security;

drop policy if exists "manager manages office targets" on public.agent_targets;
create policy "manager manages office targets" on public.agent_targets
  for all to authenticated
  using (
    (select public.current_member_role()) = 'manager'
    and agency_id = (select public.current_agency_id())
  )
  with check (
    (select public.current_member_role()) = 'manager'
    and agency_id = (select public.current_agency_id())
    and agent_id in (select m.id from public.agency_members m
                      where m.agency_id = (select public.current_agency_id()))
  );

drop policy if exists "agent reads own targets" on public.agent_targets;
create policy "agent reads own targets" on public.agent_targets
  for select to authenticated
  using (agent_id = (select public.current_agent_id()));

revoke all on public.agent_targets from anon;
grant select, insert, update, delete on public.agent_targets to authenticated;

create or replace function public.agent_targets_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.agent_targets_touch() from public, anon, authenticated;

drop trigger if exists trg_agent_targets_touch on public.agent_targets;
create trigger trg_agent_targets_touch
  before update on public.agent_targets
  for each row execute function public.agent_targets_touch();

-- ---------------------------------------------------------------------------
-- 3. פונקציות העזר
-- ---------------------------------------------------------------------------

-- לידים בתקופה, עם רגע התגובה המשוער (ראו ההערה בראש הקובץ)
create or replace function public._office_lead_rows(p_agency uuid, p_from date, p_to date)
returns table (lead_id uuid, agent_id uuid, created_at timestamptz, source text,
               property_id uuid, responded_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select l.id, l.agent_id, l.created_at, l.source, l.property_id,
         least(
           case when l.unlocked_at > l.created_at + interval '1 second' then l.unlocked_at end,
           (select min(a.completed_at)
              from public.agent_agenda_items a
             where a.lead_id = l.id
               and a.auto_kind = 'lead_followup'
               and a.status = 'done')
         )
    from public.leads l
   where l.agency_id = p_agency
     and l.created_at >= p_from
     and l.created_at <  p_to + 1;
$$;

-- עסקאות שנסגרו בתקופה, עם הערכת העמלה
create or replace function public._office_deal_rows(p_agency uuid, p_from date, p_to date)
returns table (property_id uuid, agent_id uuid, closed_ts timestamptz, deal_type text, commission numeric)
language sql
stable
set search_path = ''
as $$
  select p.id, p.agent_id, coalesce(p.closed_at, p.sale_closed_on::timestamptz), p.deal_type,
         coalesce(
           -- הסכם חתום על הנכס גובר על ההערכה
           (select max(coalesce(
                     g.commission_amount,
                     case when p.deal_type = 'sale'
                          then g.commission_pct / 100.0 * coalesce(p.sale_closed_price, p.price) end))
              from public.agreements g
             where g.status = 'signed'
               and g.agency_id = p_agency
               -- ‏@> ולא ‎= any()‎: רק הצורה הזו משתמשת באינדקס ה-GIN על property_ids
               and g.property_ids @> array[p.id]),
           -- ‏0.02 = COMMISSION_SALE_RATE ב-assets/crm.js; השכרה = חודש שכירות
           case when p.deal_type = 'rent'
                then coalesce(p.sale_closed_price, p.price)
                else coalesce(p.sale_closed_price, p.price) * 0.02 end,
           0)
    from public.properties p
   where p.agency_id = p_agency
     and p.status in ('sold', 'rented')
     and coalesce(p.closed_at, p.sale_closed_on::timestamptz) >= p_from
     and coalesce(p.closed_at, p.sale_closed_on::timestamptz) <  p_to + 1;
$$;

-- כל הבלעדיות של המשרד: property_exclusivities, ובגיבוי הסכם בלעדיות חתום
-- שאין לו שורה שם (נחתם לפני שהטבלה נולדה)
create or replace function public._office_exclusive_rows(p_agency uuid)
returns table (agent_id uuid, property_id uuid, starts_on date, ends_on date, active boolean)
language sql
stable
set search_path = ''
as $$
  select e.agent_id, e.property_id, e.starts_on, e.ends_on, e.released_at is null
    from public.property_exclusivities e
   where e.agency_id = p_agency
  union all
  select g.agent_id, pid, coalesce(g.exclusive_from, g.signed_at::date), g.exclusive_until,
         g.cancelled_at is null
    from public.agreements g
    cross join lateral unnest(g.property_ids) as pid
   where g.agency_id = p_agency
     and g.status = 'signed'
     and g.kind in ('exclusive_sell', 'exclusive_landlord')
     and not exists (select 1 from public.property_exclusivities e2 where e2.agreement_id = g.id);
$$;

-- מדדי התקופה לכל סוכן/ת במשרד — המקור המשותף לשני הדאשבורדים.
-- כל מקור מסוכם פעם אחת ב-group by ומצורף לצוות; תת-שאילתה לכל סוכן/ת
-- סרקה את אותם לידים מחדש עשרים פעם.
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

revoke all on function public._office_lead_rows(uuid, date, date)      from public, anon, authenticated;
revoke all on function public._office_deal_rows(uuid, date, date)      from public, anon, authenticated;
revoke all on function public._office_exclusive_rows(uuid)             from public, anon, authenticated;
revoke all on function public._agent_period_stats(uuid, date, date)    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. office_dashboard
-- ---------------------------------------------------------------------------
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
           'data_notes',       jsonb_build_object('response_time_method', 'proxy',
                                                  'commission_method', 'estimate',
                                                  'commission_sale_rate', 0.02)
         )
    into v_result;

  return v_result;
end;
$$;

revoke all on function public.office_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.office_dashboard(date, date) to authenticated;

comment on function public.office_dashboard(date, date) is
  'דאשבורד המשרד למנהל/ת משרד: לכל סוכן/ת לידים, זמן תגובה (משוער), גיוסים, בלעדיות, הסכמים, פגישות, עסקאות ועמלות (הערכה) מול התקופה הקודמת ויעד; התפלגות זמני תגובה, 12 חודשים, מקורות ובלעדיות שפוקעות. אגרגטים ושמות סוכנים/נכסים בלבד. מסרבת (42501) למי שאינו/ה מנהל/ת משרד. docs/office-dashboard.md';

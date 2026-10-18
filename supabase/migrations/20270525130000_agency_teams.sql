-- ============================================================================
-- צוותים בתוך משרד, ו"גם סוכן/ת פעיל/ה" (docs/teams.md)
-- ----------------------------------------------------------------------------
-- שלב 3 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 3).
--
-- ‏**בלי ערך תפקיד חדש.** agency_members.role נשאר ('agent','manager'), כי
-- מאות מקומות בודקים אותו (current_member_role, ה-RLS, caller.role,
-- ‏#managerSection), וערך שלישי היה שובר כל בדיקה של "= 'agent'". מנהל/ת צוות
-- הוא/היא חבר/ת משרד שמוגדר/ת כמנהל/ת של צוות (agency_teams.lead_member_id).
--
-- מה כאן:
--   1. agency_teams, ו-agency_members.team_id / is_active_agent
--   2. protect_sensitive_agency_member_fields: team_id רק בידי מנהל/ת משרד
--   3. בדיקת עקביות: צוות מאותו משרד, ויציאה ממשרד מנקה את הצוות
--   4. current_led_team_id() ו-my_roles()
--   5. RLS על agency_teams
--   6. is_active_agent = false: לא ברוטציית לידי הבעלים, לא בממוצע המשרד
--      בדשבורד האישי, ולא במדריך הסוכנים באתר (כן בדף המשרד ובדף האישי -
--      החלטה של תומר, 18.10.2026)
--
-- ‏**שני מפתחות זרים בין agency_members ל-agency_teams** (team_id ו-
-- lead_member_id). embed לא מסויג בין שתי הטבלאות ייכשל ב-PGRST201, ולכן
-- הקוד קורא אותן בשאילתות נפרדות. agency_teams אינה טבלת קישור בין
-- agency_members ל-agencies (המפתח הראשי שלה הוא id בודד), ולכן היא אינה
-- פוגעת ב-embed הקיים (scripts/check_agency_embed.py).
-- ============================================================================

-- 1. הצוותים -----------------------------------------------------------------
create table if not exists public.agency_teams (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  name           text not null,
  lead_member_id uuid references public.agency_members(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agency_teams_name_check') then
    alter table public.agency_teams
      add constraint agency_teams_name_check check (char_length(btrim(name)) between 1 and 60);
  end if;
end $$;

create index if not exists agency_teams_agency_idx on public.agency_teams(agency_id);
-- מנהל/ת לצוות אחד לכל היותר
create unique index if not exists agency_teams_lead_uidx
  on public.agency_teams(lead_member_id) where lead_member_id is not null;
-- שני צוותים באותו שם באותו משרד הם בלבול ולא החלטה
create unique index if not exists agency_teams_agency_name_uidx
  on public.agency_teams(agency_id, lower(btrim(name)));

drop trigger if exists agency_teams_set_updated_at on public.agency_teams;
create trigger agency_teams_set_updated_at
  before update on public.agency_teams
  for each row execute function public.set_updated_at();

alter table public.agency_members add column if not exists team_id uuid;
alter table public.agency_members add column if not exists is_active_agent boolean not null default true;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_team_id_fkey') then
    alter table public.agency_members
      add constraint agency_members_team_id_fkey
      foreign key (team_id) references public.agency_teams(id) on delete set null;
  end if;
end $$;

create index if not exists agency_members_team_idx
  on public.agency_members(team_id) where team_id is not null;

-- 2. השדות הרגישים -------------------------------------------------------------
-- הגוף כולו מ-20261031090000_broker_license_verification.sql, ובסוף בלוק
-- is_self נוספו team_id ו-is_active_agent.
create or replace function public.protect_sensitive_agency_member_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  -- ‏coalesce מבטיח true/false ולעולם לא NULL
  is_self boolean := coalesce(
    old.user_id is not null and old.user_id = (select auth.uid()),
    false
  );
  -- הקשר מנהלתי: מיגרציה, SQL Editor או Edge Function. נקבע לפי תפקיד ה-DB
  -- בפועל, שדפדפן לא יכול להתחזות אליו
  is_privileged boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
                           or auth.role() = 'service_role';
begin
  if is_privileged then
    return new;
  end if;
  new.credit_balance := old.credit_balance;
  new.tier := old.tier;
  new.free_quota_used := old.free_quota_used;
  new.free_quota_cycle_start := old.free_quota_cycle_start;
  new.payment_token_id := old.payment_token_id;
  new.billing_status := old.billing_status;
  new.pending_tier_change := old.pending_tier_change;
  new.pending_tier_change_at := old.pending_tier_change_at;
  new.subscription_id := old.subscription_id;
  new.is_platform_admin := old.is_platform_admin; -- נעול לחלוטין, גם למנהל משרד רגיל
  new.is_mortgage_advisor := old.is_mortgage_advisor; -- נעול לחלוטין — מנהל/ת הפלטפורמה בלבד
  new.ethics_badge_revoked_at := old.ethics_badge_revoked_at; -- הסרת תו: הנהלת הפלטפורמה בלבד

  -- המנוי בתשלום — דרך complete_subscription_order בלבד. אלה שדות כסף
  -- במלוא מובן המילה: מי שכותב/ת אותם מהדפדפן מעניק/ה לעצמו/ה מסלול Elite.
  new.paid_tier := old.paid_tier;
  new.paid_tier_until := old.paid_tier_until;

  -- בחירת המסלול והטבת ההשקה — דרך join-agency ו-promo-lifecycle בלבד.
  -- אלה שדות כסף: מי שיכול/ה לכתוב אותם מהדפדפן יכול/ה להאריך לעצמו/ה
  -- חצי שנה חינם, או לסמן בחירה שלא נעשתה.
  new.tier_selected_at := old.tier_selected_at;
  new.tier_source := old.tier_source;
  new.promo_tier := old.promo_tier;
  new.promo_started_at := old.promo_started_at;
  new.promo_ends_at := old.promo_ends_at;
  new.promo_notice_1_at := old.promo_notice_1_at;
  new.promo_notice_2_at := old.promo_notice_2_at;
  new.promo_ended_at := old.promo_ended_at;

  -- ניתוק מהמשרד — דרך release-team-member בלבד
  new.released_at := old.released_at;
  new.released_from_agency_id := old.released_from_agency_id;
  new.released_by := old.released_by;

  -- סגירת חשבון — דרך close-account בלבד. אותו נימוק בדיוק: מי שיכול/ה
  -- לכתוב את closed_at מהדפדפן יכול/ה להוריד מהאוויר סוכן/ת אחר/ת, או
  -- לסמן את עצמו/ה כסגור/ה בלי שההחזר, האירכוב וההסרה מרשימת התפוצה קרו.
  new.closure_requested_at := old.closure_requested_at;
  new.closure_effective_at := old.closure_effective_at;
  new.closed_at := old.closed_at;
  new.closure_reason := old.closure_reason;

  -- אימות הרישיון — נקבע בשער בלבד (‏_shared/broker-license-gate.ts) ובאישור
  -- הידני של הנהלת הפלטפורמה. מי שיכול/ה לכתוב את license_status מהדפדפן
  -- יכול/ה לבטל את כל הבדיקה בשורה אחת.
  new.license_status := old.license_status;
  new.license_registry_name := old.license_registry_name;
  new.license_entity_status := old.license_entity_status;
  new.license_checked_at := old.license_checked_at;
  new.license_approved_at := old.license_approved_at;
  new.license_approved_by := old.license_approved_by;

  -- מספר הרישיון: עדכון עצמי בלבד, וגם זה רק **כל עוד לא אומת**. הבדיקה
  -- מול הרשם היא חד-פעמית בכניסה, ולכן החלפת המספר אחריה הייתה מרוקנת
  -- אותה מתוכן. מי שעדיין לא אומת/ה ממשיך/ה לתקן שגיאת הקלדה כרגיל.
  if not is_self
     or new.license_number is null
     or btrim(new.license_number) = ''
     or old.license_status in ('verified', 'manual') then
    new.license_number := old.license_number;
  end if;

  -- אישור הקוד האתי — אישי בלבד, והחותמת נקבעת בשרת
  if not is_self then
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
    new.ethics_code_version := old.ethics_code_version;
  elsif new.ethics_code_accepted_at is null then
    new.ethics_code_version := null;               -- ביטול אישור מנקה גם את הגרסה
  elsif old.ethics_code_accepted_at is null
        or new.ethics_code_version is distinct from old.ethics_code_version then
    new.ethics_code_accepted_at := now();          -- אישור חדש (או לגרסה חדשה) — עכשיו
  else
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
  end if;

  if is_self then
    new.role := old.role;
    new.active := old.active;
    new.agency_id := old.agency_id;
    -- צוות (20270525130000): השיוך לצוות נקבע בידי מנהל/ת המשרד בלבד. ה-RLS
    -- כבר מגביל עדכון של שורה אחרת למנהלים, ולכן כאן נחסם רק העדכון העצמי.
    new.team_id := old.team_id;
    -- "גם סוכן/ת פעיל/ה": סוכן/ת אינו/ה מוציא/ה את עצמו/ה מרוטציית הלידים.
    -- מנהל/ת כן קובע/ת את זה לעצמו/ה - אחרת במשרד עם מנהל/ת אחד/ת אין מי
    -- שיכול/ה לסמן את זה.
    if old.role is distinct from 'manager' then
      new.is_active_agent := old.is_active_agent;
    end if;
  end if;
  return new;
end;
$function$;


-- 3. עקביות הצוות --------------------------------------------------------------
-- ‏team_id חייב להצביע על צוות **באותו משרד**, ומי שעובר/ת משרד או מנותק/ת
-- ממנו יוצא/ת מהצוות ומניהול הצוות. טריגר נפרד ולא בתוך הקודם: הקודם יוצא
-- מוקדם להקשר מנהלתי (is_privileged), והעקביות חלה גם שם.
create or replace function public.agency_members_team_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agency_id is distinct from old.agency_id
     or (old.active and not new.active) then
    new.team_id := null;
    update public.agency_teams set lead_member_id = null where lead_member_id = new.id;
  end if;
  if new.team_id is not null and new.team_id is distinct from old.team_id
     and not exists (select 1 from public.agency_teams t
                      where t.id = new.team_id and t.agency_id = new.agency_id) then
    raise exception 'team_other_agency' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.agency_members_team_consistency() from public, anon, authenticated;

drop trigger if exists agency_members_team_consistency on public.agency_members;
create trigger agency_members_team_consistency
  before update of team_id, agency_id, active on public.agency_members
  for each row execute function public.agency_members_team_consistency();

-- 4. מה אני ---------------------------------------------------------------------
-- הצוות שהקורא/ת מנהל/ת, או null. לשימוש ב-RLS ובפונקציות של שלב 4.
create or replace function public.current_led_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
    from public.agency_teams t
    join public.agency_members m on m.id = t.lead_member_id
   where m.user_id = (select auth.uid()) and m.active
   limit 1;
$$;

revoke all on function public.current_led_team_id() from public, anon, authenticated;
grant execute on function public.current_led_team_id() to authenticated;

-- קריאה אחת בעליית ה-CRM: התפקיד, הצוות שאני בו, הצוות שאני מנהל/ת, והאם
-- אני גם סוכן/ת פעיל/ה.
create or replace function public.my_roles()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'role',            m.role,
           'is_active_agent', m.is_active_agent,
           'team_id',         m.team_id,
           'led_team_id',     (select t.id from public.agency_teams t where t.lead_member_id = m.id limit 1))
    from public.agency_members m
   where m.user_id = (select auth.uid())
   limit 1;
$$;

revoke all on function public.my_roles() from public, anon, authenticated;
grant execute on function public.my_roles() to authenticated;

-- 5. RLS -------------------------------------------------------------------------
-- קריאה לכל חברי המשרד (שם הצוות ומי מנהל/ת אותו אינם סוד). כתיבה למנהל/ת
-- משרד בלבד, באותו משרד, ומנהל/ת הצוות חייב/ת להיות חבר/ת אותו משרד.
alter table public.agency_teams enable row level security;

drop policy if exists "members read own agency teams" on public.agency_teams;
create policy "members read own agency teams" on public.agency_teams
  for select to authenticated
  using (agency_id = (select public.current_agency_id()));

drop policy if exists "managers write teams" on public.agency_teams;
create policy "managers write teams" on public.agency_teams
  for all to authenticated
  using ((select public.current_member_role()) = 'manager'
         and agency_id = (select public.current_agency_id()))
  with check (
    (select public.current_member_role()) = 'manager'
    and agency_id = (select public.current_agency_id())
    and (lead_member_id is null or exists (
          select 1 from public.agency_members m
           where m.id = lead_member_id and m.agency_id = agency_teams.agency_id))
  );

revoke all on table public.agency_teams from anon;
grant select, insert, update, delete on table public.agency_teams to authenticated;

-- 6. is_active_agent = false ------------------------------------------------------
-- (א) רוטציית לידי הבעלים: owner-lead-intake בוחר מועמדים ושולח אותם לכאן
-- לסידור. מי שאינו/ה סוכן/ת פעיל/ה יוצא/ת מהרשימה כאן, במקום אחד, ולא בכל
-- קורא. (מסד בלי השורה - id שאינו קיים - ממשיך להיכלל כמו קודם.)
create or replace function public.order_lead_candidates(p_agent_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(t.id order by t.score desc, t.id), '{}'::uuid[])
  from (
    select a.id, max(coalesce(r.composite_score, -1)) as score
    from unnest(p_agent_ids) as a(id)
    left join agent_rankings r on r.agent_id = a.id
    where not exists (select 1 from agency_members m
                       where m.id = a.id and m.is_active_agent = false)
    group by a.id
  ) t;
$function$;

-- כמו ב-20261227090000: service_role בלבד (owner-lead-intake)
revoke all on function public.order_lead_candidates(uuid[]) from public, anon, authenticated;
grant execute on function public.order_lead_candidates(uuid[]) to service_role;

-- (ב) ממוצע המשרד בדשבורד האישי. הגוף מ-20270406090000_my_dashboard.sql,
-- ושני שינויים: הספירה של v_n והשורות של avg_row - סוכנים פעילים בלבד.
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

  -- הסף של שלושה סוכנים והממוצע עצמו - רק סוכנים פעילים (is_active_agent,
  -- ‏20270525130000). מנהל/ת שאינו/ה עובד/ת כמתווך/ת היה מושך/ת את הממוצע לאפס.
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


revoke all on function public.my_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.my_dashboard(date, date) to authenticated;


-- (ג) מדריך הסוכנים באתר (agents.html) מסנן לפי העמודה החדשה, שנוספת **בסוף**
-- ה-view (create or replace view). דף המשרד ודף הסוכן/ת לא מסננים: מנהל/ת
-- שאינו/ה סוכן/ת פעיל/ה מוצג/ת שם. ההגדרה מ-20270321090000.
create or replace view public.agency_members_public as
 select id,
    agency_id,
    slug,
    display_name,
    bio,
    photo_url,
    role,
    active,
    phone_e164,
    cover_url,
    license_number,
    ((ethics_code_accepted_at is not null) and (ethics_badge_revoked_at is null)) as has_ethics_badge,
    years_experience,
    specialties,
    credentials,
    service_area,
    photo_position,
    gallery,
    page_bg,
    service_markets,
    is_active_agent
   from agency_members
  where ((active = true) and (license_number is not null)
         and (coalesce(license_status, ''::text) <> all (array['not_found'::text, 'inactive'::text])));

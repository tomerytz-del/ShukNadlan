-- ============================================================================
-- שווקים וצמיחה - שלב 6 בשדרוג אזור הניהול (docs/admin-redesign/HANDOFF.md, סעיף 6)
--
-- שלוש שאלות במסך אחד (`accGrowth`, ‏assets/crm-growth.js):
--   1. **מוכנות כל השווקים** - 37 ב-21.10.2026, לא רשימה סגורה (החלטה של
--      תומר מ-19.10.2026). המספרים מ-`market_snapshots` (שלב 1); הסף ו"חי
--      באתר" בדפדפן (`MARKET_GATE`, ‏assets/markets.js), כמו במרכז הפיקוד.
--   2. **משפך גיוס משרדים** - נרשמו → אימתו רישיון → נכס ראשון → משלמים.
--      "הוזמנו" אינו כאן: `agency_invitations` היא הזמנת **סוכן/ת למשרד**
--      בידי מנהל/ת, ולא הזמנת משרד בידי הפלטפורמה - אין רישום כזה, ולכן
--      המשפך מתחיל ב"נרשמו" (מה שההעברה קבעה למקרה הזה).
--   3. **קמפיינים** - מתוך קונסולת השיווק (`ads_campaigns`, ‏`ads_insights_daily`).
--      לא קונסולה שנייה: הפעולות נשארות ב-"קמפיינים · Meta ו-Google".
--
-- והפעולה היחידה שנוספת: **"תזכורת להעלאה"** לסוכני השוק (`admin_market_nudge`).
-- ============================================================================

select public.notification_types_add(array['market_nudge']);

-- ---------------------------------------------------------------------------
-- 1. התזכורת לשוק: יומן, אחת לשבוע לשוק
-- ---------------------------------------------------------------------------

create table if not exists public.admin_market_nudges (
  id          uuid primary key default gen_random_uuid(),
  market_slug text not null,
  sent_by     uuid references public.agency_members(id) on delete set null,
  recipients  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists admin_market_nudges_market_idx
  on public.admin_market_nudges (market_slug, created_at desc);

comment on table public.admin_market_nudges is
  'תזכורות "להעלות נכסים" שמנהל/ת הפלטפורמה שלח/ה לסוכני שוק. אחת לשבוע לשוק. docs/admin-growth.md';

alter table public.admin_market_nudges enable row level security;
-- נקראת רק דרך admin_growth (security definer)
revoke all on table public.admin_market_nudges from anon, authenticated, service_role;
grant select on table public.admin_market_nudges to service_role;

-- הסוכנים של שוק: משרד שהעיר שלו בשוק, או שאחד/ת מחבריו בחר/ה אותו כאזור
-- פעילות - אותו כלל של "משרדים בשוק" ב-_platform_market_report_core.
create or replace function public._market_agent_ids(p_market text)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id
    from public.agency_members m
   where m.active and m.released_at is null and m.closed_at is null
     and m.agency_id in (
       select a.id from public.agencies a
        where a.city_id in (select c.id from public.cities c where c.market_slug = p_market)
           or exists (select 1 from public.agency_members sm
                       where sm.agency_id = a.id and sm.active and sm.released_at is null
                         and p_market = any (sm.service_markets)));
$$;

revoke all on function public._market_agent_ids(text) from public, anon, authenticated;

create or replace function public.admin_market_nudge(p_market text, p_label text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- הסף מ-MARKET_GATE ב-assets/crm.js: משרד אחד ו-10 נכסים פעילים
  c_gate_props constant int := 10;
  v_label text := left(btrim(regexp_replace(translate(coalesce(p_label, ''), '—–', '--'), '\s+', ' ', 'g')), 60);
  v_props int;
  v_missing int;
  v_body text;
  v_n int;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cities c where c.market_slug = p_market) or v_label = '' then
    raise exception 'unknown_market' using errcode = '22023';
  end if;
  -- תזכורת היא בקשה מהסוכנים. פעם בשבוע לשוק, אחרת היא נעשית רעש
  if exists (select 1 from public.admin_market_nudges n
              where n.market_slug = p_market and n.created_at > now() - interval '7 days') then
    raise exception 'nudge_too_soon' using errcode = '22023';
  end if;

  select coalesce((s.data->'totals'->>'props_active')::int, 0) into v_props
    from public.market_snapshots s where s.market_slug = p_market;
  v_missing := greatest(0, c_gate_props - coalesce(v_props, 0));

  v_body := case
    when v_missing = 0 then 'יש כבר מספיק נכסים, והדף נפתח בקרוב. כל נכס נוסף שמעלים עכשיו יופיע בו מהיום הראשון.'
    when v_missing = 1 then 'חסר נכס פעיל אחד, ודף האזור נפתח לגולשים. כל נכס שמעלים עכשיו מקרב את הפתיחה.'
    else 'חסרים עוד ' || v_missing || ' נכסים פעילים, ודף האזור נפתח לגולשים. כל נכס שמעלים עכשיו מקרב את הפתיחה.'
  end;

  insert into public.notifications (agent_id, type, title, body)
  select a.id, 'market_nudge', 'דף ' || v_label || ' באתר קרוב לפתיחה', v_body
    from public._market_agent_ids(p_market) a(id);
  get diagnostics v_n = row_count;

  insert into public.admin_market_nudges (market_slug, sent_by, recipients)
  values (p_market, public.current_agent_id(), v_n);

  return jsonb_build_object('recipients', v_n, 'missing', v_missing);
end $$;

comment on function public.admin_market_nudge(text, text) is
  'תזכורת לסוכני שוק להעלות נכסים (פעמון, ומשם וואטסאפ). אחת לשבוע לשוק. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_market_nudge(text, text) from public, anon, authenticated;
grant execute on function public.admin_market_nudge(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. הנתונים של המסך
-- ---------------------------------------------------------------------------

create or replace function public.admin_growth()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  with office as materialized (
    select a.id, a.name, a.slug, a.created_at,
           public.agency_is_live(a.id) as licensed,
           exists (select 1 from public.properties p where p.agency_id = a.id) as has_property,
           -- מנוי בתשלום = paid_tier בתוקף; הטבת ההשקה אינה תשלום (כמו במרכז הפיקוד)
           exists (select 1 from public.agency_members m
                    where m.agency_id = a.id and m.active and m.released_at is null
                      and m.paid_tier in ('mid', 'premium')
                      and (m.paid_tier_until is null or m.paid_tier_until > now())) as paying
      from public.agencies a
  ),
  funnel as (
    select w.win,
           count(*)                                  as signed,
           count(*) filter (where o.licensed)        as licensed,
           count(*) filter (where o.licensed and o.has_property) as first_property,
           count(*) filter (where o.licensed and o.has_property and o.paying) as paying
      from (values ('all', null::interval), ('30d', interval '30 days')) w(win, span)
      join office o on w.span is null or o.created_at > now() - w.span
     group by w.win
  ),
  camp_stats as (
    select i.campaign_id,
           sum(i.spend) as spend, sum(i.leads) as leads,
           sum(coalesce(i.link_clicks, i.clicks)) as clicks
      from public.ads_insights_daily i
     where i.level = 'campaign' and i.day > current_date - 30
     group by i.campaign_id
  )
  select jsonb_build_object(
    'markets', coalesce((select jsonb_agg(jsonb_build_object(
                 'slug', s.market_slug,
                 'agencies', coalesce((s.data->'totals'->>'agencies')::int, 0),
                 'agents', coalesce((s.data->'totals'->>'agents')::int, 0),
                 'props_active', coalesce((s.data->'totals'->>'props_active')::int, 0),
                 'props_new_30d', coalesce((s.data->'totals'->>'props_new_30d')::int, 0),
                 'leads_30d', coalesce((s.data->'totals'->>'leads_30d')::int, 0),
                 'computed_at', s.computed_at,
                 'nudged_at', (select max(n.created_at) from public.admin_market_nudges n
                                where n.market_slug = s.market_slug)))
               from public.market_snapshots s where s.data is not null), '[]'::jsonb),
    'funnel', coalesce((select jsonb_object_agg(f.win, jsonb_build_object(
                 'signed', f.signed, 'licensed', f.licensed,
                 'first_property', f.first_property, 'paying', f.paying))
               from funnel f), '{}'::jsonb),
    -- המשרדים שנתקעו ברישיון: השלב שבו הדף לא מוצג באתר (docs/broker-registry.md)
    'stuck_license', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', o.id, 'name', o.name, 'slug', o.slug, 'created_at', o.created_at)
                 order by o.created_at desc)
               from (select * from office where not licensed order by created_at desc limit 10) o), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'name', c.name, 'status', c.status, 'format', c.format,
                 'daily_budget', c.daily_budget, 'created_at', c.created_at,
                 'spend_30d', coalesce(cs.spend, 0), 'leads_30d', coalesce(cs.leads, 0),
                 'clicks_30d', coalesce(cs.clicks, 0)) order by c.created_at desc)
               from public.ads_campaigns c
               left join camp_stats cs on cs.campaign_id = c.meta_campaign_id), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

comment on function public.admin_growth() is
  'שווקים וצמיחה: מוכנות כל השווקים (market_snapshots), משפך גיוס המשרדים, המשרדים שנתקעו ברישיון והקמפיינים. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_growth() from public, anon, authenticated;
grant execute on function public.admin_growth() to authenticated;

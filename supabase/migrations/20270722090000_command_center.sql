-- ===========================================================================
-- מרכז הפיקוד של מנהל/ת הפלטפורמה, והודעה לכל הסוכנים
-- (שלב 4 בשדרוג האדמין, docs/admin-command-center.md)
-- ---------------------------------------------------------------------------
-- 1. ‏admin_command_center() - מה שמרכז הפיקוד צריך ואין לו מקור אחר:
--    בריאות המרקטפלייס עם התגים, מדידת זמן התגובה, ושורות בריאות המערכת.
--    ארבעת מספרי החודש באים מ-platform_admin_monthly_report הקיים, ו"דורש אותך
--    היום" מ-admin_inbox (שלב 3) - לא מחשבים אותם פעמיים.
--
--    ‏**הספים** (תומר, 21.10.2026), לפי מה שנספר ב-30 הימים האחרונים:
--      היצע  - נכסים חדשים לסוכן/ת: 1 ומעלה צומח, 0.3 עד 1 יציב, פחות - חלש.
--      ביקוש - לידים לסוכן/ת: 3 ומעלה (או צמיחה של 20% מול 30 הימים
--              שלפניהם) צומח, 1 עד 3 יציב, פחות - חלש.
--      כסף   - "בתחילת הדרך" עד 10 מנויים בתשלום; אחר כך לפי שינוי ההכנסה,
--              שמחושב בדפדפן מהדוח החודשי.
--    פחות מ-10 סוכנים פעילים - "בתחילת הדרך" גם להיצע ולביקוש: אין עוד בסיס
--    לשפוט. ‏**זמן התגובה אינו משפיע על התג**: ב-21.10.2026 רק 7 מ-40 לידים
--    סומנו "נענו" (סוכנים עונים גם מחוץ ל-CRM), והוא מוצג עם המדגם שלו.
--
-- 2. ‏admin_broadcast(title, body) - הודעה לכל הסוכנים הפעילים: שורה
--    ב-notifications מסוג platform_broadcast לכל סוכן/ת, ומשם הפעמון
--    והוואטסאפ דרך notification-push - **באותם שערים של כל התראה**: שעות
--    ושקט, מרווח הקיבוץ והתקרה היומית של כל סוכן/ת. הסוג אינו בעדיפות
--    (notification_push_priority_types) בכוונה: הודעה לכולם היא בדיוק מה
--    שאסור שיעקוף את התקרה מול Meta (הסקיל agent-notifications, סעיף 8).
--    ‏admin_broadcasts שומרת את ההודעה, וסוכנים קוראים אותה שם ("הודעות
--    מהפלטפורמה" בתפריט הפרופיל).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. מרכז הפיקוד
-- ---------------------------------------------------------------------------
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
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
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
      'cron_failed_24h', coalesce((select jsonb_agg(distinct j.jobname)
                                     from cron.job_run_details d
                                     join cron.job j on j.jobid = d.jobid
                                    where d.status = 'failed' and d.start_time > now() - interval '24 hours'), '[]'::jsonb),
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

-- ---------------------------------------------------------------------------
-- 2. הודעה לכל הסוכנים
-- ---------------------------------------------------------------------------
create table if not exists public.admin_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 2 and 80),
  body        text not null check (char_length(body) between 2 and 600),
  recipients  integer not null default 0,
  sent_by     uuid,
  created_at  timestamptz not null default now()
);

comment on table public.admin_broadcasts is
  'הודעות שמנהל/ת הפלטפורמה שלח/ה לכל הסוכנים (admin_broadcast). כל סוכן/ת פעיל/ה קורא/ת אותן ב"הודעות מהפלטפורמה".';

alter table public.admin_broadcasts enable row level security;
drop policy if exists admin_broadcasts_agents_read on public.admin_broadcasts;
create policy admin_broadcasts_agents_read on public.admin_broadcasts
  for select to authenticated
  using (public.current_agent_id() is not null);

-- ‏authenticated קוראת (סוכנים, ב-RLS) וכותבת רק דרך admin_broadcast.
-- ‏service_role אינו ניגש: הפונקציה היא security definer של הבעלים.
revoke all on table public.admin_broadcasts from anon, authenticated, service_role;
grant select on table public.admin_broadcasts to authenticated;

select public.notification_types_add(array['platform_broadcast']);

create or replace function public.admin_broadcast(p_title text, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- שורה אחת בלי מקף ארוך: בתבנית בוואטסאפ Meta דוחה מעבר שורה בפרמטר, והאתר
  -- אינו מציג מקף ארוך (CLAUDE.md). הניקוי כאן ולא רק בדפדפן - זה מה שנשמר.
  v_title text := btrim(regexp_replace(translate(coalesce(p_title, ''), '—–', '--'), '\s+', ' ', 'g'));
  v_body  text := btrim(regexp_replace(translate(coalesce(p_body, ''),  '—–', '--'), '\s+', ' ', 'g'));
  v_id    uuid;
  v_n     integer;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if char_length(v_title) < 2 or char_length(v_title) > 80
     or char_length(v_body) < 2 or char_length(v_body) > 600 then
    raise exception 'broadcast_length' using errcode = '22023';
  end if;
  -- לחיצה כפולה או שליחה חוזרת בטעות: הודעה לכולם אחת לעשר דקות
  if exists (select 1 from public.admin_broadcasts b where b.created_at > now() - interval '10 minutes') then
    raise exception 'broadcast_too_soon' using errcode = '22023';
  end if;

  insert into public.admin_broadcasts (title, body, sent_by)
  values (v_title, v_body, public.current_agent_id())
  returning id into v_id;

  insert into public.notifications (agent_id, type, title, body)
  select m.id, 'platform_broadcast', v_title, v_body
    from public.agency_members m
   where m.active and m.released_at is null;
  get diagnostics v_n = row_count;

  update public.admin_broadcasts set recipients = v_n where id = v_id;
  return jsonb_build_object('id', v_id, 'recipients', v_n);
end $$;

comment on function public.admin_broadcast(text, text) is
  'הודעה לכל הסוכנים הפעילים: פעמון, ובוואטסאפ דרך notification-push באותם שערים של כל התראה (שקט, מרווח, תקרה). אחת לעשר דקות. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_broadcast(text, text) from public, anon, authenticated;
grant execute on function public.admin_broadcast(text, text) to authenticated;

comment on function public.admin_command_center() is
  'מרכז הפיקוד של מנהל/ת הפלטפורמה: בריאות המרקטפלייס עם התגים, זמן התגובה עם המדגם שלו, בריאות המערכת, מוכנות השווקים וההודעות האחרונות. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_command_center() from public, anon, authenticated;
grant execute on function public.admin_command_center() to authenticated;

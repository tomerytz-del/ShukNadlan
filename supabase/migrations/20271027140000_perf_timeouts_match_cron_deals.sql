-- ============================================================================
-- שלושה timeouts: התאמות ב-CRM, מרכז הפיקוד, ואינדקס העסקאות
--
-- ## 1. client_property_match בלי search_path
--
-- שתי העומסים הם LANGUAGE sql IMMUTABLE עם SET search_path = ''. פונקציית
-- SQL עם SET אינה מוטמעת, ולכן match_properties_for_client קוראת לה כקופסה
-- שחורה לכל זוג לקוח/ה x נכס (כ-3ms לקריאה). client_match_top עוברת על כל
-- הלקוחות הפעילים ונופלת ב-statement_timeout של 8 שניות (נמדד 23.5 שניות
-- לסוכן/ת עם 78 לקוחות).
--
-- RESET search_path משאיר את הגוף כמו שהוא ומאפשר הטמעה. הגוף מלא
-- בסכימה (public.*), הפונקציות אינן SECURITY DEFINER, ושני הקוראים
-- (match_properties_for_client, client_match_*) הם SECURITY DEFINER עם
-- search_path = '' - אז אחרי ההטמעה ה-search_path האפקטיבי נשאר ריק.
-- יועץ האבטחה של Supabase יציג אותן תחת function_search_path_mutable.
-- זה חריג מתועד, לא חור: הבדיקה ב-ops_agent/probes/security.py נשארת
-- על SECURITY DEFINER בלבד, ובכוונה אינה כוללת את שתי אלה.
--
-- ## 2. cron.job_run_details
--
-- admin_command_center.health.cron_failed_24h סרק את כל היסטוריית ה-cron
-- (מאות אלפי שורות, בלי אינדקס על end_time). הבעלים הוא supabase_admin,
-- ולכן אין להוסיף אינדקס מכאן. השאילתה חסומה ל-30000 runid אחרונים
-- (המפתח המונוטוני) ועדיין מסננת 24 שעות ו-status = failed.
--
-- ניקוי יומי ב-pg_cron שומר 3 ימים. כל הרצה מוחקת במנות של 50,000, עד
-- 400,000 שורות, כדי לא להחזיק מחיקה אחת ענקית. המחיקה הראשונה אינה
-- בתוך המיגרציה: המיגרציה היא טרנזקציה אחת, אי אפשר COMMIT בין מנות,
-- ו-VACUUM אינו רץ בתוך טרנזקציה. אחרי המחיקות autovacuum מחזיר את
-- המקום לשימוש חוזר. VACUUM FULL (החזרה למערכת ההפעלה) דורש נעילה
-- בלעדית מול כתיבה כל דקה - לא כאן.
--
-- ההרשאות של admin_command_center אינן משתנות: SECURITY DEFINER,
-- search_path ריק, EXECUTE ל-authenticated בלבד, והבדיקה
-- current_is_platform_admin() נשארת.
--
-- ## 3. deal_settlements_public
--
-- כל קריאה (anon, timeout של 3 שניות, אינדקס /deals וה-sitemap) צברה
-- את כל market_deals_official. private.deal_city_stats מחזיקה שורה
-- לעיר. אין לה הרשאות ל-anon ול-authenticated, והסכימה private אינה
-- חשופה. הרענון השעתי הוא REFRESH CONCURRENTLY (דורש את האינדקס
-- הייחודי). בסוף "עדכן עסקאות" (deal_sync_run_finish) רענון רגיל,
-- כי CONCURRENTLY אינו רץ בתוך טרנזקציה. מנוע deals_engine כותב
-- ישירות לטבלה ולא דרך הפונקציה הזו - אותו רענון שעתי מכסה אותו.
-- העמודות, הסדר, ו-SECURITY DEFINER עם אותן הרשאות (anon,
-- authenticated, service_role) נשארים.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הטמעת ציון ההתאמה
-- ---------------------------------------------------------------------------

alter function public.client_property_match(public.agent_clients, public.properties, text[])
  reset search_path;
alter function public.client_property_match(public.agent_clients, public.properties)
  reset search_path;

comment on function public.client_property_match(public.agent_clients, public.properties, text[]) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד, עם הסיבות לכל פער. אפס שורות = נפילה בסינון קשיח (כולל מאפיין חובה חסר שאינו ב-p_waive_features). p_waive_features רק לקריאה שהסוכן/ת אישר/ה בה ויתור. בלי search_path בכוונה (20271027140000): גוף SQL שצריך להיות מוטמע. לא SECURITY DEFINER, הגוף בסכימה מלאה, והקוראים נועלים search_path. חריג מתועד ל-function_search_path_mutable.';

comment on function public.client_property_match(public.agent_clients, public.properties) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד - עטיפה של הגרסה עם p_waive_features, בלי ויתור. אפס שורות = נפילה בסינון קשיח (כולל מאפיין חובה חסר, תקרת שטח, ובעל/ת נכס שאינו/ה מחפש/ת). מקור האמת של פאנל ההתאמות, ההתראות והבוט. בלי search_path מאותה סיבה כמו הגרסה בשלושה ארגומנטים (20271027140000).';

-- ---------------------------------------------------------------------------
-- סכימה שאינה ב-Data API. האובייקטים שבה נקראים רק מ-SECURITY DEFINER
-- ומ-pg_cron, שניהם כבעלים.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. ניקוי היסטוריית cron
-- ---------------------------------------------------------------------------

create or replace function private.cron_history_retention(p_max integer default 400000)
returns integer
language plpgsql
security definer
set search_path = ''
as $ret$
declare
  batch integer;
  total integer := 0;
  cap integer := least(greatest(coalesce(p_max, 50000), 1), 400000);
begin
  -- שורות שהריצה שלהן עוד פתוחה: end_time הוא null, והתנאי אינו בוחר אותן.
  loop
    delete from cron.job_run_details
     where runid in (
       select d.runid
         from cron.job_run_details d
        where d.end_time < now() - interval '3 days'
        order by d.runid
        limit 50000
     );
    get diagnostics batch = row_count;
    total := total + batch;
    exit when batch = 0 or total >= cap;
  end loop;
  return total;
end
$ret$;

revoke all on function private.cron_history_retention(integer) from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - ניקוי היסטוריית ה-cron לא ירוץ';
    return;
  end if;
  perform cron.unschedule('cron-history-retention')
    where exists (select 1 from cron.job where jobname = 'cron-history-retention');
  perform cron.schedule(
    'cron-history-retention',
    '23 3 * * *',
    'select private.cron_history_retention(400000)'
  );
end
$$;

-- ---------------------------------------------------------------------------
-- שאילתת מרכז הפיקוד. הגוף זהה ל-20270722090000 חוץ מחלון ה-runid.
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
      -- 30000 runid אחרונים מכסים יותר מ-24 שעות (כ-16 אלף הרצות ביום).
      -- אין אינדקס על end_time: הטבלה בבעלות supabase_admin.
      'cron_failed_24h', coalesce((select jsonb_agg(distinct j.jobname)
                                     from cron.job_run_details d
                                     join cron.job j on j.jobid = d.jobid
                                    where d.runid > (select max(runid) - 30000 from cron.job_run_details)
                                      and d.status = 'failed'
                                      and d.start_time > now() - interval '24 hours'), '[]'::jsonb),
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
  'מרכז הפיקוד של מנהל/ת הפלטפורמה: בריאות המרקטפלייס עם התגים, זמן התגובה עם המדגם שלו, בריאות המערכת, מוכנות השווקים וההודעות האחרונות. מנהל/ת פלטפורמה בלבד (42501). cron_failed_24h סורק רק 30000 runid אחרונים (20271027140000).';

revoke all on function public.admin_command_center() from public, anon, authenticated;
grant execute on function public.admin_command_center() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. צבירת עסקאות לפי עיר, מחוץ ל-API
-- ---------------------------------------------------------------------------

create materialized view if not exists private.deal_city_stats as
  select o.city,
         count(*)::int as n,
         max(o.sold_at) as newest,
         max(o.imported_at) as last_import
    from public.market_deals_official o
   group by o.city;

create unique index if not exists deal_city_stats_city_uidx
  on private.deal_city_stats (city);

revoke all on table private.deal_city_stats from public, anon, authenticated, service_role;

comment on materialized view private.deal_city_stats is
  'שורה לעיר מ-market_deals_official, ל-deal_settlements_public. מתרעננת כל שעה ובסוף עדכן עסקאות. אין גישה ל-anon ול-authenticated.';

-- הרצה חוזרת של המיגרציה (if not exists דילג על היצירה) עדיין מרעננת.
refresh materialized view private.deal_city_stats;

create or replace function public.deal_settlements_public()
returns table (name text, slug text, deals int, newest date, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $pub$
  select s.name, s.slug, d.n, d.newest,
         coalesce(s.last_synced_at, d.last_import)
    from public.deal_settlements s
    join private.deal_city_stats d on d.city = s.name
   where s.active
   order by d.n desc, s.name;
$pub$;

comment on function public.deal_settlements_public() is
  'היישובים הפעילים שיש להם עסקאות - לאינדקס /deals ול-sitemap. יישוב בלי עסקאות אינו נחשף, כדי לא להציף את גוגל בדפים ריקים. הספירה מ-private.deal_city_stats (20271027140000), לא סריקה של market_deals_official.';

revoke all on function public.deal_settlements_public() from public, anon, authenticated;
grant execute on function public.deal_settlements_public() to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - צבירת העסקאות לפי עיר לא תתרענן';
    return;
  end if;
  perform cron.unschedule('deal-city-stats-refresh')
    where exists (select 1 from cron.job where jobname = 'deal-city-stats-refresh');
  perform cron.schedule(
    'deal-city-stats-refresh',
    '41 * * * *',
    'refresh materialized view concurrently private.deal_city_stats'
  );
end
$$;

-- סוף "עדכן עסקאות". רענון רגיל (לא CONCURRENTLY) כי זו טרנזקציה.
-- כשל ברענון אינו מבטל את סגירת ההרצה: הרענון השעתי הוא רשת הביטחון.

create or replace function public.deal_sync_run_finish()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fin$
declare
  v_id  bigint;
  v_res jsonb;
begin
  if not public.deal_sync_caller_ok() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select id into v_id from public.deal_sync_runs
   where finished_at is null order by updated_at desc limit 1;
  if v_id is null then
    -- אין הרצה פתוחה (לא עובד אף יישוב, או שכבר נסגרה): מחזירים את האחרונה,
    -- בלי התראה נוספת.
    select jsonb_build_object('run_id', id, 'already_closed', true, 'summary', summary)
      into v_res
      from public.deal_sync_runs order by started_at desc limit 1;
    return coalesce(v_res, jsonb_build_object('summary', 'לא נרשם עדיין אף עדכון.'));
  end if;
  v_res := public.deal_sync_close_run(v_id, 'agent');
  begin
    refresh materialized view private.deal_city_stats;
  exception when others then
    raise warning 'deal_city_stats refresh failed: %', sqlerrm;
  end;
  return v_res;
end
$fin$;

comment on function public.deal_sync_run_finish() is
  'הסוכן קורא לה בסוף עדכן עסקאות: סוגרת את ההרצה, מחזירה את הסיכום ושולחת אותו למנהלי/ות הפלטפורמה, ומרעננת את private.deal_city_stats. מנהל/ת פלטפורמה או service_role.';

revoke all on function public.deal_sync_run_finish() from public, anon, authenticated;
grant execute on function public.deal_sync_run_finish() to authenticated, service_role;

-- ============================================================================
-- משרדי הדגמה יוצאים מדוחות הפלטפורמה.
--
-- משרד "משרד הדגמה" (cf863e10-c25d-41ed-8b22-d6899a56e95d, slug
-- demo-office-play-review, ובו חשבון הבדיקה play.review@shuknadlan.co.il)
-- הוא חשבון אמיתי שנשאר נגיש וגלוי. הנתונים שלו - המשרד, הסוכנים שלו,
-- המודעות שלו והלידים שלו - נספרים היום בדוחות הניהול כאילו היו פעילות
-- של לקוח. מכאן is_demo, ושלוש הפונקציות נבנות מחדש מההגדרה האחרונה שלהן
-- בריפו (זהה למה שרץ בפרודקשן):
--   platform_admin_monthly_report  20260916090000
--   platform_lead_report            20261122090000
--   platform_inventory_report       20261127090000
--
-- מה יוצא: המשרד עצמו, חבריו, המודעות שלו (properties.agency_id), ליד
-- ששויך אליו או לסוכן/ת שלו או למודעה שלו, חיפוש שמור ששויך אליו, ורכישות
-- וחיובים של המשרד או של סוכן/ת שלו. ליד שוק בלי משרד (משכנתא, RSS, פרויקט,
-- חיפוש שמור בלי agency_id) נשאר. מנהלי הפלטפורמה (is_platform_admin)
-- נספרים כמו קודם.
--
-- זרעי בדיקה מקומיים ב-scripts/*_setup.sql אינם משרדים בפרודקשן, ולא
-- מסומנים כאן. אין שינוי בגישה למשרד ההדגמה ואין שינוי בתצוגה שלו באתר.
-- העמודה נעולה בפני כתיבה מהדפדפן, בהכנסה ובעדכון: רק service_role
-- והתפקידים של המיגרציה משנים אותה. בהכנסה של תפקיד אחר היא נכפית ל-false.
-- ============================================================================

alter table public.agencies
  add column if not exists is_demo boolean not null default false;

comment on column public.agencies.is_demo is
  'משרד הדגמה. דוחות הפלטפורמה לא סופרים אותו, את הלידים שלו ואת המודעות שלו. אינו משנה גישה או תצוגה באתר.';

update public.agencies
   set is_demo = true
 where id = 'cf863e10-c25d-41ed-8b22-d6899a56e95d'::uuid
    or slug = 'demo-office-play-review';

-- ---------------------------------------------------------------------------
-- עזרים. security definer כדי שהדוחות (שגם הם definer) יקראו את הדגל בלי
-- להיתקל ב-RLS. לא נפתחים ל-anon או ל-authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.agency_is_demo(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.is_demo from public.agencies a where a.id = p_agency_id), false);
$$;

create or replace function public.agent_is_demo(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.agency_is_demo((select m.agency_id from public.agency_members m where m.id = p_agent_id));
$$;

create or replace function public.property_is_demo(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.agency_is_demo((select pr.agency_id from public.properties pr where pr.id = p_property_id));
$$;

create or replace function public.lead_is_demo(p_agency_id uuid, p_agent_id uuid, p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.agency_is_demo(p_agency_id)
      or public.agent_is_demo(p_agent_id)
      or public.property_is_demo(p_property_id);
$$;

comment on function public.agency_is_demo(uuid) is
  'true כשהמשרד מסומן is_demo. מזהה ריק הוא false.';
comment on function public.agent_is_demo(uuid) is
  'true כשהסוכן/ת שייך/ת למשרד הדגמה.';
comment on function public.property_is_demo(uuid) is
  'true כשהמודעה שייכת למשרד הדגמה.';
comment on function public.lead_is_demo(uuid, uuid, uuid) is
  'true כשהליד שויך למשרד הדגמה, לסוכן/ת שלו, או למודעה שלו.';

revoke all on function public.agency_is_demo(uuid) from public, anon, authenticated;
revoke all on function public.agent_is_demo(uuid) from public, anon, authenticated;
revoke all on function public.property_is_demo(uuid) from public, anon, authenticated;
revoke all on function public.lead_is_demo(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.agency_is_demo(uuid) to service_role;
grant execute on function public.agent_is_demo(uuid) to service_role;
grant execute on function public.property_is_demo(uuid) to service_role;
grant execute on function public.lead_is_demo(uuid, uuid, uuid) to service_role;

-- העמודה לא זזה בכתיבה מהדפדפן. service_role, postgres והמיגרציה כן
-- כותבים אותה (אותו כלל כמו protect_agency_ethics_fields). בהכנסה של
-- תפקיד אחר is_demo נכפה ל-false, כדי שאי אפשר לסמן משרד כהדגמה.
create or replace function public.protect_agency_is_demo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or auth.role() = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_demo := false;
  elsif tg_op = 'UPDATE' then
    new.is_demo := old.is_demo;
  end if;
  return new;
end;
$$;

comment on function public.protect_agency_is_demo() is
  'נועל את agencies.is_demo בפני כתיבה מהדפדפן. בהכנסה של תפקיד שאינו service_role או postgres הערך נכפה ל-false. service_role והמיגרציה כותבים.';

revoke all on function public.protect_agency_is_demo() from public, anon;
grant execute on function public.protect_agency_is_demo() to authenticated, service_role;

drop trigger if exists agencies_protect_is_demo on public.agencies;
create trigger agencies_protect_is_demo
  before insert or update on public.agencies
  for each row execute function public.protect_agency_is_demo();


create or replace function public.platform_admin_monthly_report(p_months integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_months  integer := least(greatest(coalesce(p_months, 6), 2), 24);
  v_first   date    := (date_trunc('month', now())::date - ((v_months - 1) || ' months')::interval)::date;
  v_result  jsonb;
begin
  -- הבדיקה קודמת לכל שאילתה. ‏42501 = insufficient_privilege, כדי שהדפדפן
  -- יוכל להבחין בין "אין לך הרשאה" לבין תקלה אמיתית.
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  with months as (
    select gs::date as m
      from generate_series(v_first, date_trunc('month', now())::date, interval '1 month') gs
  ),
  -- ---- הצטרפויות ----
  new_agencies as (
    select date_trunc('month', created_at)::date m, count(*) n
      from agencies where not is_demo and created_at >= v_first group by 1
  ),
  new_agents as (
    select date_trunc('month', created_at)::date m,
           count(*) n,
           count(*) filter (where role = 'manager') managers,
           count(*) filter (where tier <> 'free')   paid
      from agency_members where not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
  ),
  -- ---- לידים לפי סוג ----
  site_leads as (
    select date_trunc('month', created_at)::date m,
           count(*) filter (where lead_type = 'property_inquiry')     property_inquiry,
           count(*) filter (where lead_type = 'owner_inbound')        owner_inbound,
           count(*) filter (where lead_type = 'agent_direct_inquiry') agent_direct_inquiry,
           count(*) filter (where lead_type = 'visualization')        visualization
      from leads l where not public.lead_is_demo(l.agency_id, l.agent_id, l.property_id) and l.created_at >= v_first group by 1
  ),
  mortgage_new as (
    select date_trunc('month', created_at)::date m, count(*) n
      from mortgage_leads where created_at >= v_first group by 1
  ),
  rss_new as (
    select date_trunc('month', created_at)::date m, count(*) n
      from rss_leads where is_lead and created_at >= v_first group by 1
  ),
  buyer_new as (
    select date_trunc('month', created_at)::date m, count(*) n
      from saved_searches where not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
  ),
  -- ---- הכנסות לפי מקור ----
  rev_site as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from lead_charges where status = 'success' and not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
  ),
  rev_rss as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from rss_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
  ),
  rev_mortgage as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from mortgage_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
  ),
  rev_buyer as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from saved_search_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
  ),
  rev_promo as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from promotion_charges where status in ('active', 'expired') and not public.agent_is_demo(agent_id) and not public.property_is_demo(property_id) and created_at >= v_first group by 1
  ),
  topups as (
    select date_trunc('month', created_at)::date m, coalesce(sum(amount), 0) v
      from wallet_topups where status = 'success' and not public.agent_is_demo(agent_id) and created_at >= v_first group by 1
  ),
  -- ---- פעילות נלווית ----
  new_props as (
    select date_trunc('month', created_at)::date m, count(*) n
      from properties where not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
  ),
  deals as (
    select date_trunc('month', sold_at)::date m, count(*) n, coalesce(sum(sale_price), 0) v
      from market_deals where sold_at >= v_first group by 1
  ),
  new_reviews as (
    select date_trunc('month', created_at)::date m, count(*) n
      from reviews where not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
  ),
  new_subs as (
    select date_trunc('month', created_at)::date m, count(*) n
      from newsletter_subscribers where created_at >= v_first group by 1
  ),
  monthly as (
    select
      to_char(mo.m, 'YYYY-MM')                     as month,
      coalesce(ag.n, 0)                            as agencies_new,
      coalesce(am.n, 0)                            as agents_new,
      coalesce(am.managers, 0)                     as managers_new,
      coalesce(am.paid, 0)                         as paid_agents_new,
      jsonb_build_object(
        'property_inquiry',     coalesce(sl.property_inquiry, 0),
        'owner_inbound',        coalesce(sl.owner_inbound, 0),
        'agent_direct_inquiry', coalesce(sl.agent_direct_inquiry, 0),
        'visualization',        coalesce(sl.visualization, 0),
        'mortgage',             coalesce(ml.n, 0),
        'rss',                  coalesce(rn.n, 0),
        'saved_search',         coalesce(bn.n, 0)
      )                                            as leads,
      coalesce(sl.property_inquiry, 0) + coalesce(sl.owner_inbound, 0)
        + coalesce(sl.agent_direct_inquiry, 0) + coalesce(sl.visualization, 0)
        + coalesce(ml.n, 0) + coalesce(rn.n, 0) + coalesce(bn.n, 0)
                                                   as leads_total,
      jsonb_build_object(
        'site_leads',   jsonb_build_object('amount', coalesce(rs.v, 0), 'count', coalesce(rs.n, 0)),
        'rss_leads',    jsonb_build_object('amount', coalesce(rr.v, 0), 'count', coalesce(rr.n, 0)),
        'mortgage',     jsonb_build_object('amount', coalesce(rm.v, 0), 'count', coalesce(rm.n, 0)),
        'saved_search', jsonb_build_object('amount', coalesce(rb.v, 0), 'count', coalesce(rb.n, 0)),
        'promotions',   jsonb_build_object('amount', coalesce(rp.v, 0), 'count', coalesce(rp.n, 0))
      )                                            as revenue,
      coalesce(rs.v, 0) + coalesce(rr.v, 0) + coalesce(rm.v, 0)
        + coalesce(rb.v, 0) + coalesce(rp.v, 0)    as revenue_total,
      coalesce(tu.v, 0)                            as topups,
      coalesce(np.n, 0)                            as properties_new,
      coalesce(dl.n, 0)                            as deals_closed,
      coalesce(dl.v, 0)                            as deals_volume,
      coalesce(nr.n, 0)                            as reviews_new,
      coalesce(ns.n, 0)                            as newsletter_new
    from months mo
    left join new_agencies ag on ag.m = mo.m
    left join new_agents   am on am.m = mo.m
    left join site_leads   sl on sl.m = mo.m
    left join mortgage_new ml on ml.m = mo.m
    left join rss_new      rn on rn.m = mo.m
    left join buyer_new    bn on bn.m = mo.m
    left join rev_site     rs on rs.m = mo.m
    left join rev_rss      rr on rr.m = mo.m
    left join rev_mortgage rm on rm.m = mo.m
    left join rev_buyer    rb on rb.m = mo.m
    left join rev_promo    rp on rp.m = mo.m
    left join topups       tu on tu.m = mo.m
    left join new_props    np on np.m = mo.m
    left join deals        dl on dl.m = mo.m
    left join new_reviews  nr on nr.m = mo.m
    left join new_subs     ns on ns.m = mo.m
    order by mo.m
  ),
  -- ---- פירוט לפי משרד בתוך החלון ----
  -- ‏agencies קריא לכולם ממילא (policy "public read agencies"), ולכן שם
  -- המשרד כאן אינו חשיפה חדשה. מה שחדש הוא הסכום לצידו.
  agency_rev as (
    select agency_id, sum(v) v, sum(n) n from (
      select agency_id, coalesce(sum(amount), 0) v, count(*) n
        from lead_charges where status = 'success' and not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
      union all
      select agency_id, coalesce(sum(amount), 0), count(*)
        from rss_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
      union all
      select agency_id, coalesce(sum(amount), 0), count(*)
        from mortgage_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
      union all
      select agency_id, coalesce(sum(amount), 0), count(*)
        from saved_search_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id) and created_at >= v_first group by 1
    ) u where agency_id is not null group by 1
  ),
  agency_rows as (
    select a.id, a.name, a.created_at,
           (select count(*) from agency_members m where m.agency_id = a.id and m.active) members,
           (select count(*) from agency_members m where m.agency_id = a.id and m.active and m.tier <> 'free') paid_members,
           (select count(*) from properties p where p.agency_id = a.id and p.status = 'active') active_properties,
           coalesce(ar.v, 0) revenue,
           coalesce(ar.n, 0) purchases
      from agencies a
      left join agency_rev ar on ar.agency_id = a.id
     where not a.is_demo
  )
  select jsonb_build_object(
    'generated_at', now(),
    'months_back',  v_months,
    'from_month',   to_char(v_first, 'YYYY-MM'),

    -- ‏order by בתוך ה-jsonb_agg ולא ב-CTE: סדר של CTE אינו מובטח לאגרגציה
    -- שמעליו, ו-'YYYY-MM' לקסיקוגרפי הוא ממילא הסדר הכרונולוגי
    'months', (select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb) from monthly m),

    -- תמונת "עכשיו", לא חודשית: כמה יש בסך הכל ברגע זה
    'totals', jsonb_build_object(
      'agencies',            (select count(*) from agencies where not is_demo),
      'agents',              (select count(*) from agency_members where not public.agency_is_demo(agency_id)),
      'agents_active',       (select count(*) from agency_members where active and not public.agency_is_demo(agency_id)),
      'managers',            (select count(*) from agency_members where active and role = 'manager' and not public.agency_is_demo(agency_id)),
      'mortgage_advisors',   (select count(*) from agency_members where active and is_mortgage_advisor and not public.agency_is_demo(agency_id)),
      'tier_free',           (select count(*) from agency_members where active and tier = 'free' and not public.agency_is_demo(agency_id)),
      'tier_mid',            (select count(*) from agency_members where active and tier = 'mid' and not public.agency_is_demo(agency_id)),
      'tier_premium',        (select count(*) from agency_members where active and tier = 'premium' and not public.agency_is_demo(agency_id)),
      'pending_invitations', (select count(*) from agency_invitations where status = 'pending' and not public.agency_is_demo(agency_id)),
      'properties_active',   (select count(*) from properties where status = 'active' and not public.agency_is_demo(agency_id)),
      'properties_total',    (select count(*) from properties where not public.agency_is_demo(agency_id)),
      'properties_promoted', (select count(*) from properties where is_promoted and coalesce(promoted_until, now()) >= now() and not public.agency_is_demo(agency_id)),
      'wallet_balance',      (select coalesce(sum(credit_balance), 0) from agency_members where active and not public.agency_is_demo(agency_id)),
      'newsletter',          (select count(*) from newsletter_subscribers where unsubscribed_at is null),
      'saved_searches',      (select count(*) from saved_searches where status = 'active' and not public.agency_is_demo(agency_id))
    ),

    -- התור הפתוח: מה יושב עכשיו בלי שאיש נגע בו, וכמה ימים הישן ביותר
    'untreated', jsonb_build_object(
      'site_leads',      (select count(*) from leads where status = 'masked' and not public.lead_is_demo(agency_id, agent_id, property_id)),
      'site_unassigned', (select count(*) from leads where agent_id is null and not public.lead_is_demo(agency_id, agent_id, property_id)),
      'rss_leads',       (select count(*) from rss_leads where is_lead and status = 'new'),
      'mortgage_leads',  (select count(*) from mortgage_leads where status = 'new'),
      'saved_searches',  (select count(*) from saved_searches where lead_status = 'new' and not public.agency_is_demo(agency_id)),
      'unrouted',        (select count(*) from lead_routing_log where routing = 'unrouted' and resolved_at is null),
      'reviews_pending', (select count(*) from reviews where status = 'pending'),
      'oldest_days',     (select coalesce(max(extract(day from now() - created_at))::int, 0)
                            from leads where status = 'masked' and not public.lead_is_demo(agency_id, agent_id, property_id))
    ),

    'agencies', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.revenue desc, r.members desc), '[]'::jsonb)
        from agency_rows r
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.platform_admin_monthly_report(integer) is
  'לוח הבקרה החודשי של מנהל/ת הפלטפורמה: הצטרפויות, לידים לפי סוג, תור ללא טיפול והכנסות לפי מקור. מספרים בלבד — אין בה PII. מסרבת למי שאינו/ה מנהל/ת פלטפורמה. משרד הדגמה (is_demo), הלידים שלו והמודעות שלו אינם נספרים.';

-- הפונקציה עוקפת RLS בכוונה, ולכן ההרשאה עליה מצומצמת: משתמש/ת מחובר/ת
-- בלבד (הבדיקה בגוף הפונקציה עושה את השאר), ואף פעם לא anon.
revoke all on function public.platform_admin_monthly_report(integer) from public;
revoke all on function public.platform_admin_monthly_report(integer) from anon;
grant execute on function public.platform_admin_monthly_report(integer) to authenticated;


create or replace function public.platform_lead_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days    integer := least(greatest(coalesce(p_days, 30), 1), 730);
  v_from    timestamptz;
  v_hot     numeric;
  v_warm    numeric;
  v_cooling numeric;
  v_bucket  text;
  v_result  jsonb;
begin
  -- הבדיקה קודמת לכל שאילתה. ‏42501 = insufficient_privilege, כדי שהדפדפן
  -- יבחין בין "אין לך הרשאה" לבין תקלה אמיתית.
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_from := date_trunc('day', now()) - ((v_days - 1) || ' days')::interval;

  -- ההגדרה נקראת פעם אחת, לא פעם לכל שורה
  select coalesce(max(value) filter (where key = 'lead_hot_hours'),     24),
         coalesce(max(value) filter (where key = 'lead_warm_hours'),    72),
         coalesce(max(value) filter (where key = 'lead_cooling_hours'), 168)
    into v_hot, v_warm, v_cooling
    from pricing_config;

  -- דלי הזמן בגרף נגזר מאורך החלון: 90 עמודות יומיות על מסך טלפון אינן
  -- גרף אלא רעש, ושבוע בודד מחולק לחודשים הוא עמודה אחת.
  v_bucket := case when v_days <= 45 then 'day'
                   when v_days <= 200 then 'week'
                   else 'month' end;

  with
  -- =====================================================================
  -- השדרה: שורה אחת לכל ליד במערכת, מכל חמש הטבלאות
  -- =====================================================================
  spine as (
    -- ליד אתר (הערכת שווי, פנייה על נכס, פנייה ישירה לסוכן/ת, הדמיה)
    select
      'leads'::text as lead_table,
      l.id          as lead_id,
      l.created_at,
      coalesce(
        rl.source,
        nullif(btrim(l.source), ''),
        -- גזירה דטרמיניסטית: לכל lead_type יש בדיוק פונקציית קליטה אחת
        case l.lead_type
          when 'visualization'        then 'property_page_visualization'
          when 'property_inquiry'     then 'property_page_inquiry'
          when 'agent_direct_inquiry' then 'agent_page_direct'
          when 'owner_inbound'        then 'homepage_owner_wizard'
        end,
        'unattributed'
      )             as source,
      coalesce(rl.lead_kind,
        case when l.lead_type = 'owner_inbound' then 'agent_owner' else 'agent_buyer' end
      )             as lead_kind,
      l.lead_type   as lead_type,
      coalesce(rl.routing,
        case when l.agent_id is null then 'unrouted' else 'assigned' end
      )             as routing,
      l.agency_id,
      l.unlocked_at as touched_at
    from leads l
    left join lead_routing_log rl
      on rl.lead_table = 'leads' and rl.lead_id = l.id
    where not public.lead_is_demo(l.agency_id, l.agent_id, l.property_id)

    union all

    -- מחפש/ת דירה — חיפוש שמור. ‏agency_id לא-null = נוצר בדף משרד ושויך לו
    select
      'saved_searches', s.id, s.created_at,
      coalesce(rl.source, 'unattributed'),
      'agent_buyer',
      'saved_search',
      coalesce(rl.routing,
        case when not coalesce(s.consent_agent_contact, false) then 'no_consent'
             when s.agency_id is not null                     then 'assigned'
             else 'shelf' end),
      s.agency_id,
      s.sold_at
    from saved_searches s
    left join lead_routing_log rl
      on rl.lead_table = 'saved_searches' and rl.lead_id = s.id
    where not public.agency_is_demo(s.agency_id)

    union all

    -- ייעוץ משכנתאות. ‏mortgage_leads.source הוא אוצר מילים ישן ומצומצם
    -- יותר מזה של היומן, ולכן הוא מתורגם למזהי הווידג'טים.
    select
      'mortgage_leads', m.id, m.created_at,
      coalesce(rl.source,
        case m.source
          when 'homepage_calculator' then 'homepage_mortgage_calc'
          when 'property_page'       then 'property_page_mortgage_calc'
          when 'whatsapp_bot'        then 'whatsapp_bot_mortgage_calc'
          else 'unattributed'
        end),
      'mortgage_advisor',
      'mortgage',
      coalesce(rl.routing, 'shelf'),
      null::uuid,
      m.sold_at
    from mortgage_leads m
    left join lead_routing_log rl
      on rl.lead_table = 'mortgage_leads' and rl.lead_id = m.id

    union all

    -- מנוע ה-RSS. אין לו רישום ביומן (הוא סקרייפר ולא edge function), אבל
    -- המקור שלו ידוע לחלוטין — כל שורה בטבלה הזו נולדה שם.
    select
      'rss_leads', r.id, r.created_at,
      'rss_engine',
      case when r.lead_side in ('מוכר פרטי', 'משכיר') then 'agent_owner' else 'agent_buyer' end,
      'rss',
      'shelf',
      null::uuid,
      r.sold_at
    from rss_leads r
    where r.is_lead

    union all

    -- מחפש/ת פרויקט חדש — מדף היזמים
    select
      'project_leads', p.id, p.created_at,
      coalesce(nullif(btrim(p.source), ''), 'unattributed'),
      'developer',
      'project',
      case when coalesce(p.consent_contact, false) then 'shelf' else 'no_consent' end,
      null::uuid,
      p.sold_at
    from project_leads p
  ),

  -- =====================================================================
  -- הרכישות — כל חמשת ערוצי המכירה, בטבלה אחת
  -- =====================================================================
  purchases as (
    select 'leads'::text as lead_table, lead_id, agency_id, amount, created_at
      from lead_charges where status = 'success' and not public.agency_is_demo(agency_id)
    union all
    select 'rss_leads', lead_id, agency_id, amount, created_at
      from rss_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id)
    union all
    select 'mortgage_leads', lead_id, agency_id, amount, created_at
      from mortgage_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id)
    union all
    select 'saved_searches', search_id, agency_id, amount, created_at
      from saved_search_lead_purchases where status = 'success' and not public.agency_is_demo(agency_id)
    -- ליד פרויקט נקנה בידי יזם ולא בידי משרד תיווך, ולכן agency_id ריק:
    -- ההכנסה נספרת, והשיוך למשרד — לא, כי אין כזה.
    union all
    select 'project_leads', lead_id, null::uuid, amount, created_at
      from project_lead_purchases where status = 'success'
  ),
  purchase_by_lead as (
    select lead_table, lead_id, sum(amount) as amount
      from purchases group by 1, 2
  ),

  -- כל השדרה, עם ההכנסה, הערוץ והגיל
  enriched as (
    select
      s.*,
      public.lead_source_channel(s.source) as channel,
      coalesce(pb.amount, 0)               as revenue,
      (pb.lead_id is not null)             as sold,
      -- ליד שנולד פתוח אינו מודד זמן תגובה.
      --
      -- ליד מדף משרד, מדף סוכן/ת או תיבת ההדמיות נכנס כבר במצב unlocked —
      -- ‏unlocked_at שווה ל-created_at, ואין בו רגע אחד של המתנה. בלי
      -- ההבחנה הזו 26 הדמיות מושכות את החציון לאפס ומכריזות על זמן תגובה
      -- מושלם על מדד שלא נמדד בכלל.
      --
      -- שנייה אחת ולא אפס: ההוספה ל-leads והפתיחה הן שתי כתיבות, ו-clock
      -- זז ביניהן במיקרו-שניות.
      case when s.touched_at > s.created_at + interval '1 second'
           then extract(epoch from (s.touched_at - s.created_at)) / 3600.0
      end                                  as response_hours,
      (s.touched_at is not null
        and s.touched_at <= s.created_at + interval '1 second') as born_open,
      extract(epoch from (now() - s.created_at)) / 3600.0 as age_hours
    from spine s
    left join purchase_by_lead pb
      on pb.lead_table = s.lead_table and pb.lead_id = s.lead_id
  ),

  -- מה שנקלט בתוך החלון. זו הבסיס לכל מה שאינו "עכשיו".
  win as (
    select * from enriched where created_at >= v_from
  ),

  -- =====================================================================
  -- פילוחים
  -- =====================================================================
  by_source as (
    select
      w.source, w.channel,
      -- הקהל השכיח למקור הזה. מקור אחד יכול להזין שני קהלים (הבוט מזין
      -- שלושה), ולכן זו תווית ולא מפתח.
      mode() within group (order by w.lead_kind)            as lead_kind,
      count(*)                                              as leads,
      count(*) filter (where w.routing = 'assigned')        as assigned,
      count(*) filter (where w.routing = 'shelf')           as shelf,
      count(*) filter (where w.routing = 'unrouted')        as unrouted,
      count(*) filter (where w.routing = 'no_consent')      as no_consent,
      count(*) filter (where w.sold)                        as sold,
      count(*) filter (where w.touched_at is not null)      as touched,
      coalesce(sum(w.revenue), 0)                           as revenue
    from win w group by 1, 2
  ),
  by_channel as (
    select
      w.channel,
      count(*)                                              as leads,
      count(distinct w.source)                              as sources,
      count(*) filter (where w.routing in ('assigned','shelf')) as routed,
      count(*) filter (where w.routing = 'unrouted')        as unrouted,
      count(*) filter (where w.routing = 'no_consent')      as no_consent,
      count(*) filter (where w.sold)                        as sold,
      coalesce(sum(w.revenue), 0)                           as revenue
    from win w group by 1
  ),
  by_kind as (
    select
      w.lead_kind,
      count(*)                                              as leads,
      count(*) filter (where w.routing = 'unrouted')        as unrouted,
      count(*) filter (where w.sold)                        as sold,
      count(*) filter (where w.touched_at is not null)      as touched,
      coalesce(sum(w.revenue), 0)                           as revenue
    from win w group by 1
  ),

  -- =====================================================================
  -- המגמה — דלי לכל יום/שבוע/חודש, עם פילוח לערוצים בתוכו
  --
  -- ‏generate_series ולא group by על הנתונים בלבד: חלון שבו יומיים בלי
  -- לידים חייב להראות שתי עמודות אפס ולא לדלג עליהן, אחרת הגרף משקר לגבי
  -- הקצב.
  -- =====================================================================
  buckets as (
    select gs as bucket_start,
           gs + (case v_bucket when 'day'  then interval '1 day'
                               when 'week' then interval '1 week'
                               else interval '1 month' end) as bucket_end
      from generate_series(
             date_trunc(v_bucket, v_from),
             date_trunc(v_bucket, now()),
             (case v_bucket when 'day'  then interval '1 day'
                            when 'week' then interval '1 week'
                            else interval '1 month' end)
           ) gs
  ),
  trend_totals as (
    select b.bucket_start,
           count(x.lead_id)                        as leads,
           count(x.lead_id) filter (where x.sold)  as sold,
           coalesce(sum(x.revenue), 0)             as revenue
      from buckets b
      left join win x
        on x.created_at >= b.bucket_start and x.created_at < b.bucket_end
     group by b.bucket_start
  ),
  trend_rows as (
    select
      to_char(t.bucket_start, 'YYYY-MM-DD') as bucket,
      t.leads, t.sold, t.revenue,
      coalesce(c.channels, '{}'::jsonb)     as channels
    from trend_totals t
    left join (
      select b.bucket_start,
             jsonb_object_agg(ch.channel, ch.n) as channels
        from buckets b
        join lateral (
          select x.channel, count(*) n
            from win x
           where x.created_at >= b.bucket_start and x.created_at < b.bucket_end
           group by x.channel
        ) ch on true
       group by b.bucket_start
    ) c on c.bucket_start = t.bucket_start
  ),

  -- =====================================================================
  -- התור הפתוח — מה תקוע *עכשיו*, לפי טמפרטורה
  --
  -- לא נתון חלון: ליד שנקלט לפני חודשיים ועדיין לא נגעו בו הוא הבעיה
  -- הגדולה ביותר כאן, ודווקא הוא היה נופל מחלון של 30 יום.
  --
  -- ‏no_consent אינו נספר: הפונה ביקש/ה התראות בלבד, ואין מה "לטפל" בו.
  -- =====================================================================
  open_now as (
    select e.*,
           public.lead_temperature(e.age_hours, v_hot, v_warm, v_cooling) as temp
      from enriched e
     where e.touched_at is null
       and e.routing <> 'no_consent'
  ),
  open_by_temp as (
    select temp, count(*) n, coalesce(sum(revenue), 0) v
      from open_now group by 1
  ),
  open_by_kind as (
    select lead_kind,
           count(*)                                    as n,
           count(*) filter (where temp = 'hot')        as hot,
           count(*) filter (where temp = 'warm')       as warm,
           count(*) filter (where temp = 'cooling')    as cooling,
           count(*) filter (where temp = 'cold')       as cold,
           round(max(age_hours), 1)                    as oldest_hours
      from open_now group by 1
  ),

  -- =====================================================================
  -- זמן התגובה — כמה מהר נוגעים בליד
  --
  -- רק לידים שנגעו בהם: חציון של "עד עכשיו" על ליד נטוש אינו זמן תגובה
  -- אלא גיל, וזה כבר נמדד בתור הפתוח.
  -- =====================================================================
  touched_win as (
    select * from win where response_hours is not null
  ),

  -- =====================================================================
  -- לפי משרד — "קיבל" ולא "שילם"
  -- =====================================================================
  agency_assigned as (
    select w.agency_id, w.lead_type, count(*) n
      from win w where w.agency_id is not null
     group by 1, 2
  ),
  -- רכישה מהמדף היא קבלה של ליד *נוסף*. פתיחת ליד ששויך ממילא (lead_charges
  -- על leads) אינה — ולכן היא מוחרגת כאן ונספרת בנפרד כ"נפתחו".
  agency_bought as (
    select p.agency_id, e.lead_type, count(*) n, coalesce(sum(p.amount), 0) v
      from purchases p
      join enriched e on e.lead_table = p.lead_table and e.lead_id = p.lead_id
     where p.created_at >= v_from
       and p.agency_id is not null
       and p.lead_table <> 'leads'
     group by 1, 2
  ),
  agency_opened as (
    select p.agency_id, count(*) n, coalesce(sum(p.amount), 0) v
      from purchases p
     where p.created_at >= v_from and p.agency_id is not null and p.lead_table = 'leads'
     group by 1
  ),
  agency_spend as (
    select p.agency_id, coalesce(sum(p.amount), 0) v, count(*) n
      from purchases p
     where p.created_at >= v_from and p.agency_id is not null
     group by 1
  ),
  agency_types as (
    select agency_id, jsonb_object_agg(lead_type, n) types, sum(n) total
      from (
        select agency_id, lead_type, sum(n) n from (
          select agency_id, lead_type, n from agency_assigned
          union all
          select agency_id, lead_type, n from agency_bought
        ) u group by 1, 2
      ) g
     group by 1
  ),
  agency_rows as (
    select
      a.id, a.name,
      coalesce(ty.total, 0)                         as received,
      coalesce(ty.types, '{}'::jsonb)               as by_type,
      coalesce((select sum(n) from agency_assigned x where x.agency_id = a.id), 0) as assigned,
      coalesce((select sum(n) from agency_bought   x where x.agency_id = a.id), 0) as bought,
      coalesce(ao.n, 0)                             as opened,
      coalesce(sp.v, 0)                             as spend,
      (select count(*) from agency_members m where m.agency_id = a.id and m.active) as members
    from agencies a
    left join agency_types  ty on ty.agency_id = a.id
    left join agency_opened ao on ao.agency_id = a.id
    left join agency_spend  sp on sp.agency_id = a.id
   where not a.is_demo
  )

  select jsonb_build_object(
    'generated_at', now(),
    'range', jsonb_build_object(
      'days',   v_days,
      'from',   to_char(v_from, 'YYYY-MM-DD'),
      'to',     to_char(now(), 'YYYY-MM-DD'),
      'bucket', v_bucket
    ),

    -- ההגדרה נוסעת עם הנתונים, כדי שהדפדפן יציג את הסף האמיתי ולא יקודד
    -- עותק שלו שיישאר מאחור ביום שהערך יכויל.
    'policy', jsonb_build_object(
      'hot_hours',     v_hot,
      'warm_hours',    v_warm,
      'cooling_hours', v_cooling
    ),

    'totals', (
      select jsonb_build_object(
        'leads',       count(*),
        'assigned',    count(*) filter (where routing = 'assigned'),
        'shelf',       count(*) filter (where routing = 'shelf'),
        'unrouted',    count(*) filter (where routing = 'unrouted'),
        'no_consent',  count(*) filter (where routing = 'no_consent'),
        'sold',        count(*) filter (where sold),
        'touched',     count(*) filter (where touched_at is not null),
        -- הגיע לסוכן/ת פתוח מהרגע הראשון (דף משרד, דף סוכן/ת, הדמיה):
        -- נספר כליד לכל דבר, ומוחרג ממדידת זמן התגובה
        'born_open',   count(*) filter (where born_open),
        'waited',      count(*) filter (where response_hours is not null),
        'revenue',     coalesce(sum(revenue), 0),
        'sources',     count(distinct source),
        'channels',    count(distinct channel),
        'unattributed', count(*) filter (where source = 'unattributed')
      ) from win
    ),

    'by_channel', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.leads desc, c.channel), '[]'::jsonb)
        from by_channel c
    ),
    'by_source', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.leads desc, s.source), '[]'::jsonb)
        from by_source s
    ),
    'by_kind', (
      select coalesce(jsonb_agg(to_jsonb(k) order by k.leads desc), '[]'::jsonb)
        from by_kind k
    ),
    'trend', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.bucket), '[]'::jsonb)
        from trend_rows t
    ),

    'open_queue', jsonb_build_object(
      'total',        (select count(*) from open_now),
      -- ‏coalesce *סביב* התת-שאילתה ולא בתוכה: דלי ריק אינו מחזיר שורה
      -- אחת עם אפס אלא אפס שורות, ותת-שאילתה סקלרית ריקה היא null.
      'hot',          coalesce((select n from open_by_temp where temp = 'hot'), 0),
      'warm',         coalesce((select n from open_by_temp where temp = 'warm'), 0),
      'cooling',      coalesce((select n from open_by_temp where temp = 'cooling'), 0),
      'cold',         coalesce((select n from open_by_temp where temp = 'cold'), 0),
      'oldest_hours', (select coalesce(round(max(age_hours))::int, 0) from open_now),
      'by_kind',      (select coalesce(jsonb_agg(to_jsonb(k) order by k.n desc), '[]'::jsonb)
                         from open_by_kind k)
    ),

    -- ‏percentile_cont ולא avg בלבד: ליד אחד שנפתח אחרי חודש מזיז ממוצע של
    -- עשרה לידים שנענו תוך שעה לשש שעות, והחציון אומר את האמת על הרוב.
    'response', (
      select jsonb_build_object(
        'touched',      count(*),
        'median_hours', round(coalesce(percentile_cont(0.5)
                          within group (order by response_hours), 0)::numeric, 1),
        'avg_hours',    round(coalesce(avg(response_hours), 0)::numeric, 1),
        'within_hot',   count(*) filter (where response_hours <= v_hot),
        'within_warm',  count(*) filter (where response_hours <= v_warm)
      ) from touched_win
    ),

    'agencies', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.received desc, r.spend desc, r.name), '[]'::jsonb)
        from agency_rows r
       where r.received > 0 or r.opened > 0
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.platform_lead_report(integer) is
  'בקרת מנוע הלידים למנהל/ת הפלטפורמה: מקור וערוץ של כל ליד שנקלט, פילוח לפי קהל, מגמה, תור פתוח לפי טמפרטורה, זמן תגובה ופירוט לפי משרד. מספרים בלבד — אין בה PII. מסרבת למי שאינו/ה מנהל/ת פלטפורמה. משרד הדגמה (is_demo), הלידים שלו והמודעות שלו אינם נספרים.';

-- הפונקציה עוקפת RLS בכוונה, ולכן ההרשאה מצומצמת: משתמש/ת מחובר/ת בלבד
-- (הבדיקה בגוף הפונקציה עושה את השאר), ואף פעם לא anon.
revoke all on function public.platform_lead_report(integer) from public;
revoke all on function public.platform_lead_report(integer) from anon;
grant execute on function public.platform_lead_report(integer) to authenticated;


create or replace function public.platform_inventory_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_from timestamptz;
  v_out  jsonb;
begin
  if not current_is_platform_admin() then
    raise exception 'הדוח פתוח למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;

  v_days := greatest(1, least(365, coalesce(p_days, 30)));
  v_from := now() - make_interval(days => v_days);

  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,

    -- ================================================== אנשים ועסקים
    'people', jsonb_build_object(
      'agencies',           (select count(*) from agencies where not is_demo),
      'agencies_new',       (select count(*) from agencies where not is_demo and created_at >= v_from),
      'agents',             (select count(*) from agency_members where active and not public.agency_is_demo(agency_id)),
      'agents_total',       (select count(*) from agency_members where not public.agency_is_demo(agency_id)),
      'agents_new',         (select count(*) from agency_members where not public.agency_is_demo(agency_id) and created_at >= v_from),
      'agents_closed',      (select count(*) from agency_members where not public.agency_is_demo(agency_id) and closed_at is not null),
      'agents_onboarded',   (select count(*) from agency_members where not public.agency_is_demo(agency_id) and onboarding_done_at is not null),
      'platform_admins',    (select count(*) from agency_members where is_platform_admin),
      'mortgage_advisors',  (select count(*) from agency_members where not public.agency_is_demo(agency_id) and is_mortgage_advisor and active),
      'developers',         (select count(*) from developers),
      'developers_new',     (select count(*) from developers where created_at >= v_from),
      -- לפי מסלול: זו התשובה ל"כמה מהם משלמים"
      'by_tier', (
        select coalesce(jsonb_object_agg(tier, n), '{}'::jsonb)
          from (select coalesce(tier, 'ללא') as tier, count(*) as n
                  from agency_members where active and not public.agency_is_demo(agency_id) group by 1) t
      ),
      'paying', (select count(*) from agency_members
                  where active and paid_tier is not null
                    and (paid_tier_until is null or paid_tier_until > now())
                    and not public.agency_is_demo(agency_id)),
      'license_verified', (select count(*) from agency_members
                            where active and license_status = 'verified'
                              and not public.agency_is_demo(agency_id))
    ),

    -- ================================================== נכסים
    'properties', jsonb_build_object(
      'total',        (select count(*) from properties where not public.agency_is_demo(agency_id)),
      'active',       (select count(*) from properties where not public.agency_is_demo(agency_id) and status = 'active'),
      'new',          (select count(*) from properties where not public.agency_is_demo(agency_id) and created_at >= v_from),
      'promoted',     (select count(*) from properties
                        where not public.agency_is_demo(agency_id) and is_promoted and (promoted_until is null or promoted_until > now())),
      'open_house',   (select count(*) from properties where not public.agency_is_demo(agency_id) and open_house),
      'with_images',  (select count(*) from properties
                        where not public.agency_is_demo(agency_id) and status = 'active' and coalesce(array_length(images, 1), 0) > 0),
      'with_video',   (select count(*) from properties
                        where not public.agency_is_demo(agency_id) and status = 'active' and video_url is not null),
      'with_tour',    (select count(*) from properties
                        where not public.agency_is_demo(agency_id) and status = 'active' and has_virtual_tour),
      'with_text',    (select count(*) from properties
                        where not public.agency_is_demo(agency_id) and status = 'active' and marketing_description is not null),
      'geocoded',     (select count(*) from properties
                        where not public.agency_is_demo(agency_id) and status = 'active' and lat is not null and lng is not null),
      'avg_price',    (select round(avg(price)) from properties
                        where not public.agency_is_demo(agency_id) and status = 'active' and price > 0),
      'median_price', (select round(percentile_cont(0.5) within group (order by price))
                         from properties where not public.agency_is_demo(agency_id) and status = 'active' and price > 0),
      'by_status', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from properties where not public.agency_is_demo(agency_id) group by 1) t
      ),
      'by_deal', (
        select coalesce(jsonb_object_agg(deal_type, n), '{}'::jsonb)
          from (select coalesce(deal_type, '—') as deal_type, count(*) as n
                  from properties where not public.agency_is_demo(agency_id) and status = 'active' group by 1) t
      ),
      'by_category', (
        select coalesce(jsonb_object_agg(category, n), '{}'::jsonb)
          from (select coalesce(category, '—') as category, count(*) as n
                  from properties where not public.agency_is_demo(agency_id) and status = 'active' group by 1) t
      ),
      'top_cities', (
        select coalesce(jsonb_agg(x.c order by x.n desc), '[]'::jsonb)
          from (select jsonb_build_object('city', coalesce(city, '—'), 'n', count(*)) as c,
                       count(*) as n
                  from properties where not public.agency_is_demo(agency_id) and status = 'active'
                 group by city order by count(*) desc limit 8) x
      )
    ),

    -- ================================================== שיתופי פעולה
    -- זו השאלה שהפלטפורמה כולה נבנתה סביבה, ולכן היא קבוצה משלה ולא
    -- שורה בתוך "נכסים".
    'collaboration', jsonb_build_object(
      'shares',            (select count(*) from property_shares where not public.agency_is_demo(owner_agency_id) and not public.agency_is_demo(shared_with_agency_id) and not public.property_is_demo(property_id)),
      'shares_new',        (select count(*) from property_shares where not public.agency_is_demo(owner_agency_id) and not public.agency_is_demo(shared_with_agency_id) and not public.property_is_demo(property_id) and created_at >= v_from),
      'properties_shared', (select count(distinct property_id) from property_shares where not public.agency_is_demo(owner_agency_id) and not public.agency_is_demo(shared_with_agency_id) and not public.property_is_demo(property_id)),
      'agencies_sharing',  (select count(distinct owner_agency_id) from property_shares where not public.agency_is_demo(owner_agency_id) and not public.agency_is_demo(shared_with_agency_id) and not public.property_is_demo(property_id)),
      'agencies_receiving',(select count(distinct shared_with_agency_id) from property_shares where not public.agency_is_demo(owner_agency_id) and not public.agency_is_demo(shared_with_agency_id) and not public.property_is_demo(property_id)),
      'opted_in',          (select count(*) from properties
                             where not public.agency_is_demo(agency_id) and status = 'active' and shared_with_partners),
      'opted_out_agents',  (select count(*) from agent_share_exclusions where not public.agency_is_demo(agency_id)),
      -- הסכמים: הצורה המשפטית של שיתוף הפעולה
      'agreements',        (select count(*) from agreements where not public.agency_is_demo(agency_id)),
      'agreements_signed', (select count(*) from agreements where not public.agency_is_demo(agency_id) and status = 'signed'),
      'agreements_new',    (select count(*) from agreements where not public.agency_is_demo(agency_id) and created_at >= v_from),
      'agreements_by_kind', (
        select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
          from (select coalesce(kind, '—') as kind, count(*) as n
                  from agreements where not public.agency_is_demo(agency_id) group by 1) t
      ),
      'agreements_by_status', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from agreements where not public.agency_is_demo(agency_id) group by 1) t
      ),
      'exclusivities_active', (select count(*) from property_exclusivities
                                where released_at is null
                                  and (ends_on is null or ends_on >= current_date)
                                  and not public.agency_is_demo(agency_id) and not public.property_is_demo(property_id)),
      'contracts',         (select count(*) from contracts where not public.agency_is_demo(agency_id) and not public.property_is_demo(property_id)),
      'contracts_signed',  (select count(*) from contracts where not public.agency_is_demo(agency_id) and not public.property_is_demo(property_id) and status = 'signed')
    ),

    -- ================================================== לקוחות המתווכים
    'clients', jsonb_build_object(
      'total',      (select count(*) from agent_clients where not public.agency_is_demo(agency_id)),
      'active',     (select count(*) from agent_clients where not public.agency_is_demo(agency_id) and status = 'active'),
      'new',        (select count(*) from agent_clients where not public.agency_is_demo(agency_id) and created_at >= v_from),
      'with_agent', (select count(distinct agent_id) from agent_clients where not public.agency_is_demo(agency_id)),
      'per_agent',  (select round(count(*)::numeric
                                  / greatest(count(distinct agent_id), 1), 1)
                       from agent_clients where not public.agency_is_demo(agency_id)),
      'by_deal', (
        select coalesce(jsonb_object_agg(deal_type, n), '{}'::jsonb)
          from (select coalesce(deal_type, '—') as deal_type, count(*) as n
                  from agent_clients where not public.agency_is_demo(agency_id) group by 1) t
      ),
      -- התאמות שהמערכת מצאה ללקוחות האלה — זו התמורה שהם מקבלים
      'matches',      (select count(*) from client_match_alerts where not public.agent_is_demo(agent_id) and not public.property_is_demo(property_id)),
      'matches_new',  (select count(*) from client_match_alerts where not public.agent_is_demo(agent_id) and not public.property_is_demo(property_id) and created_at >= v_from),
      'matches_seen', (select count(*) from client_match_alerts where not public.agent_is_demo(agent_id) and not public.property_is_demo(property_id) and seen_at is not null)
    ),

    -- ================================================== מדיה והדמיות
    'media', jsonb_build_object(
      'visualizations',       (select count(*) from property_visualizations where not public.property_is_demo(property_id)),
      'visualizations_done',  (select count(*) from property_visualizations
                                where not public.property_is_demo(property_id) and status = 'done'),
      'visualizations_new',   (select count(*) from property_visualizations
                                where not public.property_is_demo(property_id) and created_at >= v_from),
      'visualizations_by_kind', (
        select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
          from (select coalesce(kind, '—') as kind, count(*) as n
                  from property_visualizations where not public.property_is_demo(property_id) group by 1) t
      ),
      'visualization_jobs', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from visualization_jobs where not public.property_is_demo(property_id) group by 1) t
      ),
      'videos',        (select count(*) from property_video_jobs where not public.property_is_demo(property_id) and result_url is not null),
      'videos_new',    (select count(*) from property_video_jobs
                         where not public.property_is_demo(property_id) and result_url is not null and created_at >= v_from),
      'video_jobs', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from property_video_jobs where not public.property_is_demo(property_id) group by 1) t
      ),
      'virtual_tours', (select count(*) from property_virtual_tours where not public.property_is_demo(property_id)),
      'image_tags',    (select count(*) from property_image_tags where not public.property_is_demo(property_id)),
      'project_media', (select count(*) from project_media)
    ),

    -- ================================================== לידים וביקוש
    'demand', jsonb_build_object(
      'leads',        (select count(*) from leads where not public.lead_is_demo(agency_id, agent_id, property_id)),
      'leads_new',    (select count(*) from leads where not public.lead_is_demo(agency_id, agent_id, property_id) and created_at >= v_from),
      'leads_open',   (select count(*) from leads where not public.lead_is_demo(agency_id, agent_id, property_id) and unlocked_at is null),
      'leads_by_type', (
        select coalesce(jsonb_object_agg(lead_type, n), '{}'::jsonb)
          from (select coalesce(lead_type, '—') as lead_type, count(*) as n
                  from leads where not public.lead_is_demo(agency_id, agent_id, property_id) group by 1) t
      ),
      'leads_by_status', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from leads where not public.lead_is_demo(agency_id, agent_id, property_id) group by 1) t
      ),
      'mortgage_leads',  (select count(*) from mortgage_leads),
      'project_leads',   (select count(*) from project_leads),
      'rss_leads',       (select count(*) from rss_leads where is_lead),
      'rss_leads_sold',  (select count(*) from rss_leads where sold_at is not null),
      'saved_searches',  (select count(*) from saved_searches where status = 'active' and not public.agency_is_demo(agency_id)),
      'saved_alerts_sent', (select coalesce(sum(alerts_sent), 0) from saved_searches where not public.agency_is_demo(agency_id)),
      'reviews',         (select count(*) from reviews where status = 'published' and not public.agency_is_demo(agency_id)),
      'avg_rating',      (select round(avg(rating)::numeric, 2) from reviews
                           where status = 'published' and not public.agency_is_demo(agency_id))
    ),

    -- ================================================== כסף
    -- כל שורה כאן היא סכום של עסקאות שהצליחו בלבד, וכל טבלה נמדדת לפי
    -- **ערך הסטטוס שלה עצמה**: ‏`success` בטעינות ובמנויים, ‏`charged`
    -- בחיובי הסרטונים והפרויקטים, ‏`paid` בטעינות של יזמים, ו-
    -- ‏`active`/`expired` בקידומים (שם 'expired' פירושו חודש שהסתיים,
    -- כלומר כסף שכן נגבה). ערך אחיד אחד לכל הטבלאות היה מחזיר אפס
    -- בשקט בחצי מהשורות — וזו בדיוק הצורה של מספר ניהולי שגוי.
    --
    -- ‏test_mode מוחרג: טעינת בדיקה שנספרת כהכנסה היא איך שמספר הופך
    -- לחסר ערך.
    'money', jsonb_build_object(
      'topups',        (select coalesce(sum(amount), 0) from wallet_topups
                         where status = 'success' and not coalesce(test_mode, false)
                           and not public.agent_is_demo(agent_id)),
      'topups_window', (select coalesce(sum(amount), 0) from wallet_topups
                         where status = 'success' and not coalesce(test_mode, false)
                           and not public.agent_is_demo(agent_id)
                           and created_at >= v_from),
      'refunds',       (select coalesce(sum(amount), 0) from wallet_refunds
                         where status = 'completed' and not public.agent_is_demo(agent_id)),
      'lead_charges',  (select coalesce(sum(amount), 0) from lead_charges
                         where status = 'success' and not public.agency_is_demo(agency_id)),
      'rss_purchases', (select coalesce(sum(amount), 0) from rss_lead_purchases
                         where status = 'success' and not public.agency_is_demo(agency_id)),
      'mortgage_purchases', (select coalesce(sum(amount), 0) from mortgage_lead_purchases
                              where status = 'success' and not public.agency_is_demo(agency_id)),
      'search_purchases',   (select coalesce(sum(amount), 0) from saved_search_lead_purchases
                              where status = 'success' and not public.agency_is_demo(agency_id)),
      'promotions',    (select coalesce(sum(amount), 0) from promotion_charges
                         where status in ('active', 'expired') and not public.agent_is_demo(agent_id) and not public.property_is_demo(property_id)),
      'videos',        (select coalesce(sum(amount), 0) from property_video_charges
                         where status = 'charged' and not public.agent_is_demo(agent_id) and not public.property_is_demo(property_id)),
      'subscriptions', (select coalesce(sum(amount), 0) from subscription_orders
                         where status = 'success' and not coalesce(test_mode, false) and not public.agent_is_demo(agent_id)),
      'ads',           (select coalesce(sum(amount), 0) from ad_orders
                         where status = 'success' and not coalesce(test_mode, false)),
      'project_charges', (select coalesce(sum(amount), 0) from project_charges
                           where status = 'charged'),
      'developer_topups', (select coalesce(sum(amount), 0) from developer_topups
                            where status = 'paid' and not coalesce(test_mode, false)),
      'wallet_balance', (select coalesce(sum(credit_balance), 0) from agency_members
                          where active and not public.agency_is_demo(agency_id)),
      'invoices',      (select count(*) from invoices),
      -- טעינות בדיקה — מוצגות בנפרד כדי שיהיה ברור שהן קיימות ולא נספרות
      'test_topups',   (select count(*) from wallet_topups where coalesce(test_mode, false) and not public.agent_is_demo(agent_id))
    ),

    -- ================================================== פרויקטים חדשים
    'projects', jsonb_build_object(
      'total',      (select count(*) from projects),
      'published',  (select count(*) from projects where status = 'active'),
      'new',        (select count(*) from projects where created_at >= v_from),
      'units',      (select coalesce(sum(total_units), 0) from projects
                      where status = 'active'),
      'units_free', (select coalesce(sum(available_units), 0) from projects
                      where status = 'active'),
      'views',      (select count(*) from project_views where viewed_at >= v_from)
    ),

    -- ================================================== קהל ותנועה
    'audience', jsonb_build_object(
      'property_views',   (select count(*) from property_views where not public.property_is_demo(property_id) and viewed_at >= v_from),
      'unique_visitors',  (select count(distinct visitor_session_id)
                             from property_views where not public.property_is_demo(property_id) and viewed_at >= v_from),
      'newsletter',       (select count(*) from newsletter_subscribers
                            where unsubscribed_at is null),
      'newsletter_new',   (select count(*) from newsletter_subscribers
                            where created_at >= v_from and unsubscribed_at is null),
      'open_house_subs',  (select count(*) from open_house_subscribers
                            where unsubscribed_at is null),
      'whatsapp_chats',   (select count(*) from whatsapp_conversations),
      'whatsapp_public',  (select count(*) from whatsapp_public_conversations),
      'whatsapp_in',      (select count(*) from whatsapp_messages
                            where direction = 'in' and created_at >= v_from),
      'pwa_installs',     (select count(*) from pwa_install_events
                            where event = 'installed'),
      'notifications',    (select count(*) from notifications where created_at >= v_from),
      'notifications_unread', (select count(*) from notifications where not read)
    ),

    -- ================================================== תוכן ומאגרים
    'content', jsonb_build_object(
      'articles',      (select count(*) from articles),
      'news_items',    (select count(*) from news_items where status = 'published'),
      'news_new',      (select count(*) from news_items where created_at >= v_from),
      'neighborhoods', (select count(*) from neighborhoods),
      'streets',       (select count(*) from street_registry),
      'market_deals',  (select count(*) from market_deals),
      'planning_info', (select count(*) from property_planning_info)
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.platform_inventory_report(integer) is
  'מצבת המערכת: כמה יש מכל דבר, ומה נוסף בחלון. למנהל/ת פלטפורמה בלבד. משרד הדגמה (is_demo), הלידים שלו והמודעות שלו אינם נספרים.';

revoke all on function public.platform_inventory_report(integer) from public, anon;
grant execute on function public.platform_inventory_report(integer) to authenticated;


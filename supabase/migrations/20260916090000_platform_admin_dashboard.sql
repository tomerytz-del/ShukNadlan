-- ============================================================================
-- לוח הבקרה החודשי של מנהל/ת הפלטפורמה
--
-- עד היום מנהל/ת הפלטפורמה ראה/תה בדשבורד בדיוק מה שסוכן/ת רגיל/ה רואה:
-- הנכסים שלו/ה, הלידים שלו/ה, הארנק שלו/ה. השאלות של מי שמנהל/ת את
-- *העסק* — כמה משרדים הצטרפו החודש, איזה סוג ליד עלה ואיזה ירד, כמה לידים
-- יושבים בלי טיפול ומאיפה בכלל מגיע הכסף — לא היו נגישות מהממשק בכלל.
--
-- למה RPC ולא view: ה-RLS של הפלטפורמה בנוי סביב "הסוכן/ת שלי" ו"המשרד
-- שלי". ‏agency_members, leads, lead_charges, wallet_topups ו-promotion_charges
-- כולן חסומות בפני מנהל/ת פלטפורמה בדיוק כמו בפני כל אחד אחר, וזה נכון:
-- שם, טלפון והודעה של פונה אינם עסק של אף אחד מלבד הסוכן/ת שקנה/תה את
-- הליד. פתיחת ה-policies "רק בשביל הדוח" הייתה חושפת PII של כל הפלטפורמה
-- לכל מי שיש לו/ה את הדגל.
--
-- לכן הפונקציה כאן היא security definer שמחזירה **מספרים בלבד**: ספירות,
-- סכומים ושמות משרדים (שממילא פומביים). אין בה שורה אחת של ליד, אין שם, אין
-- טלפון ואין אימייל. השורה הראשונה בגוף הפונקציה היא בדיקת is_platform_admin,
-- ובלעדיה היא מסרבת — בדיוק כמו ה-policies שהיא עוקפת.
--
-- שתי פונקציות:
--   ‏1. ‏current_is_platform_admin() — התשובה לשאלה "האם המשתמש/ת המחובר/ת
--      הוא/היא מנהל/ת פלטפורמה", במקום אחד. עד היום היא הייתה משוכפלת כ-
--      ‏EXISTS בתוך כל policy בנפרד.
--   ‏2. ‏platform_admin_monthly_report(p_months) — כל הדוח בקריאה אחת.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מי מנהל/ת פלטפורמה
--
-- ‏stable ולא volatile: בתוך אותה שאילתה התשובה לא משתנה, ולכן המתכנן רשאי
-- לקרוא לה פעם אחת. ‏security definer כדי שהיא תוכל לקרוא את agency_members
-- בלי להיתקל ב-policy של הטבלה עצמה (שמתירה רק את השורה של המשתמש/ת — מה
-- שדי, אבל רק במקרה: policy שתשתנה בעתיד לא צריכה לשבור את הבדיקה הזו).
-- ---------------------------------------------------------------------------
create or replace function public.current_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agency_members
     where user_id = auth.uid()
       and is_platform_admin = true
       and active = true
  );
$$;

comment on function public.current_is_platform_admin() is
  'האם המשתמש/ת המחובר/ת הוא/היא מנהל/ת פלטפורמה פעיל/ה. הגדרה אחת לכל הבדיקות.';

revoke all on function public.current_is_platform_admin() from public;
grant execute on function public.current_is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. הדוח החודשי
--
-- מחזירה jsonb אחד עם ארבעה חלקים:
--
--   ‏months[]   — שורה לכל חודש בחלון (הישן ראשון): הצטרפויות, לידים לפי סוג,
--                 הכנסות לפי מקור, נכסים, עסקאות. הדפדפן גוזר מכאן לבד את
--                 חיצי העלייה/ירידה — ההשוואה היא בין שתי השורות האחרונות,
--                 ואין טעם לחשב אותה פעמיים.
--   ‏totals     — תמונת "עכשיו" מצטברת: כמה משרדים, כמה סוכנים לפי מסלול,
--                 כמה נכסים פעילים, כמה כסף יושב בארנקים.
--   ‏untreated  — מה ממתין לטיפול *ברגע זה*, בכל חמשת מקומות שבהם ליד יכול
--                 להיתקע. זה לא נתון חודשי אלא תור פתוח, ולכן הוא בנפרד.
--   ‏agencies[] — פירוט לפי משרד בתוך החלון: כמה סוכנים, כמה קנו, כמה שילמו.
--
-- הגדרות שחשוב שיהיו כתובות ולא משתמעות:
--   ‏· "הכנסה" = חיוב שנגבה בפועל (status='success'), ולא טעינת ארנק. טעינה
--     היא כסף שנכנס לארנק ועדיין שייך לסוכן/ת; היא מוחזרת בשדה נפרד
--     (‏topups) ולא מסתכמת לתוך revenue_total, אחרת אותו שקל נספר פעמיים.
--   ‏· קידום נכס נחשב הכנסה כשהוא active או expired — canceled בוטל ולא נגבה.
--   ‏· ליד RSS נספר רק כש-is_lead: פוסט שסווג כספאם/מתווך אינו ליד.
--   ‏· "ללא טיפול" = ליד שאיש עדיין לא פתח/קנה, בלי קשר לגילו.
-- ---------------------------------------------------------------------------
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
      from agencies where created_at >= v_first group by 1
  ),
  new_agents as (
    select date_trunc('month', created_at)::date m,
           count(*) n,
           count(*) filter (where role = 'manager') managers,
           count(*) filter (where tier <> 'free')   paid
      from agency_members where created_at >= v_first group by 1
  ),
  -- ---- לידים לפי סוג ----
  site_leads as (
    select date_trunc('month', created_at)::date m,
           count(*) filter (where lead_type = 'property_inquiry')     property_inquiry,
           count(*) filter (where lead_type = 'owner_inbound')        owner_inbound,
           count(*) filter (where lead_type = 'agent_direct_inquiry') agent_direct_inquiry,
           count(*) filter (where lead_type = 'visualization')        visualization
      from leads where created_at >= v_first group by 1
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
      from saved_searches where created_at >= v_first group by 1
  ),
  -- ---- הכנסות לפי מקור ----
  rev_site as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from lead_charges where status = 'success' and created_at >= v_first group by 1
  ),
  rev_rss as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from rss_lead_purchases where status = 'success' and created_at >= v_first group by 1
  ),
  rev_mortgage as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from mortgage_lead_purchases where status = 'success' and created_at >= v_first group by 1
  ),
  rev_buyer as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from saved_search_lead_purchases where status = 'success' and created_at >= v_first group by 1
  ),
  rev_promo as (
    select date_trunc('month', created_at)::date m, count(*) n, coalesce(sum(amount), 0) v
      from promotion_charges where status in ('active', 'expired') and created_at >= v_first group by 1
  ),
  topups as (
    select date_trunc('month', created_at)::date m, coalesce(sum(amount), 0) v
      from wallet_topups where status = 'success' and created_at >= v_first group by 1
  ),
  -- ---- פעילות נלווית ----
  new_props as (
    select date_trunc('month', created_at)::date m, count(*) n
      from properties where created_at >= v_first group by 1
  ),
  deals as (
    select date_trunc('month', sold_at)::date m, count(*) n, coalesce(sum(sale_price), 0) v
      from market_deals where sold_at >= v_first group by 1
  ),
  new_reviews as (
    select date_trunc('month', created_at)::date m, count(*) n
      from reviews where created_at >= v_first group by 1
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
        from lead_charges where status = 'success' and created_at >= v_first group by 1
      union all
      select agency_id, coalesce(sum(amount), 0), count(*)
        from rss_lead_purchases where status = 'success' and created_at >= v_first group by 1
      union all
      select agency_id, coalesce(sum(amount), 0), count(*)
        from mortgage_lead_purchases where status = 'success' and created_at >= v_first group by 1
      union all
      select agency_id, coalesce(sum(amount), 0), count(*)
        from saved_search_lead_purchases where status = 'success' and created_at >= v_first group by 1
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
      'agencies',            (select count(*) from agencies),
      'agents',              (select count(*) from agency_members),
      'agents_active',       (select count(*) from agency_members where active),
      'managers',            (select count(*) from agency_members where active and role = 'manager'),
      'mortgage_advisors',   (select count(*) from agency_members where active and is_mortgage_advisor),
      'tier_free',           (select count(*) from agency_members where active and tier = 'free'),
      'tier_mid',            (select count(*) from agency_members where active and tier = 'mid'),
      'tier_premium',        (select count(*) from agency_members where active and tier = 'premium'),
      'pending_invitations', (select count(*) from agency_invitations where status = 'pending'),
      'properties_active',   (select count(*) from properties where status = 'active'),
      'properties_total',    (select count(*) from properties),
      'properties_promoted', (select count(*) from properties where is_promoted and coalesce(promoted_until, now()) >= now()),
      'wallet_balance',      (select coalesce(sum(credit_balance), 0) from agency_members where active),
      'newsletter',          (select count(*) from newsletter_subscribers where unsubscribed_at is null),
      'saved_searches',      (select count(*) from saved_searches where status = 'active')
    ),

    -- התור הפתוח: מה יושב עכשיו בלי שאיש נגע בו, וכמה ימים הישן ביותר
    'untreated', jsonb_build_object(
      'site_leads',      (select count(*) from leads where status = 'masked'),
      'site_unassigned', (select count(*) from leads where agent_id is null),
      'rss_leads',       (select count(*) from rss_leads where is_lead and status = 'new'),
      'mortgage_leads',  (select count(*) from mortgage_leads where status = 'new'),
      'saved_searches',  (select count(*) from saved_searches where lead_status = 'new'),
      'unrouted',        (select count(*) from lead_routing_log where routing = 'unrouted' and resolved_at is null),
      'reviews_pending', (select count(*) from reviews where status = 'pending'),
      'oldest_days',     (select coalesce(max(extract(day from now() - created_at))::int, 0)
                            from leads where status = 'masked')
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
  'לוח הבקרה החודשי של מנהל/ת הפלטפורמה: הצטרפויות, לידים לפי סוג, תור ללא טיפול והכנסות לפי מקור. מספרים בלבד — אין בה PII. מסרבת למי שאינו/ה מנהל/ת פלטפורמה.';

-- הפונקציה עוקפת RLS בכוונה, ולכן ההרשאה עליה מצומצמת: משתמש/ת מחובר/ת
-- בלבד (הבדיקה בגוף הפונקציה עושה את השאר), ואף פעם לא anon.
revoke all on function public.platform_admin_monthly_report(integer) from public;
revoke all on function public.platform_admin_monthly_report(integer) from anon;
grant execute on function public.platform_admin_monthly_report(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. אינדקסים לחלון החודשי
--
-- הדוח סורק כל טבלה לפי created_at מהחודש הראשון בחלון והלאה. היום הטבלאות
-- קטנות וכל סריקה זולה; האינדקסים כאן הם כדי שהדוח לא יהפוך לבעיה כשהן
-- יגדלו — לא כדי לפתור בעיה קיימת.
-- ---------------------------------------------------------------------------
create index if not exists leads_created_at_idx          on public.leads (created_at);
create index if not exists lead_charges_created_at_idx   on public.lead_charges (created_at);
create index if not exists agency_members_created_at_idx on public.agency_members (created_at);
create index if not exists properties_created_at_idx     on public.properties (created_at);

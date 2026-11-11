-- ============================================================================
-- נוסח אחרי #1235 ו-#1239 (גבריאלה, 11.11.2026), ושני ממצאי Low מהבדיקה של #1235
--
--   (1) report_invalid_lead: ההודעה לסוכן/ת מעל תקרת הדיווחים אומרת "ב-30 הימים
--       האחרונים" - התקרה מתגלגלת (v_reports נספר 30 יום אחורה), לא חודש קלנדרי.
--   (2) owner_report_open: כותרת ההתראה "הקישור לדוח השבועי נפתח" במקום "הבעלים פתחו
--       את הדוח". המדד משוער - גם תצוגה מקדימה של קישור (וואטסאפ, מייל) נספרת כפתיחה,
--       ולכן לא טוענים שהבעלים פתחו.
--   (3) _owner_report_build: ההשוואה לשוק מוצגת רק מ-10 נכסים להשוואה (היה 5).
--       אחוז מתוך 3 מודעות מטעה בעלים.
--   (4) lead_archives_guard_refunded: הטריגר חסם רק DELETE, וה-policy על lead_archives
--       היא for all - UPDATE של lead_id היה מנתק ליד שהוחזר משורת הארכיון שלו בלי
--       שהטריגר רץ. עכשיו גם before update: שינוי lead_id או agent_id בשורה של ליד
--       שהוחזר נחסם. ה-cascade (pg_trigger_depth() > 1) עובר כמו קודם.
--
-- הפונקציות הועתקו כלשונן מ-20271111170000, 20271111095000 ו-20271111100000, ושונו
-- רק המקומות שמתוארים כאן. אידמפוטנטית.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. דיווח על ליד לא תקין: ההודעה מעל התקרה
-- ---------------------------------------------------------------------------
create or replace function public.report_invalid_lead(p_lead uuid, p_reason text, p_details text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_agent    uuid := public.current_agent_id();
  v_lead     public.leads%rowtype;
  v_details  text := nullif(btrim(coalesce(p_details, '')), '');
  v_window   numeric;
  v_min      numeric;
  v_pct      numeric;
  v_ends     timestamptz;
  v_has_paid boolean;
  v_opened   int;
  v_reports  int;
  v_over     boolean;
  v_evidence jsonb;
  v_id       uuid;
  v_name     text;
  v_result   jsonb;
begin
  if v_agent is null then return jsonb_build_object('error', 'not_agent'); end if;
  if p_lead is null or p_reason is null
     or p_reason not in ('wrong_number', 'spam', 'broker', 'duplicate') then
    return jsonb_build_object('error', 'bad_request');
  end if;
  if v_details is not null and char_length(v_details) > 300 then
    return jsonb_build_object('error', 'details_too_long');
  end if;

  -- נעילת הסוכן/ת: שני דיווחים במקביל לא יעברו את התקרה שניהם
  perform 1 from public.agency_members where id = v_agent for update;

  select * into v_lead from public.leads where id = p_lead for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  -- שיחות במספר וירטואלי חויבו בטבלה משלהן (phone_line_charges) ואינן בהחזר האוטומטי.
  -- לפני בדיקת הבעלות: לשיחה אין unlocked_by, ו"אפשר לדווח רק על ליד שפתחת" היה מטעה
  if v_lead.lead_type = 'call' then
    return jsonb_build_object('error', 'not_supported');
  end if;
  -- ליד חנות נרכש בחנות ולא נפתח ב-claim_lead: הבעלים שלו הוא agent_id, ואין לו unlocked_by
  if v_lead.status <> 'unlocked'
     or (case when v_lead.lead_type = 'store' then v_lead.agent_id else v_lead.unlocked_by end)
        is distinct from v_agent then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if exists (select 1 from public.lead_invalid_reports where lead_id = p_lead) then
    return jsonb_build_object('error', 'already_reported');
  end if;

  select value into v_window from public.pricing_config where key = 'lead_refund_window_hours';
  select value into v_min    from public.pricing_config where key = 'lead_refund_auto_min';
  select value into v_pct    from public.pricing_config where key = 'lead_refund_auto_pct';
  v_window := coalesce(v_window, 48);
  v_min    := coalesce(v_min, 2);
  v_pct    := coalesce(v_pct, 20);

  v_ends := v_lead.unlocked_at + make_interval(hours => v_window::int);
  -- ‏unlocked_at ריק (שורה ישנה): "now() > null" הוא null ו-if לא נכנס, והחלון היה נעקף
  if v_lead.unlocked_at is null or now() > v_ends then
    return jsonb_build_object('error', 'window_closed', 'window_ended_at', v_ends);
  end if;

  if v_lead.lead_type = 'store' then
    -- החיוב בטבלת הרכישה של המקור (rss / משכנתאות / חיפוש שמור), לפי origin_id
    select exists (select 1 from public._lead_store_purchase(v_lead.origin_id, v_agent) s where s.amount > 0)
      into v_has_paid;
  else
    select exists (select 1 from public.lead_charges
                    where lead_id = p_lead and agent_id = v_agent and status = 'success' and amount > 0)
      into v_has_paid;
  end if;
  -- ליד חנות לא נספר במכסה החינמית, ולכן בלי תשלום אין מה להחזיר
  if not v_has_paid and (v_lead.lead_type = 'store' or v_lead.quota_source is distinct from 'free_quota') then
    return jsonb_build_object('error', 'nothing_to_refund');
  end if;

  -- סימנים לבודק/ת. ‏אינם תנאי: ההחלטה היא החזר אוטומטי בתוך התקרה
  v_evidence := jsonb_build_object(
    -- ליד חנות בלי phone_e164 (rss בלי טלפון) אינו "מספר לא תקין": לא יודעים, ולכן null ולא true
    'phone_invalid', case when v_lead.lead_type = 'store' and v_lead.phone_e164 is null then null
                          else (v_lead.phone_e164 is null or v_lead.phone_e164 !~ '^972[2-9][0-9]{7,8}$') end,
    'store', (v_lead.lead_type = 'store'),
    'duplicate', (v_lead.phone_e164 is not null and exists (
        select 1 from public.leads l2
         where l2.id <> v_lead.id and l2.phone_e164 = v_lead.phone_e164
           and l2.agent_id = v_agent and l2.created_at < v_lead.created_at)),
    'broker_phone', (v_lead.phone_e164 is not null and exists (
        select 1 from public.agency_members m
         where m.phone_e164 = v_lead.phone_e164 and m.id <> v_agent)));

  -- תקרת הניצול, ב-30 ימים מתגלגלים
  select count(*) into v_opened from public.leads
   where (unlocked_by = v_agent or (lead_type = 'store' and agent_id = v_agent))
     and unlocked_at > now() - interval '30 days';
  select count(*) into v_reports from public.lead_invalid_reports
   where agent_id = v_agent and created_at > now() - interval '30 days'
     and status in ('refunded', 'pending_review');
  v_over := (v_reports + 1) > v_min
            and ((v_reports + 1)::numeric / greatest(v_opened, 1)) * 100 > v_pct;
  v_evidence := v_evidence || jsonb_build_object('opened_30d', v_opened, 'reports_30d', v_reports + 1);

  insert into public.lead_invalid_reports (lead_id, agent_id, reason, details, evidence)
  values (p_lead, v_agent, p_reason, v_details, v_evidence)
  returning id into v_id;

  if not v_over then
    v_result := public._lead_report_apply(v_id, null, true);
    -- הדיווח כבר נכנס: אם ההחזר סירב, מגלגלים הכול אחורה במקום להשאיר דיווח תלוי בלי החזר
    if v_result ? 'error' then
      raise exception 'lead_report_apply_failed: %', v_result->>'error';
    end if;
    return v_result;
  end if;

  -- מעל התקרה: ממתין לבדיקה ידנית, והמנהלים מקבלים התראה
  select coalesce(nullif(btrim(display_name), ''), 'סוכן/ת') into v_name
    from public.agency_members where id = v_agent;
  -- ‏action_path: ההתראה לא נושאת ליד של המנהל/ת (אין לו/ה גישה אליו), היעד הוא הרשימה
  insert into public.notifications (agent_id, type, title, body, action_path, suppress_push)
  select a.id, 'system', 'דיווח על ליד לא תקין ממתין לבדיקה',
         v_name || ' דיווח/ה על ליד, מעל תקרת ההחזר האוטומטי (' || (v_reports + 1) || ' דיווחים מתוך '
         || v_opened || ' לידים ב-30 יום). הבדיקה ב"דיווחי לידים".',
         '/crm?goto=accLeadReports', false
    from public.agency_members a where a.is_platform_admin and a.id <> v_agent;
  -- התקרה מתגלגלת (30 יום אחורה), ולכן ההודעה אומרת את זה ולא "החודש"
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  values (v_agent, 'system', 'הדיווח על הליד התקבל',
          'מספר הדיווחים שלך ב-30 הימים האחרונים גבוה, ולכן הדיווח עובר לבדיקה של צוות הפלטפורמה. נעדכן כאן.', p_lead, true);
  v_result := jsonb_build_object('status', 'pending_review');
  return v_result;
end;
$$;

revoke all on function public.report_invalid_lead(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_invalid_lead(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. דוח לבעלים: כותרת ההתראה על הפתיחה הראשונה
-- ---------------------------------------------------------------------------
create or replace function public.owner_report_open(p_id text, p_count boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row   public.owner_report_links%rowtype;
  v_first boolean;
  v_title text;
begin
  if p_count then
    -- נועלים ובודקים אם זו הפתיחה הראשונה: רק היא מתריעה (רענון והתראה כפולה הם רעש)
    select (l.opened_at is null) into v_first
      from public.owner_report_links l where l.id = p_id and l.expires_at > now() for update;
    if not found then return null; end if;
    update public.owner_report_links
       set opened_at = coalesce(opened_at, now()), open_count = open_count + 1
     where id = p_id and expires_at > now()
     returning * into v_row;
    if v_first then
      select p.title into v_title from public.properties p where p.id = v_row.property_id;
      -- בפעמון בלבד (suppress_push): המדד משוער, ופתיחה שאינה של הבעלים לא צריכה להעיר את הסוכן/ת בוואטסאפ.
      -- הכותרת אומרת שהקישור נפתח, לא שהבעלים פתחו: גם תצוגה מקדימה של הקישור נספרת.
      insert into public.notifications (agent_id, type, title, body, related_property_id, suppress_push)
      values (v_row.agent_id, 'system', 'הקישור לדוח השבועי נפתח',
              'הדוח על ' || coalesce('"' || v_title || '"', 'הנכס') || ' נפתח לראשונה.', v_row.property_id, true);
    end if;
  else
    select * into v_row from public.owner_report_links where id = p_id and expires_at > now();
  end if;
  if not found then return null; end if;
  return jsonb_build_object(
    'agent_id', v_row.agent_id, 'report', v_row.report, 'note', v_row.note,
    'created_at', v_row.created_at, 'expires_at', v_row.expires_at);
end;
$$;

revoke all on function public.owner_report_open(text, boolean) from public, anon, authenticated;
grant execute on function public.owner_report_open(text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. דוח לבעלים: ההשוואה לשוק רק מ-10 נכסים להשוואה
-- ---------------------------------------------------------------------------
create or replace function public._owner_report_build(p_property uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_p        record;
  v_now      timestamptz := now();
  v_today    date := (now() at time zone 'Asia/Jerusalem')::date;
  v_w_start  timestamptz := ((now() at time zone 'Asia/Jerusalem')::date - 6)::timestamp at time zone 'Asia/Jerusalem';
  v_pw_start timestamptz := ((now() at time zone 'Asia/Jerusalem')::date - 13)::timestamp at time zone 'Asia/Jerusalem';
  v_views_w  integer;
  v_views_pw integer;
  v_views_t  integer;
  v_uniq_w   integer;
  v_leads_w  integer;
  v_leads_pw integer;
  v_leads_t  integer;
  v_daily    jsonb;
  v_sample   integer;
  v_below    integer;
  v_market   jsonb := null;
begin
  select id, title, city, deal_type, price, rooms, area_sqm, created_at, status
    into v_p
    from public.properties where id = p_property;
  if not found then return null; end if;

  select count(*) filter (where viewed_at >= v_w_start),
         count(*) filter (where viewed_at >= v_pw_start and viewed_at < v_w_start),
         count(*),
         count(distinct visitor_session_id) filter (where viewed_at >= v_w_start)
    into v_views_w, v_views_pw, v_views_t, v_uniq_w
    from public.property_views where property_id = p_property;

  select count(*) filter (where created_at >= v_w_start),
         count(*) filter (where created_at >= v_pw_start and created_at < v_w_start),
         count(*)
    into v_leads_w, v_leads_pw, v_leads_t
    from public.leads where property_id = p_property;

  select coalesce(jsonb_agg(jsonb_build_object('d', to_char(d.day, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0))
                            order by d.day), '[]'::jsonb)
    into v_daily
    from generate_series(v_today - 6, v_today, interval '1 day') as d(day)
    left join (
      select (viewed_at at time zone 'Asia/Jerusalem')::date as day, count(*)::int as n
        from public.property_views
       where property_id = p_property and viewed_at >= v_w_start
       group by 1
    ) c on c.day = d.day::date;

  -- אותה עיר ואותו סוג עסקה; הכיתוב בדף (assets/owner-report.js) אומר בדיוק את זה
  if v_p.city is not null and v_p.deal_type is not null then
    with pool as (
      select pr.id, count(v.id) as n
        from public.properties pr
        left join public.property_views v
               on v.property_id = pr.id and v.viewed_at >= v_w_start
       where pr.status = 'active' and pr.city = v_p.city and pr.deal_type = v_p.deal_type
         and pr.id <> p_property
       group by pr.id
    )
    select count(*), count(*) filter (where n < v_views_w) into v_sample, v_below from pool;
    -- מתחת ל-10 נכסים להשוואה אין השוואה: אחוז מתוך 3 מודעות מטעה בעלים
    if v_sample >= 10 then
      v_market := jsonb_build_object(
        'sample', v_sample,
        'beat_pct', round(100.0 * v_below / v_sample)::int);
    end if;
  end if;

  return jsonb_build_object(
    'generated_at', v_now,
    'property', jsonb_build_object(
      'title', v_p.title, 'city', v_p.city, 'deal_type', v_p.deal_type,
      'price', v_p.price, 'rooms', v_p.rooms, 'area_sqm', v_p.area_sqm,
      'days_listed', greatest(0, (v_today - (v_p.created_at at time zone 'Asia/Jerusalem')::date)),
      'status', v_p.status),
    'views', jsonb_build_object(
      'week', v_views_w, 'prev_week', v_views_pw, 'total', v_views_t,
      'unique_week', v_uniq_w, 'daily', v_daily),
    'inquiries', jsonb_build_object(
      'week', v_leads_w, 'prev_week', v_leads_pw, 'total', v_leads_t),
    'market', v_market);
end;
$$;

revoke all on function public._owner_report_build(uuid) from public, anon, authenticated;
grant execute on function public._owner_report_build(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. ליד שהוחזר נשאר בארכיון: גם מול UPDATE
--
-- ה-policy "agent manages own lead archive" היא for all (ל-authenticated אין היום
-- grant update, אבל הטריגר אינו נשען על זה: grant עתידי או service_role לא יפתחו
-- את הפרצה). ‏UPDATE שמשנה lead_id מנתק את הליד שהוחזר משורת הארכיון, וזה בדיוק
-- "החזרה מהארכיון" בדלת האחורית. שינוי agent_id נחסם מאותה סיבה. ‏UPDATE של
-- archived_at בלבד עובר.
-- ‏pg_trigger_depth() > 1 = cascade (מחיקת הליד או הסוכן/ת, שמירת נתונים), שחייב לעבור.
-- ---------------------------------------------------------------------------
create or replace function public.lead_archives_guard_refunded()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  -- ‏UPDATE שאינו נוגע בזהות השורה אינו מוציא את הליד מהארכיון
  if tg_op = 'UPDATE' and new.lead_id is not distinct from old.lead_id and new.agent_id is not distinct from old.agent_id then
    return new;
  end if;
  if exists (select 1 from public.lead_invalid_reports r
              where r.lead_id = old.lead_id and r.status = 'refunded') then
    raise exception 'lead_refunded' using errcode = 'P0001',
      hint = 'ליד שהוחזר עליו חיוב נשאר בארכיון';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.lead_archives_guard_refunded() from public, anon, authenticated;

drop trigger if exists lead_archives_guard_refunded on public.lead_archives;
create trigger lead_archives_guard_refunded
  before delete or update on public.lead_archives
  for each row execute function public.lead_archives_guard_refunded();

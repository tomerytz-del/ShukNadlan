-- ============================================================================
-- (9) דוח לבעלים: התראה על פתיחה ראשונה + רשימת הדוחות שנשלחו
-- (10) החזר על ליד גם ל**לידי החנות** (לא לשיחות), ודיווחי לידים בתיבת המשימות
--
-- החלטת תומר (11.11.2026): שני הסעיפים, ו"ללידי החנות בלבד" בסעיף ההחזר.
--
-- ## לידי חנות
--
-- ליד חנות הוא שורה ב-`leads` (`lead_type = 'store'`, `origin_id` = מזהה הפריט במקור) שנוצרת בטריגר
-- `store_purchase_to_lead` כשליד נמכר. **אין לו שורה ב-`lead_charges`**: הרכישה בטבלה של המקור
-- (`rss_lead_purchases`, `mortgage_lead_purchases`, `saved_search_lead_purchases`, כולן עם
-- `status in ('success','refunded')`), ו-`unlocked_by` ריק (הבעלים הוא `agent_id`). לכן:
--
--   * `_lead_store_purchase(origin, agent)` מוצאת את הרכישה (סוג, מזהה, סכום).
--   * `report_invalid_lead`: הבעלות לפי `agent_id` בליד חנות, ובדיקת "יש מה להחזיר" לפי הרכישה.
--   * `_lead_report_apply`: מזכה את הארנק בסכום שנגבה ומסמנת את הרכישה `refunded` בטבלת המקור.
--     המקור עצמו (rss_leads / saved_searches / mortgage_leads) **נשאר "נמכר"** ואינו חוזר לחנות:
--     אותה החלטה כמו בשאר הלידים - הליד נסגר.
--   * שיחות (`lead_type = 'call'`) נשארות `not_supported`.
--   * הגבלת הניצול סופרת גם לידי חנות במניין "לידים שנפתחו".
--
-- ## דוח לבעלים
--
--   * `owner_report_open`: בפתיחה **הראשונה** של הבעלים (לא תצוגה מקדימה) נכתבת התראת פעמון
--     לסוכן/ת, עם קישור לנכס (`related_property_id`), בלי וואטסאפ (`suppress_push`): המדד משוער.
--   * `owner_reports_list(property)`: הדוחות שהופקו לנכס, עם הפתיחות. אותה הרשאה כמו ההפקה.
--
-- ## תיבת המשימות
--
-- `lead_report` נכנס ל-`_admin_inbox_rows()` (דיווח שממתין לבדיקה ידנית), עם זמן יעד של 24 שעות.
-- ההחלטה נשארת במסך שלו (`accLeadReports`), כמו בשאר התורים (docs/admin-inbox.md).
--
-- כל הפונקציות שהוחלפו הועתקו כלשונן מהפרודקשן (md5 של הגוף נבדק ב-11.11.2026), ושונו רק המקומות
-- שמתוארים כאן. אידמפוטנטית.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ליד חנות: איפה החיוב
-- ---------------------------------------------------------------------------
create or replace function public._lead_store_purchase(p_origin uuid, p_agent uuid)
returns table (kind text, purchase_id uuid, amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select 'rss'::text, p.id, p.amount
    from public.rss_lead_purchases p
   where p.lead_id = p_origin and p.agent_id = p_agent and p.status = 'success'
  union all
  select 'mortgage', p.id, p.amount
    from public.mortgage_lead_purchases p
   where p.lead_id = p_origin and p.agent_id = p_agent and p.status = 'success'
  union all
  select 'saved_search', p.id, p.amount
    from public.saved_search_lead_purchases p
   where p.search_id = p_origin and p.agent_id = p_agent and p.status = 'success'
  limit 1
$$;

revoke all on function public._lead_store_purchase(uuid, uuid) from public, anon, authenticated;
grant execute on function public._lead_store_purchase(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. הדיווח וההחזר (מהגרסה החיה, עם תוספת הלידים של החנות)
-- ---------------------------------------------------------------------------
create or replace function public._lead_report_apply(p_report uuid, p_decided_by uuid, p_auto boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_r      public.lead_invalid_reports%rowtype;
  v_store  record;
  v_lead   public.leads%rowtype;
  v_charge record;
  v_amount numeric(10,2) := 0;
  v_quota  boolean := false;
  v_rows   int;
begin
  select * into v_r from public.lead_invalid_reports where id = p_report for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_r.status = 'refunded' then
    return jsonb_build_object('status', 'refunded', 'refund_amount', v_r.refund_amount,
                              'quota_returned', v_r.quota_returned);
  end if;
  if v_r.status = 'rejected' then return jsonb_build_object('error', 'already_rejected'); end if;

  select * into v_lead from public.leads where id = v_r.lead_id for update;

  -- מה שנגבה בפועל, לפי שורת החיוב. ‏לא המחיר הנוכחי ב-pricing_config
  select id, amount into v_charge
    from public.lead_charges
   where lead_id = v_r.lead_id and agent_id = v_r.agent_id and status = 'success'
   order by created_at desc limit 1;

  if v_lead.lead_type = 'store' then
    -- ליד חנות: אין שורה ב-lead_charges. הרכישה בטבלה של המקור, והיא נסגרת כ-refunded שם
    select * into v_store from public._lead_store_purchase(v_lead.origin_id, v_r.agent_id);
    if v_store.purchase_id is not null and v_store.amount > 0 then
      v_amount := v_store.amount;
      update public.agency_members set credit_balance = credit_balance + v_amount where id = v_r.agent_id;
      if v_store.kind = 'rss' then
        update public.rss_lead_purchases set status = 'refunded' where id = v_store.purchase_id;
      elsif v_store.kind = 'mortgage' then
        update public.mortgage_lead_purchases set status = 'refunded' where id = v_store.purchase_id;
      else
        update public.saved_search_lead_purchases set status = 'refunded' where id = v_store.purchase_id;
      end if;
    end if;
  elsif v_charge.id is not null and v_charge.amount > 0 then
    v_amount := v_charge.amount;
    update public.agency_members set credit_balance = credit_balance + v_amount where id = v_r.agent_id;
    update public.lead_charges set status = 'refunded' where id = v_charge.id;
  end if;

  -- מכסת החינם חוזרת רק באותו חודש שבו נספרה: אחרי חילופי חודש המונה כבר
  -- של חודש אחר, והחזרה הייתה מורידה פנייה שלא נוצלה בו
  if v_lead.quota_source = 'free_quota' then
    update public.agency_members
       set free_quota_used = greatest(free_quota_used - 1, 0)
     where id = v_r.agent_id
       and free_quota_used > 0
       and free_quota_cycle_start = date_trunc('month', v_lead.unlocked_at)::date;
    get diagnostics v_rows = row_count;
    v_quota := v_rows = 1;
  end if;

  -- הליד נסגר: ארכיון. הטריגר lead_archive_finalize סוגר את השלב ומבטל תזכורות
  insert into public.lead_archives (lead_id, agent_id) values (v_r.lead_id, v_r.agent_id)
  on conflict (lead_id) do nothing;

  update public.lead_invalid_reports
     set status = 'refunded', refund_amount = v_amount, quota_returned = v_quota,
         auto = p_auto, decided_by = p_decided_by, decided_at = now()
   where id = p_report;

  -- ‏suppress_push = p_auto: מי שדיווח הרגע רואה את התוצאה במסך ואינו צריך וואטסאפ;
  -- החלטה ידנית של מנהל/ת מגיעה אליו/ה כשהוא/היא לא מסתכל/ת, ולכן נדחפת
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  values (v_r.agent_id, 'system',
          'הליד סומן כלא תקין' || case when v_amount > 0 then ' והסכום הוחזר לארנק' else '' end,
          case when v_amount > 0 then '₪' || trim_scale(v_amount)::text || ' חזרו לארנק. ' else '' end
            || case when v_quota then 'הפנייה חזרה למכסה החינמית של החודש. ' else '' end
            || 'הליד עבר לארכיון.',
          v_r.lead_id, p_auto);

  return jsonb_build_object('status', 'refunded', 'refund_amount', v_amount, 'quota_returned', v_quota);
end;
$$;

revoke all on function public._lead_report_apply(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public._lead_report_apply(uuid, uuid, boolean) to service_role;

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
    return public._lead_report_apply(v_id, null, true);
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
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  values (v_agent, 'system', 'הדיווח על הליד התקבל',
          'מספר הדיווחים שלך החודש גבוה, ולכן הוא עובר לבדיקה של צוות הפלטפורמה. נעדכן כאן.', p_lead, true);
  v_result := jsonb_build_object('status', 'pending_review');
  return v_result;
end;
$$;

revoke all on function public.report_invalid_lead(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_invalid_lead(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. דוח לבעלים: פתיחה ראשונה מתריעה, ורשימת הדוחות שנשלחו
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
      -- בפעמון בלבד (suppress_push): המדד משוער, ופתיחה שאינה של הבעלים לא צריכה להעיר את הסוכן/ת בוואטסאפ
      insert into public.notifications (agent_id, type, title, body, related_property_id, suppress_push)
      values (v_row.agent_id, 'system', 'הבעלים פתחו את הדוח השבועי',
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

create or replace function public.owner_reports_list(p_property uuid)
returns table (id text, created_at timestamptz, expires_at timestamptz,
               opened_at timestamptz, open_count integer, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
  v_prop  record;
begin
  if v_agent is null or p_property is null then return; end if;
  select pr.agent_id, pr.agency_id into v_prop from public.properties pr where pr.id = p_property;
  if not found then return; end if;
  -- אותה הרשאה כמו owner_report_create: הסוכן/ת של הנכס, או מנהל/ת המשרד שלו
  if not coalesce(
       v_prop.agent_id = v_agent
       or (v_prop.agency_id is not null
           and v_prop.agency_id = public.current_agency_id()
           and public.current_member_role() = 'manager'), false) then
    return;
  end if;
  -- הדוח עצמו (report) לא חוזר: הרשימה היא "מה נשלח ומה נפתח", והקישור נבנה מה-id
  return query
    select l.id, l.created_at, l.expires_at, l.opened_at, l.open_count, l.note
      from public.owner_report_links l
     where l.property_id = p_property
     order by l.created_at desc
     limit 20;
end;
$$;

revoke all on function public.owner_reports_list(uuid) from public, anon, authenticated;
grant execute on function public.owner_reports_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. תיבת המשימות: דיווחי לידים שממתינים לבדיקה
-- ---------------------------------------------------------------------------
insert into public.admin_sla (kind, minutes) values ('lead_report', 1440)
on conflict (kind) do nothing;

create or replace function public._admin_inbox_rows()
returns table (kind text, ref_id text, created_at timestamptz, meta jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'unrouted_lead', r.id::text, r.created_at,
         jsonb_build_object('lead_kind', r.lead_kind, 'reason', r.reason, 'city', r.city,
                            'deal_type', r.deal_type, 'source', r.source)
    from public.lead_routing_open r
  union all
  select 'refund', w.id::text, w.requested_at,
         jsonb_build_object('amount', coalesce(w.money_amount, w.amount),
                            'agent', (select m.display_name from public.agency_members m where m.id = w.agent_id))
    from public.wallet_refunds w
   where w.status = 'requested'
  union all
  select 'license_appeal', a.id::text, a.created_at,
         jsonb_build_object('name', a.applicant_name, 'license', a.license_number, 'source', a.source)
    from public.broker_license_appeals a
   where a.status = 'pending'
  union all
  select 'coach_gap', lower(btrim(q.gap_topic)), min(q.created_at),
         jsonb_build_object('topic', min(btrim(q.gap_topic)), 'asked', count(*))
    from public.coach_questions q
   where q.gap_topic is not null and q.gap_resolved_at is null
   group by lower(btrim(q.gap_topic))
  union all
  select 'hood_draft', d.id::text, d.created_at,
         jsonb_build_object('name', n.name, 'city', c.name)
    from public.neighborhood_descriptions d
    join public.neighborhoods n on n.id = d.neighborhood_id
    left join public.cities c on c.id = n.city_id
   where d.status = 'draft'
  union all
  select 'lead_report', r.id::text, r.created_at,
         jsonb_build_object('agent', (select m.display_name from public.agency_members m where m.id = r.agent_id),
                            'reason', r.reason, 'lead_type', l.lead_type, 'city', l.city)
    from public.lead_invalid_reports r
    join public.leads l on l.id = r.lead_id
   where r.status = 'pending_review'
$$;

comment on function public._admin_inbox_rows() is
  'התורים של מנהל/ת הפלטפורמה כשורות אחידות, בלי טלפון, מייל או תוכן פנייה. נקרא רק מ-admin_inbox. lead_report: דיווח על ליד לא תקין שעבר את תקרת הניצול.';

revoke all on function public._admin_inbox_rows() from public, anon, authenticated;

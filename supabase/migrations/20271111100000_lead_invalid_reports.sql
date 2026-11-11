-- ============================================================================
-- דיווח על ליד לא תקין והחזר לארנק
--
-- ההחלטות (תומר, 11.11.2026):
--
--   1. סיבות: מספר שגוי או מנותק, ספאם, פונה שהוא מתווך/ת, כפילות.
--   2. **אוטומטי.** דיווח בתוך החלון מוחזר מיד, בלי אישור של אדם. מי שעובר את
--      תקרת הניצול עובר לבדיקה ידנית של מנהל/ת הפלטפורמה.
--   3. חלון: 48 שעות מפתיחת הליד (lead_refund_window_hours).
--   4. ההחזר **לארנק**, לפי מה שנגבה בפועל (שורת lead_charges), לא לפי המחיר היום.
--   5. **מכסת החינם חוזרת:** ליד שנספר ב-10 הפניות של Pay&GO ומדווח - הפנייה
--      חוזרת למונה (רק באותו חודש - אחרי חילופי חודש המונה כבר של חודש אחר).
--   6. תקרה נגד ניצול: עד lead_refund_auto_min (2) דיווחים ב-30 יום תמיד
--      אוטומטיים; מעבר לזה, אם הדיווחים הם יותר מ-lead_refund_auto_pct (20%)
--      מהלידים שהסוכן/ת פתח/ה ב-30 יום - הדיווח ממתין לבדיקה ידנית. המינימום
--      קיים כי בלעדיו סוכן/ת עם שני לידים בחודש היה עובר לבדיקה בדיווח הראשון.
--   7. הליד **נסגר**: נכנס לארכיון (lead_archives), ומכאן הטריגר הקיים סוגר את
--      השלב ומבטל תזכורות. הוא אינו חוזר למאגר ואינו נמכר שוב.
--
-- ‏**מה לא כלול:** לידים שנרכשו בחנות ושיחות (lead_type store / call) - הם
-- חויבו בטבלאות משלהם (rss_lead_purchases, phone_line_charges) ואין להם שורה
-- ב-lead_charges. ‏ליד ללא תשלום ובלי מכסה (מנוי: subscription_unlimited) אין
-- מה להחזיר, ולכן הדיווח נדחה כ-nothing_to_refund.
--
-- ‏**ההרשאה:** ‏report_invalid_lead נקראת מהדפדפן (JWT), והסוכן/ת נגזר/ת מ-
-- current_agent_id() - לא מפרמטר. הפונקציה security definer, ולכן
-- protect_sensitive_agency_member_fields רואה current_user = postgres ומרשה את
-- שינוי credit_balance (כמו request_wallet_refund). ‏**ההחזר עצמו
-- (_lead_report_apply) אינו נקרא מהדפדפן.**
--
-- אידמפוטנטית.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ההגדרות
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('lead_refund_window_hours', 48, 'שעות מפתיחת ליד שבהן אפשר לדווח עליו כלא תקין ולקבל החזר לארנק'),
  ('lead_refund_auto_min',      2, 'דיווחים ב-30 יום שמוחזרים אוטומטית תמיד, גם אם הם מעל האחוז (תקרת ניצול)'),
  ('lead_refund_auto_pct',     20, 'אחוז הדיווחים מהלידים שנפתחו ב-30 יום שמעליו דיווח עובר לבדיקה ידנית (תקרת ניצול)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. הטבלה
-- ---------------------------------------------------------------------------
create table if not exists public.lead_invalid_reports (
  id            uuid        primary key default gen_random_uuid(),
  -- דיווח אחד לליד, גם אם נדחה: בלי זה דחייה הייתה הזמנה לנסות שוב
  lead_id       uuid        not null unique references public.leads(id) on delete cascade,
  agent_id      uuid        not null references public.agency_members(id) on delete cascade,
  reason        text        not null,
  details       text,
  status        text        not null default 'pending_review',
  refund_amount numeric(10,2) not null default 0,
  quota_returned boolean    not null default false,
  -- true = אושר אוטומטית; false = החלטה של מנהל/ת (או עדיין ממתין)
  auto          boolean     not null default false,
  -- סימנים שהמערכת מצאה, **למי שבודק/ת** - לא תנאי לאישור (ההחלטה: אוטומטי)
  evidence      jsonb       not null default '{}'::jsonb,
  decided_by    uuid        references public.agency_members(id) on delete set null,
  decision_note text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lead_invalid_reports_reason_chk') then
    alter table public.lead_invalid_reports add constraint lead_invalid_reports_reason_chk
      check (reason in ('wrong_number', 'spam', 'broker', 'duplicate'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_invalid_reports_status_chk') then
    alter table public.lead_invalid_reports add constraint lead_invalid_reports_status_chk
      check (status in ('refunded', 'pending_review', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_invalid_reports_details_len') then
    alter table public.lead_invalid_reports add constraint lead_invalid_reports_details_len
      check (details is null or char_length(details) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_invalid_reports_note_len') then
    alter table public.lead_invalid_reports add constraint lead_invalid_reports_note_len
      check (decision_note is null or char_length(decision_note) <= 300);
  end if;
end $$;

create index if not exists lead_invalid_reports_agent_idx
  on public.lead_invalid_reports (agent_id, created_at desc);
create index if not exists lead_invalid_reports_pending_idx
  on public.lead_invalid_reports (created_at) where status = 'pending_review';

comment on table public.lead_invalid_reports is
  'דיווח על ליד לא תקין והחזר לארנק. אוטומטי בתוך חלון ותקרת ניצול; מעבר לתקרה - בדיקה ידנית. docs/lead-refunds.md.';

alter table public.lead_invalid_reports enable row level security;
revoke all on table public.lead_invalid_reports from public, anon, authenticated;
grant select, insert, update, delete on table public.lead_invalid_reports to service_role;
-- הסוכן/ת קורא/ת את הדיווחים של עצמו/ה בלבד (הכרטיס מציג "הוחזר" / "ממתין"); כתיבה רק דרך הפונקציות
grant select on table public.lead_invalid_reports to authenticated;

drop policy if exists "agent reads own lead reports" on public.lead_invalid_reports;
create policy "agent reads own lead reports"
  on public.lead_invalid_reports for select to authenticated
  using (agent_id = (select public.current_agent_id()));

-- ---------------------------------------------------------------------------
-- 2ב. ‏lead_charges.status חייב להכיר 'refunded'. בפרודקשן הוא מכיר (נבדק
-- 11.11.2026), אבל הטבלה נוצרה לפני תיקיית המיגרציות, ובסביבה אחרת העדכון
-- היה זורק check ומבטל את כל ההחזר. מוסיפים למה שקיים ולא כותבים מחדש.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def  text;
  v_vals text[];
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'lead_charges_status_check' and conrelid = 'public.lead_charges'::regclass;
  if v_def is not null and v_def not like '%refunded%' then
    select coalesce(array_agg(m[1]), '{}') into v_vals
      from regexp_matches(v_def, '''([a-z_]+)''', 'g') as m;
    v_vals := array(select distinct unnest(v_vals || array['pending', 'success', 'failed', 'refunded']) order by 1);
    alter table public.lead_charges drop constraint lead_charges_status_check;
    execute format('alter table public.lead_charges add constraint lead_charges_status_check check (status = any (%L::text[]))', v_vals);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2ג. ליד שהוחזר נשאר סגור. ‏lead_archives היא "הסתרה בלבד" והסוכן/ת מוחק/ת
-- ממנה שורה כדי להחזיר ליד לרשימה - וכך ליד שקיבל/ה עליו החזר היה חוזר
-- לעבודה בחינם. הטריגר חוסם מחיקה ישירה של שורת ארכיון של ליד שהוחזר.
-- ‏pg_trigger_depth() > 1 = מחיקה ב-cascade (מחיקת הליד או הסוכן/ת, שמירת
-- נתונים), שחייבת לעבור.
-- ---------------------------------------------------------------------------
create or replace function public.lead_archives_guard_refunded()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  if exists (select 1 from public.lead_invalid_reports r
              where r.lead_id = old.lead_id and r.status = 'refunded') then
    raise exception 'lead_refunded' using errcode = 'P0001',
      hint = 'ליד שהוחזר עליו חיוב נשאר בארכיון';
  end if;
  return old;
end;
$$;

revoke all on function public.lead_archives_guard_refunded() from public, anon, authenticated;

drop trigger if exists lead_archives_guard_refunded on public.lead_archives;
create trigger lead_archives_guard_refunded
  before delete on public.lead_archives
  for each row execute function public.lead_archives_guard_refunded();

-- ---------------------------------------------------------------------------
-- 3. ההחזר עצמו. ‏service_role בלבד - נקראת רק מהפונקציות שלמטה, אחרי שבדקו הרשאה.
--
-- אידמפוטנטית: דיווח שכבר הוחזר חוזר כמו שהוא, ולא מחזיר פעמיים.
-- ---------------------------------------------------------------------------
create or replace function public._lead_report_apply(p_report uuid, p_decided_by uuid, p_auto boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_r      public.lead_invalid_reports%rowtype;
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

  if v_charge.id is not null and v_charge.amount > 0 then
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

-- ---------------------------------------------------------------------------
-- 4. הדיווח - הסוכן/ת מה-CRM (JWT)
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
  if v_lead.status <> 'unlocked' or v_lead.unlocked_by is distinct from v_agent then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_lead.lead_type in ('store', 'call') then
    return jsonb_build_object('error', 'not_supported');
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

  select exists (select 1 from public.lead_charges
                  where lead_id = p_lead and agent_id = v_agent and status = 'success' and amount > 0)
    into v_has_paid;
  if not v_has_paid and v_lead.quota_source is distinct from 'free_quota' then
    return jsonb_build_object('error', 'nothing_to_refund');
  end if;

  -- סימנים לבודק/ת. ‏אינם תנאי: ההחלטה היא החזר אוטומטי בתוך התקרה
  v_evidence := jsonb_build_object(
    'phone_invalid', (v_lead.phone_e164 is null or v_lead.phone_e164 !~ '^972[2-9][0-9]{7,8}$'),
    'duplicate', (v_lead.phone_e164 is not null and exists (
        select 1 from public.leads l2
         where l2.id <> v_lead.id and l2.phone_e164 = v_lead.phone_e164
           and l2.agent_id = v_agent and l2.created_at < v_lead.created_at)),
    'broker_phone', (v_lead.phone_e164 is not null and exists (
        select 1 from public.agency_members m
         where m.phone_e164 = v_lead.phone_e164 and m.id <> v_agent)));

  -- תקרת הניצול, ב-30 ימים מתגלגלים
  select count(*) into v_opened from public.leads
   where unlocked_by = v_agent and unlocked_at > now() - interval '30 days';
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
-- 5. מנהל/ת הפלטפורמה: הרשימה וההחלטה
-- ---------------------------------------------------------------------------
create or replace function public.lead_reports_admin(p_status text default 'pending_review', p_limit int default 100)
returns table (
  id uuid, created_at timestamptz, decided_at timestamptz, status text, agent_name text,
  reason text, details text, refund_amount numeric, quota_returned boolean, auto boolean,
  evidence jsonb, lead_type text, city text, quota_source text, decision_note text)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not coalesce((select m.is_platform_admin from public.agency_members m
                    where m.id = public.current_agent_id()), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- בלי טלפון, שם הפונה או הודעה: מי שצריך/ה אותם פותח/ת את הליד עם ההרשאות שלו
  return query
    select r.id, r.created_at, r.decided_at, r.status, coalesce(nullif(btrim(a.display_name), ''), 'סוכן/ת'),
           r.reason, r.details, r.refund_amount, r.quota_returned, r.auto,
           r.evidence, l.lead_type, l.city, l.quota_source, r.decision_note
      from public.lead_invalid_reports r
      join public.agency_members a on a.id = r.agent_id
      join public.leads l on l.id = r.lead_id
     where (p_status is null or r.status = p_status)
     order by case when r.status = 'pending_review' then r.created_at end asc nulls last,
              r.decided_at desc nulls last, r.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 200));
end;
$$;

revoke all on function public.lead_reports_admin(text, int) from public, anon, authenticated;
grant execute on function public.lead_reports_admin(text, int) to authenticated;

create or replace function public.lead_report_review(p_report uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_admin uuid := public.current_agent_id();
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_r     public.lead_invalid_reports%rowtype;
begin
  if not coalesce((select m.is_platform_admin from public.agency_members m where m.id = v_admin), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('error', 'note_too_long');
  end if;

  select * into v_r from public.lead_invalid_reports where id = p_report for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_r.status <> 'pending_review' then
    return jsonb_build_object('error', 'already_decided', 'status', v_r.status);
  end if;

  if p_approve then
    update public.lead_invalid_reports set decision_note = v_note where id = p_report;
    return public._lead_report_apply(p_report, v_admin, false);
  end if;

  update public.lead_invalid_reports
     set status = 'rejected', decided_by = v_admin, decided_at = now(), decision_note = v_note
   where id = p_report;
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  values (v_r.agent_id, 'system', 'הדיווח על הליד לא אושר',
          coalesce(v_note, 'לאחר בדיקה, הליד נשאר אצלך ולא הוחזר חיוב.'), v_r.lead_id, false);
  return jsonb_build_object('status', 'rejected');
end;
$$;

revoke all on function public.lead_report_review(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.lead_report_review(uuid, boolean, text) to authenticated;

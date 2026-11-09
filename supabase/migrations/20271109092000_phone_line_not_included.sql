-- ---------------------------------------------------------------------------
-- המספר הווירטואלי: תוספת בתשלום בכל מסלול, לא כלול באף אחד
-- (docs/call-tracking.md, docs/pricing-and-tiers.md)
--
-- ## מה השתנה, ולמה
--
-- עד היום Elite קיבל/ה מספר אחד כלול ומספרים נוספים ב-89 ₪, ושאר המסלולים
-- מספר אחד בלבד ב-89 ₪ (מספר שני = tier_required). הנתון (9.11.2026): המספר
-- כלול ב-Elite חינם מ-4.10.2026, ומתוך 55 סוכני Elite פעילים אחד/ת הזמין/ה
-- אותו; 3 שיחות בסך הכול. ההכללה לא קנתה ערך נתפס לאיש, והיא הצדיקה ₪89
-- במחיר של Elite. מעכשיו:
--
--   * **כל מספר ב-89 ₪ לחודש מהארנק, בכל מסלול.** אין מספר כלול.
--   * **אין תקרה למספר מסלול.** ההגבלה "מספר אחד מחוץ ל-Elite" נולדה כדי להבדיל
--     את המסלול שבו המספר כלול; כשכולם משלמים לכל מספר, אין לה סיבה.
--   * **הקו הכלול היחיד הקיים ממשיך כלול** (grandfathering): included = true נשאר
--     עד שהקו משוחרר, מתחדש בלי חיוב בכל חודש, ולא תלוי במסלול. הסוכן/ת קיבל/ה
--     אותו על הנוסח הישן. שיוך הקו לסוכן/ת אחר/ת במשרד מוריד את ההכללה, כמו קודם.
--
-- ## מה נשאר, ואיך
--
-- * phone_line_included_eligible נשארת בשם ובחתימה ומחזירה false: היא נקראת
--   מארבע פונקציות ומ-twilio-voice, והכלל "אף מסלול אינו כולל" מתועד בה
--   במקום להימחק ולהישאר בהפניות. היא יורדת מ-GATES ב-check_tier_gates.py,
--   ושורות המספר ב-COMPARE הופכות זהות בשלוש העמודות.
-- * phone_line_tier_sweep נשארת בחתימה (twilio-voice קוראת לה בכל סבב) ועושה
--   דבר אחד: מנקה חלון בחירה שנפתח בעבר, כי כבר אין ירידת מסלול שמשחררת
--   מספרים. היא מחזירה את אותם חמישה מערכים, ריקים.
-- * phone_line_keep_on_downgrade נשארת: בלי downgrade_deadline היא מחזירה false.
--
-- הגופים הועתקו מ-20270220090000 / 20270221090000 / 20270224090000 (md5 של
-- prosrc בפרודקשן זהה לקבצים, נבדק 9.11.2026). אידמפוטנטית.
-- ---------------------------------------------------------------------------

-- 1. הגייט: אף מסלול אינו כולל מספר. הקו הכלול הקיים נשמר דרך העמודה included.
create or replace function public.phone_line_included_eligible(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false where p_agent_id is not null or p_agent_id is null;
$$;
comment on function public.phone_line_included_eligible(uuid) is
  'מ-9.11.2026 אף מסלול אינו כולל מספר וירטואלי: תמיד false. נשארת כי order_phone_line, phone_line_quota, office_phone_line_assign ו-twilio-voice קוראים לה. הקו הכלול היחיד שנוצר לפני כן נשמר דרך agent_phone_lines.included. docs/call-tracking.md';
revoke all on function public.phone_line_included_eligible(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_included_eligible(uuid) to service_role;

-- 2. מה מותר להזמין ובכמה: תמיד מותר, תמיד במחיר המלא. אותם שדות, לדפדפן.
create or replace function public.phone_line_quota(p_agent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select count(*) as n, coalesce(bool_or(included), false) as inc
      from public.agent_phone_lines
     where agent_id = p_agent_id and status in ('pending', 'active') and monthly_price is not null
  ), p as (
    select public.phone_line_included_eligible(p_agent_id) as prem,
           coalesce((select value from public.pricing_config where key = 'phone_line_monthly_price'), 89) as price,
           coalesce((select value from public.pricing_config where key = 'phone_line_included_minutes'), 150) as minutes,
           coalesce((select value from public.pricing_config where key = 'phone_line_overage_per_min'), 0.5) as rate
  )
  select jsonb_build_object(
    'premium',          p.prem,
    'live',             l.n,
    'can_order',        true,
    'next_price',       p.price,
    'price',            p.price,
    'included_minutes', p.minutes,
    'overage_per_min',  p.rate)
  from l, p;
$$;
revoke all on function public.phone_line_quota(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_quota(uuid) to service_role;

-- 3. הזמנה: בלי תקרה למסלול, תמיד בחיוב
create or replace function public.order_phone_line(
  p_agent_id uuid, p_number text, p_label text, p_source text, p_property_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent    public.agency_members%rowtype;
  v_price    numeric;
  v_rows     int;
  v_line     uuid;
  v_until    timestamptz := now() + interval '1 month';
begin
  -- הנעילה על השורה של הסוכן/ת מונעת שתי הזמנות במקביל על אותה יתרה
  select * into v_agent from public.agency_members where id = p_agent_id and active = true for update;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select value into v_price from public.pricing_config where key = 'phone_line_monthly_price';
  v_price := coalesce(v_price, 89);

  update public.agency_members
     set credit_balance = credit_balance - v_price
   where id = p_agent_id and credit_balance >= v_price;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'required', v_price,
                              'balance', v_agent.credit_balance);
  end if;

  insert into public.agent_phone_lines
    (agent_id, twilio_number, active, status, label, source_type, property_id, monthly_price, paid_until, included)
  values
    (p_agent_id, p_number, false, 'pending', nullif(trim(p_label), ''), p_source, p_property_id, v_price, v_until, false)
  returning id into v_line;

  insert into public.phone_line_charges (line_id, agent_id, kind, amount, period_end)
  values (v_line, p_agent_id, 'purchase', v_price, v_until);

  return jsonb_build_object('success', true, 'line_id', v_line, 'price_charged', v_price,
                            'included', false, 'balance', v_agent.credit_balance - v_price);
end;
$$;
revoke all on function public.order_phone_line(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.order_phone_line(uuid, text, text, text, uuid) to service_role;

-- 4. חידוש חודשי: קו כלול (ישן) מתחדש בלי חיוב, בלי תלות במסלול
create or replace function public.claim_due_phone_line_renewals()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_rows  int;
  v_renew jsonb := '[]'::jsonb;
  v_fail  jsonb := '[]'::jsonb;
  v_rel   jsonb := '[]'::jsonb;
begin
  for r in
    select * from public.agent_phone_lines
     where status = 'active' and coalesce(monthly_price, 0) > 0
       and paid_until is not null and paid_until <= now()
     for update skip locked
  loop
    if r.included then
      -- הקו הכלול מהנוסח הישן: מתחדש בלי חיוב עד שישוחרר (grandfathering)
      update public.agent_phone_lines
         set paid_until = greatest(paid_until, now()) + interval '1 month', payment_failed_at = null
       where id = r.id;
      continue;
    end if;

    update public.agency_members
       set credit_balance = credit_balance - r.monthly_price
     where id = r.agent_id and credit_balance >= r.monthly_price;
    get diagnostics v_rows = row_count;

    if v_rows = 1 then
      update public.agent_phone_lines
         set paid_until = greatest(paid_until, now()) + interval '1 month', payment_failed_at = null
       where id = r.id;
      insert into public.phone_line_charges (line_id, agent_id, kind, amount, period_end)
      values (r.id, r.agent_id, 'renewal', r.monthly_price, greatest(r.paid_until, now()) + interval '1 month');
      v_renew := v_renew || jsonb_build_object('line_id', r.id, 'agent_id', r.agent_id);
    elsif r.payment_failed_at is null then
      update public.agent_phone_lines set payment_failed_at = now() where id = r.id;
      v_fail := v_fail || jsonb_build_object('line_id', r.id, 'agent_id', r.agent_id,
                                             'number', r.twilio_number, 'label', r.label, 'price', r.monthly_price);
    elsif r.payment_failed_at < now() - interval '7 days' then
      update public.agent_phone_lines
         set status = 'released', active = false, released_at = now(),
             twilio_number = twilio_number || '#released-' || left(id::text, 8)
       where id = r.id;
      v_rel := v_rel || jsonb_build_object('line_id', r.id, 'agent_id', r.agent_id,
                                           'number', r.twilio_number, 'label', r.label, 'twilio_sid', r.twilio_sid);
    end if;
  end loop;
  return jsonb_build_object('renewed', v_renew, 'payment_failed', v_fail, 'released', v_rel);
end;
$$;
revoke all on function public.claim_due_phone_line_renewals() from public, anon, authenticated;
grant execute on function public.claim_due_phone_line_renewals() to service_role;

-- 5. הסבב היומי: אין יותר ירידת מסלול שמשחררת מספרים. מנקה חלון בחירה ישן,
--    ומחזיר את אותה צורה (חמישה מערכים) כדי ש-twilio-voice ימשיך לעבוד.
create or replace function public.phone_line_tier_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agent_phone_lines
     set downgrade_deadline = null, downgrade_keep = false
   where status in ('pending', 'active') and (downgrade_deadline is not null or downgrade_keep);
  return jsonb_build_object('warn', '[]'::jsonb, 'included', '[]'::jsonb, 'choose', '[]'::jsonb,
                            'converted', '[]'::jsonb, 'released', '[]'::jsonb);
end;
$$;
comment on function public.phone_line_tier_sweep() is
  'מ-9.11.2026 המספר אינו כלול באף מסלול ואין תקרה למסלול, ולכן אין מה לשחרר בירידה. נשארת בחתימה (twilio-voice?task=lines-renew) ומנקה חלון בחירה ישן. docs/call-tracking.md';
revoke all on function public.phone_line_tier_sweep() from public, anon, authenticated;
grant execute on function public.phone_line_tier_sweep() to service_role;

-- 6. שיוך מספר לסוכן/ת אחר/ת במשרד: בלי תקרה למסלול. ההכללה יורדת בשיוך, כמו קודם.
create or replace function public.office_phone_line_assign(p_line_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_line   public.agent_phone_lines%rowtype;
  v_from   text;
  v_to     text;
  v_num    text;
begin
  if public.current_member_role() is distinct from 'manager' or v_agency is null then
    return jsonb_build_object('error', 'not_manager');
  end if;

  select * into v_line from public.agent_phone_lines
   where id = p_line_id and status <> 'released' for update;
  if not found or not exists (select 1 from public.agency_members
                               where id = v_line.agent_id and agency_id = v_agency) then
    return jsonb_build_object('error', 'line_not_in_office');
  end if;
  select display_name into v_to from public.agency_members
   where id = p_agent_id and agency_id = v_agency and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_in_office');
  end if;
  if v_line.agent_id = p_agent_id then
    return jsonb_build_object('success', true, 'unchanged', true);
  end if;

  select display_name into v_from from public.agency_members where id = v_line.agent_id;
  v_num := '0' || substr(v_line.twilio_number, 5);

  update public.agent_phone_lines
     set agent_id = p_agent_id, included = false, forward_to = null,
         downgrade_deadline = null, downgrade_keep = false
   where id = p_line_id;

  insert into public.notifications (agent_id, type, title, body) values
    (p_agent_id, 'system', 'קיבלת מספר וירטואלי',
     format('מנהל/ת המשרד העביר/ה אליך את המספר %s%s. שיחות אליו יגיעו לנייד שלך, עם הקלטה וסיכום.%s',
            v_num, coalesce(' (' || v_line.label || ')', ''),
            case when v_line.monthly_price is not null
                 then format(' החידוש החודשי (%s ₪) יורד מהארנק שלך.', v_line.monthly_price) else '' end)),
    (v_line.agent_id, 'system', 'מספר וירטואלי הועבר',
     format('המספר %s%s הועבר ל%s. השיחות הקודמות שלו נשארות אצלך ביומן.',
            v_num, coalesce(' (' || v_line.label || ')', ''), coalesce(v_to, 'סוכן/ת אחר/ת')));

  return jsonb_build_object('success', true, 'from', v_from, 'to', v_to);
end;
$$;
revoke all on function public.office_phone_line_assign(uuid, uuid) from public, anon, authenticated;
grant execute on function public.office_phone_line_assign(uuid, uuid) to authenticated;

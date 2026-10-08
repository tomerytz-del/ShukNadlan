-- ---------------------------------------------------------------------------
-- שיחה יוצאת נספרת דקה וחצי לכל דקה
--
-- החלטה מ-7.10.2026. שיחה יוצאת (‏Click2Call, עדיין לא בנויה) עולה לנו שתי
-- רגליים ב-Twilio: לנייד של הסוכן/ת ומשם ללקוח/ה - כ-51 אגורות לדקה לנייד
-- וכ-38 לקווי, מול כ-31 לשיחה נכנסת. בתקרת 150 הדקות זה היה ₪97 עלות מול
-- ₪89 שנגבים. לכן כל דקה יוצאת נספרת 1.5 מהמכסה, ומעבר לה גם החיוב לפי
-- הדקות המשוקללות (בפועל 0.75 ₪ לדקה יוצאת).
--
-- הכלל נכנס עכשיו, לפני שהשיחות היוצאות קיימות, כדי שמי שבונה אותן ימצא אותו
-- כאן ולא ימציא תמחור משלו: כל שורה ב-agent_calls עם direction = 'outbound'
-- נספרת כך, בלי שינוי נוסף בקוד.
--
-- ‏billed_minutes נשאר int - דקות **משוקללות**, כך שכל מי שסוכם אותו
-- (‏phone_line_minutes_used, המכסה ב-CRM) ממשיך לעבוד בלי שינוי.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

insert into public.pricing_config (key, value, description) values
  ('phone_line_outbound_minute_weight', 1.5,
   'מספר וירטואלי - כמה דקות מהמכסה נספרות לכל דקה של שיחה יוצאת. docs/call-tracking.md')
on conflict (key) do nothing;

create or replace function public.charge_call_minutes(p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call   public.agent_calls%rowtype;
  v_line   public.agent_phone_lines%rowtype;
  v_cap    int;
  v_rate   numeric;
  v_min    int;
  v_before int;
  v_over   int;
  v_amount numeric := 0;
  v_paid   boolean := true;
  v_rows   int;
  v_warn   int;
  v_weight numeric := 1;
begin
  select * into v_call from public.agent_calls where id = p_call_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_call.billed_minutes is not null then
    return jsonb_build_object('already', true);
  end if;

  -- שיחה יוצאת נספרת פי phone_line_outbound_minute_weight (‏1.5): היא עולה
  -- שתי רגליים ב-Twilio (‏~51 אגורות לדקה לנייד מול ~31 לנכנסת). העיגול
  -- כלפי מעלה הוא על השניות המשוקללות, כמו בנכנסת - שיחה של דקה = 2.
  select coalesce((select value from public.pricing_config
                    where key = 'phone_line_outbound_minute_weight'), 1.5)
    into v_weight;
  if v_call.direction <> 'outbound' then
    v_weight := 1;
  end if;

  v_min := case when v_call.status = 'answered' and coalesce(v_call.duration_sec, 0) > 0
                then ceil(v_call.duration_sec * v_weight / 60.0)::int else 0 end;

  select * into v_line from public.agent_phone_lines where id = v_call.line_id for update;
  if not found or v_line.monthly_price is null then
    update public.agent_calls set billed_minutes = v_min, overage_minutes = 0 where id = p_call_id;
    return jsonb_build_object('limited', false, 'minutes', v_min);
  end if;

  select coalesce(value, 150)::int into v_cap from public.pricing_config where key = 'phone_line_included_minutes';
  select coalesce(value, 0.5) into v_rate from public.pricing_config where key = 'phone_line_overage_per_min';
  v_cap  := coalesce(v_cap, 150);
  v_rate := coalesce(v_rate, 0.5);

  select coalesce(sum(billed_minutes), 0)::int into v_before
    from public.agent_calls
   where line_id = v_line.id and created_at >= public.phone_line_month_start()
     and id <> p_call_id and billed_minutes is not null;

  v_over := greatest(0, least(v_min, v_before + v_min - v_cap));
  if v_over > 0 then
    v_amount := v_over * v_rate;
    update public.agency_members
       set credit_balance = credit_balance - v_amount
     where id = v_line.agent_id and credit_balance >= v_amount;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      insert into public.phone_line_charges (line_id, agent_id, kind, amount)
      values (v_line.id, v_line.agent_id, 'overage', v_amount);
    else
      v_paid := false;
    end if;
  end if;

  update public.agent_calls
     set billed_minutes = v_min, overage_minutes = v_over,
         overage_charged = case when v_paid then v_amount else 0 end
   where id = p_call_id;

  v_warn := ceil(v_cap * 0.8)::int;
  return jsonb_build_object(
    'limited',     true,
    'agent_id',    v_line.agent_id,
    'line_id',     v_line.id,
    'number',      v_line.twilio_number,
    'label',       v_line.label,
    'minutes',     v_min,
    'weight',      v_weight,
    'used',        v_before + v_min,
    'cap',         v_cap,
    'rate',        v_rate,
    'over',        v_over,
    'charged',     case when v_paid then v_amount else 0 end,
    'unpaid',      not v_paid,
    'crossed_80',  v_before < v_warn and v_before + v_min >= v_warn and v_before + v_min < v_cap,
    'crossed_cap', v_before < v_cap and v_before + v_min >= v_cap);
end;
$$;

revoke all on function public.charge_call_minutes(uuid) from public, anon, authenticated;
grant execute on function public.charge_call_minutes(uuid) to service_role;

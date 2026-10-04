-- ---------------------------------------------------------------------------
-- מספר וירטואלי: 150 דקות בחודש, ומעבר לזה 0.5 ₪ לדקה מהארנק
-- (docs/call-tracking.md)
--
-- העלות שלנו לדקה שנענתה היא כ-31 אגורות (קבלה $0.0107, רגל לנייד $0.0646,
-- הקלטה ו-Whisper $0.0085), ועוד כ-20 ₪ לחודש למספר. מול 89 ₪ נקודת האיזון
-- היא כ-170 דקות, ולכן התקרה 150, והדקה הנוספת 50 אגורות.
--
-- דקה = כל דקה שהתחילה בשיחה שנענתה (ceil), כמו ש-Twilio מחייבת. שיחה שלא
-- נענתה אינה נספרת. המכסה לפי חודש קלנדרי בשעון ישראל, לכל מספר בנפרד - גם
-- למספר הכלול ב-Elite, שעולה לנו אותו הדבר. מספר בלי monthly_price (הפיילוט,
-- מספר שהפלטפורמה נתנה) מחוץ לתקרה.
--
-- אין יתרה לדקות הנוספות: השיחות **ממשיכות להגיע** - לקוח/ה שלא נענה/תה עולה
-- לסוכן/ת יותר מכל דקה - אבל בלי הקלטה, תמלול וסיכום, עד טעינה או עד ה-1
-- לחודש. הדקות שכבר עברו בלי כיסוי נבלעות אצלנו ונרשמות (overage_charged = 0).
-- ---------------------------------------------------------------------------

alter table public.agent_calls add column if not exists billed_minutes  int;
alter table public.agent_calls add column if not exists overage_minutes int;
alter table public.agent_calls add column if not exists overage_charged numeric;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'phone_line_charges_kind_check'
              and pg_get_constraintdef(oid) not like '%overage%') then
    alter table public.phone_line_charges drop constraint phone_line_charges_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phone_line_charges_kind_check') then
    alter table public.phone_line_charges add constraint phone_line_charges_kind_check
      check (kind in ('purchase', 'renewal', 'refund', 'overage'));
  end if;
end $$;

insert into public.pricing_config (key, value, description) values
  ('phone_line_included_minutes', 150, 'מספר וירטואלי - דקות שנענו בחודש קלנדרי, כלולות במחיר. docs/call-tracking.md'),
  ('phone_line_overage_per_min', 0.5, 'מספר וירטואלי - מחיר דקה מעבר למכסה, בשקלים, מהארנק. docs/call-tracking.md')
on conflict (key) do nothing;

-- תחילת החודש בשעון ישראל: המכסה מתאפסת בחצות של ה-1, לא בשלוש לפנות בוקר
create or replace function public.phone_line_month_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
$$;

revoke all on function public.phone_line_month_start() from public, anon, authenticated;
grant execute on function public.phone_line_month_start() to service_role;

-- ---------------------------------------------------------------------------
-- דקות החודש של מספר, והאם להקליט את השיחה הבאה
-- ---------------------------------------------------------------------------
create or replace function public.phone_line_minutes_used(p_line_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(billed_minutes), 0)::int
    from public.agent_calls
   where line_id = p_line_id and created_at >= public.phone_line_month_start();
$$;

revoke all on function public.phone_line_minutes_used(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_minutes_used(uuid) to service_role;

create or replace function public.phone_line_recording_allowed(p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when l.monthly_price is null then true
    when public.phone_line_minutes_used(l.id)
         < coalesce((select value from public.pricing_config where key = 'phone_line_included_minutes'), 150) then true
    else m.credit_balance >= coalesce((select value from public.pricing_config where key = 'phone_line_overage_per_min'), 0.5)
  end
  from public.agent_phone_lines l
  join public.agency_members m on m.id = l.agent_id
  where l.id = p_line_id;
$$;

revoke all on function public.phone_line_recording_allowed(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_recording_allowed(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- חיוב הדקות של שיחה שהסתיימה. אידמפוטנטית: Twilio עשויה לשלוח את ה-action
-- של <Dial> פעמיים, ושיחה שכבר נספרה (billed_minutes) אינה נספרת שוב.
-- הנעילה על שורת המספר מסדרת שתי שיחות שנגמרות יחד על אותו מספר.
-- ---------------------------------------------------------------------------
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
begin
  select * into v_call from public.agent_calls where id = p_call_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_call.billed_minutes is not null then
    return jsonb_build_object('already', true);
  end if;

  v_min := case when v_call.status = 'answered' and coalesce(v_call.duration_sec, 0) > 0
                then ceil(v_call.duration_sec / 60.0)::int else 0 end;

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

-- ---------------------------------------------------------------------------
-- המכסה גם במה שהדפדפן רואה לפני הזמנה (אותה חתימה, שדות נוספים בסוף)
-- ---------------------------------------------------------------------------
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
    'can_order',        p.prem or l.n = 0,
    'next_price',       case when p.prem and not l.inc then 0 else p.price end,
    'price',            p.price,
    'included_minutes', p.minutes,
    'overage_per_min',  p.rate)
  from l, p;
$$;

revoke all on function public.phone_line_quota(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_quota(uuid) to service_role;

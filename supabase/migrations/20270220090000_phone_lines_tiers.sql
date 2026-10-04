-- ---------------------------------------------------------------------------
-- מספרים וירטואליים לפי מסלול (docs/call-tracking.md, docs/pricing-and-tiers.md)
--
--   Elite (premium)          - מספר אחד כלול, ונוספים ב-89 ₪ לחודש, בלי תקרה.
--   PROFESSIONAL / Pay&GO    - מספר אחד, ב-89 ₪ לחודש.
--
-- ירידה מ-Elite: נשאר מספר אחד לבחירת הסוכן/ת, בתשלום. שבעה ימים לבחור
-- (phone_line_keep_on_downgrade); לא נבחר - נשאר המספר שקיבל הכי הרבה שיחות
-- ב-30 הימים האחרונים, והשאר משתחררים. שבוע לפני שהמסלול מסתיים (מנוי ששולם
-- או הטבת ההשקה) נשלחת התראה מראש.
--
-- הכלל נאכף במסד ולא בכפתור: order_phone_line מסרבת, והסבב היומי
-- phone_line_tier_sweep הוא מה שממיר ומשחרר - ולא טריגר על agency_members,
-- כי המסלול משתנה בחמש דרכים שונות (פקיעה, מנהל/ת, הטבה, בחירה, סגירת חשבון)
-- וסבב אחד שבודק את המצב תופס את כולן.
--
-- מספר בלי monthly_price (הפיילוט, מספר שהפלטפורמה נתנה) מחוץ לכל זה.
-- ---------------------------------------------------------------------------

alter table public.agent_phone_lines add column if not exists included            boolean not null default false;
alter table public.agent_phone_lines add column if not exists downgrade_deadline  timestamptz;
alter table public.agent_phone_lines add column if not exists downgrade_keep      boolean not null default false;
alter table public.agent_phone_lines add column if not exists downgrade_warned_at timestamptz;

-- ---------------------------------------------------------------------------
-- הגייט: מספר כלול ומספרים נוספים - Elite בתוקף בלבד
-- ---------------------------------------------------------------------------
create or replace function public.phone_line_included_eligible(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agency_members m
     where m.id = p_agent_id
       and m.active = true
       and m.billing_status = 'active'
       and m.tier = 'premium'
  );
$$;

revoke all on function public.phone_line_included_eligible(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_included_eligible(uuid) to service_role;

-- מה מותר להזמין עכשיו, ובכמה. המנוע ל-service_role, והעטיפה לדפדפן מה-JWT.
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
           coalesce((select value from public.pricing_config where key = 'phone_line_monthly_price'), 89) as price
  )
  select jsonb_build_object(
    'premium',    p.prem,
    'live',       l.n,
    'can_order',  p.prem or l.n = 0,
    'next_price', case when p.prem and not l.inc then 0 else p.price end,
    'price',      p.price)
  from l, p;
$$;

revoke all on function public.phone_line_quota(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_quota(uuid) to service_role;

create or replace function public.my_phone_line_quota()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.phone_line_quota(public.current_agent_id());
$$;

revoke all on function public.my_phone_line_quota() from public, anon;
grant execute on function public.my_phone_line_quota() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- הזמנה: אותה חתימה, ועכשיו עם המסלול
-- ---------------------------------------------------------------------------
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
  v_charge   numeric;
  v_rows     int;
  v_line     uuid;
  v_live     int;
  v_has_inc  boolean;
  v_premium  boolean;
  v_included boolean;
  v_until    timestamptz := now() + interval '1 month';
begin
  -- הנעילה על השורה של הסוכן/ת היא מה שמונע שתי הזמנות במקביל שעוברות את התקרה
  select * into v_agent from public.agency_members where id = p_agent_id and active = true for update;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select value into v_price from public.pricing_config where key = 'phone_line_monthly_price';
  v_price := coalesce(v_price, 89);

  select count(*), coalesce(bool_or(included), false) into v_live, v_has_inc
    from public.agent_phone_lines
   where agent_id = p_agent_id and status in ('pending', 'active') and monthly_price is not null;
  v_premium := public.phone_line_included_eligible(p_agent_id);

  if not v_premium and v_live >= 1 then
    return jsonb_build_object(
      'error',         'tier_required',
      'required_tier', 'premium',
      'detail',        'במסלול שלך אפשר להחזיק מספר וירטואלי אחד. מספרים נוספים זמינים במסלול Elite.');
  end if;

  v_included := v_premium and not v_has_inc;
  v_charge   := case when v_included then 0 else v_price end;

  if v_charge > 0 then
    update public.agency_members
       set credit_balance = credit_balance - v_charge
     where id = p_agent_id and credit_balance >= v_charge;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('error', 'insufficient_balance', 'required', v_charge,
                                'balance', v_agent.credit_balance);
    end if;
  end if;

  -- monthly_price נשמר גם במספר הכלול: זה המחיר שלו אם המסלול יורד
  insert into public.agent_phone_lines
    (agent_id, twilio_number, active, status, label, source_type, property_id, monthly_price, paid_until, included)
  values
    (p_agent_id, p_number, false, 'pending', nullif(trim(p_label), ''), p_source, p_property_id, v_price, v_until, v_included)
  returning id into v_line;

  insert into public.phone_line_charges (line_id, agent_id, kind, amount, period_end)
  values (v_line, p_agent_id, 'purchase', v_charge, v_until);

  return jsonb_build_object('success', true, 'line_id', v_line, 'price_charged', v_charge,
                            'included', v_included, 'balance', v_agent.credit_balance - v_charge);
end;
$$;

revoke all on function public.order_phone_line(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.order_phone_line(uuid, text, text, text, uuid) to service_role;

-- קנייה שנכשלה: מחזירים את מה שנגבה בפועל - במספר הכלול זה אפס
create or replace function public.phone_line_order_failed(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line   public.agent_phone_lines%rowtype;
  v_refund numeric;
begin
  select * into v_line from public.agent_phone_lines where id = p_line_id and status = 'pending' for update;
  if not found then
    return jsonb_build_object('error', 'not_pending');
  end if;
  v_refund := case when v_line.included then 0 else coalesce(v_line.monthly_price, 0) end;
  if v_refund > 0 then
    update public.agency_members set credit_balance = credit_balance + v_refund
     where id = v_line.agent_id;
    insert into public.phone_line_charges (line_id, agent_id, kind, amount)
    values (v_line.id, v_line.agent_id, 'refund', -v_refund);
  end if;
  update public.agent_phone_lines
     set status = 'released', active = false, released_at = now(),
         twilio_number = twilio_number || '#failed-' || left(id::text, 8)
   where id = p_line_id;
  return jsonb_build_object('success', true, 'refunded', v_refund);
end;
$$;

revoke all on function public.phone_line_order_failed(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_order_failed(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- חידוש חודשי: המספר הכלול מתחדש בלי חיוב כל עוד המסלול Elite. מספר כלול
-- של מי שירד/ה ממתין לסבב המסלולים (הוא שממיר אותו לבתשלום), ולכן מדולג כאן.
-- ---------------------------------------------------------------------------
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
      if public.phone_line_included_eligible(r.agent_id) then
        update public.agent_phone_lines
           set paid_until = greatest(paid_until, now()) + interval '1 month', payment_failed_at = null
         where id = r.id;
      end if;
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

-- ---------------------------------------------------------------------------
-- הסבב היומי של המסלולים. רץ לפני החידוש, ומחזיר אירועים להתראות:
--   warn        - Elite שמסתיים בעוד 7 ימים או פחות, ויש מספר כלול או יותר ממספר אחד
--   included    - Elite שאין לו/ה מספר כלול: הוותיק ביותר נעשה כלול
--   choose      - ירד/ה מ-Elite עם כמה מספרים: 7 ימים לבחור
--   converted   - המספר שנשאר עובר לתשלום (89 ₪ מסוף התקופה ששולמה)
--   released    - המספרים שלא נבחרו (twilio_sid לשחרור ב-Twilio)
-- ---------------------------------------------------------------------------
create or replace function public.phone_line_tier_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_keep   uuid;
  v_warn   jsonb := '[]'::jsonb;
  v_inc    jsonb := '[]'::jsonb;
  v_choose jsonb := '[]'::jsonb;
  v_conv   jsonb := '[]'::jsonb;
  v_rel    jsonb := '[]'::jsonb;
  r        record;
begin
  for a in
    select l.agent_id,
           count(*)                                   as n,
           coalesce(bool_or(l.included), false)       as has_inc,
           min(l.downgrade_deadline)                  as deadline,
           max(l.downgrade_warned_at)                 as warned_at,
           public.phone_line_included_eligible(l.agent_id) as prem,
           max(case when m.tier_source = 'paid' then m.paid_tier_until
                    when m.tier_source = 'launch_promo' and m.promo_ended_at is null then m.promo_ends_at end) as tier_ends
      from public.agent_phone_lines l
      join public.agency_members m on m.id = l.agent_id
     where l.status in ('pending', 'active') and l.monthly_price is not null
     group by l.agent_id
  loop
    if a.prem then
      -- חזר/ה ל-Elite בתוך חלון הבחירה, או מעולם לא ירד/ה
      if a.deadline is not null then
        update public.agent_phone_lines set downgrade_deadline = null, downgrade_keep = false
         where agent_id = a.agent_id and status in ('pending', 'active');
      end if;
      if not a.has_inc then
        v_keep := null;
        update public.agent_phone_lines set included = true
         where id = (select id from public.agent_phone_lines
                      where agent_id = a.agent_id and status = 'active' and monthly_price is not null
                      order by created_at limit 1)
        returning id into v_keep;
        if v_keep is not null then
          v_inc := v_inc || (select jsonb_build_object('agent_id', a.agent_id, 'line_id', id,
                                                       'number', twilio_number, 'label', label)
                               from public.agent_phone_lines where id = v_keep);
        end if;
      end if;
      if (a.n > 1 or a.has_inc) and a.tier_ends is not null and a.tier_ends > now() and a.tier_ends <= now() + interval '7 days'
         and (a.warned_at is null or a.warned_at < now() - interval '20 days') then
        update public.agent_phone_lines set downgrade_warned_at = now()
         where agent_id = a.agent_id and status in ('pending', 'active');
        v_warn := v_warn || jsonb_build_object('agent_id', a.agent_id, 'count', a.n, 'ends_at', a.tier_ends);
      end if;
      continue;
    end if;

    -- לא Elite. מספר אחד בתשלום - אין מה לעשות.
    if a.n = 1 and not a.has_inc and a.deadline is null then
      continue;
    end if;

    if a.n = 1 then
      -- מספר אחד (כלול, או שנשאר אחרי שהסוכן/ת שחרר/ה את השאר): עובר לתשלום
      update public.agent_phone_lines
         set included = false, downgrade_deadline = null, downgrade_keep = false,
             paid_until = greatest(coalesce(paid_until, now()), now())
       where agent_id = a.agent_id and status in ('pending', 'active') and monthly_price is not null
      returning id, twilio_number, label, monthly_price, paid_until into r;
      if a.has_inc then
        v_conv := v_conv || jsonb_build_object('agent_id', a.agent_id, 'line_id', r.id, 'number', r.twilio_number,
                                               'label', r.label, 'price', r.monthly_price, 'paid_until', r.paid_until);
      end if;
      continue;
    end if;

    if a.deadline is null then
      update public.agent_phone_lines set downgrade_deadline = now() + interval '7 days'
       where agent_id = a.agent_id and status in ('pending', 'active') and monthly_price is not null;
      v_choose := v_choose || jsonb_build_object('agent_id', a.agent_id, 'count', a.n,
                                                 'deadline', now() + interval '7 days');
      continue;
    end if;

    if a.deadline > now() then
      continue;
    end if;

    -- נגמר הזמן: הנבחר, או מי שקיבל הכי הרבה שיחות ב-30 יום, או הוותיק
    select l.id into v_keep
      from public.agent_phone_lines l
     where l.agent_id = a.agent_id and l.status in ('pending', 'active') and l.monthly_price is not null
     order by l.downgrade_keep desc,
              (select count(*) from public.agent_calls c
                where c.line_id = l.id and c.created_at > now() - interval '30 days') desc,
              l.created_at
     limit 1;

    for r in
      update public.agent_phone_lines
         set status = 'released', active = false, released_at = now(),
             twilio_number = twilio_number || '#released-' || left(id::text, 8)
       where agent_id = a.agent_id and status in ('pending', 'active') and monthly_price is not null
         and id <> v_keep
      returning id, label, twilio_sid, split_part(twilio_number, '#', 1) as number
    loop
      v_rel := v_rel || jsonb_build_object('agent_id', a.agent_id, 'line_id', r.id, 'number', r.number,
                                           'label', r.label, 'twilio_sid', r.twilio_sid);
    end loop;

    update public.agent_phone_lines
       set included = false, downgrade_deadline = null, downgrade_keep = false,
           paid_until = greatest(coalesce(paid_until, now()), now())
     where id = v_keep
    returning id, twilio_number, label, monthly_price, paid_until into r;
    v_conv := v_conv || jsonb_build_object('agent_id', a.agent_id, 'line_id', r.id, 'number', r.twilio_number,
                                           'label', r.label, 'price', r.monthly_price, 'paid_until', r.paid_until);
  end loop;

  return jsonb_build_object('warn', v_warn, 'included', v_inc, 'choose', v_choose,
                            'converted', v_conv, 'released', v_rel);
end;
$$;

revoke all on function public.phone_line_tier_sweep() from public, anon, authenticated;
grant execute on function public.phone_line_tier_sweep() to service_role;

-- הבחירה של הסוכן/ת איזה מספר נשאר. רק בחלון הבחירה, ורק במספר שלו/ה.
create or replace function public.phone_line_keep_on_downgrade(p_line_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
begin
  if not exists (
    select 1 from public.agent_phone_lines
     where id = p_line_id and agent_id = v_agent and status in ('pending', 'active')
       and downgrade_deadline is not null
  ) then
    return false;
  end if;
  update public.agent_phone_lines
     set downgrade_keep = (id = p_line_id)
   where agent_id = v_agent and status in ('pending', 'active') and monthly_price is not null;
  return true;
end;
$$;

revoke all on function public.phone_line_keep_on_downgrade(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_keep_on_downgrade(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ה-cron רץ כל יום: הסבב צריך לרוץ גם כשאין חידוש שהגיע זמנו (ירידת מסלול,
-- התראה מראש). קריאה אחת ביום - העלות זניחה.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/twilio-voice?task=lines-renew';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('phone-lines-renew')
    where exists (select 1 from cron.job where jobname = 'phone-lines-renew');
  perform cron.schedule('phone-lines-renew', '23 4 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 60000
    )
    where exists (select 1 from public.agent_phone_lines
                   where status in ('pending', 'active') and monthly_price is not null)
  $cron$, v_url));
end $$;

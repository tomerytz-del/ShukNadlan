-- ---------------------------------------------------------------------------
-- מספרי מעקב: כינוי ומקור לכל מספר, הזמנה מהארנק, וחידוש חודשי
-- (docs/call-tracking.md)
--
-- כל מספר הוא "ערוץ": השלט באורנים 13, המודעה ביד2, קמפיין בפייסבוק. השיחות
-- כבר נשמרות עם line_id, ולכן הכינוי והמקור הם מה שהופך אותן לדוח "מאיפה
-- הלקוחות מגיעים".
--
-- התשלום: מהארנק בלבד (docs/wallet-payments.md - הארנק הוא מקור המימון היחיד
-- באתר), 89 ₪ לחודש ממחירון pricing_config. אותה תבנית כמו purchase_rss_lead:
-- הניכוי והשורה בטרנזקציה אחת, והפונקציה ל-service_role בלבד, כי הטריגר
-- protect_sensitive_agency_member_fields מתעלם משינוי credit_balance שלא הגיע
-- משם - חיוב מהדפדפן היה נבלע בשקט והמספר היה ניתן בחינם.
--
-- הקנייה ב-Twilio היא ב-twilio-voice?task=lines-order, אחרי החיוב. נכשלה -
-- phone_line_order_failed מחזירה את הכסף. מספר בלי monthly_price (הפיילוט,
-- או מספר שהפלטפורמה נתנה) אינו מחויב ואינו מתחדש.
-- ---------------------------------------------------------------------------

alter table public.agent_phone_lines add column if not exists label         text;
alter table public.agent_phone_lines add column if not exists source_type   text;
alter table public.agent_phone_lines add column if not exists property_id   uuid;
alter table public.agent_phone_lines add column if not exists status        text not null default 'active';
alter table public.agent_phone_lines add column if not exists twilio_sid    text;
alter table public.agent_phone_lines add column if not exists monthly_price numeric;
alter table public.agent_phone_lines add column if not exists paid_until    timestamptz;
alter table public.agent_phone_lines add column if not exists payment_failed_at timestamptz;
alter table public.agent_phone_lines add column if not exists released_at   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_phone_lines_status_check') then
    alter table public.agent_phone_lines add constraint agent_phone_lines_status_check
      check (status in ('pending', 'active', 'released'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_phone_lines_source_check') then
    alter table public.agent_phone_lines add constraint agent_phone_lines_source_check
      check (source_type is null or source_type in
        ('sign', 'yad2', 'facebook', 'instagram', 'google', 'website', 'newspaper', 'flyer', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_phone_lines_property_fk') then
    alter table public.agent_phone_lines add constraint agent_phone_lines_property_fk
      foreign key (property_id) references public.properties(id) on delete set null;
  end if;
end $$;

-- מספר הפיילוט
update public.agent_phone_lines
   set label = 'המספר הראשי'
 where twilio_number = '+97243761037' and label is null;

-- ---------------------------------------------------------------------------
-- יומן החיובים - מה שהארנק מראה כשהסוכן/ת שואל/ת "על מה ירדו לי 89 ₪"
-- ---------------------------------------------------------------------------
create table if not exists public.phone_line_charges (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null references public.agent_phone_lines(id) on delete cascade,
  agent_id     uuid not null references public.agency_members(id) on delete cascade,
  kind         text not null check (kind in ('purchase', 'renewal', 'refund')),
  amount       numeric not null,
  period_end   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists phone_line_charges_agent_idx on public.phone_line_charges (agent_id, created_at desc);

alter table public.phone_line_charges enable row level security;
drop policy if exists "agent reads own phone line charges" on public.phone_line_charges;
create policy "agent reads own phone line charges" on public.phone_line_charges
  for select to authenticated using (agent_id = public.current_agent_id());

insert into public.pricing_config (key, value, description)
values ('phone_line_monthly_price', 89, 'מספר מעקב (Twilio) - מחיר חודשי בשקלים, מהארנק. docs/call-tracking.md')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- הזמנה: ניכוי מהארנק ושורה pending, בטרנזקציה אחת
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
  v_agent public.agency_members%rowtype;
  v_price numeric;
  v_rows  int;
  v_line  uuid;
  v_until timestamptz := now() + interval '1 month';
begin
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
    (agent_id, twilio_number, active, status, label, source_type, property_id, monthly_price, paid_until)
  values
    (p_agent_id, p_number, false, 'pending', nullif(trim(p_label), ''), p_source, p_property_id, v_price, v_until)
  returning id into v_line;

  insert into public.phone_line_charges (line_id, agent_id, kind, amount, period_end)
  values (v_line, p_agent_id, 'purchase', v_price, v_until);

  return jsonb_build_object('success', true, 'line_id', v_line, 'price_charged', v_price,
                            'balance', v_agent.credit_balance - v_price);
end;
$$;

comment on function public.order_phone_line(uuid, text, text, text, uuid) is
  'הזמנת מספר מעקב: ניכוי החודש הראשון מהארנק ושורה pending. ל-service_role בלבד, דרך twilio-voice?task=lines-order.';

revoke all on function public.order_phone_line(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.order_phone_line(uuid, text, text, text, uuid) to service_role;

-- הקנייה ב-Twilio נכשלה: הכסף חוזר, והשורה נסגרת
create or replace function public.phone_line_order_failed(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.agent_phone_lines%rowtype;
begin
  select * into v_line from public.agent_phone_lines where id = p_line_id and status = 'pending' for update;
  if not found then
    return jsonb_build_object('error', 'not_pending');
  end if;
  if coalesce(v_line.monthly_price, 0) > 0 then
    update public.agency_members set credit_balance = credit_balance + v_line.monthly_price
     where id = v_line.agent_id;
    insert into public.phone_line_charges (line_id, agent_id, kind, amount)
    values (v_line.id, v_line.agent_id, 'refund', -v_line.monthly_price);
  end if;
  -- המספר מתפנה ל-unique: מספר שלא נקנה אינו שלנו
  update public.agent_phone_lines
     set status = 'released', active = false, released_at = now(),
         twilio_number = twilio_number || '#failed-' || left(id::text, 8)
   where id = p_line_id;
  return jsonb_build_object('success', true, 'refunded', coalesce(v_line.monthly_price, 0));
end;
$$;

revoke all on function public.phone_line_order_failed(uuid) from public, anon, authenticated;
grant execute on function public.phone_line_order_failed(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- חידוש חודשי. מספר שהחודש שלו נגמר: ניכוי, ועוד חודש. אין יתרה: מסומן
-- payment_failed_at וממשיך לעבוד 7 ימים (שיחה שהולכת לאיבוד עולה יותר מ-89 ₪).
-- אחרי 7 ימים בלי תשלום - חוזר ברשימה לשחרור, והפונקציה ב-Edge משחררת אותו
-- ב-Twilio. שורה חדשה בכל קריאה רק לעסקה אמיתית: הקריאה חוזרת כל יום.
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
      -- המספר חוזר ל-Twilio ויכול להימכר שוב - גם לסוכן/ת אחר/ת אצלנו. הסיומת
      -- מפנה את ה-unique, והשיחות הישנות נשארות קשורות לשורה הזו דרך line_id.
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

-- ה-cron קורא לפונקציה רק כשיש מה לחדש או לשחרר
create or replace function public.phone_line_renewals_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agent_phone_lines
     where status = 'active' and coalesce(monthly_price, 0) > 0
       and paid_until is not null and paid_until <= now()
  );
$$;

revoke all on function public.phone_line_renewals_pending() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- עריכת כינוי, מקור ונכס - הסוכן/ת, רק במספר שלו/ה. אין policy של update:
-- היא הייתה פותחת גם את twilio_number, monthly_price ו-paid_until.
-- ---------------------------------------------------------------------------
create or replace function public.phone_line_set_details(
  p_line_id uuid, p_label text, p_source text, p_property_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  if p_source is not null and p_source not in
     ('sign', 'yad2', 'facebook', 'instagram', 'google', 'website', 'newspaper', 'flyer', 'other') then
    raise exception 'invalid source_type';
  end if;
  if p_property_id is not null and not exists (
    select 1 from public.properties where id = p_property_id and agent_id = public.current_agent_id()
  ) then
    raise exception 'property not yours';
  end if;
  update public.agent_phone_lines
     set label = nullif(trim(p_label), ''), source_type = p_source, property_id = p_property_id
   where id = p_line_id and agent_id = public.current_agent_id() and status <> 'released'
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function public.phone_line_set_details(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.phone_line_set_details(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- cron יומי לחידוש. 07:23 שעון ישראל בערך (04:23 UTC), שעה שקטה.
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
    where public.phone_line_renewals_pending()
  $cron$, v_url));
end $$;

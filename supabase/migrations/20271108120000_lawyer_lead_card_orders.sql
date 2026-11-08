-- ============================================================================
-- חיוב ישיר בכרטיס על ליד "שאלה לעו"ד" (בלי ארנק)
--
-- עד כאן הליד נרכש רק מיתרת ארנק שמנהל/ת הפלטפורמה טוען/ת ידנית (purchase_lawyer_lead).
-- ההחלטה (8.11.2026): עו"ד קונה מזדמן, ולכן חיוב חד-פעמי בכרטיס על כל ליד, באותה
-- מכונת מצבים של כרטיסיית בעל מקצוע (ad_orders): הזמנה pending, טופס תשלום של מורנינג,
-- אימות חוזר מול ה-API שלהם ב-wallet-topup-callback, ורק אז הפעולה.
-- הארנק נשאר: שני המסלולים חיים יחד, וכל אחד מוכר את הליד דרך אותה שורה ב-lawyer_lead_purchases.
--
-- ההבדל מכרטיסייה: **הסחורה יחידה.** שני עורכי דין לא משלמים על אותו ליד, ולכן פתיחת הזמנה
-- שומרת את הליד ל-15 דקות (reserved_by_professional_id / reserved_until). המדף ממשיך להציג
-- ליד שמור לאחרים, מסומן "בטיפול", ורכישה מהארנק וכרטיס של אחר/ת נדחות כל עוד השמירה בתוקף.
--
-- ומה כשהתשלום מגיע אחרי שהשמירה פגה והליד כבר נמכר לאחר/ת (חלון התשלום של מורנינג ארוך
-- מ-15 דקות): הכסף כבר נגבה, ולכן complete_lawyer_lead_order **אינה** מחזירה "הצלחה"
-- ואינה מוכרת פעמיים. ההזמנה עוברת ל-refund_needed, ואיש צוות מקבל התראה להחזיר ידנית.
-- ----------------------------------------------------------------------------
-- הסכום: ההזמנה נושאת את המחיר הנקוב (amount_before_vat), את המע"מ ואת הסכום שנגבה (amount, כולל מע"מ),
-- כמו ad_orders. בשורת הרכישה (lawyer_lead_purchases.amount) נרשם המחיר הנקוב, כמו ברכישה מהארנק.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. שמירת הליד
-- ---------------------------------------------------------------------------
alter table public.lawyer_leads
  add column if not exists reserved_by_professional_id uuid references public.professional_accounts(id) on delete set null,
  add column if not exists reserved_until timestamptz;

comment on column public.lawyer_leads.reserved_until is
  'עד מתי הליד שמור לעו"ד שפתח/ה הזמנת תשלום בכרטיס (reserved_by_professional_id). בתוקף: אחרים אינם יכולים לרכוש אותו.';

-- ---------------------------------------------------------------------------
-- 2. ההזמנות
-- ---------------------------------------------------------------------------
create table if not exists public.lawyer_lead_orders (
  id                   uuid primary key default gen_random_uuid(),
  -- ‏set null: רשומת החיוב שורדת מחיקת ליד (data_retention) וחשבון, כמו lawyer_lead_purchases
  lead_id              uuid references public.lawyer_leads(id) on delete set null,
  professional_id      uuid references public.professional_accounts(id) on delete set null,
  amount_before_vat    numeric(10,2) not null check (amount_before_vat > 0),
  vat_rate             numeric not null,
  -- הסכום שנגבה בפועל, כולל מע"מ. נשמר ולא מחושב מחדש.
  amount               numeric(10,2) not null check (amount > 0),
  status               text not null default 'pending'
                         check (status in ('pending','success','failed','refund_needed','refunded')),
  test_mode            boolean not null default false,
  provider             text default 'morning',
  provider_form_id     text,
  provider_payment_url text,
  provider_charge_id   text,
  provider_document_id text,
  provider_pdf_url     text,
  reserved_until       timestamptz not null,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  failure_reason       text
);

comment on table public.lawyer_lead_orders is
  'רכישת ליד עו"ד בחיוב ישיר בכרטיס (בלי ארנק). אותה מכונת מצבים כמו ad_orders; refund_needed = שולם והליד כבר אינו זמין, להחזר ידני.';

-- ‏webhook עלול להגיע פעמיים
create unique index if not exists lawyer_lead_orders_provider_charge_uniq
  on public.lawyer_lead_orders (provider, provider_charge_id)
  where provider_charge_id is not null;

create index if not exists lawyer_lead_orders_pending_idx
  on public.lawyer_lead_orders (status, created_at) where status = 'pending';

create index if not exists lawyer_lead_orders_professional_idx
  on public.lawyer_lead_orders (professional_id, created_at desc);

create index if not exists lawyer_lead_orders_lead_idx
  on public.lawyer_lead_orders (lead_id) where lead_id is not null;

alter table public.lawyer_lead_orders enable row level security;

revoke all on table public.lawyer_lead_orders from public, anon, authenticated;
grant select on table public.lawyer_lead_orders to authenticated;
grant select, insert, update, delete on table public.lawyer_lead_orders to service_role;

drop policy if exists "professional reads own lead orders" on public.lawyer_lead_orders;
create policy "professional reads own lead orders"
  on public.lawyer_lead_orders for select to authenticated
  using (professional_id in (select id from public.professional_accounts where user_id = (select auth.uid())));

drop policy if exists "platform admin reads lawyer lead orders" on public.lawyer_lead_orders;
create policy "platform admin reads lawyer lead orders"
  on public.lawyer_lead_orders for select to authenticated
  using (public.current_is_platform_admin());

-- ‏order_id ברכישה: איך שולם (ארנק או כרטיס) וקישור לחשבונית
alter table public.lawyer_lead_purchases
  add column if not exists order_id uuid references public.lawyer_lead_orders(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. המדף: ליד שמור לאחר/ת מסומן. עמודה חדשה בסוף ה-view בלבד.
-- ---------------------------------------------------------------------------
create or replace view public.lawyer_leads_public as
select
  l.id,
  public.redact_contact_text(l.question, l.full_name) as question_text,
  l.property_id,
  l.city_id,
  (l.email is not null and btrim(l.email) <> '') as has_email,
  l.status,
  l.created_at,
  (l.reserved_until is not null and l.reserved_until > now()
   and l.reserved_by_professional_id is distinct from
       (select pa.id from public.professional_accounts pa where pa.user_id = auth.uid())) as reserved_by_other
from public.lawyer_leads l
where l.status = 'new'
  and (select public.current_is_lawyer())
  and (public.current_is_platform_admin()
       or l.city_id is null
       or public.current_professional_works_city(l.city_id));

-- ---------------------------------------------------------------------------
-- 4. פאזה 1: פתיחת הזמנה ושמירת הליד
-- ---------------------------------------------------------------------------
create or replace function public.start_lawyer_lead_order(p_lead_id uuid, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead   public.lawyer_leads%rowtype;
  v_acct   public.professional_accounts%rowtype;
  v_price  numeric;
  v_vat    numeric;
  v_before numeric;
  v_amount numeric;
  v_open   int;
  v_exist  public.lawyer_lead_orders%rowtype;
  v_id     uuid;
  v_until  timestamptz := now() + interval '15 minutes';
begin
  select * into v_lead from public.lawyer_leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;
  if v_lead.status = 'sold' then
    if v_lead.sold_to_professional_id = p_account_id then
      return jsonb_build_object('error', 'already_purchased');
    end if;
    return jsonb_build_object('error', 'lead_already_sold');
  end if;
  if v_lead.status <> 'new' then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  select * into v_acct from public.professional_accounts where id = p_account_id and active = true;
  if not found then
    return jsonb_build_object('error', 'account_not_found');
  end if;
  if v_acct.kind <> 'real_estate_lawyer' then
    return jsonb_build_object('error', 'not_a_lawyer');
  end if;
  if v_acct.shelf_enabled is not true then
    return jsonb_build_object('error', 'shelf_not_approved');
  end if;

  -- אותו כלל עיר של המדף והרכישה מהארנק
  if v_lead.city_id is not null and not exists (
    select 1
      from public.cities lc
      left join public.cities ac on ac.id = v_acct.city_id
     where lc.id = v_lead.city_id
       and (v_acct.city_id = v_lead.city_id
            or (ac.market_slug is not null and ac.market_slug = lc.market_slug))
  ) then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  -- שמור לאחר/ת: לא פותחים הזמנה שנייה על אותו ליד
  if v_lead.reserved_until is not null and v_lead.reserved_until > now()
     and v_lead.reserved_by_professional_id is distinct from p_account_id then
    return jsonb_build_object('error', 'lead_reserved', 'reserved_until', v_lead.reserved_until);
  end if;

  -- לחיצה כפולה או חזרה מדף התשלום: אותה הזמנה פתוחה, לא שורה חדשה
  select * into v_exist from public.lawyer_lead_orders
   where lead_id = p_lead_id and professional_id = p_account_id
     and status = 'pending' and reserved_until > now()
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('success', true, 'reused', true, 'order_id', v_exist.id,
                              'amount', v_exist.amount, 'payment_url', v_exist.provider_payment_url);
  end if;

  -- חסם על שמירות פתוחות: מי שפותח/ת הזמנות ולא משלם/ת לא תופס/ת את המדף כולו
  select count(*) into v_open from public.lawyer_lead_orders
   where professional_id = p_account_id and status = 'pending' and reserved_until > now();
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_orders');
  end if;

  select value into v_price from public.pricing_config where key = 'lawyer_lead_price';
  v_price := coalesce(v_price, 50);
  if v_price <= 0 then
    -- ליד בחינם אינו עובר סליקה: purchase_lawyer_lead מטפלת בו
    return jsonb_build_object('error', 'free_lead');
  end if;
  select value into v_vat from public.pricing_config where key = 'vat_rate';
  v_vat := coalesce(v_vat, 0);
  v_before := round(v_price, 2);
  v_amount := round(v_before * (1 + v_vat), 2);

  insert into public.lawyer_lead_orders
    (lead_id, professional_id, amount_before_vat, vat_rate, amount, status, provider, reserved_until)
  values
    (p_lead_id, p_account_id, v_before, v_vat, v_amount, 'pending', 'morning', v_until)
  returning id into v_id;

  update public.lawyer_leads
     set reserved_by_professional_id = p_account_id, reserved_until = v_until
   where id = p_lead_id;

  return jsonb_build_object('success', true, 'order_id', v_id, 'amount', v_amount,
                            'amount_before_vat', v_before, 'reserved_until', v_until);
end;
$$;

comment on function public.start_lawyer_lead_order(uuid, uuid) is
  'פותחת הזמנת תשלום בכרטיס על ליד עו"ד ושומרת אותו ל-15 דקות. service_role בלבד, דרך lawyer-lead-checkout.';

-- ---------------------------------------------------------------------------
-- 5. פאזה 2: הליד נמכר, אחרי אימות מול מורנינג
-- ---------------------------------------------------------------------------
create or replace function public.complete_lawyer_lead_order(
  p_order_id           uuid,
  p_verified_amount    numeric,
  p_provider_charge_id text default null,
  p_document_id        text default null,
  p_pdf_url            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.lawyer_lead_orders%rowtype;
  v_lead  public.lawyer_leads%rowtype;
  v_reason text;
begin
  select * into v_order from public.lawyer_lead_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('error', 'order_not_found');
  end if;
  if v_order.status = 'success' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('error', 'order_not_pending', 'status', v_order.status);
  end if;

  if p_verified_amount is not null and p_verified_amount <> v_order.amount then
    update public.lawyer_lead_orders
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_order.amount, p_verified_amount)
     where id = p_order_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_order.amount, 'reported', p_verified_amount);
  end if;

  -- התשלום אומת: מכאן הפרטים של מורנינג נשמרים בכל מקרה, גם אם הליד כבר אינו זמין
  update public.lawyer_lead_orders
     set provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
         provider_document_id = coalesce(p_document_id, provider_document_id),
         provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url)
   where id = p_order_id;

  select * into v_lead from public.lawyer_leads where id = v_order.lead_id for update;

  v_reason := case
    when v_order.lead_id is null or not found then 'lead_deleted'
    when v_order.professional_id is null then 'account_deleted'
    when v_lead.status = 'sold' and v_lead.sold_to_professional_id = v_order.professional_id then 'already_owned'
    when v_lead.status = 'sold' then 'lead_sold_to_other'
    when v_lead.status <> 'new' then 'lead_not_available'
    -- שמור כעת לאחר/ת: השמירה שלנו פגה והאחר/ת הקדים/ה
    when v_lead.reserved_until is not null and v_lead.reserved_until > now()
         and v_lead.reserved_by_professional_id is distinct from v_order.professional_id
      then 'lead_reserved_by_other'
    else null
  end;

  if v_reason is not null then
    update public.lawyer_lead_orders
       set status = 'refund_needed', completed_at = now(), failure_reason = v_reason
     where id = p_order_id;
    return jsonb_build_object('error', 'refund_needed', 'reason', v_reason,
                              'amount', v_order.amount);
  end if;

  update public.lawyer_leads
     set status = 'sold', sold_at = now(), sold_to_professional_id = v_order.professional_id,
         reserved_by_professional_id = null, reserved_until = null
   where id = v_order.lead_id and status = 'new';

  insert into public.lawyer_lead_purchases (lead_id, professional_id, amount, status, payment_method, order_id)
  values (v_order.lead_id, v_order.professional_id, v_order.amount_before_vat, 'success', 'card', p_order_id);

  update public.lawyer_lead_orders
     set status = 'success', completed_at = now()
   where id = p_order_id;

  return jsonb_build_object('success', true, 'lead_id', v_order.lead_id,
                            'professional_id', v_order.professional_id);
end;
$$;

comment on function public.complete_lawyer_lead_order(uuid, numeric, text, text, text) is
  'הפונקציה היחידה שמוכרת ליד עו"ד בתשלום בכרטיס. שולם והליד כבר אינו זמין: refund_needed ולא מכירה כפולה. service_role בלבד, מ-wallet-topup-callback.';

-- ---------------------------------------------------------------------------
-- 6. כישלון: משחרר את השמירה
-- ---------------------------------------------------------------------------
create or replace function public.fail_lawyer_lead_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.lawyer_lead_orders%rowtype;
begin
  update public.lawyer_lead_orders
     set status = 'failed', failure_reason = left(coalesce(p_reason, ''), 300)
   where id = p_order_id and status = 'pending'
  returning * into v_order;
  if not found then
    return jsonb_build_object('success', false);
  end if;

  -- משחררים רק שמירה ששייכת למי שנכשל. שמירה של אחר/ת נשארת.
  update public.lawyer_leads
     set reserved_by_professional_id = null, reserved_until = null
   where id = v_order.lead_id
     and reserved_by_professional_id is not distinct from v_order.professional_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. הרכישה מהארנק מכבדת שמירה
-- ---------------------------------------------------------------------------
create or replace function public.purchase_lawyer_lead(p_lead_id uuid, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead  public.lawyer_leads%rowtype;
  v_acct  public.professional_accounts%rowtype;
  v_price numeric;
  v_rows  int;
  v_balance numeric;
begin
  select * into v_lead from public.lawyer_leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;

  -- רכישה חוזרת של אותו ליד על ידי הקונה עצמו מחזירה את הסחורה בלי חיוב נוסף
  if v_lead.status = 'sold' then
    if v_lead.sold_to_professional_id = p_account_id then
      return jsonb_build_object(
        'success', true, 'already_purchased', true, 'price_charged', 0,
        'full_name', v_lead.full_name, 'phone', v_lead.phone, 'email', v_lead.email,
        'question', v_lead.question
      );
    end if;
    return jsonb_build_object('error', 'lead_already_sold');
  end if;

  if v_lead.status <> 'new' then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  select * into v_acct from public.professional_accounts where id = p_account_id and active = true;
  if not found then
    return jsonb_build_object('error', 'account_not_found');
  end if;
  if v_acct.kind <> 'real_estate_lawyer' then
    return jsonb_build_object('error', 'not_a_lawyer');
  end if;
  if v_acct.shelf_enabled is not true then
    return jsonb_build_object('error', 'shelf_not_approved');
  end if;

  -- אותו כלל של המדף, גם ברכישה: מי שאינו/ה עובד/ת בעיר הליד לא קונה אותו גם אם הגיע/ה למזהה.
  -- ליד בלי עיר פתוח לכל עו"ד מאושר.
  if v_lead.city_id is not null and not exists (
    select 1
      from public.cities lc
      left join public.cities ac on ac.id = v_acct.city_id
     where lc.id = v_lead.city_id
       and (v_acct.city_id = v_lead.city_id
            or (ac.market_slug is not null and ac.market_slug = lc.market_slug))
  ) then
    return jsonb_build_object('error', 'lead_not_available');
  end if;

  -- שמור לאחר/ת (הזמנת תשלום בכרטיס בתוקף): אחרת התשלום שלו/ה יגיע ללא ליד
  if v_lead.reserved_until is not null and v_lead.reserved_until > now()
     and v_lead.reserved_by_professional_id is distinct from p_account_id then
    return jsonb_build_object('error', 'lead_reserved', 'reserved_until', v_lead.reserved_until);
  end if;

  select value into v_price from public.pricing_config where key = 'lawyer_lead_price';
  v_price := coalesce(v_price, 50);

  v_balance := v_acct.credit_balance;
  if v_price > 0 then
    -- ‏returning: היתרה האמיתית אחרי הניכוי. הארנק לפני מע"מ: מורידים את המחיר הנקוב (wallet-charges)
    update public.professional_accounts
       set credit_balance = credit_balance - v_price
     where id = p_account_id and credit_balance >= v_price
    returning credit_balance into v_balance;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object(
        'error', 'insufficient_balance', 'required', v_price, 'balance', v_acct.credit_balance
      );
    end if;
  end if;

  -- הזמנת כרטיס פתוחה של אותו/ה עו"ד על אותו ליד **אינה נסגרת כאן**: ייתכן שהתשלום כבר בדרך
  -- אצל מורנינג, ושורה "failed" הייתה מאבדת אותו. אם יגיע, complete_lawyer_lead_order תסמן
  -- refund_needed (already_owned); אם לא, ה-reconcile יסגור אותה אחרי חלון התשלום.

  update public.lawyer_leads
     set status = 'sold', sold_at = now(), sold_to_professional_id = p_account_id,
         reserved_by_professional_id = null, reserved_until = null
   where id = p_lead_id and status = 'new';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- לא אמור לקרות: השורה נעולה מתחילת הפונקציה. raise מגלגל אחורה גם את ניכוי הארנק
    raise exception 'lawyer_lead_purchase_race' using errcode = '40001';
  end if;

  insert into public.lawyer_lead_purchases (lead_id, professional_id, amount, status, payment_method)
  values (p_lead_id, p_account_id, v_price, 'success', 'balance');

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'balance', v_balance,
    'full_name', v_lead.full_name,
    'phone', v_lead.phone,
    'email', v_lead.email,
    'question', v_lead.question
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. הרשאות: כולן service_role בלבד
-- ---------------------------------------------------------------------------
revoke all on function public.start_lawyer_lead_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_lawyer_lead_order(uuid, uuid) to service_role;

revoke all on function public.complete_lawyer_lead_order(uuid, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_lawyer_lead_order(uuid, numeric, text, text, text) to service_role;

revoke all on function public.fail_lawyer_lead_order(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_lawyer_lead_order(uuid, text) to service_role;

revoke all on function public.purchase_lawyer_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purchase_lawyer_lead(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. ה-reconcile רואה גם את הטבלה השישית
--
-- זהה ל-20271106110000 פרט לשורה הנוספת בתנאי. בלעדיה הזמנת ליד ששולמה וה-webhook שלה אבד
-- הייתה מחכה לטעינת ארנק של מישהו אחר (docs/wallet-payments.md, "ה-reconcile ראה רק שתי טבלאות").
-- ---------------------------------------------------------------------------
do $$
declare
  v_base text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן מחדש';
    return;
  end if;

  perform cron.unschedule('wallet-topup-reconcile')
    where exists (select 1 from cron.job where jobname = 'wallet-topup-reconcile');

  perform cron.schedule('wallet-topup-reconcile', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (select 1 from public.wallet_topups       where status = 'pending')
       or exists (select 1 from public.subscription_orders where status = 'pending')
       or exists (select 1 from public.ad_orders           where status = 'pending')
       or exists (select 1 from public.developer_topups    where status = 'pending')
       or exists (select 1 from public.course_orders       where status = 'pending')
       or exists (select 1 from public.lawyer_lead_orders  where status = 'pending');
  $cron$, v_base || 'wallet-topup-callback?mode=reconcile'));
end;
$$;

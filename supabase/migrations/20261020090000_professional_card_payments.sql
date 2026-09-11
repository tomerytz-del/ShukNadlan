-- ============================================================================
-- סליקה אמיתית לכרטיסיות בעלי מקצוע
--
-- ‏professional-signup הכניס/ה עד היום שורה ל-ad_placements עם
-- ‏`status='active'`, ‏`monthly_price=350` ו-`test_mode=true`, והכרטיסייה עלתה
-- לאוויר **בלי שאיש שילם**. התקנון (‏terms.html §15) אומר שזהו מוצר בתשלום,
-- ו-`pricing_config.professional_card_monthly_price` כבר מחזיק/ה 350 — רק
-- הגבייה עצמה מעולם לא נכתבה.
--
-- המיגרציה הזו מוסיפה אותה, על **אותה מכונת מצבים** של טעינת הארנק ורכישת
-- המנוי: שורת הזמנה ‏`pending`, טופס תשלום אצל מורנינג, אימות חוזר מול ה-API
-- שלהם, ורק אז הפעלה. ראו `docs/wallet-payments.md`.
--
-- שלוש החלטות שמסבירות את המבנה:
--
-- 1. **הכרטיסייה נוצרת מיד, אבל לא פעילה.** היא נכנסת כ-`pending_payment`,
--    מצב שה-policy הציבורית (‏`status='active'`) אינה מחזירה — כלומר היא
--    קיימת, שומרת את מה שהוקלד בטופס, ואינה מוצגת לאיש. ‏`complete_ad_order`
--    היא היחידה שמעבירה אותה ל-`active`. החלופה — ליצור את השורה רק אחרי
--    התשלום — הייתה מחייבת להחזיק את כל תוכן הטופס בצד הלקוח דרך הפניה
--    לעמוד סליקה חיצוני ובחזרה ממנו, וזה בדיוק המקום שבו נתונים הולכים
--    לאיבוד.
--
-- 2. **התאריכים נקבעים בהפעלה, לא בהרשמה.** ‏30 יום שמתחילים ברגע שמילאו
--    טופס ולא ברגע ששילמו הם 30 יום שחלקם נגמר לפני שהכרטיסייה עלתה.
--
-- 3. **אין חידוש אוטומטי ואין כרטיס שמור** — כאמור ב-§15 ובאותו נימוק שכתוב
--    בראש `20261015090000_subscription_payments.sql`: הוראת קבע שבורה מחייבת
--    אנשים אמיתיים בטעות. הארכה היא רכישה נוספת, והתקופה מצטברת.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מצב חדש לכרטיסייה: נרשמה, טרם שולמה
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.ad_placements'::regclass
       and conname = 'ad_placements_status_check'
  ) then
    alter table public.ad_placements drop constraint ad_placements_status_check;
  end if;
end;
$$;

alter table public.ad_placements
  add constraint ad_placements_status_check
  check (status = any (array['pending_payment', 'active', 'paused', 'ended']));

alter table public.ad_placements
  add column if not exists paid_at timestamptz;

comment on column public.ad_placements.paid_at is
  'מתי שולם בפועל על הכרטיסייה. ריק בכרטיסייה שהוקמה ידנית או במצב בדיקה.';

create index if not exists ad_placements_pending_payment_idx
  on public.ad_placements (created_at)
  where status = 'pending_payment';

-- ---------------------------------------------------------------------------
-- 2. הזמנות הפרסום
--
-- אותה צורה בדיוק של subscription_orders, ומאותה סיבה: ‏wallet-topup-callback
-- מטפל/ת בשלושתן באותו קוד, והשוני היחיד הוא שם הטבלה ושמות הפונקציות.
-- ---------------------------------------------------------------------------
create table if not exists public.ad_orders (
  id                   uuid primary key default gen_random_uuid(),
  placement_id         uuid not null references public.ad_placements(id) on delete cascade,
  months               int  not null check (months between 1 and 12),
  -- הסכום שנגבה בפועל, כולל מע״מ. נשמר ולא מחושב מחדש — שינוי מחיר אחרי
  -- הרכישה לא אמור לשנות למפרע מה שולם.
  amount               numeric not null check (amount > 0),
  amount_before_vat    numeric not null check (amount_before_vat > 0),
  vat_rate             numeric not null,
  status               text not null default 'pending'
                         check (status in ('pending', 'success', 'failed')),
  test_mode            boolean not null default false,
  provider             text default 'morning',
  provider_form_id     text,
  provider_payment_url text,
  provider_charge_id   text,
  -- החשבונית נשמרת כאן ולא בטבלת invoices: שם agent_id הוא not null, ולבעל/ת
  -- מקצוע אין שורה ב-agency_members — זו כל הנקודה במוצר הזה.
  provider_document_id text,
  provider_pdf_url     text,
  period_start         timestamptz,
  period_end           timestamptz,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  failure_reason       text
);

comment on table public.ad_orders is
  'רכישת תקופת פרסום לכרטיסיית בעל/ת מקצוע. אותה מכונת מצבים כמו wallet_topups.';

-- ‏webhook עלול להגיע פעמיים, בדיוק כמו בשתי הטבלאות האחרות
create unique index if not exists ad_orders_provider_charge_uniq
  on public.ad_orders (provider, provider_charge_id)
  where provider_charge_id is not null;

create index if not exists ad_orders_pending_idx
  on public.ad_orders (status, created_at) where status = 'pending';

create index if not exists ad_orders_placement_idx
  on public.ad_orders (placement_id, created_at desc);

-- אין לבעל/ת המקצוע חשבון באתר, ולכן אין למי לתת כאן קריאה: הטבלה נסגרת
-- לחלוטין, ומנהל/ת הפלטפורמה רואה אותה דרך admin_list_professional_cards.
alter table public.ad_orders enable row level security;

drop policy if exists "platform admin reads ad orders" on public.ad_orders;
create policy "platform admin reads ad orders" on public.ad_orders
  for select using (public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. התמחור — במסד, לא בדפדפן
--
-- הדפדפן שולח מספר חודשים בלבד. הסכום נקבע כאן, ונבדק שוב מול הסולק
-- ב-complete_ad_order לפני שהכרטיסייה עולה.
-- ---------------------------------------------------------------------------
create or replace function public.professional_card_price(p_months int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_monthly numeric;
  v_vat     numeric;
  v_before  numeric;
begin
  if p_months is null or p_months < 1 or p_months > 12 then
    return jsonb_build_object('error', 'invalid_months', 'max', 12);
  end if;

  select value into v_monthly from public.pricing_config
   where key = 'professional_card_monthly_price';
  if v_monthly is null then
    return jsonb_build_object('error', 'price_not_configured');
  end if;

  select value into v_vat from public.pricing_config where key = 'vat_rate';
  v_vat := coalesce(v_vat, 0);

  v_before := round(v_monthly * p_months, 2);
  return jsonb_build_object(
    'months', p_months,
    'monthly_price', v_monthly,
    'amount_before_vat', v_before,
    'vat_rate', v_vat,
    'amount', round(v_before * (1 + v_vat), 2)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. פאזה 1 — פתיחת ההזמנה
-- ---------------------------------------------------------------------------
create or replace function public.start_ad_order(p_placement_id uuid, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price jsonb;
  v_id    uuid;
  v_open  int;
begin
  if not exists (select 1 from public.ad_placements where id = p_placement_id) then
    return jsonb_build_object('error', 'placement_not_found');
  end if;

  v_price := public.professional_card_price(p_months);
  if v_price ? 'error' then return v_price; end if;

  -- אותו חסם של subscription_orders: מי שלוחץ/ת שוב ושוב לא פותח/ת תור
  -- אינסופי של שורות pending שה-reconcile יצטרך לסרוק.
  select count(*) into v_open from public.ad_orders
   where placement_id = p_placement_id and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_orders');
  end if;

  insert into public.ad_orders
    (placement_id, months, amount, amount_before_vat, vat_rate, status, provider)
  values
    (p_placement_id, p_months,
     (v_price->>'amount')::numeric,
     (v_price->>'amount_before_vat')::numeric,
     (v_price->>'vat_rate')::numeric,
     'pending', 'morning')
  returning id into v_id;

  return jsonb_build_object('success', true, 'order_id', v_id,
                            'amount', (v_price->>'amount')::numeric,
                            'months', p_months);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. פאזה 2 — הפעלת הכרטיסייה
--
-- **הפונקציה היחידה שמעלה כרטיסייה לאוויר בתשלום.** אותן שלוש הגנות:
-- נעילת שורה, בדיקת סטטוס, והשוואת סכום מול מה **שאנחנו** רשמנו.
--
-- התקופה מצטברת: הארכה לפני שהתקופה הקיימת נגמרה מתחילה מסופה, ולא מהיום.
-- ---------------------------------------------------------------------------
create or replace function public.complete_ad_order(
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
  v_order public.ad_orders;
  v_from  timestamptz;
  v_to    timestamptz;
begin
  select * into v_order from public.ad_orders where id = p_order_id for update;
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
    update public.ad_orders
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_order.amount, p_verified_amount)
     where id = p_order_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_order.amount, 'reported', p_verified_amount);
  end if;

  select case
           when ends_at is not null and ends_at > current_date and status = 'active'
             then ends_at::timestamptz
           else now()
         end
    into v_from
    from public.ad_placements where id = v_order.placement_id;

  v_to := v_from + (v_order.months || ' months')::interval;

  update public.ad_placements
     set status     = 'active',
         test_mode  = false,
         paid_at    = now(),
         starts_at  = least(coalesce(starts_at, current_date), v_from::date),
         ends_at    = v_to::date
   where id = v_order.placement_id;

  update public.ad_orders
     set status               = 'success',
         completed_at         = now(),
         provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
         provider_document_id = coalesce(p_document_id, provider_document_id),
         provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url),
         period_start         = v_from,
         period_end           = v_to
   where id = p_order_id;

  return jsonb_build_object('success', true, 'placement_id', v_order.placement_id,
                            'period_start', v_from, 'period_end', v_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. כישלון
-- ---------------------------------------------------------------------------
create or replace function public.fail_ad_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ad_orders
     set status = 'failed', failure_reason = left(coalesce(p_reason, ''), 300)
   where id = p_order_id and status = 'pending';
  return jsonb_build_object('success', found);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. ניקוי כרטיסיות שנרשמו ולא שולמו
--
-- ‏`pending_payment` אינה מוצגת לאיש, אבל היא כן תופסת slug ומופיעה בדף
-- הניהול. אחרי יממה זו כבר לא הרשמה באמצע — היא ננטשה.
-- ---------------------------------------------------------------------------
create or replace function public.expire_unpaid_ad_placements()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with stale as (
    update public.ad_placements
       set status = 'ended'
     where status = 'pending_payment'
       and created_at < now() - interval '24 hours'
    returning id
  )
  select count(*) into v_count from stale;
  return v_count;
end;
$$;

revoke all on function public.professional_card_price(int) from public, anon, authenticated;
grant execute on function public.professional_card_price(int) to service_role;

revoke all on function public.start_ad_order(uuid, int) from public, anon, authenticated;
grant execute on function public.start_ad_order(uuid, int) to service_role;

revoke all on function public.complete_ad_order(uuid, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_ad_order(uuid, numeric, text, text, text) to service_role;

revoke all on function public.fail_ad_order(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_ad_order(uuid, text) to service_role;

revoke all on function public.expire_unpaid_ad_placements() from public, anon, authenticated;
grant execute on function public.expire_unpaid_ad_placements() to service_role;

-- ---------------------------------------------------------------------------
-- 8. התזמון
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'expire-unpaid-ad-placements') then
      perform cron.unschedule('expire-unpaid-ad-placements');
    end if;
    perform cron.schedule(
      'expire-unpaid-ad-placements',
      '50 3 * * *',
      $cron$select public.expire_unpaid_ad_placements();$cron$
    );
  end if;
end;
$$;

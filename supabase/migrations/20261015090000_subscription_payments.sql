-- ============================================================================
-- תשלום על מנוי — מסלול בתשלום מראש לתקופה
--
-- **הפער שזה סוגר:** ‏pricing.html מפרסם PROFESSIONAL ב-₪750 ו-Elite ב-₪950
-- לחודש, ואין בקוד שום דרך לשלם עליהם. ‏set_tier רושם/ת ‎pending_tier_change‎
-- ושולח/ת מייל, ומנהל/ת פלטפורמה מאשר/ת ידנית (‏20261014090000). כלומר מחיר
-- מפורסם בלי גבייה: לא רק פער מוצרי, אלא גם מה שחברת הסליקה רואה כשהיא בודקת
-- את האתר לפני אישור סוחר.
--
-- **למה תשלום מראש ולא הוראת קבע.** הוראת קבע דורשת שמירת טוקן אצל הסולק,
-- מחזור חיוב, טיפול בכרטיס שנדחה, ניסיונות חוזרים והשעיה — וכל באג שם מחייב
-- אנשים אמיתיים בטעות, בלי שאיש לחץ על כלום. כאן הסוכן/ת משלם/ת על תקופה
-- מראש, בדיוק באותו עמוד תשלום ובאותו מסלול דו-פאזי של טעינת הארנק, והמסלול
-- נפתח עד תאריך. אין כרטיס שמור ואין חיוב אוטומטי. ההרחבה לחיוב חוזר אפשרית
-- בהמשך על אותה סכימה — ‎subscription_orders‎ כבר נושא/ת תקופה.
--
-- המבנה זהה ל-‎wallet_topups‎ בכוונה, כולל שמות העמודות: אותה מכונת מצבים,
-- אותו webhook, אותו reconcile. מי שמכיר/ה את האחד מכיר/ה את השני.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מחירים ומע״מ ב-pricing_config
--
-- המחירים חיו עד היום ב-assets/tiers.js בלבד — שכבת תצוגה. מחיר שנגבה חייב
-- לחיות במסד, אחרת הדפדפן הוא מקור האמת לסכום החיוב.
--
-- ‏vat_rate כאן ולא בקוד: שיעור המע״מ משתנה בחקיקה, ושינוי שלו לא אמור לדרוש
-- מיגרציה. ‏0.18 הוא השיעור נכון להיום.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value) values
  ('tier_mid_monthly_price',     750),
  ('tier_premium_monthly_price', 950),
  ('vat_rate',                   0.18),
  ('subscription_max_months',    12)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. עד מתי המסלול שולם
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists paid_tier       text,
  add column if not exists paid_tier_until timestamptz;

comment on column public.agency_members.paid_tier is
  'המסלול ששולם עליו בפועל. ריק = אין מנוי בתשלום (חינמי או הטבה).';
comment on column public.agency_members.paid_tier_until is
  'סוף התקופה ששולמה. expire_paid_subscriptions מוריד/ה ל-free אחריה.';

-- ---------------------------------------------------------------------------
-- 3. הזמנות המנוי
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_orders (
  id                   uuid primary key default gen_random_uuid(),
  agent_id             uuid not null references public.agency_members(id),
  tier                 text not null check (tier in ('mid', 'premium')),
  months               int  not null check (months between 1 and 12),
  -- הסכום שנגבה בפועל, כולל מע״מ. נשמר ולא מחושב מחדש: שינוי מחיר או שיעור
  -- מע״מ אחרי הרכישה לא אמור לשנות למפרע מה שולם.
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
  period_start         timestamptz,
  period_end           timestamptz,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  failure_reason       text
);

comment on table public.subscription_orders is
  'רכישת מנוי לתקופה מראש. אותה מכונת מצבים כמו wallet_topups.';

-- webhook עלול להגיע פעמיים, בדיוק כמו בטעינת ארנק
create unique index if not exists subscription_orders_provider_charge_uniq
  on public.subscription_orders (provider, provider_charge_id)
  where provider_charge_id is not null;

create index if not exists subscription_orders_pending_idx
  on public.subscription_orders (status, created_at) where status = 'pending';

create index if not exists subscription_orders_agent_idx
  on public.subscription_orders (agent_id, created_at desc);

alter table public.subscription_orders enable row level security;

drop policy if exists "agent read own subscription orders" on public.subscription_orders;
create policy "agent read own subscription orders" on public.subscription_orders
  for select using (
    agent_id = public.current_agent_id() or public.current_is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- 4. הגנה על העמודות החדשות
--
-- **זה לא ניקיון — זו החומה.** הטריגר מונה את השדות הרגישים אחד-אחד, ולכן
-- עמודה חדשה שלא נוספה לו **כתיבה מהדפדפן**: כל סוכן/ת היה/הייתה יכול/ה
-- לכתוב לעצמו/ה ‎paid_tier_until‎ בעוד עשר שנים ולקבל Elite חינם.
--
-- הגוף הועתק מההגדרה החיה כדי לא להשמיט שדה קיים, ונוספו לו שתי השורות
-- החדשות בלבד.
-- ---------------------------------------------------------------------------
create or replace function public.protect_sensitive_agency_member_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  -- ‏coalesce מבטיח true/false ולעולם לא NULL
  is_self boolean := coalesce(
    old.user_id is not null and old.user_id = (select auth.uid()),
    false
  );
  -- הקשר מנהלתי: מיגרציה, SQL Editor או Edge Function. נקבע לפי תפקיד ה-DB
  -- בפועל, שדפדפן לא יכול להתחזות אליו
  is_privileged boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
                           or auth.role() = 'service_role';
begin
  if is_privileged then
    return new;
  end if;
  new.credit_balance := old.credit_balance;
  new.tier := old.tier;
  new.free_quota_used := old.free_quota_used;
  new.free_quota_cycle_start := old.free_quota_cycle_start;
  new.payment_token_id := old.payment_token_id;
  new.billing_status := old.billing_status;
  new.pending_tier_change := old.pending_tier_change;
  new.pending_tier_change_at := old.pending_tier_change_at;
  new.subscription_id := old.subscription_id;
  new.is_platform_admin := old.is_platform_admin; -- נעול לחלוטין, גם למנהל משרד רגיל
  new.is_mortgage_advisor := old.is_mortgage_advisor; -- נעול לחלוטין — מנהל/ת הפלטפורמה בלבד
  new.ethics_badge_revoked_at := old.ethics_badge_revoked_at; -- הסרת תו: הנהלת הפלטפורמה בלבד

  -- המנוי בתשלום — דרך complete_subscription_order בלבד. אלה שדות כסף
  -- במלוא מובן המילה: מי שכותב/ת אותם מהדפדפן מעניק/ה לעצמו/ה מסלול Elite.
  new.paid_tier := old.paid_tier;
  new.paid_tier_until := old.paid_tier_until;

  -- בחירת המסלול והטבת ההשקה — דרך join-agency ו-promo-lifecycle בלבד.
  -- אלה שדות כסף: מי שיכול/ה לכתוב אותם מהדפדפן יכול/ה להאריך לעצמו/ה
  -- חצי שנה חינם, או לסמן בחירה שלא נעשתה.
  new.tier_selected_at := old.tier_selected_at;
  new.tier_source := old.tier_source;
  new.promo_tier := old.promo_tier;
  new.promo_started_at := old.promo_started_at;
  new.promo_ends_at := old.promo_ends_at;
  new.promo_notice_1_at := old.promo_notice_1_at;
  new.promo_notice_2_at := old.promo_notice_2_at;
  new.promo_ended_at := old.promo_ended_at;

  -- ניתוק מהמשרד — דרך release-team-member בלבד
  new.released_at := old.released_at;
  new.released_from_agency_id := old.released_from_agency_id;
  new.released_by := old.released_by;

  if not is_self or new.license_number is null or btrim(new.license_number) = '' then
    new.license_number := old.license_number;
  end if;

  -- אישור הקוד האתי — אישי בלבד, והחותמת נקבעת בשרת
  if not is_self then
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
    new.ethics_code_version := old.ethics_code_version;
  elsif new.ethics_code_accepted_at is null then
    new.ethics_code_version := null;               -- ביטול אישור מנקה גם את הגרסה
  elsif old.ethics_code_accepted_at is null
        or new.ethics_code_version is distinct from old.ethics_code_version then
    new.ethics_code_accepted_at := now();          -- אישור חדש (או לגרסה חדשה) — עכשיו
  else
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
  end if;

  if is_self then
    new.role := old.role;
    new.active := old.active;
    new.agency_id := old.agency_id;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. תמחור — מקור אמת אחד לסכום החיוב
--
-- הדפדפן שולח מסלול ומספר חודשים, **לא סכום**. הסכום מחושב כאן ורק כאן,
-- ונבדק שוב מול הסולק לפני שהמסלול נפתח.
-- ---------------------------------------------------------------------------
create or replace function public.subscription_price(p_tier text, p_months int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_monthly numeric;
  v_vat     numeric;
  v_max     int;
  v_before  numeric;
begin
  if p_tier not in ('mid', 'premium') then
    return jsonb_build_object('error', 'invalid_tier');
  end if;

  select value into v_max from public.pricing_config where key = 'subscription_max_months';
  v_max := coalesce(v_max, 12);
  if p_months is null or p_months < 1 or p_months > v_max then
    return jsonb_build_object('error', 'invalid_months', 'max', v_max);
  end if;

  select value into v_monthly from public.pricing_config
   where key = case p_tier when 'mid' then 'tier_mid_monthly_price'
                           else 'tier_premium_monthly_price' end;
  if v_monthly is null then
    return jsonb_build_object('error', 'price_not_configured');
  end if;

  select value into v_vat from public.pricing_config where key = 'vat_rate';
  v_vat := coalesce(v_vat, 0.18);

  v_before := v_monthly * p_months;
  return jsonb_build_object(
    'tier', p_tier, 'months', p_months,
    'monthly', v_monthly,
    'amount_before_vat', v_before,
    'vat_rate', v_vat,
    -- עיגול לאגורות, ולא לשקלים: הפרש של אגורה בין מה שהצגנו למה שנגבה
    -- מפיל את השוואת הסכום מול הסולק.
    'amount', round(v_before * (1 + v_vat), 2)
  );
end;
$$;

comment on function public.subscription_price(text, int) is
  'הסכום לחיוב עבור מנוי. מקור האמת היחיד לתמחור — הדפדפן אינו שולח סכום.';

-- ---------------------------------------------------------------------------
-- 6. פאזה 1 — פתיחת הזמנה
-- ---------------------------------------------------------------------------
create or replace function public.start_subscription_order(
  p_agent_id uuid, p_tier text, p_months int
)
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
  if not exists (select 1 from public.agency_members where id = p_agent_id and active) then
    return jsonb_build_object('error', 'agent_inactive');
  end if;

  v_price := public.subscription_price(p_tier, p_months);
  if v_price ? 'error' then return v_price; end if;

  select count(*) into v_open from public.subscription_orders
   where agent_id = p_agent_id and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_orders');
  end if;

  insert into public.subscription_orders
    (agent_id, tier, months, amount, amount_before_vat, vat_rate, status, provider)
  values
    (p_agent_id, p_tier, p_months,
     (v_price->>'amount')::numeric,
     (v_price->>'amount_before_vat')::numeric,
     (v_price->>'vat_rate')::numeric,
     'pending', 'morning')
  returning id into v_id;

  return jsonb_build_object('success', true, 'order_id', v_id,
                            'amount', (v_price->>'amount')::numeric,
                            'tier', p_tier, 'months', p_months);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. פאזה 2 — פתיחת המסלול
--
-- **הפונקציה היחידה שפותחת מסלול בתשלום.** אותן שלוש הגנות כמו בטעינת ארנק:
-- נעילת שורה, בדיקת סטטוס, והשוואת סכום מול מה **שאנחנו** רשמנו.
--
-- התקופה מצטברת: מי שמאריך/ה לפני שהמנוי נגמר מקבל/ת את החודשים החדשים
-- **מסוף התקופה הקיימת** ולא מהיום. אחרת הארכה מוקדמת הייתה מוחקת ימים
-- ששולמו.
-- ---------------------------------------------------------------------------
create or replace function public.complete_subscription_order(
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
  v_order public.subscription_orders;
  v_from  timestamptz;
  v_to    timestamptz;
begin
  select * into v_order from public.subscription_orders
   where id = p_order_id for update;
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
    update public.subscription_orders
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_order.amount, p_verified_amount)
     where id = p_order_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_order.amount, 'reported', p_verified_amount);
  end if;

  -- הארכה מסוף התקופה הקיימת, אם היא עדיין בתוקף ובאותו מסלול
  select case
           when paid_tier = v_order.tier and paid_tier_until is not null
                and paid_tier_until > now()
           then paid_tier_until else now()
         end
    into v_from
    from public.agency_members where id = v_order.agent_id;
  v_to := v_from + make_interval(months => v_order.months);

  update public.subscription_orders
     set status = 'success',
         provider_charge_id = coalesce(p_provider_charge_id, provider_charge_id),
         period_start = v_from, period_end = v_to,
         completed_at = now(), failure_reason = null
   where id = p_order_id;

  update public.agency_members
     set paid_tier = v_order.tier,
         paid_tier_until = v_to,
         pending_tier_change = null,
         pending_tier_change_at = null
   where id = v_order.agent_id;

  -- המסלול עצמו נקבע דרך הפונקציה הקיימת, כדי שהשינוי ייכנס ל-tier_changes
  -- ויירשם עם מקור שאפשר להבדיל בו: 'paid' אינו launch_promo ואינו self,
  -- ולכן expire_launch_promos לא ייגע בו.
  perform public.record_tier_selection(v_order.agent_id, v_order.tier, 'paid',
            format('מנוי בתשלום — %s חודשים, עד %s', v_order.months, v_to::date));

  insert into public.invoices (agent_id, related_charge_id, related_charge_type,
                               provider, provider_document_id, pdf_url, issued_at)
  values (v_order.agent_id, p_order_id, 'subscription',
          coalesce(v_order.provider, 'morning'), p_document_id, p_pdf_url, now());

  return jsonb_build_object('success', true, 'tier', v_order.tier,
                            'paid_until', v_to, 'amount', v_order.amount);
end;
$$;

create or replace function public.fail_subscription_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.subscription_orders
   where id = p_order_id for update;
  if not found then return jsonb_build_object('error', 'order_not_found'); end if;
  if v_status = 'success' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;
  update public.subscription_orders
     set status = 'failed', failure_reason = left(coalesce(p_reason, 'unknown'), 300)
   where id = p_order_id;
  return jsonb_build_object('success', true, 'status', 'failed');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. סיום תקופה
--
-- מסלול ששולם ונגמר יורד ל-free. רק מי ש-tier_source שלו/ה הוא 'paid' —
-- הטבת ההשקה ובחירה עצמאית מטופלות במקום אחר ואין לגעת בהן מכאן.
-- ---------------------------------------------------------------------------
create or replace function public.expire_paid_subscriptions()
returns table (member_id uuid, was_tier text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with expired as (
    select id, tier from public.agency_members
     where tier_source = 'paid'
       and paid_tier_until is not null
       and paid_tier_until < now()
       and tier <> 'free'
  ), updated as (
    update public.agency_members m
       set tier = 'free', tier_source = 'paid_expired', paid_tier = null
      from expired e where m.id = e.id
      returning m.id, e.tier
  )
  select * from updated;
end;
$$;

comment on function public.expire_paid_subscriptions() is
  'הורדת מסלול ששולם ותקופתו נגמרה. נוגעת רק ב-tier_source = paid.';

-- ---------------------------------------------------------------------------
-- 9. הרשאות
-- ---------------------------------------------------------------------------
revoke all on function public.start_subscription_order(uuid, text, int) from public, anon, authenticated;
grant execute on function public.start_subscription_order(uuid, text, int) to service_role;

revoke all on function public.complete_subscription_order(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_subscription_order(uuid, numeric, text, text, text) to service_role;

revoke all on function public.fail_subscription_order(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_subscription_order(uuid, text) to service_role;

revoke all on function public.expire_paid_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_paid_subscriptions() to service_role;

-- התמחור קריאה בלבד ואינו חושף דבר שאינו מפורסם ב-pricing.html ממילא,
-- ולכן הדפדפן רשאי לקרוא לו כדי להציג את הסכום לפני הרכישה.
revoke all on function public.subscription_price(text, int) from public, anon;
grant execute on function public.subscription_price(text, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. תזמון פקיעת המנויים
--
-- פעם ביום ב-03:10 UTC. אין כאן דחיפות של דקות: מסלול שפג בחצות ויורד
-- בשלוש לפנות בוקר אינו פוגע באיש, ותדירות גבוהה רק מוסיפה רעש.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את expire_paid_subscriptions בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('expire-paid-subscriptions')
    where exists (select 1 from cron.job where jobname = 'expire-paid-subscriptions');

  perform cron.schedule('expire-paid-subscriptions', '10 3 * * *',
                        'select public.expire_paid_subscriptions();');
end;
$$;

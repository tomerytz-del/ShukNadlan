-- ============================================================================
-- מנוי חודשי מתחדש לבעלי מקצוע
-- ----------------------------------------------------------------------------
-- עד היום כל תקופת פרסום נקנתה מראש ונגמרה לבד (terms.html §15, "אין חידוש
-- אוטומטי"). מעכשיו רכישה בתשלום מסמנת כברירת מחדל **חידוש חודשי**: בסוף
-- התקופה נגבה חודש נוסף מהכרטיס ששמור אצל מורנינג, עד ביטול במסך העריכה.
--
-- ## מתג הכיבוי — והוא כבוי
--
-- ‏`pricing_config.recurring_charging_enabled = 0`. כל עוד הוא 0, **שום חיוב
-- אוטומטי לא יוצא**: ‏claim_due_professional_renewals מחזירה רשימה ריקה,
-- ו-billing-renew בודקת את אותו מתג בעצמה. המנויים נרשמים, הביטול עובד,
-- והמסך מציג "מתחדש" — רק הגבייה עצמה ממתינה.
--
-- **למה הוא נולד כבוי.** שני דברים בנתיב הזה טרם אומתו מול מורנינג: השדה
-- שמורה לטופס התשלום לשמור את הכרטיס, וגוף הבקשות של
-- ‏`/payments/tokens/search` ו-`/payments/tokens/{id}/charge`. ב-24.9.2026
-- התשלום האמיתי הראשון נכשל בדיוק על פער בין התיעוד למציאות. מדליקים אחרי
-- חיוב אחד בסנדבוקס שעבר מקצה לקצה — docs/professional-cards.md.
--
-- ## שלוש החלטות שמסבירות את המבנה
--
-- 1. **מצב המנוי מתעדכן בטריגר על ad_orders, ולא בקוד שגבה.** הזמנת חידוש
--    היא שורת ad_orders רגילה, ויש שלושה מסלולים שיכולים לסגור אותה:
--    ‏billing-renew מיד אחרי החיוב, ה-webhook, וה-reconcile של
--    ‏wallet-topup-callback שסורק כל שורה pending. אילו כל אחד מהם היה
--    מעדכן את המנוי בעצמו, מסלול אחד היה שוכח. הטריגר רואה את כולם.
--
-- 2. **אין חיוב שני כל עוד יש חיוב פתוח.** ‏claim מסמנת charging_order_id
--    **לפני** הקריאה למורנינג, ולא תבחר מנוי שיש לו כזה. תשובה עמומה ממורנינג
--    (רשת, 5xx) משאירה את ההזמנה pending, וה-reconcile מכריע אותה לפי המסמך
--    שהופק או לא הופק. כלומר: במקרה הגרוע חיוב מתעכב — ולעולם לא כפול.
--
-- 3. **כישלון: ניסיון חוזר אחרי יום ואחרי שלושה ימים, ואז עצירה.** שלושה
--    ניסיונות סך הכול, נמדדים מהכישלון הראשון. אחרי השלישי המנוי עובר ל-
--    ‏`failed`, והכרטיסייה יורדת בתאריך ששולם עד אליו — בדיוק כמו היום.
--
-- אידמפוטנטית: if not exists, create or replace, on conflict do nothing.
-- ============================================================================

insert into public.pricing_config (key, value, description)
values ('recurring_charging_enabled', 0,
        'מתג הכיבוי של החיוב החודשי האוטומטי. 0 = אף כרטיס לא מחויב. להדליק רק אחרי חיוב בדיקה בסנדבוקס.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. ההזמנה יודעת אם היא פותחת מנוי, ואם היא חידוש
-- ---------------------------------------------------------------------------
alter table public.ad_orders
  add column if not exists auto_renew      boolean not null default false,
  add column if not exists subscription_id uuid;

comment on column public.ad_orders.auto_renew is
  'הרכישה ביקשה חידוש חודשי. כשההזמנה מצליחה, הטריגר רושם/מעדכן מנוי ב-billing_subscriptions.';
comment on column public.ad_orders.subscription_id is
  'מלא רק בהזמנת חידוש שנוצרה ב-claim_due_professional_renewals.';

-- ---------------------------------------------------------------------------
-- 2. המנויים
-- ---------------------------------------------------------------------------
create table if not exists public.billing_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null default 'professional' check (kind in ('professional')),
  placement_id      uuid not null unique references public.ad_placements(id) on delete cascade,
  contact_email     text,
  status            text not null default 'active'
                      check (status in ('active', 'cancelled', 'failed')),
  -- מזהה הכרטיס השמור אצל מורנינג. ריק עד שנמצא ב-/payments/tokens/search.
  card_token        text,
  -- התאריך שבו נגבה החודש הבא: יום לפני סוף התקופה, כדי שלא ייווצר חור.
  next_charge_on    date,
  failed_attempts   int not null default 0,
  first_failed_at   timestamptz,
  next_retry_at     timestamptz,
  -- ההזמנה שבדרך. כל עוד היא מלאה — אין חיוב נוסף.
  charging_order_id uuid,
  -- ההזמנה שתוצאתה עוד לא נשלחה במייל.
  notice_order_id   uuid,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  cancelled_at      timestamptz
);

comment on table public.billing_subscriptions is
  'מנוי חודשי מתחדש לכרטיסיית בעל/ת מקצוע. המצב מתעדכן בטריגר על ad_orders; החיוב ב-billing-renew, מאחורי recurring_charging_enabled.';

create index if not exists billing_subscriptions_due_idx
  on public.billing_subscriptions (next_charge_on)
  where status = 'active' and charging_order_id is null;

alter table public.billing_subscriptions enable row level security;

drop policy if exists "platform admin reads billing subscriptions" on public.billing_subscriptions;
create policy "platform admin reads billing subscriptions" on public.billing_subscriptions
  for select using (public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. הטריגר — מקור האמת היחיד למצב המנוי
-- ---------------------------------------------------------------------------
create or replace function public.ad_orders_sync_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ends  date;
  v_email text;
  v_sub   public.billing_subscriptions;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- ---- הצלחה ----------------------------------------------------------
  if new.status = 'success' then
    select ends_at, contact_email into v_ends, v_email
      from public.ad_placements where id = new.placement_id;

    if new.subscription_id is not null then
      -- חידוש שהצליח. **הסטטוס אינו נוגע כאן:** מי שביטל/ה בזמן שהחיוב
      -- היה בדרך נשאר/ת מבוטל/ת — החודש הזה שולם, הבא לא ייגבה.
      update public.billing_subscriptions
         set failed_attempts = 0, first_failed_at = null, next_retry_at = null,
             charging_order_id = null, next_charge_on = v_ends - 1,
             last_error = null, updated_at = now()
       where id = new.subscription_id;
    elsif new.auto_renew then
      -- רכישה ידנית עם חידוש: פותחת מנוי, או מחזירה לפעילות מנוי שבוטל או
      -- נכשל — זו הסכמה מחודשת ותשלום מחודש.
      insert into public.billing_subscriptions
        (placement_id, contact_email, status, next_charge_on)
      values (new.placement_id, v_email, 'active', v_ends - 1)
      on conflict (placement_id) do update
        set status            = 'active',
            contact_email     = excluded.contact_email,
            next_charge_on    = excluded.next_charge_on,
            failed_attempts   = 0,
            first_failed_at   = null,
            next_retry_at     = null,
            charging_order_id = null,
            cancelled_at      = null,
            last_error        = null,
            updated_at        = now();
    end if;
    return new;
  end if;

  -- ---- כישלון של הזמנת חידוש -----------------------------------------
  if new.status = 'failed' and new.subscription_id is not null then
    select * into v_sub from public.billing_subscriptions
     where id = new.subscription_id for update;
    if not found or v_sub.charging_order_id is distinct from new.id then
      return new;
    end if;

    update public.billing_subscriptions s
       set failed_attempts   = s.failed_attempts + 1,
           first_failed_at   = coalesce(s.first_failed_at, now()),
           charging_order_id = null,
           last_error        = left(coalesce(new.failure_reason, 'failed'), 300),
           -- ניסיון 2 אחרי יום, ניסיון 3 אחרי שלושה ימים מהכישלון הראשון.
           next_retry_at     = case s.failed_attempts + 1
                                 when 1 then coalesce(s.first_failed_at, now()) + interval '1 day'
                                 when 2 then coalesce(s.first_failed_at, now()) + interval '3 days'
                                 else null
                               end,
           status            = case when s.failed_attempts + 1 >= 3 then 'failed' else s.status end,
           updated_at        = now()
     where s.id = v_sub.id;
  end if;

  return new;
end;
$$;

drop trigger if exists ad_orders_sync_subscription on public.ad_orders;
create trigger ad_orders_sync_subscription
  after update of status on public.ad_orders
  for each row execute function public.ad_orders_sync_subscription();

-- ---------------------------------------------------------------------------
-- 4. בחירת המנויים שהגיע זמנם, ופתיחת הזמנת חידוש לכל אחד
--
-- ‏for update skip locked: שתי הרצות מקבילות של billing-renew אינן בוחרות
-- את אותו מנוי. ‏charging_order_id נקבע כאן, באותה טרנזקציה — לפני שמורנינג
-- שומע/ת על החיוב.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_professional_renewals(p_limit int default 20)
returns table (
  subscription_id uuid,
  order_id        uuid,
  placement_id    uuid,
  amount          numeric,
  card_token      text,
  contact_email   text,
  advertiser_name text,
  business_name   text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_on    numeric;
  v_price jsonb;
  r       record;
  v_order uuid;
begin
  select value into v_on from public.pricing_config where key = 'recurring_charging_enabled';
  if coalesce(v_on, 0) <> 1 then
    return;
  end if;

  v_price := public.professional_card_price(1);
  if v_price ? 'error' then
    return;
  end if;

  for r in
    select s.*, p.advertiser_name as p_name, p.business_name as p_business
      from public.billing_subscriptions s
      join public.ad_placements p on p.id = s.placement_id
     where s.status = 'active'
       and s.charging_order_id is null
       and p.status = 'active'                       -- מושהית בידי מנהל/ת: לא גובים
       and (
             (s.failed_attempts = 0 and s.next_charge_on <= current_date)
          or (s.failed_attempts > 0 and s.next_retry_at <= now())
           )
     order by s.next_charge_on
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update of s skip locked
  loop
    insert into public.ad_orders
      (placement_id, months, amount, amount_before_vat, vat_rate, status,
       provider, auto_renew, subscription_id)
    values
      (r.placement_id, 1,
       (v_price->>'amount')::numeric,
       (v_price->>'amount_before_vat')::numeric,
       (v_price->>'vat_rate')::numeric,
       'pending', 'morning_token', true, r.id)
    returning id into v_order;

    update public.billing_subscriptions
       set charging_order_id = v_order, notice_order_id = v_order, updated_at = now()
     where id = r.id;

    subscription_id := r.id;
    order_id        := v_order;
    placement_id    := r.placement_id;
    amount          := (v_price->>'amount')::numeric;
    card_token      := r.card_token;
    contact_email   := r.contact_email;
    advertiser_name := r.p_name;
    business_name   := r.p_business;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. ביטול וחידוש מחדש — ממסך העריכה (professional-manage, service_role)
--
-- ביטול אינו מחזיר כסף ואינו מוריד את הכרטיסייה: היא נשארת עד התאריך ששולם.
-- הפעלה מחדש אפשרית רק כשיש כרטיס שמור ולא אחרי שלושה כישלונות — אחרת
-- החיוב הבא נכשל בוודאות, ומי שרוצה להמשיך קונה הארכה עם תיבת החידוש.
-- ---------------------------------------------------------------------------
create or replace function public.set_professional_auto_renew(p_placement_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.billing_subscriptions;
begin
  select * into v_sub from public.billing_subscriptions
   where placement_id = p_placement_id for update;
  if not found then
    return jsonb_build_object('error', 'no_subscription');
  end if;

  if not p_on then
    update public.billing_subscriptions
       set status = 'cancelled', cancelled_at = now(), next_retry_at = null, updated_at = now()
     where id = v_sub.id;
    return jsonb_build_object('success', true, 'status', 'cancelled');
  end if;

  if v_sub.status = 'failed' then
    return jsonb_build_object('error', 'needs_new_payment');
  end if;
  if v_sub.card_token is null then
    return jsonb_build_object('error', 'needs_new_payment');
  end if;

  update public.billing_subscriptions
     set status = 'active', cancelled_at = null, updated_at = now()
   where id = v_sub.id;
  return jsonb_build_object('success', true, 'status', 'active');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. הרשאות — service_role בלבד. אין לבעל/ת מקצוע חשבון, ולכן אין למי לתת.
-- ---------------------------------------------------------------------------
revoke all on function public.ad_orders_sync_subscription() from public, anon, authenticated;

revoke all on function public.claim_due_professional_renewals(int) from public, anon, authenticated;
grant execute on function public.claim_due_professional_renewals(int) to service_role;

revoke all on function public.set_professional_auto_renew(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_professional_auto_renew(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7. התזמון — פעם בשעה, ורק כשיש מה לעשות
--
-- התנאי הוא superset (כמו ב-20261021090000): מנוי פעיל שהגיע תאריכו, או
-- הזמנה שתוצאתה עוד לא נשלחה. המתג אינו בתנאי בכוונה — הוא נבדק בפונקציה.
-- ---------------------------------------------------------------------------
do $$
declare
  v_base text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — billing-renew לא תוזמן';
    return;
  end if;

  perform cron.unschedule('billing-renew')
    where exists (select 1 from cron.job where jobname = 'billing-renew');

  perform cron.schedule('billing-renew', '17 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (select 1 from public.billing_subscriptions
                   where status = 'active' and charging_order_id is null
                     and (next_charge_on <= current_date or next_retry_at <= now()))
       or exists (select 1 from public.billing_subscriptions where notice_order_id is not null);
  $cron$, v_base || 'billing-renew'));
end;
$$;

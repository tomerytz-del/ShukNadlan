-- ============================================================================
-- מנוי חודשי מתחדש לסוכנים: PROFESSIONAL ו-Elite בחיוב אוטומטי
--
-- **ההחלטה (7.10.2026):** מסלול בתשלום נגבה מהכרטיס כל חודש, עד ביטול. מי
-- שההטבה שלו/ה נגמרת ולא שילם/ה יורד/ת ל-Pay&GO, כמו היום.
--
-- **הכול נשען על מה שכבר קיים, ולא נבנה פעמיים:**
--
--   * ‏subscription_orders + start/complete/fail_subscription_order - הזמנת
--     מנוי בתשלום מראש (20261015090000), וה-reconcile של wallet-topup-callback
--     שכבר סורק אותה.
--   * ‏billing_subscriptions + billing-renew - החיוב החודשי של בעלי המקצוע
--     (20270106090000), עם אותו מתג כיבוי: ‏recurring_charging_enabled.
--
-- **המתג נשאר כבוי.** כל עוד הוא 0 - הרכישה הראשונה עובדת (טופס תשלום רגיל,
-- כמו טעינת ארנק), המנוי נרשם, הביטול עובד, ושום כרטיס לא מחויב שוב. החידוש
-- האוטומטי נדלק במיגרציה נפרדת, אחרי חיוב בדיקה בסנדבוקס - אותם שלושה
-- דברים שטרם אומתו מול מורנינג (docs/professional-cards.md, "להדלקה").
--
-- **ההטבה.** כל הסוכנים היום בהטבת ההשקה. רכישה בתקופת ההטבה מותרת רק ב-30
-- הימים האחרונים שלה, והתקופה ששולמה מתחילה **בסוף ההטבה** - לא נגבים
-- עבור חודש שכבר ניתן בחינם. המסלול עצמו מתחלף בסוף ההטבה, ב-
-- ‏expire_launch_promos, ולא ברגע התשלום: מי שבחר/ה PROFESSIONAL נשאר/ת
-- ב-Elite עד תום ההטבה, כמו שהובטח.
--
-- אידמפוטנטית: if not exists, create or replace, drop ... if exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ההזמנה יודעת אם היא פותחת מנוי, ואם היא חידוש
-- ---------------------------------------------------------------------------
alter table public.subscription_orders
  add column if not exists auto_renew      boolean not null default false,
  add column if not exists subscription_id uuid,
  add column if not exists contact_email   text;

comment on column public.subscription_orders.auto_renew is
  'הרכישה ביקשה חידוש חודשי. כשההזמנה מצליחה, הטריגר רושם/מעדכן מנוי ב-billing_subscriptions (kind=tier).';
comment on column public.subscription_orders.subscription_id is
  'מלא רק בהזמנת חידוש שנוצרה ב-claim_due_tier_renewals.';
comment on column public.subscription_orders.contact_email is
  'האימייל שנשלח למורנינג בטופס - הכרטיס השמור נמצא לפיו (findCardToken).';

-- ---------------------------------------------------------------------------
-- 2. ‏billing_subscriptions מקבלת סוג שני: מסלול של סוכן/ת
-- ---------------------------------------------------------------------------
alter table public.billing_subscriptions
  add column if not exists agent_id uuid references public.agency_members(id) on delete cascade,
  add column if not exists tier     text;

alter table public.billing_subscriptions alter column placement_id drop not null;

alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_kind_check;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_kind_check check (kind in ('professional', 'tier'));

alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_target_check;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_target_check check (
    (kind = 'professional' and placement_id is not null and agent_id is null)
    or (kind = 'tier' and agent_id is not null and placement_id is null
        and tier in ('mid', 'premium')));

-- מנוי מסלול אחד לכל סוכן/ת. מעבר מסלול מעדכן את אותה שורה.
create unique index if not exists billing_subscriptions_agent_uniq
  on public.billing_subscriptions (agent_id) where agent_id is not null;

comment on table public.billing_subscriptions is
  'מנוי חודשי מתחדש: כרטיסיית בעל/ת מקצוע (kind=professional, טריגר על ad_orders) או מסלול של סוכן/ת (kind=tier, טריגר על subscription_orders). החיוב ב-billing-renew, מאחורי recurring_charging_enabled.';

-- הסוכן/ת קורא/ת את המנוי שלו/ה - כדי להציג "מתחדש ב-..." ואת כפתור הביטול.
drop policy if exists "agent reads own tier subscription" on public.billing_subscriptions;
create policy "agent reads own tier subscription" on public.billing_subscriptions
  for select using (kind = 'tier' and agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 3. פתיחת ההזמנה: מותרת בתקופת ההטבה רק ב-30 הימים האחרונים שלה
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
  v_price  jsonb;
  v_id     uuid;
  v_open   int;
  v_member public.agency_members;
begin
  select * into v_member from public.agency_members where id = p_agent_id and active;
  if not found then
    return jsonb_build_object('error', 'agent_inactive');
  end if;

  -- בתקופת ההטבה: רק בחודש האחרון, וכל מסלול - התקופה תתחיל בסוף ההטבה,
  -- ולכן גם PROFESSIONAL אינו "ירידה" עכשיו (complete_subscription_order).
  -- לפני כן אין מה לשלם עליו: Elite ניתן ממילא.
  if v_member.promo_ends_at is not null
     and v_member.promo_ended_at is null
     and v_member.promo_ends_at > now() + interval '30 days' then
    return jsonb_build_object('error', 'promo_active', 'promo_ends_at', v_member.promo_ends_at);
  end if;

  -- ירידה למסלול נמוך יותר בזמן שמסלול גבוה ששולם עדיין בתוקף: נכנסת לתוקף
  -- בסוף התקופה ששולמה (terms.html §6). אין כאן "מסלול עתידי" - מבטלים את
  -- החידוש, ובסוף התקופה רוכשים את הנמוך. שדרוג, לעומת זאת, מיידי.
  if v_member.tier_source = 'paid'
     and v_member.paid_tier_until > now()
     and public.tier_rank(p_tier) < public.tier_rank(v_member.tier) then
    return jsonb_build_object('error', 'downgrade_at_period_end', 'paid_until', v_member.paid_tier_until);
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
-- 4. השלמת ההזמנה: התקופה מתחילה בסוף ההטבה, והמסלול מתחלף שם
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
  v_order  public.subscription_orders;
  v_member public.agency_members;
  v_promo  boolean;
  v_from   timestamptz;
  v_to     timestamptz;
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

  select * into v_member from public.agency_members where id = v_order.agent_id for update;
  v_promo := v_member.promo_ends_at is not null
             and v_member.promo_ended_at is null
             and v_member.promo_ends_at > now();

  -- מאיפה התקופה מתחילה:
  --   * בתקופת ההטבה - מסופה. החודש הזה ניתן בחינם, ואין לגבות עליו.
  --   * חידוש באותו מסלול לפני שהקודם נגמר - מסוף הקודם (‏20261015090000).
  --   * אחרת - מעכשיו: שדרוג באמצע תקופה מתחיל מיד, בלי זיכוי יחסי (ירידה
  --     נחסמת ב-start_subscription_order עד סוף התקופה).
  v_from := case
              when v_promo then v_member.promo_ends_at
              when v_member.paid_tier = v_order.tier and v_member.paid_tier_until > now()
                then v_member.paid_tier_until
              else now()
            end;
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

  -- בתקופת ההטבה המסלול **אינו** מתחלף עכשיו: מי שבחר/ה PROFESSIONAL נשאר/ת
  -- ב-Elite עד סוף ההטבה. ההחלפה ב-expire_launch_promos, לפי paid_tier.
  if not v_promo then
    perform public.record_tier_selection(v_order.agent_id, v_order.tier, 'paid',
              format('מנוי בתשלום - %s חודשים, עד %s', v_order.months, v_to::date));
  end if;

  insert into public.invoices (agent_id, related_charge_id, related_charge_type,
                               provider, provider_document_id, pdf_url, issued_at)
  values (v_order.agent_id, p_order_id, 'subscription',
          coalesce(v_order.provider, 'morning'), p_document_id, p_pdf_url, now());

  return jsonb_build_object('success', true, 'tier', v_order.tier,
                            'paid_from', v_from, 'paid_until', v_to, 'amount', v_order.amount);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. סוף ההטבה: מי ששילם/ה עובר/ת למסלול ששילם/ה עליו, השאר ל-Pay&GO
-- ---------------------------------------------------------------------------
create or replace function public.expire_launch_promos()
returns table (
  member        uuid,
  member_name   text,
  member_email  text,
  agency        uuid,
  previous_tier text,
  new_tier      text,
  downgraded    boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select m.id
      from public.agency_members m
     where m.promo_ends_at is not null
       and m.promo_ended_at is null
       and m.promo_ends_at <= now()
     order by m.promo_ends_at
     for update skip locked
  ),
  closed as (
    update public.agency_members m
       set promo_ended_at = now(),
           tier = case
                    -- שילם/ה מראש על מסלול שמתחיל עכשיו
                    when m.paid_tier is not null and m.paid_tier_until > now() then m.paid_tier
                    when m.tier_source is null
                      or m.tier_source in ('launch_promo', 'launch_promo_accepted') then 'free'
                    else m.tier
                  end,
           tier_source = case
                           when m.paid_tier is not null and m.paid_tier_until > now() then 'paid'
                           when m.tier_source is null
                             or m.tier_source in ('launch_promo', 'launch_promo_accepted')
                             then 'promo_expired'
                           else m.tier_source
                         end
      from due
     where m.id = due.id
    returning m.id, m.display_name, m.email, m.agency_id, m.tier as tier_after,
              m.tier_source as source_after, m.promo_tier
  ),
  logged as (
    insert into public.tier_changes (member_id, agency_id, from_tier, to_tier, source, note)
    select c.id, c.agency_id, c.promo_tier, c.tier_after, c.source_after,
           case when c.source_after = 'paid' then 'תום הטבת ההשקה - מנוי בתשלום'
                else 'תום הטבת ההשקה' end
      from closed c
     where c.source_after in ('promo_expired', 'paid')
    returning 1
  )
  select c.id, c.display_name, c.email, c.agency_id,
         c.promo_tier, c.tier_after, (c.source_after = 'promo_expired')
    from closed c;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. הטריגר - מקור האמת היחיד למצב מנוי המסלול
--
-- אותו מבנה של ad_orders_sync_subscription, ומאותה סיבה: הזמנת חידוש יכולה
-- להיסגר ב-billing-renew, ב-webhook או ב-reconcile, והטריגר רואה את שלושתם.
-- ---------------------------------------------------------------------------
create or replace function public.subscription_orders_sync_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
  v_sub   public.billing_subscriptions;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'success' then
    -- ‏**מההזמנה ולא מ-agency_members:** ‏complete_subscription_order מעדכנת
    -- את ההזמנה (והטריגר רץ) **לפני** שהיא מעדכנת את paid_tier_until, ולכן
    -- שם עדיין יושב הערך הקודם. נמצא בבדיקה המקומית - החיוב הבא נקבע לתאריך
    -- של החודש הקודם.
    v_until := new.period_end;

    if new.subscription_id is not null then
      -- חידוש שהצליח. הסטטוס אינו נוגע: מי שביטל/ה בזמן שהחיוב היה בדרך
      -- נשאר/ת מבוטל/ת - החודש הזה שולם, הבא לא ייגבה.
      update public.billing_subscriptions
         set failed_attempts = 0, first_failed_at = null, next_retry_at = null,
             charging_order_id = null, next_charge_on = (v_until - interval '1 day')::date,
             last_error = null, updated_at = now()
       where id = new.subscription_id;
    elsif new.auto_renew then
      -- רכישה ידנית עם חידוש: פותחת מנוי, או מחזירה לפעילות מנוי שבוטל או
      -- נכשל, ומעדכנת את המסלול אם השתנה.
      insert into public.billing_subscriptions
        (kind, agent_id, tier, contact_email, status, next_charge_on)
      values ('tier', new.agent_id, new.tier, new.contact_email, 'active',
              (v_until - interval '1 day')::date)
      on conflict (agent_id) where agent_id is not null do update
        set tier              = excluded.tier,
            status            = 'active',
            contact_email     = coalesce(excluded.contact_email, public.billing_subscriptions.contact_email),
            next_charge_on    = excluded.next_charge_on,
            failed_attempts   = 0,
            first_failed_at   = null,
            next_retry_at     = null,
            charging_order_id = null,
            cancelled_at      = null,
            last_error        = null,
            -- כרטיס חדש אולי: יחפש מחדש בחיוב הבא
            card_token        = null,
            updated_at        = now();
    else
      -- רכישה בלי חידוש מבטלת מנוי קיים: זו בחירה מפורשת לשלם פעם אחת.
      update public.billing_subscriptions
         set status = 'cancelled', cancelled_at = now(), next_retry_at = null, updated_at = now()
       where agent_id = new.agent_id and status = 'active';
    end if;
    return new;
  end if;

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

drop trigger if exists subscription_orders_sync_subscription on public.subscription_orders;
create trigger subscription_orders_sync_subscription
  after update of status on public.subscription_orders
  for each row execute function public.subscription_orders_sync_subscription();

-- ---------------------------------------------------------------------------
-- 7. בחירת מנויי המסלול שהגיע זמנם, ופתיחת הזמנת חידוש לכל אחד
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_tier_renewals(p_limit int default 20)
returns table (
  subscription_id uuid,
  order_id        uuid,
  agent_id        uuid,
  tier            text,
  amount          numeric,
  card_token      text,
  contact_email   text,
  display_name    text
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

  -- ‏**מסלול שהשתנה מחוץ לרכישה מבטל את החידוש.** המסלול יורד בכמה דרכים
  -- (‏admin_apply_tier_change, ‏set_tier, סוף תקופה, סגירה) - ובדיקת מצב כאן
  -- תופסת את כולן, בלי לזכור לבטל בכל אחת. אותו נימוק של phone_line_tier_sweep.
  -- בתקופת ההטבה המסלול על השורה הוא של ההטבה, ולכן היא מחוץ לבדיקה.
  update public.billing_subscriptions s
     set status = 'cancelled', cancelled_at = now(), next_retry_at = null,
         last_error = 'tier_changed', updated_at = now()
    from public.agency_members m
   where s.kind = 'tier' and s.status = 'active' and s.charging_order_id is null
     and m.id = s.agent_id
     and m.tier is distinct from s.tier
     and not (m.promo_ends_at is not null and m.promo_ended_at is null and m.promo_ends_at > now());

  for r in
    select s.*, m.display_name as m_name
      from public.billing_subscriptions s
      join public.agency_members m on m.id = s.agent_id
     where s.kind = 'tier'
       and s.status = 'active'
       and s.charging_order_id is null
       and m.active                                   -- חשבון סגור: לא גובים
       -- ביקש/ה לסגור את החשבון: נשאר/ת עד סוף התקופה ששולמה, בלי חיוב נוסף
       -- (‏close-account). ביטול הבקשה מחזיר את החידוש מעצמו.
       and m.closure_requested_at is null
       and (
             (s.failed_attempts = 0 and s.next_charge_on <= current_date)
          or (s.failed_attempts > 0 and s.next_retry_at <= now())
           )
     order by s.next_charge_on
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update of s skip locked
  loop
    v_price := public.subscription_price(r.tier, 1);
    if v_price ? 'error' then
      continue;
    end if;

    insert into public.subscription_orders
      (agent_id, tier, months, amount, amount_before_vat, vat_rate, status,
       provider, auto_renew, subscription_id, contact_email)
    values
      (r.agent_id, r.tier, 1,
       (v_price->>'amount')::numeric,
       (v_price->>'amount_before_vat')::numeric,
       (v_price->>'vat_rate')::numeric,
       'pending', 'morning_token', true, r.id, r.contact_email)
    returning id into v_order;

    update public.billing_subscriptions
       set charging_order_id = v_order, notice_order_id = v_order, updated_at = now()
     where id = r.id;

    subscription_id := r.id;
    order_id        := v_order;
    agent_id        := r.agent_id;
    tier            := r.tier;
    amount          := (v_price->>'amount')::numeric;
    card_token      := r.card_token;
    contact_email   := r.contact_email;
    display_name    := r.m_name;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. ביטול והפעלה מחדש - מה-CRM, לפי ה-JWT
--
-- ביטול אינו מחזיר כסף ואינו מוריד מסלול: הוא נשאר עד paid_tier_until, ושם
-- expire_paid_subscriptions מורידה ל-Pay&GO. הפעלה מחדש רק כשיש כרטיס שמור
-- ולא אחרי שלושה כישלונות - אחרת החיוב הבא נכשל בוודאות, ומי שרוצה להמשיך
-- משלם/ת בעמוד התשלום עם החידוש מסומן.
-- ---------------------------------------------------------------------------
create or replace function public.set_tier_auto_renew(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
  v_sub   public.billing_subscriptions;
begin
  if v_agent is null then
    return jsonb_build_object('error', 'not_signed_in');
  end if;
  select * into v_sub from public.billing_subscriptions
   where kind = 'tier' and agent_id = v_agent for update;
  if not found then
    return jsonb_build_object('error', 'no_subscription');
  end if;

  if not p_on then
    update public.billing_subscriptions
       set status = 'cancelled', cancelled_at = now(), next_retry_at = null, updated_at = now()
     where id = v_sub.id;
    return jsonb_build_object('success', true, 'status', 'cancelled');
  end if;

  if v_sub.status = 'failed' or v_sub.card_token is null then
    return jsonb_build_object('error', 'needs_new_payment');
  end if;

  update public.billing_subscriptions
     set status = 'active', cancelled_at = null, updated_at = now()
   where id = v_sub.id;
  return jsonb_build_object('success', true, 'status', 'active');
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. הרשאות
-- ---------------------------------------------------------------------------
revoke all on function public.subscription_orders_sync_subscription() from public, anon, authenticated;

revoke all on function public.claim_due_tier_renewals(int) from public, anon, authenticated;
grant execute on function public.claim_due_tier_renewals(int) to service_role;

revoke all on function public.set_tier_auto_renew(boolean) from public, anon;
grant execute on function public.set_tier_auto_renew(boolean) to authenticated, service_role;

revoke all on function public.start_subscription_order(uuid, text, int) from public, anon, authenticated;
grant execute on function public.start_subscription_order(uuid, text, int) to service_role;

revoke all on function public.complete_subscription_order(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_subscription_order(uuid, numeric, text, text, text) to service_role;

revoke all on function public.expire_launch_promos() from public, anon, authenticated;
grant execute on function public.expire_launch_promos() to service_role;

-- ---------------------------------------------------------------------------
-- 10. התזמון: אותו cron של billing-renew, עם התנאי המורחב לשני הסוגים.
--     ‏billing_subscriptions כוללת עכשיו את שניהם, ולכן התנאי הקיים כבר נכון -
--     אין מה לשנות. ההערה כאן כדי שמי שמחפש/ת "מי מחייב מסלולים" ימצא/תמצא.
-- ---------------------------------------------------------------------------

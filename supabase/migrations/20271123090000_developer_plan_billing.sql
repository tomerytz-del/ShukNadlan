-- ============================================================================
-- מסלול החשבון ליזמים, קבלנים ומשווקי פרויקטים: חיוב חודשי מתחדש בכרטיס
--
-- **ההחלטות (תומר, 20.11.2026):**
--   1. החיוב בכרטיס אשראי חוזר (לא מהארנק), עד ביטול.
--   2. המסלול נקבע **אוטומטית** לפי כמה פרויקטים חיים יש בחשבון ברגע החיוב:
--      199 ₪ עד 10, 278 ₪ עד 20, 397 ₪ מ-21 (לפני מע״מ, לחודש).
--   3. מי שבוחר/ת מסלול בתוך חלון החינם נגבה/ית רק על התקופה שאחריו: התקופה
--      ששולמה מתחילה ב-`developers.free_until`.
--
-- **הכול נשען על מה שכבר קיים, ולא נבנה פעמיים** (אותה צורה של מסלולי הסוכנים,
-- 20270307090000): טבלת הזמנות משלה, `billing_subscriptions` עם סוג שלישי
-- (`developer_plan`), טריגר אחד על טבלת ההזמנות שהוא מקור האמת למצב המנוי,
-- ו-`billing-renew` שמחייב. ‏`wallet-topup-callback` סוגר את ההזמנה (webhook ו-reconcile).
--
-- **המתג נשאר כבוי.** ‏`recurring_charging_enabled` עדיין 0: הרכישה הראשונה
-- עובדת (טופס תשלום רגיל), המנוי נרשם והביטול עובד, אבל שום כרטיס לא מחויב שוב
-- עד שהוא נדלק, אחרי חיוב בדיקה בסנדבוקס (docs/professional-cards.md, "להדלקה").
-- התקופה הראשונה נגבית כבר ברכישה, ולכן הפרויקטים נשארים באוויר גם בלי החידוש.
--
-- **המסלול אינו תקרה.** פרויקט שעולה באמצע תקופה מעבר למסלול ששולם עולה באוויר
-- עד סוף התקופה ששולמה, והמסלול הבא יחושב מחדש בחיוב הבא. אין מצב שבו פרויקט
-- נחסם על שדרוג.
--
-- אידמפוטנטית: if not exists, create or replace, drop ... if exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מה שנשמר על החשבון: עד מתי שולם
-- ---------------------------------------------------------------------------
alter table public.developers add column if not exists plan_paid_until timestamptz;

comment on column public.developers.plan_paid_until is
  'סוף התקופה האחרונה ששולמה במסלול החשבון (developer_plan_orders). ריק = לא שילם/ה מעולם. פרויקט חי עד המאוחר מבין free_until ל-plan_paid_until.';

-- ---------------------------------------------------------------------------
-- 2. הזמנות המסלול. אותה צורה של subscription_orders
-- ---------------------------------------------------------------------------
create table if not exists public.developer_plan_orders (
  id                   uuid primary key default gen_random_uuid(),
  developer_id         uuid not null references public.developers(id) on delete cascade,
  -- המסלול שנקבע בזמן ההזמנה, ומספר הפרויקטים החיים שלפיו. נשמרים כפי שחויבו
  tier                 text not null check (tier in ('tier1', 'tier2', 'tier3')),
  projects_count       int  not null check (projects_count >= 1),
  -- הסכום שנגבה בפועל, כולל מע״מ. נשמר ולא מחושב מחדש: שינוי מחיר אינו משכתב היסטוריה
  amount               numeric(10,2) not null check (amount > 0),
  amount_before_vat    numeric(10,2) not null check (amount_before_vat > 0),
  vat_rate             numeric not null,
  status               text not null default 'pending'
                         check (status in ('pending', 'success', 'failed')),
  test_mode            boolean not null default false,
  provider             text default 'morning',
  provider_form_id     text,
  provider_payment_url text,
  provider_charge_id   text,
  provider_document_id text,
  provider_pdf_url     text,
  auto_renew           boolean not null default true,
  subscription_id      uuid,
  contact_email        text,
  period_start         timestamptz,
  period_end           timestamptz,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  failure_reason       text
);

comment on table public.developer_plan_orders is
  'הזמנת מסלול חשבון ליזם/קבלן/משווק (חודש אחד). נסגרת ב-wallet-topup-callback דרך complete_developer_plan_order; הטריגר מעדכן את billing_subscriptions (kind=developer_plan).';

create unique index if not exists developer_plan_orders_provider_charge_uniq
  on public.developer_plan_orders (provider, provider_charge_id)
  where provider_charge_id is not null;

create index if not exists developer_plan_orders_pending_idx
  on public.developer_plan_orders (status, created_at) where status = 'pending';

create index if not exists developer_plan_orders_developer_idx
  on public.developer_plan_orders (developer_id, created_at desc);

alter table public.developer_plan_orders enable row level security;
-- הדפדפן אינו ניגש: הדשבורד קורא דרך project-manage (service_role)
revoke all on table public.developer_plan_orders from public, anon, authenticated;
grant select, insert, update, delete on table public.developer_plan_orders to service_role;

-- ---------------------------------------------------------------------------
-- 3. ‏billing_subscriptions מקבלת סוג שלישי
-- ---------------------------------------------------------------------------
alter table public.billing_subscriptions
  add column if not exists developer_id uuid references public.developers(id) on delete cascade;

alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_kind_check;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_kind_check
  check (kind in ('professional', 'tier', 'developer_plan'));

alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_target_check;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_target_check check (
    (kind = 'professional' and placement_id is not null and agent_id is null and developer_id is null)
    or (kind = 'tier' and agent_id is not null and placement_id is null and developer_id is null
        and tier in ('mid', 'premium'))
    or (kind = 'developer_plan' and developer_id is not null
        and placement_id is null and agent_id is null));

-- מנוי מסלול אחד לכל חשבון יזם
create unique index if not exists billing_subscriptions_developer_uniq
  on public.billing_subscriptions (developer_id) where developer_id is not null;

comment on table public.billing_subscriptions is
  'מנוי חודשי מתחדש: כרטיסיית בעל/ת מקצוע (kind=professional, טריגר על ad_orders), מסלול של סוכן/ת (kind=tier, טריגר על subscription_orders) או מסלול חשבון של יזם/קבלן/משווק (kind=developer_plan, טריגר על developer_plan_orders). החיוב ב-billing-renew, מאחורי recurring_charging_enabled.';

-- ---------------------------------------------------------------------------
-- 4. ההצעה: כמה פרויקטים חיים, איזה מסלול, כמה
-- ---------------------------------------------------------------------------
create or replace function public.developer_plan_quote(p_developer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count  int;
  v_t1max  numeric;
  v_t2max  numeric;
  v_tier   text;
  v_before numeric;
begin
  select count(*) into v_count from public.projects
   where developer_id = p_developer_id and status = 'active';

  select value into v_t1max from public.pricing_config where key = 'project_plan_tier1_max';
  select value into v_t2max from public.pricing_config where key = 'project_plan_tier2_max';
  if v_t1max is null or v_t2max is null then
    return jsonb_build_object('error', 'pricing_not_configured');
  end if;

  v_tier := case when v_count <= v_t1max then 'tier1'
                 when v_count <= v_t2max then 'tier2'
                 else 'tier3' end;

  select value into v_before from public.pricing_config where key = 'project_plan_' || v_tier || '_price';
  if v_before is null then
    return jsonb_build_object('error', 'pricing_not_configured');
  end if;

  return jsonb_build_object(
    'projects_count',    v_count,
    'tier',              v_tier,
    'amount_before_vat', v_before,
    'amount',            public.vat_gross(v_before),
    'vat_rate',          coalesce((select value from public.pricing_config where key = 'vat_rate'), 0.18));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. פתיחת ההזמנה
-- ---------------------------------------------------------------------------
create or replace function public.start_developer_plan_order(p_developer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dev   public.developers;
  v_quote jsonb;
  v_open  int;
  v_id    uuid;
begin
  select * into v_dev from public.developers where id = p_developer_id and status = 'active';
  if not found then
    return jsonb_build_object('error', 'developer_inactive');
  end if;

  -- בתוך חלון החינם: רק ב-30 הימים האחרונים שלו, והתקופה ששולמה מתחילה בסופו
  -- (complete_developer_plan_order). לפני כן אין מה לשלם עליו.
  if v_dev.free_until > now() + interval '30 days' then
    return jsonb_build_object('error', 'window_active', 'free_until', v_dev.free_until);
  end if;

  v_quote := public.developer_plan_quote(p_developer_id);
  if v_quote ? 'error' then return v_quote; end if;
  if (v_quote->>'projects_count')::int < 1 then
    -- מסלול הוא על פרויקטים חיים. בלי פרויקט חי אין על מה לגבות
    return jsonb_build_object('error', 'no_live_projects');
  end if;

  select count(*) into v_open from public.developer_plan_orders
   where developer_id = p_developer_id and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_orders');
  end if;

  insert into public.developer_plan_orders
    (developer_id, tier, projects_count, amount, amount_before_vat, vat_rate, status, provider)
  values
    (p_developer_id, v_quote->>'tier', (v_quote->>'projects_count')::int,
     (v_quote->>'amount')::numeric, (v_quote->>'amount_before_vat')::numeric,
     (v_quote->>'vat_rate')::numeric, 'pending', 'morning')
  returning id into v_id;

  return jsonb_build_object('success', true, 'order_id', v_id,
                            'amount', (v_quote->>'amount')::numeric,
                            'tier', v_quote->>'tier',
                            'projects_count', (v_quote->>'projects_count')::int);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. השלמת ההזמנה: התקופה מתחילה בסוף החלון, ופרויקטים חיים מתארכים עד סופה
-- ---------------------------------------------------------------------------
create or replace function public.complete_developer_plan_order(
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
  v_order public.developer_plan_orders;
  v_dev   public.developers;
  v_from  timestamptz;
  v_to    timestamptz;
begin
  select * into v_order from public.developer_plan_orders
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
    update public.developer_plan_orders
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_order.amount, p_verified_amount)
     where id = p_order_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_order.amount, 'reported', p_verified_amount);
  end if;

  select * into v_dev from public.developers where id = v_order.developer_id for update;

  -- מאיפה התקופה מתחילה: סוף החלון החינמי, או סוף התקופה ששולמה (חידוש לפני
  -- שהקודמת נגמרה), או עכשיו. תמיד המאוחר מביניהם: לא גובים על זמן שכבר ניתן
  v_from := greatest(now(), v_dev.free_until, coalesce(v_dev.plan_paid_until, now()));
  v_to   := v_from + interval '1 month';

  update public.developer_plan_orders
     set status = 'success',
         provider_charge_id = coalesce(p_provider_charge_id, provider_charge_id),
         provider_document_id = coalesce(p_document_id, provider_document_id),
         provider_pdf_url = coalesce(p_pdf_url, provider_pdf_url),
         period_start = v_from, period_end = v_to,
         completed_at = now(), failure_reason = null
   where id = p_order_id;

  update public.developers set plan_paid_until = v_to where id = v_order.developer_id;

  -- הפרויקטים החיים באוויר עד סוף התקופה ששולמה. greatest: תקופה שכבר ארוכה יותר
  -- (למשל 350 ₪ שנגבו לפני ההחלטה) אינה מתקצרת
  update public.projects
     set subscription_status = 'active',
         subscription_started_at = coalesce(subscription_started_at, now()),
         subscription_expires_at = greatest(coalesce(subscription_expires_at, v_to), v_to)
   where developer_id = v_order.developer_id and status = 'active';

  return jsonb_build_object('success', true, 'paid_from', v_from, 'paid_until', v_to,
                            'amount', v_order.amount, 'tier', v_order.tier);
end;
$$;

create or replace function public.fail_developer_plan_order(p_order_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.developer_plan_orders
     set status = 'failed', failure_reason = left(coalesce(p_reason, 'failed'), 300)
   where id = p_order_id and status = 'pending';
$$;

-- ---------------------------------------------------------------------------
-- 7. הפעלת דף נחיתה: בחלון חינם, או בתקופה ששולמה, או plan_required
-- ---------------------------------------------------------------------------
create or replace function public.project_activate_page(p_project_id uuid, p_developer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free_until timestamptz;
  v_paid_until timestamptz;
  v_until      timestamptz;
begin
  if not exists (select 1 from public.projects
                  where id = p_project_id and developer_id = p_developer_id) then
    return jsonb_build_object('error', 'not_your_project');
  end if;

  select free_until, plan_paid_until into v_free_until, v_paid_until
    from public.developers where id = p_developer_id;

  -- הפרויקט באוויר עד המאוחר מבין סוף החלון החינמי לסוף התקופה ששולמה, ובלי חיוב.
  -- אחרי שניהם: plan_required (המשתמש/ת פותח/ת מסלול)
  v_until := greatest(coalesce(v_free_until, now()), coalesce(v_paid_until, now()));
  if v_until > now() then
    update public.projects
       set subscription_status = 'active',
           subscription_started_at = coalesce(subscription_started_at, now()),
           subscription_expires_at = greatest(coalesce(subscription_expires_at, v_until), v_until),
           status = case when status = 'draft' then 'active' else status end
     where id = p_project_id;
    return jsonb_build_object('success', true, 'price_charged', 0,
                              'free', coalesce(v_free_until > now(), false),
                              'expires_at', v_until);
  end if;

  return jsonb_build_object('error', 'plan_required', 'free_until', v_free_until,
                            'plan_paid_until', v_paid_until);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. הטריגר - מקור האמת היחיד למצב מנוי המסלול. אותו מבנה של מסלולי הסוכנים
-- ---------------------------------------------------------------------------
create or replace function public.developer_plan_orders_sync_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.billing_subscriptions;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'success' then
    -- ‏period_end מההזמנה ולא מ-developers: ההזמנה מתעדכנת (והטריגר רץ) לפני
    -- שהמסלול מתעדכן, ולכן ב-developers עוד יושב הערך הקודם
    if new.subscription_id is not null then
      update public.billing_subscriptions
         set failed_attempts = 0, first_failed_at = null, next_retry_at = null,
             charging_order_id = null, next_charge_on = (new.period_end - interval '1 day')::date,
             last_error = null, updated_at = now()
       where id = new.subscription_id;
    elsif new.auto_renew then
      insert into public.billing_subscriptions
        (kind, developer_id, contact_email, status, next_charge_on)
      values ('developer_plan', new.developer_id, new.contact_email, 'active',
              (new.period_end - interval '1 day')::date)
      on conflict (developer_id) where developer_id is not null do update
        set status            = 'active',
            contact_email     = coalesce(excluded.contact_email, public.billing_subscriptions.contact_email),
            next_charge_on    = excluded.next_charge_on,
            failed_attempts   = 0,
            first_failed_at   = null,
            next_retry_at     = null,
            charging_order_id = null,
            cancelled_at      = null,
            last_error        = null,
            card_token        = null,
            updated_at        = now();
    else
      -- רכישה בלי חידוש מבטלת מנוי קיים: בחירה מפורשת לשלם פעם אחת
      update public.billing_subscriptions
         set status = 'cancelled', cancelled_at = now(), next_retry_at = null, updated_at = now()
       where developer_id = new.developer_id and status = 'active';
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

drop trigger if exists developer_plan_orders_sync_subscription on public.developer_plan_orders;
create trigger developer_plan_orders_sync_subscription
  after update of status on public.developer_plan_orders
  for each row execute function public.developer_plan_orders_sync_subscription();

-- ---------------------------------------------------------------------------
-- 9. מנויי המסלול שהגיע זמנם: המסלול והסכום מחושבים מחדש לפי הפרויקטים החיים
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_developer_plan_renewals(p_limit int default 20)
returns table (
  subscription_id uuid,
  order_id        uuid,
  developer_id    uuid,
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
  v_quote jsonb;
  r       record;
  v_order uuid;
begin
  select value into v_on from public.pricing_config where key = 'recurring_charging_enabled';
  if coalesce(v_on, 0) <> 1 then
    return;
  end if;

  for r in
    select s.*, d.name as d_name
      from public.billing_subscriptions s
      join public.developers d on d.id = s.developer_id
     where s.kind = 'developer_plan'
       and s.status = 'active'
       and s.charging_order_id is null
       and d.status = 'active'
       and (
             (s.failed_attempts = 0 and s.next_charge_on <= current_date)
          or (s.failed_attempts > 0 and s.next_retry_at <= now())
           )
     order by s.next_charge_on
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update of s skip locked
  loop
    v_quote := public.developer_plan_quote(r.developer_id);
    if v_quote ? 'error' then
      continue;
    end if;

    -- בלי פרויקט חי אין על מה לגבות: המנוי מתבטל במקום לחייב על שום דבר.
    -- חזרה למסלול היא רכישה חדשה
    if (v_quote->>'projects_count')::int < 1 then
      update public.billing_subscriptions
         set status = 'cancelled', cancelled_at = now(), next_retry_at = null,
             last_error = 'no_live_projects', notice_order_id = null, updated_at = now()
       where id = r.id;
      continue;
    end if;

    insert into public.developer_plan_orders
      (developer_id, tier, projects_count, amount, amount_before_vat, vat_rate, status,
       provider, auto_renew, subscription_id, contact_email)
    values
      (r.developer_id, v_quote->>'tier', (v_quote->>'projects_count')::int,
       (v_quote->>'amount')::numeric, (v_quote->>'amount_before_vat')::numeric,
       (v_quote->>'vat_rate')::numeric, 'pending', 'morning_token', true, r.id, r.contact_email)
    returning id into v_order;

    update public.billing_subscriptions
       set charging_order_id = v_order, notice_order_id = v_order, updated_at = now()
     where id = r.id;

    subscription_id := r.id;
    order_id        := v_order;
    developer_id    := r.developer_id;
    tier            := v_quote->>'tier';
    amount          := (v_quote->>'amount')::numeric;
    card_token      := r.card_token;
    contact_email   := r.contact_email;
    display_name    := r.d_name;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. ביטול והפעלה מחדש. נקרא מ-project-manage אחרי שהבעלות נבדקה לפי ה-JWT
--
-- ביטול אינו מחזיר כסף ואינו מוריד פרויקט: הם נשארים עד plan_paid_until.
-- הפעלה מחדש רק כשיש כרטיס שמור ולא אחרי שלושה כישלונות.
-- ---------------------------------------------------------------------------
create or replace function public.set_developer_plan_auto_renew(p_developer_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.billing_subscriptions;
begin
  select * into v_sub from public.billing_subscriptions
   where kind = 'developer_plan' and developer_id = p_developer_id for update;
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
-- 11. מצב המסלול לדשבורד: מה שולם, מה הבא, וכמה ייגבה
-- ---------------------------------------------------------------------------
create or replace function public.developer_plan_state(p_developer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dev   public.developers;
  v_sub   public.billing_subscriptions;
  v_quote jsonb;
begin
  select * into v_dev from public.developers where id = p_developer_id;
  if not found then
    return jsonb_build_object('error', 'developer_not_found');
  end if;
  select * into v_sub from public.billing_subscriptions
   where kind = 'developer_plan' and developer_id = p_developer_id;
  v_quote := public.developer_plan_quote(p_developer_id);

  return jsonb_build_object(
    'free_until',      v_dev.free_until,
    'in_free_window',  v_dev.free_until > now(),
    -- אפשר לבחור מסלול רק ב-30 הימים האחרונים של החלון (start_developer_plan_order)
    'can_start',       v_dev.free_until <= now() + interval '30 days',
    'plan_paid_until', v_dev.plan_paid_until,
    'subscription',    case when v_sub.id is null then null else jsonb_build_object(
                         'status', v_sub.status,
                         'next_charge_on', v_sub.next_charge_on,
                         'failed_attempts', v_sub.failed_attempts,
                         'cancelled_at', v_sub.cancelled_at) end,
    'quote',           v_quote);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. הרשאות: הכול service_role בלבד. הדפדפן עובר דרך project-manage
-- ---------------------------------------------------------------------------
revoke all on function public.developer_plan_quote(uuid) from public, anon, authenticated;
grant execute on function public.developer_plan_quote(uuid) to service_role;

revoke all on function public.start_developer_plan_order(uuid) from public, anon, authenticated;
grant execute on function public.start_developer_plan_order(uuid) to service_role;

revoke all on function public.complete_developer_plan_order(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_developer_plan_order(uuid, numeric, text, text, text) to service_role;

revoke all on function public.fail_developer_plan_order(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_developer_plan_order(uuid, text) to service_role;

revoke all on function public.project_activate_page(uuid, uuid) from public, anon, authenticated;
grant execute on function public.project_activate_page(uuid, uuid) to service_role;

revoke all on function public.developer_plan_orders_sync_subscription() from public, anon, authenticated;

revoke all on function public.claim_due_developer_plan_renewals(int) from public, anon, authenticated;
grant execute on function public.claim_due_developer_plan_renewals(int) to service_role;

revoke all on function public.set_developer_plan_auto_renew(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_developer_plan_auto_renew(uuid, boolean) to service_role;

revoke all on function public.developer_plan_state(uuid) from public, anon, authenticated;
grant execute on function public.developer_plan_state(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 13. ה-reconcile רואה גם את הטבלה השביעית
--
-- זהה ל-20271108120000 פרט לשורה הנוספת בתנאי, ועל אותו לוח זמנים מפוזר
-- (20271120120000). בלעדיה הזמנת מסלול ששולמה וה-webhook שלה אבד הייתה מחכה לטעינת
-- ארנק של מישהו אחר.
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

  perform cron.schedule('wallet-topup-reconcile', '4-59/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (select 1 from public.wallet_topups          where status = 'pending')
       or exists (select 1 from public.subscription_orders    where status = 'pending')
       or exists (select 1 from public.ad_orders              where status = 'pending')
       or exists (select 1 from public.developer_topups       where status = 'pending')
       or exists (select 1 from public.course_orders          where status = 'pending')
       or exists (select 1 from public.lawyer_lead_orders     where status = 'pending')
       or exists (select 1 from public.lawyer_lead_orders     where status = 'refund_needed' and refund_alerted_at is null)
       or exists (select 1 from public.developer_plan_orders  where status = 'pending');
  $cron$, v_base || 'wallet-topup-callback?mode=reconcile'));
end;
$$;

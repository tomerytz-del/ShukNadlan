-- ============================================================================
-- ארנק היזמים: סליקה אמיתית, וטעינת בדיקה למנהל/ת פלטפורמה בלבד
-- ----------------------------------------------------------------------------
-- עד היום `project-manage` (action "topup") זיכה/תה את ארנק היזם/ית **בלי
-- שום תשלום**: שורת developer_topups עם status='paid' ו-test_mode=true, ועד
-- ‏₪5,000 ללחיצה, בלי מגבלת לחיצות. מהארנק הזה יורדים דף נחיתה (‏₪350 לחודש),
-- קידומים ולידים — כלומר כל יזם/ית רשום/ה יכול/ה היה/הייתה לקבל אותם בחינם.
-- בבדיקה ב-24.9.2026 עוד לא נוצלה אף טעינה כזו (0 שורות, 0 יתרה).
--
-- המיגרציה הזו מחברת את הארנק לאותה מכונת מצבים של ארנק הסוכנים: שורה
-- pending, טופס תשלום במורנינג, ‏wallet-topup-callback מאמת/ת מול מסמך ה-320,
-- ורק אז complete_developer_topup מזכה. ראו docs/wallet-payments.md.
--
-- ## טעינה בלי חיוב — מנהל/ת פלטפורמה בלבד
--
-- ‏admin_test_developer_topup מקבלת את מזהה המנהל/ת ובודקת בעצמה
-- ‏is_platform_admin, גם אם הקורא (Edge Function) כבר בדק. השורה נשמרת עם
-- ‏test_mode=true ועם credited_by, כך שכל שקל שלא שולם ניתן לייחוס.
--
-- ## גם: ה-reconcile לא ראה את כרטיסיות בעלי המקצוע
--
-- תנאי ה-cron של wallet-topup-reconcile (‏20261021090000) בדק רק
-- ‏wallet_topups ו-subscription_orders. הזמנת ad_orders שה-webhook שלה אבד
-- לא הייתה מתיישבת לעולם — אלא אם במקרה הייתה באותו רגע טעינת ארנק פתוחה.
-- התנאי כאן כולל את ארבע הטבלאות.
--
-- אידמפוטנטית: if not exists, create or replace, בדיקת constraint לפני שינוי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות שחסרו למסלול תשלום אמיתי
-- ---------------------------------------------------------------------------
alter table public.developer_topups
  add column if not exists provider_form_id     text,
  add column if not exists provider_payment_url text,
  add column if not exists provider_document_id text,
  add column if not exists provider_pdf_url     text,
  add column if not exists completed_at         timestamptz,
  add column if not exists failure_reason       text,
  add column if not exists credited_by          uuid references public.agency_members(id);

comment on column public.developer_topups.credited_by is
  'מנהל/ת הפלטפורמה שביצע/ה טעינת בדיקה (test_mode). ריק בטעינה ששולמה.';

-- ברירות המחדל הישנות היו 'paid' ו-true — כלומר שורה שנוספה בלי לציין
-- אחרת הייתה נחשבת טעינה ששולמה. מעכשיו ברירת המחדל היא "לא שולם, לא בדיקה".
alter table public.developer_topups alter column status    set default 'pending';
alter table public.developer_topups alter column test_mode set default false;

create unique index if not exists developer_topups_provider_charge_uniq
  on public.developer_topups (provider, provider_charge_id)
  where provider_charge_id is not null;

create index if not exists developer_topups_pending_idx
  on public.developer_topups (status, created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. פאזה 1 — פתיחת הטעינה
-- ---------------------------------------------------------------------------
create or replace function public.start_developer_topup(p_developer_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_open int;
begin
  if not exists (select 1 from public.developers where id = p_developer_id and status = 'active') then
    return jsonb_build_object('error', 'developer_inactive');
  end if;
  -- אותם סכומים שהמסך מציע; הבדיקה המדויקת היא ב-Edge Function, וכאן גבול.
  if p_amount is null or p_amount < 100 or p_amount > 5000 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  select count(*) into v_open from public.developer_topups
   where developer_id = p_developer_id and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_topups');
  end if;

  insert into public.developer_topups (developer_id, amount, status, test_mode, provider)
  values (p_developer_id, p_amount, 'pending', false, 'morning')
  returning id into v_id;

  return jsonb_build_object('success', true, 'topup_id', v_id, 'amount', p_amount);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. פאזה 2 — הזיכוי
--
-- **הפונקציה היחידה שמזכה ארנק יזם/ית בעקבות תשלום.** אותן שלוש הגנות של
-- ‏complete_wallet_topup: נעילת שורה, בדיקת סטטוס, והשוואת סכום מול מה
-- שאנחנו רשמנו. הזיכוי הוא `credit_balance + amount` בפקודה אחת — הקוד הקודם
-- קרא את היתרה ואז כתב, ושתי טעינות במקביל היו מוחקות אחת את השנייה.
-- שמות הפרמטרים זהים לשלוש המכונות האחרות, כי wallet-topup-callback קורא
-- לכולן באותו קוד.
-- ---------------------------------------------------------------------------
create or replace function public.complete_developer_topup(
  p_topup_id           uuid,
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
  v_row     public.developer_topups;
  v_balance numeric;
begin
  select * into v_row from public.developer_topups where id = p_topup_id for update;
  if not found then
    return jsonb_build_object('error', 'topup_not_found');
  end if;
  if v_row.status = 'paid' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('error', 'topup_not_pending', 'status', v_row.status);
  end if;

  if p_verified_amount is not null and p_verified_amount <> v_row.amount then
    update public.developer_topups
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_row.amount, p_verified_amount)
     where id = p_topup_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_row.amount, 'reported', p_verified_amount);
  end if;

  update public.developer_topups
     set status               = 'paid',
         completed_at         = now(),
         provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
         provider_document_id = coalesce(p_document_id, provider_document_id),
         provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url),
         failure_reason       = null
   where id = p_topup_id;

  update public.developers
     set credit_balance = credit_balance + v_row.amount
   where id = v_row.developer_id
  returning credit_balance into v_balance;

  return jsonb_build_object('success', true, 'developer_id', v_row.developer_id,
                            'amount', v_row.amount, 'credit_balance', v_balance);
end;
$$;

create or replace function public.fail_developer_topup(p_topup_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.developer_topups
     set status = 'failed', failure_reason = left(coalesce(p_reason, ''), 300)
   where id = p_topup_id and status = 'pending';
  return jsonb_build_object('success', found);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. טעינת בדיקה — מנהל/ת פלטפורמה בלבד
--
-- הבדיקה כאן ולא רק ב-Edge Function: הפונקציה מזכה כסף בלי תשלום, ולכן היא
-- לא סומכת על כך שהקורא בדק. מזהה המנהל/ת נשמר על השורה.
-- ---------------------------------------------------------------------------
create or replace function public.admin_test_developer_topup(
  p_developer_id   uuid,
  p_amount         numeric,
  p_admin_agent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
begin
  if not exists (select 1 from public.agency_members
                  where id = p_admin_agent_id and is_platform_admin and active) then
    return jsonb_build_object('error', 'not_platform_admin');
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 5000 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  insert into public.developer_topups
    (developer_id, amount, status, test_mode, provider, credited_by, completed_at)
  values (p_developer_id, p_amount, 'paid', true, 'admin_test', p_admin_agent_id, now());

  update public.developers
     set credit_balance = credit_balance + p_amount
   where id = p_developer_id
  returning credit_balance into v_balance;

  if v_balance is null then
    raise exception 'developer_not_found';
  end if;

  return jsonb_build_object('success', true, 'test_mode', true, 'credit_balance', v_balance);
end;
$$;

revoke all on function public.start_developer_topup(uuid, numeric) from public, anon, authenticated;
grant execute on function public.start_developer_topup(uuid, numeric) to service_role;

revoke all on function public.complete_developer_topup(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_developer_topup(uuid, numeric, text, text, text) to service_role;

revoke all on function public.fail_developer_topup(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_developer_topup(uuid, text) to service_role;

revoke all on function public.admin_test_developer_topup(uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.admin_test_developer_topup(uuid, numeric, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. ה-reconcile רואה את כל ארבע הטבלאות
--
-- זהה ל-20261021090000 פרט לתנאי. superset כמו שם: רק "יש שורה פתוחה".
-- ---------------------------------------------------------------------------
do $$
declare
  v_base text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — אין מה לתזמן מחדש';
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
       or exists (select 1 from public.developer_topups    where status = 'pending');
  $cron$, v_base || 'wallet-topup-callback?mode=reconcile'));
end;
$$;

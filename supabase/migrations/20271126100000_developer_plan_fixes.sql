-- ============================================================================
-- תיקוני סקירה למסלול החשבון של היזמים (20271123090000)
--
-- 1. ‏`developer_plan_orders.auto_renew` נולדה עם ברירת מחדל `true`. הרכישה כותבת את בחירת
--    המשתמש/ת בעדכון נפרד אחרי פתיחת ההזמנה, וכישלון בעדכון הזה השאיר את ההזמנה על `true`:
--    תשלום חד-פעמי פתח מנוי מתחדש בלי הסכמה (תקנון §25). עכשיו ברירת המחדל היא `false`;
--    הזמנת חידוש (claim_due_developer_plan_renewals) כותבת `true` במפורש ולכן אינה מושפעת.
-- 2. ‏`set_developer_plan_auto_renew(on = true)` החזירה מנוי ל-`active` בלי לאפס כישלונות ובלי
--    תאריך חיוב: מנוי עם `failed_attempts > 0` ו-`next_retry_at` ריק אינו מתאים לאף אחד מתנאי
--    ה-claim, ונשאר "פעיל" בלי שאיש יחייב אותו. עכשיו ההפעלה מחדש מאפסת כישלונות ומחשבת את
--    החיוב הבא מסוף התקופה ששולמה.
--
-- אידמפוטנטית.
-- ============================================================================

alter table public.developer_plan_orders alter column auto_renew set default false;

create or replace function public.set_developer_plan_auto_renew(p_developer_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub  public.billing_subscriptions;
  v_paid timestamptz;
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

  select plan_paid_until into v_paid from public.developers where id = p_developer_id;

  -- איפוס מלא: אחרת מנוי עם כישלונות קודמים אינו מתאים לאף תנאי של ה-claim
  update public.billing_subscriptions
     set status = 'active', cancelled_at = null,
         failed_attempts = 0, first_failed_at = null, next_retry_at = null, last_error = null,
         next_charge_on = greatest(current_date, (coalesce(v_paid, now()) - interval '1 day')::date),
         updated_at = now()
   where id = v_sub.id;
  return jsonb_build_object('success', true, 'status', 'active');
end;
$$;

revoke all on function public.set_developer_plan_auto_renew(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_developer_plan_auto_renew(uuid, boolean) to service_role;

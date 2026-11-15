-- ============================================================================
-- הארכה: ניסיון חוזר אחרי תשלום שננטש, בלי לפתוח פתח לשתי הארכות
--
-- הבעיה (15.11.2026, בבדיקה הראשונה): לחיצה על "לתשלום מאובטח" פותחת הזמנת הארכה
-- ב-`pending`, והמשתמש/ת שסגר/ה את עמוד התשלום בלי לשלם נחסם/ה ל-3 שעות
-- (`extension_not_available` / `extension_pending`), כי החסם מ-20271115180000 היה
-- "הזמנת הארכה אחת בהמתנה בשלוש השעות האחרונות". חסם כזה נועד נגד שתי הארכות
-- (שתי הזמנות ששולמו, כל אחת מוסיפה 4 חודשים), אבל פוגע במי שפשוט ניסה שוב.
--
-- התיקון: שתי שכבות, במקום חסם אחד גס.
--   1. פתיחה: חלון ההמתנה מתקצר ל-15 דקות (תשלום שנפתח ולא הושלם תוך רבע שעה
--      נחשב נטוש; עמוד התשלום של מורנינג מושלם בדקות).
--   2. **השלמה (`complete_course_order`): הזמנת הארכה שלא הצליחה להיות הראשונה לא
--      פותחת גישה.** אם כבר הושלמה הארכה אחרת למשתמש/ת, ההזמנה הזו נכשלת עם
--      `extension_already_used` ו-`failure_reason`, והכסף שנגבה מחזיר ידנית
--      (docs/exam-course.md: החזר ידני במורנינג). זה המקום שמבטיח "פעם אחת",
--      בלי להסתמך על שעון.
-- ============================================================================

create or replace function public.start_course_order(p_user_id uuid, p_email text, p_kind text default 'full')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price jsonb;
  v_chk   jsonb;
  v_id    uuid;
  v_open  int;
  v_kind  text := coalesce(p_kind, 'full');
begin
  if p_user_id is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  if v_kind not in ('full', 'extension') then
    return jsonb_build_object('error', 'unknown_kind');
  end if;

  if v_kind = 'extension' then
    perform pg_advisory_xact_lock(hashtext('course_extension:' || p_user_id::text));
    v_chk := public.course_extension_check(p_user_id);
    if coalesce((v_chk->>'available')::boolean, false) is not true then
      return jsonb_build_object('error', 'extension_not_available', 'reason', v_chk->>'reason');
    end if;
    -- ניסיון פתוח ממש עכשיו (15 דקות): מחכים. אחרי כן הוא נחשב נטוש וניתן לנסות שוב;
    -- שתי הארכות ששולמו נחסמות בהשלמה (complete_course_order).
    if exists (select 1 from public.course_orders
                where user_id = p_user_id and kind = 'extension' and status = 'pending'
                  and created_at > now() - interval '15 minutes') then
      return jsonb_build_object('error', 'extension_not_available', 'reason', 'extension_pending');
    end if;
  end if;

  v_price := public.course_price(v_kind);
  if v_price ? 'error' then return v_price; end if;

  select count(*) into v_open from public.course_orders
   where user_id = p_user_id and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_orders');
  end if;

  insert into public.course_orders
    (user_id, email, months, amount, amount_before_vat, vat_rate, status, provider, kind)
  values
    (p_user_id, left(coalesce(p_email, ''), 200), (v_price->>'months')::int,
     (v_price->>'amount')::numeric,
     (v_price->>'amount_before_vat')::numeric,
     (v_price->>'vat_rate')::numeric,
     'pending', 'morning', v_kind)
  returning id into v_id;

  return jsonb_build_object('success', true, 'order_id', v_id,
                            'amount', (v_price->>'amount')::numeric,
                            'months', (v_price->>'months')::int,
                            'kind', v_kind);
end;
$$;
revoke all on function public.start_course_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_course_order(uuid, text, text) to service_role;

-- ההשלמה: אותה פונקציה כמו ב-20271106110000, עם תוספת אחת: הארכה שנייה אינה נפתחת.
create or replace function public.complete_course_order(
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
  v_order public.course_orders;
  v_from  timestamptz;
  v_to    timestamptz;
begin
  select * into v_order from public.course_orders where id = p_order_id for update;
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
    update public.course_orders
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_order.amount, p_verified_amount)
     where id = p_order_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_order.amount, 'reported', p_verified_amount);
  end if;

  -- "פעם אחת": הארכה שנייה ששולמה אינה מאריכה. הכסף נגבה ולכן ההזמנה נרשמת ככישלון עם סיבה
  -- ברורה, והחזר ידני במורנינג (אחרת ההארכה הייתה מתווספת פעמיים).
  if v_order.kind = 'extension' and exists (
       select 1 from public.course_orders
        where user_id = v_order.user_id and kind = 'extension'
          and status = 'success' and id <> p_order_id) then
    update public.course_orders
       set status = 'failed',
           failure_reason = 'extension_already_used: paid, needs a manual refund',
           provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
           provider_document_id = coalesce(p_document_id, provider_document_id),
           provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url)
     where id = p_order_id;
    return jsonb_build_object('error', 'extension_already_used');
  end if;

  select case when expires_at > now() then expires_at else now() end
    into v_from
    from public.course_enrollments where user_id = v_order.user_id;
  v_from := coalesce(v_from, now());
  v_to := v_from + (v_order.months || ' months')::interval;

  insert into public.course_enrollments (user_id, email, starts_at, expires_at, test_mode)
  values (v_order.user_id, v_order.email, now(), v_to, false)
  on conflict (user_id) do update
    set expires_at = excluded.expires_at,
        email      = coalesce(excluded.email, public.course_enrollments.email),
        test_mode  = false,
        updated_at = now();

  update public.course_orders
     set status               = 'success',
         completed_at         = now(),
         provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
         provider_document_id = coalesce(p_document_id, provider_document_id),
         provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url),
         period_start         = v_from,
         period_end           = v_to
   where id = p_order_id;

  return jsonb_build_object('success', true, 'user_id', v_order.user_id,
                            'period_start', v_from, 'period_end', v_to);
end;
$$;
revoke all on function public.complete_course_order(uuid, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_course_order(uuid, numeric, text, text, text) to service_role;

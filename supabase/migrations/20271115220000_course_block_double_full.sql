-- ============================================================================
-- קורס מלא שני נחסם למי שכבר רכש/ה והגישה בתוקף
--
-- 15.11.2026: מסך תשלום שנפתח בלי ההקשר של ההארכה חייב ₪450 שוב, במקום ₪99. השרת חוסם
-- הזמנת `full` ממי שיש לו/ה הזמנת `full` ששולמה וגישה בתוקף, ומחזיר `already_enrolled`.
-- מי שהגישה שלו/ה פגה רוכש/ת שוב כרגיל. שאר הגוף זהה ל-20271115200000.
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

  if v_kind = 'full' and exists (
       select 1 from public.course_enrollments e
        where e.user_id = p_user_id and e.test_mode = false and e.expires_at > now())
     and exists (select 1 from public.course_orders
                  where user_id = p_user_id and kind = 'full' and status = 'success' and test_mode = false) then
    -- בעל/ת גישה בתוקף שרכש/ה בתשלום: קורס מלא שני הוא חיוב כפול בטעות (15.11.2026). ההארכה היא הדרך.
    return jsonb_build_object('error', 'already_enrolled');
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

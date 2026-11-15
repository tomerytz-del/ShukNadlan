-- ============================================================================
-- קורס ההכנה: 4 חודשי גישה, והארכה של 4 חודשים ב-₪99
--
-- החלטת תומר (15.11.2026): הגישה הראשונה היא ארבעה חודשים (₪450 כולל מע״מ, ראו
-- 20271115170000), ומי שלא עבר את הבחינה מאריך בעוד ארבעה חודשים ב-₪99 כולל מע״מ.
--
-- **אין לנו דרך לדעת מי נכשל**, ולכן ההארכה מבוססת אמון, עם שלושה חסמים נגד ניצול:
--   1. רק מי שרכש/ה בתשלום את הקורס המלא (הזמנה `full` ב-`success`, לא `test_mode`).
--      בלי זה ₪99 ל-4 חודשים הופך לדרך לעקוף את ₪450.
--   2. פעם אחת בלבד לכל לומד/ת.
--   3. חלון: מ-30 יום לפני סוף הגישה ועד 60 יום אחריו.
-- ההארכה מתווספת לסוף התקופה הקיימת (`complete_course_order` כבר עושה זאת).
-- ביטול: בתוך 14 יום כל עוד תקופת ההארכה טרם החלה (בקשה במייל, כמו הקורס עצמו).
--
-- הסכום הכולל מע״מ, כמו המחיר הראשי: `course_price` גוזרת ממנו את `amount_before_vat`.
-- ============================================================================

insert into public.pricing_config (key, value, description) values
  ('course_extension_price_gross', 99,
   'קורס ההכנה: מחיר הארכה (כולל מע״מ) למי שרכש/ה את הקורס המלא. פעם אחת, בחלון שסביב סוף הגישה. docs/exam-course.md'),
  ('course_extension_months', 4,
   'קורס ההכנה: כמה חודשי גישה מוסיפה ההארכה.')
on conflict (key) do nothing;

update public.pricing_config set value = 4 where key = 'course_access_months';

-- סוג ההזמנה. ברירת המחדל full, ולכן שורות קיימות (אין כאלה בפרודקשן) לא משתנות.
alter table public.course_orders add column if not exists kind text not null default 'full';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'course_orders_kind_check') then
    alter table public.course_orders
      add constraint course_orders_kind_check check (kind in ('full', 'extension'));
  end if;
end $$;

-- המחיר לפי סוג. הפונקציה בלי פרמטר (course_price()) נשארת כמות שהיא ומחזירה full.
create or replace function public.course_price(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gross  numeric;
  v_vat    numeric;
  v_months int;
begin
  if p_kind = 'extension' then
    select value into v_gross from public.pricing_config where key = 'course_extension_price_gross';
    select value::int into v_months from public.pricing_config where key = 'course_extension_months';
    v_months := coalesce(v_months, 4);
  elsif p_kind = 'full' then
    select value into v_gross from public.pricing_config where key = 'course_price_gross';
    select value::int into v_months from public.pricing_config where key = 'course_access_months';
    v_months := coalesce(v_months, 4);
  else
    return jsonb_build_object('error', 'unknown_kind');
  end if;
  if v_gross is null then
    return jsonb_build_object('error', 'price_not_configured');
  end if;
  select value into v_vat from public.pricing_config where key = 'vat_rate';
  v_vat := coalesce(v_vat, 0.18);

  return jsonb_build_object(
    'amount', v_gross,
    'amount_before_vat', round(v_gross / (1 + v_vat), 2),
    'vat_rate', v_vat,
    'months', v_months
  );
end;
$$;
revoke all on function public.course_price(text) from public, anon, authenticated;
grant execute on function public.course_price(text) to service_role;

-- זכאות להארכה. מקור האמת היחיד: גם ההצעה בנגן וגם פתיחת ההזמנה קוראות לה.
create or replace function public.course_extension_check(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enr public.course_enrollments;
begin
  if p_user_id is null then return jsonb_build_object('available', false, 'reason', 'unauthorized'); end if;
  select * into v_enr from public.course_enrollments where user_id = p_user_id;
  if not found or v_enr.test_mode then
    return jsonb_build_object('available', false, 'reason', 'no_paid_course');
  end if;
  if not exists (select 1 from public.course_orders
                  where user_id = p_user_id and kind = 'full'
                    and status = 'success' and test_mode = false) then
    return jsonb_build_object('available', false, 'reason', 'no_paid_course');
  end if;
  if exists (select 1 from public.course_orders
              where user_id = p_user_id and kind = 'extension' and status = 'success') then
    return jsonb_build_object('available', false, 'reason', 'already_extended');
  end if;
  if now() < v_enr.expires_at - interval '30 days' then
    return jsonb_build_object('available', false, 'reason', 'too_early', 'opens_at', v_enr.expires_at - interval '30 days');
  end if;
  if now() > v_enr.expires_at + interval '60 days' then
    return jsonb_build_object('available', false, 'reason', 'too_late');
  end if;
  return jsonb_build_object('available', true, 'expires_at', v_enr.expires_at);
end;
$$;
revoke all on function public.course_extension_check(uuid) from public, anon, authenticated;
grant execute on function public.course_extension_check(uuid) to service_role;

-- מה שהנגן שואל: האם מציעים לי הארכה, ובכמה. עוטפת את הבדיקה עם auth.uid().
create or replace function public.course_extension_offer()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_chk   jsonb;
  v_price jsonb;
begin
  v_chk := public.course_extension_check(auth.uid());
  if coalesce((v_chk->>'available')::boolean, false) is not true then return v_chk; end if;
  v_price := public.course_price('extension');
  if v_price ? 'error' then return jsonb_build_object('available', false, 'reason', 'price_not_configured'); end if;
  return v_chk || jsonb_build_object('amount', (v_price->>'amount')::numeric,
                                     'months', (v_price->>'months')::int);
end;
$$;
revoke all on function public.course_extension_offer() from public, anon;
grant execute on function public.course_extension_offer() to authenticated, service_role;

-- פתיחת ההזמנה מקבלת סוג. הגרסה הישנה (שני פרמטרים) יורדת: שתיהן יחד היו
-- הופכות קריאה בשני פרמטרים לעמומה.
drop function if exists public.start_course_order(uuid, text);
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
    -- נעילה לכל משתמש/ת: שתי לשוניות במקביל לא יפתחו שתי הזמנות הארכה
    perform pg_advisory_xact_lock(hashtext('course_extension:' || p_user_id::text));
    v_chk := public.course_extension_check(p_user_id);
    if coalesce((v_chk->>'available')::boolean, false) is not true then
      return jsonb_build_object('error', 'extension_not_available', 'reason', v_chk->>'reason');
    end if;
    -- הזמנת הארכה אחת בהמתנה בכל רגע: אחרת שתיהן היו משולמות, וכל אחת מוסיפה 4 חודשים
    if exists (select 1 from public.course_orders
                where user_id = p_user_id and kind = 'extension' and status = 'pending'
                  and created_at > now() - interval '3 hours') then
      return jsonb_build_object('error', 'extension_not_available', 'reason', 'extension_pending');
    end if;
  end if;

  v_price := public.course_price(v_kind);
  if v_price ? 'error' then return v_price; end if;

  -- אותו חסם של ad_orders: לחיצות חוזרות אינן פותחות תור של pending
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

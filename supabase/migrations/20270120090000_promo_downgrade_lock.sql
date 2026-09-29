-- ===========================================================================
-- נעילת ירידת מסלול בתקופת הטבת ההצטרפות — במסד, ולא רק בדפדפן ובפונקציה
--
-- הכלל העסקי: סוכן/ת שקיבל/ה את הטבת ההצטרפות (6 חודשים של המסלול המלא)
-- אינו/ה יכול/ה לרדת למסלול נמוך יותר עד תום ההטבה. אחרי התקופה המעבר בין
-- מסלולים חוזר להיות לפי המדיניות הרגילה.
--
-- עד היום הכלל נשמר בשתי שכבות: שער הבחירה ב-CRM (כפתורים נעולים) ו-
-- ‏`join-agency` (‏`promo_locked`). שתיהן עוקפות את המסד: מי שמגיע/ה ל-
-- ‏`record_tier_selection` מנתיב אחר — הזמנת מנוי בתשלום
-- (‏`complete_subscription_order` קוראת לה ישירות), או פונקציה עתידית —
-- היה יורד בלי שום בדיקה. לכן הכלל עובר לכאן:
--
--   1. ‏`record_tier_selection` מסרבת לירידה כשההטבה פעילה.
--   2. ‏`start_subscription_order` מסרבת לפתוח הזמנה למסלול נמוך מההטבה —
--      **לפני** התשלום, כדי שלא ייגבה כסף על שינוי שהמסד יסרב לו.
--
-- מה שנשאר פתוח בכוונה: ‏`admin_apply_tier_change` (מנהל/ת הפלטפורמה).
-- זו אינה בחירה של הסוכן/ת אלא החלטה של ההנהלה, והיא נרשמת ביומן.
-- ===========================================================================

-- דירוג המסלולים: free < mid < premium
create or replace function public.tier_rank(p_tier text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_tier when 'free' then 0 when 'mid' then 1 when 'premium' then 2 end;
$$;

revoke all on function public.tier_rank(text) from public, anon, authenticated;
grant execute on function public.tier_rank(text) to service_role;

create or replace function public.record_tier_selection(
  p_member_id uuid,
  p_tier      text,
  p_source    text default 'self',
  p_note      text default null
)
returns table (changed_member uuid, previous_tier text, new_tier text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.agency_members%rowtype;
begin
  if p_tier not in ('free', 'mid', 'premium') then
    raise exception 'invalid tier: %', p_tier;
  end if;

  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found then
    raise exception 'member not found: %', p_member_id;
  end if;

  -- בתקופת ההטבה אין ירידה ממסלול ההטבה
  if v_member.promo_ends_at is not null
     and v_member.promo_ended_at is null
     and v_member.promo_ends_at > now()
     and public.tier_rank(p_tier) < public.tier_rank(coalesce(v_member.promo_tier, 'premium')) then
    raise exception 'promo_locked: no downgrade until %', v_member.promo_ends_at
      using errcode = 'P0001';
  end if;

  update public.agency_members
     set tier             = p_tier,
         tier_selected_at = now(),
         tier_source      = p_source
   where id = p_member_id;

  insert into public.tier_changes (member_id, agency_id, from_tier, to_tier, source, note)
  values (p_member_id, v_member.agency_id, v_member.tier, p_tier, p_source, p_note);

  return query select p_member_id, v_member.tier, p_tier;
end;
$$;

revoke all on function public.record_tier_selection(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_tier_selection(uuid, text, text, text) to service_role;

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

  -- בתקופת ההטבה אין ירידה ממסלול ההטבה — וגם לא גבייה עליה
  if v_member.promo_ends_at is not null
     and v_member.promo_ended_at is null
     and v_member.promo_ends_at > now()
     and public.tier_rank(p_tier) < public.tier_rank(coalesce(v_member.promo_tier, 'premium')) then
    return jsonb_build_object('error', 'promo_locked', 'promo_ends_at', v_member.promo_ends_at);
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

revoke all on function public.start_subscription_order(uuid, text, int) from public, anon, authenticated;
grant execute on function public.start_subscription_order(uuid, text, int) to service_role;

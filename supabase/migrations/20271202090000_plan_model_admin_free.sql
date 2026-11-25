-- ============================================================================
-- סיור תלת-ממדי: מנהל/ת הפלטפורמה מעלה תוכניות בלי חיוב
--
-- תומר ביקש (25.11.2026) להעלות תוכניות מהחשבון שלו בלי חיוב, כדי לבדוק את קריאת
-- התוכנית על תוכניות אמיתיות בלי לטעון ארנק על כל ניסיון.
--
-- * **מי פטור:** סוכן/ת פעיל/ה עם `is_platform_admin`. לא לפי מייל ולא לפי מזהה קבוע:
--   אותו דגל שכל שאר המערכת בודקת (`current_is_platform_admin`). כאן הבדיקה היא לפי
--   מזהה הבעלים ולא לפי ה-JWT, כי `start_plan_model` נקראת מ-service_role.
-- * **רק ארנק הסוכן/ת.** חשבון יזם אינו פטור גם כשאותו אדם מחזיק בו.
-- * **אין שורת חיוב לדגם חינם** (`plan_model_charges.amount > 0`). `amount_charged = 0`
--   על הדגם, והחזר אחרי כישלון הוא 0: אין מה להחזיר.
-- * **הפטור כולל את דרישת המסלול**, כדי שהבדיקה לא תיעצר כשהמנוי של החשבון נגמר.
-- * המחיר ללקוחות לא משתנה: `pricing_config.plan_model_price` נשאר 49.
--
-- אידמפוטנטית: create or replace בלבד.
-- ============================================================================

create or replace function public.plan_model_free_for(p_owner_kind text, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: סוג בעלים null היה מחזיר null, ו-`not null` מדלג בשקט על בדיקת המסלול והיתרה
  select coalesce(p_owner_kind = 'agent', false) and exists (
    select 1 from public.agency_members
     where id = p_owner_id and is_platform_admin = true and active = true);
$$;

revoke all on function public.plan_model_free_for(text, uuid) from public, anon, authenticated;
grant execute on function public.plan_model_free_for(text, uuid) to service_role;

create or replace function public.start_plan_model(
  p_owner_kind text,
  p_owner_id   uuid,
  p_name       text,
  p_project_id uuid default null,
  p_mirror_of  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent    uuid := case when p_owner_kind = 'agent' then p_owner_id end;
  v_dev      uuid := case when p_owner_kind = 'developer' then p_owner_id end;
  v_price    numeric;
  v_included integer;
  v_balance  numeric;
  v_rows     integer;
  v_id       uuid;
  v_free     boolean;
begin
  if p_owner_kind is null or p_owner_kind not in ('agent', 'developer') then
    return jsonb_build_object('error', 'bad_owner_kind');
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    return jsonb_build_object('error', 'name_required');
  end if;

  v_free := public.plan_model_free_for(p_owner_kind, p_owner_id);

  if not v_free and not public.plan_model_eligible(p_owner_kind, p_owner_id) then
    return jsonb_build_object(
      'error', 'tier_required',
      'required_tier', case when p_owner_kind = 'agent' then 'premium' else null end,
      'detail', case when p_owner_kind = 'agent'
        then 'סיור תלת-ממדי זמין במסלול Elite.'
        else 'חשבון היזם אינו פעיל.' end);
  end if;

  -- הפרויקט והדגם המקורי חייבים להיות של אותו בעלים
  if p_project_id is not null then
    if p_owner_kind <> 'developer' or not exists (
      select 1 from public.projects where id = p_project_id and developer_id = p_owner_id) then
      return jsonb_build_object('error', 'not_your_project');
    end if;
  end if;
  if p_mirror_of is not null and not exists (
    select 1 from public.plan_models
     where id = p_mirror_of and status = 'ready'
       and agent_id is not distinct from v_agent
       and developer_id is not distinct from v_dev) then
    return jsonb_build_object('error', 'mirror_source_invalid');
  end if;

  v_price    := coalesce((select value from public.pricing_config where key = 'plan_model_price'), 49);
  v_included := coalesce((select value from public.pricing_config where key = 'plan_model_included_renders'), 20);

  -- מנהל/ת הפלטפורמה: בלי חיוב ובלי שורת חיוב. היתרה נקראת כדי שהקבלה תציג אותה, ולא משתנה
  if v_free then
    v_price := 0;
    select credit_balance into v_balance from public.agency_members where id = p_owner_id;
  -- הניכוי עצמו הוא התנאי (credit_balance >= מחיר), לא רק בדיקה לפניו
  elsif p_owner_kind = 'agent' then
    update public.agency_members
       set credit_balance = credit_balance - v_price
     where id = p_owner_id and credit_balance >= v_price
    returning credit_balance into v_balance;
    get diagnostics v_rows = row_count;
  else
    update public.developers
       set credit_balance = credit_balance - v_price
     where id = p_owner_id and credit_balance >= v_price
    returning credit_balance into v_balance;
    get diagnostics v_rows = row_count;
  end if;
  if not v_free and v_rows = 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'required', v_price);
  end if;

  insert into public.plan_models (
    owner_kind, agent_id, developer_id, project_id, name, mirrored_from,
    renders_included, amount_charged
  ) values (
    p_owner_kind, v_agent, v_dev,
    p_project_id, btrim(p_name), p_mirror_of, v_included, v_price
  ) returning id into v_id;

  -- plan_model_charges.amount > 0: דגם בלי חיוב אינו מקבל שורה, ו-fail_plan_model בלי שורה אינה מחזירה דבר
  if v_price > 0 then
    insert into public.plan_model_charges (model_id, owner_kind, agent_id, developer_id, amount)
    values (v_id, p_owner_kind, v_agent, v_dev, v_price);
  end if;

  return jsonb_build_object(
    'success', true, 'model_id', v_id, 'amount_charged', v_price,
    'renders_included', v_included, 'balance', v_balance);
end;
$$;

revoke all on function public.start_plan_model(text, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_plan_model(text, uuid, text, uuid, uuid) to service_role;

create or replace function public.plan_model_quote(p_owner_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_price    numeric;
  v_included integer;
  v_balance  numeric;
  v_free     boolean;
begin
  if p_owner_kind = 'agent' then
    v_id := public.current_agent_id();
    select credit_balance into v_balance from public.agency_members where id = v_id;
  elsif p_owner_kind = 'developer' then
    v_id := public.current_developer_id();
    select credit_balance into v_balance from public.developers where id = v_id;
  else
    return jsonb_build_object('error', 'bad_owner_kind');
  end if;
  if v_id is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  v_price    := coalesce((select value from public.pricing_config where key = 'plan_model_price'), 49);
  v_included := coalesce((select value from public.pricing_config where key = 'plan_model_included_renders'), 20);
  v_free     := public.plan_model_free_for(p_owner_kind, v_id);
  if v_free then v_price := 0; end if;

  return jsonb_build_object(
    'eligible', v_free or public.plan_model_eligible(p_owner_kind, v_id),
    'required_tier', case when p_owner_kind = 'agent' then 'premium' else null end,
    'price', v_price,
    'renders_included', v_included,
    'balance', coalesce(v_balance, 0));
end;
$$;

revoke all on function public.plan_model_quote(text) from public, anon;
grant execute on function public.plan_model_quote(text) to authenticated, service_role;

-- ===========================================================================
-- צוות ההטמעה: תיקון מייל בהזמנה (docs/csm-adoption.md, "הכניסה")
-- ---------------------------------------------------------------------------
-- מה היה שבור: הזמנה עם טעות במייל לא הייתה ניתנת לתיקון. השמירה עם המייל
-- הנכון יצרה שורה חדשה, והנייד (ייחודי, בשביל גבריאלה) כבר היה רשום על
-- השורה השגויה - ולכן נדחתה ב"הנייד הזה כבר רשום לאיש/אשת צוות אחר/ת".
-- גם השבתת השורה השגויה לא עזרה: האינדקס על phone_e164 חל גם על מושבתות.
--
-- מה נכנס:
--   1. ‏csm_staff_save: כשהמייל חדש והנייד שייך להזמנה **שעוד לא נוצלה**
--      (user_id ריק) - מעדכנים את ההזמנה הזו (מייל, שם, הפעלה) במקום שורה
--      חדשה. זה בדיוק תרחיש תיקון הטעות. נייד של מי שכבר נכנס/ה - עדיין נדחה.
--   2. ‏csm_staff_update(id, ...): עריכה מפורשת מהשורה ב-CRM. המייל ניתן לשינוי
--      רק כל עוד לא נכנסה: אחרי הכניסה הזהות היא user_id, ושינוי המייל לא היה
--      משנה דבר מלבד לבלבל.
--
-- מנהל/ת פלטפורמה בלבד, כמו שאר csm_staff_*. המיגרציה אידמפוטנטית.
-- ===========================================================================

create or replace function public.csm_staff_save(p_email text, p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_id    uuid;
  v_other public.csm_staff%rowtype;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('error', 'invalid_email');
  end if;
  if v_phone is not null and exists (
      select 1 from public.agency_members m where m.phone_e164 = public.normalize_msisdn(v_phone)) then
    return jsonb_build_object('error', 'phone_is_agent');
  end if;

  -- מייל חדש, ונייד של הזמנה שעוד לא נוצלה = תיקון של אותה הזמנה
  if v_phone is not null and not exists (select 1 from public.csm_staff s where s.email = v_email) then
    select * into v_other from public.csm_staff s
     where s.phone_e164 = public.normalize_msisdn(v_phone);
    if found then
      if v_other.user_id is not null then
        return jsonb_build_object('error', 'phone_taken');
      end if;
      update public.csm_staff
         set email = v_email, display_name = coalesce(v_name, display_name), active = true
       where id = v_other.id;
      return jsonb_build_object('success', true, 'id', v_other.id, 'replaced_email', v_other.email);
    end if;
  end if;

  insert into public.csm_staff (email, display_name, phone, invited_by)
  values (v_email, v_name, v_phone, auth.uid())
  on conflict (email) do update
     set display_name = coalesce(excluded.display_name, public.csm_staff.display_name),
         phone = coalesce(excluded.phone, public.csm_staff.phone), active = true
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('error', 'phone_taken');
end;
$$;

revoke all on function public.csm_staff_save(text, text, text) from public, anon, authenticated;
grant execute on function public.csm_staff_save(text, text, text) to authenticated;

create or replace function public.csm_staff_update(p_id uuid, p_email text, p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.csm_staff%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_row from public.csm_staff where id = p_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('error', 'invalid_email');
  end if;
  if v_email <> v_row.email and v_row.user_id is not null then
    return jsonb_build_object('error', 'already_joined');
  end if;
  if v_phone is not null and exists (
      select 1 from public.agency_members m where m.phone_e164 = public.normalize_msisdn(v_phone)) then
    return jsonb_build_object('error', 'phone_is_agent');
  end if;
  update public.csm_staff
     set email = v_email,
         display_name = nullif(btrim(coalesce(p_name, '')), ''),
         phone = v_phone
   where id = p_id;
  return jsonb_build_object('success', true, 'id', p_id);
exception when unique_violation then
  -- המייל או הנייד כבר רשומים בשורה אחרת
  return jsonb_build_object('error', 'duplicate');
end;
$$;

revoke all on function public.csm_staff_update(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.csm_staff_update(uuid, text, text, text) to authenticated;

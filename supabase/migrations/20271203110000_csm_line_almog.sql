-- המספר 043762132 עובר לאלמוג (צוות ההטמעה), לפי בקשת תומר (26.11.2026).
--
-- המספר נוצר כקו הכלול במסלול של תומר (agent_phone_lines, monthly_price = 89,
-- included), ולכן _csm_phone_line_assign סירבה להעביר אותו (number_in_use) והוא
-- לא הופיע ב"העברת מספר קיים" - שם מופיעים רק מספרים של הפלטפורמה. כאן הוא מסומן
-- כמספר של הפלטפורמה ומועבר דרך אותה ליבה שהפאנל קורא לה: הקו של הסוכנים נכבה,
-- ושורה ב-csm_phone_lines נוצרת עם moved_from_line, כך ש"החזרה לסוכנים" בפאנל
-- מחזירה אותו. forward_to ריק = הנייד שלה מ-csm_staff.
--
-- אידמפוטנטית: אם המספר כבר אצלה (או שאין אשת צוות פעילה במייל הזה) - לא נוגעת.
do $$
declare
  v_staff uuid;
  v_res   jsonb;
begin
  select id into v_staff from public.csm_staff
   where lower(email) = 'almog7053@gmail.com' and active
   limit 1;
  if v_staff is null then
    raise notice 'csm_line_almog: no active staff row, skipped';
    return;
  end if;
  if exists (select 1 from public.csm_phone_lines where twilio_number = '+97243762132' and active) then
    raise notice 'csm_line_almog: already assigned, skipped';
    return;
  end if;

  update public.agent_phone_lines
     set monthly_price = null, included = false
   where twilio_number = '+97243762132' and active and coalesce(status, 'active') <> 'released';

  v_res := public._csm_phone_line_assign(v_staff, '+97243762132', null, null);
  if v_res ? 'error' then
    raise exception 'csm_line_almog: assign failed: %', v_res->>'error';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- מספרי מעקב: לאן לנתב, ומספר קיים של הסוכן/ת (docs/call-tracking.md)
--
-- ‏forward_to - לאן מגיעות השיחות. null = הנייד הרשום ב-agency_members. מספר של
-- המזכירות, של שותף/ה, או נייד שני.
--
-- ‏external_number - מספר שכבר יש לסוכן/ת (מספר וירטואלי אצל ספק אחר, קו של
-- המשרד) ושמפנה את השיחות אלינו. כל מספר כזה צריך מספר משלו אצלנו: שיחה
-- מופנית מגיעה ל-Twilio עם To = המספר שלנו, ורק לפיו אפשר לדעת מאיזה ערוץ
-- היא הגיעה. השדה נשמר לתצוגה ולהוראות ההפניה.
-- ---------------------------------------------------------------------------

alter table public.agent_phone_lines add column if not exists external_number text;

-- הגרסה הקודמת (4 פרמטרים) מוחלפת: שתי חתימות במקביל היו משאירות את הישנה
-- פתוחה ל-authenticated בלי הבדיקות של החדשה.
drop function if exists public.phone_line_set_details(uuid, text, text, uuid);

create or replace function public.phone_line_set_details(
  p_line_id uuid, p_label text, p_source text, p_property_id uuid,
  p_forward_to text, p_external_number text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
  v_fwd   text := nullif(regexp_replace(coalesce(p_forward_to, ''), '[^0-9+]', '', 'g'), '');
  v_ext   text := nullif(regexp_replace(coalesce(p_external_number, ''), '[^0-9+]', '', 'g'), '');
begin
  if p_source is not null and p_source not in
     ('sign', 'yad2', 'facebook', 'instagram', 'google', 'website', 'newspaper', 'flyer', 'other') then
    raise exception 'invalid source_type';
  end if;
  if p_property_id is not null and not exists (
    select 1 from public.properties where id = p_property_id and agent_id = public.current_agent_id()
  ) then
    raise exception 'property not yours';
  end if;
  -- מספר ישראלי בלבד: 0XXXXXXXX(X) או +972 / 972. ניתוב לחו"ל יעלה לנו כסף בלי תקרה.
  if v_fwd is not null and v_fwd !~ '^(\+?972[1-9][0-9]{7,8}|0[1-9][0-9]{7,8})$' then
    raise exception 'invalid forward_to';
  end if;
  if v_ext is not null and v_ext !~ '^(\+?972[1-9][0-9]{7,8}|0[1-9][0-9]{7,8})$' then
    raise exception 'invalid external_number';
  end if;
  update public.agent_phone_lines
     set label = nullif(trim(p_label), ''), source_type = p_source, property_id = p_property_id,
         forward_to = v_fwd, external_number = v_ext
   where id = p_line_id and agent_id = public.current_agent_id() and status <> 'released'
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function public.phone_line_set_details(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.phone_line_set_details(uuid, text, text, uuid, text, text) to authenticated;

-- פרסום לאוויר מוואטסאפ נשמר כבקשה, כמו הנפקה. ה-check של
-- 20271028160000 מתיר רק reissue. בלי ההרחבה הזו insert של publish
-- נכשל ב-23514, והקוד מסרב לפרסם במקום לעלות לאוויר בלי אישור.
--
-- סדר פריסה: 20271028160000 ואז הקובץ הזה, ורק אחריהם הפונקציה.
-- אם whatsapp-webhook עולה קודם, הטבלה או ה-check חסרים. הקוד לא
-- מפרסם ולא נופל: הוא אומר לפרסם מאזור האישי.
--
-- gabriela_ask_before_publish = 1 שומר נכס חדש כ-unpublished ושואל.
-- 0 מחזיר את הפרסום המיידי. חסר נשאר "לשאול".

alter table public.whatsapp_pending_actions
  drop constraint if exists whatsapp_pending_actions_action_chk;

alter table public.whatsapp_pending_actions
  add constraint whatsapp_pending_actions_action_chk
  check (action in ('reissue', 'publish'));

comment on table public.whatsapp_pending_actions is
  'בקשת אישור מוואטסאפ שטרם בוצעה. reissue או publish. רק service_role. הכפתור נושא את id.';

insert into public.pricing_config (key, value, description) values
  ('gabriela_ask_before_publish', 1,
   '1: גבריאלה שומרת נכס חדש כ-unpublished ושואלת לפני פרסום. 0: מפרסמת מיד, כמו קודם.')
on conflict (key) do nothing;

-- אזהרה בזמן טיוטה. הטריגר properties_guard_duplicate רץ רק על active,
-- ולכן טיוטה של גבריאלה הייתה נשמרת בלי לומר שמשרד אחר כבר מפרסם.
-- כאן אין שמות: רק מצב. החסימה נשארת בטריגר, במעבר לפרסום.
-- בלי בעלים רשומים אי אפשר להפריד דירות, וזה אותו ענף של הטריגר.
create or replace function public.gabriela_draft_elsewhere(
  p_agent_id uuid,
  p_agency_id uuid,
  p_city text,
  p_street text,
  p_house_number text,
  p_rooms numeric,
  p_floor integer,
  p_deal_type text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_agency uuid;
  v_same boolean;
begin
  if p_agent_id is null or p_agency_id is null then
    return 'unknown';
  end if;
  v_key := public.property_dedupe_key(
    p_city, p_street, p_house_number, p_rooms, p_floor, p_deal_type);
  if v_key is null then
    return 'unknown';
  end if;

  select e.agency_id into v_agency
    from public.property_exclusivities e
   where e.dedupe_key = v_key
     and e.released_at is null
     and e.ends_on >= current_date
   limit 1;
  if found and v_agency is distinct from p_agency_id then
    return 'exclusive_elsewhere';
  end if;

  select (p.agency_id = p_agency_id) into v_same
    from public.properties p
   where p.status = 'active'
     and p.agent_id is distinct from p_agent_id
     and public.property_dedupe_key(
           p.city, p.street, p.house_number, p.rooms, p.floor, p.deal_type) = v_key
   order by p.created_at
   limit 1;
  if not found then
    return 'clear';
  end if;
  if v_same then
    return 'duplicate_same_agency';
  end if;
  return 'duplicate_elsewhere';
end;
$$;

comment on function public.gabriela_draft_elsewhere(uuid, uuid, text, text, text, numeric, integer, text) is
  'מצב פרסום לטיוטה, בלי שמות: clear, unknown, exclusive_elsewhere, duplicate_elsewhere, duplicate_same_agency. לא חוסם.';

revoke all on function public.gabriela_draft_elsewhere(uuid, uuid, text, text, text, numeric, integer, text)
  from public, anon, authenticated;
grant execute on function public.gabriela_draft_elsewhere(uuid, uuid, text, text, text, numeric, integer, text)
  to service_role;

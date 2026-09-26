-- ============================================================================
-- העוזר בוואטסאפ: תמונות נכנסות בלי לאבד אף אחת
--
-- ## מה נמדד (26.9.2026, 30 יום אחורה)
--
-- ‏24 רצפי תמונות (אלבום בוואטסאפ = הודעה נפרדת לכל תמונה, שמגיעות לוובהוק
-- כבקשות **מקבילות**). בכל אחד:
--
--   • ‏**תמונות אבדו.** כל בקשה קראה את השיחה, הוסיפה את התמונה שלה לרשימה,
--     וכתבה את כל הרשימה בחזרה - והבקשה המקבילה דרסה אותה. אותו דבר ב-
--     ‏`properties.images`. דוגמאות: 7 נשלחו → 1 בנכס; 10 → 5; 17 → 11.
--   • ‏**תשובה לכל תמונה.** ‏"📸 התמונה נוספה" × 9 תוך 4 שניות, ו-Meta חסמה
--     9 מהן (131056, pair rate limit).
--   • ‏**שתיקה.** בלי נכס פעיל בשיחה התמונות נשמרו בצד בלי מילה, ו-7 תמונות
--     ב-20.9 לא קיבלו שום תשובה.
--
-- ## מה כאן
--
-- ארבע פעולות אטומיות, כל אחת פקודה אחת במסד - כך ששתי בקשות מקבילות אינן
-- יכולות לדרוס זו את זו. ‏`saveConversation` בוובהוק מפסיקה לכתוב את
-- ‏`pending_images`; הרשימה משתנה רק דרך הפונקציות האלה.
--
-- כולן ‏service_role בלבד: הוובהוק מזהה סוכן/ת לפי טלפון ואין לו JWT, וכל
-- אחת מקבלת ‏`p_agent_id` מפורש - פתיחה ל-authenticated הייתה מאפשרת לכל
-- סוכן/ת לכתוב לשיחה או לנכס של אחר/ת.
-- ============================================================================

-- הוספת תמונה לרשימת הממתינות. מחזירה את **המיקום** שלה ברשימה - כך כל בקשה
-- יודעת בסוף חלון ההמתנה אם היא האחרונה באלבום, והאחרונה היחידה עונה.
create or replace function public.whatsapp_pending_image_add(
  p_agent_id uuid,
  p_phone    text,
  p_url      text
)
returns integer
language sql
security definer
set search_path to ''
as $$
  insert into public.whatsapp_conversations as c (agent_id, wa_phone, pending_images, updated_at)
  values (p_agent_id, p_phone, array[p_url], now())
  on conflict (agent_id) do update
     set pending_images = c.pending_images || excluded.pending_images,
         updated_at     = now()
  returning cardinality(c.pending_images);
$$;

revoke all on function public.whatsapp_pending_image_add(uuid, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_image_add(uuid, text, text) to service_role;

-- כמה ממתינות עכשיו. ‏0 כששיחה אינה קיימת.
create or replace function public.whatsapp_pending_image_count(p_agent_id uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select cardinality(c.pending_images)
                     from public.whatsapp_conversations c
                    where c.agent_id = p_agent_id), 0);
$$;

revoke all on function public.whatsapp_pending_image_count(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_image_count(uuid) to service_role;

-- לקיחה: מחזירה את כל הממתינות ומרוקנת, באותה פקודה. שתי לקיחות מקבילות -
-- אחת מקבלת את התמונות והשנייה רשימה ריקה, ואף תמונה אינה משויכת פעמיים.
create or replace function public.whatsapp_pending_images_take(p_agent_id uuid)
returns text[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_images text[];
begin
  select c.pending_images into v_images
    from public.whatsapp_conversations c
   where c.agent_id = p_agent_id
   for update;

  if v_images is null or cardinality(v_images) = 0 then
    return '{}'::text[];
  end if;

  update public.whatsapp_conversations
     set pending_images = '{}', updated_at = now()
   where agent_id = p_agent_id;

  return v_images;
end;
$$;

revoke all on function public.whatsapp_pending_images_take(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_images_take(uuid) to service_role;

-- צירוף תמונות לנכס: ‏`images || p_urls` בפקודה אחת, ולא קריאה-מיזוג-כתיבה.
-- רק נכס של הסוכן/ת. מחזירה את מספר התמונות בנכס אחרי הצירוף, או null
-- כשהנכס אינו שלו/ה.
create or replace function public.property_images_append(
  p_property_id uuid,
  p_agent_id    uuid,
  p_urls        text[]
)
returns integer
language sql
security definer
set search_path to ''
as $$
  update public.properties p
     set images     = coalesce(p.images, '{}') || coalesce(p_urls, '{}'),
         updated_at = now()
   where p.id = p_property_id
     and p.agent_id = p_agent_id
  returning cardinality(p.images);
$$;

revoke all on function public.property_images_append(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.property_images_append(uuid, uuid, text[]) to service_role;

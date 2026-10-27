-- ============================================================================
-- העוזר בוואטסאפ: מתי הגיעה התמונה הממתינה הוותיקה ביותר
--
-- ## מה קרה (27.10.2026)
--
-- תמונה שנשלחה ב-24.10 וחיכתה בצד שלושה ימים (‏`pending_images`), וצילום
-- מסך של מועד דיון בבית משפט שנשלח ב-27.10 באמצע שיחה על היומן - שניהם
-- צורפו בשקט למודעה פעילה של משרד להשכרה, וצילום המסך עלה לאתר. הרשימה
-- לא ידעה מתי נכנסה כל תמונה, ולכן "תמונה מלפני שלושה ימים" ו"תמונה
-- מעכשיו" היו אותו דבר, וכל צירוף לקח את כולן.
--
-- ## מה כאן
--
-- ‏`pending_images_since` - מתי נכנסה הוותיקה ברשימה. נקבע כשהרשימה עוברת
-- מריקה ללא ריקה, ומתאפס בלקיחה. הוובהוק ו-`create_property` שואלים לפני
-- שהם מצרפים רשימה שהוותיקה בה מלפני יותר מ-20 דקות (‏`PHOTO_ASK_GAP_MS`).
--
-- שתי הפונקציות שמוסיפות תמונה נכתבות מחדש עם העמודה, באותה פקודה - כמו
-- קודם, כך ששתי בקשות מקבילות אינן דורסות זו את זו.
-- ============================================================================

alter table public.whatsapp_conversations
  add column if not exists pending_images_since timestamptz;

comment on column public.whatsapp_conversations.pending_images_since is
  'מתי נכנסה התמונה הממתינה הוותיקה ביותר. נכתב רק דרך whatsapp_pending_image_add / whatsapp_burst_add / whatsapp_pending_images_take.';

-- רשימות שכבר ממתינות: הזמן הידוע האחרון שלהן. מוקדם מדי עדיף על מאוחר מדי -
-- המחיר הוא שאלה מיותרת, ולא תמונה זרה במודעה.
update public.whatsapp_conversations
   set pending_images_since = updated_at
 where cardinality(pending_images) > 0
   and pending_images_since is null;

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
  insert into public.whatsapp_conversations as c
    (agent_id, wa_phone, pending_images, pending_images_since, updated_at)
  values (p_agent_id, p_phone, array[p_url], now(), now())
  on conflict (agent_id) do update
     set pending_images       = c.pending_images || excluded.pending_images,
         pending_images_since = case when cardinality(c.pending_images) = 0 then now()
                                     else coalesce(c.pending_images_since, now()) end,
         updated_at           = now()
  returning cardinality(c.pending_images);
$$;

revoke all on function public.whatsapp_pending_image_add(uuid, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_image_add(uuid, text, text) to service_role;

create or replace function public.whatsapp_burst_add(
  p_agent_id  uuid,
  p_phone     text,
  p_text      text,
  p_image_url text
)
returns bigint
language sql
security definer
set search_path to ''
as $$
  insert into public.whatsapp_conversations as c
    (agent_id, wa_phone, pending_texts, pending_images, pending_images_since, burst_seq, updated_at)
  values (
    p_agent_id, p_phone,
    case when coalesce(btrim(p_text), '') <> '' then array[p_text] else '{}'::text[] end,
    case when p_image_url is not null then array[p_image_url] else '{}'::text[] end,
    case when p_image_url is not null then now() end,
    1, now())
  on conflict (agent_id) do update
     set pending_texts        = c.pending_texts  || excluded.pending_texts,
         pending_images       = c.pending_images || excluded.pending_images,
         pending_images_since = case
                                  when cardinality(c.pending_images) > 0 then coalesce(c.pending_images_since, now())
                                  when cardinality(excluded.pending_images) > 0 then now()
                                end,
         burst_seq            = c.burst_seq + 1,
         updated_at           = now()
  returning c.burst_seq;
$$;

revoke all on function public.whatsapp_burst_add(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_burst_add(uuid, text, text, text) to service_role;

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
     set pending_images = '{}', pending_images_since = null, updated_at = now()
   where agent_id = p_agent_id;

  return v_images;
end;
$$;

revoke all on function public.whatsapp_pending_images_take(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_images_take(uuid) to service_role;

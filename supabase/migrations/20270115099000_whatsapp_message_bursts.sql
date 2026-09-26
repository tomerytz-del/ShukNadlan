-- ============================================================================
-- העוזר בוואטסאפ: רצף הודעות = תור אחד, ושינוי סדר התמונות בנכס
--
-- ## רצף הודעות (הרחבה של האלבום, מיגרציה 20270115095000)
--
-- האלבום תוקן: תמונות מקבילות נאספות, והאחרונה עונה. אבל **טקסט** עדיין רץ
-- לבד. מודעה שמועברת מקבוצה מגיעה כתיאור, תמונות ו"מחיר 4,000,000 תפרסם" -
-- הודעות נפרדות תוך שניות - וכל טקסט הריץ תור משלו, במקביל. ב-22.9 זה נתן
-- שתי תשובות סותרות באותה שנייה: "רק חסר מחיר" ו"חסר לי סוג הנכס".
--
-- מה שנמדד (30 יום): 190 הודעות הגיעו 0-4 שניות אחרי הקודמת, **אף אחת**
-- בין 4 ל-5, ומשם רק הודעות שהוקלדו ביד. לכן חלון של 4 שניות מקבל כל רצף
-- ואינו מעכב שיחה רגילה יותר מזה.
--
-- הרעיון זהה לאלבום, רק על כל ההודעות: כל הודעה מוסיפה את עצמה (טקסט ו/או
-- תמונה) ומקבלת מספר רץ, ממתינה, ורק זו שהמספר שלה עדיין האחרון מריצה תור
-- אחד על כל הטקסטים והתמונות שנאספו.
--
-- ## סדר התמונות
--
-- "תוכל להחליף את סדר התמונות" (22.9) - והבוט ענה שאין לו אפשרות. התמונה
-- הראשונה ב-`properties.images` היא התמונה הראשית בכרטיס ובדף הנכס.
-- ‏`property_images_set` מחליפה את הרשימה **רק אם היא לא השתנתה מאז שנקראה**
-- (השוואה ב-where), כדי שאלבום שנכנס באמצע לא יימחק בשקט.
--
-- כל הפונקציות service_role בלבד, כמו שאר פונקציות השיחה.
-- ============================================================================

alter table public.whatsapp_conversations
  add column if not exists pending_texts text[] not null default '{}',
  add column if not exists burst_seq bigint not null default 0;

comment on column public.whatsapp_conversations.pending_texts is
  'טקסטים שהגיעו ברצף וממתינים לתור אחד. נכתב רק דרך whatsapp_burst_add / whatsapp_pending_texts_take.';
comment on column public.whatsapp_conversations.burst_seq is
  'מונה ההודעות הנכנסות. ההודעה שהמספר שלה עדיין האחרון בסוף החלון היא זו שעונה על כל הרצף.';

-- הוספה לרצף: טקסט (אם יש) ותמונה (אם יש), והמספר הרץ - בפקודה אחת.
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
    (agent_id, wa_phone, pending_texts, pending_images, burst_seq, updated_at)
  values (
    p_agent_id, p_phone,
    case when coalesce(btrim(p_text), '') <> '' then array[p_text] else '{}'::text[] end,
    case when p_image_url is not null then array[p_image_url] else '{}'::text[] end,
    1, now())
  on conflict (agent_id) do update
     set pending_texts  = c.pending_texts  || excluded.pending_texts,
         pending_images = c.pending_images || excluded.pending_images,
         burst_seq      = c.burst_seq + 1,
         updated_at     = now()
  returning c.burst_seq;
$$;

revoke all on function public.whatsapp_burst_add(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_burst_add(uuid, text, text, text) to service_role;

create or replace function public.whatsapp_burst_seq(p_agent_id uuid)
returns bigint
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select c.burst_seq from public.whatsapp_conversations c
                    where c.agent_id = p_agent_id), 0);
$$;

revoke all on function public.whatsapp_burst_seq(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_burst_seq(uuid) to service_role;

-- לקיחת הטקסטים וריקון, באותה פקודה - כמו whatsapp_pending_images_take.
create or replace function public.whatsapp_pending_texts_take(p_agent_id uuid)
returns text[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_texts text[];
begin
  select c.pending_texts into v_texts
    from public.whatsapp_conversations c
   where c.agent_id = p_agent_id
   for update;

  if v_texts is null or cardinality(v_texts) = 0 then
    return '{}'::text[];
  end if;

  update public.whatsapp_conversations
     set pending_texts = '{}', updated_at = now()
   where agent_id = p_agent_id;

  return v_texts;
end;
$$;

revoke all on function public.whatsapp_pending_texts_take(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_texts_take(uuid) to service_role;

-- החלפת רשימת התמונות של נכס - רק של הסוכן/ת, ורק אם הרשימה לא השתנתה מאז
-- שנקראה. מחזירה את מספר התמונות אחרי ההחלפה, או null (לא שלך / השתנתה).
create or replace function public.property_images_set(
  p_property_id uuid,
  p_agent_id    uuid,
  p_expected    text[],
  p_images      text[]
)
returns integer
language sql
security definer
set search_path to ''
as $$
  update public.properties p
     set images     = coalesce(p_images, '{}'),
         updated_at = now()
   where p.id = p_property_id
     and p.agent_id = p_agent_id
     and coalesce(p.images, '{}') = coalesce(p_expected, '{}')
  returning cardinality(p.images);
$$;

revoke all on function public.property_images_set(uuid, uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.property_images_set(uuid, uuid, text[], text[]) to service_role;

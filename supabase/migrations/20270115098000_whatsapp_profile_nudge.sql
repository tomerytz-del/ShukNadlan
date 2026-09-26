-- ============================================================================
-- העוזר בוואטסאפ: תזכורת על פרופיל חסר - פעם בשבוע, לא בכל הודעה
--
-- דף הסוכן/ת באתר (`/agent?slug=`) הוא מה שגולש/ת רואה לפני שמתקשר/ת. בלי
-- תמונה, ביו ואזור פעילות הוא נראה כמו כרטיס נטוש. הבוט יודע לערוך אותו
-- (`update_profile` ב-`whatsapp-webhook/agent.ts`), ולכן כשחסר בו משהו
-- חשוב, הוא מוסיף לתשובה שורה שמציעה לשלוח את החסר - פעם בשבוע לכל היותר.
--
-- ## למה עמודה ופונקציה, ולא רק בקוד
--
-- אלבום תמונות מגיע כבקשות מקבילות (מיגרציה 20270115095000). "בדוק מתי
-- הזכרנו, ואז עדכן" משתי בקשות מקבילות הוא שתי תזכורות באותה שנייה.
-- ‏`update ... where profile_nudged_at < now() - interval ... returning` הוא
-- פקודה אחת: רק בקשה אחת זוכה.
--
-- ‏service_role בלבד, כמו כל פונקציות השיחה: מזהה סוכן/ת מפורש בפרמטר.
-- ============================================================================

alter table public.whatsapp_conversations
  add column if not exists profile_nudged_at timestamptz;

comment on column public.whatsapp_conversations.profile_nudged_at is
  'מתי הבוט הזכיר לאחרונה שחסר מידע בפרופיל האישי. נכתב רק דרך whatsapp_profile_nudge_claim.';

create or replace function public.whatsapp_profile_nudge_claim(
  p_agent_id   uuid,
  p_interval_h integer default 168
)
returns boolean
language sql
security definer
set search_path to ''
as $$
  with claimed as (
    update public.whatsapp_conversations c
       set profile_nudged_at = now()
     where c.agent_id = p_agent_id
       and (c.profile_nudged_at is null
            or c.profile_nudged_at < now() - make_interval(hours => greatest(coalesce(p_interval_h, 168), 1)))
    returning 1
  )
  select exists (select 1 from claimed);
$$;

comment on function public.whatsapp_profile_nudge_claim(uuid, integer) is
  'true = מותר להזכיר עכשיו שחסר מידע בפרופיל, והזמן נרשם באותה פקודה. false = הוזכר בחלון האחרון (ברירת מחדל שבוע). מיגרציה 20270115098000.';

revoke all on function public.whatsapp_profile_nudge_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.whatsapp_profile_nudge_claim(uuid, integer) to service_role;

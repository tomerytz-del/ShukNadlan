-- ============================================================================
-- וואטסאפ: מעקב מסירה להודעות יוצאות
--
-- ## מה היה חסר, ואיך זה התגלה
--
-- ביומן ההודעות רשום מה **נשלח**, ולא מה **הגיע**. עבור הודעה יוצאת שמרנו
-- ‏`wa_message_id = null`, ו-`error` התמלא רק כש-Graph API החזירה שגיאה
-- מיידית. כלומר: מטא מחזירה 200, אנחנו רושמים שורה נקייה, ומכאן ואילך
-- ההודעה מבחינתנו הצליחה.
--
-- ב-16.9.2026 זה עלה בבדיקה של העוזר הציבורי: הבוט ענה נכון — חיפש, מצא
-- חמישה נכסים, שלח שני כרטיסי תמונה וסיכם — היומן הראה שש שורות יוצאות בלי
-- שגיאה, **והמכשיר שבדק לא קיבל דבר**. לא הייתה שום דרך להבדיל בין "נשלח
-- ולא נמסר" לבין "נמסר והמשתמש פספס", וזה הפך בעיה של מכשיר אחד לחקירה
-- ארוכה מול הקוד שלנו.
--
-- ## מה נכנס
--
-- ‏Meta שולחת לאותו וובהוק אירועי סטטוס (`value.statuses`) לכל הודעה יוצאת —
-- ‏sent → delivered → read, או failed עם קוד שגיאה. עד היום הם הגיעו ונזרקו.
-- עכשיו הם נרשמים על השורה שכבר קיימת, לפי `wa_message_id` שמטא החזירה
-- בשליחה.
--
-- ## למה פונקציה ולא update ישיר
--
-- אירועי הסטטוס מגיעים **בסדר לא מובטח**: אפשר לקבל `delivered` אחרי `read`
-- ברשת איטית, ו-update תמים היה מוריד הודעה שנקראה בחזרה ל"נמסרה". הדירוג
-- כאן הוא מקור אמת יחיד, והוא אטומי — בדיקה והחלה באותה שאילתה.
--
-- ‏`failed` מדורג מעל כולם: הוא הדבר היחיד שבאמת צריך לדעת עליו, ואסור
-- שאירוע מאוחר ידרוס אותו.
-- ============================================================================

alter table public.whatsapp_messages
  add column if not exists status text;
alter table public.whatsapp_messages
  add column if not exists status_at timestamptz;
alter table public.whatsapp_messages
  add column if not exists status_detail text;

comment on column public.whatsapp_messages.status is
  'מצב המסירה של הודעה יוצאת לפי Meta: sent · delivered · read · failed. ריק בהודעות נכנסות ובהודעות שנשלחו לפני שהמעקב נוסף.';
comment on column public.whatsapp_messages.status_detail is
  'קוד וכותרת השגיאה מ-Meta כש-status=failed. זה מה שמסביר למה הודעה לא הגיעה.';

-- ---------------------------------------------------------------------------
-- רישום אירוע סטטוס
--
-- מחזירה true אם השורה עודכנה. ‏false פירושו אחד משניים, ושניהם תקינים:
-- אירוע ישן שהגיע באיחור, או הודעה שלא נרשמה אצלנו מלכתחילה (התראות
-- ותזכורות נשלחות מפונקציות אחרות ואינן עוברות ביומן הזה).
-- ---------------------------------------------------------------------------
create or replace function public.record_whatsapp_status(
  p_wa_message_id text,
  p_status        text,
  p_at            timestamptz default null,
  p_detail        text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank    int;
  v_updated int;
begin
  if p_wa_message_id is null or p_status is null then
    return false;
  end if;

  v_rank := case p_status
              when 'sent'      then 1
              when 'delivered' then 2
              when 'read'      then 3
              when 'failed'    then 9
              else 0
            end;
  -- סטטוס שאיננו מכירים (מטא מוסיפה סוגים מדי פעם) לא כותב כלום, כדי שלא
  -- ידרוס מצב אמיתי בערך שאיננו יודעים לדרג
  if v_rank = 0 then
    return false;
  end if;

  update public.whatsapp_messages m
     set status        = p_status,
         status_at     = coalesce(p_at, now()),
         status_detail = coalesce(p_detail, m.status_detail)
   where m.wa_message_id = p_wa_message_id
     and (
       m.status is null
       or case m.status
            when 'sent'      then 1
            when 'delivered' then 2
            when 'read'      then 3
            when 'failed'    then 9
            else 0
          end < v_rank
     );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.record_whatsapp_status(text, text, timestamptz, text) is
  'רושמת אירוע מסירה של Meta על הודעה יוצאת ביומן. מתקדמת רק קדימה בדירוג sent<delivered<read<failed, כי אירועי הסטטוס מגיעים בסדר לא מובטח.';

-- ההרשאות, במפורש: הפונקציה נקראת רק מהוובהוק דרך service_role. בלי השורות
-- האלה היא נקודת קצה ב-/rest/v1/rpc/ שכל אנונימי יכול לקרוא לה ולזייף
-- סטטוסים ביומן. אותו כלל שסגר את purge_whatsapp_public_conversations
-- במיגרציה 20261116090000.
revoke all on function public.record_whatsapp_status(text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_whatsapp_status(text, text, timestamptz, text)
  to service_role;

-- ============================================================================
-- התראת הצטרפות למנהל/ת הפלטפורמה
--
-- משרד תיווך שנפתח, ומתווך/ת שנכנס/ת לראשונה — שניהם מצלצלים עכשיו בפעמון
-- של מנהל/ת הפלטפורמה, ומשם יוצאים בוואטסאפ דרך `notification-push`.
-- ההודעה נושאת את השם ואת המסלול שאיתו הצטרפו.
--
-- ## מה יש כאן ומה אין
--
-- **אין כאן טריגר.** ההתראה נוצרת ב-Edge Functions של ההצטרפות
-- (‏`_shared/platform-signup-alert.ts`), והסיבה היא המסלול: ‎grant_launch_promo‎
-- רצה **אחרי** ה-INSERT על `agency_members`, ולכן טריגר שהיה קורא ‎tier‎ ברגע
-- היצירה היה מדווח "Pay&GO" על כל מצטרף/ת — כלומר השדה היחיד שהתבקש כאן היה
-- שקר עקבי. ההסבר המלא יושב בראש המודול הזה.
--
-- ולכן המיגרציה היא שני דברים בלבד: הסוג החדש, וההדלקה של הערוץ.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. סוג ההתראה
--
-- ‏`platform_signup` מיועד למנהל/ת הפלטפורמה בלבד, כמו `review_alert`
-- ו-`lead_unrouted`. הרשימה נכתבת במלואה ולא "נוספת" — זו הדרך היחידה
-- לשנות CHECK, וכל השמטה כאן היא סוג התראה שיפסיק להיווצר.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert',
                  'client_match','review_new','deal_closed','lead_unrouted',
                  'marketing_copy','agreement_signed','platform_signup'));

-- ---------------------------------------------------------------------------
-- 2. הדלקת הערוץ למנהלי הפלטפורמה — והחריג המכוון
--
-- ‏`whatsapp_types` היא רשימת מאושרים ולא מושתקים, והכלל שנקבע איתה הוא
-- שסוג חדש **לא** נדלק לאיש בוואטסאפ עד שמסמנים אותו (ראו
-- ‏20261029090000 §7). הכלל הזה מגן על סוכנים מהודעות יוצאות שלא ביקשו —
-- והוא לא רלוונטי כאן משתי סיבות: הנמען/ת היחיד/ה של הסוג הזה הוא/היא
-- מנהל/ת הפלטפורמה, וההתראה הזו **נבנתה לבקשתו/ה המפורשת** להיות מעודכן/ת
-- בוואטסאפ על כל הצטרפות. סוכן/ת רגיל/ה לא מקבל/ת את הסוג הזה בכלל, ולכן
-- ההדלקה כאן אינה פותחת ערוץ לאיש שלא ביקש.
--
-- שתי הפעולות מכסות את שני המצבים (יש שורת העדפות, אין שורת העדפות), ושתיהן
-- אינן עושות דבר בהרצה חוזרת.
-- ---------------------------------------------------------------------------
update public.agent_notification_preferences p
   set whatsapp_types = p.whatsapp_types || 'platform_signup',
       updated_at     = now()
  from public.agency_members m
 where m.id = p.agent_id
   and m.is_platform_admin = true
   and not ('platform_signup' = any(p.whatsapp_types));

insert into public.agent_notification_preferences (agent_id, whatsapp_types)
select m.id, array['platform_signup']::text[]
  from public.agency_members m
 where m.is_platform_admin = true
   and not exists (
     select 1 from public.agent_notification_preferences p where p.agent_id = m.id
   );

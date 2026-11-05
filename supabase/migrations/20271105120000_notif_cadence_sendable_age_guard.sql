-- ============================================================================
-- notification_push_lead_wa_sendable: התראה בת יותר משבעה ימים - "לא" בלי חישוב
--
-- ## מה קרה (5.11.2026)
--
-- מ-10:00 UTC כל סבב של notification-push נפל ב-"canceling statement due to
-- statement timeout" (8 שניות ל-authenticator), ואף סוכן/ת לא קיבל/ה התראה
-- בוואטסאפ - גם לא ליד חדש - עד שהדגל notif_cadence_button_enabled כובה ידנית
-- ב-14:1x.
--
-- הסיבה: כשהדגל דלוק, notification_push_claim קוראת לפונקציה הזו על **כל**
-- התראה שלא נקראה (‏notifications_pushable_idx, כ-9,000 שורות), ולכל אחת
-- היא מחשבת notif_cadence_group ו-agent_type_cadence - כ-1.1 מילי-שנייה לשורה,
-- 10.3 שניות לסבב (EXPLAIN ANALYZE בפרודקשן). לפני 10:00 זה כבר נגע בסף
-- (שני timeout-ים בשעה), והצבר של ההתראות שלא נקראו דחף אותו מעבר.
--
-- ## למה שבעה ימים בטוח
--
-- שום התראה בת יותר משבעה ימים אינה יכולה לצאת ממילא: חלונות ה-claim הם עד
-- 72 שעות, ו-notification_push_quiet_hold - היחידה שמחזיקה התראה מעבר להם -
-- מחזירה false על כל דבר בן יותר משבעה ימים. לכן התשובה "לא" כאן אינה משנה
-- אף שליחה, רק חוסכת את החישוב: 352 שורות במקום 9,034, ‏0.76 שניות במקום 10.3
-- (נמדד על אותה שאילתה בפרודקשן).
--
-- ## ומה לא השתנה
--
-- דגל כבוי - התשובה true כמו קודם, לפני הבדיקה החדשה. כל שאר הענפים זהים
-- ל-20271031290000.
-- ============================================================================

create or replace function public.notification_push_lead_wa_sendable(
  p_agent uuid,
  p_type text,
  p_created timestamptz
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.notif_cadence_button_on() then true
    -- 20271105120000: ישנה משבעה ימים לא תצא בשום מסלול - בלי לחשב קצב
    when p_created is null or p_created <= now() - interval '7 days' then false
    when public.notif_cadence_group(p_type) is null then true
    when public.notif_cadence_group(p_type) = 'meetings' then true
    when public.notif_cadence_group(p_type) = 'system_mentor' then false
    when public.agent_type_cadence(p_agent, p_type) in ('off', 'digest', 'daily', 'thrice') then false
    when public.agent_type_cadence(p_agent, p_type) = 'each' then
      public.agent_type_cadence_since(p_agent, p_type) is null
      or p_created >= public.agent_type_cadence_since(p_agent, p_type)
    else false
  end;
$$;

comment on function public.notification_push_lead_wa_sendable(uuid, text, timestamptz) is
  'האם התראה מותרת בוואטסאפ המיידי. דגל כבוי: תמיד כן. ישנה משבעה ימים: לא, בלי חישוב (20271105120000). off: בלי וואטסאפ על ליד והתאמה. daily/thrice: ליד חדש רק בסיכום.';

revoke all on function public.notification_push_lead_wa_sendable(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_push_lead_wa_sendable(uuid, text, timestamptz) to service_role;

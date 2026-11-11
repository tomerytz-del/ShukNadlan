-- ============================================================================
-- סימון לידים שהפונה בהם הוא יועץ/ת רשום/ה (11.11.2026, בהחלטת תומר: "לסמן בלי לחסום")
--
-- מה היה: 59 מתוך 81 הלידים במערכת הגיעו מטלפון של סוכן/ת רשום/ה - רובם
-- (41 מתוך 47 לידי ההדמיה) סוכן/ת שבדק/ה את הכלי על עצמו/ה. אף ליד לא סומן
-- ככזה, ולכן כל סטטיסטיקה על לידים, וכל דיווח "ליד לא תקין" (סיבה broker),
-- נעשו בלי שהסוכן/ת או מנהל/ת הפלטפורמה יראו את זה.
--
-- מה נכנס: פונקציה אחת שמחזירה, לליד **פתוח** של הסוכן/ת שקורא/ת, אם הטלפון
-- שלו תואם טלפון של חבר/ת משרד (agency_members.phone_e164) ואם זה הטלפון
-- של הסוכן/ת עצמו/ה. אין חסימה, אין שינוי בחיוב ואין עמודה חדשה:
--
--   * נגזר בזמן הקריאה ולא נשמר. סוכן/ת שנרשם/ה אחרי הליד, או שהחליף/ה מספר,
--     מתעדכן/ת מעצמו/ה, ואין טריגר על הכנסת ליד ואין backfill.
--   * רק הלידים של הסוכן/ת עצמו/ה (agent_id), לא של מי שהפנה (referred_by):
--     למפנה אין מה לעשות עם הסימן, ואין סיבה שיראה אותו.
--   * חבר/ת משרד שנסגר/ה או שוחרר/ה (closed_at, released_at) אינו/ה "יועץ/ת רשום/ה":
--     לקוח/ה אמיתי/ת שמשתמש/ת במספר ישן לא יסומן/ תסומן בטעות. הטלפון של הסוכן/ת
--     עצמו/ה מסומן תמיד, גם אם נסגר/ה לאחר מכן.
--   * שאילתה אחת: טלפון הקורא/ת נשלף פעם אחת, והבדיקה מול שאר החברים נשענת על
--     agency_members_phone_e164_key. ה-RPC יוצא בכל טעינת לידים.
--   * רק ליד פתוח (status = 'unlocked'). "הפונה הוא יועץ/ת" הוא מידע על
--     זהות הפונה, ולכן בליד נעול הוא אינו מוצג (הסקיל lead-card, כלל 1).
--   * מחזירה רק מזהה ליד ודגל. לא את זהות הסוכן/ת, לא המשרד ולא הטלפון.
--   * אותה צורה כמו lead_visitor_groups(): SECURITY DEFINER כי הרשאות ה-CRM
--     אינן קוראות את agency_members של אחרים, עם הגבלה בפנים ללידים של הקורא/ת.
--
-- אותו סימן כבר נכנס לראיות של דיווח על ליד לא תקין (broker_phone,
-- 20271111100000), והוא משלים אותו: שם הוא נבדק ברגע הדיווח, כאן הוא מוצג
-- על הכרטיס מההתחלה.
-- ============================================================================

create or replace function public.lead_agent_phone_flags()
returns table (lead_id uuid, is_self boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id, m.phone_e164
      from public.agency_members m
     where m.id = public.current_agent_id()
  )
  select l.id, (l.phone_e164 = me.phone_e164) as is_self
    from public.leads l
    join me on l.agent_id = me.id
   where l.status = 'unlocked'
     and l.phone_e164 is not null
     and (
       l.phone_e164 = me.phone_e164
       or exists (
         select 1 from public.agency_members m
          where m.phone_e164 = l.phone_e164
            and m.closed_at is null and m.released_at is null
       )
     );
$$;

revoke all on function public.lead_agent_phone_flags() from public, anon, authenticated;
grant execute on function public.lead_agent_phone_flags() to authenticated, service_role;

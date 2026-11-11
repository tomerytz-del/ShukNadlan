-- ============================================================================
-- התראת "חרג מזמן היעד" אומרת מה חרג, לכל סוג בתיבת המשימות (11.11.2026)
--
-- admin_inbox_notify_overdue() (20270719090000) מנסחת את כותרת ההתראה לפי סוג
-- הפריט, אבל הכירה רק את ארבעת הסוגים הראשונים. כל סוג שנוסף אחר כך
-- (hood_draft, lead_report, article, professional_card, flagged_review) יצא
-- "פריט חרג/ה מזמן היעד", ומנהל/ת הפלטפורמה לא ידע/ה מה מחכה לו/ה בלי לפתוח
-- את התיבה. זה נמצא בבדיקת הפרודקשן אחרי #1239 (lead_report).
--
-- מה השתנה: חמש שורות `when` בלבד. הגוף הועתק מהפרודקשן (md5 c3661d6d...) ושונה
-- רק שם, ובעמודות ה-insert נוסף suppress_push = false במפורש: זו התראה אמיתית
-- למנהלי הפלטפורמה שאמורה להיות דחופה כמו עד היום, והבדיקה
-- check_notification_backfill דורשת שהסימון יהיה גלוי.
-- ============================================================================

create or replace function public.admin_inbox_notify_overdue()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_new   integer;
  v_title text;
  v_body  text;
begin
  -- פריט שיצא מהתיבה (טופל) משחרר את השורה שלו
  delete from public.admin_inbox_alerts a
   where not exists (select 1 from public._admin_inbox_rows() r
                      where r.kind = a.kind and r.ref_id = a.ref_id);

  with overdue as (
    select r.kind, r.ref_id
      from public._admin_inbox_rows() r
      join public.admin_sla s on s.kind = r.kind
     where extract(epoch from now() - r.created_at) / 60 >= s.minutes
  ), fresh as (
    insert into public.admin_inbox_alerts (kind, ref_id)
    select o.kind, o.ref_id from overdue o
    on conflict (kind, ref_id) do nothing
    returning kind
  )
  select count(*),
         case when count(*) = 1 then
           case min(kind)
             when 'unrouted_lead'     then 'ליד ללא יעד'
             when 'refund'            then 'בקשת החזר'
             when 'license_appeal'    then 'ערעור על אימות רישיון'
             when 'coach_gap'         then 'שאלה שהמנטור לא ידע לענות'
             when 'hood_draft'        then 'טיוטת תיאור שכונה'
             when 'lead_report'       then 'דיווח על ליד לא תקין'
             when 'article'           then 'כתבה'
             when 'professional_card' then 'כרטיס בעל מקצוע'
             when 'flagged_review'    then 'ביקורת מסומנת'
             else 'פריט'
           end || ' חרג/ה מזמן היעד'
         else count(*) || ' פריטים חרגו מזמן היעד' end
    into v_new, v_title
    from fresh;

  if v_new = 0 then
    return 0;
  end if;

  v_body := 'מחכים לך בתיבת המשימות, מהוותיק ביחס לזמן היעד שלו.';

  insert into public.notifications (agent_id, type, title, body, suppress_push)
  select m.id, 'admin_overdue', v_title, v_body, false
    from public.agency_members m
   where m.is_platform_admin and m.active;

  return v_new;
end $$;

revoke all on function public.admin_inbox_notify_overdue() from public, anon, authenticated;
grant execute on function public.admin_inbox_notify_overdue() to service_role;

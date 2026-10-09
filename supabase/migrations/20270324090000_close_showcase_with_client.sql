-- ============================================================================
-- סגירת לקוח/ה סוגרת גם את המיניסייט שלו/ה
--
-- "מחיקה" של לקוח/ה ב-CRM ובבוט היא `status = 'closed'` - הרשומה נשארת
-- בקובץ. מחיקה אמיתית (‏delete) כבר מורידה את המיניסייט (‏on delete cascade),
-- אבל סגירה השאירה אותו `active`: הקישור המשיך להיפתח, הלקוח/ה המשיך/ה
-- לראות נכסים ולבקש סיורים, ובמסד נמצאו חמישה כאלה.
--
-- טריגר ולא קוד בדפדפן, כי יש לפחות שלוש דלתות שמשנות סטטוס: טופס הלקוח/ה
-- ב-CRM, ‏set_client_status של גבריאלה, וכל מה שיתווסף. ‏`security definer`
-- כי מנהל/ת משרד שסוגר/ת כרטיס של סוכן/ת אחר/ת אינו/ה בעל/ת המיניסייט.
--
-- פתיחה מחדש של הלקוח/ה **אינה** פותחת את המיניסייט: הקישור כבר נסגר אצל
-- הלקוח/ה, ומיניסייט חדש נפתח מההתאמות כרגיל. docs/client-showcase.md
-- ============================================================================

create or replace function public.agent_clients_close_showcase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    update public.client_showcases
       set status = 'closed', closed_at = now(), updated_at = now()
     where client_id = new.id and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_clients_close_showcase on public.agent_clients;
create trigger agent_clients_close_showcase
  after update of status on public.agent_clients
  for each row execute function public.agent_clients_close_showcase();

-- פונקציית טריגר אינה נקראת דרך PostgREST, אבל היא `security definer` -
-- ולכן סגורה לכולם (‏check_function_grants).
revoke all on function public.agent_clients_close_showcase() from public, anon, authenticated;

-- למפרע: מיניסייטים פעילים של לקוחות שכבר נסגרו
update public.client_showcases s
   set status = 'closed', closed_at = now(), updated_at = now()
  from public.agent_clients c
 where c.id = s.client_id
   and c.status = 'closed'
   and s.status = 'active';

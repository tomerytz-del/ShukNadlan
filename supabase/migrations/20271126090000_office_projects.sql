-- ============================================================================
-- פרויקטים בדף המשרד (21.11.2026, בקשת תומר)
--
-- משרד תיווך שמשווק גם פרויקטים חדשים צריך שהפרויקטים יוצגו בדף המשרד שלו. אין קישור בין
-- חברה יזמית (`developers`) למשרד (`agencies`), והוא נגזר ולא נשמר:
--
--   **חברה מקושרת למשרד רק אם המשתמש/ת שפתח/ה אותה הוא/היא מנהל/ת פעיל/ה באותו משרד.**
--
-- ככה אי אפשר להיראות כמשרד שאינו שלך (קישור לפי שם או ח.פ היה פרצה), ויציאה מהמשרד מנתקת
-- את הקישור מעצמה, בלי עמודה שצריך לזכור לעדכן. סוכן/ת רגיל/ה אינו/ה מקשר/ת חברה למשרד:
-- יזם שהוא גם סוכן באותו משרד אינו בהכרח עסק של המשרד.
--
-- החברה יכולה להסתיר את הפרויקטים מדף המשרד (`show_on_office_page`, ברירת מחדל: מוצג).
--
-- הפונקציה מחזירה **מזהים בלבד**. הנתונים עצמם נשלפים מ-`projects_public`, כך שפרויקט שאינו
-- חי (טיוטה, פג, בבקשת מחיקה) לעולם לא מופיע, ואין כאן עותק שני של תנאי הפרסום.
-- ‏anon קורא: זו קריאה בלבד, ללא כתיבה, ומוצהרת ב-`PUBLIC_RPC` של הסוכן התפעולי.
--
-- אידמפוטנטית.
-- ============================================================================

alter table public.developers
  add column if not exists show_on_office_page boolean not null default true;

comment on column public.developers.show_on_office_page is
  'האם הפרויקטים החיים של החברה מוצגים בדף המשרד שבו המשתמש/ת של החברה הוא/היא מנהל/ת (agency_project_ids).';

create or replace function public.agency_project_ids(p_agency_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pp.id
    from public.projects_public pp
    join public.developers d on d.id = pp.developer_id
   where d.show_on_office_page
     and d.user_id is not null
     and exists (select 1 from public.agency_members m
                  where m.user_id = d.user_id
                    and m.agency_id = p_agency_id
                    and m.role = 'manager'
                    and m.active)
   order by pp.is_promoted desc, pp.published_at desc nulls last
   limit 24;
$$;

comment on function public.agency_project_ids(uuid) is
  'מזהי הפרויקטים החיים של חברות שמנהל/ת המשרד הוא/היא גם המשתמש/ת שלהן (דף המשרד, assets/agency.js). קריאה בלבד, ל-anon.';

-- קריאה ציבורית בכוונה (דף המשרד), לשלושת התפקידים בשם
revoke all on function public.agency_project_ids(uuid) from public, anon, authenticated;
grant execute on function public.agency_project_ids(uuid) to anon, authenticated, service_role;

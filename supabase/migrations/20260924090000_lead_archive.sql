-- ============================================================================
-- ארכיון לידים
-- ----------------------------------------------------------------------------
-- קטגוריית "הלידים שלי" ב-CRM מציגה את *כל* מה שנכנס אי פעם, מהחדש לישן.
-- אחרי כמה חודשי עבודה זו רשימה של מאות כרטיסים שרובם נסגרו מזמן — והליד
-- שהגיע הבוקר יושב בראשה בין עשרות שכבר טופלו. אין שום דרך להוריד כרטיס
-- מהמסך.
--
-- מה שהטבלה הזו מוסיפה היא בדיוק פעולה אחת: **הסתרה, לא מחיקה.** ליד
-- שהועבר לארכיון יורד מהרשימה הפעילה ומהתור החם, ונשאר זמין במלואו בלשונית
-- הארכיון — עם אותם כפתורים, כולל החזרה משם בלחיצה אחת.
--
-- שלוש החלטות שכדאי שיהיו כתובות:
--
--   1. **טבלה נפרדת ולא עמודה ב-leads.** ‏leads מוזנת בידי ה-Edge Functions
--      (‏owner-lead-intake, ‏claim_lead) ונקראת דרך ה-view ‏leads_masked;
--      עמודה חדשה שם הייתה נוגעת בשני המסלולים שמייצרים כסף. הארכיון הוא
--      *העדפת תצוגה של הסוכן/ת* ולא תכונה של הליד, וזה בדיוק ההבדל שהפרדת
--      הטבלאות שומרת. גם מנקודת מבט של הרשאות זה נכון יותר: הסוכן/ת כותב/ת
--      לטבלה שכולה שלו/ה, ולא מקבל/ת הרשאת UPDATE על שורת הליד עצמה.
--
--   2. **‏lead_id הוא המפתח הראשי.** ליד שייך לסוכן/ת אחד/ת בכל רגע נתון,
--      ולכן אין מצב של שתי שורות ארכיון לאותו ליד. ‏agent_id נשמר בכל זאת —
--      הוא מה שה-policy נשענת עליו ומה שמאפשר שליפה אחת לכל הארכיון של
--      הסוכן/ת בלי join.
--
--   3. **‏on delete cascade משני הצדדים.** שורת ארכיון בלי ליד היא זבל, ולכן
--      אין מה לשמר אותה: הפעולה שהיא מתארת ("אל תציג לי את זה") מאבדת
--      משמעות ברגע שאין מה להציג.
--
-- אין כאן שום גישה לתוכן הליד — לא שם, לא טלפון ולא הודעה. הטבלה מכילה שני
-- מזהים וחותמת זמן, וזה כל מה שהסתרה מהמסך דורשת.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

create table if not exists public.lead_archives (
  lead_id     uuid primary key references public.leads(id)          on delete cascade,
  agent_id    uuid not null    references public.agency_members(id) on delete cascade,
  archived_at timestamptz not null default now()
);

comment on table public.lead_archives is
  'לידים שהסוכן/ת הוריד/ה מהרשימה הפעילה ב-CRM. הסתרה בלבד — הליד, הבעלות עליו והחיוב שכבר נגבה אינם משתנים, והחזרה מהארכיון היא מחיקת השורה כאן.';
comment on column public.lead_archives.agent_id is
  'הסוכן/ת שארכב/ה. גם עמודת ה-policy וגם מה שמאפשר לשלוף את כל הארכיון בשאילתה אחת.';

-- השאילתה היחידה היא "מה בארכיון של הסוכן/ת הזה/ו", והיא רצה בכל טעינת
-- דשבורד. המיון לפי מועד הארכוב הוא סדר התצוגה בלשונית.
create index if not exists lead_archives_agent_idx
  on public.lead_archives (agent_id, archived_at desc);

alter table public.lead_archives enable row level security;

-- ‏policy אחת ל-‎all‎: הפעולות הן קריאה, ארכוב והחזרה — שלושתן על שורות של
-- אותו סוכן/ת, ואין הפרדת הרשאות ביניהן. הבדיקה היא זהות בלבד ולא בעלות על
-- הליד: ‏leads עצמה נקראת ב-CRM דרך ה-view ‏leads_masked ולא ישירות, ולכן
-- ‏exists על ‎public.leads‎ כאן היה נשען על מדיניות קריאה שאין לוודא שקיימת —
-- ונופל בשקט על כל ארכוב. מה שהמדיניות כן מבטיחה הוא מה שחשוב: אי אפשר
-- לכתוב לארכיון של מישהו אחר ואי אפשר לקרוא אותו. שורה שמצביעה על ליד שאינו
-- שלך אינה מסתירה ממך דבר — הרשימה שלך ממילא נבנית מהלידים שלך בלבד.
drop policy if exists "agent manages own lead archive" on public.lead_archives;
create policy "agent manages own lead archive"
  on public.lead_archives for all
  using (exists (
    select 1 from public.agency_members
    where agency_members.id = lead_archives.agent_id
      and agency_members.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.agency_members
    where agency_members.id = lead_archives.agent_id
      and agency_members.user_id = (select auth.uid())));

grant select, insert, delete on public.lead_archives to authenticated;

-- ============================================================================
-- אימות ח״פ מול רשם החברות
--
-- ‏developers.company_number נבדק עד עכשיו על **צורתו** בלבד — תשע ספרות,
-- ייחודי. כלומר חברה יכלה להקליד מספר תקין לחלוטין שאינו שלה. המיגרציה
-- הזו מוסיפה את השכבה שחסרה: המספר נבדק מול מערכי הנתונים של רשות
-- התאגידים ב-data.gov.il, והתוצאה נשמרת על השורה.
--
-- ---------------------------------------------------------------------------
-- **האימות אינו חוסם הרשמה, ובכוונה.**
--
-- ‏data.gov.il הוא שירות חיצוני שאין לנו שליטה עליו, ומזהה מערך הנתונים
-- ושמות העמודות בעברית משתנים כשהמפרסם מעלה גרסה חדשה. מזהה שהתיישן מחזיר
-- אפס תוצאות לכל חברה בעולם — ואם אפס תוצאות היה חוסם, ההרשמה לאתר הייתה
-- נסגרת לגמרי ביום שהמפרסם מחליף מזהה, בלי שאיש ישנה שורת קוד.
--
-- לכן: ‏registry_status הוא **תיעוד**, לא שער.
--
--   verified   — נמצא במרשם והתאגיד פעיל
--   inactive   — נמצא, אבל מחוסל/בפירוק. זה המצב היחיד שההרשמה נחסמת בו,
--                כי הוא מבוסס על תשובה חיובית ומפורשת של המרשם.
--   not_found  — המרשם ענה כשורה ולא מצא. מסומן ומוצג, ואינו חוסם כברירת
--                מחדל (‏company_registry_block_unknown שולט בזה).
--   unverified — לא הצלחנו לשאול. אף פעם לא חוסם.
--
-- ההבחנה בין not_found ל-unverified נשענת על כך ש-CKAN מבדיל בעצמו:
-- שאילתה פסולה מחזירה success:false, ולא רשימה ריקה. ראו
-- ‏supabase/functions/_shared/company-registry.ts.
-- ---------------------------------------------------------------------------
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. תוצאת האימות על שורת החברה
-- ---------------------------------------------------------------------------
alter table public.developers
  add column if not exists registry_status text not null default 'unverified'
    check (registry_status in ('verified','inactive','not_found','unverified')),
  add column if not exists registry_name       text,
  add column if not exists registry_entity_status text,
  add column if not exists registry_source     text,
  add column if not exists registry_checked_at timestamptz;

comment on column public.developers.registry_status is
  'תוצאת האימות מול רשם החברות. unverified = לא הצלחנו לשאול (שירות חיצוני), ולא "נכשל".';
comment on column public.developers.registry_name is
  'השם כפי שהוא רשום במרשם. עשוי להיות שונה מ-name — שם השיווק אינו חייב להיות השם הרשום.';
comment on column public.developers.registry_entity_status is
  'סטטוס התאגיד כלשונו במרשם ("פעילה", "מחוסלת"). טקסט חופשי בעברית, לא ערך סגור.';
comment on column public.developers.registry_checked_at is
  'מתי נבדק לאחרונה. NULL = מעולם. מזין את מסך הניהול ואת בדיקה חוזרת ל-unverified.';

-- מסך הניהול שואל "מי לא אומת" — אינדקס חלקי, כי המכריע יהיה verified.
create index if not exists developers_registry_attention_idx
  on public.developers(registry_status, registry_checked_at)
  where registry_status <> 'verified';


-- ---------------------------------------------------------------------------
-- 2. מטמון תשובות המרשם
--
-- אותו ח״פ נבדק שוב ושוב: פעם בהקלדה בטופס (חיווי חי), פעם בשליחה, ושוב
-- בכל בדיקה חוזרת. בלי מטמון כל הקלדה הייתה יוצאת ל-data.gov.il.
--
-- הטבלה סגורה ל-anon **ול-authenticated** לגמרי: היא ממופה לפי ח״פ, ומי
-- שיכול לקרוא אותה יכול לדלות ממנה את רשימת החברות שנבדקו באתר. הכתיבה
-- והקריאה נעשות ב-service_role מתוך פונקציית הקצה בלבד.
-- ---------------------------------------------------------------------------
create table if not exists public.company_registry_cache (
  company_number  text primary key,
  status          text not null
                  check (status in ('verified','inactive','not_found','unverified')),
  name            text,
  entity_status   text,
  registry_source text,
  payload         jsonb,
  checked_at      timestamptz not null default now()
);

comment on table public.company_registry_cache is
  'תשובות רשם החברות לפי ח״פ. סגורה לחלוטין ללקוח — נקראת ונכתבת ב-service_role מתוך company-registry-lookup.';
comment on column public.company_registry_cache.payload is
  'הרשומה הגולמית מהמרשם. נשמרת כדי שנוכל להבין תשובה מוזרה בדיעבד בלי לשאול שוב.';

create index if not exists company_registry_cache_checked_idx
  on public.company_registry_cache(checked_at);

alter table public.company_registry_cache enable row level security;
revoke all on public.company_registry_cache from anon, authenticated;
-- ‏RLS דלוקה ובלי אף policy: נגיש ל-service_role בלבד, אותה תבנית של
-- ‏ad_placement_access.


-- ---------------------------------------------------------------------------
-- 3. תוצאת האימות בדף החברה הציבורי
--
-- מה שנחשף הוא ‏registry_status ו-registry_name בלבד — הסטטוס הגולמי
-- ("בפירוק מרצון") הוא מידע עסקי על התאגיד שאין סיבה להציג בדף שיווקי.
-- ---------------------------------------------------------------------------
-- ‏drop + create מאותה סיבה שבקובץ הקודם: ה-view מוגדר בשני קבצים, ו-
-- ‏create or replace אינו יכול לצמצם עמודות כשההרצה חוזרת בסדר הפוך.
drop view if exists public.developers_public;
create view public.developers_public
with (security_invoker = true) as
select
  d.id,
  d.slug,
  d.name,
  d.legal_name,
  d.logo_url,
  d.cover_url,
  d.colors,
  d.tagline,
  d.description,
  d.phone,
  d.phone_e164,
  d.email,
  d.website,
  d.address,
  d.city,
  d.founded_year,
  d.projects_delivered,
  (select count(*) from public.projects p
   where p.developer_id = d.id and p.status = 'active'
     and p.delete_requested_at is null
     and (p.subscription_expires_at is null or p.subscription_expires_at > now())) as live_projects,
  d.contact_name,
  d.registry_status,
  d.registry_name
from public.developers d
where d.status = 'active';

grant select on public.developers_public to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. מתגי המדיניות
--
-- ‏pricing_config מחזיק מספרים בלבד, ולכן שני המתגים הם 1/0. מזהי מערכי
-- הנתונים ושמות העמודות **אינם** כאן אלא במשתני סביבה של פונקציית הקצה
-- (‏COMPANY_REGISTRY_RESOURCE_ID וחבריו) — הם מחרוזות, והם סוד תפעולי של
-- אינטגרציה ולא מספר עסקי.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('company_registry_enabled', 1,
   'אימות ח״פ מול רשם החברות (1=פעיל, 0=כבוי — ההרשמה ממשיכה בלי לשאול)'),
  ('company_registry_block_unknown', 0,
   'האם לחסום הרשמה כשהמספר לא נמצא במרשם (1=חוסם, 0=נרשם ומוצג בלבד). לא נוגע ב-unverified, שלעולם אינו חוסם'),
  ('company_registry_cache_days', 30,
   'כמה ימים תשובת המרשם נחשבת טרייה לפני בדיקה חוזרת')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

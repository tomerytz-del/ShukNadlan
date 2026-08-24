-- ============================================================================
-- מנוע לידים מפידי RSS — סכמת מסד הנתונים (Supabase / PostgreSQL)
--
-- שתי טבלאות:
--   1. rss_sources — רשימת הפידים שהסקרייפר קורא. מנוהלת אך ורק מדף הניהול
--      של מנהל/ת הפלטפורמה (crm.html → "ניהול מקורות RSS").
--   2. rss_leads   — הלידים עצמם, אחרי ניתוח וסיווג של Claude.
--
-- ‏‎הערה על שמות: בפרויקט הזה כבר קיימת טבלת `leads` (לידים שמגיעים מטופסי
-- האתר ומחולקים לסוכנים). כדי לא לשבור אותה, לידי ה-RSS יושבים בטבלה נפרדת
-- בשם `rss_leads`. אם הסקרייפר רץ מול פרויקט Supabase ריק, אפשר לשנות כאן
-- את שם הטבלה ולהתאים את `LEADS_TABLE` ב-lead_engine/config.py.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב ושוב (SQL Editor או supabase db push).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ‏updated_at אוטומטי
-- ---------------------------------------------------------------------------
create or replace function public.rss_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. מקורות RSS
--
-- ‏url הוא המפתח העסקי: אותו פיד לא יתווסף פעמיים. עמודות ה-last_* מתעדכנות
-- על ידי הסקרייפר (service_role) ומוצגות בדף הניהול כדי לראות מיד איזה פיד
-- הפסיק להחזיר פריטים או מחזיר שגיאה.
-- ---------------------------------------------------------------------------
create table if not exists public.rss_sources (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  url           text not null unique,
  source_type   text not null default 'other'
                check (source_type in ('facebook_group','yad2','board','telegram','other')),
  active        boolean not null default true,
  notes         text,

  -- טלמטריה מההרצה האחרונה של הסקרייפר
  last_fetched_at timestamptz,
  last_status     text,
  last_error      text,
  items_seen      integer not null default 0,
  leads_created   integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.rss_sources is
  'פידי RSS שהסקרייפר קורא. נוסף/מוסר רק דרך דף הניהול של מנהל/ת הפלטפורמה.';
comment on column public.rss_sources.url is
  'כתובת הפיד (למשל rss.app). ייחודית — מונעת הוספה כפולה של אותו מקור.';
comment on column public.rss_sources.active is
  'כיבוי זמני של מקור בלי למחוק אותו — הסקרייפר מדלג על מקורות לא פעילים.';
comment on column public.rss_sources.items_seen is
  'סך הפריטים שנקראו מהמקור הזה מאז ומעולם (מצטבר).';

create index if not exists rss_sources_active_idx on public.rss_sources (active);

drop trigger if exists rss_sources_set_updated_at on public.rss_sources;
create trigger rss_sources_set_updated_at
  before update on public.rss_sources
  for each row execute function public.rss_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. לידים
--
-- ‏source_url הוא לב מנגנון מניעת הכפילויות: אינדקס UNIQUE כאן מבטיח שגם אם
-- שתי הרצות של ה-Workflow חופפות, אותו פוסט לא ייכנס פעמיים — הסקרייפר בודק
-- מראש מול הטבלה (כדי לא לבזבז קריאות ל-Claude), וה-UNIQUE הוא רשת הביטחון.
-- ---------------------------------------------------------------------------
create table if not exists public.rss_leads (
  id            uuid primary key default gen_random_uuid(),

  -- מקור
  source_url    text not null unique,
  source_id     uuid references public.rss_sources(id) on delete set null,
  source_name   text,
  published_at  timestamptz,
  raw_title     text,
  raw_content   text,

  -- א. זיהוי צד ומקור
  is_lead       boolean not null default false,
  lead_side     text check (lead_side in
                  ('קונה פרטי','מוכר פרטי','שוכר','משכיר','מתווך/ספאם')),

  -- ב. שדות שחולצו
  city          text,
  neighborhood  text,
  property_type text check (property_type in
                  ('דירה','פנטהאוז','דירת גן','בית פרטי','מסחרי','מגרש','אחר')),
  rooms         numeric(4,1) check (rooms is null or rooms > 0),
  floor         smallint,
  price_budget  numeric(14,2) check (price_budget is null or price_budget >= 0),
  urgency_level text check (urgency_level in ('גבוהה','בינונית','רגילה')),

  -- ג. ציון איכות
  lead_quality_score smallint check (lead_quality_score between 1 and 10),

  -- ד. תצוגה שיווקית באתר (בלי שם/טלפון/קישור מקור)
  teaser_title       text,
  teaser_description text,

  -- מסחר (Pay-per-lead)
  status        text not null default 'new'
                check (status in ('new','sold','archived')),
  sold_at       timestamptz,
  sold_to_agent_id uuid,   -- מפנה ל-agency_members.id כשהליד נמכר

  -- תיעוד הניתוח
  analysis      jsonb,
  model         text,
  analyzed_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.rss_leads is
  'לידי נדל"ן שנאספו מפידי RSS ונותחו ב-Claude. source_url רגיש — נחשף רק לקונה הליד.';
comment on column public.rss_leads.source_url is
  'הקישור לפוסט המקורי — המוצר שנמכר. ייחודי, ומשמש למניעת כפילויות.';
comment on column public.rss_leads.is_lead is
  'false כשמדובר במתווך/ספאם/פוסט לא רלוונטי — נשמר לתיעוד אך לא מוצג באתר.';
comment on column public.rss_leads.floor is
  'קומה כפי שצוינה בפוסט. קומת קרקע = 0, מרתף = 1-, לא צוין = null.';
comment on column public.rss_leads.analysis is
  'הפלט המלא של Claude כפי שהתקבל — לתחקור ולשיפור הפרומפט בדיעבד.';
comment on column public.rss_leads.status is
  'new = פנוי למכירה · sold = נמכר לסוכן/ת · archived = הוסר מהמדף.';

create unique index if not exists rss_leads_source_url_key on public.rss_leads (source_url);
create index if not exists rss_leads_status_idx        on public.rss_leads (status);
create index if not exists rss_leads_quality_idx       on public.rss_leads (lead_quality_score desc);
create index if not exists rss_leads_city_idx          on public.rss_leads (city);
create index if not exists rss_leads_created_idx       on public.rss_leads (created_at desc);
-- החיפוש הנפוץ באתר: לידים אמיתיים שפנויים למכירה, החזקים קודם
create index if not exists rss_leads_shelf_idx
  on public.rss_leads (lead_quality_score desc, created_at desc)
  where is_lead = true and status = 'new';

drop trigger if exists rss_leads_set_updated_at on public.rss_leads;
create trigger rss_leads_set_updated_at
  before update on public.rss_leads
  for each row execute function public.rss_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. ‏RLS
--
-- הסקרייפר עובד עם SERVICE_ROLE_KEY שעוקף RLS לחלוטין, ולכן אין כאן שום
-- policy של כתיבה ללקוח — הדפדפן רק קורא.
-- ---------------------------------------------------------------------------
alter table public.rss_sources enable row level security;
alter table public.rss_leads   enable row level security;

-- ‏Supabase מעניקה כברירת מחדל SELECT לכל התפקידים על כל טבלה ב-public.
-- ב-rss_leads יושב source_url — המוצר שנמכר — ולכן מסירים את ההרשאה מ-anon
-- לגמרי ולא נשענים על RLS בלבד. מבקרים לא מזוהים קוראים רק את
-- ‏rss_leads_public. תפקיד authenticated נשאר, כי עליו נשענות ה-policies של
-- מנהל/ת הפלטפורמה ושל קונה הליד.
revoke select on public.rss_leads   from anon;
revoke select on public.rss_sources from anon;

drop policy if exists "platform admin manage rss sources" on public.rss_sources;
create policy "platform admin manage rss sources"
  on public.rss_sources for all
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true))
  with check (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

drop policy if exists "platform admin manage rss leads" on public.rss_leads;
create policy "platform admin manage rss leads"
  on public.rss_leads for all
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true))
  with check (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

-- מי שקנה את הליד רואה את השורה המלאה, כולל source_url.
-- ‏public.current_agent_id() כבר קיימת בפרויקט ומחזירה את agency_members.id
-- של המשתמש/ת המחובר/ת.
drop policy if exists "buyer reads purchased rss lead" on public.rss_leads;
create policy "buyer reads purchased rss lead"
  on public.rss_leads for select
  using (sold_to_agent_id is not null and sold_to_agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 4. מדף הלידים הפומבי
--
-- ‏View ללא security_invoker (כלומר רץ בהרשאות הבעלים ועוקף את ה-RLS של
-- הטבלה) — בדיוק כמו leads_masked, agency_members_public ו-planning_lookups_public
-- בפרויקט. זו הדרך לחשוף את התקציר השיווקי לכל מבקר/ת באתר בלי לחשוף את
-- ‏source_url, את הטקסט הגולמי או את הניתוח.
--
-- ה-linter של Supabase מסמן את התבנית הזו כ-"Security Definer View" ברמת
-- ‏ERROR. כאן זה מכוון: זו בדיוק המטרה. אם נעביר את ה-view ל-security_invoker,
-- ‏anon יזדקק להרשאת SELECT על rss_leads עצמה — בדיוק מה שנמנע למעלה —
-- וה-view יחזיר אפס שורות.
-- ---------------------------------------------------------------------------
create or replace view public.rss_leads_public as
select
  id,
  lead_side,
  city,
  neighborhood,
  property_type,
  rooms,
  floor,
  price_budget,
  urgency_level,
  lead_quality_score,
  teaser_title,
  teaser_description,
  status,
  created_at
from public.rss_leads
where is_lead = true
  and status in ('new','sold');

comment on view public.rss_leads_public is
  'מדף הלידים באתר — תקציר שיווקי בלבד. ללא source_url, ללא raw_content, ללא פרטי קשר.';

grant select on public.rss_leads_public to anon, authenticated;

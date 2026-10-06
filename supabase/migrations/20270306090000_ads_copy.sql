-- ===========================================================================
-- קונסולת השיווק — טיוטות קופי למודעות, בשני מסלולים ועם רמת אגרסיביות
-- ===========================================================================
--
-- תומר ביקש (7.10.2026) שני סוגי קמפיינים שונים מהיסוד:
--
--   | מסלול     | מה מקדמים                   | למי             | טון            |
--   |-----------|-----------------------------|-----------------|----------------|
--   | property  | נכס מסוים שבאתר             | קונים / שוכרים  | לא אגרסיבי     |
--   | platform  | שוק נדל"ן עצמה (מנוי, כלים) | מתווכים ומשרדים | עד אגרסיבי מאוד |
--
-- ועוד שני דברים: לכוון את רמת האגרסיביות של המודעה, ולערוך את הנוסחים
-- שהמודל מציע לפני שהם הופכים למודעה.
--
-- ‏**הרמה נשמרת במסד ולא רק בדפדפן.** ‏intensity הוא 1 עד 5, ובמסלול property
-- התקרה היא 2 — check במסד, לא רק בפונקציה. מודעת נכס היא מודעה של מתווך/ת
-- לפי תקנות האתיקה, ונכס של משרד אחר מפורסם בשם הפלטפורמה; טון של "הזדמנות
-- אחרונה" על נכס של מישהו אחר הוא בדיוק מה שאסור. מסלול platform פונה
-- למקצוענים ומפרסם את המוצר שלנו, ושם מותר יותר — אבל גם שם רק עובדות.
--
-- ‏**העובדות על הפלטפורמה.** ‏ads_settings.platform_facts הוא הרשימה היחידה
-- שהמודל רשאי לטעון ממנה דבר על שוק נדל"ן. מודעה אגרסיבית שממציאה "חוסכים
-- 10 שעות בשבוע" היא פרסום מטעה — הרמה משנה את הטון, לעולם לא את העובדות.
-- הרשימה נזרעת כאן מהיכולות שבאמת קיימות, ותומר מעדכן אותה.
--
-- ‏**עריכה.** ‏generated שומר את מה שהמודל כתב, ו-variants את מה שנערך. כך
-- רואים כמה נערך, ואפשר לחזור למקור. ‏history שומר עד 10 סבבים קודמים של
-- "כתוב מחדש" עם ההערה שנתנה אותם.
--
-- הרשאות: כמו שאר ads_* — קריאה למנהל/ת הפלטפורמה, כתיבה רק מ-ads-admin.
-- ===========================================================================

create table if not exists public.ads_copy_drafts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.agency_members(id) on delete set null,
  audience     text not null,
  intensity    smallint not null,
  property_id  uuid references public.properties(id) on delete set null,
  brief        jsonb not null default '{}'::jsonb,
  generated    jsonb not null default '[]'::jsonb,
  variants     jsonb not null default '[]'::jsonb,
  history      jsonb not null default '[]'::jsonb,
  status       text not null default 'draft',
  model        text
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_copy_drafts_audience_check') then
    alter table public.ads_copy_drafts add constraint ads_copy_drafts_audience_check
      check (audience in ('property', 'platform'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_copy_drafts_intensity_check') then
    alter table public.ads_copy_drafts add constraint ads_copy_drafts_intensity_check
      check (intensity between 1 and 5 and (audience <> 'property' or intensity <= 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_copy_drafts_property_check') then
    alter table public.ads_copy_drafts add constraint ads_copy_drafts_property_check
      check (audience <> 'property' or property_id is not null or status = 'archived');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_copy_drafts_status_check') then
    alter table public.ads_copy_drafts add constraint ads_copy_drafts_status_check
      check (status in ('draft', 'approved', 'archived'));
  end if;
end $$;

create index if not exists ads_copy_drafts_recent_idx   on public.ads_copy_drafts (updated_at desc);
create index if not exists ads_copy_drafts_property_idx on public.ads_copy_drafts (property_id) where property_id is not null;

comment on table public.ads_copy_drafts is
  'טיוטות קופי למודעות ממומנות. audience: property (נכס, intensity עד 2) או platform (שיווק למתווכים, עד 5). generated = מה שהמודל כתב, variants = אחרי עריכה. docs/marketing-console.md';

alter table public.ads_copy_drafts enable row level security;
drop policy if exists "platform admin reads ads copy" on public.ads_copy_drafts;
create policy "platform admin reads ads copy" on public.ads_copy_drafts
  for select to authenticated using (public.current_is_platform_admin());
revoke all on public.ads_copy_drafts from anon;

insert into public.ads_settings (key, value, description) values
  ('platform_default_intensity', '3'::jsonb,
   'רמת האגרסיביות ההתחלתית במסלול platform (1 עדין - 5 אגרסיבי מאוד). במסלול property התקרה 2 קבועה במסד'),
  ('platform_facts', to_jsonb($facts$- מערכת CRM למשרדי תיווך: נכסים, לקוחות, משימות ותזכורות במקום אחד
- גבריאלה: עוזרת אישית בוואטסאפ שמעדכנת נכסים, מחפשת התאמות ומכינה מסמכים
- פרסום אוטומטי של כל נכס לפייסבוק ולאינסטגרם, עם תיאור שיווקי שנכתב אוטומטית
- דוח השוואת שוק (CMA) ממותג, מבוסס על עסקאות רשמיות של רשות המיסים
- החתמת לקוחות על הסכמי תיווך מהטלפון
- מיניסייט אישי ללקוח/ה עם הנכסים שנבחרו עבורו/ה
- מספר וירטואלי עם הקלטה וסיכום שיחות
- דף משרד ודף סוכן/ת באתר שוק נדל"ן$facts$::text),
   'העובדות היחידות שמודעה במסלול platform רשאית לטעון על שוק נדל"ן. רמת האגרסיביות משנה את הטון ולא את העובדות - כל טענה שאינה כאן אסורה')
on conflict (key) do nothing;

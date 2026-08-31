-- ============================================================================
-- מבזק חדשות הנדל"ן — הטבלאות שמאחורי הרצועה בדף הבית
--
-- רצועת "מבזק" קיימת בדף הבית מהיום הראשון, אבל עד עכשיו לא היה לה מקור:
-- ‏loadTicker() ניסתה לקרוא טבלה בשם `news_items` שמעולם לא נוצרה, והפונקציה
-- בכלל לא נקראה — הרצועה הציגה שתי כותרות קשיחות בקוד, והכפתור "כל העדכונים"
-- פתח alert של דמו.
--
-- שתי טבלאות:
--
--   * `news_sources` — הפידים שהמנוע קורא. יושבות כאן ולא בקוד כדי שאפשר
--     יהיה להוסיף, לכבות או להחליף מקור בלי דיפלוי. נזרעות למטה עם רשימת
--     ברירת המחדל (עיריית עפולה, חדשות העמק, והאתרים הכלכליים המובילים).
--   * `news_items` — המבזקים עצמם. ‎source_url‎ הוא UNIQUE, וזו רשת הביטחון
--     מפני כפילויות: כתבה שכבר נאספה לא תיכנס שוב ולא תישלח שוב לניתוח
--     ב-Claude (כלומר לא תעלה כסף פעם שנייה).
--
-- שלוש החלטות שכדאי להכיר:
--
--   * פריט שנדחה נשמר עם ‎status = 'rejected'‎ ולא נמחק. אילו היה נמחק,
--     ההרצה הבאה הייתה אוספת אותו שוב ומנתחת אותו שוב — הטבלה היא גם
--     מאגר התוכן וגם זיכרון "מה כבר ראינו".
--   * ‏`scope` מפריד בין מבזק מקומי (עפולה והעמק) לארצי. הרצועה מציגה את
--     שניהם, אבל המקומי מקבל עדיפות בסדר — ראו ‎news_items_public‎.
--   * הקריאה הציבורית עוברת ב-view בלבד, בלי ‎source_url‎ הגולמי ובלי
--     שדות התחקור (‎raw_content‎, ‎analysis‎, ‎model‎).
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- מקורות
-- ---------------------------------------------------------------------------
create table if not exists public.news_sources (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  url             text not null,
  source_type     text not null default 'news'
                    check (source_type in ('municipality','news','portal')),
  scope           text not null default 'national'
                    check (scope in ('afula','region','national')),
  active          boolean not null default true,
  last_fetched_at timestamptz,
  last_status     text,
  last_error      text,
  items_seen      integer not null default 0,
  news_created    integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.news_sources is
  'הפידים שמנוע המבזקים (news_scraper.py) קורא. נפרד מ-rss_sources — שם יושבים פידי הלידים, וכאן פידי התוכן.';
comment on column public.news_sources.source_type is
  'municipality = פרסומי העירייה, news = אתר חדשות, portal = פורטל נדל"ן. משמש רק לתיוג ולסדר בדף הניהול.';
comment on column public.news_sources.scope is
  'עד כמה המקור מקומי. afula = עפולה עצמה, region = עמק יזרעאל והסביבה, national = נדל"ן ארצי.';
comment on column public.news_sources.last_error is
  'שגיאת הקריאה האחרונה. פיד שנשבר (כתובת שהוחלפה, חסימה) מסמן את עצמו כאן במקום להפיל את ההרצה.';

create unique index if not exists news_sources_url_key on public.news_sources(url);

drop trigger if exists news_sources_set_updated_at on public.news_sources;
create trigger news_sources_set_updated_at
  before update on public.news_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- מבזקים
-- ---------------------------------------------------------------------------
create table if not exists public.news_items (
  id              uuid primary key default gen_random_uuid(),
  source_url      text not null,
  source_id       uuid references public.news_sources(id) on delete set null,
  source_name     text,

  headline        text not null,
  summary         text,
  url             text,
  image_url       text,
  category        text,
  scope           text not null default 'national'
                    check (scope in ('afula','region','national')),
  relevance_score integer not null default 5 check (relevance_score between 1 and 10),

  published_at    timestamptz not null default now(),
  status          text not null default 'published'
                    check (status in ('published','rejected')),

  -- תחקור: מה בדיוק הגיע מהפיד ומה Claude החזיר עליו
  raw_title       text,
  raw_content     text,
  analysis        jsonb,
  model           text,
  analyzed_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.news_items is
  'מבזקי נדל"ן שנאספו אוטומטית מפרסומי עיריית עפולה ומאתרי הנדל"ן המובילים. נכתבת אך ורק על ידי news_scraper.py (service role).';
comment on column public.news_items.source_url is
  'הכתובת הקנונית של הכתבה. מפתח מניעת הכפילויות — הבדיקה מולו רצה לפני כל פנייה ל-Claude.';
comment on column public.news_items.headline is
  'שורת המבזק כפי שהיא מופיעה ברצועה. קצרה בכוונה (עד ~90 תווים) — הרצועה חותכת בשלוש נקודות.';
comment on column public.news_items.summary is
  'שתי שורות הסבר שנפתחות במודאל "כל העדכונים". ריק = מציגים רק את הכותרת.';
comment on column public.news_items.url is
  'הקישור לכתבה המלאה. נפתח בלשונית חדשה — זה תוכן חיצוני ולא עמוד של האתר.';
comment on column public.news_items.scope is
  'afula/region = מבזק מקומי, national = נדל"ן ארצי. קובע את סדר התצוגה ואת התגית ברצועה.';
comment on column public.news_items.status is
  'פריט שנדחה בסינון נשמר כ-rejected ולא נמחק, אחרת ההרצה הבאה הייתה אוספת ומנתחת אותו מחדש.';

-- רשת הביטחון מפני כפילויות, גם כששתי הרצות חופפות.
create unique index if not exists news_items_source_url_key
  on public.news_items(source_url);

-- האינדקס שמשרת את הרצועה ואת המודאל: עשרת המבזקים המפורסמים האחרונים.
create index if not exists news_items_published_idx
  on public.news_items(published_at desc) where status = 'published';

drop trigger if exists news_items_set_updated_at on public.news_items;
create trigger news_items_set_updated_at
  before update on public.news_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ‏RLS
--
-- אותה תבנית כמו articles: קריאה ציבורית למה שפורסם, כתיבה למנהל/ת
-- הפלטפורמה בלבד. המנוע עצמו רץ עם service role ועוקף RLS — ולכן הוא חייב
-- להישאר בצד השרת (GitHub Actions) ולא בדפדפן.
-- ---------------------------------------------------------------------------
alter table public.news_items   enable row level security;
alter table public.news_sources enable row level security;

revoke insert, update, delete on public.news_items   from anon;
revoke select, insert, update, delete on public.news_sources from anon;

drop policy if exists "public reads published news" on public.news_items;
create policy "public reads published news"
  on public.news_items for select
  using (status = 'published' and published_at <= now());

drop policy if exists "platform admin manage news" on public.news_items;
create policy "platform admin manage news"
  on public.news_items for all
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true))
  with check (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

drop policy if exists "platform admin manage news sources" on public.news_sources;
create policy "platform admin manage news sources"
  on public.news_sources for all
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true))
  with check (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

-- ---------------------------------------------------------------------------
-- מה שהאתר קורא
--
-- ‏security_invoker=true — ה-view לא מרחיב גישה, ה-policy של הטבלה נשארת
-- בתוקף. תפקידו לרכז את תנאי ה"פורסם" ואת הסתרת שדות התחקור במקום אחד.
--
-- ‏is_local מחושב כאן ולא בדפדפן: הרצועה מסמנת מבזק מקומי בתגית משלו,
-- והחלוקה בין scope-ים היא כלל תוכן ולא כלל תצוגה.
-- ---------------------------------------------------------------------------
create or replace view public.news_items_public
with (security_invoker = true) as
select
  id,
  headline,
  summary,
  url,
  image_url,
  category,
  scope,
  (scope in ('afula','region')) as is_local,
  source_name,
  published_at
from public.news_items
where status = 'published'
  and published_at <= now();

comment on view public.news_items_public is
  'המבזקים שהאתר הציבורי קורא. בלי source_url הגולמי ובלי שדות התחקור. הסדר נקבע בשאילתה — published_at desc.';

grant select on public.news_items_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- מקורות ברירת המחדל
--
-- ‏on conflict do nothing‎ מאפשר להריץ את הקובץ שוב בלי לדרוס מקור שכובה
-- ידנית או שכתובתו הוחלפה.
--
-- למה כל כך הרבה שאילתות Google News ולא רק פידים ישירים: פיד ישיר של אתר
-- חדשות הוא הכתובת היציבה פחות בשרשרת — סעיף נסגר, מזהה משתנה, והמקור
-- שותק בלי שאיש שם לב. שאילתת ‎news.google.com/rss/search‎ עומדת בפני
-- השינויים האלה (התחביר הוא של גוגל, לא של האתר), מחזירה עברית עם
-- ‎hl=iw&gl=IL&ceid=IL:he‎, וה-‎site:‎ בתוכה מצמצם אותה לאתרים המובילים.
-- ‏canonical_url() ב-feeds.py פותחת את עטיפת ההפניה של גוגל, כך שהקישור
-- שנשמר הוא של האתר עצמו ולא של גוגל.
-- ---------------------------------------------------------------------------
insert into public.news_sources (name, url, source_type, scope) values
  ('עיריית עפולה — הודעות ופרסומים',
   'https://www.afula.muni.il/rss',
   'municipality', 'afula'),

  ('עיריית עפולה בחדשות (תכנון, בנייה ומכרזים)',
   'https://news.google.com/rss/search?q=%22%D7%A2%D7%99%D7%A8%D7%99%D7%99%D7%AA+%D7%A2%D7%A4%D7%95%D7%9C%D7%94%22+(%D7%AA%D7%9B%D7%A0%D7%95%D7%9F+OR+%D7%91%D7%A0%D7%99%D7%99%D7%94+OR+%D7%9E%D7%9B%D7%A8%D7%96+OR+%D7%A0%D7%93%D7%9C%22%D7%9F+OR+%D7%93%D7%99%D7%95%D7%A8+OR+%D7%AA%D7%91%22%D7%A2)+when:14d&hl=iw&gl=IL&ceid=IL:he',
   'news', 'afula'),

  ('נדל"ן בעפולה',
   'https://news.google.com/rss/search?q=%D7%A2%D7%A4%D7%95%D7%9C%D7%94+(%D7%A0%D7%93%D7%9C%22%D7%9F+OR+%D7%93%D7%99%D7%95%D7%A8+OR+%D7%93%D7%99%D7%A8%D7%95%D7%AA+OR+%D7%A9%D7%9B%D7%95%D7%A0%D7%94+OR+%D7%94%D7%AA%D7%97%D7%93%D7%A9%D7%95%D7%AA+OR+%D7%AA%D7%91%22%D7%A2)+when:14d&hl=iw&gl=IL&ceid=IL:he',
   'news', 'afula'),

  ('נדל"ן בעמק יזרעאל ובסביבה',
   'https://news.google.com/rss/search?q=(%22%D7%A2%D7%9E%D7%A7+%D7%99%D7%96%D7%A8%D7%A2%D7%90%D7%9C%22+OR+%22%D7%9E%D7%92%D7%93%D7%9C+%D7%94%D7%A2%D7%9E%D7%A7%22+OR+%22%D7%A2%D7%A4%D7%95%D7%9C%D7%94+%D7%A2%D7%99%D7%9C%D7%99%D7%AA%22+OR+%22%D7%91%D7%99%D7%AA+%D7%A9%D7%90%D7%9F%22)+(%D7%A0%D7%93%D7%9C%22%D7%9F+OR+%D7%93%D7%99%D7%95%D7%A8+OR+%D7%91%D7%A0%D7%99%D7%99%D7%94)+when:14d&hl=iw&gl=IL&ceid=IL:he',
   'news', 'region'),

  ('נדל"ן ארצי — גלובס וכלכליסט',
   'https://news.google.com/rss/search?q=(site:globes.co.il+OR+site:calcalist.co.il)+(%D7%A0%D7%93%D7%9C%22%D7%9F+OR+%22%D7%9E%D7%97%D7%99%D7%A8%D7%99+%D7%94%D7%93%D7%99%D7%95%D7%A8%22)+when:7d&hl=iw&gl=IL&ceid=IL:he',
   'portal', 'national'),

  ('נדל"ן ארצי — TheMarker, ynet וביזפורטל',
   'https://news.google.com/rss/search?q=(site:themarker.com+OR+site:ynet.co.il+OR+site:bizportal.co.il)+(%D7%A0%D7%93%D7%9C%22%D7%9F+OR+%22%D7%9E%D7%97%D7%99%D7%A8%D7%99+%D7%94%D7%93%D7%99%D7%95%D7%A8%22)+when:7d&hl=iw&gl=IL&ceid=IL:he',
   'portal', 'national'),

  ('משכנתאות, ריבית ומדד מחירי הדיור',
   'https://news.google.com/rss/search?q=(%22%D7%91%D7%A0%D7%A7+%D7%99%D7%A9%D7%A8%D7%90%D7%9C%22+%D7%A8%D7%99%D7%91%D7%99%D7%AA)+OR+%D7%9E%D7%A9%D7%9B%D7%A0%D7%AA%D7%90%D7%95%D7%AA+OR+%22%D7%9E%D7%93%D7%93+%D7%9E%D7%97%D7%99%D7%A8%D7%99+%D7%94%D7%93%D7%99%D7%95%D7%A8%22+when:7d&hl=iw&gl=IL&ceid=IL:he',
   'news', 'national'),

  ('גלובס — ערוץ נדל"ן (פיד ישיר)',
   'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=607',
   'portal', 'national')
on conflict (url) do nothing;

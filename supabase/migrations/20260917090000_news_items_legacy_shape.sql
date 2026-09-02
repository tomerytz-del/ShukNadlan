-- ============================================================================
-- ‏news_items — התאמת הטבלה הישנה לסכימה של מנוע המבזקים
--
-- מה קרה: ‏20260909090000_news_ticker.sql פותח ב-`create table if not exists
-- public.news_items`. בפרודקשן הטבלה הזו כבר הייתה קיימת — מהסכימה המקורית
-- שקדמה לריפו (`039_news_ticker_automation_schema`), עם חמש עמודות בלבד:
-- ‏id, headline, article_id, published_at, source_url.
--
-- לכן ה-create היה no-op שקט, וכל מה שבא אחריו — ה-comment על `summary`,
-- ה-view, ה-policies — נשבר על עמודות שלא נוצרו. המיגרציה ההיא לא הייתה
-- עוברת גם אילו ה-CI היה תקין; היא נכתבה מול מסד ריק ולא מול המסד שיש.
--
-- כאן הטבלה הקיימת מתיישרת לסכימה שהמנוע (news_scraper.py) וה-view מצפים
-- לה, בלי לאבד שורות. על מסד חדש — שבו 20260909090000 כן יצרה את הטבלה
-- המלאה — כל ה-`add column if not exists` הם no-op, וכך הקובץ נשאר בטוח
-- בשני הכיוונים.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

alter table public.news_items
  add column if not exists source_id       uuid references public.news_sources(id) on delete set null,
  add column if not exists source_name     text,
  add column if not exists summary         text,
  add column if not exists url             text,
  add column if not exists image_url       text,
  add column if not exists category        text,
  add column if not exists scope           text not null default 'national',
  add column if not exists relevance_score integer not null default 5,
  add column if not exists status          text not null default 'published',
  add column if not exists raw_title       text,
  add column if not exists raw_content     text,
  add column if not exists analysis        jsonb,
  add column if not exists model           text,
  add column if not exists analyzed_at     timestamptz,
  add column if not exists created_at      timestamptz not null default now(),
  add column if not exists updated_at      timestamptz not null default now();

-- שתי שורות ה-seed הישנות (שתי הכותרות שהיו קשיחות ברצועה) נשמרות, אבל
-- ‏source_url חייב ערך: הוא המפתח שמונע כפילות מול מה שהמנוע יאסוף, והוא
-- ‏not null בסכימה החדשה.
update public.news_items
   set source_url = 'seed:' || id::text
 where source_url is null;

alter table public.news_items alter column source_url set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'news_items_scope_check') then
    alter table public.news_items add constraint news_items_scope_check
      check (scope in ('afula','region','national'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'news_items_relevance_check') then
    alter table public.news_items add constraint news_items_relevance_check
      check (relevance_score between 1 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'news_items_status_check') then
    alter table public.news_items add constraint news_items_status_check
      check (status in ('published','rejected'));
  end if;
end $$;

comment on column public.news_items.summary is
  'שתי שורות הסבר שנפתחות במודאל "כל העדכונים". ריק = מציגים רק את הכותרת.';
comment on column public.news_items.scope is
  'afula/region = מבזק מקומי, national = נדל"ן ארצי. קובע את סדר התצוגה ואת התגית ברצועה.';
comment on column public.news_items.status is
  'פריט שנדחה בסינון נשמר כ-rejected ולא נמחק, אחרת ההרצה הבאה הייתה אוספת ומנתחת אותו מחדש.';

create unique index if not exists news_items_source_url_key
  on public.news_items(source_url);

create index if not exists news_items_published_idx
  on public.news_items(published_at desc) where status = 'published';

drop trigger if exists news_items_set_updated_at on public.news_items;
create trigger news_items_set_updated_at
  before update on public.news_items
  for each row execute function public.set_updated_at();

-- ה-view נבנה מחדש כאן ולא רק ב-20260909090000: על המסד הקיים הוא מעולם לא
-- נוצר, כי המיגרציה ההיא נעצרה לפניו.
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

-- ============================================================================
-- כתבות ובלוגים — התוכן של המגזין
--
-- רצועת "כתבות ובלוגים" בדף הבית קיימת כבר, אבל עד עכשיו לא היה לה מקור:
-- היא ניסתה לקרוא את `news_items` (מבזק חיצוני) ונפלה חזרה לארבע כותרות
-- קשיחות בקוד. הטבלה כאן היא המקור האמיתי — מנהל/ת הפלטפורמה כותב/ת
-- כתבה ב-CRM, והיא מופיעה ברצועה ומקבלת עמוד משלה (article.html).
--
-- שלוש החלטות שכדאי להכיר:
--
--   * ‏slug נוצר בטריגר ולא בדפדפן. הוא חלק מהכתובת הציבורית, ולכן הוא צריך
--     להיווצר גם כשהשורה נכתבת מ-SQL ולא רק מהטופס.
--   * הסדר הציבורי הוא ‎published_at desc‎ ותו לא. הניווט "הקודמת/הבאה"
--     בעמוד הכתבה נשען עליו, ולכן הוא חייב להיות יציב — ‎published_at‎
--     נקבע פעם אחת, ברגע הפרסום, ולא בכל שמירה.
--   * טיוטה היא שורה רגילה עם ‎status = 'draft'‎. היא לא נראית לאף גולש
--     (ה-policy הציבורית דורשת ‎published‎), ולכן אפשר לשמור כתבה באמצע
--     הכתיבה בלי שהיא תדלוף לאתר.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

create table if not exists public.articles (
  id           uuid primary key default gen_random_uuid(),
  slug         text,
  title        text not null,
  subtitle     text,
  category     text,
  cover_url    text,
  body         text,
  author_name  text,
  status       text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_by   uuid references public.agency_members(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.articles is
  'כתבות ובלוגים של המגזין. נכתבות אך ורק מדף הניהול של מנהל/ת הפלטפורמה (crm.html → "כתבות ובלוגים").';
comment on column public.articles.slug is
  'הכתובת הקריאה של הכתבה (article.html?slug=…). נגזרת מהכותרת עם סיומת מזהה, ולכן ייחודית בלי לולאת ניסיונות.';
comment on column public.articles.title is 'הכותרת הראשית — גם בכרטיס ברצועה וגם ב-h1 של העמוד.';
comment on column public.articles.subtitle is
  'כותרת המשנה. משמשת גם כתקציר בכרטיס ברצועה וגם כתיאור המטא של העמוד — ולכן שווה לכתוב אותה כמשפט שלם.';
comment on column public.articles.category is 'תגית הנושא שמופיעה מעל הכותרת (מדריכים, ניתוח שוק, וכו׳).';
comment on column public.articles.cover_url is
  'תמונת הנושא. יושבת ב-bucket הציבורי property-images תחת <agent_id>/articles/, כמו שאר ההעלאות מה-CRM.';
comment on column public.articles.body is
  'גוף הכתבה כטקסט חופשי. שורה ריקה מפרידה בין פסקאות, ושורה שמסתיימת בנקודתיים מוצגת ככותרת ביניים — ראו renderBody ב-article.html.';
comment on column public.articles.published_at is
  'רגע הפרסום. נקבע פעם אחת במעבר ל-published (טריגר) ולא בכל שמירה, כי סדר הכתבות והניווט ביניהן נשענים עליו.';

-- ‏slug ייחודי, אבל רק כשהוא קיים: שורה שנוצרה מ-SQL בלי כותרת קריאה
-- עדיין תקפה, ומקבלת slug בטריגר שלמטה.
create unique index if not exists articles_slug_key
  on public.articles(slug) where slug is not null;

-- האינדקס שמשרת גם את הרצועה בדף הבית וגם את רשימת הניווט בעמוד הכתבה —
-- שתיהן קוראות בדיוק את הכתבות המפורסמות לפי סדר יורד.
create index if not exists articles_published_idx
  on public.articles(published_at desc) where status = 'published';

-- ---------------------------------------------------------------------------
-- ‏slug ו-published_at אוטומטיים
--
-- ‏[:alnum:] ב-UTF-8 כולל אותיות עבריות, ולכן הביטוי משאיר את הכותרת כמו
-- שהיא ורק מחליף את המפרידים. הסיומת היא שישה תווים מה-id — היא מה שמבטיח
-- ייחודיות בלי לבדוק התנגשויות.
--
-- ‏published_at נקבע רק כשהוא עדיין ריק, ולכן עריכה של כתבה שכבר פורסמה לא
-- מקפיצה אותה מחדש לראש הרצועה. החזרה לטיוטה ופרסום מחדש כן — אבל זו
-- פעולה מכוונת, ולא תופעת לוואי של תיקון פסיק.
-- ---------------------------------------------------------------------------
create or replace function public.articles_fill_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := nullif(trim(both '-' from
        regexp_replace(coalesce(new.title, ''), '[^[:alnum:]]+', '-', 'g')
      ), '') || '-' || left(new.id::text, 6);
    -- כותרת בלי אף תו אלפאנומרי (אימוג׳י בלבד, למשל) מחזירה null מהביטוי
    -- שלמעלה, ואז הקונקטנציה כולה null — הנפילה כאן שומרת על slug תקין.
    new.slug := coalesce(new.slug, 'article-' || left(new.id::text, 8));
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function public.articles_fill_defaults() from anon, authenticated;

drop trigger if exists articles_fill_defaults on public.articles;
create trigger articles_fill_defaults
  before insert or update on public.articles
  for each row execute function public.articles_fill_defaults();

drop trigger if exists articles_set_updated_at on public.articles;
create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ‏RLS
--
-- קריאה ציבורית מוגבלת לכתבות שפורסמו — טיוטה לא קיימת בשביל הגולש. כתיבה
-- שמורה למנהל/ת הפלטפורמה בלבד, באותה תבנית של rss_sources ו-neighborhoods.
-- ---------------------------------------------------------------------------
alter table public.articles enable row level security;

drop policy if exists "public reads published articles" on public.articles;
create policy "public reads published articles"
  on public.articles for select
  using (status = 'published' and (published_at is null or published_at <= now()));

drop policy if exists "platform admin manage articles" on public.articles;
create policy "platform admin manage articles"
  on public.articles for all
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
-- ה-view לא מרחיב גישה — ‎security_invoker=true‎ משאיר את ה-policy של הטבלה
-- בתוקף. תפקידו לרכז את תנאי ה"פורסם" במקום אחד, כדי שדף הבית ועמוד הכתבה
-- לא יחזרו עליו כל אחד בנפרד (ולא ישכחו אותו).
-- ---------------------------------------------------------------------------
create or replace view public.articles_public
with (security_invoker = true) as
select id, slug, title, subtitle, category, cover_url, body, author_name, published_at
from public.articles
where status = 'published'
  and (published_at is null or published_at <= now());

comment on view public.articles_public is
  'הכתבות המפורסמות, לפי מה שהאתר הציבורי קורא. הסדר נקבע בשאילתה — published_at desc.';

grant select on public.articles_public to anon, authenticated;

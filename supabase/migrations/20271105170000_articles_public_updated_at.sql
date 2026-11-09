-- ============================================================================
-- articles_public: updated_at בסוף הרשימה
-- ----------------------------------------------------------------------------
-- ביקורת ה-SEO של 5.11.2026 (docs/seo-audits/2026-11-05.md): הכתבות יצאו עם
-- datePublished בלבד. בלי dateModified גוגל ומנועי ה-AI אינם יודעים אם הכתבה
-- עודכנה מאז, ו"כמה עולה דירה בעפולה" מ-9.10 נראית ישנה גם אחרי שהמספרים
-- בה רועננו. articles.updated_at כבר קיימת ומתוחזקת בטריגר
-- articles_set_updated_at; כאן היא רק נחשפת ב-view.
--
-- create or replace view: אותן עמודות באותו סדר, והחדשה בסוף בלבד (כלל 3
-- ב-CLAUDE.md). security_invoker נשאר כפי שהוגדר ב-20260829180000_articles.sql.
-- og-tags.ts קורא select=* ולכן סובל גם את היעדר העמודה עד שהמיגרציה רצה.
-- ============================================================================

create or replace view public.articles_public
with (security_invoker = true) as
select id, slug, title, subtitle, category, cover_url, body, author_name, published_at, updated_at
from public.articles
where status = 'published'
  and (published_at is null or published_at <= now());

comment on view public.articles_public is
  'הכתבות המפורסמות, לפי מה שהאתר הציבורי קורא. הסדר נקבע בשאילתה — published_at desc. updated_at ל-dateModified.';

-- ההרשאות נשמרות ב-replace; נכתבות שוב במפורש, אידמפוטנטי.
grant select on public.articles_public to anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger
  on public.articles_public from public, anon, authenticated;

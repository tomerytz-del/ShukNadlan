-- ‏שער ה-cron של `geocode-backfill` סרק את כל טבלת העסקאות כל חמש דקות.
--
-- הסוכן התפעולי דיווח (28.9.2026) על "שאילתה איטית - ממוצע 459ms": פקודת
-- ה-cron `select net.http_post(...) where public.geocode_backfill_pending()`.
-- ‏`net.http_post` עצמו זול; הזמן כולו בשער. הוא קרא ל-
-- ‏`geocode_backfill_queue(1)`, שבונה union של נכסים ועסקאות, ממיין את כולם
-- ורק אז לוקח שורה אחת - כלומר בכל הפעלה: ‏seq scan על 23,722 עסקאות רשמיות,
-- ושש החלפות regex של `city_name_key` לכל אחת מ-717 השורות שעברו את הסינון,
-- כדי להשוות לעיר **אחת** שיש לה ספק גאוקוד פעיל. והתור היה ריק.
--
-- נמדד בפרודקשן (EXPLAIN ANALYZE, קריאה בלבד): 64ms לשער הקיים, 25ms לשער
-- שמתחיל מהערים הפעילות. על העתק מקומי באותו היקף, עם האינדקס שלמטה:
-- ‏30.6ms → 0.67ms, ‏Bitmap Index Scan על 158 שורות במקום 23,722.
--
-- שני שינויים, ושניהם אינם משנים מה נבחר:
--
-- 1. אינדקס חלקי על מפתח העיר, רק לעסקאות בלי קואורדינטות. ‏`city_name_key`
--    היא IMMUTABLE, ולכן מותרת בביטוי של אינדקס. החלקיות שומרת אותו קטן -
--    ‏~4,400 שורות מתוך 23,722 - ומתכווץ ככל שהגאוקוד מתקדם.
-- 2. ‏`geocode_backfill_pending()` אינו עובר עוד דרך התור. הוא שואל EXISTS
--    לכל ענף בנפרד, מהערים הפעילות אל השורות, **באותם תנאים בדיוק** כמו
--    ‏`geocode_backfill_queue` (‏3 ניסיונות, 20 שעות) - בלי union ובלי מיון,
--    כי שאלה של "האם יש" אינה צריכה סדר. התור עצמו לא השתנה: הוא רץ רק
--    כשהשער אומר שיש מה לעשות, ושם המיון נחוץ.
--
-- אידמפוטנטית: `if not exists`, ‏`create or replace` על אותה חתימה.

create index if not exists market_deals_official_geocode_pending_idx
  on public.market_deals_official (public.city_name_key(city))
  where lat is null or lng is null;

create or replace function public.geocode_backfill_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1
             from public.city_geocode_sources s
             join public.properties p
               on public.city_name_key(p.city) = s.city_key
            where s.active
              and p.status = 'active'
              and (p.lat is null or p.lng is null)
              and nullif(btrim(coalesce(p.street, '')), '')       is not null
              and nullif(btrim(coalesce(p.house_number, '')), '') is not null
              and p.geocode_attempts < 3::smallint
              and (p.geocode_attempted_at is null
                   or p.geocode_attempted_at < now() - interval '20 hours'))
      or exists (
           select 1
             from public.city_geocode_sources s
             join public.market_deals_official o
               on public.city_name_key(o.city) = s.city_key
            where s.active
              and (o.lat is null or o.lng is null)
              and nullif(btrim(coalesce(o.street, '')), '')       is not null
              and nullif(btrim(coalesce(o.house_number, '')), '') is not null
              and o.geocode_attempts < 3::smallint
              and (o.geocode_attempted_at is null
                   or o.geocode_attempted_at < now() - interval '20 hours'));
$$;

comment on function public.geocode_backfill_pending() is
  'האם יש מה לגאוקד - השער של ה-cron. אותם תנאים כמו geocode_backfill_queue, בלי union ובלי מיון, ודרך האינדקס market_deals_official_geocode_pending_idx.';

revoke all on function public.geocode_backfill_pending() from public, anon, authenticated;
grant execute on function public.geocode_backfill_pending() to service_role;

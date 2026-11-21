-- /prices: מחיר מבוקש מול מחיר עסקה - צבירה של מודעות יד2 ומדלן לפי עיר וחדרים.
--
-- listing_inventory (20271112130000) מחזיק את מה שחי עכשיו ביד2 ובמדלן. הדף
-- /prices מציג רק עסקאות שנסגרו. הפונקציה כאן נותנת לצדן את מחיר המודעות, כדי
-- שאפשר יהיה להשוות מה מבקשים למה שמשלמים באותה עיר ובאותו גודל דירה.
--
-- איך זה מחושב, ולמה כך (אותם כללי ניקוי כמו בצבירת העסקאות, כדי שהשוואה תהיה
-- של דירה מול דירה):
--   * מכירה בלבד, מודעה חיה (removed_at is null), שנראתה ב-7 הימים האחרונים:
--     מקור שהסנכרון שלו נעצר לא נשאר בטבלה לנצח.
--   * property_type = 'דירה' בלבד. במלאי יש גם בתים, מגרשים ומשקים (כ-40%),
--     ובצבירת העסקאות הם לא נכנסים.
--   * 1.5-8 חדרים, מחיר 200 אלף עד 15 מיליון, ושטח 25-400 מ"ר כשהוא ידוע
--     (במדלן הוא אינו נשמר).
--   * אותה חלוקה לחדרים כמו city_price_table: עד 2.5, 3, 4, 5, 5.5 ומעלה.
--   * תא מתחת ל-5 מודעות מושתק כאן, במסד, כמו בעסקאות.
--   * רק ערים ששייכות לשוק (cities.market_slug), כמו בעסקאות. ההצטרפות לפי
--     city_id (אינדקס, ושם העיר הקנוני של cities.name גם כשהמודעה כתובה בכינוי), ולא
--     לפי השם, שאינו ייחודי ב-cities.
-- אין ניכוי כפילויות: אותו נכס שמופיע ביד2 ובמדלן, או פעמיים ביד2, נספר פעמיים.
-- הסימון is_duplicate נבנה לסקירה ומתאים גם דירות שונות באותו מחיר (46% מהדירות
-- מסומנות), ולכן ניכוי לפיו היה מוחק דירות אמיתיות. החציון עמיד לכפילות כזו.
--
-- הפונקציה מחזירה צבירה בלבד: בלי קישור, בלי מזהה ובלי טלפון. רשומה ב-PUBLIC_RPC של
-- הסוכן התפעולי. ‏docs/city-prices.md.

create or replace function public.city_asking_price_table()
returns table(market_slug text, city text, rooms integer, listings integer,
              median_price numeric, as_of date)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select c.market_slug,
           c.name as city,
           case when i.rooms < 2.5 then 2
                when i.rooms < 3.5 then 3
                when i.rooms < 4.5 then 4
                when i.rooms < 5.5 then 5
                else 6 end as rooms,
           i.price,
           i.last_seen_at
      from public.listing_inventory i
      join public.cities c on c.id = i.city_id
     where c.market_slug is not null
       and i.source in ('yad2', 'madlan')
       and i.deal_type = 'sale'
       and i.removed_at is null
       and i.last_seen_at > now() - interval '7 days'
       and i.property_type = 'דירה'
       and i.rooms between 1.5 and 8
       and i.price between 200000 and 15000000
       and (i.size_sqm is null or i.size_sqm between 25 and 400)
  )
  select l.market_slug,
         l.city,
         l.rooms,
         count(*)::int,
         round(percentile_cont(0.5) within group (order by l.price)::numeric, -3),
         (max(l.last_seen_at) at time zone 'Asia/Jerusalem')::date
    from l
   group by l.market_slug, l.city, l.rooms
  having count(*) >= 5
   order by l.market_slug, l.city, l.rooms;
$$;

comment on function public.city_asking_price_table() is
  'מחיר חציוני מבוקש (מודעות יד2 ומדלן, מכירה, דירות) לפי עיר וחדרים, תא מתחת ל-5 מושתק. צבירה בלבד. הדף /prices.';

revoke all on function public.city_asking_price_table() from public, anon, authenticated;
grant execute on function public.city_asking_price_table() to anon, authenticated, service_role;

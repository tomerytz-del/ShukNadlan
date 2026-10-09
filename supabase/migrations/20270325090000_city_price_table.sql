-- ---------------------------------------------------------------------------
-- מחירי דירות לפי עיר וחדרים - הטבלה שמאחורי /prices
--
-- דוח ה-SEO של 9.10.2026 מצא שאין באתר אף דף שעונה על השאלה הכי נפוצה
-- בחיפוש נדל"ן מקומי - "כמה עולה דירה בעפולה" - למרות שהנתון יושב אצלנו:
-- ‏market_deals_official מחזיק את העסקאות הרשמיות של רשות המסים שדוח
-- ה-CMA נשען עליהן (‏docs/market-deals-official.md).
--
-- הטבלה עצמה אינה פתוחה ל-anon, ובכוונה: עסקה בודדת נושאת כתובת, גוש
-- וחלקה. מה שנפתח כאן הוא **צבירה בלבד**, ובשלושה גבולות:
--
--   ‏· תא (עיר × חדרים) עם פחות מ-5 עסקאות אינו מוחזר - חציון של שתי
--     עסקאות מזהה אותן, ואינו אומר דבר על השוק.
--   ‏· דירות בלבד: ‏property_type 'דירה' או ריק (רוב הריקים הם דירות -
--     יש להן חדרים ושטח), ובלי 'בנין', 'קרקע' ו'משק חקלאי', שמחירם אינו
--     מחיר דירה. ‏1.5-8 חדרים, ‏25-400 מ"ר, ‏200 אלף עד 15 מיליון ₪ -
--     מסננים עסקאות חלקיות (העברת חלק בדירה) ורשומות שגויות.
--   ‏· 12 חודשים שמסתיימים **בעסקה האחרונה במאגר** ולא בהיום: המאגר
--     מתעדכן באיחור של חודשים (רשות המסים מדווחת באיחור), וחלון של
--     "12 החודשים האחרונים" מהיום היה מתרוקן בהדרגה בלי שאיש ישים לב.
--
-- ‏SECURITY DEFINER כי anon אינו קורא את הטבלה; הפונקציה אינה מקבלת
-- פרמטרים ואינה כותבת, ולכן אין מה לבדוק בקורא/ת. היא רשומה ב-PUBLIC_RPC
-- של הסוכן התפעולי (‏ops_agent/config.py).
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

create or replace function public.city_price_table()
returns table (
  market_slug   text,
  city          text,
  rooms         int,
  deals         int,
  median_price  numeric,
  median_ppsqm  numeric,
  period_start  date,
  period_end    date
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select max(sold_at) as period_end from public.market_deals_official
  ),
  d as (
    select c.market_slug,
           o.city,
           -- ‏2 = עד 2.5 חדרים, ‏6 = 5.5 ומעלה
           case when o.rooms < 2.5 then 2
                when o.rooms < 3.5 then 3
                when o.rooms < 4.5 then 4
                when o.rooms < 5.5 then 5
                else 6 end as rooms,
           o.sale_price,
           o.sale_price / o.size_sqm as ppsqm
      from public.market_deals_official o
      join public.cities c on c.name = o.city
      cross join bounds b
     where c.market_slug is not null
       and o.sold_at > b.period_end - interval '12 months'
       and coalesce(o.property_type, 'דירה') = 'דירה'
       and o.rooms between 1.5 and 8
       and o.size_sqm between 25 and 400
       and o.sale_price between 200000 and 15000000
  )
  select d.market_slug,
         d.city,
         d.rooms,
         count(*)::int,
         round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3),
         round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -2),
         ((select period_end from bounds) - interval '12 months')::date + 1,
         (select period_end from bounds)
    from d
   group by d.market_slug, d.city, d.rooms
  having count(*) >= 5
   order by d.market_slug, d.city, d.rooms;
$$;

comment on function public.city_price_table() is
  'מחיר חציוני לדירה ולמ"ר לפי עיר וחדרים, 12 חודשים מהעסקה האחרונה במאגר הרשמי. תא עם פחות מ-5 עסקאות מושתק. הדף /prices.';

revoke all on function public.city_price_table() from public, anon, authenticated;
grant execute on function public.city_price_table() to anon, authenticated, service_role;

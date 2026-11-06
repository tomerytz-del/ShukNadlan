-- ============================================================================
-- "עסקאות אחרונות בסביבה" בדף הנכס הציבורי (6.11.2026, PR B)
--
-- ## מה היה
--
-- העסקאות הרשמיות של רשות המיסים (market_deals_official) שירתו את דוח
-- ה-CMA ב-CRM ואת גבריאלה, ואת דפי /deals ו-/prices. בדף הנכס עצמו - כלום.
-- הגולש/ת שראה/תה "1,700,000 ₪" לא ראה/תה במה נמכרו דירות דומות ברחוב ליד,
-- בזמן שאתרי השוואה מציגים בדיוק את זה ליד כל מודעה (סיור ב-eretzly.com,
-- "Recently Sold & Price Compare"; docs/regional-pages.md 6.11.2026).
--
-- ## מה כאן
--
-- פונקציה ציבורית אחת, קריאה בלבד, לנכס פעיל למכירה: עד חמש עסקאות
-- רשמיות **מאותו סוג** (same_type של cma_deal_pool - אותו כלל של הדוח,
-- לא כלל חדש), ברדיוס 2,000 מ' ו-24 חודשים, הקרובות ביותר קודם. לכל
-- עסקה: חודש המכירה, חדרים, שטח, מחיר, מחיר למ"ר, מרחק, ורחוב בלבד.
--
-- **בלי מספר בית, גוש וחלקה** - אותו כלל של דפי /deals (docs/settlement-deals.md).
-- **בלי ציון** ("מעל/מתחת למחיר"): עובדות בלבד. דירוג מחיר היה הערכת שווי
-- בשם אחר, ומודעה של מתווך/ת שמקבלת ציון מהפלטפורמה שלו/ה (החלטת תומר,
-- 6.11.2026). ההשוואה למחיר למ"ר של הנכס נעשית בדפדפן, כשני מספרים זה
-- ליד זה.
--
-- ## למה SECURITY DEFINER
--
-- market_deals_official סגורה ל-anon, ו-cma_deal_pool אינה פתוחה לו.
-- הפונקציה מקבלת רק uuid של נכס, מחזירה רק מה שכתוב למעלה, ורק לנכס
-- פעיל - ולכן נרשמת ב-PUBLIC_RPC של הסוכן התפעולי (ops_agent/config.py).
--
-- ## ביצועים
--
-- קריאה אחת ל-cma_deal_pool לכל צפייה בדף של נכס למכירה (הדוח קורא לה
-- פעמיים). לדירה רגילה הבריכה זולה (ה-CTE הכבדים רצים רק לפנטהאוז ולבית;
-- הסקיל cma-report, סעיף 6). אם הדף יאט - מטמון בדפדפן או materialized
-- view, לא הרחבת הרדיוס.
-- ============================================================================
create or replace function public.property_recent_deals(p_property_id uuid)
returns table (
  sold_month      date,
  rooms           numeric,
  size_sqm        numeric,
  sale_price      numeric,
  price_per_sqm   numeric,
  distance_meters numeric,
  street          text,
  city            text
)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select pr.id, pr.lat, pr.lng, pr.property_type, pr.rooms
      from public.properties pr
     where pr.id = p_property_id
       and pr.status = 'active'
       and pr.deal_type is distinct from 'rent'
       and pr.lat is not null and pr.lng is not null
  )
  select date_trunc('month', d.sold_at)::date as sold_month,
         d.rooms,
         d.size_sqm,
         d.sale_price,
         d.price_per_sqm,
         d.distance_meters,
         nullif(btrim(o.street), '') as street,
         o.city
    from p
    cross join lateral public.cma_deal_pool(
      p.lat, p.lng,
      (current_date - interval '24 months')::date,
      2000,
      p.id,
      p.property_type,
      p.rooms
    ) d
    join public.market_deals_official o on o.id = d.id
   where d.same_type
     and d.price_basis = 'official'
     and d.sale_price > 0
   order by d.distance_meters, d.sold_at desc
   limit 5;
$$;

comment on function public.property_recent_deals(uuid) is
  'דף הנכס: עד 5 עסקאות רשמיות מאותו סוג ברדיוס 2,000 מ'' ו-24 חודשים, רחוב בלבד, לנכס פעיל למכירה. docs/cma.md';

revoke all on function public.property_recent_deals(uuid) from public, anon, authenticated;
grant execute on function public.property_recent_deals(uuid) to anon, authenticated, service_role;

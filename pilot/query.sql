-- פיילוט "עסקאות בעפולה" - השאילתה שממנה נבנה data.json.
-- הטווח: החודש המלא האחרון שדווח (אוגוסט 2026). 7 ו-30 הימים האחרונים ריקים:
-- העסקה האחרונה במאגר היא מ-31.8.2026, אף שהיישוב סונכרן ב-9.10.2026 (פיגור הדיווח).
--
-- ניקוי כפילויות: שורה בלי property_type שיש לה "תאומה" עם property_type -
-- אותו גוש, חלקה, מחיר ושטח, ותאריך בהפרש של עד יום - נחשבת כפולה ומוצאת.
-- (16 מתוך 17 השורות בלי סוג נכס באוגוסט הן כאלה; התאומה תמיד יום אחרי.)
with d as (
  select * from market_deals_official
  where city = 'עפולה' and sold_at between '2026-08-01' and '2026-08-31'
),
c as (
  select a.* from d a
  where not (a.property_type is null and exists (
    select 1 from d b
    where b.id <> a.id and b.property_type is not null
      and a.gush = b.gush and a.helka = b.helka
      and a.sale_price = b.sale_price and a.size_sqm = b.size_sqm
      and abs(a.sold_at - b.sold_at) <= 1))
)
select count(*)                                 as deals,
       round(avg(sale_price))                   as avg_price,
       round(avg(sale_price / size_sqm))        as avg_price_per_sqm,   -- ממוצע של מחיר למ"ר בכל עסקה
       min(sale_price), max(sale_price)
from c;
-- הזולה/היקרה: select ... from c order by sale_price limit 1 / desc limit 1
-- השכונות:     select neighborhood, count(*) from c group by 1 order by 2 desc

-- סינון בית צמוד קרקע (הוסף אחרי שהעלית את החשד): מוציאים מ-c גם
--   where not (coalesce(floor,'') ~ 'קרקע' and coalesce(floor,'') ~ '(,| ו)')
-- ("קרקע, ראשונה" = שתי קומות מהקרקע = כנראה קוטג'). באוגוסט זו עסקה אחת: 3,000,000 ₪.
-- התוצאה: 40 עסקאות, ממוצע 1,435,250 ₪, 13,679 ₪ למ"ר.

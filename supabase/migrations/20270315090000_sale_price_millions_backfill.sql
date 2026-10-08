-- ============================================================================
-- מחירי מכירה שנכתבו במיליונים: 1.48 → ‏1,480,000 ₪
-- ============================================================================
-- ייבוא מקובץ ב-7.10.2026 העלה 14 נכסים למכירה (עפולה ושדה נחום) עם
-- מחיר ‏1.30 עד 4.69 — הסוכן/ת כתב/ה את המחיר במיליונים, כמו שמדברים.
-- הנכסים הוצגו ב-₪1.48 ונפלו מכל חיפוש עם טווח מחירים. הקוד מתוקן באותו
-- PR (‏salePriceFromMillions ב-assets/crm.js, בייבוא ובטופס הנכס).
--
-- הכלל: מכירה במחיר חיובי מתחת ל-100 היא מיליונים. אין מחיר מכירה אמיתי
-- בטווח הזה, ולכן אין כאן ניחוש. השכרה לא נגעים בה. אידמפוטנטית: אחרי
-- ההרצה הראשונה אין שורות שעונות לתנאי.
--
-- תופעות לוואי מכוונות: שינוי מחיר מפעיל את התראות החיפוש השמור ואת
-- ההתאמות ללקוחות — הנכסים האלה היו צריכים להתאים להם מההתחלה. הפרסום
-- לפייסבוק/אינסטגרם עדיין ממתין, והפוסט נבנה מהמסד בזמן הפרסום.
--
-- טביעת האצבע של התיאור השיווקי כוללת את `price`, ולכן תיקון תמים היה
-- מסמן את כל ה-14 כמתיישנים — 14 קריאות Claude על תיאורים שאינם מזכירים
-- מחיר. כמו ב-20261202090000_long_dash_backfill: אוספים מי היה טרי לפני,
-- ומחזירים לו את טביעת האצבע אחרי.
-- ============================================================================

do $$
declare
  v_fresh uuid[];
  v_rows  bigint;
begin
  select array_agg(p.id) into v_fresh
    from public.properties p
   where p.deal_type = 'sale'
     and p.price > 0 and p.price < 100
     and p.marketing_description_fingerprint is not null
     and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p);

  update public.properties
     set price = round(price * 1000000)
   where deal_type = 'sale'
     and price > 0 and price < 100;
  get diagnostics v_rows = row_count;
  raise notice 'מחירים שתוקנו: % שורות', v_rows;

  update public.properties p
     set marketing_description_fingerprint = public.property_marketing_fingerprint(src)
    from public.properties src
   where src.id = p.id
     and p.id = any(coalesce(v_fresh, '{}'::uuid[]))
     and p.marketing_description_fingerprint is distinct from
         public.property_marketing_fingerprint(src);
  get diagnostics v_rows = row_count;
  raise notice 'טביעות אצבע שהוחזרו: % שורות', v_rows;
end $$;

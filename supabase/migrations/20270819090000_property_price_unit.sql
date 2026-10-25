-- ============================================================================
-- יחידת המחיר של נכס - מחיר כולל, או מחיר למ"ר לחודש
--
-- בשכירות מסחרית מקובל לנקוב מחיר למ"ר, ויש סוכנים שמקלידים אותו בשדה המחיר
-- (1305: מחיר 20, 3,000 מ"ר). האתר, הבוטים והפוסטים הציגו "20 ₪ לחודש". עד
-- היום כלי הפרסום בקבוצות ניחש את היחידה מהתיאור של הסוכן/ת (price_unit()
-- ב-marketing/reel_worker/tools/queue.py); מעכשיו היא שדה בנכס.
--
--   price_unit = 'total'    - ברירת המחדל: מחיר כולל (במכירה), או לחודש (בשכירות)
--   price_unit = 'per_sqm'  - המחיר הוא ₪ למ"ר לחודש. בשכירות מסחרית בלבד.
--
-- האילוץ בודק רק את הערך ולא את הצירוף עם deal_type / category: נכס שעבר
-- ממסחרי למגורים בעריכה, בייבוא או בבוט היה נופל בשמירה. מי שמציג/ה קורא/ת
-- את היחידה רק בשכירות מסחרית (priceIsPerSqm), ובכל מקום אחר היא 'total'.
--
-- ‏price_per_sqm (עמודה מחושבת, price / size_sqm) אינה משתנה: בנכס כזה היא יוצאת
-- 0 או null, ולכן אינה מוצגת. המחיר למ"ר הוא price עצמו.
--
-- המילוי למפרע: שמונה הנכסים שהתיאור של הסוכן/ת אומר בהם במפורש שהמספר בשדה
-- המחיר הוא למ"ר (החלטת תומר, 25.10.2026). נכס שהתיאור שלו אינו אומר זאת, או
-- אומר מספר אחר (1308: מחיר 140, "75 ש"ח למ"ר"), נשאר 'total'.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

alter table public.properties
  add column if not exists price_unit text not null default 'total';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'properties_price_unit_chk') then
    alter table public.properties
      add constraint properties_price_unit_chk
      check (price_unit in ('total', 'per_sqm'));
  end if;
end $$;

comment on column public.properties.price_unit is
  'total = מחיר כולל (לחודש בשכירות); per_sqm = ₪ למ"ר לחודש (שכירות מסחרית בלבד)';

update public.properties
   set price_unit = 'per_sqm'
 where listing_number in (1305, 1306, 1310, 1312, 1314, 1315, 1317, 1334)
   and deal_type = 'rent' and category = 'commercial'
   and price < 500
   and price_unit = 'total';

-- ---------------------------------------------------------------------------
-- יחידת המחיר של נכס: סה״כ / למ״ר / לחודש (docs/price-unit.md)
--
-- נכס מסחרי מושכר נמסר הרבה פעמים במחיר למ״ר לחודש, והאתר הציג אותו
-- כשכירות חודשית: "₪140/חוד׳" על חנות של 170 מ״ר, ו-"₪20/חוד׳" על מגרש של
-- 2.25 דונם. זה נראה כמו טעות ופוגע באמון.
--
-- price_unit:
--   'total' - המחיר הוא סך הכול (מכירה)
--   'month' - שכירות חודשית לכל הנכס
--   'sqm'   - מחיר למ״ר (בהשכרה - למ״ר לחודש)
--   null    - לא צוין: השכרה מוצגת כ-'month' ומכירה כ-'total', כמו עד היום.
--
-- המילוי למפרע: נכס מסחרי מושכר במחיר מתחת ל-200 ₪ - אותו סף שבו הייבוא
-- מזהה מחיר למ"ר בקובץ של יד2 (YAD2_PRICE_PER_SQM_BELOW). בספירה של
-- 25.10.2026 - 13 נכסים, הגבוה שבהם 140 ₪, והבא אחריו 1,800 ₪.
--
-- העמודה אינה בטביעת האצבע של התיאור השיווקי, ולכן המילוי אינו מסמן אף
-- נכס כ"כדאי לרענן".
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

alter table public.properties
  add column if not exists price_unit text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_price_unit_check') then
    alter table public.properties
      add constraint properties_price_unit_check
      check (price_unit is null or price_unit in ('total', 'month', 'sqm'));
  end if;
end;
$$;

comment on column public.properties.price_unit is
  'יחידת המחיר: total (סה״כ), month (לחודש), sqm (למ״ר; בהשכרה למ״ר לחודש). null = לפי סוג העסקה.';

update public.properties
   set price_unit = 'sqm'
 where price_unit is null
   and category = 'commercial'
   and deal_type = 'rent'
   and price > 0
   and price < 200;

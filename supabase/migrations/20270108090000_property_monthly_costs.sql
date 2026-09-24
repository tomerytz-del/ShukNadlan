-- ============================================================================
-- עלויות שוטפות של נכס — ועד בית / דמי ניהול, ארנונה, ומע"מ על המחיר
--
-- שני השדות נכנסים עם עיצוב טופס הנכס מחדש (מקטע "מפרט טכני ועלויות
-- שוטפות"). הם תכונה של המודעה ולא של הבעלים, ולכן יושבים ב-properties
-- ולא ב-property_owners: קונה או שוכר/ת שואלים עליהם לפני כל שאלה אחרת.
--
-- היחידות שונות בכוונה, כי כך הן נגבות בפועל ונמסרות בטלפון:
--   maintenance_fee  - ‏₪ לחודש (ועד בית / דמי ניהול)
--   arnona           - ‏₪ לתקופת החיוב של העירייה, והיא תלויה בקטגוריה:
--                      מגורים - לחודשיים, מסחרי - לחודש.
--
-- ‏arnona נשמרת כפי שהיא מופיעה בשובר, ולא מנורמלת לחודש: זה המספר שהסוכן/ת
-- מקליד/ה מהחשבון ומוסר/ת ללקוח. מי שמשווה בין נכסים או מציג/ה את הסכום
-- קורא/ת את היחידה מ-category.
--
-- price_includes_vat - שלושה מצבים, ורלוונטי למסחרי בלבד:
--   null  = לא צוין -> באתר מוצג "+ מע״מ" ליד מחיר מסחרי, כי כך נמסר מחיר
--           מסחרי כמעט תמיד, וקונה שמניח/ה שהמחיר כולל טועה ב-18%.
--   false = לא כולל מע"מ (אותה תצוגה, אבל כהצהרה של הסוכן/ת)
--   true  = כולל מע"מ -> בלי תוספת
-- במגורים העמודה נשארת null ואינה מוצגת.
--
-- גוש וחלקה אינם כאן: הם כבר נשמרים ב-property_planning_info, שהטופס
-- כותב וקורא ממנה, ושם הם אינם נחשפים לגולשים (docs/govmap.md).
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

alter table public.properties
  add column if not exists maintenance_fee numeric,
  add column if not exists arnona numeric,
  add column if not exists price_includes_vat boolean;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'properties_maintenance_fee_chk') then
    alter table public.properties
      add constraint properties_maintenance_fee_chk
      check (maintenance_fee is null or maintenance_fee >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_arnona_chk') then
    alter table public.properties
      add constraint properties_arnona_chk
      check (arnona is null or arnona >= 0);
  end if;
end $$;

comment on column public.properties.maintenance_fee is 'ועד בית / דמי ניהול, ₪ לחודש';
comment on column public.properties.arnona is 'ארנונה, ₪ לתקופת חיוב: לחודשיים במגורים, לחודש במסחרי (לפי category)';
comment on column public.properties.price_includes_vat is 'מסחרי: null=לא צוין (מוצג + מע״מ), false=לא כולל, true=כולל';

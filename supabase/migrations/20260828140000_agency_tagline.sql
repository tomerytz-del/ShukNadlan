-- ============================================================================
-- משפט המוטו של המשרד
--
-- ‏agencies.description הוא פסקת ההסבר ("משרד תיווך פעיל בעפולה והעמק, מתמחה
-- ב…"). המוטו הוא דבר אחר: שורה קצרה ושיווקית שיושבת מתחת לשם המשרד, בסגנון
-- "חיפשתם נכס, מצאתם בית". שני שדות ולא אחד, כי הם מופיעים בשני מקומות שונים
-- בדף ובשני אורכים שונים — מוטו באורך פסקה מאבד את כל האפקט שלו.
--
-- מוגבל ל-120 תווים: מה שארוך מזה כבר לא מוטו אלא תיאור, ובדף הוא נשבר לשתי
-- שורות מתחת לשם ודוחף את כל השאר.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

alter table public.agencies
  add column if not exists tagline text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agencies_tagline_check') then
    alter table public.agencies
      add constraint agencies_tagline_check
      check (tagline is null or length(btrim(tagline)) <= 120);
  end if;
end $$;

comment on column public.agencies.tagline is
  'משפט מוטו קצר שמוצג מתחת לשם המשרד בדף הציבורי. נפרד מ-description שהוא פסקת ההסבר.';

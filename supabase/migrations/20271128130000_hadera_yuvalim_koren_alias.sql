-- פרדס חנה-כרכור: "יובלים וקורן" כינוי משותף לשתי השכונות
--
-- בבדיקה הסופית של שוק חדרה לקראת ההדגמה (21.11.2026) נשארו 25 עסקאות
-- של רשות המיסים בשם השכונה "יובלים וקורן", כולן בפרדס חנה-כרכור, בלי קישור
-- לשכונה. השם עצמו אומר שתיים: "יובלים" ו"קורן" הן שתי שכונות נפרדות
-- שיובאו מ-GovMap. הפינים מאשרים: מ-25 העסקאות 21 נופלות בתוך יובלים ו-4 בתוך
-- קורן, ואף אחת מחוץ לשתיהן.
--
-- כינוי משותף (shared = true) הוא בדיוק המנגנון לזה: neighborhood_ids_for
-- מחזירה את שתי השכונות, והעסקה נספרת בהשוואה לפי שכונה של כל אחת מהן,
-- כמו "הדר" בחיפה. כינוי רגיל היה מחבר את כולן לאחת בלבד ומטעה.
--
-- מה לא כאן, ולמה:
--   * "המושבה" בבנימינה-גבעת עדה - שתי מושבות שונות (6 פינים באחת, 2 בשנייה).
--   * "שלמה" בחדרה - 4 עסקאות מפוזרות על שלוש שכונות (שם רחוב, לא שכונה).
--   * "נחליאל" בחדרה - 4 עסקאות, כולן מחוץ לכל מצולע.
--   * "נווה עובד" בפרדס חנה - 6 עסקאות על שתי שכונות שונות.
--   * שמות של עסקה אחת או שתיים ("קנדי", "משכנות", "נווה אבות" ועוד).
--
-- הטריגר על neighborhood_aliases מקשר מחדש את העסקאות של העיר מעצמו
-- (neighborhood_relink_deals, 20270114091000). אידמפוטנטית.

insert into public.neighborhood_aliases (neighborhood_id, alias, shared, note)
select n.id, 'יובלים וקורן', true,
       'כינוי משותף: השם ברשות המיסים כולל שתי שכונות (21 פינים ביובלים, 4 בקורן; 21.11.2026)'
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.name in ('יובלים', 'קורן')
 where c.name_key = public.city_name_key('פרדס חנה-כרכור') and c.active
on conflict (neighborhood_id, alias_key) do nothing;

do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.neighborhood_aliases a
    join public.neighborhoods n on n.id = a.neighborhood_id
    join public.cities c on c.id = n.city_id
   where c.name_key = public.city_name_key('פרדס חנה-כרכור')
     and a.shared and a.alias_key = public.neighborhood_name_key('יובלים וקורן');
  if v_n <> 2 then
    raise warning 'צפוי כינוי משותף לשתי שכונות (יובלים, קורן); נמצאו % - שכונה ששמה השתנה?', v_n;
  else
    raise notice 'כינוי משותף "יובלים וקורן" נרשם לשתי השכונות';
  end if;
end $$;

-- שוק חדרה והסביבה: כינויי עיר למה שסוכנים וגולשים באמת כותבים
--
-- בבדיקה לקראת ההדגמה (21.11.2026) city_id_for_name לא פתרה "פרדס חנה",
-- "כרכור", "בנימינה", "גבעת עדה" ו"זכרון" - רק את השמות המלאים שברישום
-- ("פרדס חנה-כרכור", "בנימינה-גבעת עדה", "זכרון יעקב"). התוצאה: "למרחב 10
-- פרדס חנה" בוואטסאפ עונה "לא מצאתי", אף שיש 1,025 עסקאות בעיר, ודוח CMA
-- לכתובת נופל על העיר לפני שהגיע לרחוב. אותו דפוס כמו "תל אביב" מול
-- "תל אביב - יפו" (20271109180000, סעיף 1), עם אותו insert.
--
-- מה לא כאן: שכונות (ייבוא מ-GovMap מהאתר החי, לא מיגרציה) ו"עדכן עסקאות".

insert into public.city_aliases (city_id, alias)
select c.id, v.alias
  from (values ('פרדס חנה',   'פרדס חנה-כרכור'),
               ('כרכור',      'פרדס חנה-כרכור'),
               ('בנימינה',    'בנימינה-גבעת עדה'),
               ('גבעת עדה',   'בנימינה-גבעת עדה'),
               ('זכרון',      'זכרון יעקב')
       ) as v(alias, city_name)
  join public.cities c on c.name_key = public.city_name_key(v.city_name) and c.active
 where not exists (select 1 from public.cities x where x.name_key = public.city_name_key(v.alias))
on conflict (alias_key) do nothing;

do $$
declare v_missing text[];
begin
  select array_agg(a) into v_missing
    from unnest(array['פרדס חנה','כרכור','בנימינה','גבעת עדה','זכרון']) as a
   where public.city_id_for_name(a) is null;
  if v_missing is not null then
    raise warning 'כינויי חדרה שעדיין אינם נפתרים לעיר: %', v_missing;
  else
    raise notice 'כינויי שוק חדרה נפתרים: פרדס חנה, כרכור, בנימינה, גבעת עדה, זכרון';
  end if;
end $$;

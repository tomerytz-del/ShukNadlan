-- ============================================================================
-- ייבוא מיד2: מספר המודעה ביד2, שכונות ברירת מחדל, ואזור תעשייה אלון התבור
--
-- ## מה נמצא
--
-- קובץ "המודעות שלי" שיורד מיד2 נקלט מאז הקומיט הקודם באשף הייבוא
-- (docs/property-import.md). נשארו בו שלושה פערים:
--
-- 1. **אין מזהה למודעה.** ייבוא חוזר של אותו קובץ - או של אותו קובץ בידי
--    הסוכן/ת השני/ה במשרד (בקובץ הראשון שני הסוכנים מופיעים על כל מודעה) -
--    נבדק רק לפי כותרת ומחיר, ומחיר שהשתנה מייצר מודעה שנייה לאותה דירה.
-- 2. **שלוש שכונות של יד2 בלי מקבילה אצלנו** - "שכון עובדים" (10 מודעות),
--    "עפולה הצעירה" ו"בנה ביתך".
-- 3. **"אזור תעשייה אלון התבור"** מופיע ביד2 כיישוב, ואצלנו אינו יישוב
--    ואינו שכונה.
--
-- ## מה נכנס
--
-- 1. ‏`properties.yad2_listing_id` ואינדקס ייחודי לפי משרד: מודעה של יד2
--    נקלטת פעם אחת למשרד. ‏`yad2_listing_ids_taken()` עונה לאשף אילו מספרים
--    כבר קיימים במשרד ואצל מי - ‏RLS אינו מראה לסוכן/ת נכס בארכיון של
--    עמית/ה, ובלעדיה הכפילות הייתה נופלת על האינדקס באמצע הקליטה.
-- 2. כינויי שכונה (הכרעת מנהל הפלטפורמה, 18.10.2026): עפולה הצעירה = עפולה
--    עלית, שכון עובדים = מרכז העיר, בנה ביתך = מערב העיר. בייבוא אלה ברירת
--    מחדל: כשיש כתובת מלאה, השכונה נקבעת מהפין (‏properties_set_neighborhood_trg)
--    והכינוי נכנס רק כשהפין לא הכריע.
-- 3. שכונה "אזור תעשייה אלון התבור" בעפולה, מסומנת `is_industrial`, **בלי
--    מרכז ובלי גבול**: אין לנו קואורדינטות מאומתות שלה, ומרכז מומצא היה מציב
--    בו כל נכס דרך ‏`properties_zone_location_trg`. הגבול נמתח בניהול השכונות
--    ב-CRM, ומאותו רגע הנכסים מקבלים מיקום משוער.
-- 4. קריאה ציבורית ב-`neighborhood_aliases`: עד היום רק הבוט קרא אותה (ב-
--    service_role), והאשף בדפדפן לא ראה אף כינוי. שמות שכונות אינם מידע פרטי.
--
-- בטוחה להרצה חוזרת. תיעוד: docs/property-import.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מספר המודעה ביד2
-- ---------------------------------------------------------------------------
alter table public.properties add column if not exists yad2_listing_id bigint;

comment on column public.properties.yad2_listing_id is
  'מספר המודעה ביד2 ("מספר מודעה" בקובץ "המודעות שלי"). ייחודי במשרד - מודעה של יד2 נקלטת פעם אחת.';

create unique index if not exists properties_agency_yad2_listing_uniq
  on public.properties (agency_id, yad2_listing_id)
  where yad2_listing_id is not null;

-- אילו מהמספרים כבר קיימים במשרד של הקורא/ת, ואצל מי. מחזירה מספר ושם
-- סוכן/ת בלבד - לא את הנכס - כי היא עוקפת את ה-RLS על נכסים בארכיון.
create or replace function public.yad2_listing_ids_taken(p_ids bigint[])
returns table (yad2_listing_id bigint, agent_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.yad2_listing_id, coalesce(m.display_name, '')
    from public.properties p
    left join public.agency_members m on m.id = p.agent_id
   where p.agency_id = public.current_agency_id()
     and p.yad2_listing_id = any (p_ids)
$$;

comment on function public.yad2_listing_ids_taken(bigint[]) is
  'אשף הייבוא: מספרי מודעה של יד2 שכבר קיימים במשרד של הקורא/ת, ושם הסוכן/ת.';

revoke all on function public.yad2_listing_ids_taken(bigint[]) from public, anon, authenticated;
grant execute on function public.yad2_listing_ids_taken(bigint[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. כינויי שכונה מיד2
-- ---------------------------------------------------------------------------
insert into public.neighborhood_aliases (neighborhood_id, alias, shared, note)
select n.id, v.alias, false, v.note
  from (values
    ('עפולה הצעירה', 'עפולה עלית',               'שם השכונה ביד2 (הכרעת מנהל הפלטפורמה, 18.10.2026)'),
    ('שכון עובדים',  'מרכז העיר',                'שם השכונה ביד2 (הכרעת מנהל הפלטפורמה, 18.10.2026)'),
    ('שיכון עובדים', 'מרכז העיר',                'כתיב מלא של "שכון עובדים" (הכרעת מנהל הפלטפורמה, 18.10.2026)'),
    ('בנה ביתך',     'מערב העיר (שיכון גאולים)', 'שם השכונה ביד2 (הכרעת מנהל הפלטפורמה, 18.10.2026)')
  ) as v(alias, hood, note)
  join public.cities c on c.name = 'עפולה'
  join public.neighborhoods n on n.city_id = c.id and n.name = v.hood
on conflict (neighborhood_id, alias_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. אזור תעשייה אלון התבור - שכונה בעפולה
-- ---------------------------------------------------------------------------
insert into public.neighborhoods (city, city_id, name, is_custom, is_industrial)
select c.name, c.id, 'אזור תעשייה אלון התבור', false, true
  from public.cities c
 where c.name = 'עפולה'
   and not exists (
     select 1 from public.neighborhoods n
      where n.city_id = c.id and n.name = 'אזור תעשייה אלון התבור'
   );

-- ---------------------------------------------------------------------------
-- 4. קריאה ציבורית בכינויים
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'neighborhood_aliases'
       and policyname = 'public read neighborhood aliases'
  ) then
    create policy "public read neighborhood aliases"
      on public.neighborhood_aliases for select
      to anon, authenticated
      using (true);
  end if;
end $$;

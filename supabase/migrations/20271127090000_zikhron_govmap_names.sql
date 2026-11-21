-- זכרון יעקב: שמות השכונות ש-GovMap מכירה, כינויים לשכונות המשוערות שלנו
--
-- אחרי #1361 (הסריקה כוללת גם את הכינוי "זיכרון יעקב") חזרו מ-GovMap 11
-- שכונות ליישוב (21.11.2026, 14:29). כולן **בלי גבול ובלי נקודה**: GovMap
-- מכירה את היישוב בשכבת השכונות כשמות בלבד. שכונה כזו אינה במפה, אינה
-- מקבלת עסקאות לפי פין, ומכפילה את הרשימה (22 במקום 11) בלי לתת כלום.
-- המצולעים המשוערים שלנו (20271123170000) נשארים הפתרון.
--
-- מה כאן:
-- 1. כינויים: שמות של GovMap שהם אותה שכונה כמו אחת שלנו, או חלק ממנה -
--    כדי ש"חלומות זכרון יעקב", "נווה שלו והחורש" או "מרכז המושבה" בחיפוש
--    ובוואטסאפ יתאימו לשכונה הנכונה, וייבוא עתידי לא יחזיר אותם כשורה חדשה.
-- 2. מחיקת השמות הריקים. **רק שורה בלי גבול ובלי נקודה ובלי שום תלות**
--    (נכסים, כינויים, תיאורים, עסקאות מקושרות, לידים): "נווה רמז" קושרה
--    ל-6 עסקאות לפי שם, ולכן נשארת.
--
-- "מרכז/צפון/מערב המושבה" נכנסים כינוי ל"המושבה" - הם חלקים ממנה.
-- "אזור תעסוקה משותף", "זכרונה (בתכנון)", "פארק היין", "תעשיות בית אל"
-- אינם בנתוני רשות המיסים ואין להם מצולע מקביל; נמחקים.

insert into public.neighborhood_aliases (neighborhood_id, alias, shared, note)
select n.id, v.alias, false, 'השם ב-GovMap (שכבת השכונות, בלי גבול), זכרון יעקב 21.11.2026'
  from (values
    ('חלומות זיכרון', 'חלומות זכרון יעקב'),
    ('נווה שלו',      'נווה שלו והחורש'),
    ('מול היקב',      'מול היקב והגורן'),
    ('המושבה',        'מרכז המושבה'),
    ('המושבה',        'צפון המושבה'),
    ('המושבה',        'מערב המושבה')
  ) as v(hood, alias)
  join public.cities c on c.name_key = public.city_name_key('זכרון יעקב')
  join public.neighborhoods n on n.city_id = c.id and n.name = v.hood and n.boundary is not null
on conflict (neighborhood_id, alias_key) do nothing;

-- המחיקה: רק מה שאין בו שום דבר. alias_key מאותו שם כבר נכנס לכינויים למעלה,
-- והשורה הריקה עצמה (אותו שם) נמחקת רק אם אינה ממוצבת כאן כשם של שכונה אחרת.
delete from public.neighborhoods n
 using public.cities c
 where c.id = n.city_id
   and c.name_key = public.city_name_key('זכרון יעקב')
   and n.boundary is null
   and n.lat is null
   and n.name in ('אזור תעסוקה משותף', 'זכרונה (בתכנון)', 'חלומות זכרון יעקב',
                  'מול היקב והגורן', 'מערב המושבה', 'מרכז המושבה',
                  'נווה שלו והחורש', 'פארק היין', 'צפון המושבה', 'תעשיות בית אל')
   and not exists (select 1 from public.properties p where p.neighborhood_id = n.id)
   and not exists (select 1 from public.neighborhood_aliases a where a.neighborhood_id = n.id)
   and not exists (select 1 from public.neighborhood_descriptions d where d.neighborhood_id = n.id)
   and not exists (select 1 from public.market_deals_official o where n.id = any (o.neighborhood_ids))
   and not exists (select 1 from public.scraped_leads s where s.neighborhood_id = n.id);

do $$
declare v_n integer; v_a integer;
begin
  select count(*) into v_n from public.neighborhoods n join public.cities c on c.id = n.city_id
   where c.name_key = public.city_name_key('זכרון יעקב');
  select count(*) into v_a from public.neighborhood_aliases a join public.neighborhoods n on n.id = a.neighborhood_id
    join public.cities c on c.id = n.city_id where c.name_key = public.city_name_key('זכרון יעקב');
  raise notice 'זכרון יעקב: % שכונות, % כינויים', v_n, v_a;
  if v_n > 13 then
    raise warning 'צפויות 12 שכונות (11 משוערות ונווה רמז) ויש %', v_n;
  end if;
end $$;

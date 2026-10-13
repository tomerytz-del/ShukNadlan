-- ============================================================================
-- "מבואות הגלבוע" - אזור התעשייה, לשוק עפולה והעמק
--
-- ## למה
--
-- אזור התעשייה כ-10 ק"מ דרומית לעפולה. שני נכסים פעילים שם (מבנה תעשייה
-- ומשרד) נשמרו עם city = 'מבואות הגלבוע' (אוחד ב-20270429090000), ואין לשם
-- הזה שורה ב-cities - הוא אינו יישוב ברישום הלמ"ס. לכן city_id שלהם ריק:
-- הם לא שייכים לשום שוק ולא נספרים בעפולה והעמק. הכרעת מנהל הפלטפורמה
-- (12.10.2026): לשייך לשוק עפולה.
--
-- ## השורה
--
-- כמו כל עיר ידנית (הסקיל new-market): שם, אזור (emakim, כמו עפולה), slug
-- אמיתי (השוק חי - cities_live_needs_real_slug_chk) ושוק. **בלי קואורדינטות,
-- סמל או אוכלוסייה** - לא מנחשים. התיבה של afula-emek מגיעה עד 32.50 בדרום,
-- ולכן אזור התעשייה כבר בתוכה ו-markets.js לא משתנה.
--
-- ## העסקאות: נכנס לרשימה, ומושבת
--
-- הטריגר cities_deal_settlements מכניס לרשימת "יישובים לעסקאות" כל עיר
-- פעילה בשוק. ל"מבואות הגלבוע" אין עסקאות ב-GovMap (זה אזור תעשייה, לא
-- יישוב), וסוכן הדפדפן היה מנסה אותו בכל מחזור ונכשל - ממצא "עומד" שאין לו
-- תיקון. לכן השורה שנוצרה מושבתת (active = false), ו-deal_settlements_sync_cities
-- אינה מחזירה אותה: היא מדלגת על כל עיר שכבר יש לה שורה.
--
-- ## ההשלמה
--
-- כמו ב-20270112090000: city_id לנכסים ולמשרדים שכבר קיימים. ‏properties.city
-- אינו משתנה (client_property_match משווה טקסט).
--
-- תיעוד: docs/regional-pages.md (טבלת השווקים)
-- ============================================================================

insert into public.cities (area_id, name, slug, market_slug, source)
select a.id, 'מבואות הגלבוע', 'mevuot-hagilboa', 'afula-emek', 'manual'
  from public.areas a
 where a.slug = 'emakim'
   and not exists (select 1 from public.cities c
                    where c.name_key = public.city_name_key('מבואות הגלבוע'));

update public.deal_settlements s
   set active = false
  from public.cities c
 where c.name_key = public.city_name_key('מבואות הגלבוע')
   and s.city_id = c.id
   and s.last_synced_at is null
   and s.active;

do $$ declare v int; begin
  loop v := public.properties_backfill_city_id(200); exit when v = 0; end loop;
end $$;
select * from public.agencies_backfill_city_id();

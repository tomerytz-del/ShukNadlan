-- ============================================================================
-- אביטל - לשוק עפולה והעמק
--
-- מושב בגלבוע, דרומית לעפולה, בתוך תיבת הזיהוי של afula-emek (עד 32.50).
-- היישוב קיים ב-cities מהזנת הלמ"ס (slug זמני c-2052) ולא היה משויך לשום
-- שוק, ולכן הנכס שם (תוקן מ"מושב אביטל" ב-20270429090000) לא הופיע בשוק
-- עפולה. הכרעת מנהל הפלטפורמה (12.10.2026): לשייך.
--
-- ‏slug אמיתי במקום c-2052, כי השוק חי (cities_live_needs_real_slug_chk).
-- לא דורסים: רק אם היישוב עדיין בלי שוק. הטריגר cities_deal_settlements
-- מכניס אותו לרשימת העסקאות - וזה רצוי, זה יישוב אמיתי עם עסקאות.
--
-- תיעוד: docs/regional-pages.md (טבלת השווקים)
-- ============================================================================

update public.cities
   set market_slug = 'afula-emek',
       slug = case when slug ~ '^c-[0-9]+$' then 'avital' else slug end
 where name_key = public.city_name_key('אביטל')
   and market_slug is null;

do $$ declare v int; begin
  loop v := public.properties_backfill_city_id(200); exit when v = 0; end loop;
end $$;
select * from public.agencies_backfill_city_id();

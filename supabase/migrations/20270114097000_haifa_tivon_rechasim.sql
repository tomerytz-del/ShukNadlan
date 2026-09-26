-- ===========================================================================
-- קריית טבעון ורכסים מצטרפות לשוק "חיפה והקריות"
--
-- שתיהן בנפת חיפה, 10-20 דקות מחיפה, וקונה שמחפש/ת בהן בודק/ת גם את חיפה
-- ואת הקריות - המבחן של שוק (docs/regional-pages.md). כ-35 אלף תושבים
-- רשומים יחד (20270114096000).
--
-- ‏**שתיהן כבר ברישום** מהזנת היישובים (20270114095000), עם סמל יישוב
-- וסלאג זמני - ולכן זה update ולא insert (הסקיל new-market):
--
--   - ‏market_slug - רק אם ריק. שיוך קיים לשוק אחר הוא החלטה, ולא נדרס
--     בשקט (אותו כלל של ה-coalesce בכל מיגרציית שווקים).
--   - ‏slug אמיתי במקום c-<סמל>: שוק חי דורש אותו
--     (cities_live_needs_real_slug_chk), ועדיף שיהיה לפני שמישהו שיתף קישור.
--     רק כשהוא עדיין זמני - slug שכבר הוחלף אינו משתנה לעולם.
--   - ‏"קריית" בכתיב המלא, כמו שאר הקריות בשוק. ‏name_key זהה ("קרית
--     טבעון"), כך שנכסים שנרשמו בכל כתיב מתאימים.
--
-- התיבה של השוק ב-assets/markets.js הורחבה דרומה ומזרחה כדי לכלול אותן
-- (ועדיין אינה נוגעת בתיבה של עפולה והעמק, שמתחילה ב-35.15).
-- ===========================================================================

update public.cities c
   set market_slug = coalesce(c.market_slug, 'haifa-krayot'),
       slug        = case when c.slug = 'c-' || c.muni_code then v.slug else c.slug end,
       name        = case when c.name_key = public.city_name_key(v.name) then v.name else c.name end
  from (values
    ('2300', 'קריית טבעון', 'kiryat-tivon'),
    ('922',  'רכסים',       'rekhasim')
  ) as v(muni_code, name, slug)
 where c.muni_code = v.muni_code;

do $$
begin
  if exists (select 1 from public.cities
              where muni_code in ('2300', '922')
                and market_slug is distinct from 'haifa-krayot') then
    raise warning 'קריית טבעון או רכסים משויכת לשוק אחר - לא נדרס. לבדוק ביד.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ההשלמה - כמו בכל מיגרציית שווקים: נכסים, משרדים ושכונות בערים האלה.
-- ---------------------------------------------------------------------------
do $$
declare
  v integer;
  v_total integer := 0;
begin
  loop
    v := public.properties_backfill_city_id(200);
    v_total := v_total + v;
    exit when v = 0;
  end loop;
  raise notice 'properties.city_id: הושלמו % שורות', v_total;
end $$;

do $$
declare r record;
begin
  select * into r from public.agencies_backfill_city_id();
  raise notice 'agencies.city_id: % מכתובת, % מנכסים, % נותרו ריקים',
    r.from_address, r.from_properties, r.still_null;
end $$;

do $$
declare v_done integer;
begin
  update public.neighborhoods n
     set city_id = public.city_id_for_name(n.city)
   where n.city_id is null
     and public.city_id_for_name(n.city) is not null;
  get diagnostics v_done = row_count;
  raise notice 'neighborhoods.city_id: הושלמו % שורות', v_done;
end $$;

-- ---------------------------------------------------------------------------
-- רחובות: סבב ה-gov של הלילה הבא יקלוט גם אותן.
--
-- ‏street-registry-sync קורא את ערי השווקים בכל סבב, אבל
-- street_registry_gov_sync_due מחכה ארבעה חודשים מסבב מוצלח - והסבב האחרון
-- רץ ב-26.9.2026. בלי זה, לשתי הערים היה שדה רחוב חופשי עד ינואר. הסבב
-- אידמפוטנטי לערים שכבר נקלטו (אותו טריק כמו ב-20270114094000).
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;

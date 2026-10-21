-- =============================================================================
-- התראות לחיפוש שמור: אותו כלל של "יש בנכס" כמו באתר, בבוטים ובקובץ הלקוחות
-- =============================================================================
--
-- ‏**מה שבור היום.** ‏saved_search_matches() בודקת מאפייני חובה ב-
-- ‏`features @> required_features` - התאמה מילולית למערך. שאר המנגנונים כבר
-- מכירים שני כללים שהיא אינה מכירה:
--
--   ‏1. מרפסת שמש היא מרפסת. 15 מודעות פעילות מסמנות רק `sun_balcony`
--      (‏21.10.2026); חיפוש שמור עם "מרפסת" לא היה מתריע עליהן לעולם, בעוד
--      שאותו חיפוש באתר ובבוט מוצא אותן.
--   ‏2. ממ״ד בנכס מסחרי יושב ב-`mamad_location = 'unit'` ולא במערך (3 נכסים
--      פעילים). ‏client_property_match כבר סופרת אותו; ההתראות לא.
--
-- נבדק לפני הכתיבה, במסד (קריאה בלבד): נכס עם `sun_balcony` מול דרישה
-- `balcony` - ‏saved_search_matches = false, ‏client_property_match = true.
--
-- ‏**מה נכנס.** הדרישות נבדקות מול "מה שיש בנכס" - המערך, ועוד `balcony`
-- כשיש `sun_balcony`, ועוד `mamad` כש-`mamad_location = 'unit'` - בדיוק
-- הביטוי של client_property_match. הכלל עצמו מוגדר פעם אחת ב-
-- assets/search-core.js (‏FEATURES), ו-scripts/search_feature_cases.json הוא
-- החוזה: הסוכן התפעולי מריץ את אותן דוגמאות מול שתי הפונקציות
-- (‏search_rules_drift) ומדווח כשהן חלוקות עם הליבה. ‏docs/search-core.md.
--
-- כל שאר הגוף - כפי שהוא רץ בפרודקשן היום (‏pg_get_functiondef, 21.10.2026).
-- =============================================================================

create or replace function public.saved_search_matches(p_search public.saved_searches, p_property public.properties)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select
        p_property.status    = 'active'
    and p_property.deal_type = p_search.deal_type
    and p_property.category  = p_search.category
    and (
      (cardinality(p_search.cities) = 0 and cardinality(p_search.neighborhood_ids) = 0)
      or p_property.city = any(p_search.cities)
      or (p_property.neighborhood_id is not null
          and p_property.neighborhood_id = any(p_search.neighborhood_ids))
    )
    and (cardinality(p_search.property_types) = 0
         or p_property.property_type = any(p_search.property_types))
    and (p_search.max_price is null or p_property.price <= p_search.max_price)
    and (p_search.min_price is null or p_property.price >= p_search.min_price)
    and (p_search.min_rooms is null
         or (p_property.rooms is not null and p_property.rooms >= p_search.min_rooms))
    and (p_search.max_rooms is null
         or (p_property.rooms is not null and p_property.rooms <= p_search.max_rooms))
    and (p_search.min_size_sqm is null
         or (coalesce(p_property.size_sqm, p_property.area_sqm) is not null
             and coalesce(p_property.size_sqm, p_property.area_sqm) >= p_search.min_size_sqm))
    and (p_search.max_size_sqm is null
         or (coalesce(p_property.size_sqm, p_property.area_sqm) is not null
             and coalesce(p_property.size_sqm, p_property.area_sqm) <= p_search.max_size_sqm))
    and (p_search.min_floor is null
         or (p_property.floor is not null and p_property.floor >= p_search.min_floor))
    and (p_search.max_floor is null
         or (p_property.floor is not null and p_property.floor <= p_search.max_floor))
    -- מה שיש בנכס: המערך, מרפסת שמש כמרפסת, וממ״ד מסחרי מעמודת המיקום
    -- (‏FEATURES ב-assets/search-core.js; אותו ביטוי ב-client_property_match)
    and (cardinality(p_search.required_features) = 0
         or p_search.required_features <@ (
              coalesce(p_property.features, '{}'::text[])
              || case when 'sun_balcony' = any(coalesce(p_property.features, '{}'::text[]))
                      then array['balcony'] else '{}'::text[] end
              || case when p_property.mamad_location = 'unit'
                      then array['mamad'] else '{}'::text[] end))
    and (p_search.condition is null or p_property.condition = p_search.condition);
$function$;

comment on function public.saved_search_matches(public.saved_searches, public.properties) is
  'האם הנכס עונה על החיפוש השמור. בוליאני ולא ציון - למחפש/ת דירה התראה חלקית היא ספאם. מקור האמת של הטריגרים ושל תצוגת ההתאמות גם יחד. מאפיינים: אותו כלל של assets/search-core.js (מרפסת שמש היא מרפסת, ממ״ד מסחרי מעמודת המיקום).';

revoke all on function public.saved_search_matches(public.saved_searches, public.properties) from public, anon, authenticated;

-- ===========================================================================
-- "מרפסת" בהתאמת הלקוחות מתקיימת גם במרפסת שמש
--
-- מה שבור היום: לקוח/ה עם "מרפסת" במאפייני החובה (‏required_features) לא
-- מקבל/ת אף נכס שמסומן רק "מרפסת שמש" - מאפיין חובה הוא סינון קשיח, ו-
-- sun_balcony אינו balcony. ביום המיגרציה: 13 מודעות פעילות עם מרפסת שמש
-- בלבד, ו-3 לקוחות שדורשים מרפסת. אותו כלל כבר חל בחיפוש באתר (‏assets/home.js)
-- ובבוטים (‏property-search.ts), מ-#758; כאן הוא נכנס למנוע ההתאמות, ולכן
-- גם לפאנל, לספירות, לסיכום ההתאמות ולבוט (‏client_matches).
--
-- 1. client_property_match - העתק מלא של 20270426090000 (‏md5(prosrc) בפרודקשן
--    זהה לקובץ, ‏2ed912fc), ושורה אחת: לנכס עם sun_balcony יש גם balcony.
--    הכיוון ההפוך לא: מי שדורש/ת מרפסת שמש לא מקבל/ת מרפסת רגילה.
-- 2. חישוב מחדש של ההתראות ללקוחות שדורשים מרפסת. הן נכתבות רק ל-
--    client_match_alerts ויוצאות בסיכום הרגיל (‏match_digest), בלי צלצול.
-- ===========================================================================

create or replace function public.client_property_match(
  p_client         public.agent_clients,
  p_property       public.properties,
  p_waive_features text[]
)
returns table (score int, reasons text[], missing_features text[])
language sql
immutable
set search_path = ''
as $$
  with feats as (
    -- מה שיש בנכס. ממ״ד מסחרי יושב ב-mamad_location ולא במערך
    select coalesce(p_property.features, '{}'::text[])
           || case when p_property.mamad_location = 'unit' then array['mamad'] else '{}'::text[] end
           -- מרפסת שמש היא מרפסת: 13 מודעות פעילות מסמנות רק sun_balcony (14.10.2026)
           || case when 'sun_balcony' = any(coalesce(p_property.features, '{}'::text[]))
                   then array['balcony'] else '{}'::text[] end
           as have
  ),
  miss as (
    -- מה שהלקוח/ה ביקש/ה ולא קיים בנכס
    select array(select unnest(p_client.required_features)
                 except
                 select unnest(feats.have)) as feats
      from feats
  ),
  gate as (
    select (p_client.client_kind = 'seeker'
        and p_property.status    = 'active'
        -- נכס פרטי: רק הלקוחות של מי שמחזיק/ה בו
        and (p_property.share_level is distinct from 'private'
             or p_property.agent_id = p_client.agent_id)
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0         or p_property.city          = any(p_client.cities))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        and (p_client.max_price is null or p_property.price <= p_client.max_price * 1.10)
        and (p_client.min_price is null or p_property.price >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
        -- מאפייני חובה: כל מה שחסר חייב להיות ברשימת הוויתור של הקריאה
        and miss.feats <@ coalesce(p_waive_features, '{}'::text[])
           ) as passes
      from miss
  )
  select
    greatest(0, 100
      - case when p_client.max_price is not null and p_property.price > p_client.max_price then 15 else 0 end
      - case when p_client.min_price is not null and p_property.price < p_client.min_price then 5  else 0 end
      - case when p_client.min_size_sqm is not null
              and (p_property.size_sqm is null or p_property.size_sqm < p_client.min_size_sqm) then 10 else 0 end
      - case when p_client.max_size_sqm is not null and p_client.min_size_sqm is null
              and p_property.size_sqm is null then 10 else 0 end
      - case when p_client.max_floor is not null
              and p_property.floor is not null and p_property.floor > p_client.max_floor then 10 else 0 end
      - case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
             then 5 else 0 end
      - least(24, 8 * cardinality(miss.feats))
    )::int,
    array_remove(array[
      case when p_client.max_price is not null and p_property.price > p_client.max_price
           then 'מעל התקציב ב-' || round((p_property.price / p_client.max_price - 1) * 100) || '%' end,
      case when p_client.min_price is not null and p_property.price < p_client.min_price
           then 'מתחת לטווח המחירים שהוגדר' end,
      case when (p_client.min_size_sqm is not null or p_client.max_size_sqm is not null)
            and p_property.size_sqm is null
           then 'גודל הנכס לא מולא במודעה' end,
      case when p_client.min_size_sqm is not null and p_property.size_sqm is not null
            and p_property.size_sqm < p_client.min_size_sqm
           then 'קטן מהמבוקש ב-' || round(p_client.min_size_sqm - p_property.size_sqm) || ' מ״ר' end,
      case when p_client.max_floor is not null and p_property.floor is not null
            and p_property.floor > p_client.max_floor
           then 'קומה ' || p_property.floor || ' - גבוה מהמבוקש' end,
      case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
           then 'מספר החדרים לא מולא במודעה' end
    ], null),
    miss.feats
  from gate, miss
  where gate.passes;
$$;

comment on function public.client_property_match(public.agent_clients, public.properties, text[]) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד, עם הסיבות לכל פער. אפס שורות = נפילה בסינון קשיח (כולל מאפיין חובה חסר שאינו ב-p_waive_features, ונכס פרטי של סוכן/ת אחר/ת). p_waive_features רק לקריאה שהסוכן/ת אישר/ה בה ויתור.';

revoke all on function public.client_property_match(public.agent_clients, public.properties, text[]) from public, anon, authenticated;

-- 2. התראות ללקוחות שדורשים מרפסת - ההתאמות החדשות נכנסות לסיכום הבא
do $$
declare r record;
begin
  for r in
    select id from public.agent_clients
     where status = 'active' and client_kind = 'seeker'
       and 'balcony' = any(required_features)
  loop
    perform public.generate_client_match_alerts_for_client(r.id);
  end loop;
end $$;

-- ============================================================================
-- מפת הנכס בעמוד הנכס — זכאות לפי מסלול וכתובת מדויקת
--
-- בעמוד הנכס יש סקציית "מיקום וסביבה". עד היום היא הייתה אמורה להציג מפה לכל
-- נכס שיש לו lat/lng, וזה שגוי משתי סיבות:
--
--   1. ‏המפה היא יכולת של מסלול בתשלום, כמו ההדמיות (Premium) ובדיקת המידע
--      התכנוני (Mid ומעלה). כאן הרף הוא Mid ומעלה — Mid ופרימיום מקבלים מפה,
--      Free לא.
--   2. ‏lat/lng קיימים גם לנכס שנרשם עם עיר בלבד: הגאוקודינג נופל אז למרכז
--      העיר. פין על מרכז עפולה במודעה שכתובתה "עפולה" הוא מידע שקרי — הוא
--      נראה מדויק ואינו כזה. לכן הזכאות דורשת גם מספר בית.
--
-- כמו בכל שאר יכולות ה-tier בפרויקט, הבדיקה יושבת בפונקציה אחת ב-DB ולא
-- בקוד הדפדפן, כדי שיהיה מקור אמת יחיד. הפונקציה לא חושפת שום מידע חדש:
-- ‏lat/lng כבר גלויים ל-anon על נכסים פעילים (מפת החיפוש בדף הבית מציירת
-- מהם את הפינים), והיא מחזירה boolean בלבד — לא את ה-tier של הסוכן/ת.
-- ============================================================================

create or replace function public.property_map_enabled(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    where p.id = p_property_id
      and p.status = 'active'
      and m.active = true
      and m.tier in ('mid', 'premium')
      and m.billing_status = 'active'
      -- כתובת מדויקת: מספר בית + רחוב (או שדה address חופשי שכבר מכיל את
      -- שניהם), ולצידם קואורדינטות שהגאוקודינג החזיר בפועל
      and p.house_number is not null
      and (p.street is not null or p.address is not null)
      and p.lat is not null
      and p.lng is not null
  );
$$;

comment on function public.property_map_enabled(uuid) is
  'מפת הנכס בעמוד הנכס זמינה רק לנכס פעיל עם כתובת מדויקת (מספר בית + קואורדינטות) של סוכן/ת Mid/Premium פעיל/ה. מקור אמת יחיד לצד הלקוח.';

grant execute on function public.property_map_enabled(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- פרמטר עסקי — אותה תבנית כמו planning_lookup_min_tier_mid ו-
-- visualization_min_tier_premium: הרף מתועד ב-pricing_config, כדי שדף התמחור
-- וכל דיון על המסלולים יסתכלו במקום אחד.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('property_map_min_tier_mid', 1,
   'מפת הנכס בעמוד הנכס זמינה מ-Mid ומעלה, ורק לנכס עם כתובת מדויקת (1=פעיל)')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

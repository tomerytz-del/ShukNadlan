-- ============================================================================
-- יצירה אוטומטית של סט הדמיות הבסיס עם פרסום נכס פרטי
--
-- משלים את 20260827180000_property_visualizations.sql: שם נבנה המנגנון, כאן
-- הוא מתחיל לרוץ מעצמו. נכס פרטי של סוכן/ת Premium שנעשה active מקבל את סט
-- הבסיס בסגנון ברירת המחדל בלי שאיש יזכור ללחוץ על כפתור.
--
-- שלוש החלטות שכדאי להכיר:
--
--   1. ‏AFTER ולא BEFORE. הטריגר קורא ל-property_visualizations_enabled,
--      שדורשת status='active' — ב-BEFORE השורה עוד לא נראית בתמונת המצב.
--   2. הטריגר לא יכול להפיל שמירת נכס. כל גופו עטוף ב-exception handler
--      שבולע הכול: תקלה במנגנון ההדמיות היא תקלה בפיצ'ר שיווקי, ואסור לה
--      למנוע מסוכן/ת לפרסם או לעדכן נכס.
--   3. בלי הסוד — no-op שקט. עד שמישהו יריץ את vault.create_secret למטה
--      הטריגר יוצא מיד בלי לעשות כלום, כך שאפשר להריץ את המיגרציה הזו לפני
--      שהפונקציות נפרסו בכלל, בלי שאף בקשה תצא לדרך.
--
-- ‏pg_net שולח אסינכרונית ואחרי commit, ולכן ההמתנה ל-Gemini לא מתרחשת
-- בתוך הטרנזקציה של שמירת הנכס.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הפעלה
--
-- שני הסודות נשמרים ב-Vault ולא בקוד. להריץ פעם אחת, ידנית:
--
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'visualization_service_key',
--                              'מפתח service_role לקריאות פנימיות ממנגנון ההדמיות');
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1',
--                              'edge_functions_base_url',
--                              'כתובת הבסיס של ה-Edge Functions');
--
-- כל עוד אחד מהם חסר, הטריגר לא עושה כלום.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_base_visualization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_url text;
begin
  -- נכס לא מפורסם או בלי תמונות — אין ממה לייצר
  if new.status is distinct from 'active' then
    return null;
  end if;
  if coalesce(array_length(new.images, 1), 0) = 0 then
    return null;
  end if;

  -- "אירוע פרסום" הוא אחד משניים: הנכס נעשה active, או שנכס פעיל קיבל
  -- תמונות בפעם הראשונה. המקרה השני אינו קצה — בפועל לא מעט נכסים נפתחים
  -- ריקים והתמונות מועלות אחר כך, ובלעדיו הם לא היו מקבלים הדמיות לעולם.
  -- עדכון מחיר או תיאור בנכס פעיל עם תמונות לא מפעיל כלום.
  if tg_op = 'UPDATE'
     and old.status is not distinct from 'active'
     and coalesce(array_length(old.images, 1), 0) > 0 then
    return null;
  end if;

  -- נכס פרטי בלבד. במסחרי ההדמיה תלויה בסוג העסק שהגולש/ת בוחר/ת, ולכן
  -- אין לה סט בסיס — התיעוד המלא ב-docs/property-visualizations.md
  if new.category is distinct from 'residential' then
    return null;
  end if;
  if not public.property_visualizations_enabled(new.id) then
    return null;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'visualization_service_key' limit 1;
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'edge_functions_base_url' limit 1;

  if v_key is null or v_url is null then
    return null;   -- המנגנון עוד לא הופעל
  end if;

  perform net.http_post(
    url     := v_url || '/property-visualize-base',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('property_id', new.id),
    timeout_milliseconds := 5000
  );

  return null;
exception when others then
  -- הדמיות הן פיצ'ר שיווקי. כישלון כאן לא ימנע מסוכן/ת לפרסם נכס.
  raise warning 'enqueue_base_visualization נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.enqueue_base_visualization() is
  'מפעיל את property-visualize-base עם פרסום נכס פרטי של סוכן/ת Premium. no-op שקט כל עוד סודות ה-Vault לא הוגדרו.';

revoke execute on function public.enqueue_base_visualization() from anon, authenticated;

drop trigger if exists properties_enqueue_base_visualization on public.properties;
create trigger properties_enqueue_base_visualization
  after insert or update of status, images on public.properties
  for each row execute function public.enqueue_base_visualization();

comment on trigger properties_enqueue_base_visualization on public.properties is
  'סט הדמיות הבסיס נוצר אוטומטית עם פרסום הנכס (מודול ההדמיות).';

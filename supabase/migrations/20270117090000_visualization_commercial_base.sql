-- ============================================================================
-- סט בסיס גם לנכס מסחרי — הדמיה אחת, כדי שתיבת ההדמיות לא תהיה ריקה
--
-- עד כאן סט הבסיס האוטומטי (טריגר הפרסום ותור המילוי) נסגר על
-- category = 'residential', כי להדמיה מסחרית צריך סוג עסק. התוצאה בדף:
-- 33 נכסים מסחריים עם תמונות הציגו תיבת הדמיות ריקה עד שגולש/ת ביקש/ה עסק.
--
-- ‏property-visualize-base יודעת מעכשיו לייצר לנכס מסחרי הדמיה אחת של העסק
-- ה"צפוי" לסוג הנכס (defaultBusinessFor ב-_shared/visualization.ts), ולכן
-- כאן רק נפתח לה הדלת:
--
--   1. טריגר הפרסום — בלי סינון הקטגוריה. הקרקע נשארת בחוץ (is_land_property_type).
--   2. תור המילוי — אותו דבר.
--   3. מילוי לאחור — הנכסים הזכאים עם תמונות ובלי הדמיית בסיס נרשמים לתור,
--      ו-pg_cron מרוקן אותו בקצב הקיים (5 נכסים ל-5 דקות).
--
-- אידמפוטנטית: create or replace, ו-on conflict בהכנסה לתור.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. טריגר הפרסום
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
  -- תמונות בפעם הראשונה. עדכון מחיר או תיאור בנכס פעיל עם תמונות לא מפעיל כלום.
  if tg_op = 'UPDATE'
     and old.status is not distinct from 'active'
     and coalesce(array_length(old.images, 1), 0) > 0 then
    return null;
  end if;

  -- קרקע אינה ניתנת להדמיה: אין "מצב קיים" לערוך, ומבנה שהמודל היה מצייר
  -- על מגרש ריק הוא הבטחה לזכויות בנייה שאיש לא התחייב אליהן. דף הנכס מציג
  -- לקרקע מידע תכנוני במקום.
  if public.is_land_property_type(new.property_type) then
    return null;
  end if;

  -- פרטי ומסחרי כאחד: הפרטי מקבל סט בסגנון ברירת המחדל, המסחרי הדמיה אחת
  -- של העסק הצפוי לסוג הנכס — ההחלטה יושבת בפונקציה ולא כאן.
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

revoke execute on function public.enqueue_base_visualization() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. תור המילוי
-- ---------------------------------------------------------------------------
create or replace function public.queue_agent_visualization_backfill(
  p_agent_id uuid,
  p_force    boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.visualization_backfill_queue (property_id, agent_id, reason)
  select p.id, p.agent_id, 'tier_upgrade'
  from public.properties p
  where p.agent_id = p_agent_id
    and coalesce(array_length(p.images, 1), 0) > 0
    and not public.is_land_property_type(p.property_type)
    -- מקור האמת היחיד לזכאות, בדיוק כמו ב-RLS וב-Edge Functions. הוא כולל
    -- כבר את status='active' של הנכס ואת Premium הפעיל של הסוכן/ת.
    and public.property_visualizations_enabled(p.id)
    -- נכס שכבר יש לו סט בסיס אינו צריך כלום. הפונקציה עצמה גם מדלגת על
    -- מטרה קיימת, אבל אין סיבה לשלוח אליה בקשה שכולה דילוג.
    and (p_force or not exists (
          select 1 from public.property_visualizations v
          where v.property_id = p.id and v.is_base))
  on conflict (property_id) do update
    set status       = 'pending',
        attempts     = 0,
        queued_at    = now(),
        processed_at = null
    -- שורה שכבר ממתינה נשארת במקומה; רק שורה שנסגרה נפתחת מחדש
    where public.visualization_backfill_queue.status <> 'pending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.queue_agent_visualization_backfill(uuid, boolean) is
  'רושם לתור את הנכסים הזכאים של סוכן/ת (פרטיים ומסחריים) שאין להם הדמיית בסיס.';

revoke all on function public.queue_agent_visualization_backfill(uuid, boolean) from public, anon, authenticated;
grant execute on function public.queue_agent_visualization_backfill(uuid, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- 3. מילוי לאחור — הנכסים המסחריים שכבר באוויר
--
-- ‏reason נפרד כדי שיהיה אפשר לראות בתור מה נכנס בגלל המיגרציה הזו.
-- ---------------------------------------------------------------------------
insert into public.visualization_backfill_queue (property_id, agent_id, reason)
select p.id, p.agent_id, 'commercial_base'
from public.properties p
where p.category is distinct from 'residential'
  and coalesce(array_length(p.images, 1), 0) > 0
  and not public.is_land_property_type(p.property_type)
  and public.property_visualizations_enabled(p.id)
  and not exists (
        select 1 from public.property_visualizations v
        where v.property_id = p.id and v.is_base)
on conflict (property_id) do update
  set status       = 'pending',
      attempts     = 0,
      reason       = excluded.reason,
      queued_at    = now(),
      processed_at = null
  where public.visualization_backfill_queue.status <> 'pending';

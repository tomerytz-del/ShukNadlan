-- =============================================================================
-- התראות התאמה שכבר לא מתאימות יורדות כשהלקוח/ה או הנכס משתנים
--
-- 18.10.2026, 12:07: לקוח של סוכן חדש נוצר בייבוא בלי דרישות (שדה ריק מתאים
-- לכל נכס), קיבל 62 התאמות ב-100% - דירות למכירה בעפולה - ו-28 שניות אחר כך
-- עודכן למה שהוא באמת מחפש: מגרש להשכרה בקרית מלאכי. 62 ההתאמות נשארו,
-- והסיכום של 12:07 אמר ל-22 סוכנים "נכס שלך מתאים ללקוח/ה של..." - כמעט
-- כולן שגויות.
--
-- הסיבה: agent_clients_match_alerts_upd ו-properties_client_match_alerts_upd
-- רק **מוסיפים** התראות (on conflict do nothing). מה שהפסיק להתאים נמחק רק
-- במעבר לבעל/ת נכס, בסגירה ובמאפיין חובה - לא כשמצמצמים דרישות, ולא כשמחיר
-- הנכס עולה. ביום המיגרציה: 173 מתוך 788 התראות פתוחות (22 לקוחות).
--
-- "מתאים" = אותו מבחן שיוצר את ההתראה: client_property_match (העטיפה בשני
-- ארגומנטים, כמו generate_client_match_alerts_*) עם ציון >=
-- client_alert_min_score. רק new ו-seen; dismissed היא החלטה של הסוכן/ת
-- ונשמרת, כמו ב-agent_clients_owner_clear_alerts. התראה שעדיין מתאימה לא
-- נוגעים בה. מה שנכנס להתאמה - הטריגרים הקיימים מוסיפים, כמו היום.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. צד הלקוח/ה
-- ---------------------------------------------------------------------------
create or replace function public.agent_clients_prune_stale_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min int := coalesce(
    (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70);
begin
  delete from public.client_match_alerts a
   using public.properties p
   where a.client_id = new.id
     and a.status in ('new', 'seen')
     and p.id = a.property_id
     and not exists (select 1 from public.client_property_match(new, p) mt
                      where mt.score >= v_min);
  return null;
exception when others then
  -- כמו properties_client_match_alerts: ניקוי שנכשל לא מפיל את שמירת הכרטיס.
  raise warning 'stale match alerts prune failed for client %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.agent_clients_prune_stale_alerts() from public, anon, authenticated;

-- אותה רשימת עמודות כמו agent_clients_match_alerts_upd (‏20270316090000).
-- עמודת דרישה חדשה נכנסת לשתי הרשימות (הסקיל client-matching, סעיף 3).
drop trigger if exists agent_clients_prune_stale_alerts on public.agent_clients;
create trigger agent_clients_prune_stale_alerts
  after update on public.agent_clients
  for each row
  when (new.status = 'active' and (
        old.status            is distinct from new.status
     or old.client_kind       is distinct from new.client_kind
     or old.deal_type         is distinct from new.deal_type
     or old.category          is distinct from new.category
     or old.cities            is distinct from new.cities
     or old.property_types    is distinct from new.property_types
     or old.min_price         is distinct from new.min_price
     or old.max_price         is distinct from new.max_price
     or old.min_rooms         is distinct from new.min_rooms
     or old.max_rooms         is distinct from new.max_rooms
     or old.min_size_sqm      is distinct from new.min_size_sqm
     or old.max_size_sqm      is distinct from new.max_size_sqm
     or old.max_floor         is distinct from new.max_floor
     or old.required_features is distinct from new.required_features))
  execute function public.agent_clients_prune_stale_alerts();

-- ---------------------------------------------------------------------------
-- 2. צד הנכס
-- ---------------------------------------------------------------------------
create or replace function public.properties_prune_stale_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min int := coalesce(
    (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70);
begin
  delete from public.client_match_alerts a
   using public.agent_clients c
   where a.property_id = new.id
     and a.status in ('new', 'seen')
     and c.id = a.client_id
     and not exists (select 1 from public.client_property_match(c, new) mt
                      where mt.score >= v_min);
  return null;
exception when others then
  raise warning 'stale match alerts prune failed for property %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.properties_prune_stale_alerts() from public, anon, authenticated;

-- אותה רשימה כמו properties_client_match_alerts_upd (‏20260829210000).
drop trigger if exists properties_prune_stale_alerts on public.properties;
create trigger properties_prune_stale_alerts
  after update on public.properties
  for each row
  when (new.status = 'active' and (
        old.status        is distinct from new.status
     or old.price         is distinct from new.price
     or old.rooms         is distinct from new.rooms
     or old.size_sqm      is distinct from new.size_sqm
     or old.floor         is distinct from new.floor
     or old.city          is distinct from new.city
     or old.property_type is distinct from new.property_type
     or old.deal_type     is distinct from new.deal_type
     or old.category      is distinct from new.category
     or old.features      is distinct from new.features))
  execute function public.properties_prune_stale_alerts();

-- ---------------------------------------------------------------------------
-- 3. למפרע: התראות פתוחות של לקוחות פעילים שכבר לא עוברות את המבחן.
-- לקוחות סגורים ומושהים - לא כאן (20270608090000 ו-agent_client_closed_cleanup).
-- ---------------------------------------------------------------------------
delete from public.client_match_alerts a
 using public.agent_clients c, public.properties p
 where c.id = a.client_id
   and p.id = a.property_id
   and c.status = 'active'
   and a.status in ('new', 'seen')
   and not exists (
     select 1 from public.client_property_match(c, p) mt
      where mt.score >= coalesce(
        (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70));

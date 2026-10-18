-- פיד התראות ההתאמה ("התראות התאמה" ב-CRM) הציג גם לקוחות שנסגרו או הושהו.
--
-- סגירת כרטיס (status = 'closed') מוחקת רק את התראות הפעמון מסוג
-- client_match (agent_client_closed_cleanup), ושורות client_match_alerts
-- נשארות - בכוונה, כי פתיחה מחדש של הכרטיס מחזירה אותן. הסיכום
-- (client_match_digest_run) וספירת "לקוחות מתאימים" בכרטיס הנכס כבר מסננים
-- לפי סטטוס הלקוח/ה, והפיד היה היחיד שלא: לקוח/ה שסומן/ה "סגור" המשיך/ה
-- להופיע ברשימה גם אחרי ריענון.
--
-- התיקון הוא בפיד ולא במחיקה: העתק מלא של 20260829210000, ושורה אחת
-- נוספה - c.status = 'active', כמו בסיכום.

create or replace function public.client_match_alerts_feed(
  p_scope text default 'new',
  p_limit int  default 40
)
returns table (
  id                uuid,
  status            text,
  score             int,
  source            text,
  reasons           text[],
  missing_features  text[],
  created_at        timestamptz,
  seen_at           timestamptz,
  client_id         uuid,
  client_name       text,
  client_phone      text,
  property_id       uuid,
  title             text,
  price             numeric,
  deal_type         text,
  property_type     text,
  rooms             numeric,
  floor             int,
  size_sqm          numeric,
  city              text,
  street            text,
  house_number      text,
  images            text[],
  is_promoted       boolean,
  listing_agency_name text,
  listing_agent_name  text,
  listing_agent_phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    al.id, al.status, al.score, al.source, al.reasons, al.missing_features,
    al.created_at, al.seen_at,
    c.id, c.full_name, c.phone,
    p.id, p.title, p.price, p.deal_type, p.property_type,
    p.rooms::numeric, p.floor::int, p.size_sqm::numeric,
    p.city, p.street, p.house_number, p.images, p.is_promoted,
    a.name, m.display_name, m.phone
    from public.client_match_alerts al
    join public.agent_clients c on c.id = al.client_id and c.status = 'active'
    join public.properties p    on p.id = al.property_id
    left join public.agencies a       on a.id = p.agency_id
    left join public.agency_members m on m.id = p.agent_id
   where al.agent_id = public.current_agent_id()
     and al.status <> 'dismissed'
     and p.status = 'active'
     and (p_scope is distinct from 'new' or al.status = 'new')
   order by (al.status = 'new') desc, al.created_at desc, al.score desc
   limit least(greatest(coalesce(p_limit, 40), 1), 200);
$$;
comment on function public.client_match_alerts_feed(text, int) is
  'פיד התראות ההתאמה של הסוכן/ת המחובר/ת. p_scope=''new'' להתראות שטרם נצפו, כל ערך אחר לכולן. התראות שהוסרו, נכסים שאינם פעילים ולקוחות שאינם פעילים (סגור/מושהה) אינם מוחזרים.';

revoke all on function public.client_match_alerts_feed(text, int) from public, anon, authenticated;
grant execute on function public.client_match_alerts_feed(text, int) to authenticated;

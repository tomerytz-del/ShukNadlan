-- ============================================================================
-- קובץ הלקוחות של הסוכן/ת + מנוע ההתאמות
--
--   1. ‏agent_clients — הלקוחות ודרישות החיפוש שלהם. פרטי לקוח הם מידע אישי,
--      ולכן ה-RLS כאן צר יותר מזה של properties: רק הסוכן/ת עצמו/ה, בלי
--      מנהל/ת המשרד ובלי מנהל/ת הפלטפורמה.
--   2. ‏match_properties_for_client() — ההתאמות עצמן, משלושה מאגרים בבת אחת:
--      הנכסים של הסוכן/ת, הנכסים של המשרד, והנכסים שמשרדים אחרים שיתפו עם
--      המשרד (property_shares — מיגרציית 20260825120000).
--   3. ‏client_match_counts() — ספירה אחת לכל לקוח/ה, כדי שרשימת הלקוחות
--      ב-CRM תציג תגית "N התאמות" בלי שאילתה נפרדת לכל שורה.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב ושוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הלקוחות
--
-- הדרישות נשמרות כשדות ולא כ-jsonb חופשי, כי מנוע ההתאמות מסנן עליהן ב-SQL
-- וצריך טיפוסים אמיתיים (numeric לתקציב, text[] לסוגי נכס).
--
-- שדה ריק = "לא אכפת לי": מערך ריק או null אינם מסננים כלום. זו ההתנהגות
-- שמאפשרת להזין לקוח/ה עם שתי שורות מידע ולקבל התאמות כבר עכשיו.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_clients (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references public.agency_members(id) on delete cascade,
  agency_id      uuid          references public.agencies(id)       on delete set null,

  -- פרטי הלקוח/ה
  full_name      text not null,
  phone          text,
  email          text,
  notes          text,

  -- דרישות החיפוש
  deal_type      text not null default 'sale'
                 check (deal_type in ('sale','rent')),
  category       text not null default 'residential'
                 check (category in ('residential','commercial')),
  property_types text[] not null default '{}',
  cities         text[] not null default '{}',
  min_price      numeric(14,2) check (min_price is null or min_price >= 0),
  max_price      numeric(14,2) check (max_price is null or max_price >= 0),
  min_rooms      numeric(4,1)  check (min_rooms is null or min_rooms > 0),
  max_rooms      numeric(4,1)  check (max_rooms is null or max_rooms > 0),
  min_size_sqm   numeric(8,1)  check (min_size_sqm is null or min_size_sqm > 0),
  max_floor      smallint,
  required_features text[] not null default '{}',

  status         text not null default 'active'
                 check (status in ('active','paused','closed')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint agent_clients_price_range check (min_price is null or max_price is null or min_price <= max_price),
  constraint agent_clients_rooms_range check (min_rooms is null or max_rooms is null or min_rooms <= max_rooms)
);

comment on table public.agent_clients is
  'קובץ הלקוחות של הסוכן/ת: פרטי הלקוח/ה ודרישות החיפוש שמנוע ההתאמות מסנן לפיהן.';
comment on column public.agent_clients.property_types is
  'סוגי נכס מבוקשים. מערך ריק = כל סוג — כמו כל שדה דרישה ריק כאן.';
comment on column public.agent_clients.status is
  'active = מחפש/ת · paused = בהמתנה · closed = סגר/ה עסקה. רק active נספר/ת בהתאמות.';

create index if not exists agent_clients_agent_idx on public.agent_clients (agent_id, status);

drop trigger if exists agent_clients_set_updated_at on public.agent_clients;
create trigger agent_clients_set_updated_at
  before update on public.agent_clients
  for each row execute function public.rss_set_updated_at();

alter table public.agent_clients enable row level security;
revoke all on table public.agent_clients from anon;

-- מכוון שצר יותר מה-policy של properties: פרטי לקוח הם מידע אישי שהלקוח/ה
-- מסר/ה לסוכן/ת ספציפי/ת, ולכן גם מנהל/ת המשרד לא רואה אותם.
drop policy if exists "agent manages own clients" on public.agent_clients;
create policy "agent manages own clients"
  on public.agent_clients for all
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 2. מנוע ההתאמות
--
-- שני סוגי קריטריונים:
--   • סינון קשיח — סוג עסקה, קטגוריה, עיר, סוג נכס, חדרים ותקציב. נכס שנופל
--     באחד מהם פשוט לא מוחזר.
--   • ניקוד — כל היתר. הציון מתחיל ב-100 ויורד לפי הפערים, וכל פער מוחזר
--     כטקסט ב-reasons כדי שהסוכן/ת יראה *למה* ההתאמה חלקית ולא רק מספר.
--
-- שתי החלטות שכדאי לדעת עליהן:
--   • תקציב: חריגה של עד 10% מעל המקסימום *כן* מוחזרת, עם ניכוי ניקוד וסיבה.
--     זה המקרה הקלאסי שבו הסוכן/ת רוצה בכל זאת להתקשר, ומסנן קשיח היה מסתיר
--     אותו. מתחת למינימום מותרת חריגה של 15% — נכס זול מהצפוי הוא לרוב הפתעה
--     טובה, לא פסילה.
--   • שדה חסר בנכס (חדרים/מ"ר לא מולאו) לא פוסל — הוא מוריד ניקוד ומופיע
--     כסיבה. אחרת נכסים שלא מולאו במלואם היו נעלמים מכל ההתאמות.
--
-- ‏required_features מוחזר כמפתחות באנגלית (missing_features) ולא כטקסט
-- עברי — התוויות כבר קיימות ב-crm.html, ואין טעם לשכפל אותן ל-SQL.
-- ---------------------------------------------------------------------------
create or replace function public.match_properties_for_client(p_client_id uuid)
returns table (
  property_id       uuid,
  source            text,
  score             int,
  reasons           text[],
  missing_features  text[],
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
  listing_agency_id   uuid,
  listing_agency_name text,
  listing_agent_name  text,
  listing_agent_phone text,
  created_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent  public.agency_members%rowtype;
  v_client public.agent_clients%rowtype;
begin
  select * into v_agent from public.agency_members
   where user_id = (select auth.uid()) and active = true;
  if not found or v_agent.agency_id is null then
    return;  -- אין סוכן/ת מזוהה/ת — מחזירים אפס שורות ולא שגיאה
  end if;

  select * into v_client from public.agent_clients
   where id = p_client_id and agent_id = v_agent.id;
  if not found then
    return;  -- לא הלקוח/ה שלך — אותה תשובה כמו "אין התאמות"
  end if;

  return query
  with pool as (
    -- הנכסים שלי ושל המשרד
    select p.id as pid,
           case when p.agent_id = v_agent.id then 'own' else 'agency' end as src
      from public.properties p
     where p.agency_id = v_agent.agency_id
    union all
    -- מה שמשרדים אחרים שיתפו עם המשרד שלי
    select ps.property_id, 'shared'
      from public.property_shares ps
     where ps.shared_with_agency_id = v_agent.agency_id
  ),
  candidates as (
    select
      pool.src,
      p.*,
      -- מה שהלקוח/ה ביקש/ה ולא קיים בנכס
      array(select unnest(v_client.required_features)
            except
            select unnest(p.features)) as missing_feats
      from pool
      join public.properties p on p.id = pool.pid
     where p.status = 'active'
       and p.deal_type = v_client.deal_type
       and p.category  = v_client.category
       and (cardinality(v_client.cities) = 0         or p.city          = any(v_client.cities))
       and (cardinality(v_client.property_types) = 0 or p.property_type = any(v_client.property_types))
       and (v_client.max_price is null or p.price <= v_client.max_price * 1.10)
       and (v_client.min_price is null or p.price >= v_client.min_price * 0.85)
       and (v_client.min_rooms is null or p.rooms is null or p.rooms >= v_client.min_rooms)
       and (v_client.max_rooms is null or p.rooms is null or p.rooms <= v_client.max_rooms)
  ),
  scored as (
    select
      c.*,
      greatest(0, 100
        - case when v_client.max_price is not null and c.price > v_client.max_price then 15 else 0 end
        - case when v_client.min_price is not null and c.price < v_client.min_price then 5  else 0 end
        - case when v_client.min_size_sqm is not null
                and (c.size_sqm is null or c.size_sqm < v_client.min_size_sqm) then 10 else 0 end
        - case when v_client.max_floor is not null
                and c.floor is not null and c.floor > v_client.max_floor then 10 else 0 end
        - case when c.rooms is null and (v_client.min_rooms is not null or v_client.max_rooms is not null)
               then 5 else 0 end
        - least(24, 8 * cardinality(c.missing_feats))
      ) as calc_score,
      (
        select array_remove(array[
          case when v_client.max_price is not null and c.price > v_client.max_price
               then 'מעל התקציב ב-' || round((c.price / v_client.max_price - 1) * 100) || '%' end,
          case when v_client.min_price is not null and c.price < v_client.min_price
               then 'מתחת לטווח המחירים שהוגדר' end,
          case when v_client.min_size_sqm is not null and c.size_sqm is null
               then 'גודל הנכס לא מולא במודעה' end,
          case when v_client.min_size_sqm is not null and c.size_sqm is not null and c.size_sqm < v_client.min_size_sqm
               then 'קטן מהמבוקש ב-' || round(v_client.min_size_sqm - c.size_sqm) || ' מ״ר' end,
          case when v_client.max_floor is not null and c.floor is not null and c.floor > v_client.max_floor
               then 'קומה ' || c.floor || ' — גבוה מהמבוקש' end,
          case when c.rooms is null and (v_client.min_rooms is not null or v_client.max_rooms is not null)
               then 'מספר החדרים לא מולא במודעה' end
        ], null)
      ) as calc_reasons
      from candidates c
  )
  select
    s.id, s.src, s.calc_score, s.calc_reasons, s.missing_feats,
    s.title, s.price, s.deal_type, s.property_type, s.rooms, s.floor, s.size_sqm,
    s.city, s.street, s.house_number, s.images, s.is_promoted,
    s.agency_id, a.name, m.display_name, m.phone, s.created_at
    from scored s
    left join public.agencies a       on a.id = s.agency_id
    left join public.agency_members m on m.id = s.agent_id
   where s.calc_score >= 50
   order by s.calc_score desc, s.is_promoted desc, s.created_at desc
   limit 60;
end;
$$;

comment on function public.match_properties_for_client(uuid) is
  'התאמות לנכסים עבור לקוח/ה: הנכסים של הסוכן/ת, של המשרד ומה ששותף עם המשרד. מחזירה ציון וסיבות לכל התאמה חלקית.';

revoke all on function public.match_properties_for_client(uuid) from public;
revoke all on function public.match_properties_for_client(uuid) from anon;
grant execute on function public.match_properties_for_client(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ספירת ההתאמות לכל לקוח/ה
--
-- קריאה אחת במקום אחת לכל שורה ברשימת הלקוחות. הפונקציה הפנימית כבר בודקת
-- בעלות בעצמה, ולכן אין כאן בדיקה כפולה.
-- ---------------------------------------------------------------------------
create or replace function public.client_match_counts()
returns table (client_id uuid, match_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         (select count(*)::int from public.match_properties_for_client(c.id))
    from public.agent_clients c
   where c.agent_id = public.current_agent_id()
     and c.status = 'active';
$$;

comment on function public.client_match_counts() is
  'מספר ההתאמות לכל לקוח/ה פעיל/ה של הסוכן/ת המחובר/ת — לתגית שברשימת הלקוחות.';

revoke all on function public.client_match_counts() from public;
revoke all on function public.client_match_counts() from anon;
grant execute on function public.client_match_counts() to authenticated;

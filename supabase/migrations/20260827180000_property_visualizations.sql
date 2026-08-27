-- ============================================================================
-- מנגנון הדמיות נכסים — נכסים מסחריים ונכסים פרטיים, למנויי Premium
--
-- מיובא מפרויקט nadlan-afula.co.il (‏business-visualizer + generate-room-renders
-- ‏+ classify-photos) ומותאם לסכמה של shuknadlan. שלושה הבדלים מהותיים מהמקור:
--
--   1. ‏באפולה יש טבלת property_photos עם סיווג מובנה. כאן התמונות יושבות
--      במערך properties.images ואין להן סיווג בכלל — ולכן נוספת כאן שכבת
--      תיוג דקה (property_image_tags) שלא נוגעת ב-properties עצמה ולא מחייבת
--      שינוי בטפסי ה-CRM.
--   2. ‏באפולה ההדמיות לנכסים פרטיים קבועות מראש (3 סגנונות × 2 חדרים, batch).
--      כאן המנגנון היברידי: סט בסיס אחד נוצר עם פרסום הנכס ומוצג בדף, וכל
--      סגנון נוסף נוצר לפי דרישת הגולש/ת תמורת שם וטלפון — כלומר ההדמיה היא
--      גם כלי שיווקי וגם מכונת לידים לסוכן/ת.
--   3. ‏הזכאות כאן נגזרת מ-tier של הסוכן/ת (Premium בלבד), בדיוק כמו שאר
--      יכולות ה-tier בפרויקט — ולא פתוחה לכל נכס.
--
-- מטרות ההדמיה:
--   נכס פרטי  — exterior (חזית + חצר), living_room, kitchen
--                exterior נוצר רק לבית פרטי/קוטג'/דו-משפחתי. בדירה בבניין
--                חזית הבניין היא רכוש משותף שאיש לא מתחייב לשפץ, ולכן דירות
--                מקבלות סלון ומטבח בלבד.
--   נכס מסחרי — exterior (שילוט/ויטרינה) + interior_main (ריהוט וציוד לעסק)
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. ליד מסוג הדמיה
--
-- גולש/ת שמבקש/ת סגנון נוסף משאיר/ה שם וטלפון — זה ליד לכל דבר, ולכן הוא
-- נכנס ל-leads הרגילה ומקבל את אותו טיפול tier (‏Mid/Premium נפתח מידית).
-- ---------------------------------------------------------------------------
alter table public.leads drop constraint if exists leads_lead_type_check;
alter table public.leads add constraint leads_lead_type_check
  check (lead_type in ('property_inquiry','owner_inbound','agent_direct_inquiry','visualization'));

-- ---------------------------------------------------------------------------
-- 1. תיוג תמונות הנכס
--
-- ‏properties.images נשאר מקור האמת היחיד לתמונות. הטבלה הזו רק מוסיפה מעליו
-- שכבת סיווג שנכתבת על ידי classify-property-images (Gemini vision), ומאפשרת
-- למנוע ההדמיה לבחור את תמונת המקור הנכונה לכל מטרה. המפתח העסקי הוא
-- ‏(property_id, image_url) — תמונה שהוסרה מהמערך פשוט מפסיקה להיות רלוונטית.
-- ---------------------------------------------------------------------------
create table if not exists public.property_image_tags (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  image_url     text not null,

  -- חוץ/פנים — הסיווג הבסיסי, זהה לזה שבאפולה
  photo_type    text not null default 'unknown'
                check (photo_type in ('exterior','interior','unknown')),

  -- חלל מרכזי מול חלל עזר — משמש בעיקר את ההדמיה המסחרית
  space_role    text not null default 'unclassified'
                check (space_role in ('main','auxiliary','unclassified')),

  -- החדר עצמו — מה שמאפשר את ההדמיה הפרטית לפי חדר
  room_type     text
                check (room_type in
                  ('facade','yard','living_room','kitchen','bedroom',
                   'bathroom','balcony','other')),

  classified_at timestamptz,
  model         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (property_id, image_url)
);

comment on table public.property_image_tags is
  'סיווג AI לתמונות הנכס (חוץ/פנים, חלל מרכזי/עזר, סוג חדר). properties.images נשאר מקור האמת — זו שכבה מעליו בלבד.';
comment on column public.property_image_tags.room_type is
  'facade/yard לתמונות חוץ · living_room/kitchen/bedroom/bathroom/balcony לתמונות פנים · other כשלא מזוהה.';
comment on column public.property_image_tags.classified_at is
  'null = טרם סווגה. classify-property-images מושכת בדיוק את השורות האלה.';

create index if not exists property_image_tags_property_idx
  on public.property_image_tags (property_id);
create index if not exists property_image_tags_pending_idx
  on public.property_image_tags (created_at)
  where classified_at is null;

drop trigger if exists property_image_tags_set_updated_at on public.property_image_tags;
create trigger property_image_tags_set_updated_at
  before update on public.property_image_tags
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. בקשות הדמיה
--
-- שורה אחת לכל בקשה — בין אם היא סט הבסיס שנוצר עם פרסום הנכס
-- (‏trigger_source='base') ובין אם היא בקשת גולש/ת (‏'ondemand').
-- ---------------------------------------------------------------------------
create table if not exists public.visualization_jobs (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties(id) on delete cascade,

  kind           text not null
                 check (kind in ('private_room','commercial_business')),
  trigger_source text not null default 'ondemand'
                 check (trigger_source in ('base','ondemand')),

  -- private_room: איזה סגנון התבקש
  style_key      text,
  -- commercial_business: איזה עסק מדמים
  business_type        text,
  business_description text,

  -- ondemand: הליד שנוצר מהבקשה. base: NULL — אין כאן גולש/ת
  lead_id        uuid references public.leads(id) on delete set null,
  -- base: הסוכן/ת שיזם/ה. ondemand: NULL
  requested_by_agent_id uuid references public.agency_members(id) on delete set null,

  status         text not null default 'pending'
                 check (status in ('pending','processing','done','failed')),
  error_detail   text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- private_room חייב סגנון; commercial_business חייב סוג עסק
  constraint visualization_jobs_kind_fields_check check (
    (kind = 'private_room'        and style_key is not null) or
    (kind = 'commercial_business' and business_type is not null)
  )
);

comment on table public.visualization_jobs is
  'בקשת הדמיה אחת. base = סט הבסיס שנוצר עם פרסום הנכס · ondemand = בקשת גולש/ת שהשאיר/ה פרטים.';
comment on column public.visualization_jobs.lead_id is
  'הליד שנוצר מבקשת הגולש/ת. בבקשת base תמיד NULL — הסוכן/ת אינו/ה ליד של עצמו/ה.';

create index if not exists visualization_jobs_property_idx
  on public.visualization_jobs (property_id, created_at desc);
-- מגבלת הקצב היומית פר נכס נשענת על החיתוך הזה
create index if not exists visualization_jobs_ondemand_rate_idx
  on public.visualization_jobs (property_id, created_at)
  where trigger_source = 'ondemand';

drop trigger if exists visualization_jobs_set_updated_at on public.visualization_jobs;
create trigger visualization_jobs_set_updated_at
  before update on public.visualization_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. ההדמיות עצמן
--
-- שורה לכל תמונה שנוצרה. בנכס פרטי הזהות של הדמיה היא (נכס, חדר, סגנון) —
-- אותה בקשה בדיוק מגולש/ת אחר/ת לא מייצרת מחדש אלא מחזירה את מה שכבר קיים,
-- וזה החיסכון המרכזי במודל ההיברידי. בנכס מסחרי אין זהות כזו, כי סוג העסק
-- הוא טקסט חופשי שמשתנה מבקשה לבקשה.
-- ---------------------------------------------------------------------------
create table if not exists public.property_visualizations (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  job_id         uuid references public.visualization_jobs(id) on delete set null,

  kind           text not null
                 check (kind in ('private_room','commercial_business')),
  target         text not null
                 check (target in ('exterior','living_room','kitchen','interior_main')),
  style_key      text,

  source_image_url text not null,
  result_url       text,

  status         text not null default 'pending'
                 check (status in ('pending','processing','done','failed')),
  error_detail   text,

  -- true = חלק מסט הבסיס שמוצג לכל מבקר/ת בדף הנכס
  is_base        boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.property_visualizations is
  'תמונות ההדמיה שנוצרו. is_base=true מוצג פומבית בדף הנכס; השאר נחשף רק למי שביקש/ה, לפי job_id.';
comment on column public.property_visualizations.source_image_url is
  'התמונה האמיתית שממנה נגזרה ההדמיה — נשמרת לתיעוד ולהצגת "לפני/אחרי".';

-- הדמיה פרטית זהה לא נוצרת פעמיים
create unique index if not exists property_visualizations_private_key
  on public.property_visualizations (property_id, target, style_key)
  where kind = 'private_room';

create index if not exists property_visualizations_job_idx
  on public.property_visualizations (job_id);
create index if not exists property_visualizations_base_idx
  on public.property_visualizations (property_id)
  where is_base = true and status = 'done';

drop trigger if exists property_visualizations_set_updated_at on public.property_visualizations;
create trigger property_visualizations_set_updated_at
  before update on public.property_visualizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. זכאות — Premium בלבד
--
-- אותו עיקרון כמו planning_lookup_min_tier_mid: המספר יושב ב-pricing_config
-- ולא בקוד, אבל הבדיקה עצמה היא פונקציה אחת שגם ה-RLS וגם ה-Edge Functions
-- נשענים עליה, כדי שלא תהיה שום דרך לקבל הדמיה לנכס של סוכן/ת Free.
-- ---------------------------------------------------------------------------
create or replace function public.property_visualizations_enabled(p_property_id uuid)
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
      and m.tier = 'premium'
      and m.billing_status = 'active'
  );
$$;

comment on function public.property_visualizations_enabled(uuid) is
  'הדמיות זמינות רק לנכס פעיל של סוכן/ת Premium פעיל/ה. מקור אמת יחיד ל-RLS ול-Edge Functions.';

grant execute on function public.property_visualizations_enabled(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. ‏RLS
--
-- כל הכתיבה עוברת דרך Edge Functions עם service_role, שעוקף RLS. ללקוח יש
-- קריאה בלבד, ורק דרך ה-view ו-ה-RPC שלמטה — לא ישירות על הטבלאות, כדי
-- שגולש/ת לא תוכל למשוך הדמיות של גולשים אחרים או של נכסים לא פעילים.
-- ---------------------------------------------------------------------------
alter table public.property_image_tags       enable row level security;
alter table public.visualization_jobs        enable row level security;
alter table public.property_visualizations   enable row level security;

revoke select on public.property_image_tags     from anon;
revoke select on public.visualization_jobs      from anon;
revoke select on public.property_visualizations from anon;

-- הסוכן/ת רואה/ה את כל מה ששייך לנכסים שלו/ה — זה מה שמזין את דף הנכס ב-CRM
drop policy if exists "agent reads own property image tags" on public.property_image_tags;
create policy "agent reads own property image tags"
  on public.property_image_tags for select
  using (exists (
    select 1 from public.properties p
    where p.id = property_image_tags.property_id
      and p.agent_id = public.current_agent_id()));

drop policy if exists "agent reads own visualization jobs" on public.visualization_jobs;
create policy "agent reads own visualization jobs"
  on public.visualization_jobs for select
  using (exists (
    select 1 from public.properties p
    where p.id = visualization_jobs.property_id
      and p.agent_id = public.current_agent_id()));

drop policy if exists "agent reads own property visualizations" on public.property_visualizations;
create policy "agent reads own property visualizations"
  on public.property_visualizations for select
  using (exists (
    select 1 from public.properties p
    where p.id = property_visualizations.property_id
      and p.agent_id = public.current_agent_id()));

-- ---------------------------------------------------------------------------
-- 6. סט הבסיס הפומבי
--
-- ‏View ללא security_invoker — אותה תבנית של leads_masked ו-rss_leads_public
-- בפרויקט. זו הדרך להראות לכל מבקר/ת את הדמיות הבסיס בלי לתת ל-anon הרשאת
-- ‏SELECT על property_visualizations עצמה (שם יושבות גם הדמיות של גולשים
-- אחרים, שאינן פומביות).
-- ---------------------------------------------------------------------------
create or replace view public.property_visualizations_public as
select
  v.id,
  v.property_id,
  v.kind,
  v.target,
  v.style_key,
  v.source_image_url,
  v.result_url,
  v.created_at
from public.property_visualizations v
where v.is_base = true
  and v.status = 'done'
  and v.result_url is not null
  and public.property_visualizations_enabled(v.property_id);

comment on view public.property_visualizations_public is
  'הדמיות הבסיס של נכסי Premium פעילים — מה שמוצג בגלריית דף הנכס. ללא הדמיות לפי-דרישה של גולשים.';

grant select on public.property_visualizations_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. מעקב אחרי בקשה לפי דרישה
--
-- הגולש/ת לא יכול/ה לקרוא את הטבלאות, ולכן ה-polling עובר דרך ה-RPC הזה.
-- ה-job_id הוא UUID שנמסר רק למי שיזם/ה את הבקשה — הוא כרטיס הכניסה, בדיוק
-- כמו קישור שיתוף. מה שהפונקציה לא מחזירה: הליד, פרטי הקשר, וכל בקשה אחרת.
-- ---------------------------------------------------------------------------
create or replace function public.visualization_job_status(p_job_id uuid)
returns table (
  job_status text,
  target     text,
  style_key  text,
  result_url text,
  item_status text,
  error_detail text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.status,
    v.target,
    v.style_key,
    v.result_url,
    v.status,
    v.error_detail
  from public.visualization_jobs j
  left join public.property_visualizations v on v.job_id = j.id
  where j.id = p_job_id
  order by v.target;
$$;

comment on function public.visualization_job_status(uuid) is
  'מעקב אחרי בקשת הדמיה. ה-job_id הוא הרשאת הגישה — אין דרך לגלות אותו מהאתר.';

grant execute on function public.visualization_job_status(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. אחסון
--
-- דלי ציבורי, בדיוק כמו property-images: התוצאה מוצגת באתר ומשותפת בוואטסאפ,
-- ואין בה מידע רגיש. הכתיבה נשארת ל-service_role בלבד — אין policy שמאפשרת
-- ל-anon או ל-authenticated להעלות לכאן.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('property-visualizations', 'property-visualizations', true)
on conflict (id) do update set public = true;

drop policy if exists "public read property visualizations" on storage.objects;
create policy "public read property visualizations"
  on storage.objects for select
  using (bucket_id = 'property-visualizations');

-- ---------------------------------------------------------------------------
-- 9. פרמטרים עסקיים
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('visualization_min_tier_premium', 1,
   'מנגנון ההדמיות זמין רק לנכסים של סוכן/ת Premium (1=פעיל)'),
  ('visualization_ondemand_daily_cap', 30,
   'מקסימום בקשות הדמיה לפי-דרישה ליום לנכס — בלם עלות מול שימוש לרעה'),
  ('visualization_base_targets_max', 3,
   'מספר תמונות הבסיס המקסימלי לנכס פרטי (חוץ, סלון, מטבח)')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

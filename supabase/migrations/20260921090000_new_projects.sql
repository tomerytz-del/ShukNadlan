-- ============================================================================
-- פרויקטים חדשים — קבלנים ויזמים
--
-- מודול חדש לצד מודול התיווך, ולא בתוכו. שלוש עובדות מסבירות כמעט כל
-- החלטה בקובץ הזה:
--
--   1. **יזם אינו סוכן.** ‏`agency_members` הוא יחידת המנוי, החיוב והמכסה של
--      עולם התיווך, והוא קשור לרישיון תיווך, לקוד האתי, לדירוג ולמדפי
--      הלידים. חברה קבלנית לא נכנסת לשם — היא מקבלת טבלה משלה
--      (`developers`), ארנק משלה ומסלול חיוב משלו. שום עמודה בעולם התיווך
--      לא זזה כאן.
--   2. **דף נחיתה = פרויקט אחד. תמיד.** זו לא מגבלה שנאכפת בטופס אלא צורת
--      הטבלה: שורה ב-`projects` *היא* דף הנחיתה — ה-slug שלה הוא הכתובת,
--      המנוי החודשי שלה הוא מה שמחזיק את הדף באוויר, והמדיה תלויה בה
--      ב-`project_media`. אין ישות "דף נחיתה" נפרדת שאפשר לתלות בה שני
--      פרויקטים, ולכן אין מה לאכוף.
--   3. **שני מסלולי כסף נפרדים.** ‏350 ₪ לחודש מחזיקים את הדף באוויר
--      (`subscription_*`), ו-50 ₪ לשבוע מקפיצים אותו לראש הגלריות
--      (`is_promoted`/`promoted_until`). קידום בלי מנוי פעיל חסום ברמת
--      ה-RPC: קידום של דף שאינו מתפרסם הוא כסף על לא כלום.
--
-- מחיקת פרויקט דורשת **שני** צעדים (`delete_requested_at` ואז אישור עם
-- אותו טוקן) — הבקשה מסומנת, הדף יורד מהאוויר מיד, והמחיקה בפועל מתבצעת
-- רק אחרי אישור נוסף. עד אז אפשר לבטל.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. חברות יזמיות/קבלניות — ה"משרד" של היזם
--
-- ‏user_id הוא הבעלים היחיד של החברה, וזו גם כל מדיניות ה-RLS: מי שפתח/ה
-- את החברה הוא/היא שמנהל/ת אותה. אין כאן צוות כמו ב-agency_members, כי
-- ליזם אין רוטציית לידים ואין מכסות פר-אדם — יש חשבון חברה אחד.
-- ---------------------------------------------------------------------------
create table if not exists public.developers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references auth.users(id) on delete set null,
  slug           text,

  -- ---------------------------------------------------------------------
  -- גרעין החובה
  --
  -- שישה שדות שחברה אינה יכולה להירשם בלעדיהם — ולא יכולה גם לרוקן אחרי
  -- שנרשמה. ‏not null כאן ולא רק בטופס, כי זו הדרישה עצמה ולא בקשה:
  -- שלושה מסלולים שונים יוצרים חברה (טופס ההרשמה, מסך פתיחת החברה של
  -- כניסת Google, ומסך העריכה בדשבורד), ואכיפה בשלושתם היא שלוש הזדמנויות
  -- לשכוח באחד מהם. ‏NOT NULL ברמת הטבלה הוא המקום היחיד שאי אפשר לעקוף.
  --
  -- ‏NOT NULL לבדו אינו מספיק — מחרוזת ריקה עוברת אותו — ולכן ה-CHECK
  -- שלמטה דורש תוכן אחרי trim.
  -- ---------------------------------------------------------------------
  name           text not null,
  company_number text not null,
  contact_name   text not null,
  phone          text not null,
  address        text not null,
  city           text not null,

  legal_name     text,

  -- מיתוג דף החברה
  logo_url       text,
  cover_url      text,
  colors         jsonb not null default '{}'::jsonb,
  tagline        text,
  description    text,

  -- יצירת קשר
  phone_e164     text,
  email          text,
  website        text,

  -- רקורד
  founded_year      smallint,
  projects_delivered smallint,

  status         text not null default 'active' check (status in ('active','suspended')),
  credit_balance numeric not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.developers is
  'חברה יזמית/קבלנית — ה"משרד" של היזם. נפתחת דרך developer-signup, ומחזיקה את דף החברה ואת כל הפרויקטים שלה.';
comment on column public.developers.user_id is
  'חשבון ה-Auth של מי שפתח/ה את החברה. זו כל מדיניות ההרשאות: בעלים אחד לחברה.';
comment on column public.developers.credit_balance is
  'ארנק החברה בשקלים. ממנו יורדים 350 ₪ לחודש לכל דף נחיתה ו-50 ₪ לשבוע לכל קידום. נכתב אך ורק דרך service_role.';
comment on column public.developers.colors is
  'ערכת הצבעים של דף החברה ({"brand":"#…","accent":"#…"}). מוזרקת ב-JS ל-documentElement, בדיוק כמו בדף המשרד.';
comment on column public.developers.company_number is
  'ח״פ / עוסק מורשה, תשע ספרות. מנורמל בפונקציית הקצה — מספר בן שמונה ספרות מקבל אפס מוביל.';
comment on column public.developers.contact_name is
  'שם איש/אשת הקשר בחברה. נפרד מ-name (שם החברה) ומ-projects.contact_name (משרד המכירות של פרויקט מסוים).';

-- ‏NOT NULL עוצר NULL ולא מחרוזת ריקה, ו-'' היא בדיוק מה שטופס שולח כשלא
-- מילאו אותו. ה-CHECK הזה הוא מה שהופך את ששת השדות לחובה בפועל.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'developers_core_fields_filled') then
    alter table public.developers add constraint developers_core_fields_filled check (
      length(btrim(name)) > 0
      and length(btrim(contact_name)) > 0
      and length(btrim(phone)) > 0
      and length(btrim(address)) > 0
      and length(btrim(city)) > 0
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'developers_company_number_format') then
    alter table public.developers add constraint developers_company_number_format
      check (company_number ~ '^[0-9]{9}$');
  end if;
end $$;

-- אותו ח״פ אינו נרשם פעמיים. זו הבדיקה היחידה שיש לנו נגד אותה חברה
-- שפותחת שני חשבונות ומחזיקה שני דפי חברה מתחרים על אותם פרויקטים.
create unique index if not exists developers_company_number_key
  on public.developers(company_number);

create unique index if not exists developers_slug_key
  on public.developers(slug) where slug is not null;
create index if not exists developers_status_idx on public.developers(status);

drop trigger if exists developers_set_updated_at on public.developers;
create trigger developers_set_updated_at
  before update on public.developers
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 2. פרויקטים — כל שורה היא דף נחיתה אחד
--
-- הטווחים (min/max של מחיר, חדרים, שטח) יושבים על הפרויקט ולא נגזרים
-- מדגמי הדירות בזמן אמת בכוונה: דף הפרויקטים המרכזי מסנן לפיהם, ושאילתת
-- סינון שצריכה לצרף טבלת בת ולחשב aggregate על כל פרויקט היא בדיוק מה
-- שהופך סינון מיידי לשאילתה כבדה. הטריגר שלמטה מסנכרן אותם מדגמי הדירות
-- כשיש כאלה, כך שהיזם לא צריך לתחזק את שניהם.
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  developer_id   uuid not null references public.developers(id) on delete cascade,
  slug           text,
  name           text not null,
  tagline        text,
  description    text,

  -- מיקום
  city            text,
  neighborhood_id uuid references public.neighborhoods(id) on delete set null,
  address         text,
  street          text,
  lat             double precision,
  lng             double precision,

  -- שלב הפרויקט ולוחות זמנים
  project_stage  text not null default 'pre_sale'
                 check (project_stage in ('planning','pre_sale','under_construction','ready','completed')),
  occupancy_date date,
  occupancy_text text,

  -- היקף
  buildings_count smallint,
  floors_count    smallint,
  total_units     smallint,
  available_units smallint,

  -- טווחים לסינון בדף הפרויקטים
  min_price     numeric,
  max_price     numeric,
  min_rooms     numeric,
  max_rooms     numeric,
  min_size_sqm  numeric,
  max_size_sqm  numeric,
  property_types text[] not null default '{}',
  features       text[] not null default '{}',

  -- מיתוג דף הנחיתה
  logo_url  text,
  cover_url text,
  colors    jsonb not null default '{}'::jsonb,

  -- מדיה ראשית. הגלריה המלאה יושבת ב-project_media; אלה הפריטים שהדף
  -- מציג בראשו ולכן שווה שיהיו בשורה עצמה ולא בשאילתה שנייה.
  video_url    text,
  tour_3d_url  text,
  brochure_url text,

  -- חומר שיווקי להורדה ולשיתוף
  marketing_summary text,

  -- יצירת קשר של הפרויקט (משרד המכירות), נפרד מפרטי החברה
  contact_name       text,
  contact_phone      text,
  contact_phone_e164 text,
  contact_email      text,
  whatsapp_e164      text,

  -- מצב פרסום
  status       text not null default 'draft'
               check (status in ('draft','active','paused','archived')),
  published_at timestamptz,

  -- מנוי דף הנחיתה — 350 ₪ לחודש
  subscription_status     text not null default 'none'
                          check (subscription_status in ('none','active','expired')),
  subscription_started_at timestamptz,
  subscription_expires_at timestamptz,

  -- קידום — 50 ₪ לשבוע
  is_promoted    boolean not null default false,
  promoted_until timestamptz,

  -- מחיקה בשני צעדים
  delete_requested_at  timestamptz,
  delete_confirm_token uuid,

  views_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.projects is
  'פרויקט נדל"ן חדש. שורה אחת = דף נחיתה אחד — אין ישות "דף" נפרדת, ולכן אי אפשר לתלות שני פרויקטים באותו דף.';
comment on column public.projects.slug is
  'הכתובת הציבורית (project.html?slug=…). נוצרת בטריגר מהשם, כדי שגם שורה שנכתבה מ-SQL תקבל כתובת תקינה.';
comment on column public.projects.subscription_expires_at is
  'עד מתי דף הנחיתה משולם. אחרי התאריך הזה הפרויקט נעלם מ-projects_public — הנתונים נשארים, הדף יורד.';
comment on column public.projects.promoted_until is
  'סוף חלון הקידום. שני המקומות הראשונים בגלריית דף הבית שמורים לפרויקטים שהחלון שלהם פתוח.';
comment on column public.projects.delete_requested_at is
  'רגע בקשת המחיקה. המחיקה בפועל דורשת אישור נוסף עם delete_confirm_token — עד אז אפשר לבטל.';
comment on column public.projects.min_price is
  'מסונכרן מדגמי הדירות בטריגר כשיש כאלה, וניתן לעריכה ידנית כשאין. דף הפרויקטים מסנן לפיו.';

create unique index if not exists projects_slug_key
  on public.projects(slug) where slug is not null;
create index if not exists projects_developer_idx on public.projects(developer_id);
create index if not exists projects_live_idx
  on public.projects(published_at desc)
  where status = 'active';
create index if not exists projects_promoted_idx
  on public.projects(promoted_until desc)
  where is_promoted = true;
create index if not exists projects_city_idx on public.projects(city);


-- ---------------------------------------------------------------------------
-- 3. דגמי הדירות בפרויקט
-- ---------------------------------------------------------------------------
create table if not exists public.project_unit_types (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  rooms        numeric,
  size_sqm     numeric,
  balcony_sqm  numeric,
  garden_sqm   numeric,
  floor_plan_url text,
  price        numeric,
  units_total     smallint,
  units_available smallint,
  availability text not null default 'available'
               check (availability in ('available','few_left','sold_out')),
  notes        text,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.project_unit_types is
  'תמהיל הדירות בפרויקט — דגם, חדרים, שטח, תוכנית ומחיר. מזין את טווחי הסינון של הפרויקט דרך טריגר.';

create index if not exists project_unit_types_project_idx
  on public.project_unit_types(project_id, sort_order);


-- ---------------------------------------------------------------------------
-- 4. מדיה — תמונות, סרטונים, סיורי 3D וחומר שיווקי להורדה
--
-- טבלה אחת לכל סוגי המדיה ולא ארבע עמודות מערך על הפרויקט: הסדר בגלריה
-- הוא נתון בפני עצמו, וקובץ להורדה צריך שם תצוגה וגודל. ‏kind הוא מה
-- שקובע איפה הפריט מוצג בדף.
-- ---------------------------------------------------------------------------
create table if not exists public.project_media (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind       text not null default 'image'
             check (kind in ('image','video','tour_3d','floor_plan','document')),
  url        text not null,
  thumb_url  text,
  title      text,
  caption    text,
  file_size  integer,
  downloadable boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.project_media is
  'גלריית הפרויקט: תמונות, סרטונים, סיורי 3D, תוכניות דירה וחומר שיווקי. kind קובע היכן הפריט מוצג בדף.';
comment on column public.project_media.downloadable is
  'האם הפריט מוצע להורדה בדף הפרויקט (חוברת מכר, תוכנית קומה). רלוונטי בעיקר ל-document ו-floor_plan.';

create index if not exists project_media_project_idx
  on public.project_media(project_id, kind, sort_order);


-- ---------------------------------------------------------------------------
-- 5. לידים של מחפשי פרויקטים חדשים
--
-- שני מקורות לאותה טבלה: פנייה מדף פרויקט מסוים (project_id מלא — הליד
-- שייך ליזם ההוא ואינו נמכר לאיש), ותיבת "מחפשים פרויקט חדש?" בדף
-- הפרויקטים (project_id ריק — זה ליד גנרי שנמכר ליזם אחד).
--
-- ‏raw_* רגישים ולכן anon נשלל מהטבלה לגמרי; הכתיבה עוברת ב-service_role
-- דרך project-lead-intake, בדיוק כמו saved_searches.
-- ---------------------------------------------------------------------------
create table if not exists public.project_leads (
  id          uuid primary key default gen_random_uuid(),

  -- פנייה ישירה לפרויקט. ריק = ליד גנרי מהמדף.
  project_id   uuid references public.projects(id) on delete set null,
  developer_id uuid references public.developers(id) on delete set null,

  full_name   text not null,
  phone       text not null,
  phone_e164  text,
  email       text,
  message     text,

  -- מה מחפשים (הליד הגנרי)
  cities        text[] not null default '{}',
  rooms         numeric[] not null default '{}',
  min_price     numeric,
  max_price     numeric,
  timeline      text check (timeline in ('now','3_months','6_months','12_months','exploring')),
  purpose       text check (purpose in ('residence','investment','upgrade','first_home')),

  intent_score  smallint not null default 50,
  consent_contact boolean not null default true,
  source        text not null default 'projects_page',

  -- מסלול המכירה של הליד הגנרי
  lead_status   text not null default 'available'
                check (lead_status in ('available','sold','closed')),
  sold_to_developer_id uuid references public.developers(id) on delete set null,
  sold_at       timestamptz,

  status        text not null default 'new'
                check (status in ('new','contacted','qualified','closed','spam')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.project_leads is
  'לידים של מחפשי פרויקטים חדשים. project_id מלא = פנייה ישירה ליזם; ריק = ליד גנרי מהמדף, שנמכר ליזם אחד.';
comment on column public.project_leads.lead_status is
  'רק לליד גנרי. available = במדף, sold = נרכש. פנייה ישירה נשארת available ואינה מוצגת במדף.';

create index if not exists project_leads_project_idx on public.project_leads(project_id);
create index if not exists project_leads_shelf_idx
  on public.project_leads(created_at desc)
  where project_id is null and lead_status = 'available';

drop trigger if exists project_leads_set_updated_at on public.project_leads;
create trigger project_leads_set_updated_at
  before update on public.project_leads
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 6. רכישות לידים — unique(lead_id) מונע מכירה כפולה
-- ---------------------------------------------------------------------------
create table if not exists public.project_lead_purchases (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null unique references public.project_leads(id) on delete cascade,
  developer_id uuid not null references public.developers(id) on delete cascade,
  amount       numeric not null,
  status       text not null default 'charged' check (status in ('charged','refunded')),
  created_at   timestamptz not null default now()
);

comment on table public.project_lead_purchases is
  'רכישת ליד מחפש/ת פרויקט חדש. unique(lead_id) הוא רשת הביטחון מול שתי בקשות מקבילות.';


-- ---------------------------------------------------------------------------
-- 7. יומן החיובים של היזם
-- ---------------------------------------------------------------------------
create table if not exists public.project_charges (
  id           uuid primary key default gen_random_uuid(),
  developer_id uuid not null references public.developers(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  charge_type  text not null
               check (charge_type in ('landing_page_monthly','promotion_weekly','lead_purchase')),
  amount       numeric not null,
  period_start timestamptz not null default now(),
  period_end   timestamptz,
  status       text not null default 'charged' check (status in ('charged','refunded')),
  created_at   timestamptz not null default now()
);

comment on table public.project_charges is
  'כל חיוב של יזם במקום אחד: מנוי דף נחיתה, קידום שבועי ורכישת ליד. מזין את מסך "חיובים" בדשבורד היזם.';

create index if not exists project_charges_developer_idx
  on public.project_charges(developer_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 8. טעינות ארנק של יזם
-- ---------------------------------------------------------------------------
create table if not exists public.developer_topups (
  id           uuid primary key default gen_random_uuid(),
  developer_id uuid not null references public.developers(id) on delete cascade,
  amount       numeric not null,
  status       text not null default 'paid' check (status in ('pending','paid','failed')),
  test_mode    boolean not null default true,
  provider     text,
  provider_charge_id text,
  created_at   timestamptz not null default now()
);

comment on table public.developer_topups is
  'טעינות ארנק של חברה יזמית. test_mode=true כל עוד אין ספק סליקה מחובר — אותה תבנית כמו wallet_topups.';


-- ---------------------------------------------------------------------------
-- 9. צפיות בדף הפרויקט
-- ---------------------------------------------------------------------------
create table if not exists public.project_views (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  visitor_session_id text
);

create index if not exists project_views_project_idx
  on public.project_views(project_id, viewed_at desc);


-- ---------------------------------------------------------------------------
-- 10. ‏slug ו-published_at אוטומטיים
--
-- אותה תבנית של articles: הסיומת היא שישה תווים מה-id, ולכן אין לולאת
-- בדיקת התנגשויות. ‏published_at נקבע פעם אחת במעבר ל-active, כדי
-- שעריכה של פרויקט קיים לא תקפיץ אותו מחדש לראש הגלריה.
-- ---------------------------------------------------------------------------
create or replace function public.projects_fill_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := nullif(trim(both '-' from
        regexp_replace(coalesce(new.name, ''), '[^[:alnum:]]+', '-', 'g')
      ), '') || '-' || left(new.id::text, 6);
    new.slug := coalesce(new.slug, 'project-' || left(new.id::text, 8));
  end if;

  if new.status = 'active' and new.published_at is null then
    new.published_at := now();
  end if;

  -- חלון קידום שנסגר מכבה את הדגל. בלי זה השאילתה הייתה צריכה לבדוק
  -- שני שדות בכל מקום, ומוקדם או מאוחר אחד מהם היה נשכח.
  if new.promoted_until is not null and new.promoted_until <= now() then
    new.is_promoted := false;
  end if;

  return new;
end;
$$;

revoke execute on function public.projects_fill_defaults() from public, anon, authenticated;

drop trigger if exists projects_fill_defaults on public.projects;
create trigger projects_fill_defaults
  before insert or update on public.projects
  for each row execute function public.projects_fill_defaults();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 11. סנכרון טווחי הפרויקט מדגמי הדירות
--
-- רץ על כל שינוי בדגמי הדירות. פרויקט בלי דגמים שומר על מה שהיזם הקליד
-- ידנית — ה-coalesce הוא מה שמונע איפוס של שדות שמולאו בטופס.
-- ---------------------------------------------------------------------------
create or replace function public.project_sync_ranges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := coalesce(new.project_id, old.project_id);
  v_count   int;
begin
  select count(*) into v_count from public.project_unit_types where project_id = v_project;
  if v_count = 0 then
    return coalesce(new, old);
  end if;

  update public.projects p
  set min_price    = coalesce(agg.min_price, p.min_price),
      max_price    = coalesce(agg.max_price, p.max_price),
      min_rooms    = coalesce(agg.min_rooms, p.min_rooms),
      max_rooms    = coalesce(agg.max_rooms, p.max_rooms),
      min_size_sqm = coalesce(agg.min_size, p.min_size_sqm),
      max_size_sqm = coalesce(agg.max_size, p.max_size_sqm)
  from (
    select min(price) filter (where price > 0)       as min_price,
           max(price) filter (where price > 0)       as max_price,
           min(rooms) filter (where rooms > 0)       as min_rooms,
           max(rooms) filter (where rooms > 0)       as max_rooms,
           min(size_sqm) filter (where size_sqm > 0) as min_size,
           max(size_sqm) filter (where size_sqm > 0) as max_size
    from public.project_unit_types where project_id = v_project
  ) agg
  where p.id = v_project;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.project_sync_ranges() from public, anon, authenticated;

drop trigger if exists project_unit_types_sync_ranges on public.project_unit_types;
create trigger project_unit_types_sync_ranges
  after insert or update or delete on public.project_unit_types
  for each row execute function public.project_sync_ranges();

drop trigger if exists project_unit_types_set_updated_at on public.project_unit_types;
create trigger project_unit_types_set_updated_at
  before update on public.project_unit_types
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 12. מיהו היזם המחובר
--
-- המקבילה של current_agent_id() לעולם היזמים. משמשת גם את מדיניות ה-RLS
-- וגם את מדיניות האחסון.
-- ---------------------------------------------------------------------------
create or replace function public.current_developer_id()
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select id from developers where user_id = (select auth.uid()) limit 1;
$$;

comment on function public.current_developer_id() is
  'מזהה החברה היזמית של המשתמש/ת המחובר/ת, או NULL. המקבילה של current_agent_id() בעולם היזמים.';


-- ---------------------------------------------------------------------------
-- 13. ‏RLS
--
-- הכלל אחיד בכל הטבלאות: היזם רואה וכותב את מה ששייך לחברה שלו, הציבור
-- קורא רק פרויקט חי (פעיל + מנוי בתוקף), ומנהל/ת הפלטפורמה רואה הכול.
-- ---------------------------------------------------------------------------
alter table public.developers            enable row level security;
alter table public.projects              enable row level security;
alter table public.project_unit_types    enable row level security;
alter table public.project_media         enable row level security;
alter table public.project_leads         enable row level security;
alter table public.project_lead_purchases enable row level security;
alter table public.project_charges       enable row level security;
alter table public.developer_topups      enable row level security;
alter table public.project_views         enable row level security;

-- הכסף אף פעם לא נכתב מהדפדפן. הארנק, החיובים והרכישות עוברים ב-RPC
-- שרץ ב-security definer דרך Edge Function, ולכן ההרשאה נשללת כאן
-- לגמרי ולא רק נחסמת ב-policy.
revoke insert, update, delete on public.developers            from anon, authenticated;
revoke insert, update, delete on public.project_lead_purchases from anon, authenticated;
revoke insert, update, delete on public.project_charges       from anon, authenticated;
revoke insert, update, delete on public.developer_topups      from anon, authenticated;
revoke insert, update, delete on public.project_leads         from anon, authenticated;
revoke select on public.project_leads from anon;
revoke insert, update, delete on public.projects              from anon;
revoke insert, update, delete on public.project_unit_types    from anon;
revoke insert, update, delete on public.project_media         from anon;

-- ---- developers ----
drop policy if exists "public reads active developers" on public.developers;
create policy "public reads active developers"
  on public.developers for select
  using (status = 'active');

drop policy if exists "platform admin manages developers" on public.developers;
create policy "platform admin manages developers"
  on public.developers for all
  using (exists (select 1 from public.agency_members m
                 where m.user_id = (select auth.uid()) and m.is_platform_admin = true))
  with check (exists (select 1 from public.agency_members m
                 where m.user_id = (select auth.uid()) and m.is_platform_admin = true));

-- ---- projects ----
-- "חי" = פעיל, פורסם, המנוי בתוקף ואין בקשת מחיקה פתוחה. אותו תנאי בדיוק
-- חוזר ב-projects_public; הוא נכתב פעמיים כי policy אינה יכולה לקרוא view
-- שנשען עליה.
drop policy if exists "public reads live projects" on public.projects;
create policy "public reads live projects"
  on public.projects for select
  using (
    status = 'active'
    and delete_requested_at is null
    and (published_at is null or published_at <= now())
    and (subscription_expires_at is null or subscription_expires_at > now())
  );

drop policy if exists "developer reads own projects" on public.projects;
create policy "developer reads own projects"
  on public.projects for select
  using (developer_id = (select public.current_developer_id()));

drop policy if exists "developer writes own projects" on public.projects;
create policy "developer writes own projects"
  on public.projects for insert to authenticated
  with check (developer_id = (select public.current_developer_id()));

-- ‏USING ו-WITH CHECK זהים: עדכון לא יכול להעביר פרויקט לחברה אחרת.
drop policy if exists "developer updates own projects" on public.projects;
create policy "developer updates own projects"
  on public.projects for update to authenticated
  using (developer_id = (select public.current_developer_id()))
  with check (developer_id = (select public.current_developer_id()));

-- אין policy של DELETE בכוונה: מחיקה עוברת דרך ה-RPC בן שני הצעדים.

drop policy if exists "platform admin manages projects" on public.projects;
create policy "platform admin manages projects"
  on public.projects for all
  using (exists (select 1 from public.agency_members m
                 where m.user_id = (select auth.uid()) and m.is_platform_admin = true))
  with check (exists (select 1 from public.agency_members m
                 where m.user_id = (select auth.uid()) and m.is_platform_admin = true));

-- ---- טבלאות הבת: אותה בעלות, דרך הפרויקט ----
drop policy if exists "public reads unit types of live projects" on public.project_unit_types;
create policy "public reads unit types of live projects"
  on public.project_unit_types for select
  using (exists (select 1 from public.projects p where p.id = project_id));

drop policy if exists "developer manages own unit types" on public.project_unit_types;
create policy "developer manages own unit types"
  on public.project_unit_types for all to authenticated
  using (exists (select 1 from public.projects p
                 where p.id = project_id and p.developer_id = (select public.current_developer_id())))
  with check (exists (select 1 from public.projects p
                 where p.id = project_id and p.developer_id = (select public.current_developer_id())));

drop policy if exists "public reads media of live projects" on public.project_media;
create policy "public reads media of live projects"
  on public.project_media for select
  using (exists (select 1 from public.projects p where p.id = project_id));

drop policy if exists "developer manages own media" on public.project_media;
create policy "developer manages own media"
  on public.project_media for all to authenticated
  using (exists (select 1 from public.projects p
                 where p.id = project_id and p.developer_id = (select public.current_developer_id())))
  with check (exists (select 1 from public.projects p
                 where p.id = project_id and p.developer_id = (select public.current_developer_id())));

-- ---- לידים ----
-- הליד הגנרי נחשף במדף בלי הפרטים המזהים (ראו project_leads_shelf), ולכן
-- ה-policy כאן פותחת את השורה המלאה רק ליזם שהיא שייכת לו: פנייה ישירה
-- לפרויקט שלו, או ליד גנרי שהוא רכש.
drop policy if exists "developer reads own project leads" on public.project_leads;
create policy "developer reads own project leads"
  on public.project_leads for select to authenticated
  using (
    developer_id = (select public.current_developer_id())
    or sold_to_developer_id = (select public.current_developer_id())
    or exists (select 1 from public.projects p
               where p.id = project_id and p.developer_id = (select public.current_developer_id()))
  );

drop policy if exists "developer updates own project leads" on public.project_leads;
create policy "developer updates own project leads"
  on public.project_leads for update to authenticated
  using (
    developer_id = (select public.current_developer_id())
    or sold_to_developer_id = (select public.current_developer_id())
    or exists (select 1 from public.projects p
               where p.id = project_id and p.developer_id = (select public.current_developer_id()))
  )
  with check (true);

drop policy if exists "platform admin reads project leads" on public.project_leads;
create policy "platform admin reads project leads"
  on public.project_leads for select
  using (exists (select 1 from public.agency_members m
                 where m.user_id = (select auth.uid()) and m.is_platform_admin = true));

-- ---- חיובים, רכישות, טעינות ----
drop policy if exists "developer reads own charges" on public.project_charges;
create policy "developer reads own charges"
  on public.project_charges for select to authenticated
  using (developer_id = (select public.current_developer_id()));

drop policy if exists "developer reads own purchases" on public.project_lead_purchases;
create policy "developer reads own purchases"
  on public.project_lead_purchases for select to authenticated
  using (developer_id = (select public.current_developer_id()));

drop policy if exists "developer reads own topups" on public.developer_topups;
create policy "developer reads own topups"
  on public.developer_topups for select to authenticated
  using (developer_id = (select public.current_developer_id()));

-- ---- צפיות ----
-- כתיבה ציבורית בלבד, בלי קריאה: המונה מוצג ליזם דרך projects.views_count.
drop policy if exists "anyone logs a project view" on public.project_views;
create policy "anyone logs a project view"
  on public.project_views for insert
  with check (true);

drop policy if exists "developer reads own project views" on public.project_views;
create policy "developer reads own project views"
  on public.project_views for select to authenticated
  using (exists (select 1 from public.projects p
                 where p.id = project_id and p.developer_id = (select public.current_developer_id())));


-- ---------------------------------------------------------------------------
-- 14. מה שהאתר הציבורי קורא
--
-- ‏security_invoker=true — ה-view לא מרחיב גישה, הוא רק מרכז את תנאי
-- ה"חי" ואת סדר הקידום במקום אחד, כדי שדף הבית, דף הפרויקטים ודף החברה
-- לא יכתבו אותם שלוש פעמים (ולא ישכחו אחד מהם).
-- ---------------------------------------------------------------------------
create or replace view public.projects_public
with (security_invoker = true) as
select
  p.id,
  p.slug,
  p.developer_id,
  p.name,
  p.tagline,
  p.description,
  p.city,
  p.neighborhood_id,
  p.address,
  p.street,
  p.lat,
  p.lng,
  p.project_stage,
  p.occupancy_date,
  p.occupancy_text,
  p.buildings_count,
  p.floors_count,
  p.total_units,
  p.available_units,
  p.min_price,
  p.max_price,
  p.min_rooms,
  p.max_rooms,
  p.min_size_sqm,
  p.max_size_sqm,
  p.property_types,
  p.features,
  p.logo_url,
  p.cover_url,
  p.colors,
  p.video_url,
  p.tour_3d_url,
  p.brochure_url,
  p.marketing_summary,
  p.contact_name,
  p.contact_phone,
  p.contact_phone_e164,
  p.contact_email,
  p.whatsapp_e164,
  p.published_at,
  -- הדגל שהתצוגה קוראת. ‏is_promoted לבדו יכול להישאר true עד שהטריגר
  -- ייגע בשורה, ולכן החלון נבדק כאן ולא נסמכים עליו.
  (p.is_promoted and p.promoted_until is not null and p.promoted_until > now()) as is_promoted,
  p.promoted_until,
  p.views_count,
  d.slug as developer_slug,
  d.name as developer_name,
  d.logo_url as developer_logo_url
from public.projects p
join public.developers d on d.id = p.developer_id
where p.status = 'active'
  and p.delete_requested_at is null
  and (p.published_at is null or p.published_at <= now())
  and (p.subscription_expires_at is null or p.subscription_expires_at > now())
  and d.status = 'active';

comment on view public.projects_public is
  'הפרויקטים החיים. "חי" = פעיל + פורסם + מנוי דף הנחיתה בתוקף + החברה פעילה. is_promoted כאן כבר מחושב מול השעון.';

grant select on public.projects_public to anon, authenticated;


-- ‏drop + create ולא create or replace, ובכוונה.
--
-- ‏create or replace view אינו מרשה להסיר או לשנות סדר עמודות (כלל 3
-- ב-docs/supabase-migrations.md), וה-view הזה מוגדר ב**שני** קבצי מיגרציה:
-- כאן, ושוב ב-20260922090000 שמוסיף לו את עמודות האימות. הרצה חוזרת של
-- הקובץ המוקדם אחרי המאוחר הייתה מנסה "להחליף" view רחב בצר ונופלת על
-- ‏cannot drop columns from view — כלומר הקובץ מפסיק להיות אידמפוטנטי.
--
-- ‏drop ללא cascade בכוונה: אם ביום מן הימים משהו ייסמך על ה-view, עדיף
-- שההרצה תיפול ברעש מאשר תמחק אותו בשקט.
drop view if exists public.developers_public;
create view public.developers_public
with (security_invoker = true) as
select
  d.id,
  d.slug,
  d.name,
  d.legal_name,
  d.logo_url,
  d.cover_url,
  d.colors,
  d.tagline,
  d.description,
  d.phone,
  d.phone_e164,
  d.email,
  d.website,
  d.address,
  d.city,
  d.founded_year,
  d.projects_delivered,
  (select count(*) from public.projects p
   where p.developer_id = d.id and p.status = 'active'
     and p.delete_requested_at is null
     and (p.subscription_expires_at is null or p.subscription_expires_at > now())) as live_projects,
  d.contact_name
from public.developers d
where d.status = 'active';

comment on view public.developers_public is
  'החברות היזמיות הפעילות, עם מונה הפרויקטים החיים שלהן. מזין את דף החברה ואת שורת היזם בכרטיס הפרויקט.';

grant select on public.developers_public to anon, authenticated;


create or replace view public.project_media_public
with (security_invoker = true) as
select m.id, m.project_id, m.kind, m.url, m.thumb_url, m.title, m.caption,
       m.file_size, m.downloadable, m.sort_order
from public.project_media m;

comment on view public.project_media_public is
  'גלריית הפרויקט כפי שהדף קורא אותה. הסינון לפרויקטים חיים מגיע מה-policy של project_media, לא מכאן.';

grant select on public.project_media_public to anon, authenticated;


create or replace view public.project_unit_types_public
with (security_invoker = true) as
select u.id, u.project_id, u.name, u.rooms, u.size_sqm, u.balcony_sqm, u.garden_sqm,
       u.floor_plan_url, u.price, u.units_total, u.units_available, u.availability,
       u.notes, u.sort_order
from public.project_unit_types u;

comment on view public.project_unit_types_public is
  'תמהיל הדירות כפי שדף הפרויקט מציג אותו.';

grant select on public.project_unit_types_public to anon, authenticated;


-- מדף הלידים של היזמים: ליד גנרי בלי שם, טלפון ואימייל. אותה תבנית של
-- leads_masked — היזם רואה מה יש בליד לפני שהוא משלם, ולא מי זה.
--
-- **וזה ה-view היחיד כאן שאינו security_invoker, בכוונה.** ה-policy על
-- ‏project_leads פותחת ליזם אך ורק לידים ששייכים לו — וליד במדף, בהגדרה,
-- עדיין לא שייך לאיש. ‏view עם security_invoker היה מחזיר ליזם רשימה ריקה
-- תמיד, כלומר מדף שלא ניתן למכור ממנו דבר.
--
-- הפתרון אינו לפתוח את הטבלה: היא מכילה שם, טלפון ואימייל של אדם פרטי,
-- ו-policy שתיתן ליזמים לקרוא ממנה תדליף בדיוק את מה שהוא משלם עבורו.
-- לכן ה-view רץ בהרשאות הבעלים, מקרין **רק** את השדות הלא-מזהים, וה-
-- ‏exists שלמטה מחליף את ה-policy שנעקפה: מי שאינו יזם רשום מקבל אפס
-- שורות, גם אם הוא מחובר.
create or replace view public.project_leads_shelf
with (security_invoker = false) as
select
  l.id,
  l.cities,
  l.rooms,
  l.min_price,
  l.max_price,
  l.timeline,
  l.purpose,
  l.intent_score,
  l.source,
  l.created_at,
  -- רמז בלבד, לא זיהוי: אות ראשונה של השם וארבע ספרות אחרונות של הטלפון
  left(coalesce(l.full_name, ''), 1) || '׳'          as name_hint,
  '***' || right(coalesce(l.phone, ''), 4)           as phone_hint,
  (l.email is not null and l.email <> '')            as has_email,
  (l.message is not null and l.message <> '')        as has_message
from public.project_leads l
where l.project_id is null
  and l.lead_status = 'available'
  and l.status <> 'spam'
  -- שומר הסף שמחליף את ה-RLS שה-view עוקף
  and exists (
    select 1 from public.developers d
    where d.user_id = (select auth.uid()) and d.status = 'active'
  );

comment on view public.project_leads_shelf is
  'מדף לידי מחפשי פרויקטים חדשים — מה שהיזם רואה לפני הרכישה. בלי שם, טלפון או אימייל.';

grant select on public.project_leads_shelf to authenticated;
revoke select on public.project_leads_shelf from anon;


-- ---------------------------------------------------------------------------
-- 15. ‏RPC: מנוי דף הנחיתה — 350 ₪ לחודש
--
-- ‏security definer, ולכן הוא זה שנוגע בארנק. חידוש מאריך מהתאריך הקיים
-- ולא מהיום: מי שחידש/ה יומיים לפני הסוף לא מאבד/ת אותם.
-- ---------------------------------------------------------------------------
create or replace function public.project_activate_page(p_project_id uuid, p_developer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price numeric;
  v_days  numeric;
  v_from  timestamptz;
  v_until timestamptz;
  v_rows  int;
begin
  if not exists (select 1 from public.projects
                 where id = p_project_id and developer_id = p_developer_id) then
    return jsonb_build_object('error', 'not_your_project');
  end if;

  select value into v_price from public.pricing_config where key = 'project_page_monthly_price';
  v_price := coalesce(v_price, 350);
  select value into v_days from public.pricing_config where key = 'project_page_period_days';
  v_days := coalesce(v_days, 30);

  select greatest(coalesce(subscription_expires_at, now()), now())
    into v_from
  from public.projects where id = p_project_id;
  v_until := v_from + make_interval(days => v_days::int);

  update public.developers set credit_balance = credit_balance - v_price
  where id = p_developer_id and credit_balance >= v_price;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'required', v_price);
  end if;

  insert into public.project_charges (developer_id, project_id, charge_type, amount, period_start, period_end)
  values (p_developer_id, p_project_id, 'landing_page_monthly', v_price, now(), v_until);

  update public.projects
  set subscription_status = 'active',
      subscription_started_at = coalesce(subscription_started_at, now()),
      subscription_expires_at = v_until,
      status = case when status = 'draft' then 'active' else status end
  where id = p_project_id;

  return jsonb_build_object('success', true, 'price_charged', v_price, 'expires_at', v_until);
end;
$$;

-- ============================================================================
-- ‏EXECUTE נשלל מ-PUBLIC, לא רק מ-anon ומ-authenticated
--
-- ‏PostgreSQL מעניק EXECUTE ל-PUBLIC בכל `create function`, ושני התפקידים
-- של Supabase יורשים ממנו. כלומר `revoke ... from anon, authenticated`
-- לבדו **אינו עושה דבר** — הוא מסיר הענקה מפורשת שמעולם לא ניתנה,
-- וההרשאה שמגיעה דרך PUBLIC נשארת.
--
-- וזה לא פרט תיאורטי: הפונקציות כאן הן security definer ומקבלות את
-- ‏developer_id כפרמטר. בלי השלילה מ-PUBLIC, כל משתמש/ת מחובר/ת — כולל
-- סוכן/ת תיווך שאין לו/ה שום קשר לעולם היזמים — יכול/ה לקרוא ל-
-- ‏project_promote עם המזהה של חברה אחרת ולחייב את הארנק שלה, או לקרוא
-- ל-project_request_delete, לקבל את הטוקן, ולמחוק פרויקט שאינו שלו/ה.
-- הבדיקה שבתוך הפונקציה מוודאת שהפרויקט שייך ל-developer_id שנמסר, לא
-- שהקורא/ת הוא/היא אותו יזם — זו בדיקה של פונקציית הקצה, ולכן הדרך
-- אליה חייבת להיות חסומה.
--
-- נמדד מול המסד: לפני השלילה מ-PUBLIC קריאה כזו הצליחה.
-- ============================================================================
revoke execute on function public.project_activate_page(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 16. ‏RPC: קידום שבועי — 50 ₪
--
-- קידום דורש מנוי פעיל. קידום של דף שלא מתפרסם הוא כסף על לא כלום, ולכן
-- הבדיקה כאן ולא רק בכפתור.
-- ---------------------------------------------------------------------------
create or replace function public.project_promote(p_project_id uuid, p_developer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price numeric;
  v_days  numeric;
  v_until timestamptz;
  v_rows  int;
  v_row   public.projects%rowtype;
begin
  select * into v_row from public.projects
  where id = p_project_id and developer_id = p_developer_id;
  if not found then
    return jsonb_build_object('error', 'not_your_project');
  end if;
  if v_row.status <> 'active'
     or v_row.subscription_expires_at is null
     or v_row.subscription_expires_at <= now() then
    return jsonb_build_object('error', 'page_not_live');
  end if;
  if v_row.is_promoted and v_row.promoted_until is not null and v_row.promoted_until > now() then
    return jsonb_build_object('error', 'already_promoted', 'promoted_until', v_row.promoted_until);
  end if;

  select value into v_price from public.pricing_config where key = 'project_promote_weekly_price';
  v_price := coalesce(v_price, 50);
  select value into v_days from public.pricing_config where key = 'project_promote_duration_days';
  v_days := coalesce(v_days, 7);
  v_until := now() + make_interval(days => v_days::int);

  update public.developers set credit_balance = credit_balance - v_price
  where id = p_developer_id and credit_balance >= v_price;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'required', v_price);
  end if;

  insert into public.project_charges (developer_id, project_id, charge_type, amount, period_start, period_end)
  values (p_developer_id, p_project_id, 'promotion_weekly', v_price, now(), v_until);

  update public.projects
  set is_promoted = true, promoted_until = v_until
  where id = p_project_id;

  return jsonb_build_object('success', true, 'price_charged', v_price, 'promoted_until', v_until);
end;
$$;

revoke execute on function public.project_promote(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 17. ‏RPC: רכישת ליד גנרי
-- ---------------------------------------------------------------------------
create or replace function public.project_lead_purchase(p_lead_id uuid, p_developer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price numeric;
  v_rows  int;
  v_lead  public.project_leads%rowtype;
begin
  select * into v_lead from public.project_leads where id = p_lead_id;
  if not found then return jsonb_build_object('error', 'lead_not_found'); end if;
  if v_lead.project_id is not null then return jsonb_build_object('error', 'not_a_shelf_lead'); end if;
  if v_lead.lead_status <> 'available' then return jsonb_build_object('error', 'already_sold'); end if;

  select value into v_price from public.pricing_config where key = 'project_lead_price';
  v_price := coalesce(v_price, 50);

  update public.developers set credit_balance = credit_balance - v_price
  where id = p_developer_id and credit_balance >= v_price;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'required', v_price);
  end if;

  -- ה-unique על lead_id הוא מה שמכריע בין שתי בקשות מקבילות. מי שהפסיד/ה
  -- מקבל/ת את הכסף בחזרה מיד — בלי זה החיוב היה נשאר בלי ליד.
  begin
    insert into public.project_lead_purchases (lead_id, developer_id, amount)
    values (p_lead_id, p_developer_id, v_price);
  exception when unique_violation then
    update public.developers set credit_balance = credit_balance + v_price where id = p_developer_id;
    return jsonb_build_object('error', 'already_sold');
  end;

  insert into public.project_charges (developer_id, project_id, charge_type, amount)
  values (p_developer_id, null, 'lead_purchase', v_price);

  update public.project_leads
  set lead_status = 'sold', sold_to_developer_id = p_developer_id, sold_at = now()
  where id = p_lead_id;

  select * into v_lead from public.project_leads where id = p_lead_id;

  return jsonb_build_object('success', true, 'price_charged', v_price,
    'lead', jsonb_build_object(
      'id', v_lead.id, 'full_name', v_lead.full_name, 'phone', v_lead.phone,
      'email', v_lead.email, 'message', v_lead.message));
end;
$$;

revoke execute on function public.project_lead_purchase(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 18. ‏RPC: מחיקת פרויקט בשני צעדים
--
-- הצעד הראשון מוריד את הדף מהאוויר ומחזיר טוקן. הצעד השני מוחק בפועל,
-- ורק אם הטוקן תואם. זו לא בירוקרטיה: מחיקת פרויקט מוחקת איתה את כל
-- הגלריה, את תמהיל הדירות ואת היסטוריית הפניות אליו.
-- ---------------------------------------------------------------------------
create or replace function public.project_request_delete(p_project_id uuid, p_developer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  update public.projects
  set delete_requested_at = now(), delete_confirm_token = v_token
  where id = p_project_id and developer_id = p_developer_id;
  if not found then return jsonb_build_object('error', 'not_your_project'); end if;
  return jsonb_build_object('success', true, 'confirm_token', v_token);
end;
$$;

create or replace function public.project_cancel_delete(p_project_id uuid, p_developer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.projects
  set delete_requested_at = null, delete_confirm_token = null
  where id = p_project_id and developer_id = p_developer_id;
  if not found then return jsonb_build_object('error', 'not_your_project'); end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.project_confirm_delete(
  p_project_id uuid, p_developer_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.projects%rowtype;
begin
  select * into v_row from public.projects
  where id = p_project_id and developer_id = p_developer_id;
  if not found then return jsonb_build_object('error', 'not_your_project'); end if;
  if v_row.delete_requested_at is null then
    return jsonb_build_object('error', 'delete_not_requested');
  end if;
  if v_row.delete_confirm_token is distinct from p_token then
    return jsonb_build_object('error', 'bad_confirm_token');
  end if;

  delete from public.projects where id = p_project_id;
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function public.project_request_delete(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.project_cancel_delete(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.project_confirm_delete(uuid, uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 19. מונה הצפיות
-- ---------------------------------------------------------------------------
create or replace function public.project_bump_views()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.projects set views_count = views_count + 1 where id = new.project_id;
  return new;
end;
$$;

revoke execute on function public.project_bump_views() from public, anon, authenticated;

drop trigger if exists project_views_bump on public.project_views;
create trigger project_views_bump
  after insert on public.project_views
  for each row execute function public.project_bump_views();


-- ---------------------------------------------------------------------------
-- 20. אחסון — תיקיית היזם ב-property-images
--
-- אותה תבנית של הסוכן/ת: התיקייה הראשונה בנתיב היא מזהה הבעלים, וה-policy
-- מוודאת התאמה. ‏developers.id ו-agency_members.id הם UUID משתי טבלאות
-- שונות, ולכן אין חשש להתנגשות נתיבים.
-- ---------------------------------------------------------------------------
drop policy if exists "developer uploads to own folder" on storage.objects;
create policy "developer uploads to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'property-images'
              and (storage.foldername(name))[1] = (public.current_developer_id())::text);

drop policy if exists "developer updates own folder" on storage.objects;
create policy "developer updates own folder"
  on storage.objects for update to authenticated
  using (bucket_id = 'property-images'
         and (storage.foldername(name))[1] = (public.current_developer_id())::text)
  with check (bucket_id = 'property-images'
         and (storage.foldername(name))[1] = (public.current_developer_id())::text);

drop policy if exists "developer deletes own folder" on storage.objects;
create policy "developer deletes own folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'property-images'
         and (storage.foldername(name))[1] = (public.current_developer_id())::text);

drop policy if exists "developer uploads own project videos" on storage.objects;
create policy "developer uploads own project videos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'property-videos'
              and (storage.foldername(name))[1] = (public.current_developer_id())::text);

drop policy if exists "developer deletes own project videos" on storage.objects;
create policy "developer deletes own project videos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'property-videos'
         and (storage.foldername(name))[1] = (public.current_developer_id())::text);


-- ---------------------------------------------------------------------------
-- 21. המחירים — בטבלה, לא בקוד
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('project_page_monthly_price',    350, '₪ לחודש לדף נחיתה של פרויקט חדש'),
  ('project_page_period_days',       30, 'אורך מחזור החיוב של דף הנחיתה בימים'),
  ('project_promote_weekly_price',   50, '₪ לשבוע לקידום פרויקט חדש בגלריות'),
  ('project_promote_duration_days',   7, 'ימים שבהם הפרויקט מקודם, מרגע הרכישה'),
  ('project_lead_price',             50, '₪ לרכישת ליד מחפש/ת פרויקט חדש ממדף היזמים'),
  ('project_home_promoted_slots',     2, 'כמה מקומות בראש גלריית דף הבית שמורים לפרויקטים מקודמים')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

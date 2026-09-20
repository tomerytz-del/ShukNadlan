-- ============================================================================
-- מחוזות, אזורים וערים — ישות המקום הקנונית
--
-- ## מה שבור היום
--
-- ‏`properties.city` הוא **טקסט חופשי**. אין `city_id`, אין אזור, ואין שום
-- ישות שאפשר לשאול אותה "מי נמצא באזור שלי". ל-`agencies` אין בכלל עמודה
-- גאוגרפית — רק `address` טקסטואלי.
--
-- כל עוד האתר הוא עפולה בלבד זה לא הפריע: העיר קבועה, והסינון האמיתי הוא
-- לפי `neighborhood_id`. אבל שלוש יכולות שנבנות עכשיו **לא יכולות להיכתב**
-- בלי ישות מקום:
--
--   * המפה והכיתוב שנפתחים על העיר של הגולש/ת
--   * היקף שיתוף הפעולה בין מתווכים ("האזור שלי" / "המחוז שלי" / ארצי)
--   * הצלבת נכסים ולקוחות מעבר לגבולות המשרד
--
-- ## שלוש רמות, ולא שתיים
--
-- ‏"עפולה והעמק" אינו עיר ואינו הרמה העליונה — הוא הרמה **האמצעית**.
-- כך בנוי גם התפריט שאליו משווים: "מרכז והשרון" נפתח ל"בקעת אונו",
-- "רמלה - לוד", "רעננה - כפר סבא". לכן:
--
--   region  → מחוז   (צפון והעמקים)    — 7
--   area    → אזור   (עפולה והעמק)     — 11, מעט וגדול בכוונה
--   city    → עיר    (כרמיאל)
--
-- ## למה מעט אזורים וגדולים
--
-- האזור הוא מה שקובע את היקף השת״פ במסלול Pay&GO, **ושם אין כפתור הרחבה**.
-- חלוקה עורכית היא מחיצה, ושוק אינו מחיצה: מתווך/ת בקריית אונו ומתווך/ת
-- ברמת גן רחוקים שלושה קילומטרים ויושבים בשני מחוזות, בעוד נתניה ומודיעין
-- הן אותו מחוז ו-60 ק"מ זו מזו.
--
-- אזור רחב מקטין את מספר הגבולות ואיתם את מספר המקרים האלה. הוא אינו
-- מבטל אותם — לכך נועדה `agent_share_preferences.area_ids` (מיגרציה
-- נפרדת), שמאפשרת למתווך/ת גבול להוסיף אזור שכן ידנית. אם אותה תלונה
-- תחזור מכמה אנשים באותו גבול, זה הסימן **לאחד שני אזורים** ולא להוסיף
-- מנגנון.
--
-- ## מזהים באנגלית, תצוגה בעברית
--
-- ‏`region`/`area` הם המזהים; "מחוז"/"אזור" הם מה שמוצג. אותה הפרדה בדיוק
-- כמו ב-`assets/tiers.js` (‏free/mid/premium מול Pay&GO/PROFESSIONAL/Elite).
-- **המילה "נפה" לעולם אינה מוצגת לגולש/ת** — `cbs_nafa` היא עמודת ייחוס
-- פנימית, והיא קיימת כדי שאפשר יהיה לשאול "אילו ערים הוצאנו מהנפה שלהן,
-- ולמה". ביקורת כזו אי אפשר לעשות על שיוך שנכתב ביד ואבד.
--
-- ## מה **לא** נכנס כאן
--
-- ‏`properties.city_id` ו-`agencies.city_id` הם מיגרציות נפרדות
-- (`20261211…`, `20261212…`), בכוונה: הקובץ הזה אינו נוגע באף טבלה קיימת,
-- ולכן אפשר למזג אותו בלי סיכון.
--
-- ותוכן הערים עצמו אינו כאן. ראו "הזנת הערים" בתחתית הקובץ.
--
-- תיעוד: docs/cities-and-regions.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- מפתח הנרמול
--
-- ‏immutable כי הוא משמש עמודה מחושבת ואינדקס; strict כי null נשאר null.
--
-- **הוא אינו עותק של `street_name_key`, ושתי ההשמטות מכוונות:**
--
--   * **אין הורדת ה"א פותחת.** ברחוב "ה" היא לרוב יידוע ("העליה"/"עלייה"),
--     בעיר היא חלק מהשם. הורדתה הייתה הופכת "הרצליה" ל-"רצליה".
--   * **אין הורדת ה"א סופית.** לערים זה אינו ציר כתיב אמיתי, והוא היה
--     ממזג "רעננה" ל-"רענן" בלי שום תמורה.
--
-- מה שכן: מקף הופך לרווח, רווחים מתכווצים, **ויו"ד ווי"ו כפולות
-- מתכווצות**. שתי ההכפלות הן שני צירי הכתיב האמיתיים בשמות יישובים:
--
--   קריית / קרית       (יו"ד כפולה)
--   פתח תקווה / תקוה   (וי"ו כפולה)
--
-- **והגרש נשמר ולא יורד** — זה ההבדל המשמעותי מ-`street_name_key`.
-- הורדתו הייתה ממזגת את **ג'ת** (יישוב במשולש) עם **גת**, שני מקומות
-- שונים לגמרי. מיזוג שגוי גרוע מפספוס: הוא כותב על הנכס עיר אחרת.
-- מה שכן נעשה לגרש הוא **נרמול הצורה** — ׳ ' ‘ ’ ` כולם הופכים לאותו
-- תו — כך ש-"ג׳ת" ו-"ג'ת" מתכנסות בלי לוותר על ההבחנה.
--
-- מה שהמפתח **אינו** מכסה ובכוונה, ושייך ל-`city_aliases`:
--
--   * **שמות חלופיים** — "תל אביב" מול "תל אביב-יפו" אינו שגיאת כתיב.
--   * **כתיב חסר מול מלא** — "זכרון" מול "זיכרון". זו יו"ד **נוספת**
--     ולא כפולה, וכיווץ יו"ד בודדת היה ממזג שמות שונים.
--
-- המפתח מטפל ב**איות**, הכינויים ב**שמות**.
-- ---------------------------------------------------------------------------
create or replace function public.city_name_key(p_name text)
returns text
language sql
immutable
strict
as $$
  select coalesce(
    nullif(
      regexp_replace(                                         -- 6. וי"ו כפולה
        regexp_replace(                                       -- 5. יו"ד כפולה
          btrim(regexp_replace(                               -- 4. רווחים כפולים
            regexp_replace(                                   -- 3. מקפים לרווח
              regexp_replace(                                 -- 2. גרשיים לצורה אחת
                regexp_replace(p_name, '[׳‘’`]', '''', 'g'),  -- 1. גרש לצורה אחת
                '[״“”]', '"', 'g'),
              '[־–—-]', ' ', 'g'),
            '\s+', ' ', 'g')),
          'י{2,}', 'י', 'g'),
        'ו{2,}', 'ו', 'g'),
      ''),
    btrim(p_name));
$$;

comment on function public.city_name_key(text) is
  'צורת הבסיס של שם יישוב להשוואה: מקף כרווח, גרש מנורמל אך נשמר, ויו"ד/וי"ו כפולות מכווצות (וכך "קריית"="קרית" ו-"תקווה"="תקוה"). בשונה מ-street_name_key אינו מוריד ה"א פותחת/סופית ואינו מוחק גרש — "ג\'ת" אינה "גת".';

-- ---------------------------------------------------------------------------
-- מחוזות
--
-- החלוקה הזו אינה קיימת באף דאטהסט ממשלתי — היא החלטת מוצר. היא **קרובה
-- מאוד** לשבעת המחוזות של הלמ"ס, וזה מה שמאפשר להזין את השיוך מהנתונים
-- במקום לשייך 200 ערים ביד; אבל השמות כאן שיווקיים ולא מנהליים.
-- ---------------------------------------------------------------------------
create table if not exists public.regions (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  sort_order smallint not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.regions is
  'מחוז — הרמה העליונה בהיררכיית המקום. שבעה. השם מוצג לגולש/ת. ראו docs/cities-and-regions.md';

insert into public.regions (slug, name, sort_order) values
  ('tel-aviv',    'תל אביב והסביבה',              10),
  ('center',      'מרכז והשרון',                  20),
  ('jerusalem',   'ירושלים והסביבה',              30),
  ('haifa',       'חיפה ומישור החוף',             40),
  ('north',       'צפון והעמקים',                 50),
  ('south',       'דרום',                         60),
  ('judea',       'יהודה, שומרון ובקעת הירדן',    70)
on conflict (slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- אזורים
--
-- ‏11 לכל הארץ. ראו ההסבר בראש הקובץ על למה מעט וגדול.
-- ---------------------------------------------------------------------------
create table if not exists public.areas (
  id         uuid primary key default gen_random_uuid(),
  region_id  uuid not null references public.regions(id) on delete restrict,
  slug       text not null unique,
  name       text not null,
  sort_order smallint not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists areas_region_idx on public.areas (region_id, sort_order);

comment on table public.areas is
  'אזור — הרמה האמצעית, וזו שעליה נשען היקף השת״פ המקומי. מעט וגדול בכוונה: ראו ההערה בראש המיגרציה.';

insert into public.areas (region_id, slug, name, sort_order)
select r.id, v.slug, v.name, v.sort_order
  from (values
    ('tel-aviv',  'gush-dan',        'גוש דן',                    10),
    ('center',    'sharon',          'השרון',                     10),
    ('center',    'shfela-merkaz',   'שפלת המרכז',                20),
    ('jerusalem', 'jerusalem-hills', 'ירושלים והרי יהודה',        10),
    ('haifa',     'haifa-galil-mar', 'חיפה והגליל המערבי',        10),
    ('haifa',     'hadera-carmel',   'חדרה וחוף הכרמל',           20),
    ('north',     'emakim',          'העמקים',                    10),
    ('north',     'galil-golan',     'הגליל והגולן',              20),
    ('south',     'ashdod-shfela',   'אשדוד, אשקלון והשפלה',      10),
    ('south',     'beer-sheva-negev','באר שבע והנגב',             20),
    ('judea',     'judea-samaria',   'יהודה ושומרון',             10)
  ) as v(region_slug, slug, name, sort_order)
  join public.regions r on r.slug = v.region_slug
on conflict (slug) do update
  set name = excluded.name, sort_order = excluded.sort_order, region_id = excluded.region_id;

-- ---------------------------------------------------------------------------
-- ערים
--
-- ‏`name` הוא הכתיב הקנוני ומה שנשמר על הנכס; `name_key` הוא מה שמשווים
-- לפיו, והאינדקס הייחודי עליו הוא כל מנגנון מניעת הכפילות — בדיוק כמו
-- ב-`street_registry`. בדיקה בצד הלקוח הייתה נכשלת כששני אנשים מוסיפים
-- את אותה עיר באותו רגע.
--
-- ‏`display_label` ולא `name` בכותרת: ה-H1 בדף הבית אומר "כל הנכסים
-- ב<תווית>", ו"עפולה והעמק" אינו "עפולה". זה טקסט **מוצג**, ולכן בלי
-- מקף ארוך (ראו CLAUDE.md).
--
-- ‏`muni_code` (סמל יישוב) הוא המפתח היציב היחיד מול מקורות ממשלתיים:
-- שמות יישובים משתנים, סמלים לא.
--
-- ‏`is_live` הוא **שער מוצר ולא דגל תצוגה**. עיר עולה לאוויר רק כשיש בה
-- מלאי אמיתי; דף עיר עם אפס נכסים מלמד את גוגל שהדף דק ואת המבקר הראשון
-- שהאתר ריק.
--
-- ‏`bbox` משמש לתפקיד אחד בלבד — לפסול קואורדינטה שהגאוקוד החזיר והיא
-- נחתה מחוץ לעיר (פין באמצע הים גרוע מאין פין). דיוק גס מספיק לו.
-- ---------------------------------------------------------------------------
create table if not exists public.cities (
  id                  uuid primary key default gen_random_uuid(),
  area_id             uuid not null references public.areas(id) on delete restrict,
  region_id           uuid references public.regions(id) on delete restrict,
  name                text not null,
  name_key            text generated always as (public.city_name_key(name)) stored,
  slug                text not null unique,
  display_label       text,
  lat                 double precision,
  lng                 double precision,
  default_zoom        smallint not null default 13,
  bbox_lat_min        double precision,
  bbox_lat_max        double precision,
  bbox_lng_min        double precision,
  bbox_lng_max        double precision,
  muni_code           text,
  cbs_district        text,
  cbs_nafa            text,
  population          integer,
  geocode_provider    text not null default 'none',
  street_enforcement  boolean not null default false,
  street_min_expected integer not null default 30,
  is_live             boolean not null default false,
  source              text not null default 'seed',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cities'::regclass
                    and conname  = 'cities_geocode_provider_chk') then
    alter table public.cities add constraint cities_geocode_provider_chk
      check (geocode_provider in ('none','afula_wfs','govmap'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cities'::regclass
                    and conname  = 'cities_source_chk') then
    alter table public.cities add constraint cities_source_chk
      check (source in ('seed','gov','manual'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cities'::regclass
                    and conname  = 'cities_slug_chk') then
    alter table public.cities add constraint cities_slug_chk
      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  end if;

  -- עיר חיה חייבת פין. בלעדיו המפה נפתחת על null והדף נראה שבור.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cities'::regclass
                    and conname  = 'cities_live_needs_center_chk') then
    alter table public.cities add constraint cities_live_needs_center_chk
      check (not is_live or (lat is not null and lng is not null));
  end if;
end $$;

create unique index if not exists cities_name_key_uniq  on public.cities (name_key);
create index if not exists cities_area_idx              on public.cities (area_id);
create index if not exists cities_region_idx            on public.cities (region_id);
create index if not exists cities_live_idx              on public.cities (is_live) where is_live;
create index if not exists cities_muni_code_idx         on public.cities (muni_code) where muni_code is not null;

comment on table public.cities is
  'היישובים. ראו docs/cities-and-regions.md';
comment on column public.cities.display_label is
  'מה שמופיע ב-H1 של דף הבית ("עפולה והעמק"), כשהוא שונה משם העיר. טקסט מוצג — בלי מקף ארוך.';
comment on column public.cities.muni_code is
  'סמל יישוב (למ"ס). המפתח היציב מול מקורות ממשלתיים — שמות משתנים, סמלים לא.';
comment on column public.cities.cbs_nafa is
  'הנפה לפי למ"ס. עמודת ייחוס פנימית בלבד: היא מאפשרת לשאול אילו ערים הוצאו מהנפה שלהן ולמה. המילה "נפה" לעולם אינה מוצגת לגולש/ת.';
comment on column public.cities.is_live is
  'שער מוצר: העיר מוצגת לגולשים. נדלק רק כשיש מלאי אמיתי — דף עיר ריק גרוע מאין דף עיר.';
comment on column public.cities.geocode_provider is
  'none = אין גאוקוד לעיר · afula_wfs = שכבת עיריית עפולה · govmap = הספק הארצי';
comment on column public.cities.street_enforcement is
  'האם טופס הנכס חוסם רחוב שאינו ברשימה. נדלק ידנית ורק כשהרשימה שלמה — אכיפה על רשימה חלקית חוסמת פרסום נכס תקין.';

-- ‏region_id נגזר מ-area_id. הוא מוחזק כעמודה ולא כ-join כדי שסינון
-- "כל הנכסים במחוז" יהיה אינדקס אחד; הטריגר הוא מה שמונע את הסתירה
-- שעמודה דנורמלית תמיד מזמינה.
create or replace function public.cities_set_region()
returns trigger
language plpgsql
as $$
begin
  select a.region_id into new.region_id
    from public.areas a where a.id = new.area_id;
  new.updated_at := now();
  return new;
end $$;

-- ‏before insert or update על **כל** העמודות ולא רק על area_id: הטריגר
-- מחזיק גם את updated_at, ו-`update of area_id` היה מקפיא אותו בכל עריכה
-- אחרת (שם, פין, is_live). ‏cities_public חושפת את updated_at ל-sitemap,
-- ותאריך שאינו זז הוא בדיוק מה שגורם לגוגל לא לסרוק מחדש.
drop trigger if exists cities_set_region_trg on public.cities;
create trigger cities_set_region_trg
  before insert or update on public.cities
  for each row execute function public.cities_set_region();

-- ---------------------------------------------------------------------------
-- כינויים
--
-- ‏"תל אביב-יפו" מול "תל אביב" אינו שגיאת כתיב אלא שם אחר, ולכן הוא כאן
-- ולא במפתח הנרמול. ‏`alias_key` הוא מפתח ראשי: אותו כינוי לא יכול להצביע
-- על שתי ערים, וזו בדיוק הכפילות שתשבור את פענוח `properties.city`.
-- ---------------------------------------------------------------------------
create table if not exists public.city_aliases (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references public.cities(id) on delete cascade,
  alias      text not null,
  alias_key  text generated always as (public.city_name_key(alias)) stored,
  created_at timestamptz not null default now()
);

-- אינדקס ייחודי ולא מפתח ראשי על העמודה המחושבת — בדיוק התבנית של
-- street_registry.name_key, שהיא הדפוס המוכח בפרויקט.
create unique index if not exists city_aliases_key_uniq on public.city_aliases (alias_key);
create index if not exists city_aliases_city_idx on public.city_aliases (city_id);

comment on table public.city_aliases is
  'שמות חלופיים ליישוב ("תל אביב" ל-"תל אביב-יפו"). alias_key הוא מפתח ראשי: כינוי אחד לא יכול להצביע על שתי ערים.';

-- ---------------------------------------------------------------------------
-- פענוח שם לעיר
--
-- ‏security definer כי היא נקראת גם מטריגר על `properties` וגם מהדפדפן,
-- והיא צריכה לקרוא את `cities` ו-`city_aliases` בשני המקרים. היא מחזירה
-- **uuid בלבד** — אין כאן מה לדלוף.
--
-- הסדר: שם קנוני קודם, כינוי אחריו. עיר שאינה `active` אינה נפתרת, אבל
-- עיר שאינה `is_live` כן: נכס יכול להיות מוזן בעיר שעדיין לא נפתחה
-- לגולשים, וזה בדיוק איך שמלאי נצבר לפני ההשקה.
-- ---------------------------------------------------------------------------
create or replace function public.city_id_for_name(p_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from (
    select c.id, 1 as pri
      from public.cities c
     where c.active
       and c.name_key = public.city_name_key(p_name)
     union all
    select a.city_id, 2 as pri
      from public.city_aliases a
      join public.cities c on c.id = a.city_id and c.active
     where a.alias_key = public.city_name_key(p_name)
  ) m
  -- ‏union all אינו מבטיח סדר, ולכן העדיפות מפורשת: שם קנוני גובר על
  -- כינוי. בלי זה, מחרוזת שהיא גם שם עיר וגם כינוי של עיר אחרת הייתה
  -- נפתרת אחרת בין הרצה להרצה — כשל שמתגלה רק בנתונים.
  order by pri
  limit 1;
$$;

comment on function public.city_id_for_name(text) is
  'פענוח שם יישוב (בכל כתיב שהמפתח מכיר, או כינוי) למזהה. מחזירה null כשאין התאמה — עיר לא מוכרת היא נכס שנשמר, לא נכס שנחסם.';

revoke all on function public.city_id_for_name(text) from public;
grant execute on function public.city_id_for_name(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- המשטח הציבורי
--
-- ‏view בלי `security_invoker` — אותה תבנית של `shared_properties_for_me`
-- ו-`leads_masked`. הוא חושף **רק** ערים חיות, ובלי עמודות התפעול
-- (`geocode_provider`, `street_enforcement`, `cbs_*`, `source`).
--
-- למה לא policy של קריאה פומבית על `cities` עצמה: הטבלה מחזיקה גם את
-- הערים שטרם נפתחו. זו אינה סודיות גדולה, אבל "אילו ערים הם עומדים
-- להשיק" אינו מידע שצריך להיות ב-API הפומבי.
-- ---------------------------------------------------------------------------
create or replace view public.cities_public as
select c.id, c.slug, c.name, c.display_label,
       c.lat, c.lng, c.default_zoom,
       c.area_id,   a.slug as area_slug,   a.name as area_name,
       c.region_id, r.slug as region_slug, r.name as region_name,
       a.sort_order as area_sort, r.sort_order as region_sort,
       c.updated_at
  from public.cities c
  join public.areas   a on a.id = c.area_id   and a.active
  join public.regions r on r.id = c.region_id and r.active
 where c.active and c.is_live;

comment on view public.cities_public is
  'הערים החיות לתפריט, לדף העיר ול-sitemap. בלי security_invoker בכוונה — הסינון הוא is_live, ועמודות התפעול אינן כאן.';

grant select on public.cities_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- הרשאות
--
-- ‏Supabase נותן הרשאות טבלה ל-anon ול-authenticated בברירת מחדל, ולכן
-- ה-RLS הוא השער האמיתי — בדיוק כמו ב-neighborhoods וב-street_registry.
--
-- מחוזות ואזורים: קריאה פומבית. אין בהם שום דבר רגיש, והתפריט צריך אותם.
-- ערים וכינויים: **אין** policy של קריאה פומבית. הדרך הפומבית היא
-- `cities_public`, והפענוח הוא `city_id_for_name`.
-- ---------------------------------------------------------------------------
alter table public.regions      enable row level security;
alter table public.areas        enable row level security;
alter table public.cities       enable row level security;
alter table public.city_aliases enable row level security;

drop policy if exists "public read regions" on public.regions;
create policy "public read regions" on public.regions for select using (active);

drop policy if exists "public read areas" on public.areas;
create policy "public read areas" on public.areas for select using (active);

-- מתווך/ת מחובר/ת כן רואה את כל הערים: טופס הנכס צריך להציע גם עיר שטרם
-- נפתחה לגולשים, אחרת אי אפשר לצבור מלאי לפני ההשקה.
drop policy if exists "members read cities" on public.cities;
create policy "members read cities" on public.cities for select
  using (active and exists (select 1 from public.agency_members m
                             where m.user_id = (select auth.uid()) and m.active));

do $$
declare
  t    text;
  cond text := 'exists (select 1 from public.agency_members m '
               'where m.user_id = (select auth.uid()) and m.is_platform_admin = true)';
begin
  foreach t in array array['regions','areas','cities','city_aliases'] loop
    execute format('drop policy if exists "platform admin manage %s" on public.%I', t, t);
    execute format('create policy "platform admin manage %s" on public.%I for all '
                   'using (%s) with check (%s)', t, t, cond, cond);
  end loop;
end $$;

-- ============================================================================
-- הזנת הערים
--
-- **הטבלה נולדת ריקה, וזה מכוון.** רשימת היישובים, סמל היישוב,
-- הקואורדינטות, האוכלוסייה והשיוך המנהלי (מחוז ונפה) מגיעים מקובץ
-- היישובים של הלמ"ס דרך data.gov.il — ולא מהזיכרון של מי שכותב את
-- המיגרציה. קואורדינטה שנוחשה היא פין שגוי על מפה, וזה בדיוק סוג הכשל
-- שנראה תקין עד שמישהו מסתכל.
--
-- ההזנה נכנסת במיגרציה נפרדת (`…_cities_seed.sql`) שנוצרת מהקובץ, באותה
-- תבנית `on conflict do update` — ועם הכלל ש-`do update` **אינו נוגע**
-- ב-`is_live`, ב-`geocode_provider` וב-`active`, כי החלטה ידנית של
-- מנהל/ת אינה רעש (אותו כלל של `street_registry_absorb`).
--
-- השיוך לאזור מוזן מהנפה — כ-15 החלטות במקום 200 — ומפוצל ידנית רק היכן
-- שהשוק שונה מהמנהלה. הנפות נשמרות ב-`cbs_nafa` כדי שהחריגות יישארו
-- ניתנות לביקורת.
-- ============================================================================

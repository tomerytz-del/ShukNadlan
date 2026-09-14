-- ============================================================================
-- רשימת הרחובות של עפולה — רשימה סגורה במקום הקלדה חופשית
--
-- ## מה שבור היום
--
-- שדה הרחוב בטופס הנכס הוא טקסט חופשי, וכך הוא נראה במסד **בפועל**:
--
--   יהושע חנקין (6)   מול   יהושוע חנקין (4)
--   מנחם אוסישקין (1) מול   מנחם אושיסקין (1)
--   עלייה (1)         מול   העליה (2)
--   יצחק רבין (5)     מול   שדרות יצחק רבין (1)
--   ועוד שורה אחת שכתוב בה "ליד בנק הפועלים"
--
-- זה לא עניין של אסתטיקה. שם רחוב הוא **מפתח החיפוש** בשכבת הכתובות של
-- עיריית עפולה, ומשם מגיעים שני דברים שהמתווך/ת משלם/ת עליהם:
--
--   * ‏lat/lng — ובלעדיהם הנכס נעלם מכל מפה באתר (docs/geocoding.md)
--   * גוש, חלקה, ייעוד ותוכניות — המידע התכנוני (docs/land-planning.md)
--
-- ל-streetVariants ב-_shared/afula-geocode.ts יש שלושה צירי כתיב שמכסים
-- חלק מההיסטות (ה"א פותחת, ה"א סופית, יו"ד כפולה), אבל "יהושוע" מול
-- "יהושע" אינו אחד מהם, ו"אושיסקין" הוא פשוט שגיאת הקלדה. התוצאה היא
-- ‏404 מנומק — "לא נמצאה כתובת מתאימה" — שנראה בדיוק כמו כתובת שאינה
-- קיימת. אף אחד לא מקבל הודעה, והנכס פשוט לא על המפה.
--
-- **תיקון במורד הזרם לא פותר את זה.** אפשר להוסיף עוד ועוד צירי כתיב
-- למנוע הווריאציות, וכל ציר הוא עוד קריאת רשת לכל נכס, ועדיין לא יכסה
-- שגיאת הקלדה אמיתית. המקום היחיד שבו זה נסגר הוא **רגע ההקלדה**.
--
-- ## מה נכנס כאן
--
-- טבלת רחובות (‏street_registry) שמוזנת משכבת הכתובות של העירייה — אותה
-- שכבה שהגיאוקוד והמידע התכנוני שואלים. הטופס ב-CRM בוחר ממנה, ולכן
-- השם שנשמר על הנכס הוא בדיוק השם שהשכבה מכירה.
--
-- שלוש החלטות שכדאי להבין לפני קריאת הקוד:
--
-- **1. רשימה סגורה עם דלת יציאה.** רחוב חדש נולד לפני שהוא מגיע למאגר
--    ה-GIS, ומתווך/ת שלא יכול/ה להזין נכס עד שהעירייה תתעדכן — ימציא/תמציא
--    עוקף (יכתוב/תכתוב את הרחוב בשדה "איזור מכירה", או יוותר/תוותר על
--    הכתובת). לכן `street_registry_add` מאפשרת הוספה ידנית מתוך הטופס,
--    והרחוב שנוסף זמין מיד לכל המשרדים. הסנכרון הבא **מאמץ** אותו: אם
--    השכבה מכירה אותו, השם מוחלף בכתיב הרשמי והמקור הופך ל-gis.
--
-- **2. מפתח נרמול, לא השוואת מחרוזות.** ‏street_name_key מכווץ את אותם
--    צירי כתיב שמנוע הווריאציות מכיר — ה"א פותחת, ה"א סופית, יו"ד כפולה —
--    ובנוסף תחיליות "רחוב"/"שדרות", גרשים ומקפים. כך "העליה" שהוקלדה
--    נפתרת ל-"עלייה" שברשימה במקום להידחות, ו-"שדרות יצחק רבין" ו-
--    "יצחק רבין" אינם שתי שורות. המפתח הוא עמודה מחושבת עם אינדקס ייחודי,
--    כלומר הכפילות נחסמת במסד ולא בצד הלקוח.
--
--    **המפתח אינו מנוע הווריאציות.** ‏streetVariants מייצר צורות לשאילתה
--    ברשת ולכן הוא זהיר ומוגבל ל-8; המפתח מכווץ לצורת בסיס אחת ולכן הוא
--    יכול להרשות לעצמו יותר. שניהם מכסים את אותם צירים בכוונה, ותוספת
--    ציר לאחד מהם היא סיבה לבדוק את השני.
--
-- **3. הסנכרון מוסיף, כמעט ולא מוריד.** רחוב שנעלם מהשכבה הוא הרבה יותר
--    פעמים תקלה בשכבה מאשר רחוב שבוטל, ומחיקתו היא הסרת רחוב שיש עליו
--    נכסים חיים. לכן `last_seen_at` בלבד — חוץ ממקרה אחד, הזרעה שלא אושרה
--    (ראו `street_registry_absorb`).
--
-- ## למה עפולה בלבד
--
-- אותה סיבה כמו בגיאוקוד: זו השכבה היחידה שיש לנו. הטבלה נושאת `city`
-- ולכן עיר נוספת היא הזנה נוספת ולא שינוי סכימה, ובטופס עיר שאין לה
-- רשימה חוזרת להקלדה חופשית במקום לחסום שמירה.
--
-- תיעוד: docs/street-registry.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- מפתח הנרמול
--
-- ‏immutable כי הוא משמש עמודה מחושבת ואינדקס; strict כי null נשאר null.
--
-- הסדר אינו שרירותי — ה"א פותחת יורדת **לפני** כיווץ היו"ד ולפני ה"א
-- סופית, אחרת "העליה" ו-"עלייה" אינם מתכנסים לאותה צורה:
--
--   העליה  -> עליה  -> עליה -> עלי
--   עלייה  -> עלייה -> עליה -> עלי
--
-- מה שהמפתח **אינו** מכסה: יו"ד/וי"ו של אם קריאה ("יהושע"/"יהושוע")
-- ושגיאות הקלדה ("אוסישקין"/"אושיסקין"). כיווץ וי"ו היה ממזג גם
-- "החורש" עם "החרש" — שני שמות רחוב נפוצים ושונים לגמרי. את שני המקרים
-- האלה פותרת הרשימה הסגורה עצמה: מי שמקליד/ה "חנקין" רואה/ת ברשימה את
-- הצורה האחת שקיימת, ובוחר/ת בה.
-- ---------------------------------------------------------------------------
create or replace function public.street_name_key(p_name text)
returns text
language sql
immutable
strict
as $$
  select coalesce(
    nullif(
      regexp_replace(                                        -- 5. ה"א סופית
        regexp_replace(                                      -- 4. יו"ד כפולה
          regexp_replace(                                    -- 3. ה"א פותחת
            regexp_replace(                                  -- 2. תחילית סוג הרחוב
              btrim(regexp_replace(                          -- 1. גרשים, מקפים ורווחים
                regexp_replace(
                  regexp_replace(p_name, '[''"`׳״‘’“”]', '', 'g'),
                  '[־-]', ' ', 'g'),
                '\s+', ' ', 'g')),
              '^(רחוב|רח|שדרות|שדרת|שד)\s+', ''),
            '^ה', ''),
          'י{2,}', 'י', 'g'),
        'ה$', ''),
      ''),
    btrim(p_name));
$$;

comment on function public.street_name_key(text) is
  'צורת הבסיס של שם רחוב לצורך השוואה: ללא גרשים, ללא תחילית "רחוב"/"שדרות", ללא ה"א פותחת/סופית, ויו"ד כפולה מכווצת. מכסה את אותם צירים כמו streetVariants ב-_shared/afula-geocode.ts.';

-- ---------------------------------------------------------------------------
-- הטבלה
--
-- ‏name הוא מה שמוצג ונשמר על הנכס; ‏name_key הוא מה שמשווים לפיו.
-- האינדקס הייחודי על (city, name_key) הוא כל מנגנון מניעת הכפילות —
-- בדיקה בצד הלקוח הייתה נכשלת בדיוק כששני מתווכים מוסיפים את אותו רחוב
-- באותו רגע.
--
-- ‏source:
--   gis    — הגיע משכבת הכתובות של העירייה. מקור האמת.
--   manual — הוסף ידנית מהטופס, כי השכבה עוד לא מכירה אותו.
--   legacy — הוזרע מהרחובות שכבר כתובים על נכסים קיימים, כדי שהרשימה לא
--            תהיה ריקה בין המיזוג לסנכרון הראשון. זו הזרעה זמנית: מה
--            שהסנכרון הראשון לא יאשר יכובה (ראו street_registry_absorb).
-- ---------------------------------------------------------------------------
create table if not exists public.street_registry (
  id            uuid primary key default gen_random_uuid(),
  city          text not null,
  name          text not null,
  name_key      text generated always as (public.street_name_key(name)) stored,
  source        text not null default 'manual',
  active        boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz,
  created_by    uuid references public.agency_members(id) on delete set null,
  created_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.street_registry'::regclass
                    and conname  = 'street_registry_source_chk') then
    alter table public.street_registry
      add constraint street_registry_source_chk check (source in ('gis','manual','legacy'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.street_registry'::regclass
                    and conname  = 'street_registry_name_len_chk') then
    alter table public.street_registry
      add constraint street_registry_name_len_chk
        check (char_length(btrim(name)) between 2 and 80);
  end if;
end $$;

create unique index if not exists street_registry_city_key_uniq
  on public.street_registry (city, name_key);
create index if not exists street_registry_city_active_idx
  on public.street_registry (city, active);

comment on table public.street_registry is
  'רשימת הרחובות שמתוכה בוחרים בטופס הנכס. מוזנת משכבת הכתובות של עיריית עפולה, עם דלת יציאה להוספה ידנית. ראו docs/street-registry.md';
comment on column public.street_registry.name is
  'השם כפי שיוצג וכפי שייכתב על הנכס. כשהמקור gis — הכתיב של השכבה, וזו כל הנקודה.';
comment on column public.street_registry.name_key is
  'צורת הבסיס להשוואה (street_name_key). האינדקס הייחודי עליה הוא מה שמונע "עלייה" ו-"העליה" כשתי שורות.';
comment on column public.street_registry.source is
  'gis = משכבת העירייה · manual = הוסף ידנית מהטופס · legacy = הוזרע מנכסים קיימים וטרם אושר';
comment on column public.street_registry.last_seen_at is
  'מתי הסנכרון האחרון ראה את הרחוב בשכבה. null אצל רחוב שהשכבה עוד לא אישרה.';

-- ‏Supabase נותן הרשאות טבלה ל-anon ול-authenticated בברירת מחדל, ולכן
-- ה-RLS כאן הוא השער האמיתי — בדיוק כמו ב-neighborhoods.
alter table public.street_registry enable row level security;

-- קריאה פומבית, כמו neighborhoods: שם רחוב אינו מידע מוגן, והטופס ב-CRM
-- וכלים ציבוריים עתידיים קוראים את אותה רשימה.
drop policy if exists "public read street registry" on public.street_registry;
create policy "public read street registry"
  on public.street_registry for select using (true);

-- כתיבה ישירה — למנהל/ת הפלטפורמה בלבד, באותה תבנית של neighborhoods
-- ו-rss_sources. מתווך/ת מוסיף/ה רחוב דרך street_registry_add ולא דרך
-- insert חופשי, אחרת "רשימה סגורה" היא רק שינוי מראה.
drop policy if exists "platform admin manage street registry" on public.street_registry;
create policy "platform admin manage street registry"
  on public.street_registry for all
  using (exists (select 1 from public.agency_members m
                  where m.user_id = (select auth.uid()) and m.is_platform_admin = true))
  with check (exists (select 1 from public.agency_members m
                       where m.user_id = (select auth.uid()) and m.is_platform_admin = true));

-- ---------------------------------------------------------------------------
-- יומן הסנכרונים
--
-- שתי עבודות: לדעת מתי רץ בפעם האחרונה בהצלחה (וזה תנאי הדליקה של ה-cron),
-- ולהשאיר עקבות כשהשכבה לא ענתה. בלי השורה השנייה, סנכרון שנכשל שלושה
-- חודשים ברציפות נראה בדיוק כמו סנכרון שלא היה צריך לרוץ.
-- ---------------------------------------------------------------------------
create table if not exists public.street_registry_syncs (
  id          bigint generated always as identity primary key,
  city        text not null,
  ok          boolean not null,
  names_seen  integer,
  inserted    integer,
  updated     integer,
  deactivated integer,
  error       text,
  finished_at timestamptz not null default now()
);

create index if not exists street_registry_syncs_city_ok_idx
  on public.street_registry_syncs (city, ok, finished_at desc);

comment on table public.street_registry_syncs is
  'שורה לכל סבב של street-registry-sync, מוצלח או לא. השורה המוצלחת האחרונה היא שעון ארבעת החודשים.';

alter table public.street_registry_syncs enable row level security;
-- ‏RLS בלי policy כבר מסתיר הכול מ-anon/authenticated, וה-revoke הוא השכבה
-- השנייה: ‏Supabase נותן הרשאות טבלה ל-anon ול-authenticated בברירת מחדל
-- לכל טבלה חדשה ב-public, ולוג תפעולי אינו צריך להיות תלוי בכך ש-policy
-- לא נוסף בטעות מתישהו. אותה תבנית כמו open_house_subscribers.
revoke all on table public.street_registry_syncs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- הוספה ידנית מהטופס
--
-- ‏security definer, כי המתווך/ת אינו/ה כותב/ת לטבלה ישירות.
--
-- מחזירה **תמיד את השם הקנוני** — גם כשהרחוב כבר קיים בכתיב אחר. זה לא
-- ניואנס: מתווך/ת שמקליד/ה "העליה" ולוחץ/ת "הוסיפו לרשימה" מקבל/ת בחזרה
-- "עלייה", והנכס נשמר עם השם שהשכבה מכירה. הכפתור "הוסיפו" הוא גם כפתור
-- "תקנו לי את הכתיב".
-- ---------------------------------------------------------------------------
create or replace function public.street_registry_add(p_city text, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_city   text := btrim(coalesce(p_city, ''));
  -- תחילית "רחוב" יורדת מהשם **המוצג** (לא רק מהמפתח): שורת הכתובת נבנית
  -- כ-"<רחוב> <מספר>", ו-"רחוב הגלבוע 5" הוא ניסוח שאף אחד לא מתכוון אליו.
  -- ‏"שדרות" דווקא נשאר — הוא חלק לגיטימי משם הרחוב ("שדרות מנחם בגין").
  v_name   text := btrim(regexp_replace(
                     regexp_replace(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')),
                                    '^(רחוב|רח''|רח)\s+', ''),
                     '\s+', ' ', 'g'));
  v_key    text;
  v_hit    text;
begin
  select m.id into v_member
    from public.agency_members m
   where m.user_id = auth.uid() and m.active = true
   limit 1;
  if v_member is null then
    raise exception 'only_active_agents_may_add_streets' using errcode = '42501';
  end if;

  if v_city = '' then
    raise exception 'city_required' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'street_name_length' using errcode = '22023';
  end if;
  -- לפחות אות אחת. בלי זה "12" או "---" נכנסים לרשימה הסגורה ונשארים בה.
  if v_name !~ '[א-תa-zA-Z]' then
    raise exception 'street_name_must_contain_letters' using errcode = '22023';
  end if;

  v_key := public.street_name_key(v_name);

  -- קיים כבר? מחזירים את הכתיב שברשימה, גם אם הוא מכובה — הפעלה מחדש היא
  -- החלטה של מנהל/ת הפלטפורמה, ולא תוצאת לוואי של הקלדה בטופס.
  select s.name into v_hit
    from public.street_registry s
   where s.city = v_city and s.name_key = v_key
   limit 1;
  if v_hit is not null then
    return v_hit;
  end if;

  insert into public.street_registry (city, name, source, created_by)
  values (v_city, v_name, 'manual', v_member)
  -- מרוץ בין שני מתווכים על אותו רחוב: מי שהפסיד מקבל את השורה הקיימת
  on conflict (city, name_key) do nothing;

  select s.name into v_hit
    from public.street_registry s
   where s.city = v_city and s.name_key = v_key
   limit 1;
  return coalesce(v_hit, v_name);
end $$;

comment on function public.street_registry_add(text, text) is
  'מוסיפה רחוב לרשימה מתוך טופס הנכס ומחזירה את השם הקנוני. לסוכן/ת פעיל/ה בלבד.';

revoke all on function public.street_registry_add(text, text) from public, anon;
grant execute on function public.street_registry_add(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- קליטת סבב סנכרון
--
-- כל העבודה על הרשימה נעשית כאן, בפקודה אחת, ולא כ-25 upserts מהשרת:
-- סנכרון חלקי שנקטע באמצע היה משאיר רשימה חצי-מעודכנת ואז מכבה הזרעות
-- שלא הספיק לאשר.
--
-- ‏p_min_names הוא הביטחון היחיד מפני "השכבה ענתה, אבל ענתה שטויות".
-- לעפולה יש מאות רחובות; תשובה עם 30 שמות היא תקלה, ולא עיר שהתכווצה.
-- במקרה כזה **לא נוגעים בכלום** — כולל אי-כיבוי — ומדווחים כישלון.
--
-- מה שהפקודה עושה לכל שם:
--   חדש        -> נכנס כ-gis
--   קיים       -> ‏last_seen_at מתעדכן, והשם מוחלף בכתיב של השכבה. כך
--                 רחוב שנוסף ידנית ב-"העליה" הופך ל-"עלייה" ברגע שהשכבה
--                 מאשרת אותו, וכל מי שיבחר בו מכאן ואילך יקבל את הכתיב
--                 שהגיאוקוד מוצא.
--   ‏active     -> **לא נוגעים בו בעדכון.** כיבוי ידני של מנהל/ת הפלטפורמה
--                 הוא החלטה, ולא רעש שהסנכרון הבא מוחק.
--
-- ובסוף — ורק בסוף — הזרעות שלא אושרו: ‏source = 'legacy' שמעולם לא
-- נראה בשכבה. אלה בדיוק "יהושוע חנקין", "מנחם אושיסקין" ו-"ליד בנק
-- הפועלים": טקסט חופשי שהוזרע כדי שהרשימה לא תהיה ריקה, ושכעת יש מולו
-- רשימה אמיתית. הם מכובים ולא נמחקים, כדי שהנכסים שנשמרו איתם יישארו
-- קריאים ושאפשר יהיה להבין מה קרה.
-- ---------------------------------------------------------------------------
create or replace function public.street_registry_absorb(
  p_city       text,
  p_names      text[],
  p_min_names  integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names       text[];
  v_inserted    integer := 0;
  v_updated     integer := 0;
  v_deactivated integer := 0;
  v_seen        integer := 0;
begin
  -- מערך ולא טבלה זמנית: הפונקציה עלולה להיקרא פעמיים באותה טרנזקציה,
  -- ו-create temp table שנייה באותה טרנזקציה נופלת על "already exists".
  select array_agg(v.n order by v.n) into v_names
    from (
      select distinct on (public.street_name_key(c.n)) c.n
        from (
          select btrim(regexp_replace(x, '\s+', ' ', 'g')) as n
            from unnest(coalesce(p_names, '{}'::text[])) as x
        ) c
       where char_length(c.n) between 2 and 80
         and c.n ~ '[א-תa-zA-Z]'
       order by public.street_name_key(c.n), c.n
    ) v;

  v_seen := coalesce(array_length(v_names, 1), 0);

  if v_seen < p_min_names then
    raise exception 'too_few_streets: % (minimum %)', v_seen, p_min_names
      using errcode = '22023';
  end if;

  with upserted as (
    insert into public.street_registry (city, name, source, last_seen_at)
    select p_city, s, 'gis', now() from unnest(v_names) as s
    on conflict (city, name_key) do update
      set name         = excluded.name,
          source       = 'gis',
          last_seen_at = now()
    returning (xmax = 0) as is_insert
  )
  select count(*) filter (where is_insert),
         count(*) filter (where not is_insert)
    into v_inserted, v_updated
    from upserted;

  update public.street_registry
     set active = false
   where city = p_city
     and source = 'legacy'
     and last_seen_at is null
     and active = true;
  get diagnostics v_deactivated = row_count;

  insert into public.street_registry_syncs (city, ok, names_seen, inserted, updated, deactivated)
  values (p_city, true, v_seen, v_inserted, v_updated, v_deactivated);

  return jsonb_build_object(
    'city', p_city, 'names_seen', v_seen, 'inserted', v_inserted,
    'updated', v_updated, 'deactivated', v_deactivated);
end $$;

comment on function public.street_registry_absorb(text, text[], integer) is
  'קולטת את רשימת הרחובות מסבב סנכרון: מוסיפה, מיישרת כתיב, מכבה הזרעות שלא אושרו ורושמת שורה ביומן. ל-service_role בלבד.';

revoke all on function public.street_registry_absorb(text, text[], integer) from public, anon, authenticated;
grant execute on function public.street_registry_absorb(text, text[], integer) to service_role;

create or replace function public.street_registry_sync_failed(p_city text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.street_registry_syncs (city, ok, error)
  values (p_city, false, left(coalesce(p_error, 'unknown'), 500));
$$;

comment on function public.street_registry_sync_failed(text, text) is
  'רושמת סבב סנכרון שנכשל. בלי זה, שכבה שלא עונה במשך חודשים נראית כמו "אין מה לסנכרן".';

revoke all on function public.street_registry_sync_failed(text, text) from public, anon, authenticated;
grant execute on function public.street_registry_sync_failed(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- תנאי הדליקה: "עברו ארבעה חודשים מאז הסנכרון המוצלח האחרון"
--
-- ‏cron יומי עם תנאי, ולא cron רבעוני בלי תנאי — וזה ההבדל בין מנגנון
-- שעובד לבין מנגנון שנראה כאילו הוא עובד:
--
--   * **הפעם הראשונה.** אין סנכרון מוצלח, ולכן התנאי אמיתי כבר בלילה
--     שאחרי המיזוג, והרשימה מתמלאת. ‏cron רבעוני היה משאיר את הרשימה על
--     ההזרעה עד ה-1 בחודש הבא שמתחלק בארבע.
--   * **הכישלון.** ‏WFS שלא ענה בדיוק בלילה המתוזמן היה דוחה את העדכון
--     בארבעה חודשים נוספים. כאן הוא פשוט ינוסה שוב מחר.
--   * **סדר הפריסה.** המיגרציות וה-Edge Functions נפרסות בשני workflows
--     נפרדים באותו push, ואין ביניהם סדר מובטח. ‏cron שיורה בלילה הבא
--     אינו תלוי בשאלה מי סיים ראשון.
--
-- ברוב הלילות התנאי שקרי, ואז `select … where <תנאי>` בלי from מייצר אפס
-- שורות ו-net.http_post כלל אינו מוערך — no-op בעלות של בדיקת אינדקס.
-- ---------------------------------------------------------------------------
create or replace function public.street_registry_sync_due(
  p_city  text     default 'עפולה',
  p_every interval default interval '4 months'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.street_registry_syncs
     where city = p_city and ok and finished_at > now() - p_every
  );
$$;

comment on function public.street_registry_sync_due(text, interval) is
  'האם עברו ארבעה חודשים מאז הסנכרון המוצלח האחרון. תנאי הדליקה של ה-cron street-registry-sync.';

revoke all on function public.street_registry_sync_due(text, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- הזרעה מהנכסים הקיימים
--
-- בין המיזוג לסנכרון הראשון יש לילה אחד, ובלילה הזה רשימה ריקה פירושה
-- שכל נכס חדש נכנס דרך "הוספה ידנית". לכן הרחובות שכבר כתובים על נכסים
-- נכנסים כעת כ-legacy — הטופס עובד כרגיל, והסנכרון הראשון עושה סדר:
-- מה שהשכבה מאשרת הופך ל-gis ומקבל את הכתיב שלה, ומה שלא — מכובה.
--
-- ‏distinct on לפי המפתח ולא לפי השם: הנקודה כולה היא שלא ייכנסו
-- "עלייה" ו-"העליה" כשתי שורות באותה פקודה.
-- ---------------------------------------------------------------------------
insert into public.street_registry (city, name, source)
select distinct on (p.city, public.street_name_key(p.street))
       p.city, btrim(regexp_replace(p.street, '\s+', ' ', 'g')), 'legacy'
  from public.properties p
 where nullif(btrim(coalesce(p.city, '')), '') is not null
   and char_length(btrim(regexp_replace(coalesce(p.street, ''), '\s+', ' ', 'g'))) between 2 and 80
   and btrim(p.street) ~ '[א-תa-zA-Z]'
 order by p.city, public.street_name_key(p.street), btrim(p.street)
on conflict (city, name_key) do nothing;

-- ---------------------------------------------------------------------------
-- התזמון
--
-- ‏4:25 — הדקות היומיות התפוסות בשעות האלה הן 3:10, 3:40, 3:50, 4:00
-- ו-6:40, ומשימה שנוגעת ב-properties באותו רגע נועלת ללא צורך.
--
-- ‏timeout_milliseconds := 120000: סריקת כל נקודות הכתובת של העיר היא כמה
-- עמודי WFS סדרתיים, וברירת המחדל של pg_net (5 שניות) הייתה מנתקת את
-- הקורא ומדווחת "500" שאינו מספר מה קרה. ראו 20261030090000_cron_http_timeout.sql.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/street-registry-sync';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('street-registry-sync')
    where exists (select 1 from cron.job where jobname = 'street-registry-sync');

  perform cron.schedule('street-registry-sync', '25 4 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 120000
    )
    where public.street_registry_sync_due()
  $cron$, v_url));
end $$;

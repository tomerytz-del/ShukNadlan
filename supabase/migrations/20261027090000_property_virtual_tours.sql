-- ============================================================================
-- סיור 360° עצמאי — פנורמות של הסוכן/ת, נגן שלנו, בלי מנוי חודשי
--
-- עד היום היה בפרויקט מסלול אחד לסיור וירטואלי: ‎properties.tour_3d_url‎,
-- כתובת אצל ספק חיצוני (Matterport, Kuula). זה עובד, ויש לו שני מחירים —
-- מנוי חודשי לכל סוכן/ת שרוצה סיור, ויציאה מהאתר: הכפתור פותח לשונית חדשה
-- אצל הספק, ומשם הגולש/ת כבר לא חוזר/ת לטופס הפנייה.
--
-- כאן נוסף המסלול השני: הסוכן/ת מעלה תמונות פנורמה (‏equirectangular 360°)
-- מהמצלמה או מהטלפון, מסמן/ת בעכבר נקודות מעבר בין החללים, והסיור מתנגן
-- ב-Pannellum בתוך דף הנכס עצמו. אין ספק, אין מנוי, והתמונות יושבות ב-
-- Storage שלנו כמו כל תמונת נכס.
--
-- שני המסלולים חיים זה לצד זה ואינם מתחרים: ‎tour_3d_url‎ נשארת כפתור
-- שנפתח בלשונית חדשה, והסיור שכאן נפתח בעמוד. נכס יכול להחזיק את שניהם.
--
-- ## למה טבלה ולא עמודת jsonb על properties
--
-- ‏properties נקראת בכל עמוד באתר ובכל שאילתת חיפוש, ו-‎select *‎ שלה כבר
-- מחזיר עשרות עמודות. מבנה הסצנות שוקל כמה קילובייטים לנכס והוא נדרש
-- במקום אחד בלבד — בדף הנכס, אחרי שכבר ידוע שיש סיור. טבלה נפרדת שומרת
-- אותו מחוץ לכל השאילתות האחרות, ומוסיפה יחס 1:1 מפורש שאפשר למחוק
-- ב-cascade עם הנכס.
--
-- מה שכן יושב על ‎properties‎ הוא דגל בוליאני אחד, ‎has_virtual_tour‎ —
-- בדיוק מה שאריח הנכס והפילטר "סיור 3D" צריכים לדעת בלי לקרוא את הסצנות.
-- הוא נכתב בטריגר ולא ביד: דגל שהיה נשמר מהדפדפן היה משקר ברגע שהשמירה
-- נכשלת באמצע, כמו שכבר קרה עם ‎tour_3d‎ במערך ‎features‎
-- (‏20260905090000_retire_derived_listing_flags).
--
-- ## מבנה scenes
--
-- השדה מחזיק את האובייקט ש-Pannellum מצפה לו, בדיוק כפי שהוא, כדי שדף
-- הנכס יוכל למסור אותו לנגן בלי שכבת תרגום:
--
--   {
--     "<scene_id>": {
--       "title":    "סלון",
--       "type":     "equirectangular",
--       "panorama": "https://…/storage/v1/object/public/property-tours/…",
--       "pitch": -2.1, "yaw": 117.4, "hfov": 110,
--       "hotSpots": [
--         { "pitch": -2.4, "yaw": 115.1, "type": "scene",
--           "text": "מעבר למטבח", "sceneId": "<scene_id אחר>" }
--       ]
--     }
--   }
--
-- ‏pitch/yaw/hfov ברמת הסצנה הם זווית הפתיחה של המצלמה — מה שהסוכן/ת ראה/תה
-- כשלחץ/ה "קביעת זווית הפתיחה" בעורך.
--
-- הצד שקורא (‏property.html) לא סומך על המבנה הזה: הוא מוודא שכל כתובת
-- פנורמה היא אכן קובץ בדלי ‎property-tours‎ שלנו ושכל ‎sceneId‎ של נקודת מעבר
-- קיים, ורק אז מוסר לנגן. ‏DB אינו מקום לאכוף בו סכמת JSON מלאה, אבל הוא כן
-- המקום לחסום גודל — ולכן ה-check על אורך הטקסט.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הטבלה
--
-- ‏unique על property_id: סיור אחד לנכס. זה מה שמאפשר ל-CRM לשמור ב-upsert
-- עם ‎onConflict:'property_id'‎ בלי לקרוא קודם אם כבר יש שורה.
--
-- ‏initial_scene אינו ‎references‎ לשום דבר — הסצנות הן מפתחות בתוך JSON,
-- ולא שורות. דף הנכס נופל חזרה לסצנה הראשונה כשהמפתח שמור כאן כבר לא קיים
-- (חלל שנמחק אחרי שנבחר כפתיחה), ולכן ערך ישן כאן אינו שובר סיור.
-- ---------------------------------------------------------------------------
create table if not exists public.property_virtual_tours (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  initial_scene text,
  scenes        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint property_virtual_tours_property_key unique (property_id),
  constraint property_virtual_tours_scenes_object check (jsonb_typeof(scenes) = 'object'),
  -- ‏תקרת גודל, לא סכמה: סיור של עשרה חללים עם נקודות מעבר הוא כמה קילובייטים.
  -- 200KB הם מרווח של פי עשרות, ועדיין חוסמים כתיבה של זבל לתוך העמודה.
  constraint property_virtual_tours_scenes_size check (length(scenes::text) <= 200000)
);

comment on table public.property_virtual_tours is
  'סיור 360° עצמאי לנכס: אובייקט הסצנות של Pannellum (חלל, פנורמה, נקודות מעבר). התמונות עצמן בדלי property-tours.';
comment on column public.property_virtual_tours.scenes is
  'אובייקט scenes של Pannellum כפי שהוא — מפתח לכל חלל, ובתוכו title/panorama/hotSpots. ראו docs/virtual-tour-360.md.';
comment on column public.property_virtual_tours.initial_scene is
  'מפתח החלל שממנו הסיור נפתח. מפתח שכבר לא קיים ב-scenes אינו שגיאה — הנגן נופל לחלל הראשון.';

drop trigger if exists property_virtual_tours_set_updated_at on public.property_virtual_tours;
create trigger property_virtual_tours_set_updated_at
  before update on public.property_virtual_tours
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. הדגל על הנכס
--
-- אריח הנכס באתר והפילטר "סיור 3D" שואלים שאלה אחת — יש סיור או אין —
-- ובשבילה אסור להם לשלוף את הסצנות של כל נכס בתוצאות. הדגל עונה עליה,
-- והטריגר שמתחתיו הוא מה שמבטיח שהוא לא ישקר.
--
-- ‏"יש סיור" = יש שורה שיש בה לפחות חלל אחד. שורה עם ‎scenes = '{}'‎ נוצרת
-- בעורך לפני שהועלתה הפנורמה הראשונה, וסיור בלי חללים אינו סיור.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists has_virtual_tour boolean not null default false;

comment on column public.properties.has_virtual_tour is
  'יש לנכס סיור 360° עצמאי עם לפחות חלל אחד (property_virtual_tours). נכתב בטריגר בלבד — לא מהטפסים.';

create or replace function public.sync_property_has_virtual_tour()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid := coalesce(new.property_id, old.property_id);
  v_has boolean;
begin
  select exists (
    select 1 from public.property_virtual_tours t
     where t.property_id = v_property_id
       and t.scenes <> '{}'::jsonb
  ) into v_has;

  -- ‏is distinct from ולא כתיבה בכל מקרה: עדכון של properties גורר את כל
  -- הטריגרים שלה (‏updated_at, התראות, תורים), ואין סיבה להעיר אותם כששום
  -- דבר לא השתנה — למשל בשמירה חוזרת של אותו סיור.
  update public.properties
     set has_virtual_tour = v_has
   where id = v_property_id
     and has_virtual_tour is distinct from v_has;

  return null;
end;
$$;

comment on function public.sync_property_has_virtual_tour() is
  'מסנכרן את properties.has_virtual_tour מול קיום סיור עם חללים. security definer — הטריגר רץ גם כשהכותב/ת אינו/ה בעל/ת הנכס.';

drop trigger if exists property_virtual_tours_sync_flag on public.property_virtual_tours;
create trigger property_virtual_tours_sync_flag
  after insert or update or delete on public.property_virtual_tours
  for each row execute function public.sync_property_has_virtual_tour();

-- יישור חד-פעמי, למקרה שהטבלה כבר קיימת מהרצה קודמת של הקובץ
update public.properties p
   set has_virtual_tour = exists (
         select 1 from public.property_virtual_tours t
          where t.property_id = p.id and t.scenes <> '{}'::jsonb)
 where p.has_virtual_tour is distinct from exists (
         select 1 from public.property_virtual_tours t
          where t.property_id = p.id and t.scenes <> '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- 3. הרשאות
--
-- קריאה: הסיור הוא חלק מהמודעה הפומבית, ולכן כל מבקר/ת רואה סיור של נכס
-- ‎active‎ — בדיוק כמו התמונות והסרטון. סיור של נכס שנמכר, הוסר או עדיין
-- נערך נשאר לעיני הסוכן/ת בלבד, כדי שהעורך ב-CRM יוכל להציג אותו לפני
-- הפרסום ואחריו.
--
-- כתיבה: רק הסוכן/ת שהנכס שלו/ה, בדיוק כמו ‎"agent update own properties"‎.
-- מנהל/ת משרד רואה/ה נכסים של הצוות אבל אינו/ה עורך/ת אותם היום, ולכן גם
-- כאן אין לו/ה כתיבה — הגבול נשאר במקום אחד.
-- ---------------------------------------------------------------------------
alter table public.property_virtual_tours enable row level security;

drop policy if exists "read tours of active or own properties" on public.property_virtual_tours;
create policy "read tours of active or own properties"
  on public.property_virtual_tours for select
  using (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and (p.status = 'active' or p.agent_id = public.current_agent_id())));

drop policy if exists "agent writes own property tour" on public.property_virtual_tours;
create policy "agent writes own property tour"
  on public.property_virtual_tours for insert to authenticated
  with check (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and p.agent_id = public.current_agent_id()));

drop policy if exists "agent updates own property tour" on public.property_virtual_tours;
create policy "agent updates own property tour"
  on public.property_virtual_tours for update to authenticated
  using (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and p.agent_id = public.current_agent_id()))
  with check (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and p.agent_id = public.current_agent_id()));

drop policy if exists "agent deletes own property tour" on public.property_virtual_tours;
create policy "agent deletes own property tour"
  on public.property_virtual_tours for delete to authenticated
  using (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and p.agent_id = public.current_agent_id()));

-- ---------------------------------------------------------------------------
-- 4. תזכורות הסוכן/ת יודעות על הסיור
--
-- ‏agent_reminder_findings סופרת "נכסים בלי סרטון ובלי סיור" ושולחת על כך
-- תזכורת (‏video_opportunity ב-docs/agent-reminders.md), ו-video_uplift_ratio
-- מודדת את פער הצפיות בין נכסים עם מדיה עשירה לנכסים בלעדיה. שתיהן הכירו
-- עד היום מסלול סיור אחד — ‎tour_3d_url‎ — ולכן סוכן/ת שבנה/תה סיור 360°
-- שלם היה/תה ממשיך/ה לקבל "לנכס הזה אין סרטון ואין סיור".
--
-- שתי הפונקציות מועתקות כאן במלואן (‏create or replace אינו יודע לתקן שורה
-- אחת) מ-20261026090000_agent_reminders, עם שינוי אחד בכל אחת:
-- ‎has_virtual_tour‎ נספר כסיור לכל דבר. שאר הגוף זהה לתו.
-- ---------------------------------------------------------------------------
create or replace function public.video_uplift_ratio()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_video_min_props'), 15) as min_props,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_video_min_views'), 100) as min_views
  ),
  pool as (
    select p.id,
           (coalesce(nullif(btrim(coalesce(p.video_url, '')), ''),
                     nullif(btrim(coalesce(p.tour_3d_url, '')), '')) is not null
            or p.has_virtual_tour) as has_video
      from public.properties p
     where p.status = 'active'
       and p.created_at < now() - interval '14 days'
  ),
  -- ‏count(distinct pool.id) ולא count(*): ה-left join מכפיל את שורת הנכס
  -- לכל צפייה, ולכן count(*) היה מודד צפיות ומדווח עליהן כמספר נכסים —
  -- ובדיוק הקבוצה עם הסרטון (זו עם יותר צפיות) הייתה נראית גדולה יותר.
  grp as (
    select pool.has_video,
           count(distinct pool.id) as props,
           count(v.id)             as views
      from pool
      left join public.property_views v on v.property_id = pool.id
     group by pool.has_video
  ),
  sides as (
    select
      (select props from grp where has_video)           as vp,
      (select views from grp where has_video)           as vv,
      (select props from grp where not has_video)        as np,
      (select views from grp where not has_video)        as nv
  )
  select case
           when s.vp is null or s.np is null then null
           when s.vp < c.min_props or s.np < c.min_props then null
           when s.vv < c.min_views or s.nv < c.min_views then null
           when s.nv = 0 or s.np = 0 or s.vp = 0 then null
           when (s.vv::numeric / s.vp) / (s.nv::numeric / s.np) <= 1.2 then null
           else round((s.vv::numeric / s.vp) / (s.nv::numeric / s.np), 1)
         end
    from sides s cross join cfg c;
$$;

create or replace function public.agent_reminder_findings(p_agent_id uuid)
returns table (
  kind          text,
  title         text,
  body          text,
  action_acc    text,
  subject_count int,
  sort_order    int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    -- סוכן/ת מחובר/ת מקבל/ת את עצמו/ה בלבד; ‏service_role (שאין לו/ה
    -- ‏current_agent_id) מקבל/ת את מי שביקש/ה. מזהה שנחסם הופך ל-null,
    -- וכל הממצאים למטה יוצאים ריקים.
    select case
             when public.current_agent_id() is null then p_agent_id
             when public.current_agent_id() = p_agent_id then p_agent_id
           end as id
  ),
  cfg as (
    select
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_idle_days'), 7)    as idle_days,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_stale_days'), 60)   as stale_days,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_expiry_days'), 14)  as expiry_days
  ),
  -- ספירה אחת על הנכסים הפעילים, ולא ארבע שאילתות נפרדות. אגרגט בלי
  -- ‏group by מחזיר תמיד שורה אחת, גם כשאין אף נכס — ולכן `agg` בטוחה
  -- לשימוש ישיר גם עבור סוכן/ת בלי נכסים בכלל.
  agg as (
    select
      count(*) filter (
        where coalesce(array_length(p.images, 1), 0) = 0
          and nullif(btrim(coalesce(p.marketing_image, '')), '') is null
      )::int as no_images,
      count(*) filter (
        where nullif(btrim(coalesce(p.video_url, '')), '') is null
          and nullif(btrim(coalesce(p.tour_3d_url, '')), '') is null
          and not p.has_virtual_tour
      )::int as no_video,
      count(*) filter (
        where greatest(coalesce(p.bumped_at, p.created_at),
                       coalesce(p.updated_at, p.created_at))
              < now() - make_interval(days => (select stale_days from cfg))
      )::int as stale,
      count(*) filter (
        where p.listing_expires_at is not null
          and p.listing_expires_at >= current_date
          and p.listing_expires_at <= current_date + (select expiry_days from cfg)
      )::int as expiring
      from public.properties p
     where p.agent_id = (select id from target)
       and p.status = 'active'
  ),
  -- מתי נכנס נכס בפעם האחרונה — בכל סטטוס, כי גם נכס שנכנס ונמכר מיד הוא
  -- עבודה שנעשתה, ולא היה נכון להזכיר "שבוע לא הכנסת נכסים" למי שהכניס/ה
  -- ומכר/ה באותו שבוע.
  activity as (
    select
      (select max(p.created_at) from public.properties p
        where p.agent_id = (select id from target))                      as last_property_at,
      (select m.created_at from public.agency_members m
        where m.id = (select id from target))                            as member_since
  ),
  ratio as (select public.video_uplift_ratio() as x)

  -- 5א. נכסים בלי תמונה. הראשון ברשימה כי הוא הכי יקר: מודעה בלי תמונה
  --     כמעט לא נפתחת, ולכן היא גם לא מייצרת ליד וגם תופסת מקום במדף.
  select 'missing_images'::text,
         'נכסים באוויר בלי תמונה'::text,
         case when g.no_images = 1
              then 'נכס פעיל אחד שלך עדיין בלי תמונה.'
              else g.no_images || ' נכסים פעילים שלך עדיין בלי תמונה.'
         end
         || ' מודעה בלי תמונה כמעט לא נפתחת — העלאת תמונה אחת מחזירה אותה למשחק.',
         'accProperties'::text,
         g.no_images,
         1
    from agg g
   where g.no_images > 0

  union all

  -- 5ב. תוקף ההתקשרות. שנייה בדחיפות, וזו התזכורת היחידה שיש לה תאריך קשה
  --     מבחוץ — ולכן גם היחידה שאי אפשר "לפצות עליה אחר כך".
  select 'expiring_listings'::text,
         'תוקף מודעה שעומד להיגמר'::text,
         case when g.expiring = 1
              then 'תוקף ההתקשרות על מודעה אחת שלך נגמר בתוך ' || c.expiry_days || ' ימים.'
              else 'תוקף ההתקשרות על ' || g.expiring || ' מהמודעות שלך נגמר בתוך ' || c.expiry_days || ' ימים.'
         end
         || ' מודעה שפג תוקפה יורדת מהמדפים — כדאי לחדש את ההתקשרות או לעדכן את התאריך.',
         'accProperties'::text,
         g.expiring,
         2
    from agg g cross join cfg c
   where g.expiring > 0

  union all

  -- 5ג. מודעות שלא נגעו בהן. ‏greatest על bumped_at ועל updated_at: גם
  --     הקפצה וגם עדכון תוכן הם נגיעה, ואין טעם להזכיר על נכס שהוקפץ אתמול.
  select 'stale_listings'::text,
         'מודעות שלא עודכנו מזמן'::text,
         case when g.stale = 1
              then 'מודעה אחת שלך לא עודכנה ולא הוקפצה מעל ' || c.stale_days || ' יום.'
              else g.stale || ' מהמודעות שלך לא עודכנו ולא הוקפצו מעל ' || c.stale_days || ' יום.'
         end
         || ' עדכון מחיר, תמונה חדשה או הקפצה מחזירים אותן לראש המדף.',
         'accProperties'::text,
         g.stale,
         3
    from agg g cross join cfg c
   where g.stale > 0

  union all

  -- 5ד. שתיקה. התזכורת היחידה שאינה על נכס מסוים אלא על היעדר פעילות, ולכן
  --     היא נמדדת מול **כל** נכס שנכנס אי פעם ולא רק מול הפעילים.
  --
  --     שני התנאים ולא אחד: גם הנכס האחרון וגם מועד ההצטרפות חייבים להיות
  --     מעבר לסף. בלי השני, חשבון שנפתח היום וקיבל נכסים בייבוא עם תאריך
  --     היסטורי היה מקבל תזכורת על שתיקה ביום הראשון שלו.
  select 'idle_listings'::text,
         'כבר זמן מה לא נכנס נכס חדש'::text,
         case
           when a.last_property_at is null
             then 'עדיין לא הכנסת נכס למערכת. הנכס הראשון הוא מה שמכניס אותך למדפים ולחיפוש באתר.'
           else 'הנכס האחרון שהכנסת נרשם לפני '
                || (extract(day from (now() - a.last_property_at)))::int || ' ימים. '
                || 'מדף הבית והחיפוש מציגים קודם את מה שטרי — מודעה חדשה מחזירה אותך לראש התור.'
         end,
         'accProperties'::text,
         null::int,
         4
    from activity a cross join cfg c
   where a.member_since is not null
     and a.member_since < now() - make_interval(days => c.idle_days)
     and coalesce(a.last_property_at, a.member_since) < now() - make_interval(days => c.idle_days)

  union all

  -- 5ה. סרטון וסיור. **תזכורת-תובנה ולא תזכורת-משימה**, ולכן היא אחרונה
  --     בסדר וחוזרת פעם בחודש בלבד (‏agent_reminder_kind_interval).
  --
  --     הנוסח נחתך לפי `video_uplift_ratio()`: יש מדגם — יוצא מספר; אין
  --     מדגם — יוצא משפט איכותני. אין כאן מספר ברירת מחדל שנשמע טוב.
  select 'video_opportunity'::text,
         'נכסים בלי סרטון או סיור'::text,
         'ל-' || g.no_video || ' מהנכסים הפעילים שלך אין סרטון ואין סיור וירטואלי. '
         || case
              when r.x is not null
                then 'בפלטפורמה, נכס עם סרטון או סיור מקבל פי ' || trim(to_char(r.x, 'FM999990.0'))
                     || ' צפיות מנכס בלעדיהם.'
              else 'סרטון מחזיק את הגולש/ת בדף זמן רב יותר, ומודעה עם סרטון מסומנת כך גם במדף וגם בשיתוף.'
            end,
         'accProperties'::text,
         g.no_video,
         5
    from agg g cross join ratio r
   where g.no_video > 0;
$$;

-- ---------------------------------------------------------------------------
-- 5. אחסון הפנורמות
--
-- דלי נפרד ולא ‎property-images‎, מאותה סיבה שהסרטון קיבל דלי משלו: לדלי
-- התמונות יש תקרה של 3MB, ופנורמה 360° אחרי הקטנה ל-4096×2048 שוקלת
-- 1-3MB — קרוב מדי לתקרה, ותמונה מצלמת 360 טובה חוצה אותה. הרחבת התקרה של
-- ‎property-images‎ הייתה מאפשרת להעלות קובץ כזה לכל מקום שמעלה תמונה היום.
--
-- 10MB כאן הם מרווח נוח מעל מה שהעורך באמת מעלה: הוא מקטין ל-4096 רוחב
-- וּמקודד JPEG לפני ההעלאה (ראו PANO_MAX_WIDTH ב-crm.html), כי קנבס גדול
-- מזה נחתך ב-Safari של אייפון.
--
-- ההרשאות זהות ל-‎property-videos‎: קריאה לכולם, וכתיבה רק לתיקייה
-- ‎<agent_id>/‎ של הסוכן/ת המחובר/ת.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-tours', 'property-tours', true, 10485760,
  array['image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "property tours are publicly readable" on storage.objects;
create policy "property tours are publicly readable"
  on storage.objects for select
  using (bucket_id = 'property-tours');

drop policy if exists "agent uploads own property tours" on storage.objects;
create policy "agent uploads own property tours"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'property-tours'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
  );

drop policy if exists "agent updates own property tours" on storage.objects;
create policy "agent updates own property tours"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'property-tours'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
  )
  with check (
    bucket_id = 'property-tours'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
  );

drop policy if exists "agent deletes own property tours" on storage.objects;
create policy "agent deletes own property tours"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'property-tours'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
  );

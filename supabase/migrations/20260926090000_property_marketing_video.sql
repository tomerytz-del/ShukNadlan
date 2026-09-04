-- ============================================================================
-- סרטון שיווקי לנכס — מהתמונות שכבר קיימות
--
-- מה כבר היה כאן: ‎properties.video_url‎ (‏20260903130000) מחזיקה סרטון שהסוכן/ת
-- צילם/ה והעלה/תה, או קישור ליוטיוב. זה עובד — למי שיש סרטון. לרוב המודעות
-- בפלטפורמה אין, ולא יהיה: צילום סיור בדירה הוא עוד נסיעה, עוד תיאום עם
-- הבעלים ועוד חצי שעה עריכה.
--
-- מה שהקובץ הזה מוסיף: הפקת סרטון **מהתמונות שכבר הועלו**, לבקשת הסוכן/ת
-- מכרטיס הנכס. שתי רמות לאותו צינור בדיוק:
--
--   • ‎slideshow‎ — התמונות עצמן, בחיתוכים, בלי שום מודל AI. זמין לכל סוכן/ת
--     פעיל/ה. עלות: שבריר אגורה לסרטון (קריאת ffmpeg אחת).
--   • ‎ai_reel‎ — כל תמונה עוברת image-to-video ומקבלת תנועת מצלמה אמיתית
--     (דחיפה קדימה בחזית, פאן בסלון), והקליפים מחוברים לסרטון אחד. מוגבל
--     ל-Premium: זה המסלול היחיד כאן שעולה כסף אמיתי.
--
-- ארבע החלטות שכדאי להכיר לפני שנוגעים כאן:
--
--   א. **הסרטון לא עולה למודעה לבד.** נכס שקיבל סרטון לא משנה את
--      ‎properties.video_url‎ — הסוכן/ת צופה ולוחץ/ת "הצגה במודעה". זה שונה
--      מהתיאור השיווקי, שם המערכת ממלאת שדה ריק לבד: טקסט אפשר לתקן אחרי
--      שנקרא, אבל וידאו AI שיצא מוזר הוא תוכן פומבי שכבר ראו. מנגנון שמפרסם
--      וידאו בלי שאדם צפה בו הוא מנגנון שמפרסם וידאו מוזר.
--   ב. **בחירת התמונות אינה כאן.** היא נשענת על ‎property_image_tags‎ —
--      הסיווג שכבר רץ להדמיות (‏20260827180000) ויודע איזו תמונה היא החזית
--      ואיזו המטבח. אין כאן טבלה חדשה של "תמונות נבחרות", וסרטון של נכס
--      שהעלה תמונות חדשות פשוט ייבנה מהן בפעם הבאה.
--   ג. **התור הוא בשלבים, ולא בקריאה אחת.** יצירת וידאו מתמונה אורכת
--      ‏40–120 שניות לקליפ, וארבעה כאלה לא נכנסים בזמן הריצה של Edge
--      Function. לכן ‎stage‎: הבקשה נשלחת ל-fal וחוזרת מיד, וההרצה הבאה —
--      של אותה קריאה או של ה-cron — אוספת. הרצה שמתה באמצע לא מאבדת קליפ
--      ששולם עליו.
--   ד. **התקרה היא פלטפורמתית ולא פר נכס.** ‎ai_reel‎ עולה דולרים, לא סנטים,
--      והבלם היחיד שמגן על החשבון הוא ספירה יומית אחת לכל הפלטפורמה.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. פרמטרים עסקיים
--
-- כמו כל מספר עסקי בפרויקט — ב-pricing_config ולא בקוד. ‎value‎ שם הוא numeric,
-- ולכן שמות המודלים יושבים בסודות הסביבה (‏FAL_VIDEO_MODEL, FAL_COMPOSE_MODEL)
-- ולא כאן; מה שכאן הוא מה שבאמת משתנה לפי החלטה עסקית.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('marketing_video_enabled', 1,
   'הפקת סרטון שיווקי מתמונות הנכס (1=פעיל, 0=כבוי). מתג כיבוי מיידי בלי פריסה'),
  ('marketing_video_clip_count', 4,
   'כמה תמונות נכנסות לסרטון. ארבע הן ~20 שניות — אורך רִיל, ולא סרט'),
  ('marketing_video_clip_seconds', 5,
   'אורך קליפ AI בשניות. רוב מודלי image-to-video מחייבים על 5 גם כשמבקשים 3'),
  ('marketing_video_slide_seconds', 4,
   'אורך תמונה בסרטון ה-slideshow. ארבע שניות — מספיק להביט, מעט מכדי להשתעמם'),
  ('marketing_video_ai_daily_cap', 25,
   'תקרת סרטוני AI ליממה בכל הפלטפורמה. הבלם היחיד מול חשבון fal'),
  ('marketing_video_cooldown_minutes', 20,
   'כמה זמן ממתינים בין בקשה לבקשה על אותו נכס'),
  ('marketing_video_max_attempts', 8,
   'כמה סבבים מנסים לקדם בקשה לפני שהיא נכשלת. סבב הוא ~90 שניות של איסוף, '
   'וארבעה קליפים דורשים בדרך כלל שניים — התקרה כאן היא מול בקשה תקועה, לא מול בקשה איטית'),
  ('marketing_video_lease_minutes', 5,
   'תוקף התפיסה של בקשה בידי הרצה אחת. אחריו הרצה אחרת רשאית לקחת אותה'),
  ('marketing_video_crossfade_ms', 0,
   'חפיפה במילישניות בין קליפ לקליפ. 0=חיתוכים חדים. ראו docs/property-marketing-video.md')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. הבקשה
--
-- אין כאן ‎unique(property_id)‎ בכוונה, בניגוד ל-property_description_jobs:
-- סרטון אינו שדה על הנכס אלא קובץ, וסוכן/ת שביקש/ה סרטון בינואר ועוד אחד
-- ביוני אמור/ה לראות את שניהם ולבחור. ההגנה מפני בקשות כפולות היא
-- ה-cooldown ובדיקת "כבר רצה בקשה" שב-request_property_video, לא אילוץ
-- שמוחק היסטוריה.
-- ---------------------------------------------------------------------------
create table if not exists public.property_video_jobs (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties(id)      on delete cascade,
  requested_by         uuid          references public.agency_members(id)  on delete set null,
  agency_id            uuid          references public.agencies(id)        on delete set null,

  -- 'slideshow' = התמונות עצמן · 'ai_reel' = כל תמונה עוברת image-to-video
  kind                 text not null check (kind in ('slideshow', 'ai_reel')),

  -- ‎pending‎ → ‎clips‎ (נשלחו ל-fal) → ‎compose‎ (מחברים) → ‎done‎ / ‎failed‎.
  -- ב-slideshow מדלגים על ‎clips‎: אין מה לייצר, התמונות הן הקליפים.
  stage                text not null default 'pending'
    check (stage in ('pending', 'clips', 'compose', 'done', 'failed')),

  model                text,
  compose_request_id   text,
  compose_status_url   text,
  compose_response_url text,

  video_url            text,
  thumbnail_url        text,
  duration_seconds     numeric,

  -- האם הכיתוב המוטבע (מחיר/גודל/מיקום) נכנס בפועל. ראו §7 בתיעוד: סכמת
  -- ה-tracks של fal אינה מתועדת אצלנו כקבועה, ולכן כשהיא נדחית הסרטון עדיין
  -- נוצר — בלי הכיתוב — והשדה הזה אומר מה קרה במקום להשאיר את זה לניחוש.
  overlay_applied      boolean not null default false,

  attempts             int  not null default 0,
  last_error           text,
  claimed_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  finished_at          timestamptz
);

comment on table public.property_video_jobs is
  'בקשת הפקת סרטון שיווקי לנכס. מכונת שלבים: pending→clips→compose→done/failed. '
  'הקובץ שנוצר אינו מתפרסם לבד — הסוכן/ת מעתיק/ה אותו ל-properties.video_url.';

create index if not exists property_video_jobs_property_idx
  on public.property_video_jobs (property_id, created_at desc);

-- האינדקס שה-cron רץ עליו: רק השורות שעוד לא נגמרו.
create index if not exists property_video_jobs_open_idx
  on public.property_video_jobs (stage, claimed_at)
  where stage in ('pending', 'clips', 'compose');

-- ---------------------------------------------------------------------------
-- 2. הקליפים
--
-- שורה לכל תמונה שנכנסת לסרטון. ב-slideshow היא מתמלאת מיד (‎clip_url‎ =
-- התמונה עצמה); ב-ai_reel היא מחזיקה את מזהה הבקשה ב-fal עד שהווידאו מוכן.
--
-- ‎status_url‎ ו-‎response_url‎ נשמרים כפי ש-fal מסר אותם ולא נבנים מהמודל:
-- לנקודות קצה מקוננות אצלם נתיב הסטטוס אינו נתיב השליחה, ולנחש אותו פירושו
-- לאבד קליפ ששולם עליו. ראו supabase/functions/_shared/fal.ts.
-- ---------------------------------------------------------------------------
create table if not exists public.property_video_clips (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.property_video_jobs(id) on delete cascade,
  position         int  not null,
  room_type        text,
  source_image_url text not null,
  prompt           text,
  fal_request_id   text,
  status_url       text,
  response_url     text,
  clip_url         text,
  status           text not null default 'pending'
    check (status in ('pending', 'submitted', 'done', 'failed')),
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (job_id, position)
);

comment on table public.property_video_clips is
  'קליפ אחד בסרטון שיווקי. position קובע את הסדר בציר הזמן. '
  'ב-slideshow clip_url הוא התמונה עצמה; ב-ai_reel הוא הווידאו שחזר מ-fal.';

create index if not exists property_video_clips_job_idx
  on public.property_video_clips (job_id, position);

-- ---------------------------------------------------------------------------
-- 3. חותמת עדכון
-- ---------------------------------------------------------------------------
create or replace function public.touch_property_video_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists property_video_jobs_touch  on public.property_video_jobs;
create trigger property_video_jobs_touch
  before update on public.property_video_jobs
  for each row execute function public.touch_property_video_row();

drop trigger if exists property_video_clips_touch on public.property_video_clips;
create trigger property_video_clips_touch
  before update on public.property_video_clips
  for each row execute function public.touch_property_video_row();

-- ---------------------------------------------------------------------------
-- 4. ‏RLS
--
-- כל הכתיבה עוברת ב-Edge Function עם service_role, שעוקף RLS. ללקוח יש
-- קריאה בלבד, ורק על נכסים שלו — ה-CRM קורא את הטבלאות ישירות כדי להציג
-- מצב וסרטון אחרון, ולכן אין כאן RPC נפרד לזה.
--
-- שימו לב ש-‎using‎ בודק דרך ‎properties‎ ולא דרך ‎requested_by‎: סוכן/ת שעזב/ה
-- את המשרד לא לוקח/ת איתו/ה את הסרטונים של הנכסים, ומנהל/ת שנכנס/ת במקומו/ה
-- אמור/ה לראות אותם.
-- ---------------------------------------------------------------------------
alter table public.property_video_jobs  enable row level security;
alter table public.property_video_clips enable row level security;

grant select on public.property_video_jobs  to authenticated;
grant select on public.property_video_clips to authenticated;

drop policy if exists "agents read own property video jobs" on public.property_video_jobs;
create policy "agents read own property video jobs"
  on public.property_video_jobs for select to authenticated
  using (
    exists (
      select 1
        from public.properties p
        join public.agency_members m on m.user_id = (select auth.uid()) and m.active = true
       where p.id = public.property_video_jobs.property_id
         and (coalesce(m.is_platform_admin, false)
              or p.agent_id  = m.id
              or (m.agency_id is not null and p.agency_id = m.agency_id))
    )
  );

drop policy if exists "agents read own property video clips" on public.property_video_clips;
create policy "agents read own property video clips"
  on public.property_video_clips for select to authenticated
  using (
    exists (
      select 1
        from public.property_video_jobs j
        join public.properties p         on p.id = j.property_id
        join public.agency_members m     on m.user_id = (select auth.uid()) and m.active = true
       where j.id = public.property_video_clips.job_id
         and (coalesce(m.is_platform_admin, false)
              or p.agent_id  = m.id
              or (m.agency_id is not null and p.agency_id = m.agency_id))
    )
  );

-- ---------------------------------------------------------------------------
-- 5. הזכאות
--
-- ‎slideshow‎ פתוח לכל סוכן/ת פעיל/ה: הוא לא קורא לשום מודל, ולחסום אותו לפי
-- מסלול היה גובה תשלום על קריאת ffmpeg אחת.
--
-- ‎ai_reel‎ מוגבל ל-Premium, באותם שלושה תנאים בדיוק שההדמיות משתמשות בהם
-- (‏property_visualizations_enabled) — כדי שלא יהיו בפלטפורמה שתי הגדרות
-- שונות ל"מי זכאי/ת לתוכן שעולה כסף".
-- ---------------------------------------------------------------------------
create or replace function public.property_video_ai_enabled(p_property_id uuid)
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

comment on function public.property_video_ai_enabled(uuid) is
  'סרטון AI זמין רק לנכס פעיל של סוכן/ת Premium פעיל/ה. אותם תנאים כמו בהדמיות.';

grant execute on function public.property_video_ai_enabled(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. בקשת הסוכן/ת
--
-- אותו תפקיד כמו ‎request_property_description‎: כל מה שהוא "מי מותר, כל כמה
-- זמן, וכמה" נבדק כאן, בהקשר ה-JWT, ולא ב-Edge Function. ה-Edge Function
-- מקבלת job_id ומייצרת — היא לא מחליטה מי זכאי/ת.
--
-- בקשה שנופלת על נכס שכבר רצה עליו בקשה מחזירה את אותו ‎job_id‎ ולא שגיאה:
-- סוכן/ת שלחץ/ה פעמיים רוצה לראות את מה שכבר רץ, לא הודעת תקלה — ובוודאי
-- לא סרטון שני על חשבון הפלטפורמה.
-- ---------------------------------------------------------------------------
create or replace function public.request_property_video(
  p_property_id uuid,
  p_kind        text default 'slideshow'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent    uuid;
  v_agency   uuid;
  v_admin    boolean;
  v_prop     record;
  v_cooldown int;
  v_cap      int;
  v_used     int;
  v_last     timestamptz;
  v_open     uuid;
  v_job      uuid;
begin
  if p_kind not in ('slideshow', 'ai_reel') then
    return jsonb_build_object('error', 'bad_kind');
  end if;

  if coalesce((select value::int from public.pricing_config
                where key = 'marketing_video_enabled'), 1) <> 1 then
    return jsonb_build_object('error', 'disabled');
  end if;

  select m.id, m.agency_id, coalesce(m.is_platform_admin, false)
    into v_agent, v_agency, v_admin
    from public.agency_members m
   where m.user_id = (select auth.uid())
     and m.active = true;

  if v_agent is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select id, agent_id, agency_id, status, images into v_prop
    from public.properties where id = p_property_id;
  if v_prop.id is null then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  if not (v_admin or v_prop.agent_id = v_agent
          or (v_agency is not null and v_prop.agency_id = v_agency)) then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  if v_prop.status is distinct from 'active' then
    return jsonb_build_object('error', 'property_not_active');
  end if;

  -- שתי תמונות הן הרף התחתון של "סרטון". באחת זו תמונה שזזה, ושליחת בקשה
  -- עליה הייתה מבזבזת קריאה כדי להחזיר משהו שאיש לא ישתף.
  if coalesce(array_length(v_prop.images, 1), 0) < 2 then
    return jsonb_build_object('error', 'not_enough_images');
  end if;

  if p_kind = 'ai_reel' and not v_admin
     and not public.property_video_ai_enabled(p_property_id) then
    return jsonb_build_object('error', 'ai_not_available');
  end if;

  -- בקשה שכבר רצה על הנכס — מחזירים אותה במקום לפתוח שנייה
  select id into v_open
    from public.property_video_jobs
   where property_id = p_property_id
     and stage in ('pending', 'clips', 'compose')
   order by created_at desc
   limit 1;
  if v_open is not null then
    return jsonb_build_object('success', true, 'job_id', v_open, 'already_running', true);
  end if;

  v_cooldown := coalesce((select value::int from public.pricing_config
                           where key = 'marketing_video_cooldown_minutes'), 20);

  select max(created_at) into v_last
    from public.property_video_jobs where property_id = p_property_id;
  if v_last is not null and v_last > now() - make_interval(mins => greatest(v_cooldown, 0)) then
    return jsonb_build_object(
      'error', 'cooldown_active',
      'retry_after_seconds',
      ceil(extract(epoch from (v_last + make_interval(mins => v_cooldown)) - now()))::int);
  end if;

  -- התקרה חלה על ‎ai_reel‎ בלבד, והיא פלטפורמתית: זה הסעיף בחשבון של fal.
  -- ‎slideshow‎ אינו נספר — קריאת ffmpeg אחת אינה סיכון תקציבי.
  if p_kind = 'ai_reel' then
    v_cap := coalesce((select value::int from public.pricing_config
                        where key = 'marketing_video_ai_daily_cap'), 25);
    select count(*) into v_used
      from public.property_video_jobs
     where kind = 'ai_reel'
       and created_at > now() - interval '24 hours';
    if v_used >= v_cap then
      return jsonb_build_object('error', 'daily_cap_reached');
    end if;
  end if;

  -- ‎claimed_at‎ נקבע כבר כאן, ולא ב-Edge Function. הסיבה מעשית: הקריאה של
  -- הסוכן/ת מתחילה לקדם את הבקשה מיד, וה-cron רץ כל דקה — בלי החכירה הזו
  -- הוא היה תופס אותה תוך שנייה וממשיך אותה **במקביל**, כלומר שולח את אותם
  -- קליפים ל-fal פעמיים ומשלם עליהם פעמיים. ההרצה שמסיימת את הסבב משחררת
  -- את החכירה בעצמה, וכך הסבב הבא ממשיך בלי להמתין לפקיעה המלאה.
  insert into public.property_video_jobs (property_id, requested_by, agency_id, kind, claimed_at)
  values (p_property_id, v_agent, v_prop.agency_id, p_kind, now())
  returning id into v_job;

  return jsonb_build_object('success', true, 'job_id', v_job, 'already_running', false);
end;
$$;

comment on function public.request_property_video(uuid, text) is
  'בקשת סרטון שיווקי מהסוכן/ת: הרשאה, זכאות מסלול, cooldown ותקרה יומית. ההפקה עצמה ב-Edge Function.';

revoke all on function public.request_property_video(uuid, text) from public;
revoke all on function public.request_property_video(uuid, text) from anon;
grant execute on function public.request_property_video(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. תפיסת בקשות פתוחות — המסלול של ה-cron
--
-- ‎claimed_at‎ הוא חכירה ולא נעילה: הרצה תופסת בקשה לחמש דקות, וכשהיא מתה
-- באמצע (‏Edge Function שנחתכה, פריסה מחדש) ההרצה הבאה לוקחת אותה. נעילה
-- אמיתית הייתה משאירה בקשות תקועות לנצח בכל פריסה.
--
-- ‎attempts‎ עולה בכל תפיסה, ולא בכל כישלון: בקשה שנתפסת ולא מתקדמת שוב ושוב
-- היא בדיוק המקרה שצריך להיפסק, וספירת כישלונות מפורשים לא הייתה תופסת אותו.
-- ---------------------------------------------------------------------------
create or replace function public.claim_property_video_jobs(p_limit int default 3)
returns setof public.property_video_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease int := coalesce((select value::int from public.pricing_config
                            where key = 'marketing_video_lease_minutes'), 5);
  v_max   int := coalesce((select value::int from public.pricing_config
                            where key = 'marketing_video_max_attempts'), 3);
begin
  -- קודם מסמנים כנכשלות את מי שמיצתה את הניסיונות, כדי שלא תיתפס שוב
  update public.property_video_jobs
     set stage       = 'failed',
         last_error  = coalesce(last_error, 'הבקשה לא הושלמה אחרי ' || v_max || ' ניסיונות'),
         finished_at = now()
   where stage in ('pending', 'clips', 'compose')
     and attempts >= v_max;

  return query
  update public.property_video_jobs j
     set claimed_at = now(),
         attempts   = j.attempts + 1
   where j.id in (
     select id from public.property_video_jobs
      where stage in ('pending', 'clips', 'compose')
        and (claimed_at is null
             or claimed_at < now() - make_interval(mins => greatest(v_lease, 1)))
      order by created_at
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning j.*;
end;
$$;

comment on function public.claim_property_video_jobs(int) is
  'תופסת בקשות סרטון פתוחות לטיפול הרצה אחת (חכירה של marketing_video_lease_minutes). לקוראים פנימיים בלבד.';

revoke all on function public.claim_property_video_jobs(int) from public;
revoke all on function public.claim_property_video_jobs(int) from anon, authenticated;
grant execute on function public.claim_property_video_jobs(int) to service_role;

-- ---------------------------------------------------------------------------
-- 8. ניקוי
--
-- בקשה שנתקעה מעבר לשעה כבר לא תסתיים: אם fal לא החזיר עד עכשיו, הבקשה שם
-- פגה. משאירים אותה כ-failed עם סיבה, ולא מוחקים — הסוכן/ת שלחץ/ה וחיכה
-- אמור/ה לראות מה קרה, וגם החשבון מול fal צריך להיות ניתן להצלבה.
-- ---------------------------------------------------------------------------
create or replace function public.expire_property_video_jobs()
returns integer
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.property_video_jobs
       set stage       = 'failed',
           last_error  = coalesce(last_error, 'הבקשה לא הסתיימה בתוך שעה'),
           finished_at = now()
     where stage in ('pending', 'clips', 'compose')
       and created_at < now() - interval '1 hour'
    returning 1
  )
  select count(*)::int from done;
$$;

comment on function public.expire_property_video_jobs() is
  'מסמנת failed בקשות סרטון שנתקעו מעבר לשעה. שומרת על התור נקי.';

revoke all on function public.expire_property_video_jobs() from public;
revoke all on function public.expire_property_video_jobs() from anon, authenticated;
grant execute on function public.expire_property_video_jobs() to service_role;

-- ---------------------------------------------------------------------------
-- 9. הצגת הסרטון במודעה
--
-- הפעולה שהופכת קובץ שנוצר לסרטון של המודעה. היא מפורשת ונפרדת מההפקה
-- בכוונה (החלטה א' בראש הקובץ): וידאו AI שיצא מוזר הוא תוכן פומבי, ומי
-- שמאשר/ת אותו צריך/ה להיות מי שצפה/תה בו.
--
-- ‎p_video_url‎ אינו מתקבל מהקורא אלא נקרא מהבקשה — אחרת זו הייתה דרך לכתוב
-- כל כתובת שהיא ל-video_url של כל נכס.
-- ---------------------------------------------------------------------------
create or replace function public.publish_property_video(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent  uuid;
  v_agency uuid;
  v_admin  boolean;
  v_job    record;
  v_prop   record;
begin
  select m.id, m.agency_id, coalesce(m.is_platform_admin, false)
    into v_agent, v_agency, v_admin
    from public.agency_members m
   where m.user_id = (select auth.uid())
     and m.active = true;

  if v_agent is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select id, property_id, video_url, stage into v_job
    from public.property_video_jobs where id = p_job_id;
  if v_job.id is null then
    return jsonb_build_object('error', 'job_not_found');
  end if;
  if v_job.stage is distinct from 'done' or v_job.video_url is null then
    return jsonb_build_object('error', 'video_not_ready');
  end if;

  select id, agent_id, agency_id into v_prop
    from public.properties where id = v_job.property_id;

  if not (v_admin or v_prop.agent_id = v_agent
          or (v_agency is not null and v_prop.agency_id = v_agency)) then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  update public.properties
     set video_url = v_job.video_url
   where id = v_job.property_id;

  return jsonb_build_object('success', true, 'video_url', v_job.video_url);
end;
$$;

comment on function public.publish_property_video(uuid) is
  'מציבה סרטון שהופק כ-properties.video_url. הכתובת נקראת מהבקשה ולא מהקורא — בכוונה.';

revoke all on function public.publish_property_video(uuid) from public;
revoke all on function public.publish_property_video(uuid) from anon;
grant execute on function public.publish_property_video(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. הדלי
--
-- אותו דלי ‎property-videos‎ של הסרטונים שהסוכנים מעלים (‏20260903130000),
-- ובאותה תבנית נתיב ‎<agent_id>/<property_id>/‎ — כך שמדיניות המחיקה הקיימת
-- של הסוכן/ת חלה גם על מה שהמערכת הפיקה עבורו/ה. דלי נפרד היה מחייב מדיניות
-- מקבילה שתסטה ממנה ביום שמישהו יעדכן רק אחת מהשתיים.
--
-- אין כאן ‎insert into storage.buckets‎: הדלי כבר קיים ומוגדר, וכתיבה חוזרת
-- עליו הייתה מסתכנת בדריסת מגבלות שהותאמו מאז ידנית.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'property-videos') then
    raise warning 'הדלי property-videos אינו קיים — יש להריץ קודם את 20260903130000_property_video_upload.sql';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. תזמון
--
-- ‎property-video‎ בלי גוף = "קדם כל בקשה פתוחה". הדקה מוזזת ב-4 ביחס לפרסום
-- (‏*/5) ולתיאור (‏2-59/5) כדי ששלוש הפונקציות לא ייצאו באותה שנייה.
--
-- כל דקה ולא כל חמש: סוכן/ת מסתכל/ת על מסך שכתוב בו "מפיק סרטון", והפער
-- בין ההרצה שהתחילה לבין זו שאוספת הוא הזמן שבו כלום לא קורה. ההרצה עצמה
-- זולה — היא שולפת בקשות פתוחות ובדרך כלל מוצאת אפס.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/property-video';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את property-video בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('property-video')
    where exists (select 1 from cron.job where jobname = 'property-video');
  perform cron.unschedule('property-videos-expire')
    where exists (select 1 from cron.job where jobname = 'property-videos-expire');

  perform cron.schedule('property-video', '* * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    );
  $cron$, v_url));

  perform cron.schedule('property-videos-expire', '53 * * * *',
                        'select public.expire_property_video_jobs()');
end;
$$;

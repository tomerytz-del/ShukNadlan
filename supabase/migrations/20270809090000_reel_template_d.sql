-- ===========================================================================
-- רילס בתבנית D: Grok מפיק ראשי, האתר מפיק גיבוי, fal נשאר מוצא אחרון
--
-- עד כאן כל בקשת סרטון יצאה ל-fal/Kling ומוזגה שם. מעכשיו הבקשה ממתינה
-- למפיק החיצוני (‏Grok Bot), שדוגם את התור דרך ‎reel-producer‎, מרנדר רילס
-- אנכי עם קריינות ומחזיר קובץ. אם הוא לא לקח את הבקשה תוך 15 דקות, או
-- שהפסיק לדווח באמצע, ה-reconcile מעביר אותה לרנדרר של האתר (‏workflow ב-
-- GitHub Actions שמריץ את אותו ‎reel.py‎). רק אם גם זה נכשל - המסלול הישן
-- של fal. החיוב לא זז: הכול עדיין ב-‎start_property_video_job‎, וכישלון
-- סופי מזכה ב-‎fail_property_video_job‎.
--
-- ‏**מי מחזיק בבקשה הוא עמודה, לא הנחה.** ‏‎claimed_by‎ + ‏‎heartbeat_at‎ הם מה
-- שמאפשר לגיבוי לקחת בקשה בלי שהמפיק הראשי ידרוס אותה אחר כך: ‏
-- ‎complete_property_video_job‎ משלימה רק למי שמחזיק בה, ו-
-- ‎reel_job_heartbeat‎ עונה ‎not_owner‎ למי שאיבד אותה.
--
-- ובנוסף, הרילסים היומיים (‏5א בהנחיה): Grok מפרסם עד שלושה ביום לרשתות,
-- ומעכשיו שומר אותם גם כסרטון של הנכס - בלי חיוב, בלי מכסה, ובלי לגעת
-- בסרטון שהסוכן/ת העלה או הזמין/ה. ‏docs/property-marketing-video.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. סטטוסים, עמודות ואינדקסים
-- ---------------------------------------------------------------------------
alter table public.property_video_jobs
  drop constraint if exists property_video_jobs_status_check;
alter table public.property_video_jobs
  add constraint property_video_jobs_status_check
  check (status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading', 'done', 'failed'));

alter table public.property_video_jobs
  add column if not exists producer        text,
  add column if not exists claimed_by      text,
  add column if not exists claimed_at      timestamptz,
  add column if not exists heartbeat_at    timestamptz,
  add column if not exists fallback_reason text,
  add column if not exists cover_url       text,
  add column if not exists template        text default 'D',
  add column if not exists published_urls  jsonb;

-- ‏null = בקשה מלפני התבנית (כולן fal). ‏grok_daily = רילס יומי, לא בקשה של סוכן/ת.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'property_video_jobs_producer_check') then
    alter table public.property_video_jobs
      add constraint property_video_jobs_producer_check
      check (producer is null or producer in ('grok_reel', 'site_reel', 'fal_legacy', 'grok_daily'));
  end if;
end $$;

comment on column public.property_video_jobs.producer is
  'מי מפיק: grok_reel (ראשי), site_reel (הגיבוי ב-GitHub Actions), fal_legacy (Kling, מוצא אחרון), grok_daily (רילס יומי בלי חיוב). null = לפני תבנית D.';
comment on column public.property_video_jobs.claimed_by is
  'מי מחזיק בבקשה ב-rendering. complete_property_video_job ו-reel_job_heartbeat בודקות מולו, כדי שמפיק שאיבד אותה לא ידרוס.';
comment on column public.property_video_jobs.fallback_reason is
  'למה הבקשה עברה מפיק: producer_offline, unclaimed_15m, stale_heartbeat_20m, producer_failed: ...';

-- הסטטוסים ה"פתוחים" - אותה רשימה בכל המקומות בקובץ הזה, ב-reconcile,
-- ב-ops_agent/config.py וב-cron. סטטוס שנשמט מאחד מהם הוא בקשה ששולמה
-- ואיש אינו רואה.
drop index if exists public.uniq_property_video_job_open;
create unique index uniq_property_video_job_open
  on public.property_video_jobs (property_id)
  where status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading');

drop index if exists public.idx_property_video_jobs_open;
create index idx_property_video_jobs_open
  on public.property_video_jobs (status, updated_at)
  where status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading');

-- תמונת השער של הסרטון שעל הנכס. נפרדת מ-images כי היא שייכת לסרטון:
-- סרטון חדש בלי שער (fal) מאפס אותה, ולא משאיר שער של רילס קודם.
alter table public.properties
  add column if not exists video_poster_url text;

-- ---------------------------------------------------------------------------
-- 2. הדופק של המפיק
-- ---------------------------------------------------------------------------
create table if not exists public.producer_heartbeat (
  producer  text primary key,
  last_seen timestamptz not null,
  version   text,
  status    text
);
alter table public.producer_heartbeat enable row level security;
revoke all on public.producer_heartbeat from anon, authenticated;
grant select, insert, update, delete on public.producer_heartbeat to service_role;

comment on table public.producer_heartbeat is
  'מתי דיווח כל מפיק רילסים לאחרונה. property-video-create שולחת ל-Grok רק כשהדופק בן פחות מ-10 דקות; אחרת ישר לגיבוי.';

-- ---------------------------------------------------------------------------
-- 3. הדליים
--
-- ‏property-videos מקבל גם את תמונת השער (‏JPEG) שנשמרת ליד הרילס.
-- ‏reel-assets פרטי: המוזיקה ברישיון Pixabay, שאסור להפיץ את הקובץ לבדו -
-- ולכן לא בריפו ולא בדלי ציבורי. הרנדרר מקבל ממנה כתובת חתומה לדקות.
-- ---------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg']
 where id = 'property-videos';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reel-assets', 'reel-assets', false, 20971520, array['audio/mpeg', 'audio/mp3'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 4. "סרטון שהמערכת יצרה"
--
-- קובץ בדלי שלנו ששמו מתחיל ב-marketing- (כל מה שהמסלולים האוטומטיים
-- שומרים), או כתובת שבקשה שהושלמה החזירה. כל השאר - קובץ שהסוכן/ת העלה,
-- יוטיוב - הוא של הסוכן/ת, ונדרס רק עם replace_existing.
-- ---------------------------------------------------------------------------
create or replace function public.property_video_is_system(p_url text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_url is not null and (
    p_url ~ '/storage/v1/object/public/property-videos/[^?]*/marketing-[^/?]*(\?.*)?$'
    or exists (
      select 1 from public.property_video_jobs j
       where j.status = 'done' and j.result_url = p_url
    )
  );
$$;
revoke execute on function public.property_video_is_system(text) from public, anon, authenticated;
grant execute on function public.property_video_is_system(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. פתיחת בקשה
--
-- שלושה פרמטרים חדשים, כולם עם ברירת מחדל שמשמרת את ההתנהגות הקודמת:
-- הסטטוס ההתחלתי (‏pending_reel / rendering / generating_clips), המפיק,
-- וסיבת הגיבוי. השורה נולדת בסטטוס הסופי שלה, כך שאין רגע שבו בקשה
-- פתוחה אינה מוכרת לאינדקס הייחודי.
--
-- ‏video_exists רק לסרטון של הסוכן/ת. רילס יומי או סרטון ישן של המערכת
-- מוחלפים בלי לשאול (previous_video_url עדיין נשמר, ונמחק בסוף).
--
-- ‏grok_daily אינו נספר במכסת ה-premium: הוא שירות של האתר ולא הזמנה.
-- ---------------------------------------------------------------------------
drop function if exists public.start_property_video_job(uuid, uuid, text, numeric, text, boolean);

create or replace function public.start_property_video_job(
  p_property_id      uuid,
  p_agent_id         uuid,
  p_webhook_token    text,
  p_clip_seconds     numeric,
  p_aspect_ratio     text,
  p_replace_existing boolean default false,
  p_initial_status   text default 'generating_clips',
  p_producer         text default null,
  p_fallback_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier      text;
  v_price     numeric;
  v_cap       numeric;
  v_used      integer;
  v_video     text;
  v_charged   numeric := 0;
  v_rows      int;
  v_job_id    uuid;
  v_status    text := coalesce(p_initial_status, 'generating_clips');
begin
  if v_status not in ('pending_reel', 'rendering', 'generating_clips') then
    return jsonb_build_object('error', 'bad_initial_status');
  end if;

  v_tier := public.property_video_tier(p_property_id, p_agent_id);
  if v_tier is null then
    return jsonb_build_object('error', 'not_eligible');
  end if;

  if exists (
    select 1 from public.property_video_jobs
    where property_id = p_property_id
      and status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading')
  ) then
    return jsonb_build_object('error', 'job_in_progress');
  end if;

  select video_url into v_video from public.properties where id = p_property_id;
  if v_video is not null and not p_replace_existing
     and not public.property_video_is_system(v_video) then
    return jsonb_build_object('error', 'video_exists', 'video_url', v_video);
  end if;

  if v_tier = 'premium' then
    select coalesce(value, 8) into v_cap
    from public.pricing_config where key = 'property_video_premium_monthly_cap';
    v_cap := coalesce(v_cap, 8);

    select count(*) into v_used
    from public.property_video_jobs
    where agent_id = p_agent_id
      and status <> 'failed'
      and producer is distinct from 'grok_daily'
      and created_at >= date_trunc('month', now());

    if v_used >= v_cap then
      return jsonb_build_object('error', 'monthly_cap_reached', 'cap', v_cap, 'used', v_used);
    end if;
  else
    select coalesce(value, 20) into v_price
    from public.pricing_config where key = 'property_video_price_mid';
    v_price := coalesce(v_price, 20);

    update public.agency_members
       set credit_balance = credit_balance - v_price
     where id = p_agent_id and credit_balance >= v_price;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('error', 'insufficient_balance', 'required', v_price);
    end if;
    v_charged := v_price;
  end if;

  insert into public.property_video_jobs (
    property_id, agent_id, status, tier_at_request, amount_charged,
    clip_seconds, aspect_ratio, webhook_token, previous_video_url, replaced_existing,
    producer, template, fallback_reason, claimed_by, claimed_at, heartbeat_at
  ) values (
    p_property_id, p_agent_id, v_status, v_tier, v_charged,
    coalesce(p_clip_seconds, 2.5), coalesce(p_aspect_ratio, '16:9'),
    p_webhook_token, v_video, (v_video is not null),
    p_producer,
    case when v_status in ('pending_reel', 'rendering') then 'D' end,
    p_fallback_reason,
    case when v_status = 'rendering' then p_producer end,
    case when v_status = 'rendering' then now() end,
    case when v_status = 'rendering' then now() end
  )
  returning id into v_job_id;

  if v_charged > 0 then
    insert into public.property_video_charges (job_id, property_id, agent_id, amount, status)
    values (v_job_id, p_property_id, p_agent_id, v_charged, 'charged');
  end if;

  return jsonb_build_object(
    'success', true,
    'job_id', v_job_id,
    'tier', v_tier,
    'amount_charged', v_charged,
    'status', v_status,
    'previous_video_url', v_video
  );
end;
$$;
revoke execute on function public.start_property_video_job(uuid, uuid, text, numeric, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.start_property_video_job(uuid, uuid, text, numeric, text, boolean, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. השלמת בקשה
--
-- ‏p_producer: מי שמשלים. כשהוא נמסר, הבקשה חייבת להיות ב-rendering אצלו;
-- כשלא (מסלול fal) - באחד מסטטוסי fal. כך Grok שאיבד את הבקשה לגיבוי, או
-- גיבוי שהבקשה עברה ממנו ל-fal, מקבל not_owner ולא דורס את הסרטון.
--
-- ‏previous_is_system אומר לקורא אם מותר למחוק את הסרטון הקודם (חושב לפני
-- העדכון, כי אחריו הכתובת כבר לא על הנכס).
-- ---------------------------------------------------------------------------
drop function if exists public.complete_property_video_job(uuid, text);

create or replace function public.complete_property_video_job(
  p_job_id     uuid,
  p_result_url text,
  p_cover_url  text default null,
  p_producer   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job         public.property_video_jobs;
  v_title       text;
  v_prev_poster text;
  v_prev_system boolean;
begin
  select * into v_job from public.property_video_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('error', 'job_not_found');
  end if;
  if v_job.status = 'done' then
    return jsonb_build_object('success', true, 'already_done', true, 'result_url', v_job.result_url);
  end if;

  if p_producer is not null then
    if v_job.status <> 'rendering' or v_job.claimed_by is distinct from p_producer then
      return jsonb_build_object('error', 'not_owner', 'status', v_job.status, 'claimed_by', v_job.claimed_by);
    end if;
  elsif v_job.status not in ('generating_clips', 'merging', 'uploading') then
    return jsonb_build_object('error', 'not_owner', 'status', v_job.status, 'claimed_by', v_job.claimed_by);
  end if;

  v_prev_system := public.property_video_is_system(v_job.previous_video_url);
  select video_poster_url into v_prev_poster from public.properties where id = v_job.property_id;

  update public.properties
     set video_url = p_result_url, video_poster_url = p_cover_url
   where id = v_job.property_id
  returning title into v_title;

  update public.property_video_jobs
     set status = 'done', result_url = p_result_url, cover_url = p_cover_url,
         error_detail = null, updated_at = now()
   where id = p_job_id;

  -- ‏marketing_copy ולא סוג חדש, כמו עד היום. הטריגר
  -- ‏notifications_apply_preferences מסנן בשקט סוכן/ת שהשתיק/ה את הסוג.
  insert into public.notifications (agent_id, type, title, body, related_property_id)
  values (
    v_job.agent_id,
    'marketing_copy',
    'הסרטון מוכן: ' || coalesce(v_title, 'נכס'),
    'הסרטון השיווקי הופק והוצמד לנכס.'
      || case when v_job.replaced_existing then ' הסרטון הקודם הוחלף.' else '' end,
    v_job.property_id
  );

  return jsonb_build_object(
    'success', true,
    'result_url', p_result_url,
    'previous_video_url', v_job.previous_video_url,
    'previous_is_system', coalesce(v_prev_system, false),
    'previous_poster_url', v_prev_poster
  );
end;
$$;
revoke execute on function public.complete_property_video_job(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_property_video_job(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. ההצעה והמצב לבוט
--
-- אותם שינויים כמו בפתיחה: רשימת הסטטוסים הפתוחים, מכסה בלי grok_daily,
-- ו-video_exists רק לסרטון של הסוכן/ת. ‏in_production נוסף כדי שהבוט לא
-- יצטרך לדעת את רשימת הסטטוסים.
-- ---------------------------------------------------------------------------
create or replace function public.agent_property_video_quote(p_agent_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member   public.agency_members%rowtype;
  v_prop     public.properties%rowtype;
  v_tier     text;
  v_price    numeric := 0;
  v_cap      numeric;
  v_used     integer := 0;
  v_images   int := 0;
  v_min      numeric;
  v_open     boolean;
  v_reason   text := null;
  v_system   boolean;
begin
  select * into v_member from public.agency_members
   where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select * into v_prop from public.properties
   where id = p_property_id and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  -- אותה פונקציה שקובעת זכאות בפתיחת הבקשה, ולא העתק של התנאים שלה.
  v_tier := public.property_video_tier(p_property_id, p_agent_id);

  -- ‏`images` הוא text[]. הספירה מדלגת על ריקים ו-null בדיוק כמו
  -- ‏`images.filter(Boolean)` ב-property-video-create.
  select count(*) into v_images
    from unnest(coalesce(v_prop.images, '{}'::text[])) u
   where u is not null and btrim(u) <> '';

  select coalesce(value, 2) into v_min
    from public.pricing_config where key = 'property_video_min_clips';
  v_min := coalesce(v_min, 2);

  v_open := exists (
    select 1 from public.property_video_jobs
     where property_id = p_property_id
       and status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading')
  );

  v_system := public.property_video_is_system(v_prop.video_url);

  if v_tier = 'premium' then
    select coalesce(value, 8) into v_cap
      from public.pricing_config where key = 'property_video_premium_monthly_cap';
    v_cap := coalesce(v_cap, 8);

    select count(*) into v_used
      from public.property_video_jobs
     where agent_id = p_agent_id
       and status <> 'failed'
       and producer is distinct from 'grok_daily'
       and created_at >= date_trunc('month', now());
  elsif v_tier is not null then
    select coalesce(value, 20) into v_price
      from public.pricing_config where key = 'property_video_price_mid';
    v_price := coalesce(v_price, 20);
  end if;

  -- החסימה הראשונה שתתקבל בפועל, באותם קודים ובאותו סדר של
  -- start_property_video_job.
  if v_tier is null then
    v_reason := 'not_eligible';
  elsif v_open then
    v_reason := 'job_in_progress';
  elsif v_images < v_min then
    v_reason := 'not_enough_images';
  elsif v_prop.video_url is not null and not v_system then
    -- אינו חוסם: הוא דורש אישור מפורש להחליף. ראו replace_existing.
    v_reason := 'video_exists';
  elsif v_tier = 'premium' and v_used >= v_cap then
    v_reason := 'monthly_cap_reached';
  elsif v_tier <> 'premium' and coalesce(v_member.credit_balance, 0) < v_price then
    v_reason := 'insufficient_balance';
  end if;

  return jsonb_build_object(
    'success',           true,
    'property_id',       p_property_id,
    'title',             v_prop.title,
    'tier',              v_tier,
    'eligible',          v_tier is not null,
    'price',             v_price,
    'included',          v_tier = 'premium',
    'monthly_cap',       v_cap,
    'monthly_used',      v_used,
    'monthly_left',      case when v_tier = 'premium' then greatest(v_cap - v_used, 0) end,
    'credit_balance',    coalesce(v_member.credit_balance, 0),
    'images',            v_images,
    'min_images',        v_min,
    'has_video',         v_prop.video_url is not null,
    'video_is_system',   v_system,
    'job_in_progress',   v_open,
    'blocker',           v_reason
  );
end;
$$;
revoke execute on function public.agent_property_video_quote(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_property_video_quote(uuid, uuid) to service_role;

create or replace function public.agent_property_video_status(p_agent_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job    public.property_video_jobs;
  v_prop   public.properties%rowtype;
  v_total  int := 0;
  v_done   int := 0;
  v_failed int := 0;
begin
  select * into v_prop from public.properties
   where id = p_property_id and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  select * into v_job from public.property_video_jobs
   where property_id = p_property_id
   order by created_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'success', true, 'has_job', false,
      'title', v_prop.title, 'video_url', v_prop.video_url
    );
  end if;

  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status = 'failed')
    into v_total, v_done, v_failed
    from public.property_video_clips where job_id = v_job.id;

  return jsonb_build_object(
    'success',       true,
    'has_job',       true,
    'title',         v_prop.title,
    'status',        v_job.status,
    'in_production', v_job.status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading'),
    'is_daily_reel', v_job.producer = 'grok_daily',
    'created_at',    v_job.created_at,
    'clips_total',   v_total,
    'clips_done',    v_done,
    'clips_failed',  v_failed,
    'result_url',    v_job.result_url,
    'error_detail',  v_job.error_detail,
    'video_url',     v_prop.video_url
  );
end;
$$;
revoke execute on function public.agent_property_video_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_property_video_status(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. התור של המפיק
-- ---------------------------------------------------------------------------
create or replace function public.producer_heartbeat_touch(p_producer text, p_version text default null, p_status text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.producer_heartbeat (producer, last_seen, version, status)
  values (p_producer, now(), p_version, p_status)
  on conflict (producer) do update
    set last_seen = now(),
        version   = coalesce(excluded.version, public.producer_heartbeat.version),
        status    = coalesce(excluded.status, public.producer_heartbeat.status);
$$;
revoke execute on function public.producer_heartbeat_touch(text, text, text) from public, anon, authenticated;
grant execute on function public.producer_heartbeat_touch(text, text, text) to service_role;

-- הוותיקה ביותר שממתינה. ‏SKIP LOCKED: שני מופעים של המפיק שדוגמים יחד
-- לא יקבלו את אותה בקשה.
create or replace function public.claim_reel_job(p_producer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.property_video_jobs;
  v_listing bigint;
begin
  perform public.producer_heartbeat_touch(p_producer);

  select * into v_job
    from public.property_video_jobs
   where status = 'pending_reel'
   order by created_at
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;

  update public.property_video_jobs
     set status = 'rendering', claimed_by = p_producer, claimed_at = now(),
         heartbeat_at = now(), updated_at = now()
   where id = v_job.id;

  select listing_number into v_listing from public.properties where id = v_job.property_id;

  return jsonb_build_object(
    'job_id',             v_job.id,
    'property_id',        v_job.property_id,
    'agent_id',           v_job.agent_id,
    'listing_number',     v_listing,
    'aspect_ratio',       v_job.aspect_ratio,
    'previous_video_url', v_job.previous_video_url
  );
end;
$$;
revoke execute on function public.claim_reel_job(text) from public, anon, authenticated;
grant execute on function public.claim_reel_job(text) to service_role;

create or replace function public.reel_job_heartbeat(p_job_id uuid, p_producer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  update public.property_video_jobs
     set heartbeat_at = now(), updated_at = now()
   where id = p_job_id and status = 'rendering' and claimed_by = p_producer;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error', 'not_owner');
  end if;
  perform public.producer_heartbeat_touch(p_producer);
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function public.reel_job_heartbeat(uuid, text) from public, anon, authenticated;
grant execute on function public.reel_job_heartbeat(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. הרילס היומי
--
-- נשמר כסרטון של הנכס רק כשאין סרטון, או כשהקיים הוא של המערכת ואינו
-- רילס שהסוכן/ת הזמין/ה (כלומר Kling ישן, או רילס יומי קודם). בקשה פתוחה
-- של הסוכן/ת גם היא עוצרת: היא ממילא תחליף אותו בעוד דקות.
--
-- השורה ב-property_video_jobs היא לתיעוד: done, ‏0 ₪, ‏grok_daily - ולכן
-- אינה פתוחה (אינה חוסמת הזמנה) ואינה נספרת במכסה.
-- ---------------------------------------------------------------------------
create or replace function public.attach_daily_reel(
  p_property_id uuid,
  p_result_url  text,
  p_cover_url   text,
  p_published   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop        public.properties%rowtype;
  v_agent_reel  boolean;
  v_job_id      uuid;
  v_links       text := '';
  v_item        record;
begin
  select * into v_prop from public.properties where id = p_property_id for update;
  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;
  if v_prop.agent_id is null then
    return jsonb_build_object('error', 'no_agent');
  end if;

  if exists (
    select 1 from public.property_video_jobs
     where property_id = p_property_id
       and status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading')
  ) then
    return jsonb_build_object('attached', false, 'reason', 'job_in_progress');
  end if;

  if v_prop.video_url is not null then
    v_agent_reel :=
      (v_prop.video_url ~ '/marketing-reel-[^/?]*(\?.*)?$' and v_prop.video_url !~ '/marketing-reel-daily-[^/?]*(\?.*)?$')
      or exists (
        select 1 from public.property_video_jobs
         where status = 'done' and result_url = v_prop.video_url
           and producer in ('grok_reel', 'site_reel')
      );
    if v_agent_reel or not public.property_video_is_system(v_prop.video_url) then
      return jsonb_build_object('attached', false, 'reason', 'agent_video_exists');
    end if;
  end if;

  update public.properties
     set video_url = p_result_url, video_poster_url = p_cover_url
   where id = p_property_id;

  insert into public.property_video_jobs (
    property_id, agent_id, status, tier_at_request, amount_charged, clip_seconds,
    aspect_ratio, previous_video_url, replaced_existing, producer, template,
    claimed_by, result_url, cover_url, published_urls
  ) values (
    p_property_id, v_prop.agent_id, 'done', 'daily', 0, 0,
    '9:16', v_prop.video_url, v_prop.video_url is not null, 'grok_daily', 'D',
    'grok_daily', p_result_url, p_cover_url, p_published
  )
  returning id into v_job_id;

  -- הקישורים לפרסומים, אחד בשורה. רק http(s), ורק מחרוזות.
  if jsonb_typeof(p_published) = 'object' then
    for v_item in select key, value from jsonb_each(p_published) loop
      if jsonb_typeof(v_item.value) = 'string' and (v_item.value #>> '{}') ~ '^https?://' then
        v_links := v_links || E'\n' || v_item.key || ': ' || (v_item.value #>> '{}');
      end if;
    end loop;
  elsif jsonb_typeof(p_published) = 'array' then
    for v_item in select value from jsonb_array_elements(p_published) loop
      if jsonb_typeof(v_item.value) = 'string' and (v_item.value #>> '{}') ~ '^https?://' then
        v_links := v_links || E'\n' || (v_item.value #>> '{}');
      end if;
    end loop;
  end if;

  insert into public.notifications (agent_id, type, title, body, related_property_id)
  values (
    v_prop.agent_id,
    'marketing_copy',
    'רילס חדש לנכס: ' || coalesce(v_prop.title, 'נכס'),
    'הכנו לנכס שלך רילס שיווקי ופרסמנו אותו בעמודי שוק הנדל״ן. הוא שמור עכשיו בדף הנכס.' || v_links,
    p_property_id
  );

  return jsonb_build_object(
    'attached', true,
    'job_id', v_job_id,
    'previous_video_url', v_prop.video_url,
    'previous_poster_url', v_prop.video_poster_url
  );
end;
$$;
revoke execute on function public.attach_daily_reel(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.attach_daily_reel(uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 10. ה-reconcile מתעורר גם בשביל רילסים
--
-- אותה צורה כמו 20261021090000 (יורה רק כשיש בקשה פתוחה), עם שני
-- הסטטוסים החדשים, ועם תקרת ה-30 שניות של 20261030090000.
-- ---------------------------------------------------------------------------
do $$
declare
  v_base text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/';
begin
  perform cron.unschedule('property-video-reconcile')
    where exists (select 1 from cron.job where jobname = 'property-video-reconcile');

  perform cron.schedule('property-video-reconcile', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where exists (
      select 1 from public.property_video_jobs
       where status in ('pending_reel', 'rendering', 'generating_clips', 'merging', 'uploading')
    );
  $cron$, v_base || 'property-video-callback?mode=reconcile'));
end $$;

-- ============================================================================
-- הפקת סרטון שיווקי לנכס מתוך התמונות שלו
--
-- הסוכן/ת לוחץ/ת על כפתור בכרטיס הנכס ב-CRM, התמונות של הנכס נשלחות ל-fal.ai
-- שהופך כל אחת לקליפ קצר בתנועת מצלמה (רחפן/דולי), הקליפים מחוברים לרצף אחד
-- של 15-20 שניות, והקובץ נשמר בדלי ‎property-videos‎ ונכתב ל-‎properties.video_url‎.
--
-- שלוש החלטות שכדאי להכיר לפני שנוגעים כאן:
--
--   1. **הסרטון נכנס לשקע הקיים ולא לשדה חדש.** ל-‎properties‎ יש ‎video_url‎
--      אחת, ודף הנכס כבר יודע לנגן אותה (‎videoEmbed()‎ מזהה ‎.mp4‎ ומרנדר
--      ‎<video>‎). עמודה שנייה "לסרטון מיוצר" הייתה מכריחה את דף הנכס, את
--      כרטיס הנכס ואת הייצוא לפייסבוק להחליט בין שני מקורות — בלי שאף אחד
--      ביקש שני סרטונים. לכן ההפקה ממלאת נכס בלי סרטון, או **מחליפה**
--      סרטון קיים לפי בקשה מפורשת (‎replace_existing‎). ‎previous_video_url‎
--      נשמר על הבקשה כדי שאפשר יהיה למחוק את הקובץ הישן רק אחרי שהחדש עלה
--      בהצלחה, ולא רגע לפני.
--
--   2. **שתי דרגות, שני מסלולי תשלום.** ‏Premium מפיק/ה בלי חיוב עד תקרה
--      חודשית (‎property_video_premium_monthly_cap‎), כי הסרטון הוא חלק
--      מהחבילה; ‏MID קונה סרטון בודד ב-‎property_video_price_mid‎ (₪20)
--      מהארנק, בדיוק כמו קידום נכס. ‏free לא מקבל/ת את הכפתור בכלל. החיוב
--      נגבה **מראש** ב-‎start_property_video_job‎ ולא בסוף: הקריאה ל-fal
--      עולה כסף ברגע שהיא נשלחת, וחיוב בדיעבד היה מאפשר להפיק סרטונים עם
--      ארנק ריק. הצד השני של זה הוא ‎refund_property_video_job‎ — בקשה
--      שנכשלה מזכה את הארנק חזרה אוטומטית.
--
--   3. **מכונת מצבים ולא פונקציה ארוכה.** יצירת 4 קליפים ב-fal לוקחת דקות,
--      והרבה מעבר לתקרת הזמן של Edge Function. לכן הבקשה נשלחת ל-fal עם
--      ‎webhook‎, וכל קליפ שמסתיים מקדם את השורה שלו כאן; כשכל הקליפים
--      מוכנים נשלחת בקשת המיזוג, וכשהיא חוזרת הקובץ עולה לאחסון. ‎status‎
--      על ‎property_video_jobs‎ הוא המצב, ולא משתנה בזיכרון של איזו פונקציה.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. תמחור והגדרות
--
-- כמו בכל שאר המנגנונים כאן, המספרים יושבים ב-pricing_config ולא בקוד: שינוי
-- מחיר או אורך סרטון הוא ‎update‎ אחד, בלי פריסה מחדש של Edge Function.
--
-- ‏property_video_clip_count × property_video_clip_seconds הוא אורך הסרטון:
-- ‏4 × 5 = 20 שניות. נכס עם פחות תמונות מתאימות מקבל פחות קליפים, ולכן
-- ‎property_video_min_clips‎ קובע את הרצפה — שני קליפים (10 שניות) הם
-- המינימום שעוד נראה כמו סרטון ולא כמו תקלה.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('property_video_price_mid', 20,
   'מחיר הפקת סרטון שיווקי לנכס לסוכן/ת בדרגת mid, בשקלים. Premium מפיק/ה בלי חיוב עד התקרה החודשית.'),
  ('property_video_premium_monthly_cap', 8,
   'כמה סרטונים בחודש קלנדרי סוכן/ת Premium מפיק/ה בלי חיוב. מעבר לזה הכפתור חסום.'),
  ('property_video_clip_count', 4,
   'כמה קליפים מרכיבים סרטון. יחד עם property_video_clip_seconds זהו אורך הסרטון.'),
  ('property_video_clip_seconds', 5,
   'אורך כל קליפ בשניות, כפי שנשלח ל-fal.'),
  ('property_video_min_clips', 2,
   'מתחת למספר הזה של תמונות מתאימות הבקשה נדחית ולא נוצר סרטון קצר מדי.')
on conflict (key) do update set description = excluded.description;

-- ---------------------------------------------------------------------------
-- 2. הבקשה
--
-- ‏webhook_token הוא הרשאת הגישה של ה-callback: fal קורא/ת לכתובת ציבורית
-- (‎verify_jwt = false‎), ובלי סוד בכתובת כל מי שינחש ‎job_id‎ היה יכול/ה
-- לסמן בקשה כמוכנה עם כתובת וידאו משלו. הטוקן נוצר בצד ה-Edge Function
-- ומושווה כאן בהשוואה מלאה.
--
-- ‏fal_merge_request_id נשמר כדי שה-reconcile יוכל לשאול את fal מה קרה
-- לבקשת מיזוג שה-webhook שלה אבד.
-- ---------------------------------------------------------------------------
create table if not exists public.property_video_jobs (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references public.properties(id) on delete cascade,
  agent_id              uuid not null references public.agency_members(id) on delete cascade,
  status                text not null default 'generating_clips'
                          check (status in ('generating_clips','merging','uploading','done','failed')),
  tier_at_request       text not null,
  amount_charged        numeric not null default 0,
  refunded              boolean not null default false,
  clip_seconds          integer not null default 5,
  aspect_ratio          text    not null default '16:9',
  webhook_token         text not null,
  fal_merge_request_id  text,
  result_url            text,
  previous_video_url    text,
  replaced_existing     boolean not null default false,
  error_detail          text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.property_video_jobs is
  'בקשת הפקת סרטון שיווקי לנכס. שורה אחת לכל לחיצה על הכפתור ב-CRM.';
comment on column public.property_video_jobs.previous_video_url is
  'הסרטון שהיה על הנכס לפני ההפקה. הקובץ הישן נמחק רק אחרי שהחדש נשמר בהצלחה, ולכן הכתובת נשמרת עד אז.';
comment on column public.property_video_jobs.amount_charged is
  'מה שחויב בפועל בזמן הבקשה. לא נגזר מחדש מ-pricing_config, כדי שהיסטוריית החיובים תישאר נאמנה.';

create index if not exists idx_property_video_jobs_property
  on public.property_video_jobs (property_id, created_at desc);
create index if not exists idx_property_video_jobs_agent_created
  on public.property_video_jobs (agent_id, created_at desc);
-- ה-reconcile סורק לפי סטטוס פתוח וגיל, ולכן זה האינדקס שהוא צריך
create index if not exists idx_property_video_jobs_open
  on public.property_video_jobs (status, updated_at)
  where status in ('generating_clips','merging','uploading');

-- בקשה פתוחה אחת לכל נכס. בלי זה לחיצה כפולה על הכפתור מייצרת שתי בקשות,
-- שתיהן מחייבות את הארנק ושתיהן כותבות ל-video_url — והאחרונה מנצחת.
create unique index if not exists uniq_property_video_job_open
  on public.property_video_jobs (property_id)
  where status in ('generating_clips','merging','uploading');

-- ---------------------------------------------------------------------------
-- 3. הקליפים
--
-- שורה לכל תמונת מקור. ‎idx‎ הוא סדר ההופעה בסרטון הסופי ולא סדר הסיום —
-- ‏fal מחזיר/ה קליפים בסדר אקראי, והמיזוג חייב לקבל אותם לפי ‎idx‎ אחרת
-- הסרטון נפתח במטבח ונגמר בחזית.
-- ---------------------------------------------------------------------------
create table if not exists public.property_video_clips (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.property_video_jobs(id) on delete cascade,
  idx              integer not null,
  target           text,
  source_image_url text not null,
  prompt           text not null,
  fal_request_id   text,
  clip_url         text,
  status           text not null default 'pending'
                     check (status in ('pending','done','failed')),
  error_detail     text,
  created_at       timestamptz not null default now()
);

comment on table public.property_video_clips is
  'קליפ בודד בתוך סרטון שיווקי. idx קובע את סדר ההופעה ברצף הסופי.';

create unique index if not exists uniq_property_video_clip_idx
  on public.property_video_clips (job_id, idx);
create index if not exists idx_property_video_clips_job
  on public.property_video_clips (job_id);
-- ה-callback מאתר קליף לפי מזהה הבקשה של fal
create index if not exists idx_property_video_clips_fal
  on public.property_video_clips (fal_request_id)
  where fal_request_id is not null;

-- ---------------------------------------------------------------------------
-- 4. היסטוריית חיובים
--
-- אותה דוקטרינה כמו ‎promotion_charges‎: החיוב חי בטבלה משלו ולא רק כשדה על
-- הבקשה, כדי שמסך ההכנסות ופירוט הארנק יוכלו לקרוא את כל החיובים ממקום אחד.
-- ‏status עובר ל-'refunded' כשבקשה נכשלת.
-- ---------------------------------------------------------------------------
create table if not exists public.property_video_charges (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.property_video_jobs(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  agent_id    uuid not null references public.agency_members(id) on delete cascade,
  amount      numeric not null,
  status      text not null default 'charged' check (status in ('charged','refunded')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_property_video_charges_agent
  on public.property_video_charges (agent_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. זכאות
--
-- מקור אמת אחד ל"מי רשאי/ת להפיק", בדיוק כמו ‎property_visualizations_enabled‎:
-- גם ה-Edge Function וגם ה-CRM נשענים עליו, ולכן אין שתי הגדרות שונות.
--
-- הבדל מההדמיות: כאן גם ‏mid זכאי/ת — בתשלום. הפונקציה מחזירה את הדרגה ולא
-- ‎boolean‎, כי המחיר נגזר ממנה.
-- ---------------------------------------------------------------------------
create or replace function public.property_video_tier(p_property_id uuid, p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.tier
  from public.properties p
  join public.agency_members m on m.id = p.agent_id
  where p.id = p_property_id
    and p.agent_id = p_agent_id
    and p.status = 'active'
    and m.active = true
    and m.billing_status = 'active'
    and m.tier in ('mid', 'premium');
$$;

comment on function public.property_video_tier(uuid, uuid) is
  'הדרגה שלפיה מתומחרת הפקת סרטון לנכס, או NULL כשאין זכאות. mid = בתשלום, premium = כלול.';

-- ---------------------------------------------------------------------------
-- 6. פתיחת בקשה — הזכאות, התקרה והחיוב במקום אחד
--
-- הכל בפונקציה אחת ולא בכמה קריאות מה-Edge Function, כי חיוב ופתיחת בקשה
-- חייבים להיות אטומיים: קריאה נפרדת ל"חייב" ואז ל"פתח" הייתה יכולה לחייב
-- ארנק בלי שנפתחה בקשה, אם השנייה נכשלת.
--
-- ‎p_replace_existing‎ הוא אישור מפורש להחליף סרטון קיים. בלעדיו נכס שכבר יש
-- לו סרטון מקבל ‎video_exists‎ ולא נדרס בשקט — הסרטון הקיים יכול להיות סיור
-- שהסוכן/ת צילם/ה בעצמו/ה, והוא לא נמחק בלי שנשאל/ה.
-- ---------------------------------------------------------------------------
create or replace function public.start_property_video_job(
  p_property_id      uuid,
  p_agent_id         uuid,
  p_webhook_token    text,
  p_clip_seconds     integer,
  p_aspect_ratio     text,
  p_replace_existing boolean default false
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
begin
  v_tier := public.property_video_tier(p_property_id, p_agent_id);
  if v_tier is null then
    return jsonb_build_object('error', 'not_eligible');
  end if;

  -- בקשה פתוחה על אותו נכס — הכפתור כבר נלחץ והסרטון בדרך
  if exists (
    select 1 from public.property_video_jobs
    where property_id = p_property_id
      and status in ('generating_clips','merging','uploading')
  ) then
    return jsonb_build_object('error', 'job_in_progress');
  end if;

  select video_url into v_video from public.properties where id = p_property_id;
  if v_video is not null and not p_replace_existing then
    return jsonb_build_object('error', 'video_exists', 'video_url', v_video);
  end if;

  if v_tier = 'premium' then
    -- התקרה נספרת על בקשות שלא נכשלו: בקשה שנכשלה לא צרכה מכסה, בדיוק כפי
    -- שהיא לא חייבה ארנק.
    select coalesce(value, 8) into v_cap
    from public.pricing_config where key = 'property_video_premium_monthly_cap';
    v_cap := coalesce(v_cap, 8);

    select count(*) into v_used
    from public.property_video_jobs
    where agent_id = p_agent_id
      and status <> 'failed'
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
    clip_seconds, aspect_ratio, webhook_token, previous_video_url, replaced_existing
  ) values (
    p_property_id, p_agent_id, 'generating_clips', v_tier, v_charged,
    coalesce(p_clip_seconds, 5), coalesce(p_aspect_ratio, '16:9'),
    p_webhook_token, v_video, (v_video is not null)
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
    'previous_video_url', v_video
  );
end;
$$;

comment on function public.start_property_video_job(uuid, uuid, text, integer, text, boolean) is
  'פותחת בקשת הפקת סרטון וגובה את התשלום באותה טרנזקציה. ל-service_role בלבד, דרך property-video-create.';

revoke all on function public.start_property_video_job(uuid, uuid, text, integer, text, boolean) from public;
revoke all on function public.start_property_video_job(uuid, uuid, text, integer, text, boolean) from anon;
revoke all on function public.start_property_video_job(uuid, uuid, text, integer, text, boolean) from authenticated;
grant execute on function public.start_property_video_job(uuid, uuid, text, integer, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7. כישלון והחזר
--
-- בקשה שנכשלה מזכה את הארנק חזרה. ‎refunded‎ מונע/ת החזר כפול: ה-reconcile
-- וה-callback יכולים שניהם להגיע לאותה בקשה, ורק אחד מהם ישלם.
-- ---------------------------------------------------------------------------
create or replace function public.fail_property_video_job(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job     public.property_video_jobs;
  v_refund  numeric := 0;
begin
  select * into v_job from public.property_video_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('error', 'job_not_found');
  end if;
  if v_job.status = 'done' then
    return jsonb_build_object('error', 'already_done');
  end if;

  if v_job.status <> 'failed' then
    update public.property_video_jobs
       set status = 'failed', error_detail = p_reason, updated_at = now()
     where id = p_job_id;
  end if;

  if v_job.amount_charged > 0 and not v_job.refunded then
    update public.agency_members
       set credit_balance = credit_balance + v_job.amount_charged
     where id = v_job.agent_id;

    update public.property_video_jobs set refunded = true where id = p_job_id;
    update public.property_video_charges
       set status = 'refunded'
     where job_id = p_job_id and status = 'charged';

    v_refund := v_job.amount_charged;
  end if;

  return jsonb_build_object('success', true, 'refunded', v_refund);
end;
$$;

comment on function public.fail_property_video_job(uuid, text) is
  'מסמנת בקשת סרטון ככושלת ומזכה את הארנק. אידמפוטנטית — החזר יוצא פעם אחת בלבד.';

revoke all on function public.fail_property_video_job(uuid, text) from public;
revoke all on function public.fail_property_video_job(uuid, text) from anon;
revoke all on function public.fail_property_video_job(uuid, text) from authenticated;
grant execute on function public.fail_property_video_job(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. סיום מוצלח
--
-- כתיבת ‎video_url‎ והשלמת הבקשה באותה טרנזקציה, כדי שלא ייווצר מצב שבו
-- הבקשה ‎done‎ אבל הנכס בלי סרטון (או להפך).
-- ---------------------------------------------------------------------------
create or replace function public.complete_property_video_job(p_job_id uuid, p_result_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.property_video_jobs;
begin
  select * into v_job from public.property_video_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('error', 'job_not_found');
  end if;
  if v_job.status = 'done' then
    return jsonb_build_object('success', true, 'already_done', true, 'result_url', v_job.result_url);
  end if;

  update public.properties set video_url = p_result_url where id = v_job.property_id;

  update public.property_video_jobs
     set status = 'done', result_url = p_result_url, error_detail = null, updated_at = now()
   where id = p_job_id;

  return jsonb_build_object(
    'success', true,
    'result_url', p_result_url,
    'previous_video_url', v_job.previous_video_url
  );
end;
$$;

revoke all on function public.complete_property_video_job(uuid, text) from public;
revoke all on function public.complete_property_video_job(uuid, text) from anon;
revoke all on function public.complete_property_video_job(uuid, text) from authenticated;
grant execute on function public.complete_property_video_job(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. מעקב מה-CRM
--
-- ה-‎job_id‎ הוא הרשאת הגישה, כמו ב-‎visualization_job_status‎: מי שפתח/ה את
-- הבקשה מחזיק/ה בו, ואין בתשובה שום דבר שאינו על הנכס שלו/ה ממילא.
-- ‏clips_done/clips_total מזינים את מד ההתקדמות.
-- ---------------------------------------------------------------------------
create or replace function public.property_video_job_status(p_job_id uuid)
returns table (
  status       text,
  result_url   text,
  error_detail text,
  clips_total  integer,
  clips_done   integer,
  clips_failed integer,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.status,
    j.result_url,
    j.error_detail,
    (select count(*)::int from public.property_video_clips c where c.job_id = j.id),
    (select count(*)::int from public.property_video_clips c where c.job_id = j.id and c.status = 'done'),
    (select count(*)::int from public.property_video_clips c where c.job_id = j.id and c.status = 'failed'),
    j.created_at
  from public.property_video_jobs j
  where j.id = p_job_id;
$$;

grant execute on function public.property_video_job_status(uuid) to authenticated;
grant execute on function public.property_video_job_status(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. RLS
--
-- הטבלאות נכתבות אך ורק על ידי ה-Edge Functions ב-service_role (שעוקף RLS).
-- מה שנפתח כאן הוא **קריאה בלבד**, ורק לסוכן/ת שהבקשה שלו/ה — כדי שה-CRM
-- יוכל להציג היסטוריית הפקות ויתרת מכסה בלי Edge Function נוספת.
-- ---------------------------------------------------------------------------
alter table public.property_video_jobs    enable row level security;
alter table public.property_video_clips   enable row level security;
alter table public.property_video_charges enable row level security;

drop policy if exists "agent reads own video jobs" on public.property_video_jobs;
create policy "agent reads own video jobs"
  on public.property_video_jobs for select to authenticated
  using (
    exists (
      select 1 from public.agency_members m
      where m.id = property_video_jobs.agent_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "agent reads own video clips" on public.property_video_clips;
create policy "agent reads own video clips"
  on public.property_video_clips for select to authenticated
  using (
    exists (
      select 1
      from public.property_video_jobs j
      join public.agency_members m on m.id = j.agent_id
      where j.id = property_video_clips.job_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "agent reads own video charges" on public.property_video_charges;
create policy "agent reads own video charges"
  on public.property_video_charges for select to authenticated
  using (
    exists (
      select 1 from public.agency_members m
      where m.id = property_video_charges.agent_id
        and m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 11. תזמון ה-reconcile
--
-- אותה תבנית כמו property-marketing-publish (‏§8 במיגרציה 20260906092000):
-- ‏pg_cron קורא ל-Edge Function דרך pg_net, והסוד ל-header נקרא מ-Vault.
--
-- **זה לא ניקיון תקופתי — זו הרשת שמחזיקה את ההוגנות של החיוב.** ‏webhook
-- שאבד משאיר בקשה תקועה, ואיתה את ₪20 של סוכן/ת MID. ה-reconcile הוא מה
-- שמבטיח שכל בקשה מגיעה בסוף ל-done או ל-failed, ו-failed מזכה את הארנק.
-- בלעדיו הבקשה גם חוסמת את הנכס מהפקה חדשה, כי יש אינדקס ייחודי על בקשה
-- פתוחה אחת לנכס.
--
-- כל חמש דקות: ההפקה עצמה נמשכת דקות בודדות, ובקשה נחשבת תקועה רק אחרי
-- 30 דקות (‎STALE_MINUTES‎ בפונקציה), ולכן זה קצב שמגיב מהר בלי להעיר את
-- fal לחינם.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/property-video-callback?mode=reconcile';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את property-video-callback?mode=reconcile בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('property-video-reconcile')
    where exists (select 1 from cron.job where jobname = 'property-video-reconcile');

  perform cron.schedule('property-video-reconcile', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    );
  $cron$, v_url));
end;
$$;

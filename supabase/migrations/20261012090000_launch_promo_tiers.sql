-- ============================================================================
-- הטבת ההשקה: Elite חינם לחצי שנה, ובחירת מסלול בידי הסוכן/ת עצמו/ה
-- ----------------------------------------------------------------------------
-- שני שינויים שנכנסים יחד, כי הם אותו מהלך:
--
--   1. **המסלול נבחר בידי מי שמשלם עליו.** עד היום מנהל/ת המשרד בחר/ה
--      "מסלול התחלתי" בטופס ההזמנה, והסוכן/ת גילה/תה מה נבחר עבורו/ה רק
--      מהתגית בכותרת. עכשיו ההזמנה לא נושאת מסלול כלל: הסוכן/ת נכנס/ת,
--      משויך/ת אוטומטית למשרד שהזמין, ובוחר/ת מסלול בעצמו/ה.
--
--   2. **תקופת ההשקה.** כל מצטרף/ת חדש/ה מקבל/ת את Elite (‏premium) ללא
--      תשלום ל-6 חודשים, ובשלב הבחירה אין בכלל אפשרות לרדת למסלול נמוך
--      יותר. חודש לפני הסיום ושבועיים אחריו נשלחות שתי התראות, ובתום
--      התקופה מי שלא בחר/ה מסלול עובר/ת ל-Pay&GO (‏free).
--
-- **המזהים במסד לא השתנו.** ‏free/mid/premium נשארים כמו שהם; Pay&GO,
-- PROFESSIONAL ו-Elite הם שמות תצוגה בלבד (‏assets/tiers.js). כל הגייטינג
-- של היכולות בתשלום — ‎cma_report‎, ‎property_video_tier‎, ההדמיות, המידע
-- התכנוני — משווה למחרוזות האלה בעשרות מקומות, ושינוי שלהן הוא סיכון בלי
-- תמורה.
--
-- אידמפוטנטית במלואה: ‎add column if not exists‎, ‎create or replace‎, בדיקת
-- קיום לפני כל constraint ולפני התזמון. הרצה חוזרת היא no-op.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות
--
-- ‏tier_selected_at הוא הלב: הוא מבדיל בין "המסלול שיושב על השורה" לבין
-- "המסלול שהאדם בחר". בלעדיו אי אפשר לענות על השאלה היחידה שסיום ההטבה
-- שואל — האם צריך להוריד את השורה הזו ל-Pay&GO, או שכבר נבחר משהו אחר.
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists tier_selected_at   timestamptz,
  add column if not exists tier_source        text,
  add column if not exists promo_tier         text,
  add column if not exists promo_started_at   timestamptz,
  add column if not exists promo_ends_at      timestamptz,
  add column if not exists promo_notice_1_at  timestamptz,
  add column if not exists promo_notice_2_at  timestamptz,
  add column if not exists promo_ended_at     timestamptz;

comment on column public.agency_members.tier_selected_at is
  'מתי הסוכן/ת בחר/ה מסלול בעצמו/ה. NULL = טרם בחר/ה — וזה מי שעובר/ת ל-free בתום הטבת ההשקה.';
comment on column public.agency_members.tier_source is
  'מי קבע את המסלול: launch_promo / self / signup / promo_expired / platform_admin.';
comment on column public.agency_members.promo_ends_at is
  'סוף הטבת ההשקה. promo-lifecycle סורק/ת את העמודה הזו — התראות לפני, שינוי מסלול אחרי.';
comment on column public.agency_members.promo_ended_at is
  'מתי ההטבה נסגרה בפועל (התראת הסיום נשלחה, והמסלול יושר). מונע טיפול כפול.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_promo_tier_check') then
    alter table public.agency_members
      add constraint agency_members_promo_tier_check
      check (promo_tier is null or promo_tier in ('free', 'mid', 'premium'));
  end if;
end $$;

-- הסריקה היומית שואלת "למי ההטבה נגמרת בקרוב". בלי האינדקס היא סורקת את
-- כל הטבלה, וזה בסדר גמור היום — ויקר בדיוק כשהמצטרפים יגיעו.
create index if not exists agency_members_promo_ends_at_idx
  on public.agency_members (promo_ends_at)
  where promo_ends_at is not null and promo_ended_at is null;

-- ---------------------------------------------------------------------------
-- 2. יומן שינויי המסלול
--
-- מסלול הוא שדה כספי: ההפרש בין Pay&GO ל-Elite הוא ₪950 בחודש. שינוי שלו
-- בלי תיעוד הוא בדיוק סוג הדבר שאי אפשר לשחזר שלושה חודשים אחרי, כשמישהו
-- שואל "מתי היא עברה ל-Elite ומי אישר". השורות נכתבות משרת בלבד.
-- ---------------------------------------------------------------------------
create table if not exists public.tier_changes (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.agency_members(id) on delete cascade,
  agency_id   uuid references public.agencies(id) on delete set null,
  from_tier   text,
  to_tier     text not null,
  source      text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists tier_changes_member_idx on public.tier_changes (member_id, created_at desc);

alter table public.tier_changes enable row level security;

-- קריאה בלבד, ורק על עצמך. הכתיבה כולה service_role — אין מדיניות
-- insert/update/delete בכוונה, בדיוק כמו ב-agency_invitations.
drop policy if exists "member reads own tier changes" on public.tier_changes;
create policy "member reads own tier changes" on public.tier_changes
  for select to authenticated
  using (
    exists (
      select 1 from public.agency_members m
      where m.id = tier_changes.member_id and m.user_id = (select auth.uid())
    )
    or public.current_is_platform_admin()
  );

comment on table public.tier_changes is
  'יומן שינויי מסלול ובקשות שדרוג. נכתב ב-record_tier_selection, ב-grant_launch_promo, ב-expire_launch_promos ומ-join-agency (source=''requested'') בלבד.';

-- ---------------------------------------------------------------------------
-- 3. נעילת השדות החדשים מול הדפדפן
--
-- ‏tier כבר נעול בטריגר הזה, ובלי הנעילה של השדות החדשים כל ההגנה עוקפת:
-- שורת ‎update‎ אחת מה-console שדוחפת ‎promo_ends_at‎ עשר שנים קדימה שווה
-- בדיוק ל-‎update‎ שמשנה ‎tier‎ ל-premium.
--
-- הפונקציה משוכפלת במלואה מ-20260903120000 ולא "מתוקנת" — create or replace
-- מחליף את הגוף כולו, ולכן הגרסה כאן חייבת להיות שלמה.
-- ---------------------------------------------------------------------------
create or replace function public.protect_sensitive_agency_member_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- ‏coalesce מבטיח true/false ולעולם לא NULL
  is_self boolean := coalesce(
    old.user_id is not null and old.user_id = (select auth.uid()),
    false
  );
  -- הקשר מנהלתי: מיגרציה, SQL Editor או Edge Function. נקבע לפי תפקיד ה-DB
  -- בפועל, שדפדפן לא יכול להתחזות אליו
  is_privileged boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
                           or auth.role() = 'service_role';
begin
  if is_privileged then
    return new;
  end if;
  new.credit_balance := old.credit_balance;
  new.tier := old.tier;
  new.free_quota_used := old.free_quota_used;
  new.free_quota_cycle_start := old.free_quota_cycle_start;
  new.payment_token_id := old.payment_token_id;
  new.billing_status := old.billing_status;
  new.pending_tier_change := old.pending_tier_change;
  new.pending_tier_change_at := old.pending_tier_change_at;
  new.subscription_id := old.subscription_id;
  new.is_platform_admin := old.is_platform_admin; -- נעול לחלוטין, גם למנהל משרד רגיל
  new.is_mortgage_advisor := old.is_mortgage_advisor; -- נעול לחלוטין — מנהל/ת הפלטפורמה בלבד
  new.ethics_badge_revoked_at := old.ethics_badge_revoked_at; -- הסרת תו: הנהלת הפלטפורמה בלבד

  -- בחירת המסלול והטבת ההשקה — דרך join-agency ו-promo-lifecycle בלבד.
  -- אלה שדות כסף: מי שיכול/ה לכתוב אותם מהדפדפן יכול/ה להאריך לעצמו/ה
  -- חצי שנה חינם, או לסמן בחירה שלא נעשתה.
  new.tier_selected_at := old.tier_selected_at;
  new.tier_source := old.tier_source;
  new.promo_tier := old.promo_tier;
  new.promo_started_at := old.promo_started_at;
  new.promo_ends_at := old.promo_ends_at;
  new.promo_notice_1_at := old.promo_notice_1_at;
  new.promo_notice_2_at := old.promo_notice_2_at;
  new.promo_ended_at := old.promo_ended_at;

  -- ניתוק מהמשרד — דרך release-team-member בלבד
  new.released_at := old.released_at;
  new.released_from_agency_id := old.released_from_agency_id;
  new.released_by := old.released_by;

  if not is_self or new.license_number is null or btrim(new.license_number) = '' then
    new.license_number := old.license_number;
  end if;

  -- אישור הקוד האתי — אישי בלבד, והחותמת נקבעת בשרת
  if not is_self then
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
    new.ethics_code_version := old.ethics_code_version;
  elsif new.ethics_code_accepted_at is null then
    new.ethics_code_version := null;               -- ביטול אישור מנקה גם את הגרסה
  elsif old.ethics_code_accepted_at is null
        or new.ethics_code_version is distinct from old.ethics_code_version then
    new.ethics_code_accepted_at := now();          -- אישור חדש (או לגרסה חדשה) — עכשיו
  else
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
  end if;

  if is_self then
    new.role := old.role;
    new.active := old.active;
    new.agency_id := old.agency_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. הענקת ההטבה
--
-- נקראת בשלוש נקודות הכניסה למערכת — שיוך לפי הזמנה (‏join-agency), פתיחת
-- משרד מתוך חשבון קיים (‏create-own-agency) והרשמת משרד חדש (‏agency-signup)
-- — ולכן היא **חייבת** להיות אידמפוטנטית ולא להסתמך על מי קרא לה: קריאה
-- שנייה על אותה שורה מחזירה את מה שכבר ניתן, בלי להאריך את התקופה.
--
-- שלוש נסיבות שבהן היא לא מעניקה כלום:
--   • ההטבה כבר ניתנה (‏promo_started_at לא ריק) — כולל אחרי שהסתיימה.
--   • הסוכן/ת כבר בחר/ה מסלול בעצמו/ה.
--   • השורה נושאת מסלול בתשלום שלא בא מההטבה — שדרוג ששולם עליו לא נמחק
--     על ידי מתנה.
-- ---------------------------------------------------------------------------
--
-- שמות עמודות ההחזרה (‏result_tier, ‏ends_at) נבחרו כך שלא יתנגשו בשמות
-- עמודות בטבלה: ב-plpgsql פרמטר יוצא בשם ‎tier‎ הופך כל אזכור לא-מוסמך של
-- העמודה ‎tier‎ לשגיאת "column reference is ambiguous" — בזמן ריצה, לא בזמן
-- יצירה. אותה זהירות חלה על שתי הפונקציות הבאות.
create or replace function public.grant_launch_promo(
  p_member_id uuid,
  p_tier      text default 'premium',
  p_months    int  default 6
)
returns table (granted boolean, result_tier text, ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.agency_members%rowtype;
  v_ends   timestamptz;
begin
  if p_tier not in ('free', 'mid', 'premium') then
    raise exception 'invalid promo tier: %', p_tier;
  end if;

  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  if v_member.promo_started_at is not null
     or v_member.tier_selected_at is not null
     or v_member.tier <> 'free' then
    return query select false, v_member.tier, v_member.promo_ends_at;
    return;
  end if;

  v_ends := now() + make_interval(months => p_months);

  update public.agency_members
     set tier             = p_tier,
         tier_source      = 'launch_promo',
         promo_tier       = p_tier,
         promo_started_at = now(),
         promo_ends_at    = v_ends
   where id = p_member_id;

  insert into public.tier_changes (member_id, agency_id, from_tier, to_tier, source, note)
  values (p_member_id, v_member.agency_id, v_member.tier, p_tier, 'launch_promo',
          format('הטבת השקה — %s חודשים עד %s', p_months, to_char(v_ends, 'DD/MM/YYYY')));

  return query select true, p_tier, v_ends;
end;
$$;

comment on function public.grant_launch_promo(uuid, text, int) is
  'מעניקה את מסלול ההשקה לשורה שטרם קיבלה אותו. אידמפוטנטית — קריאה שנייה לא מאריכה.';

revoke all on function public.grant_launch_promo(uuid, text, int) from public;
grant execute on function public.grant_launch_promo(uuid, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. בחירת מסלול בידי הסוכן/ת
--
-- הפונקציה לא בודקת הרשאה — ‎join-agency‎ עושה זאת מול ה-JWT לפני שהיא
-- קוראת לכאן, וזו החלוקה הרגילה בפרויקט (הפונקציה מורשית ל-service_role
-- בלבד, ולכן אין דרך אחרת להגיע אליה). מה שהיא כן שומרת הוא הכלל העסקי:
-- מסלול חייב להיות אחד מהשלושה, והשינוי נרשם ביומן.
-- ---------------------------------------------------------------------------
create or replace function public.record_tier_selection(
  p_member_id uuid,
  p_tier      text,
  p_source    text default 'self',
  p_note      text default null
)
returns table (changed_member uuid, previous_tier text, new_tier text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.agency_members%rowtype;
begin
  if p_tier not in ('free', 'mid', 'premium') then
    raise exception 'invalid tier: %', p_tier;
  end if;

  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found then
    raise exception 'member not found: %', p_member_id;
  end if;

  update public.agency_members
     set tier             = p_tier,
         tier_selected_at = now(),
         tier_source      = p_source
   where id = p_member_id;

  insert into public.tier_changes (member_id, agency_id, from_tier, to_tier, source, note)
  values (p_member_id, v_member.agency_id, v_member.tier, p_tier, p_source, p_note);

  return query select p_member_id, v_member.tier, p_tier;
end;
$$;

revoke all on function public.record_tier_selection(uuid, text, text, text) from public;
grant execute on function public.record_tier_selection(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. סיום ההטבה
--
-- מחזירה את השורות שנסגרו, כדי ש-promo-lifecycle יידע/תדע למי לשלוח את
-- הודעת הסיום. הסגירה והשליחה מופרדות בכוונה: מייל שנכשל לא צריך להשאיר
-- סוכן/ת על Elite לנצח, ושליחה שרצה פעמיים גרועה פחות משתי הורדות מסלול.
--
-- ההורדה נגזרת מ-‎tier_source‎ ולא מ-‎tier_selected_at‎, וההבחנה חשובה: סוכן/ת
-- שראה/תה את מסך ההטבה ולחץ/ה "מתחילים" **בחר/ה לעבור את המסך**, לא בחר/ה
-- מסלול בתשלום. אצלו/ה tier_selected_at מלא ו-tier_source הוא
-- ‎launch_promo_accepted‎ — ובדיוק אותו אדם צריך לרדת ל-Pay&GO בתום התקופה.
-- מי שבחר/ה מסלול בעצמו/ה מאוחר יותר (‏tier_source = 'self') שומר/ת עליו.
-- ---------------------------------------------------------------------------
create or replace function public.expire_launch_promos()
returns table (
  member        uuid,
  member_name   text,
  member_email  text,
  agency        uuid,
  previous_tier text,
  new_tier      text,
  downgraded    boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select m.id
      from public.agency_members m
     where m.promo_ends_at is not null
       and m.promo_ended_at is null
       and m.promo_ends_at <= now()
     order by m.promo_ends_at
     for update skip locked
  ),
  closed as (
    update public.agency_members m
       set promo_ended_at = now(),
           tier = case when m.tier_source is null
                         or m.tier_source in ('launch_promo', 'launch_promo_accepted')
                       then 'free' else m.tier end,
           tier_source = case when m.tier_source is null
                                or m.tier_source in ('launch_promo', 'launch_promo_accepted')
                              then 'promo_expired' else m.tier_source end
      from due
     where m.id = due.id
    returning m.id, m.display_name, m.email, m.agency_id, m.tier as tier_after,
              m.tier_source as source_after, m.promo_tier
  ),
  logged as (
    insert into public.tier_changes (member_id, agency_id, from_tier, to_tier, source, note)
    select c.id, c.agency_id, c.promo_tier, c.tier_after, 'promo_expired',
           'תום הטבת ההשקה'
      from closed c
     where c.source_after = 'promo_expired'
    returning 1
  )
  select c.id, c.display_name, c.email, c.agency_id,
         c.promo_tier, c.tier_after, (c.source_after = 'promo_expired')
    from closed c;
end;
$$;

comment on function public.expire_launch_promos() is
  'סוגרת הטבות שהסתיימו: מי שלא בחר/ה מסלול יורד/ת ל-free. מחזירה את השורות למשלוח הודעת הסיום.';

revoke all on function public.expire_launch_promos() from public;
grant execute on function public.expire_launch_promos() to service_role;

-- ---------------------------------------------------------------------------
-- 7. התזמון
--
-- פעם ביום ב-06:40 UTC (‏09:40 שעון ישראל בקיץ). ההתראות נמדדות בימים ולא
-- בדקות, ולכן הרצה יומית מספיקה — והשעה נבחרה כך שההודעה תיפול בבוקר של
-- יום עבודה ולא בשלוש לפנות בוקר.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/promo-lifecycle';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את promo-lifecycle בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('promo-lifecycle')
    where exists (select 1 from cron.job where jobname = 'promo-lifecycle');

  perform cron.schedule('promo-lifecycle', '40 6 * * *', format($cron$
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

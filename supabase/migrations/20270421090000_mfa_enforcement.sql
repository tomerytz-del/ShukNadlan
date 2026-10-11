-- ===========================================================================
-- אימות כניסה בוואטסאפ (אימות דו-שלבי) — המצב והאכיפה במסד
--
-- ‏**איך זה נראה לסוכן/ת:** אחרי הסיסמה או Google, כפתור אחד פותח וואטסאפ
-- עם הודעה מוכנה לגבריאלה ("אימות כניסה 123456"). שולחים, וחוזרים לאתר.
-- ‏Meta מוסרת את המספר שממנו נשלחה ההודעה, והאימות עובר רק כשהוא הנייד
-- שבכרטיס. אותו דפוס של "אימות חתימה" בהסכמים
-- (‏_shared/agreement-wa-verify.ts): הודעה **נכנסת** אינה צריכה תבנית
-- AUTHENTICATION מאושרת של Meta, וקוד יוצא כן.
--
-- ‏**האימות הוא לכל session**, לפי ה-claim ‏session_id שב-JWT. הוא נשמר
-- לאורך חידושי הטוקן, כלומר מאמתים פעם אחת בכל כניסה ולא בכל טעינה.
--
-- ‏**ולצדה, למי שמעדיף/ה: אפליקציית אימות** (‏TOTP של Supabase Auth, ‏aal2
-- ב-JWT). שתי הדרכים שקולות: מי שחייב/ת אימות יכול/ה לעבור בכל אחת מהן.
--
-- מי חייב/ת אימות (‏_mfa_pending_self):
--   * מי שהפעיל/ה וואטסאפ (‏agent_wa_2fa) או אפליקציה (factor מאומת)
--   * מנהל/ת פלטפורמה פעיל/ה — תמיד, גם בלי שהפעיל/ה. ההרשאה הרחבה ביותר
--     במערכת אינה יכולה להישען על סיסמה אחת.
--
-- ‏**האכיפה: pre-request של PostgREST, ולא policy בכל טבלה.** הפונקציה רצה
-- לפני כל בקשה ל-Data API (טבלאות ו-RPC כאחד, כולל SECURITY DEFINER שעוקפות
-- RLS), ולמי שחייב/ת אימות ולא אימת/ה היא **מאפסת את ה-claims לאלה של
-- אורח/ת**: ‏auth.uid() מחזיר null, ‏auth.role() מחזיר anon. המשמעות:
--   * כל מה שפרטי — נעלם, כי כל policy פרטית נשענת על auth.uid().
--   * מה שציבורי (נכסים, משרדים, דף הבית) — ממשיך לעבוד. זו הסיבה שלא
--     זורקים שגיאה: ה-session משותף לכל הדפים באותו דומיין, וטלפון שנשאר
--     מחובר היה מקבל דף בית ריק או שבור.
--   * ‏policy של authenticated עם ‏using (true) הייתה דולפת — נבדק במסד
--     ב-10.10.2026, ואין כזו ב-public או ב-storage.
--
-- ‏**מה לא מכוסה כאן:** ‏Storage ו-Realtime אינם עוברים ב-pre-request. ל-
-- Storage יש למטה policy מגבילה משלה; ‏Realtime אינו בשימוש. ‏Edge Functions
-- שמזהות משתמש/ת ב-getUser ועובדות ב-service role נבדקות ב-
-- ‏_shared/mfa-gate.ts. הפרטים: docs/mfa.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. הטבלאות. שתיהן בלי policy בכלל: הגישה רק דרך הפונקציות למטה.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_wa_2fa (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  enabled_at timestamptz not null default now()
);
alter table public.agent_wa_2fa enable row level security;
revoke all on table public.agent_wa_2fa from anon, authenticated;

-- בקשת אימות אחת לכל לחיצה. ‏enable = הבקשה שמפעילה את האימות מההגדרות:
-- ההפעלה נכנסת לתוקף רק אחרי שהנייד הוכיח שהוא עובד.
create table if not exists public.wa_login_verifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null,
  nonce        text not null,
  enable       boolean not null default false,
  requested_at timestamptz not null default now(),
  verified_at  timestamptz
);
alter table public.wa_login_verifications enable row level security;
revoke all on table public.wa_login_verifications from anon, authenticated;

create index if not exists wa_login_verifications_nonce_idx
  on public.wa_login_verifications (nonce, requested_at desc);
create index if not exists wa_login_verifications_session_idx
  on public.wa_login_verifications (user_id, session_id) where verified_at is not null;

-- ---------------------------------------------------------------------------
-- 2. האם ה-session הנוכחי חייב אימות ועוד לא אומת — **על עצמו/ה בלבד**,
--    לפי auth.uid(). בלי פרמטר בכוונה: גרסה שמקבלת uuid הייתה מאפשרת לכל
--    משתמש/ת לברר על אחרים מי מנהל/ת פלטפורמה. ‏security definer כי שתי
--    הטבלאות למעלה סגורות, ‏auth.mfa_factors אינה קריאה ל-authenticated
--    (נבדק: has_table_privilege = false), ו-agency_members מוגבלת ב-RLS.
-- ---------------------------------------------------------------------------
create or replace function public._mfa_pending_self()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and coalesce(auth.jwt()->>'aal', '') <> 'aal2'
     and (
           exists (select 1 from agent_wa_2fa t where t.user_id = auth.uid())
        or exists (select 1 from auth.mfa_factors f
                    where f.user_id = auth.uid() and f.status = 'verified')
        or exists (select 1 from agency_members m
                    where m.user_id = auth.uid() and m.is_platform_admin = true and m.active = true)
         )
     and not exists (
           select 1 from wa_login_verifications v
            where v.user_id = auth.uid()
              and v.session_id = nullif(auth.jwt()->>'session_id', '')::uuid
              and v.verified_at is not null
         );
$$;

revoke all on function public._mfa_pending_self() from public, anon, authenticated;
grant execute on function public._mfa_pending_self() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ה-pre-request.
--
-- ‏aal2 יוצא בשורה הראשונה, בלי שום שאילתה. כל השאר משלמים כמה בדיקות
-- אינדקס לבקשה.
--
-- ‏**כשל פתוח, ובכוונה.** תקלה בבדיקה עצמה (הרשאה שהשתנתה בגרסה של
-- Supabase) בכשל סגור הייתה הופכת כל משתמש/ת לאורח/ת — כלומר מפילה את
-- ה-CRM לכולם בבת אחת. בכשל פתוח המחיר הוא שהאכיפה נחלשת עד התיקון, וזה
-- נרשם כ-warning ביומן של Postgres.
--
-- ‏shuk.mfa_pending_sub שומר מי היה/תה שם לפני האיפוס, בשביל mfa_status()
-- ו-wa_login_start() בלבד: בלי זה אי אפשר לבקש אימות מתוך המצב שדורש אותו.
--
-- ‏**security invoker, ולא definer.** ‏PostgREST מריץ אותה בתפקיד של הבקשה,
-- כולל anon, ולכן היא חייבת execute לכולם. פונקציית definer פתוחה ל-anon
-- שמריצה set_config היא בדיוק מה שהסוכן התפעולי מסמן high
-- (‏anon_secdef_unguarded). כאן אין בזה צורך: ‏set_config על ה-claims מותר
-- לכל תפקיד, והקריאה המוגנת היחידה עוברת דרך _mfa_pending_self.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_pre_request()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claims  jsonb;
  v_uid     uuid;
  v_pending boolean := false;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if v_claims is null
     or coalesce(v_claims->>'role', '') <> 'authenticated'
     or coalesce(v_claims->>'aal', '') = 'aal2' then
    return;
  end if;

  v_uid := nullif(v_claims->>'sub', '')::uuid;
  if v_uid is null then return; end if;

  begin
    v_pending := public._mfa_pending_self();
  exception when others then
    raise warning 'mfa_pre_request: check failed, request passes without enforcement: %', sqlerrm;
    return;
  end;

  if not v_pending then return; end if;

  perform set_config('shuk.mfa_pending_sub', v_uid::text, true);
  perform set_config('shuk.mfa_pending_session', coalesce(v_claims->>'session_id', ''), true);
  -- ‏auth.uid() / auth.role() / auth.jwt() קוראים את אלה; כולם מתאפסים
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon', 'mfa_pending', true)::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim', '', true);
end;
$$;

revoke all on function public.mfa_pre_request() from public, anon, authenticated;
-- ‏PostgREST מריץ את ה-pre-request בתפקיד של הבקשה, ולכן שלושתם צריכים
-- הרשאת הרצה. ‏revoke ואז grant מפורש — ההחלטה כתובה, לא ברירת מחדל.
grant execute on function public.mfa_pre_request() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. מה ה-CRM ופונקציות ה-Edge צריכים לדעת.
--
-- ‏pending: חייב/ת אימות ועוד לא אימת/ה (כלומר כרגע אורח/ת במסד)
-- ‏enabled: הפעיל/ה אימות בוואטסאפ
-- ‏totp: יש אפליקציית אימות מאומתת
-- ‏required: חייב/ת אימות בכל כניסה (הפעיל/ה אחת מהשתיים, או מנהל/ת פלטפורמה)
-- ‏has_phone: יש נייד בכרטיס — בלעדיו אין לאן לאמת
-- ---------------------------------------------------------------------------
create or replace function public.mfa_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pending boolean := nullif(current_setting('shuk.mfa_pending_sub', true), '') is not null;
  v_uid     uuid := coalesce(auth.uid(), nullif(current_setting('shuk.mfa_pending_sub', true), '')::uuid);
  v_enabled boolean;
  v_totp    boolean;
  v_admin   boolean;
  v_phone   boolean;
begin
  if v_uid is null then
    return jsonb_build_object('pending', false, 'enabled', false, 'required', false);
  end if;
  select exists (select 1 from agent_wa_2fa where user_id = v_uid) into v_enabled;
  select exists (select 1 from auth.mfa_factors where user_id = v_uid and status = 'verified') into v_totp;
  select coalesce(bool_or(is_platform_admin and active), false),
         coalesce(bool_or(phone_e164 is not null and phone_e164 <> ''), false)
    into v_admin, v_phone
    from agency_members where user_id = v_uid;
  return jsonb_build_object(
    'pending',   v_pending,
    'enabled',   v_enabled,
    'totp',      v_totp,
    'required',  v_enabled or v_totp or v_admin,
    'admin',     v_admin,
    'has_phone', v_phone
  );
end;
$$;

revoke all on function public.mfa_status() from public, anon, authenticated;
-- ‏authenticated בלבד: אחרי האיפוס התפקיד במסד עדיין authenticated, ורק
-- ה-claims הם של אורח/ת.
grant execute on function public.mfa_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. בקשת אימות: מחזירה את הקוד שנכנס להודעה המוכנה. נקראת גם מתוך המצב
--    שדורש אימות (ואז auth.uid() ריק והזהות מגיעה מה-pre-request), וגם
--    מההגדרות כדי להפעיל (p_enable).
-- ---------------------------------------------------------------------------
create or replace function public.wa_login_start(p_enable boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid     uuid := coalesce(auth.uid(), nullif(current_setting('shuk.mfa_pending_sub', true), '')::uuid);
  v_session uuid := nullif(coalesce(auth.jwt()->>'session_id',
                                    current_setting('shuk.mfa_pending_session', true)), '')::uuid;
  v_phone   text;
  v_nonce   text;
  v_recent  int;
begin
  if v_uid is null or v_session is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select phone_e164 into v_phone
    from agency_members where user_id = v_uid and active
   order by is_platform_admin desc limit 1;
  if coalesce(v_phone, '') = '' then
    return jsonb_build_object('error', 'no_phone');
  end if;

  -- תקרה פשוטה נגד לחיצות חוזרות: 10 בקשות ב-10 דקות לחשבון
  select count(*) into v_recent from wa_login_verifications
   where user_id = v_uid and requested_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  v_nonce := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into wa_login_verifications (user_id, session_id, nonce, enable)
  values (v_uid, v_session, v_nonce, coalesce(p_enable, false));

  return jsonb_build_object('nonce', v_nonce, 'phone_tail', right(v_phone, 4));
end;
$$;

revoke all on function public.wa_login_start(boolean) from public, anon, authenticated;
grant execute on function public.wa_login_start(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. ההודעה הגיעה (‏whatsapp-webhook, ב-service role). מחזירה את התשובה
--    לשלוח לשולח/ת. ‏p_from הוא המספר ש-Meta מסרה, באותו פורמט של
--    phone_e164 — ההשוואה שמזהה סוכנים בבוט.
-- ---------------------------------------------------------------------------
create or replace function public.wa_login_verify(p_nonce text, p_from text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row  wa_login_verifications%rowtype;
  v_any  boolean;
begin
  select v.* into v_row
    from wa_login_verifications v
   where v.nonce = p_nonce
     and v.requested_at > now() - interval '10 minutes'
     and exists (select 1 from agency_members m
                  where m.user_id = v.user_id and m.active and m.phone_e164 = p_from)
   order by v.requested_at desc
   limit 1;

  if v_row.id is null then
    select exists (select 1 from wa_login_verifications
                    where nonce = p_nonce and requested_at > now() - interval '10 minutes') into v_any;
    if v_any then
      return 'ההודעה נשלחה ממספר שאינו הנייד שרשום בכרטיס שלך. צריך לשלוח אותה מהטלפון שבכרטיס.';
    end if;
    return 'הקוד פג או שאינו מוכר. חוזרים לאתר ולוחצים שוב על "אימות בוואטסאפ".';
  end if;

  update wa_login_verifications set verified_at = coalesce(verified_at, now()) where id = v_row.id;
  if v_row.enable then
    insert into agent_wa_2fa (user_id) values (v_row.user_id) on conflict (user_id) do nothing;
    return '✅ אימות כניסה בוואטסאפ הופעל. מעכשיו כל כניסה חדשה תבקש הודעה כזו. אפשר לחזור לאתר.';
  end if;
  return '✅ הכניסה אומתה. אפשר לחזור לאתר.';
end;
$$;

revoke all on function public.wa_login_verify(text, text) from public, anon, authenticated;
grant execute on function public.wa_login_verify(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. כיבוי מההגדרות. רק מתוך session מאומת (אחרת auth.uid() ריק כאן), ולא
--    למנהל/ת פלטפורמה — אצלו/ה זו חובה ממילא.
-- ---------------------------------------------------------------------------
create or replace function public.wa_2fa_disable()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  delete from agent_wa_2fa where user_id = auth.uid();
end;
$$;

revoke all on function public.wa_2fa_disable() from public, anon, authenticated;
grant execute on function public.wa_2fa_disable() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. ‏Storage אינו עובר ב-pre-request. ‏policy מגבילה (restrictive) אחת על
--    storage.objects: מי שחייב/ת אימות ולא אימת/ה — אינו/ה קורא/ת, מעלה או
--    מוחק/ת דרך ה-API של Storage. הקלטות השיחות (call-recordings) הן הסיבה.
--    הקישורים הציבוריים של הדליים הציבוריים אינם עוברים ב-RLS ולא נפגעים.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public._mfa_pending_self();
$$;

revoke all on function public.mfa_satisfied() from public, anon, authenticated;
grant execute on function public.mfa_satisfied() to authenticated;

drop policy if exists "mfa required for storage" on storage.objects;
create policy "mfa required for storage"
  on storage.objects
  as restrictive
  for all
  to authenticated
  using ((select public.mfa_satisfied()))
  with check ((select public.mfa_satisfied()));

-- ---------------------------------------------------------------------------
-- 9. הרישום. ‏alter role authenticator נתמך ומתועד ב-Supabase ("Securing
--    your API" → "Enforce additional rules on each request"). נבדק לפני
--    הכתיבה: לא היה pre-request קודם, כך שאין כאן דריסה של משהו אחר.
-- ---------------------------------------------------------------------------
alter role authenticator set pgrst.db_pre_request = 'public.mfa_pre_request';
notify pgrst, 'reload config';

-- ============================================================================
-- אימות כניסה: מכשיר שאומת נזכר ל-30 יום
-- ----------------------------------------------------------------------------
-- מה שבור היום: האימות הדו-שלבי הוא לכל session. סוכן/ת שלוחץ/ת על כפתור
-- בהודעה של גבריאלה בוואטסאפ ונוחת/ת ב-session חדש מקבל/ת מסך שמבקש לחזור
-- לוואטסאפ ולשלוח הודעת אימות. ביומן הבקשות של 19.11.2026 זה היה 4 מתוך 14
-- כניסות מקישור, ו-32 שניות עד שההודעה נשלחה - כלומר "הקישור לא עובד".
--
-- מה נכנס (החלטת תומר, 19.11.2026): אחרי אימות אמיתי (הודעת וואטסאפ מהנייד
-- שבכרטיס, או קוד מאפליקציה) הדפדפן מקבל אסימון מכשיר. בכניסה חדשה מאותו
-- דפדפן האסימון מאמת את ה-session בלי הודעה נוספת, עד 30 יום מהאימות.
--
-- **המנעול לא זז.** ‏mfa_pre_request, ‏_mfa_session_verified ו-_mfa_pending_self
-- אינם משתנים: מימוש האסימון כותב שורה מאומתת ל-wa_login_verifications עבור
-- ה-session הנוכחי, בדיוק מה שהודעת הוואטסאפ כותבת, ושלוש שכבות האכיפה
-- (Data API, ‏Storage, ‏Edge) ממשיכות לקרוא אותה טבלה.
--
-- מה שומר על זה:
--   * האסימון הוא 244 סיביות אקראיות (שני gen_random_uuid), ובמסד נשמר רק
--     ה-sha256 שלו. מי שמחזיק/ה סיסמה גנובה בלבד אינו/ה מחזיק/ה אותו.
--   * אסימון נוצר רק מ-session שעבר אימות **אמיתי** (שורה שאינה 'device:%',
--     או aal2). session שאומת מאסימון אינו יכול להנפיק אסימון חדש, ולכן
--     30 הימים אינם מתגלגלים: אחריהם נדרש שוב אימות מלא.
--   * התוקף נספר מרגע האימות, לא מרגע ההנפקה.
--   * עד 10 מכשירים לחשבון; הישן ביותר נמחק.
--   * ‏mfa_devices_forget() מוחקת את כולם (כפתור בהגדרות), וכיבוי האימות
--     בוואטסאפ מוחק אותם גם הוא (טריגר).
--   * המתג: pricing_config.mfa_device_trust_days. ‏0 מכבה מיד, בלי דיפלוי:
--     אסימונים קיימים מפסיקים להתממש וחדשים אינם מונפקים.
--
-- מה לא מכוסה, ונאמר במפורש ב-docs/mfa.md: מי שמחזיק/ה את הדפדפן עצמו
-- (מחשב משותף, טלפון גנוב ופתוח) נכנס/ת עם הסיסמה בלבד עד 30 יום. לכן
-- הסימון במסך האימות מזהיר ממחשב משותף, ואפשר לשכוח מכשירים מההגדרות.
-- ============================================================================

insert into public.pricing_config (key, value, description) values
  ('mfa_device_trust_days', 30,
   'אימות כניסה: כמה ימים מכשיר שאומת פטור מאימות חוזר. 0 מכבה את הזכירה מיד, בלי דיפלוי.')
on conflict (key) do nothing;

create table if not exists public.mfa_trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  verified_at  timestamptz not null,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

comment on table public.mfa_trusted_devices is
  'מכשיר שעבר אימות כניסה ונזכר. רק sha256 של האסימון; האסימון עצמו בדפדפן בלבד.';

create index if not exists mfa_trusted_devices_user_idx
  on public.mfa_trusted_devices (user_id, created_at desc);

alter table public.mfa_trusted_devices enable row level security;
-- אין policy: הטבלה נקראת ונכתבת רק מהפונקציות שלמטה.
revoke all on table public.mfa_trusted_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.mfa_trusted_devices to service_role;

-- ---------------------------------------------------------------------------
-- כמה ימים. 0 או ערך חסר = כבוי. נקראת גם ממסך האימות (לפני שה-session
-- אומת), ולכן security definer ובלי תלות ב-auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.mfa_device_trust_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, least(90, coalesce(
    (select value::integer from pricing_config where key = 'mfa_device_trust_days'), 0)));
$$;

revoke all on function public.mfa_device_trust_days() from public, anon, authenticated;
grant execute on function public.mfa_device_trust_days() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- הנפקה. רק מ-session מאומת (auth.uid() קיים), ורק אם האימות שלו אמיתי.
-- מחזירה את האסימון פעם אחת; במסד נשאר ה-hash בלבד.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_device_remember()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_session  uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  v_days     integer := public.mfa_device_trust_days();
  v_verified timestamptz;
  v_token    text;
begin
  if v_uid is null or v_session is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_days <= 0 then
    return jsonb_build_object('token', null, 'reason', 'disabled');
  end if;

  if coalesce(auth.jwt()->>'aal', '') = 'aal2' then
    v_verified := now();
  else
    select max(v.verified_at) into v_verified
      from wa_login_verifications v
     where v.user_id = v_uid
       and v.session_id = v_session
       and v.verified_at is not null
       and v.nonce not like 'device:%';
  end if;
  if v_verified is null then
    return jsonb_build_object('token', null, 'reason', 'not_verified');
  end if;
  if v_verified + make_interval(days => v_days) <= now() then
    return jsonb_build_object('token', null, 'reason', 'expired');
  end if;

  delete from mfa_trusted_devices where user_id = v_uid and expires_at <= now();
  delete from mfa_trusted_devices d
   where d.user_id = v_uid
     and d.id in (select x.id from mfa_trusted_devices x
                   where x.user_id = v_uid
                   order by x.created_at desc offset 9);

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into mfa_trusted_devices (user_id, token_hash, verified_at, expires_at)
  values (v_uid, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          v_verified, v_verified + make_interval(days => v_days));

  return jsonb_build_object('token', v_token,
                            'expires_at', v_verified + make_interval(days => v_days));
end;
$$;

revoke all on function public.mfa_device_remember() from public, anon, authenticated;
grant execute on function public.mfa_device_remember() to authenticated;

-- ---------------------------------------------------------------------------
-- מימוש. נקראת כשה-session עוד לא אומת: ה-pre-request איפס את ה-claims
-- והשאיר את shuk.mfa_pending_sub / shuk.mfa_pending_session, כמו שקוראת
-- wa_login_start. אסימון תקף של אותו חשבון כותב שורה מאומתת ל-session הזה.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_device_claim(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid     uuid := coalesce(auth.uid(), nullif(current_setting('shuk.mfa_pending_sub', true), '')::uuid);
  v_session uuid := nullif(coalesce(auth.jwt()->>'session_id',
                                    current_setting('shuk.mfa_pending_session', true)), '')::uuid;
  v_hash    text;
  v_id      uuid;
begin
  if v_uid is null or v_session is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if public.mfa_device_trust_days() <= 0 then
    return false;
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  update mfa_trusted_devices d
     set last_used_at = now()
   where d.user_id = v_uid and d.token_hash = v_hash and d.expires_at > now()
  returning d.id into v_id;
  if v_id is null then
    return false;
  end if;

  if not exists (select 1 from wa_login_verifications v
                  where v.user_id = v_uid and v.session_id = v_session
                    and v.verified_at is not null) then
    insert into wa_login_verifications (user_id, session_id, nonce, verified_at)
    values (v_uid, v_session, 'device:' || left(v_hash, 12), now());
  end if;
  return true;
end;
$$;

revoke all on function public.mfa_device_claim(text) from public, anon, authenticated;
grant execute on function public.mfa_device_claim(text) to authenticated;

-- ---------------------------------------------------------------------------
-- "לשכוח את כל המכשירים". רק מ-session מאומת. מחזירה כמה נמחקו.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_devices_forget()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  delete from mfa_trusted_devices where user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mfa_devices_forget() from public, anon, authenticated;
grant execute on function public.mfa_devices_forget() to authenticated;

-- כמה מכשירים זכורים כרגע, להגדרות. רק על עצמו/ה.
create or replace function public.mfa_devices_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from mfa_trusted_devices
   where user_id = auth.uid() and expires_at > now();
$$;

revoke all on function public.mfa_devices_count() from public, anon, authenticated;
grant execute on function public.mfa_devices_count() to authenticated;

-- ---------------------------------------------------------------------------
-- כיבוי האימות בוואטסאפ מוחק את המכשירים הזכורים של אותו חשבון. טריגר ולא
-- שינוי ב-wa_2fa_disable, כדי שגם מחיקה של השורה בפעולת תמיכה תנקה.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_trusted_devices_on_2fa_off()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from mfa_trusted_devices where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.mfa_trusted_devices_on_2fa_off() from public, anon, authenticated;

drop trigger if exists mfa_trusted_devices_on_2fa_off on public.agent_wa_2fa;
create trigger mfa_trusted_devices_on_2fa_off
  after delete on public.agent_wa_2fa
  for each row execute function public.mfa_trusted_devices_on_2fa_off();

notify pgrst, 'reload schema';

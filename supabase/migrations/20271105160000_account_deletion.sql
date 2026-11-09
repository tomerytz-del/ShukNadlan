-- ============================================================================
-- מחיקת חשבון מתוך האפליקציה (Apple 5.1.1(v), ‏Google Play: Account deletion)
--
-- עד היום "סגירת חשבון" של סוכן/ת הורידה את הנוכחות ואת התקשורת, אבל
-- השאירה את הכניסה ואת הפרטים האישיים. החנויות דורשות **מחיקה**: אי אפשר
-- להיכנס יותר, והמידע האישי נמחק - חוץ ממה שהחוק מחייב לשמור.
--
-- המחיקה היא שני שלבים, בכוונה:
--   1. הסגירה (קיימת, close_agent_account / החדשה close_developer_account):
--      החזר הארנק, הורדת המודעות או הפרויקטים, עצירת הפניות.
--   2. המחיקה (החדשה, erase_*): מחיקת הפרטים האישיים ומה שנאסף בשבילם,
--      והחזרת user_id כדי ש-close-account ימחק את המשתמש ב-Auth וישחרר
--      את המספרים הווירטואליים ב-Twilio (שתי פעולות שאי אפשר לעשות ב-SQL).
--
-- **מה נשמר, ולמה** (גם ב-terms §19 וב-privacy):
--   • חיובים, טעינות, החזרים, חשבוניות ופרופיל החיוב - חובת שמירה לפי
--     פקודת מס הכנסה. השורה של הסוכן/ת נשארת, מאונונמת, כי הם מפנים אליה.
--   • הסכמים חתומים ועסקאות - רשומה של עסקה מול צד שלישי.
--   • לידים - רשומה של הפלטפורמה; הפרטים בהם נמחקים במדיניות leads_pii.
--   • כרטיסי לקוח/ה ששותפו עם המשרד או הרשת - שייכים למשרד מרגע השיתוף.
--
-- אידמפוטנטית - אפשר להריץ שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. עמודות
-- ---------------------------------------------------------------------------
alter table public.agency_members add column if not exists erased_at timestamptz;
comment on column public.agency_members.erased_at is
  'מתי נמחקו הפרטים האישיים והכניסה (erase_agent_account). closed_at הוא הסגירה; זו המחיקה שאחריה.';

alter table public.developers add column if not exists closure_requested_at timestamptz;
alter table public.developers add column if not exists closed_at timestamptz;
alter table public.developers add column if not exists closure_reason text;
alter table public.developers add column if not exists erased_at timestamptz;
comment on column public.developers.closed_at is
  'מחיקת החשבון ביוזמת החברה (close-account). הפרויקטים אורכבו והארנק הוחזר.';

-- ---------------------------------------------------------------------------
-- 2. החזר לחברה יזמית
--
-- ‏wallet_refunds בנויה סביב agent_id (ותור ההחזרים ב-CRM מצטרף דרכו), ולכן
-- לחברה יזמית טבלה משלה. אין לה מסך: מנהלי הפלטפורמה מקבלים התראה בפעמון
-- עם הסכום, ומבצעים את ההחזר ידנית מול חברת הסליקה.
-- ---------------------------------------------------------------------------
create table if not exists public.developer_refunds (
  id            uuid primary key default gen_random_uuid(),
  developer_id  uuid not null references public.developers(id) on delete restrict,
  amount        numeric not null check (amount > 0),
  status        text not null default 'requested'
                check (status in ('requested','completed','rejected','cancelled')),
  note          text,
  requested_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  resolution_note text
);
create index if not exists developer_refunds_developer_idx on public.developer_refunds(developer_id);
alter table public.developer_refunds enable row level security;
revoke all on table public.developer_refunds from anon, authenticated;
grant select, insert, update, delete on table public.developer_refunds to service_role;
comment on table public.developer_refunds is
  'בקשות החזר ארנק של חברות יזמיות, נפתחות במחיקת החשבון. service_role בלבד.';

-- ‏amount ולא charged_amount: הארנק לפני מע״מ (טעינת 100 ₪ נגבית 118 ומזכה
-- 100), וההחזר נמדד ביחידות הארנק - כמו wallet_refundable_amount.
create or replace function public.developer_refundable_amount(p_developer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, least(
    coalesce((select credit_balance from public.developers where id = p_developer_id), 0),
    coalesce((select sum(amount)
                from public.developer_topups
               where developer_id = p_developer_id
                 and status = 'paid'
                 and test_mode = false), 0)
    - coalesce((select sum(amount)
                  from public.developer_refunds
                 where developer_id = p_developer_id
                   and status in ('requested','completed')), 0)
  ));
$$;
revoke all on function public.developer_refundable_amount(uuid) from public, anon, authenticated;
grant execute on function public.developer_refundable_amount(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. סוכן/ת: המחיקה שאחרי הסגירה
-- ---------------------------------------------------------------------------
create or replace function public.erase_agent_account(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_lines  jsonb;
  v_clients int := 0;
begin
  select * into v_member from public.agency_members where id = p_agent_id for update;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  -- מוחקים רק אחרי סגירה: היא זו שפותחת את ההחזר ומורידה את המודעות.
  if v_member.closed_at is null then
    return jsonb_build_object('error', 'not_closed');
  end if;
  if v_member.erased_at is not null then
    return jsonb_build_object('success', true, 'already_erased', true, 'user_id', null, 'lines', '[]'::jsonb);
  end if;

  -- המספרים הווירטואליים: מסומנים כמשוחררים כאן, ו-close-account מוחק/ת
  -- אותם ב-Twilio לפי הרשימה. הסיומת מפנה את ה-unique (כמו lines-release).
  with rel as (
    update public.agent_phone_lines
       set status = 'released', active = false, released_at = now(),
           twilio_number = twilio_number || '#released-' || left(id::text, 8)
     where agent_id = p_agent_id and status <> 'released'
    returning id, twilio_sid
  )
  select coalesce(jsonb_agg(jsonb_build_object('line_id', id, 'twilio_sid', twilio_sid)), '[]'::jsonb)
    into v_lines from rel;

  -- החידוש בכרטיס: מבוטל, והאסימון של הכרטיס נמחק.
  update public.billing_subscriptions
     set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
         card_token = null, contact_email = null, next_retry_at = null,
         last_error = 'account_deleted', updated_at = now()
   where agent_id = p_agent_id;

  -- הכרטיסים הפרטיים של הלקוחות. כרטיס ששותף עם המשרד או הרשת נשאר שם.
  with gone as (
    delete from public.agent_clients
     where agent_id = p_agent_id and coalesce(share_level, 'private') = 'private'
    returning 1
  )
  select count(*) into v_clients from gone;

  -- מה שנאסף בשביל הסוכן/ת עצמו/ה: יומן, יומן Google, השיחה עם גבריאלה,
  -- המנטור, קישורים ששלח/ה, מועדפים, יעדים והתראות.
  delete from public.client_showcases          where agent_id = p_agent_id;
  delete from public.agent_agenda_items        where agent_id = p_agent_id;
  delete from public.agent_calendar_secrets    where agent_id = p_agent_id;
  delete from public.agent_calendar_connections where agent_id = p_agent_id;
  delete from public.agent_email_intake        where agent_id = p_agent_id;
  delete from public.whatsapp_conversations    where agent_id = p_agent_id;
  delete from public.whatsapp_pending_actions  where agent_id = p_agent_id;
  delete from public.coach_preferences         where agent_id = p_agent_id;
  delete from public.coach_questions           where agent_id = p_agent_id;
  delete from public.agent_coach_summaries     where agent_id = p_agent_id;
  delete from public.property_bookmarks        where agent_id = p_agent_id;
  delete from public.agent_targets             where agent_id = p_agent_id;
  delete from public.agent_search_misses       where agent_id = p_agent_id;
  delete from public.wa_share_links            where agent_id = p_agent_id;
  delete from public.cma_links                 where agent_id = p_agent_id;
  delete from public.planning_links            where agent_id = p_agent_id;
  delete from public.notifications             where agent_id = p_agent_id;

  -- הודעות הוואטסאפ: השורה נשארת לספירות (כמו whatsapp_bodies), התוכן לא.
  update public.whatsapp_messages set body = null, media_url = null
   where agent_id = p_agent_id and (body is not null or media_url is not null);

  if v_member.user_id is not null then
    delete from public.app_push_devices where user_id = v_member.user_id;
  end if;
  if v_member.email is not null and btrim(v_member.email) <> '' then
    delete from public.newsletter_subscribers where lower(email) = lower(btrim(v_member.email));
  end if;

  -- השורה עצמה נשארת (חיובים, חשבוניות והסכמים מפנים אליה), בלי פרט מזהה.
  update public.agency_members
     set display_name = 'חשבון שנמחק',
         slug = 'deleted-' || left(id::text, 8),
         user_id = null,
         email = null, phone = null,
         bio = null, photo_url = null, cover_url = null, gallery = '[]'::jsonb,
         credentials = null, service_area = null, specialties = null,
         years_experience = null, gender = null,
         id_number = null, id_number_enc = null, id_number_last4 = null,
         instagram_handle = null, facebook_url = null,
         social_tag_consent = false, social_tag_consent_at = null,
         payment_token_id = null, subscription_id = null,
         active = false,
         erased_at = now(),
         updated_at = now()
   where id = p_agent_id;

  return jsonb_build_object(
    'success', true,
    'user_id', v_member.user_id,
    'lines', v_lines,
    'private_clients_deleted', v_clients
  );
end;
$$;
revoke all on function public.erase_agent_account(uuid) from public, anon, authenticated;
grant execute on function public.erase_agent_account(uuid) to service_role;

-- מי נסגר/ה בעצמו/ה ועוד לא נמחק/ה - הריצה היומית account-erasure.
-- ‏closure_requested_at מבדיל סגירה ביוזמת הסוכן/ת מכל מצב אחר.
create or replace function public.accounts_pending_erasure(p_limit int default 50)
returns table(agent_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.agency_members
   where closed_at is not null
     and erased_at is null
     and closure_requested_at is not null
   order by closed_at
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
revoke all on function public.accounts_pending_erasure(int) from public, anon, authenticated;
grant execute on function public.accounts_pending_erasure(int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. חברה יזמית: סגירה ומחיקה בקריאה אחת (אין לה מנוי תקופתי)
-- ---------------------------------------------------------------------------
create or replace function public.close_developer_account(p_developer_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dev        record;
  v_refundable numeric := 0;
  v_projects   int := 0;
  v_refund_id  uuid;
begin
  select * into v_dev from public.developers where id = p_developer_id for update;
  if not found then
    return jsonb_build_object('error', 'developer_not_found');
  end if;
  if v_dev.closed_at is not null then
    return jsonb_build_object('error', 'already_closed');
  end if;

  -- (1) הכסף: מה שנטען בתשלום ולא מומש. היתרה יורדת לאפס - ההחזר הוא הכסף.
  v_refundable := public.developer_refundable_amount(p_developer_id);
  if v_refundable > 0 then
    insert into public.developer_refunds (developer_id, amount, note)
    values (p_developer_id, v_refundable, 'החזר אוטומטי עם מחיקת החשבון')
    returning id into v_refund_id;
  end if;

  -- (2) הפרויקטים יורדים מהאתר.
  with archived as (
    update public.projects
       set status = 'archived', is_promoted = false, promoted_until = null, updated_at = now()
     where developer_id = p_developer_id and status <> 'archived'
    returning id
  )
  select count(*) into v_projects from archived;

  if v_dev.user_id is not null then
    delete from public.app_push_devices where user_id = v_dev.user_id;
  end if;
  if v_dev.email is not null and btrim(v_dev.email) <> '' then
    delete from public.newsletter_subscribers where lower(email) = lower(btrim(v_dev.email));
  end if;

  -- (3) הפרטים האישיים. שם החברה, הח״פ והכתובת הם פרטי תאגיד ונשארים
  --     (חיובים וחשבוניות מפנים אליהם). איש/אשת הקשר והכניסה נמחקים.
  --     ‏developers_core_fields_filled דורש תוכן, ולכן מילה במקום ריק.
  update public.developers
     set contact_name = 'חשבון שנמחק',
         phone = '-',
         phone_e164 = null,
         email = null,
         user_id = null,
         status = 'suspended',
         credit_balance = 0,
         closure_requested_at = coalesce(closure_requested_at, now()),
         closure_reason = left(p_reason, 500),
         closed_at = now(),
         erased_at = now(),
         updated_at = now()
   where id = p_developer_id;

  -- מנהלי הפלטפורמה מבצעים את ההחזר ידנית - הם צריכים לדעת שיש כזה.
  if v_refund_id is not null then
    -- ‏suppress_push=false במפורש: זו התראה בזמן ריצה, לא מילוי, והיא צריכה
    -- להגיע לוואטסאפ של מנהלי הפלטפורמה (scripts/check_notification_backfill.py).
    insert into public.notifications (agent_id, type, title, body, suppress_push)
    select m.id, 'system',
           'החזר לחברה יזמית שמחקה את החשבון',
           v_dev.name || ' (ח״פ ' || v_dev.company_number || ') מחקה את החשבון. יש להחזיר '
             || v_refundable::text || ' ₪ מהארנק דרך חברת הסליקה (developer_refunds).',
           false
      from public.agency_members m
     where m.is_platform_admin and m.active;
  end if;

  return jsonb_build_object(
    'success', true,
    'developer_id', p_developer_id,
    'user_id', v_dev.user_id,
    'projects_archived', v_projects,
    'refund_requested', v_refundable
  );
end;
$$;
revoke all on function public.close_developer_account(uuid, text) from public, anon, authenticated;
grant execute on function public.close_developer_account(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. הריצה היומית: אחרי שהסגירות המתוזמנות בוצעו (3:40), account-erasure
--    מוחק/ת את מי שנסגר/ה ועוד לא נמחק/ה - כולל המשתמש ב-Auth ו-Twilio.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/account-erasure';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - מחיקת החשבונות המתוזמנת לא תוזמנה';
    return;
  end if;

  perform cron.unschedule('account-erasure-sweep')
    where exists (select 1 from cron.job where jobname = 'account-erasure-sweep');
  perform cron.schedule('account-erasure-sweep', '55 3 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 60000
    )
    where exists (select 1 from public.accounts_pending_erasure(1));
  $cron$, v_url));
end;
$$;

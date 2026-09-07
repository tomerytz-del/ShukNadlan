-- ============================================================================
-- טעינת ארנק בסליקה אמיתית — מורנינג (חשבונית ירוקה)
--
-- **מה משתנה כאן, ולמה זה נוגע בכסף**
--
-- עד היום טעינת ארנק הייתה פעולה אחת: ‏process_wallet_topup הכניסה שורה עם
-- ‏status='success' והוסיפה את הסכום ל-credit_balance באותה נשימה. זה עבד כי
-- לא היה ספק סליקה — אף אחד לא שילם, ולכן לא היה מה לחכות לו.
--
-- ברגע שיש סליקה אמיתית ההנחה הזו נשברת. בין הלחיצה על "טען" לבין הרגע שבו
-- הכסף באמת נגבה עוברות דקות, הסוכן/ת מבקר/ת בדף חיצוני שאיננו שלנו, והתשלום
-- עלול גם פשוט לא לקרות — כרטיס נדחה, חלון נסגר, מישהו התחרט. **טעינה חייבת
-- להיות שתי פעולות נפרדות**, ולכן:
--
--   ‏start_wallet_topup     — פותחת שורת 'pending'. **לא נוגעת ביתרה.**
--   ‏complete_wallet_topup  — מזכה את הארנק. נקראת רק אחרי אימות מול מורנינג.
--   ‏fail_wallet_topup      — סוגרת ניסיון שנכשל או פג.
--
-- **הפונקציה היחידה שמזכה כסף היא complete_wallet_topup**, וכל ההגנות יושבות
-- בה: נעילת שורה, בדיקת סטטוס, והשוואת סכום מול מה שאנחנו רשמנו.
--
-- ‏process_wallet_topup הישנה נשארת, ומופיעה כאן בקובץ בפעם הראשונה. היא
-- קדמה לתיקיית המיגרציות וחיה עד היום רק במסד — בלי קובץ, בלי היסטוריה, בלי
-- דרך לדעת מי שינה אותה. ‏create or replace מביא אותה תחת ניהול גרסאות בלי
-- לשנות את התנהגותה. היא עדיין המסלול של מצב הבדיקה: כל עוד מפתחות מורנינג
-- אינם מוגדרים, ‏wallet-topup נופלת אליה והאתר ממשיך לעבוד כרגיל.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות החדשות
--
-- ‏provider_form_id ו-provider_charge_id הם שני מזהים שונים ולא אחד:
-- הראשון הוא טופס התשלום שיצרנו (קיים מיד, לפני שאיש שילם, ומשמש את
-- ה-reconcile כדי לשאול את מורנינג "מה קרה לזה?"), והשני הוא העסקה שנגבתה
-- בפועל (קיים רק אחרי תשלום מוצלח). ערבוב ביניהם היה שובר את שניהם.
-- ---------------------------------------------------------------------------
alter table public.wallet_topups
  add column if not exists provider_form_id     text,
  add column if not exists provider_payment_url text,
  add column if not exists completed_at         timestamptz,
  add column if not exists failure_reason       text;

comment on column public.wallet_topups.provider_form_id is
  'מזהה טופס התשלום אצל ספק הסליקה. נוצר לפני התשלום ומשמש את ה-reconcile.';
comment on column public.wallet_topups.provider_charge_id is
  'מזהה העסקה שנגבתה בפועל. קיים רק בשורות success.';
comment on column public.wallet_topups.failure_reason is
  'למה הניסיון נסגר ככושל. לתחקור בלבד — לא מוצג לסוכן/ת כמו שהוא.';

-- ‏webhook הוא הבטחה, לא ערובה — והוא גם עלול להגיע פעמיים. האינדקס הזה הוא
-- הרשת האחרונה מתחת ל-complete_wallet_topup: גם אם שתי קריאות יעברו את כל
-- הבדיקות במקביל, המסד עצמו לא ייתן לאותה עסקה להירשם פעמיים.
create unique index if not exists wallet_topups_provider_charge_uniq
  on public.wallet_topups (provider, provider_charge_id)
  where provider_charge_id is not null;

create index if not exists wallet_topups_pending_idx
  on public.wallet_topups (status, created_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. מצב הבדיקה — כפי שהוא, תחת ניהול גרסאות
--
-- ההגדרה זהה לזו שרצה בפרודקשן, עם שני הידוקים שאינם משנים התנהגות:
-- ‏search_path = '' עם שמות מלאים (כמו בכל הפונקציות החדשות בריפו), ו-provider
-- מפורש במקום null, כדי שהאינדקס הייחודי שלמעלה יבדיל בין ספקים.
-- ---------------------------------------------------------------------------
create or replace function public.process_wallet_topup(p_agent_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topup_id uuid;
begin
  if p_amount not in (100,200,300,400,500) then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  insert into public.wallet_topups (agent_id, amount, status, test_mode, provider, completed_at)
  values (p_agent_id, p_amount, 'success', true, 'test_mode', now())
  returning id into v_topup_id;

  update public.agency_members
     set credit_balance = credit_balance + p_amount
   where id = p_agent_id;

  insert into public.invoices (agent_id, related_charge_id, related_charge_type, provider, issued_at)
  values (p_agent_id, v_topup_id, 'wallet_topup', 'test_mode', now());

  return jsonb_build_object('success', true, 'topup_id', v_topup_id, 'amount', p_amount);
end;
$$;

comment on function public.process_wallet_topup(uuid, numeric) is
  'טעינת ארנק במצב בדיקה — מזכה מיידית בלי סליקה. מסלול הנפילה של wallet-topup כשמורנינג אינו מוגדר.';

-- ---------------------------------------------------------------------------
-- 3. פאזה 1 — פתיחת ניסיון טעינה
--
-- שים לב למה שאין כאן: אין update על credit_balance. זו כל הנקודה. השורה
-- שנוצרת היא רשומת כוונה, לא רשומת כסף.
-- ---------------------------------------------------------------------------
create or replace function public.start_wallet_topup(p_agent_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topup_id uuid;
  v_open     int;
begin
  if p_amount not in (100,200,300,400,500) then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  if not exists (select 1 from public.agency_members
                 where id = p_agent_id and active) then
    return jsonb_build_object('error', 'agent_inactive');
  end if;

  -- תקרה על ניסיונות פתוחים. בלעדיה, מי שלוחץ/ת "טען" עשר פעמים ונוטש/ת
  -- משאיר/ה עשר שורות pending שה-reconcile יצטרך לרדוף אחריהן, ובדף
  -- היסטוריית החיובים זה נראה כמו עשר טעינות שלא נכנסו.
  select count(*) into v_open
    from public.wallet_topups
   where agent_id = p_agent_id
     and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 5 then
    return jsonb_build_object('error', 'too_many_open_topups');
  end if;

  insert into public.wallet_topups (agent_id, amount, status, test_mode, provider)
  values (p_agent_id, p_amount, 'pending', false, 'morning')
  returning id into v_topup_id;

  return jsonb_build_object('success', true, 'topup_id', v_topup_id, 'amount', p_amount);
end;
$$;

comment on function public.start_wallet_topup(uuid, numeric) is
  'פאזה 1 של טעינת ארנק: פותחת שורת pending. אינה נוגעת ביתרה. ל-service_role בלבד.';

-- ---------------------------------------------------------------------------
-- 4. פאזה 2 — הזיכוי
--
-- **הפונקציה היחידה במערכת שמוסיפה כסף לארנק בעקבות תשלום חיצוני.** שלוש
-- הגנות, וכל אחת מהן מיותרת עד היום שבו היא לא:
--
--   ‏for update      — נועל את השורה. שני webhooks במקביל לא יזכו פעמיים.
--   בדיקת status    — webhook שחוזר על עצמו מקבל 'כבר טופל', לא זיכוי שני.
--   השוואת סכום     — הסכום שמזוכה נלקח מ-v_topup.amount, כלומר ממה
--                     **שאנחנו** רשמנו כשפתחנו את הניסיון. הפרמטר
--                     p_verified_amount הוא מה שספק הסליקה אישר, והוא רק
--                     נבדק מולו. גם קורא שהצליח לזייף קריאה לא יכול להזריק
--                     סכום — לכל היותר להיכשל בהשוואה.
-- ---------------------------------------------------------------------------
create or replace function public.complete_wallet_topup(
  p_topup_id           uuid,
  p_verified_amount    numeric,
  p_provider_charge_id text default null,
  p_document_id        text default null,
  p_pdf_url            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topup public.wallet_topups;
begin
  select * into v_topup
    from public.wallet_topups
   where id = p_topup_id
   for update;

  if not found then
    return jsonb_build_object('error', 'topup_not_found');
  end if;

  -- ה-webhook הגיע שוב. זו לא שגיאה — זו התנהגות רגילה של ספק סליקה,
  -- והתשובה חייבת להיות הצלחה כדי שהוא יפסיק לנסות.
  if v_topup.status = 'success' then
    return jsonb_build_object('success', true, 'already_completed', true,
                              'amount', v_topup.amount);
  end if;

  if v_topup.status <> 'pending' then
    return jsonb_build_object('error', 'topup_not_pending', 'status', v_topup.status);
  end if;

  if p_verified_amount is not null and p_verified_amount <> v_topup.amount then
    update public.wallet_topups
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_topup.amount, p_verified_amount)
     where id = p_topup_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_topup.amount, 'reported', p_verified_amount);
  end if;

  update public.wallet_topups
     set status             = 'success',
         provider_charge_id = coalesce(p_provider_charge_id, provider_charge_id),
         completed_at       = now(),
         failure_reason     = null
   where id = p_topup_id;

  update public.agency_members
     set credit_balance = credit_balance + v_topup.amount
   where id = v_topup.agent_id;

  insert into public.invoices (agent_id, related_charge_id, related_charge_type,
                               provider, provider_document_id, pdf_url, issued_at)
  values (v_topup.agent_id, p_topup_id, 'wallet_topup',
          coalesce(v_topup.provider, 'morning'), p_document_id, p_pdf_url, now());

  return jsonb_build_object('success', true, 'amount', v_topup.amount,
                            'agent_id', v_topup.agent_id);
end;
$$;

comment on function public.complete_wallet_topup(uuid, numeric, text, text, text) is
  'פאזה 2 של טעינת ארנק: מזכה את הארנק אחרי אימות מול ספק הסליקה. אידמפוטנטית. ל-service_role בלבד.';

-- ---------------------------------------------------------------------------
-- 5. סגירת ניסיון כושל
--
-- מסמנת בלבד — אין מה להחזיר, כי מעולם לא זוכה כלום. שורת pending שנשארת
-- פתוחה לנצח אינה מסוכנת לכסף, אבל היא מלכלכת את היסטוריית החיובים ומטעה
-- את מי שקורא/ת אותה.
-- ---------------------------------------------------------------------------
create or replace function public.fail_wallet_topup(p_topup_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.wallet_topups
   where id = p_topup_id
   for update;

  if not found then
    return jsonb_build_object('error', 'topup_not_found');
  end if;

  -- טעינה שכבר הצליחה לא נסגרת ככושלת. אם ה-webhook הגיע לפני ה-reconcile,
  -- ה-webhook צודק — הוא ראה תשלום, וה-reconcile רק ראה שורה ישנה.
  if v_status = 'success' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;

  update public.wallet_topups
     set status = 'failed', failure_reason = left(coalesce(p_reason, 'unknown'), 300)
   where id = p_topup_id;

  return jsonb_build_object('success', true, 'status', 'failed');
end;
$$;

comment on function public.fail_wallet_topup(uuid, text) is
  'סגירת ניסיון טעינה שנכשל או פג. אינה נוגעת ביתרה. ל-service_role בלבד.';

-- ---------------------------------------------------------------------------
-- 6. הרשאות
--
-- שלוש הפונקציות נגישות ל-service_role בלבד, כלומר רק דרך Edge Function.
-- קריאה ישירה מהדפדפן עם ה-JWT של הסוכן/ת תיחסם — וזה בדיוק העיקרון שכבר
-- שומר על lead_purchase, ‏promote_property ושאר הפעולות שנוגעות בכסף.
-- ---------------------------------------------------------------------------
revoke all on function public.process_wallet_topup(uuid, numeric) from public;
revoke all on function public.process_wallet_topup(uuid, numeric) from anon;
revoke all on function public.process_wallet_topup(uuid, numeric) from authenticated;
grant execute on function public.process_wallet_topup(uuid, numeric) to service_role;

revoke all on function public.start_wallet_topup(uuid, numeric) from public;
revoke all on function public.start_wallet_topup(uuid, numeric) from anon;
revoke all on function public.start_wallet_topup(uuid, numeric) from authenticated;
grant execute on function public.start_wallet_topup(uuid, numeric) to service_role;

revoke all on function public.complete_wallet_topup(uuid, numeric, text, text, text) from public;
revoke all on function public.complete_wallet_topup(uuid, numeric, text, text, text) from anon;
revoke all on function public.complete_wallet_topup(uuid, numeric, text, text, text) from authenticated;
grant execute on function public.complete_wallet_topup(uuid, numeric, text, text, text) to service_role;

revoke all on function public.fail_wallet_topup(uuid, text) from public;
revoke all on function public.fail_wallet_topup(uuid, text) from anon;
revoke all on function public.fail_wallet_topup(uuid, text) from authenticated;
grant execute on function public.fail_wallet_topup(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. תזמון ה-reconcile
--
-- אותה תבנית כמו property-video-reconcile (‏§11 במיגרציה 20261004090000):
-- ‏pg_cron קורא ל-Edge Function דרך pg_net, והסוד ל-header נקרא מ-Vault.
--
-- **זו אינה משימת ניקיון — זו הרשת שמתחת לכסף של הסוכן/ת.** ‏webhook הוא
-- הבטחה, לא ערובה: אם מורנינג ניסה/תה לקרוא אלינו בזמן פריסה, או שהתשובה
-- אבדה, הסוכן/ת שילם/ה ולא קיבל/ה כלום — והשורה תישאר 'pending' לנצח בלי
-- שאיש ידע. זה הכשל היקר ביותר האפשרי כאן, והוא **לא** נשען על שיתוף פעולה
-- של צד שלישי: ה-reconcile שואל את מורנינג בעצמו ומסיים כל ניסיון פתוח.
--
-- כל חמש דקות, מול STALE_MINUTES=10 בפונקציה: מי שנתקע/ה מקבל/ת תשובה תוך
-- רבע שעה במקרה הגרוע. תדירות גבוהה יותר לא תקצר את זה — הסף הוא מה שקובע.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/wallet-topup-callback?mode=reconcile';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את wallet-topup-callback?mode=reconcile בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('wallet-topup-reconcile')
    where exists (select 1 from cron.job where jobname = 'wallet-topup-reconcile');

  perform cron.schedule('wallet-topup-reconcile', '*/5 * * * *', format($cron$
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

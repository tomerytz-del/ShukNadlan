-- ============================================================================
-- סגירת חשבון ביוזמת הסוכן/ת — "אני רוצה לצאת"
--
-- עד היום הדרך היחידה החוצה הייתה טלפון להנהלה. זו מיגרציה שהופכת את זה
-- לפעולה שהסוכן/ת עושה בעצמו/ה מ"הגדרות חשבון", ומגדירה מה בדיוק "לצאת"
-- אומר: הדף הציבורי יורד, המודעות יורדות, אף מערכת לא פונה יותר, והכסף
-- שנטען ולא מומש חוזר.
--
-- שלוש החלטות שמסבירות את המבנה:
--
-- 1. **הבקשה נפרדת מהביצוע.** ‏closure_requested_at הוא מה שהסוכן/ת עשה/תה,
--    ‏closed_at הוא מה שקרה בפועל. בין השניים יושב closure_effective_at —
--    המועד שבו הסגירה נכנסת לתוקף. למי שאינו במנוי בתשלום השלושה נופלים על
--    אותו רגע; למנוי חודשי המועד הוא **סוף תקופת החיוב ששולמה**
--    (‏paid_tier_until), כי אין זיכוי יחסי באמצע חודש והחודש ששולם שייך
--    לסוכן/ת עד תומו.
--
-- 2. **הכסף שמוחזר הוא הארנק בלבד.** ‏request_wallet_refund פותח/ת בקשת
--    החזר על מה שנטען ולא מומש (‏wallet_refundable_amount), ולא על דמי
--    המנוי. זו המדיניות, והיא נאמרת גם בדיאלוג האישור ב-CRM.
--
-- 3. **הסגירה כותבת רק בשרת.** ארבע עמודות הסגירה נעולות ב-
--    ‏protect_sensitive_agency_member_fields בדיוק כמו עמודות הניתוק
--    מהמשרד: מי שיכול/ה לכתוב אותן מהדפדפן יכול/ה לסגור חשבון של אחר/ת,
--    או "לסגור" את עצמו/ה בלי שאף אחת מפעולות הניקוי תרוץ.
--
-- הביטול (‏cancel_account_closure) קיים כל עוד הסגירה עוד לא נכנסה לתוקף.
-- אחרי שנכנסה — אין חזרה עצמית, וזה מכוון: החזרה כרוכה בהחזר שכבר נפתח,
-- במודעות שכבר ירדו ובדף שכבר הוסר מהאינדקס. ‏CRM מפנה לתמיכה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- העמודות
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists closure_requested_at timestamptz,
  add column if not exists closure_effective_at timestamptz,
  add column if not exists closed_at             timestamptz,
  add column if not exists closure_reason        text;

comment on column public.agency_members.closure_requested_at is
  'מתי הסוכן/ת ביקש/ה לסגור את החשבון. ריק = אין בקשה פתוחה.';
comment on column public.agency_members.closure_effective_at is
  'מתי הסגירה נכנסת לתוקף. מיידי למי שאינו במנוי בתשלום, ו-paid_tier_until למנוי חודשי.';
comment on column public.agency_members.closed_at is
  'מתי הסגירה בוצעה בפועל (הדף ירד, המודעות אורכבו, ההחזר נפתח).';

create index if not exists idx_agency_members_closure_due
  on public.agency_members (closure_effective_at)
  where closure_effective_at is not null and closed_at is null;

-- הנכסים שאורכבו **בגלל** הסגירה, ולא כאלה שהסוכן/ת ארכב/ה בעצמו/ה. בלי
-- ההבחנה הזו ביטול סגירה (או שחזור ידני בתמיכה) היה מחזיר לאוויר גם מודעות
-- שהורדו מזמן ובכוונה.
alter table public.properties
  add column if not exists closure_archived_at timestamptz;

comment on column public.properties.closure_archived_at is
  'סומן כאשר הנכס אורכב אוטומטית עקב סגירת חשבון הסוכן/ת.';

-- ---------------------------------------------------------------------------
-- נעילת עמודות הסגירה לכתיבה מהשרת בלבד
--
-- הפונקציה נכתבת כאן במלואה (‏create or replace) ולא "מתוקנת" — זו הדרך
-- היחידה ב-Postgres, ולכן כל מה שהיה בה נשמר מילה במילה ונוספות לו ארבע
-- שורות בלבד, לצד שורות הניתוק מהמשרד.
-- ---------------------------------------------------------------------------
create or replace function public.protect_sensitive_agency_member_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
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

  -- המנוי בתשלום — דרך complete_subscription_order בלבד. אלה שדות כסף
  -- במלוא מובן המילה: מי שכותב/ת אותם מהדפדפן מעניק/ה לעצמו/ה מסלול Elite.
  new.paid_tier := old.paid_tier;
  new.paid_tier_until := old.paid_tier_until;

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

  -- סגירת חשבון — דרך close-account בלבד. אותו נימוק בדיוק: מי שיכול/ה
  -- לכתוב את closed_at מהדפדפן יכול/ה להוריד מהאוויר סוכן/ת אחר/ת, או
  -- לסמן את עצמו/ה כסגור/ה בלי שההחזר, האירכוב וההסרה מרשימת התפוצה קרו.
  new.closure_requested_at := old.closure_requested_at;
  new.closure_effective_at := old.closure_effective_at;
  new.closed_at := old.closed_at;
  new.closure_reason := old.closure_reason;

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
$function$;

-- ---------------------------------------------------------------------------
-- ‏agency_account_closure_blocker — מה מונע סגירה עכשיו
--
-- מקור אמת אחד לשלוש נקודות שמפעילות אותו: הדיאלוג ב-CRM (שמראה את החסימה
-- לפני שמישהו מקליד משהו), ה-Edge Function (שדוחה בקשה חסומה) והריצה
-- המתוזמנת (שלא תיצור משרד נעול גם אם המצב השתנה מאז הבקשה).
--
-- חסימה אחת בלבד, והיא לא בירוקרטית: משרד שנשאר בלי מנהל/ת פעיל/ה הוא
-- משרד נעול — אי אפשר להוסיף אליו סוכנים, לאשר בקשות שיוך או לערוך את
-- המיתוג שלו. מנהל/ת יחיד/ה **בלי** צוות אחר נסגר/ת רגיל: אין למי לנעול.
-- ---------------------------------------------------------------------------
create or replace function public.agency_account_closure_blocker(p_agent_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_member    record;
  v_others    int;
  v_managers  int;
begin
  select id, agency_id, role, closed_at
    into v_member
    from public.agency_members
   where id = p_agent_id;
  if not found then return 'agent_not_found'; end if;
  if v_member.closed_at is not null then return 'already_closed'; end if;
  if v_member.role <> 'manager' then return null; end if;

  select count(*),
         count(*) filter (where o.role = 'manager')
    into v_others, v_managers
    from public.agency_members o
   where o.agency_id = v_member.agency_id
     and o.id <> v_member.id
     and o.active
     and o.released_at is null
     and o.closed_at is null;

  -- מנהל/ת יחיד/ה בלי צוות אחר — אין למי לנעול את המשרד, והסגירה עוברת.
  if v_others = 0 then return null; end if;
  if v_managers = 0 then return 'last_manager'; end if;
  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- ‏close_agent_account — הסגירה עצמה, בטרנזקציה אחת
--
-- הסדר כאן אינו שרירותי. בקשת ההחזר **קודמת** לכיבוי ה-active, כי
-- ‏request_wallet_refund דורש/ת סוכן/ת פעיל/ה — ואחרי הכיבוי הכסף היה נשאר
-- תקוע בלי דרך לבקש אותו מהממשק.
-- ---------------------------------------------------------------------------
create or replace function public.close_agent_account(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_member    record;
  v_blocker   text;
  v_refundable numeric := 0;
  v_refund    jsonb := null;
  v_props     int := 0;
begin
  select * into v_member from public.agency_members where id = p_agent_id for update;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  if v_member.closed_at is not null then
    return jsonb_build_object('error', 'already_closed');
  end if;

  v_blocker := public.agency_account_closure_blocker(p_agent_id);
  if v_blocker is not null then
    return jsonb_build_object('error', v_blocker);
  end if;

  -- (1) הכסף. בקשת החזר על מה שנטען ולא מומש — ולא על דמי מנוי. בקשה
  --     פתוחה קיימת אינה שגיאה: הכסף כבר בדרך חזרה.
  v_refundable := public.wallet_refundable_amount(p_agent_id);
  if v_refundable > 0
     and not exists (select 1 from public.wallet_refunds
                      where agent_id = p_agent_id and status = 'requested') then
    v_refund := public.request_wallet_refund(
      p_agent_id, v_refundable, 'החזר אוטומטי עם סגירת החשבון');
  end if;

  -- (2) המודעות. ‏status <> 'active' הוא מה שמוריד אותן מכל דף ציבורי באתר,
  --     ולכן זו הפעולה שמורידה את הנוכחות ולא מחיקה. הקידום נכבה איתן —
  --     מודעה מקודמת שאינה מוצגת היא רק חיוב שממשיך לרוץ.
  with archived as (
    update public.properties
       set status = 'archived',
           closure_archived_at = now(),
           is_promoted = false,
           promoted_until = null
     where agent_id = p_agent_id
       and status = 'active'
    returning id
  )
  select count(*) into v_props from archived;

  -- (3) ההתקשרות. העדפות הלידים נכבות, כל סוגי ההתראות מושתקים, ההתראות
  --     שממתינות בפעמון נמחקות, והמייל יוצא מרשימת התפוצה.
  update public.agent_lead_preferences set active = false, updated_at = now()
   where agent_id = p_agent_id;

  insert into public.agent_notification_preferences (agent_id, muted_types, updated_at)
  values (p_agent_id, array[
    'new_lead','review_new','review_request','client_match','deal_closed',
    'marketing_copy','agreement_signed','system','review_alert','lead_unrouted'
  ], now())
  on conflict (agent_id) do update
    set muted_types = excluded.muted_types, updated_at = now();

  delete from public.notifications where agent_id = p_agent_id;

  if v_member.email is not null and btrim(v_member.email) <> '' then
    update public.newsletter_subscribers
       set unsubscribed_at = coalesce(unsubscribed_at, now())
     where lower(email) = lower(btrim(v_member.email));
  end if;

  -- (4) הכיבוי. ‏active=false הוא מה שמוציא את השורה מ-agency_members_public,
  --     וזה בתורו מה שמוריד את דף הסוכן/ת, את הכרטיס בספריית המתווכים ואת
  --     הנוכחות בדף המשרד. אותו דגל גם מוציא את הסוכן/ת מניתוב הלידים.
  update public.agency_members
     set active = false,
         closed_at = now(),
         closure_requested_at = coalesce(closure_requested_at, now()),
         closure_effective_at = coalesce(closure_effective_at, now()),
         updated_at = now()
   where id = p_agent_id;

  return jsonb_build_object(
    'success', true,
    'agent_id', p_agent_id,
    'properties_archived', v_props,
    'refund_requested', coalesce(v_refundable, 0),
    'refund', v_refund
  );
end;
$function$;

-- ‏service_role בלבד: זו הפונקציה שמורידה חשבון מהאוויר, ואין לה מה לעשות
-- בהישג ידו של טוקן דפדפן. ‏close-account קורא/ת לה עם מפתח ה-service.
revoke all on function public.close_agent_account(uuid) from public, anon, authenticated;
grant execute on function public.close_agent_account(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ‏execute_scheduled_account_closures — הריצה היומית
--
-- מי שביקש/ה לסגור והמועד הגיע. בקשה שהחסם עדיין חל עליה (מנהל/ת אחרון/ה
-- שבינתיים נוספו לו/ה סוכנים) פשוט נשארת ממתינה ותיבדק שוב מחר — עדיף על
-- משרד נעול, ו-CRM מציג לסוכן/ת מה חסר.
-- ---------------------------------------------------------------------------
create or replace function public.execute_scheduled_account_closures()
returns table(agent_id uuid, result jsonb)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row record;
begin
  for v_row in
    select id from public.agency_members
     where closure_effective_at is not null
       and closure_effective_at <= now()
       and closed_at is null
     order by closure_effective_at
     limit 200
  loop
    agent_id := v_row.id;
    result := public.close_agent_account(v_row.id);
    return next;
  end loop;
end;
$function$;

revoke all on function public.execute_scheduled_account_closures() from public, anon, authenticated;
grant execute on function public.execute_scheduled_account_closures() to service_role;

-- הבדיקה "מה חוסם" היא קריאה בלבד ומוזנת ל-close-account; ‏service_role
-- מספיק/ה, ואין סיבה שדפדפן ישאל אותה על מזהה שאינו שלו.
revoke all on function public.agency_account_closure_blocker(uuid) from public, anon, authenticated;
grant execute on function public.agency_account_closure_blocker(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- התזמון. ‏3:40 — אחרי expire_paid_subscriptions (3:10), כדי שסגירה שנקבעה
-- לסוף תקופת החיוב תתבצע על שורה שכבר ירדה מהמסלול בתשלום.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'close-scheduled-accounts') then
      perform cron.unschedule('close-scheduled-accounts');
    end if;
    perform cron.schedule(
      'close-scheduled-accounts',
      '40 3 * * *',
      $cron$select public.execute_scheduled_account_closures();$cron$
    );
  end if;
end;
$$;

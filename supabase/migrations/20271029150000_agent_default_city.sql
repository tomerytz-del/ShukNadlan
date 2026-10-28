-- ============================================================================
-- עיר ברירת מחדל לנכס חדש, לסוכן/ת
--
-- סוכן אמר לגבריאלה שעפולה היא העיר הקבועה שלו. היא רשמה שישה נכסים בעיר
-- המשרד (כפר גדעון), ואז אמרה שאין לה איך לשמור את זה כהגדרה.
--
-- service_area הוא טקסט שיווקי ("עפולה והעמקים"). default_city בטופס לידים
-- של מטא הוא מיפוי טופס, לא הפרופיל. לכן עמודה משלה, ריקה עד שהסוכן/ת מבקש/ת.
-- השם נפתר ב-city_id_for_name (כולל city_aliases). אין כאן מיפוי נפרד.
--
-- ריק = ההתנהגות של היום: עיר המשרד, ואם אין - עפולה.
-- הפונקציה עולה לפני המיגרציה, ולכן קריאה לעמודה חסרה נבלעת בקוד.
-- ============================================================================

alter table public.agency_members
  add column if not exists default_city_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'agency_members_default_city_id_fkey'
  ) then
    alter table public.agency_members
      add constraint agency_members_default_city_id_fkey
      foreign key (default_city_id) references public.cities(id) on delete set null;
  end if;
end $$;

comment on column public.agency_members.default_city_id is
  'עיר לנכס חדש כשהסוכן/ת לא אמר/ה עיר. ריק = עיר המשרד. נשמרת מ-update_profile דרך city_id_for_name.';

-- מנהל/ת משרד יכול/ה לעדכן שורה של סוכן/ת אחר/ת (RLS). העיר הקבועה היא
-- הגדרה אישית: מי שאינו/ה השורה עצמה לא משנה אותה. service_role (גבריאלה
-- ומיגרציות) יוצא/ת מוקדם באותה פונקציה, כמו בשאר השדות.
-- הגוף כולו מ-20270601130000, ובסוף נוסף הבלוק של default_city_id.
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

  -- אימות הרישיון — נקבע בשער בלבד (‏_shared/broker-license-gate.ts) ובאישור
  -- הידני של הנהלת הפלטפורמה. מי שיכול/ה לכתוב את license_status מהדפדפן
  -- יכול/ה לבטל את כל הבדיקה בשורה אחת.
  new.license_status := old.license_status;
  new.license_registry_name := old.license_registry_name;
  new.license_entity_status := old.license_entity_status;
  new.license_checked_at := old.license_checked_at;
  new.license_approved_at := old.license_approved_at;
  new.license_approved_by := old.license_approved_by;

  -- מספר הרישיון: עדכון עצמי בלבד, וגם זה רק **כל עוד לא אומת**. הבדיקה
  -- מול הרשם היא חד-פעמית בכניסה, ולכן החלפת המספר אחריה הייתה מרוקנת
  -- אותה מתוכן. מי שעדיין לא אומת/ה ממשיך/ה לתקן שגיאת הקלדה כרגיל.
  if not is_self
     or new.license_number is null
     or btrim(new.license_number) = ''
     or old.license_status in ('verified', 'manual') then
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
    -- צוות (20270601130000): השיוך לצוות נקבע בידי מנהל/ת המשרד בלבד. ה-RLS
    -- כבר מגביל עדכון של שורה אחרת למנהלים, ולכן כאן נחסם רק העדכון העצמי.
    new.team_id := old.team_id;
    -- "גם סוכן/ת פעיל/ה": סוכן/ת אינו/ה מוציא/ה את עצמו/ה מרוטציית הלידים.
    -- מנהל/ת כן קובע/ת את זה לעצמו/ה - אחרת במשרד עם מנהל/ת אחד/ת אין מי
    -- שיכול/ה לסמן את זה.
    if old.role is distinct from 'manager' then
      new.is_active_agent := old.is_active_agent;
    end if;
  end if;

  -- עיר קבועה לנכס חדש. אישית: מנהל/ת משרד לא מחליף/ה אותה לסוכן/ת אחר/ת.
  if not is_self then
    new.default_city_id := old.default_city_id;
  end if;
  return new;
end;
$function$;

-- anon אינו כותב לכרטיס הסוכן/ת. select נשאר: ה-RLS כבר מחזיר אפס שורות
-- בלי auth.uid, והאתר קורא את agency_members_public.
revoke insert, update, delete, truncate, references, trigger
  on table public.agency_members from anon;

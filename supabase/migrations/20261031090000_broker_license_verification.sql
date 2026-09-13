-- ============================================================================
-- אימות רישיון תיווך מול רשם המתווכים — השער לכניסה למערכת
--
-- ‏agency_members.license_number נבדק עד עכשיו על **קיומו** בלבד: שדה חובה
-- בארבעת מסלולי הכניסה, וזהו. כלומר אפשר היה להקליד שש ספרות כלשהן ולעבוד
-- על המערכת כמתווך/ת. המיגרציה הזו מוסיפה את השכבה שחסרה: המספר נבדק מול
-- מאגר המתווכים הפעילים של משרד המשפטים ב-data.gov.il, פעם אחת, בכניסה.
--
-- ---------------------------------------------------------------------------
-- **כאן האימות כן חוסם — ובזה הוא נבדל מאימות הח״פ.**
--
-- ב-20260922090000 (רשם החברות) ההכרעה הייתה שאימות הוא תיעוד ולא שער, כי
-- מזהה מערך נתונים שהתיישן היה סוגר את ההרשמה לכולם. ההכרעה כאן הפוכה, כי
-- מה שנבדק שונה: רישיון תיווך אינו פרט מזהה של תאגיד אלא **התנאי החוקי
-- לעסוק במקצוע**. פלטפורמה שמכניסה מי שאין לו/ה רישיון היא צד לעבירה.
--
-- החשש התפעולי נשאר בתוקף, ולכן הוא נענה בשלושה מקומות ולא בביטול השער:
--
--   1. **רק `not_found` ו-`inactive` חוסמים.** שניהם מבוססים על תשובה
--      חיובית ומפורשת של CKAN. ‏`unverified` — timeout, שגיאה, מאגר שהוחלף
--      — לעולם אינו חוסם. ראו _shared/broker-registry.ts.
--   2. **שמות העמודות מתגלים מהמאגר עצמו** ולא מקובעים בקוד, ולכן שינוי
--      שם עמודה אצל המפרסם אינו הופך את כולם ל"לא נמצא".
--   3. **מסלול ערעור אנושי.** המאגר הממשלתי מתעדכן אחת לשלושה חודשים, ולכן
--      רישיון שהונפק החודש פשוט אינו שם. מי שנחסם/ת שולח/ת צילום רישיון,
--      והנהלת הפלטפורמה מאשרת ידנית. אישור כזה גובר על המאגר.
--
-- ושני מתגי כיבוי ב-pricing_config, למקרה שכל זה לא יספיק.
-- ---------------------------------------------------------------------------
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. תוצאת הבדיקה על שורת הסוכן/ת
--
-- הבדיקה **חד-פעמית**: היא רצה ברגע שנוצר הקשר בין אדם לכרטיס, והתוצאה
-- יושבת כאן. אין בדיקה חוזרת ואין cron — אחרת סוכן/ת ותיק/ה היה/תה מגלה
-- בוקר אחד שגרסה חדשה של המאגר נעלה לו/ה את החשבון.
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists license_status text not null default 'unverified'
    check (license_status in ('verified','inactive','not_found','unverified','manual')),
  add column if not exists license_registry_name  text,
  add column if not exists license_entity_status  text,
  add column if not exists license_checked_at     timestamptz,
  add column if not exists license_approved_at    timestamptz,
  add column if not exists license_approved_by    uuid;

comment on column public.agency_members.license_status is
  'תוצאת הבדיקה מול רשם המתווכים בכניסה. verified=נמצא במאגר, inactive=נמצא אך אינו בתוקף, '
  'not_found=המאגר ענה ולא מצא (חוסם), unverified=לא הצלחנו לשאול (לעולם לא חוסם), '
  'manual=הנהלת הפלטפורמה אישרה ידנית מול צילום רישיון.';
comment on column public.agency_members.license_registry_name is
  'השם כפי שהוא רשום במאגר המתווכים. עשוי להיות שונה מ-display_name — שם התצוגה אינו חייב להיות השם הרשום.';
comment on column public.agency_members.license_entity_status is
  'סטטוס הרישיון כלשונו במאגר, כשיש עמודה כזו. טקסט חופשי בעברית, לא ערך סגור.';
comment on column public.agency_members.license_checked_at is
  'מתי נבדק. NULL = מעולם (שורות שקדמו למיגרציה). הבדיקה חד-פעמית ואינה חוזרת.';
comment on column public.agency_members.license_approved_by is
  'מי מהנהלת הפלטפורמה אישר/ה ידנית. מלא רק כש-license_status=''manual''.';

-- מסך הניהול שואל "מי לא אומת" — אינדקס חלקי, כי המכריע יהיה verified.
create index if not exists agency_members_license_attention_idx
  on public.agency_members(license_status, license_checked_at)
  where license_status not in ('verified','manual');


-- ---------------------------------------------------------------------------
-- 2. מטמון תשובות המאגר
--
-- אותו מספר נשאל פעמיים במסלול הרשמה אחד — בהקלדה (חיווי חי) ובשליחת הטופס.
-- ‏unverified אינו נשמר כאן: הוא אומר "לא הצלחנו לשאול", ואין טעם לזכור
-- כישלון רשת ל-30 יום.
--
-- ‏RLS דלוקה ובלי אף policy: נגיש ל-service_role בלבד, אותה תבנית של
-- ‏company_registry_cache. ‏payload הוא הרשומה הגולמית מהמאגר, ובה עשויים
-- להיות פרטים אישיים — ולכן הוא לא נחשף לאיש דרך ה-API.
-- ---------------------------------------------------------------------------
create table if not exists public.broker_registry_cache (
  license_number  text primary key,
  status          text not null check (status in ('verified','inactive','not_found')),
  registry_name   text,
  entity_status   text,
  payload         jsonb,
  checked_at      timestamptz not null default now()
);

comment on table public.broker_registry_cache is
  'מטמון תשובות רשם המתווכים, לפי מספר רישיון מנורמל (ספרות בלבד, בלי אפסים מובילים). unverified לא נשמר כאן.';
comment on column public.broker_registry_cache.payload is
  'הרשומה הגולמית מ-data.gov.il. עשויה להכיל פרטים אישיים — service_role בלבד.';

create index if not exists broker_registry_cache_checked_idx
  on public.broker_registry_cache(checked_at);

alter table public.broker_registry_cache enable row level security;
revoke all on public.broker_registry_cache from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. ערעורים — צילום רישיון ואישור ידני
--
-- זו הדלת שמונעת מהשער להיות חומה. שלוש עובדות שמחייבות אותה:
--
--   • המאגר מתעדכן אחת לשלושה חודשים. רישיון מהחודש הזה לא יהיה בו.
--   • שם שהשתנה, מספר שנרשם בפורמט אחר, מאגר שהוחלף — כל אלה נראים כמו
--     "לא נמצא" גם כשהרישיון תקף לגמרי.
--   • מולם עומד אדם אמיתי עם תעודה ביד.
--
-- **שורה מאושרת כאן היא גם ההיתר עצמו.** אין טבלת allowlist נפרדת: השער
-- (‏_shared/broker-license-gate.ts) שואל את הטבלה הזו *לפני* שהוא פונה ל-
-- data.gov.il, ו-status='approved' פוטר מהבדיקה. כך "אישרתי את הערעור"
-- ו"אפשרתי לו/ה לפתוח משרד" הם אותה פעולה, ולא שתיים שיכולות להיפרד.
--
-- ההיתר ניתן ל**מספר הרישיון**, לא לחשבון: מי שנחסם/ה בטופס ההרשמה עוד
-- אין לו/ה חשבון בכלל, והמסלול צריך להיות "אושרת — נסה/י שוב". מספר רישיון
-- הוא מידע ציבורי (ראו 20260903090000), ולכן זהו מודל האיום הקיים ולא חדש:
-- מה שסוגר את הפער הוא שההנהלה ראתה תעודה על שם מסוים, והשם והאימייל
-- נשמרים כאן לצד ההחלטה.
-- ---------------------------------------------------------------------------
create table if not exists public.broker_license_appeals (
  id              uuid primary key default gen_random_uuid(),
  license_number  text not null,
  applicant_name  text not null,
  applicant_email text not null,
  applicant_phone text,
  -- מאיזה מסלול נחסם/ה. עוזר להנהלה להבין מה ייפתח באישור.
  source          text,
  -- הנתיב בדלי broker-licenses. לא כתובת — הדלי פרטי, והצפייה היא דרך
  -- קישור חתום קצר-מועד שנוצר בשרת.
  document_path   text not null,
  document_mime   text,
  note            text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  decision_note   text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid
);

comment on table public.broker_license_appeals is
  'ערעור על חסימת כניסה: צילום רישיון תיווך שנשלח להנהלת הפלטפורמה. שורה approved היא ההיתר עצמו — השער בודק אותה לפני שהוא פונה למאגר.';
comment on column public.broker_license_appeals.document_path is
  'נתיב בדלי הפרטי broker-licenses. הצפייה דרך קישור חתום שנוצר ב-broker-license-appeal, לעולם לא כתובת קבועה.';
comment on column public.broker_license_appeals.license_number is
  'מספר רישיון מנורמל — ספרות בלבד, בלי אפסים מובילים. חייב להיות זהה לנרמול ב-_shared/broker-registry.ts.';

-- ערעור פתוח אחד לכל מספר רישיון. בלי זה, רענון של הטופס מייצר תור בקשות
-- זהות שההנהלה צריכה לעבור עליהן אחת אחת — בדיוק כמו agency_member_claims.
create unique index if not exists broker_license_appeals_one_open
  on public.broker_license_appeals (license_number)
  where status = 'pending';

-- שאילתת השער: "האם יש אישור למספר הזה". חייבת להיות מיידית — היא רצה
-- בכל הרשמה, לפני כל יציאה לרשת.
create index if not exists broker_license_appeals_approved_idx
  on public.broker_license_appeals (license_number)
  where status = 'approved';

create index if not exists broker_license_appeals_pending_idx
  on public.broker_license_appeals (created_at desc)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- הרשאות: כתיבה ב-service_role בלבד (אין policy ל-insert/update/delete,
-- ו-service_role עוקף RLS ממילא). קריאה — הנהלת הפלטפורמה בלבד.
--
-- ‏anon לא מקבל/ת כלום, גם לא קריאה: הטבלה מכילה שם, אימייל וטלפון של מי
-- שנחסם/ה. הפונה מקבל/ת את התשובה במייל, לא בשאילתה.
-- ---------------------------------------------------------------------------
alter table public.broker_license_appeals enable row level security;
revoke all on public.broker_license_appeals from anon;

drop policy if exists broker_license_appeals_admin_read on public.broker_license_appeals;
create policy broker_license_appeals_admin_read on public.broker_license_appeals
  for select to authenticated
  using ((select public.current_is_platform_admin()));


-- ---------------------------------------------------------------------------
-- 4. הדלי — והוא **פרטי**, בניגוד לכל הדליים האחרים בפרויקט
--
-- ‏property-images, property-videos ו-property-tours כולם ציבוריים, כי מה
-- שיושב בהם מוצג בדף נכס פומבי. כאן ההפך: צילום של רישיון תיווך הוא מסמך
-- מזהה. ‏public=false אומר שאין לו כתובת שנפתחת בדפדפן — הצפייה היחידה היא
-- דרך קישור חתום קצר-מועד ש-broker-license-appeal מייצר למנהל/ת הפלטפורמה.
--
-- אין כאן אף policy על storage.objects, ובכוונה: ההעלאה עצמה נעשית
-- ב-service_role מתוך הפונקציה ולא מהדפדפן. לדפדפן אין גישה לדלי הזה
-- בכלל — לא קריאה, לא כתיבה ולא מחיקה.
--
-- ‏allowed_mime_types סוגר את הדלת בפני קבצים שאינם תמונה או PDF, ו-
-- ‏file_size_limit מגביל ל-5MB: צילום רישיון, לא ארכיון.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'broker-licenses', 'broker-licenses', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- 5. נעילת השדות החדשים מול הדפדפן
--
-- בלי זה כל השער עוקף בשורת update אחת מה-console: סוכן/ת שנחסם/ה כותב/ת
-- לעצמו/ה ‎license_status='verified'‎ וממשיך/ה כרגיל.
--
-- ונעילה שנייה, פחות מובנת מאליה: **‏license_number עצמו נעול אחרי אימות
-- מוצלח.** הבדיקה חד-פעמית בכניסה, ולכן בלי הנעילה הזו אפשר להיכנס עם
-- מספר תקף ואז להחליף אותו — והשער היה קישוט. מי שעדיין לא אומת/ה
-- (‏not_found, unverified) ממשיך/ה לערוך את המספר בחופשיות, וזה בדיוק
-- המסלול של תיקון שגיאת הקלדה.
--
-- הפונקציה נכתבת כאן במלואה (‏create or replace) ולא "מתוקנת" — זו הדרך
-- היחידה ב-Postgres, ולכן כל מה שהיה בה ב-20261018090000 נשמר מילה במילה.
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
  end if;
  return new;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 6. מתגי המדיניות
--
-- ‏pricing_config מחזיק מספרים בלבד, ולכן כל המתגים הם 1/0. מזהה מערך
-- הנתונים ושמות העמודות **אינם** כאן אלא במשתני סביבה של פונקציית הקצה
-- (‏BROKER_REGISTRY_RESOURCE_ID וחבריו) — הם מחרוזות, והם פרט תפעולי של
-- אינטגרציה ולא מספר עסקי.
--
-- שימו לב ש-broker_registry_block_unknown הוא 1 כברירת מחדל, בניגוד
-- למקבילו ברשם החברות. זה השינוי המהותי, וזו השורה שמכבים אם מתברר
-- שהמאגר חוסם אנשים אמיתיים בכמות.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('broker_registry_enabled', 1,
   'אימות רישיון תיווך מול רשם המתווכים בכניסה (1=פעיל, 0=כבוי — הכניסה ממשיכה בלי לשאול)'),
  ('broker_registry_block_unknown', 1,
   'האם לחסום כניסה כשמספר הרישיון לא נמצא במאגר (1=חוסם, 0=נרשם ומוצג בלבד). לא נוגע ב-unverified, שלעולם אינו חוסם'),
  ('broker_registry_cache_days', 30,
   'כמה ימים תשובת רשם המתווכים נחשבת טרייה לפני בדיקה חוזרת')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;


-- ---------------------------------------------------------------------------
-- 7. מי שכבר בפנים נשאר בפנים
--
-- השער הוא על ה**כניסה**, והוא חד-פעמי. כל מי שכבר במערכת ברגע ההרצה לא
-- עבר/ה אותו מעולם, ולכן מסומן/ת כ-unverified — שאינו חוסם ואינו מסתיר
-- שהבדיקה לא נעשתה. סימון גורף כ-verified היה שקר בנתונים; חסימה רטרואקטיבית
-- הייתה מוציאה מהאוויר משרדים פעילים בלי התראה.
--
-- ‏license_checked_at נשאר NULL בדיוק בשביל ההבחנה הזו: "לא נבדק/ה מעולם"
-- אינו "נבדק/ה ולא נמצא/ה".
--
-- אין כאן שורת UPDATE: ‏default 'unverified' בסעיף 1 כבר עושה את זה לכל
-- השורות הקיימות, וזו הנקודה — הרשימה של מי שלא נבדק/ה מתקבלת מהאינדקס
-- ‏agency_members_license_attention_idx, ואפשר לעבור עליה בקצב אנושי.
-- ---------------------------------------------------------------------------

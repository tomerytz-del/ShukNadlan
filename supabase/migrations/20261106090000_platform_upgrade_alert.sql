-- ============================================================================
-- התראת שדרוג מסלול למנהל/ת הפלטפורמה
--
-- ‏`platform_signup` אומר מי נכנס. הסוג שנוסף כאן אומר **מי התחיל לשלם** —
-- או, בשלב שבו אין סליקה, **מי ביקש** ומחכה שיחזרו אליו.
--
-- ## למה כאן זה כן טריגר במסד
--
-- ההפך מ-`platform_signup` (ראו `_shared/platform-signup-alert.ts`): שם
-- הבעיה הייתה שהמסלול עוד לא נקבע ברגע היצירה. כאן המסלול **הוא** האירוע,
-- והוא כבר נרשם בטבלה אחת שכל המסלולים עוברים דרכה — `tier_changes`,
-- שנכתבת ב-‎record_tier_selection‎, ב-‎grant_launch_promo‎, ב-
-- ‎expire_launch_promos‎, ב-‎admin_approve_tier_change‎ ומ-‎join-agency‎.
-- טריגר עליה תופס את כולם, כולל מסלול תשלום שייכתב בעתיד.
--
-- ## מה נחשב אירוע, ומה לא
--
-- שדרוג הוא מעבר **למסלול בתשלום** (`mid`/`premium`) שמישהו בחר או אישר.
-- שלושה מקורות מסוננים החוצה במפורש, וכל אחד מהם מסיבה אחרת:
--
--   ‏· `launch_promo` ו-`launch_promo_accepted` — Elite של הטבת ההשקה. זה
--     ‏premium שלא נכנס עליו שקל, וכל מצטרף/ת מקבל/ת אותו. התראה עליו היא
--     בדיוק אותה התראה של `platform_signup`, פעמיים.
--   ‏· `promo_expired` — ירידה ל-Pay&GO בתום ההטבה. לא שדרוג.
--   ‏· `request_rejected` — בקשה שנדחתה. ההחלטה היא של מי שמקבל/ת את
--     ההתראה; אין לו/ה מה לספר לעצמו/ה.
--
-- מה שנשאר: `requested` (בקשה שממתינה), `paid` (תשלום שאומת),
-- ‏`platform_admin` (אישור ידני) ו-`self`.
--
-- ## למה גם `requested`, ולא רק תשלום
--
-- כי בלי סליקה **אין** `paid`. המסלול היחיד שחי כרגע הוא: הסוכן/ת מבקש/ת
-- ‏(`requested`), מישהו מסדיר תשלום מחוץ לאתר, ומאשר/ת ידנית
-- ‏(`platform_admin`). התראה שממתינה ל-`paid` הייתה שותקת לגמרי בדיוק
-- בתקופה הזו — ודווקא הבקשה היא זו שדורשת אדם.
--
-- הבקשה כבר שולחת מייל להנהלה מ-`join-agency`; מה שנוסף כאן הוא הפעמון,
-- ודרכו הוואטסאפ.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. סוג ההתראה
--
-- נפרד מ-`platform_signup` ולא מוזג לתוכו: הצטרפות ושדרוג הן שתי שאלות
-- עסקיות שונות ("כמה נכנסו" מול "כמה משלמים"), ומי שירצה לכבות אחת מהן
-- בוואטסאפ ולהשאיר את השנייה צריך שתי תיבות. הרשימה נכתבת במלואה — זו
-- הדרך היחידה לשנות CHECK.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert',
                  'client_match','review_new','deal_closed','lead_unrouted',
                  'marketing_copy','agreement_signed','platform_signup',
                  'platform_upgrade'));

-- ---------------------------------------------------------------------------
-- 2. הטריגר
--
-- ‏security definer: הוא רץ בהקשר של מי ששינה/תה את המסלול — סוכן/ת שאין
-- לו/ה שום גישה לשורות של מנהל/ת הפלטפורמה.
--
-- שמות המסלולים המסחריים מופיעים כאן במפורש. מקור האמת שלהם הוא
-- ‏`assets/tiers.js` ו-`_shared/launch-promo.ts`, ושינוי שם שם מחייב את
-- השורה הזו — מחיר מקובל על הודעה שאומרת "Elite" ולא "premium".
-- ---------------------------------------------------------------------------
create or replace function public.notify_platform_admins_on_tier_upgrade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_member   record;
  v_agency   text;
  v_from     text;
  v_to       text;
  v_title    text;
  v_body     text;
begin
  -- מסלול חינמי או ביטול אינם שדרוג
  if new.to_tier not in ('mid', 'premium') then
    return new;
  end if;
  -- הטבת ההשקה אינה תשלום, ודחייה אינה החלטה חדשה
  if new.source in ('launch_promo', 'launch_promo_accepted', 'promo_expired', 'request_rejected') then
    return new;
  end if;
  -- מעבר לאותו מסלול הוא רישום ולא מעבר
  if new.from_tier is not distinct from new.to_tier then
    return new;
  end if;

  select m.display_name, a.name as agency_name
    into v_member
    from agency_members m
    left join agencies a on a.id = m.agency_id
   where m.id = new.member_id;

  v_agency := coalesce(v_member.agency_name, '');
  v_from := case new.from_tier
              when 'free' then 'Pay&GO' when 'mid' then 'PROFESSIONAL'
              when 'premium' then 'Elite' else coalesce(new.from_tier, 'ללא מסלול') end;
  v_to   := case new.to_tier
              when 'mid' then 'PROFESSIONAL' when 'premium' then 'Elite'
              else new.to_tier end;

  -- בקשה היא משימה, שדרוג הוא בשורה. אותה שורה בטבלה, שתי כותרות שונות —
  -- כי מי שקורא/ת את ההודעה צריך/ה לדעת מיד אם נדרשת פעולה.
  if new.source = 'requested' then
    v_title := 'בקשת שדרוג מסלול: ' || coalesce(v_member.display_name, 'סוכן/ת');
    v_body  := concat_ws(' · ', nullif(v_agency, ''), v_from || ' ← ' || v_to,
                         'ממתינה לאישור', nullif(btrim(coalesce(new.note, '')), ''));
  else
    v_title := 'שדרוג מסלול: ' || coalesce(v_member.display_name, 'סוכן/ת');
    v_body  := concat_ws(' · ', nullif(v_agency, ''), v_from || ' ← ' || v_to,
                         nullif(btrim(coalesce(new.note, '')), ''));
  end if;

  for v_admin_id in
    select id from agency_members where is_platform_admin = true and active = true
  loop
    insert into notifications (agent_id, type, title, body)
    values (v_admin_id, 'platform_upgrade', v_title, v_body);
  end loop;

  return new;
end;
$$;

comment on function public.notify_platform_admins_on_tier_upgrade() is
  'מודיעה למנהלי הפלטפורמה על מעבר למסלול בתשלום, ועל בקשת שדרוג שממתינה. מסננת את הטבת ההשקה, את פקיעתה ואת הדחיות.';

revoke execute on function public.notify_platform_admins_on_tier_upgrade() from anon, authenticated;

drop trigger if exists tier_changes_notify_platform_admins on public.tier_changes;
create trigger tier_changes_notify_platform_admins
  after insert on public.tier_changes
  for each row execute function public.notify_platform_admins_on_tier_upgrade();

-- ---------------------------------------------------------------------------
-- 3. הדלקת הערוץ למנהלי הפלטפורמה
--
-- אותו חריג מכוון בדיוק כמו ב-20261104090000, ומאותה סיבה: הנמען/ת היחיד/ה
-- של הסוג הזה הוא/היא מנהל/ת הפלטפורמה, וההתראה נבנתה לבקשתו/ה.
--
-- ‏array_append עם ‎::text‎ מפורש ולא ‎||‎ על ליטרל — ראו את ההערה
-- ב-20261104090000: שם הצורה השנייה הפילה את הקובץ כולו ב-22P02.
-- ---------------------------------------------------------------------------
update public.agent_notification_preferences p
   set whatsapp_types = array_append(p.whatsapp_types, 'platform_upgrade'::text),
       updated_at     = now()
  from public.agency_members m
 where m.id = p.agent_id
   and m.is_platform_admin = true
   and not ('platform_upgrade' = any(p.whatsapp_types));

insert into public.agent_notification_preferences (agent_id, whatsapp_types)
select m.id, array['platform_upgrade']::text[]
  from public.agency_members m
 where m.is_platform_admin = true
   and not exists (
     select 1 from public.agent_notification_preferences p where p.agent_id = m.id
   );

-- ============================================================================
-- השעיית סוכן/ת = ניתוק מהמשרד, והנכסים עוברים איתו/ה
--
-- עד היום "השעיה" הייתה `active = false` ותו לא, ובפועל היא גם לא חסמה כלום:
-- שום מקום בקוד לא בדק את הדגל הזה בכניסה, ולכן סוכן/ת "מושעה/ת" המשיך/ה
-- להיכנס לדשבורד כרגיל. הפעולה נראתה חמורה ולא עשתה דבר.
--
-- המודל החדש: השעיה היא ניתוק. הסוכן/ת יוצא/ת מהמשרד, ובכניסה הבאה מקבל/ת
-- מסך ייעודי שמסביר זאת ומציע לפתוח משרד משלו/ה. כשהמשרד נפתח
-- (create-own-agency), **שורת ה-agency_members הקיימת עוברת** למשרד החדש
-- במקום שתיווצר שורה חדשה — אותו `id` בדיוק. זו הנקודה שבה הנכסים עוברים
-- מעצמם: כל מה שמפתח על agent_id ממשיך להצביע לאותו אדם, ורק ה-agency_id
-- המשוכפל צריך יישור.
--
-- שלוש עמודות, ולא דגל בודד: צריך לדעת גם **ממי** נותק (כדי לומר לו/ה את שם
-- המשרד במסך) וגם **מי** ניתק, כי זו פעולה שמישהו צריך לעמוד מאחוריה.
-- ============================================================================

alter table public.agency_members
  add column if not exists released_at              timestamptz,
  add column if not exists released_from_agency_id  uuid,
  add column if not exists released_by              uuid;

comment on column public.agency_members.released_at is
  'נותק/ה מהמשרד על ידי מנהל/ת. בכניסה הבאה מוצג מסך הניתוק, והשורה תעבור למשרד שייפתח.';

-- החיפוש היחיד על העמודה הוא "מי מנותק/ת אצלי במשרד" ברשימת הצוות
create index if not exists agency_members_released_idx
  on public.agency_members (released_from_agency_id)
  where released_at is not null;

-- ---------------------------------------------------------------------------
-- נעילת שלוש העמודות לכתיבה מהשרת בלבד
--
-- מדיניות ה-UPDATE על agency_members היא USING בלבד, בלי WITH CHECK, ולכן
-- מנהל/ת יכול/ה לעדכן כל עמודה בשורה של חבר/ת צוות ישירות מהדפדפן. ניתוק
-- הוא לא עוד שדה בטופס: הוא צריך לעבור דרך release-team-member, שבודק שלא
-- מנתקים את המנהל/ת האחרון/ה ולא את עצמך. בלי הנעילה כאן, אותן בדיקות
-- היו עקיפות בשורת update אחת מה-console.
--
-- הפונקציה משוכפלת במלואה מ-20260829230000 ולא "מתוקנת" — create or replace
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

  -- ניתוק מהמשרד — דרך release-team-member בלבד (ראו ההסבר למעלה)
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
-- מעבר הסוכן/ת המנותק/ת למשרד שפתח/ה — פעולה אחת, טרנזקציה אחת
--
-- זו הנקודה שבה "הנכסים עוברים איתו/ה" קורה בפועל, והיא כתובה כאן ולא
-- ב-Edge Function מסיבה אחת: PostgREST מבצע כל update כטרנזקציה נפרדת.
-- רצף של חמישה update-ים מהפונקציה היה יכול להיעצר באמצע — הסוכן/ת כבר
-- במשרד החדש, הנכסים עדיין רשומים על הישן. זה בדיוק המצב השבור שאין ממנו
-- דרך חזרה בממשק, ולכן הכל נכנס לפונקציה אחת שנופלת או מצליחה כמקשה אחת.
--
-- ‏agency_members.id **אינו** משתנה. זו כל התחכום: כל מה שמפתח על agent_id
-- (נכסים, לידים, לקוחות, דירוגים, התראות) ממשיך להצביע לאותו אדם מעצמו,
-- ורק ה-agency_id המשוכפל צריך יישור — אחרת המשרד הישן ימשיך לראות את
-- הנכסים של מי שכבר לא אצלו.
--
-- מה **לא** עובר, במכוון:
--   • ‏agent_share_exclusions — ה-agency_id שם הוא המשרד ש*ממנו* הוסתר
--     שיתוף, לא המשרד של הסוכן/ת. עדכון שלו היה הופך את ההעדפה למשהו אחר.
--   • היסטוריה כספית (lead_charges, invoices, contracts, promotion_charges,
--     wallet_topups, market_deals, *_lead_purchases) — אלה רישומי עסקאות
--     שקרו תחת המשרד הישן. העברה שלהן הייתה משכתבת את הספרים שלו.
--   • ‏reviews — ביקורות נכתבו על עבודה שנעשתה שם, וזה נכון היסטורית.
-- ---------------------------------------------------------------------------
create or replace function public.adopt_released_member_into_agency(
  p_member_id      uuid,
  p_agency_id      uuid,
  p_display_name   text,
  p_license_number text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_agency uuid;
  v_slug       text;
  v_tier       text;
  v_props   int := 0;
  v_leads   int := 0;
  v_clients int := 0;
  v_shares  int := 0;
begin
  -- ‏for update נועל את השורה לכל אורך הטרנזקציה: שתי לחיצות על "פתיחת
  -- המשרד שלי" לא ייצרו שני משרדים ולא יעבירו את הנכסים פעמיים
  select released_from_agency_id, slug, tier
    into v_old_agency, v_slug, v_tier
    from agency_members
   where id = p_member_id and released_at is not null
     for update;
  if not found then
    raise exception 'member_not_released' using errcode = 'P0002';
  end if;

  update agency_members set
      agency_id               = p_agency_id,
      role                    = 'manager',
      active                  = true,
      released_at             = null,
      released_from_agency_id = null,
      released_by             = null,
      display_name            = coalesce(nullif(btrim(p_display_name), ''), display_name),
      license_number          = coalesce(nullif(btrim(p_license_number), ''), license_number)
    where id = p_member_id;

  -- ‏tier, credit_balance ושדות החיוב לא נגעו בהם בכוונה: היתרה היא כספו/ה
  -- של הסוכן/ת, ושינוי מסלול הוא החלטת חיוב שעוברת במסלול שלה.

  update properties     set agency_id       = p_agency_id where agent_id       = p_member_id;
  get diagnostics v_props   = row_count;
  update leads          set agency_id       = p_agency_id where agent_id       = p_member_id;
  get diagnostics v_leads   = row_count;
  update agent_clients  set agency_id       = p_agency_id where agent_id       = p_member_id;
  get diagnostics v_clients = row_count;
  update property_shares set owner_agency_id = p_agency_id where owner_agent_id = p_member_id;
  get diagnostics v_shares  = row_count;

  return jsonb_build_object(
    'member_slug',      v_slug,
    'tier',             v_tier,
    'from_agency_id',   v_old_agency,
    'properties_moved', v_props,
    'leads_moved',      v_leads,
    'clients_moved',    v_clients,
    'shares_moved',     v_shares
  );
end;
$$;

-- ‏security definer + ביטול ההרשאה מהדפדפן: הפונקציה מעבירה נכסים בין
-- משרדים, ולכן היא נקראת אך ורק מ-create-own-agency עם service role.
revoke all on function public.adopt_released_member_into_agency(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.adopt_released_member_into_agency(uuid, uuid, text, text)
  to service_role;

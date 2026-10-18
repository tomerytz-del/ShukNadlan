-- ===========================================================================
-- מדריך ההתחלה: שבעה צעדים בשני שלבים, לפי דחיפות
-- ---------------------------------------------------------------------------
-- שלב 7 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 7;
-- docs/agent-onboarding.md). קודם להופיע באתר, אחר כך להתחיל לעבוד:
--
--   להופיע באתר     1. אימות רישיון   2. תמונה, משפט ואזורים   3. הנכס הראשון
--   להתחיל לעבוד    4. גבריאלה   5. הלקוח/ה הראשון/ה   6. יומן Google   7. העדפות לידים
--   רשות            תמונת נושא וניסיון · ביקורת ראשונה · (מנהל/ת) לוגו ו"על המשרד" · הזמנת סוכנים
--
-- מה בקובץ:
--   1. ‏agent_license_ok(): התנאי היחיד ל"רישיון מאושר". עד היום הוא היה
--      כתוב בתוך agency_members_release_license_hold בלבד; המדריך היה עותק
--      שני שמתפצל. עכשיו שניהם קוראים לו.
--   2. ‏agent_onboarding_state() מוגדרת מחדש. ‏returns table שמשתנה מחייב
--      drop + create (create or replace נכשל), ואחריו ההרשאות כמו קודם.
--      העמודות הקיימות במקומן, והחדשות **בסוף**.
--   3. ‏agent_onboarding_active() בלי גייט מסלול: המדריך פתוח עכשיו לכל
--      המסלולים, וגבריאלה והיומן מוצגים כ"במסלול..." למי שאינם כלולים בו.
--
-- נשאר אותו עיקרון: המצב מחושב בכל קריאה מהמציאות, ואין צ'קליסט שמסמנים.
-- נכס או לקוח/ה שנפתחו דרך גבריאלה סוגרים צעד בדיוק כמו מהטופס.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. רישיון מאושר: תנאי אחד
-- ---------------------------------------------------------------------------
-- אותו תנאי של agency_members_public (שדף הסוכן/ת והמשרד נשענים עליו) ושל
-- שחרור המודעות. ‏immutable, על הערכים ולא על מזהה - כדי שהטריגר יוכל לקרוא
-- לו עם new.* בלי לקרוא את השורה שוב.
create or replace function public.agent_license_ok(p_license_number text, p_license_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_license_number is not null
     and coalesce(p_license_status, '') not in ('not_found', 'inactive');
$$;

revoke all on function public.agent_license_ok(text, text) from public, anon, authenticated;
comment on function public.agent_license_ok(text, text) is
  'רישיון תיווך מאושר: התנאי היחיד, לשחרור המודעות (agency_members_release_license_hold) ולמדריך ההתחלה. docs/agent-onboarding.md';

-- הגוף מההגדרה החיה (20270216090000_license_hold.sql), עם התנאי מהפונקציה
create or replace function public.agency_members_release_license_hold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if not public.agent_license_ok(new.license_number, new.license_status) then
    return null;
  end if;

  for r in
    select id from public.properties
     where agent_id = new.id and license_hold_at is not null and status = 'unpublished'
  loop
    begin
      update public.properties set status = 'active', license_hold_at = null where id = r.id;
    exception when others then
      update public.properties set license_hold_at = null where id = r.id;
      raise warning 'license hold release skipped property %: %', r.id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. המצב
-- ---------------------------------------------------------------------------
drop function if exists public.agent_onboarding_state();

create function public.agent_onboarding_state()
returns table (
  is_manager        boolean,
  whatsapp_done     boolean,
  profile_done      boolean,
  agency_done       boolean,
  property_done     boolean,
  client_done       boolean,
  agreement_done    boolean,
  lead_done         boolean,
  just_finished     boolean,
  about_done        boolean,
  -- מכאן החדשות (20270602100000)
  license_done      boolean,
  bio_done          boolean,
  calendar_done     boolean,
  prefs_done        boolean,
  cover_done        boolean,
  review_done       boolean,
  invite_done       boolean,
  -- המסלול כולל את גבריאלה ואת היומן (mid / premium). שני הצעדים לא נספרים בלעדיו
  whatsapp_included boolean,
  agent_steps       boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id       uuid := public.current_agent_id();
  v_member   record;
  v_mgr      boolean;
  v_wa       boolean;
  v_wa_in    boolean;
  v_profile  boolean;
  v_agency   boolean;
  v_prop     boolean;
  v_client   boolean;
  v_agr      boolean;
  v_lead     boolean;
  v_about    boolean;
  v_license  boolean;
  v_bio      boolean;
  v_cal      boolean;
  v_prefs    boolean;
  v_cover    boolean;
  v_review   boolean;
  v_invite   boolean;
  v_agent    boolean;
  v_complete boolean;
  v_just     boolean := false;
  v_rows     integer;
begin
  if v_id is null then
    return;                       -- אין כרטיס סוכן/ת: אין מדריך, ואין שגיאה
  end if;

  select m.id, m.role, m.tier, m.active, m.agency_id, m.photo_url, m.cover_url, m.bio,
         m.service_markets, m.years_experience, m.specialties, m.is_active_agent,
         m.license_number, m.license_status,
         m.onboarding_started_at, m.onboarding_done_at
    into v_member
    from agency_members m
   where m.id = v_id;

  -- ‏בלי גייט מסלול (עד 20270602100000 רק mid/premium): הרישיון, הפרופיל
  -- והנכס הראשון נחוצים לכל מסלול. גבריאלה, שמגודרת, מסומנת בנפרד.
  if not found or v_member.active is not true then
    return;
  end if;

  if v_member.onboarding_done_at is not null then
    return;                       -- הושלם או הוסתר - ולתמיד
  end if;

  v_prop   := exists (select 1 from properties    p where p.agent_id = v_id);
  v_client := exists (select 1 from agent_clients c where c.agent_id = v_id);

  -- הפתיחה: רק למי שעוד לא התחיל/ה לעבוד. ותיק/ה שחסרה לו/ה תמונת פרופיל
  -- אינו/ה "סוכן/ת חדש/ה", וכרטיס "מדריך ההתחלה" אצלו/ה נראה כמו תקלה.
  if v_member.onboarding_started_at is null then
    if v_prop or v_client then
      return;
    end if;
    update agency_members
       set onboarding_started_at = now()
     where id = v_id
       and onboarding_started_at is null;
  end if;

  v_mgr     := coalesce(v_member.role, '') = 'manager';
  v_agent   := coalesce(v_member.is_active_agent, true);
  v_wa_in   := coalesce(v_member.tier, '') in ('mid', 'premium');
  v_wa      := exists (select 1 from whatsapp_conversations w where w.agent_id = v_id);
  v_agr     := exists (select 1 from agreements a where a.agent_id = v_id);
  v_lead    := public.agent_onboarding_lead_done(v_id);
  v_profile := btrim(coalesce(v_member.photo_url, '')) <> '';
  v_agency  := case when v_mgr
                    then coalesce((select btrim(coalesce(a.logo_url, '')) <> ''
                                     from agencies a where a.id = v_member.agency_id), false)
                    else true end;
  v_about   := case when v_mgr
                    then coalesce((select btrim(coalesce(a.description, '')) <> ''
                                     from agencies a where a.id = v_member.agency_id), false)
                    else true end;

  v_license := public.agent_license_ok(v_member.license_number, v_member.license_status);
  -- "משפט עליך": 20 תווים לפחות - החלטה של תומר (18.10.2026)
  v_bio     := v_profile
           and length(btrim(coalesce(v_member.bio, ''))) >= 20
           and cardinality(coalesce(v_member.service_markets, '{}'::text[])) > 0;
  v_cal     := exists (select 1 from agent_calendar_connections c
                        where c.agent_id = v_id and c.status = 'active');
  v_prefs   := exists (select 1 from agent_lead_preferences p
                        where p.agent_id = v_id and p.active);
  v_cover   := btrim(coalesce(v_member.cover_url, '')) <> ''
           and (v_member.years_experience is not null
                or cardinality(coalesce(v_member.specialties, '{}'::text[])) > 0);
  -- ביקורת שהתקבלה מלקוח/ה (reviews), ולא review_requests - זו נכתבת
  -- אוטומטית כשליד מבשיל, ואינה פעולה של הסוכן/ת
  v_review  := exists (select 1 from reviews r where r.agent_id = v_id);
  v_invite  := case when v_mgr
                    then exists (select 1 from agency_invitations i where i.agency_id = v_member.agency_id)
                    else true end;

  -- "המדריך הושלם": שבעת הצעדים. גבריאלה והיומן נספרים רק כשהם במסלול
  -- (שניהם mid / premium, docs/pricing-and-tiers.md, docs/google-calendar.md). מנהל/ת
  -- שאינו/ה סוכן/ת פעיל/ה (is_active_agent = false) רואה רק את צעדי המשרד.
  if v_agent then
    v_complete := v_license and v_bio and v_prop and (v_wa or not v_wa_in)
              and v_client and (v_cal or not v_wa_in) and v_prefs;
  else
    v_complete := v_agency and v_about and v_invite;
  end if;

  if v_complete then
    update agency_members
       set onboarding_done_at = now()
     where id = v_id
       and onboarding_done_at is null;
    get diagnostics v_rows = row_count;
    v_just := v_rows > 0;
  end if;

  return query select
    v_mgr, v_wa, v_profile, v_agency, v_prop, v_client, v_agr, v_lead, v_just, v_about,
    v_license, v_bio, v_cal, v_prefs, v_cover, v_review, v_invite, v_wa_in, v_agent;
end;
$$;

revoke all on function public.agent_onboarding_state() from public, anon, authenticated;
grant execute on function public.agent_onboarding_state() to authenticated;
comment on function public.agent_onboarding_state() is
  'מדריך ההתחלה: שבעה צעדים בשני שלבים ועוד צעדי רשות, מחושבים מהמציאות בכל קריאה. אפס שורות = אין מדריך. docs/agent-onboarding.md';

-- ---------------------------------------------------------------------------
-- 3. הדרבון בפעמון: אותו תנאי פתיחה, בלי גייט מסלול
-- ---------------------------------------------------------------------------
create or replace function public.agent_onboarding_active(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from agency_members m
     where m.id = p_agent_id
       and m.active = true
       and m.onboarding_started_at is not null
       and m.onboarding_done_at is null
  );
$$;

revoke all on function public.agent_onboarding_active(uuid) from public, anon, authenticated;

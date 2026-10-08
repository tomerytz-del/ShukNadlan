-- ===========================================================================
-- תמונת הנושא היא של המשרד בלבד — צעד 2 במדריך ההתחלה הוא תמונת פרופיל
-- ===========================================================================
--
-- עד היום לכל סוכן/ת הייתה תמונת נושא אישית (‏agency_members.cover_url)
-- שגברה על תמונת המשרד בראש דף הסוכן/ת. מעכשיו תמונת הנושא נקבעת בידי
-- מנהל/ת המשרד בלבד (‏agencies.cover_url, נאכף ב-RLS ‏"manager update own
-- agency") וחלה על דפי כל הסוכנים שלו. ‏agent.html, ה-CRM, דף הבית
-- והעוזר בוואטסאפ כבר אינם קוראים ואינם כותבים את העמודה האישית.
--
-- ומה שנשבר בלי המיגרציה הזו: ‏agent_onboarding_photos_done() ו-
-- ‏agent_onboarding_state() דורשות photo_url **וגם** cover_url. סוכן/ת
-- חדש/ה שאין לו/ה עוד דרך להעלות תמונת נושא היה/הייתה נתקע/ת בצעד 2
-- לתמיד, והדרבון "הנכס הראשון שלך" לא היה יוצא אף פעם.
--
-- מה כאן:
--   1. ‏agent_onboarding_photos_done — תמונת פרופיל, ולמנהל/ת גם לוגו
--      ותמונת נושא למשרד (ללא שינוי בחלק של המשרד).
--   2. ‏agent_onboarding_state — ‏profile_done = תמונת פרופיל בלבד.
--   3. הטריגר על agency_members נורה על photo_url בלבד.
--
-- העמודה agency_members.cover_url **נשארת**, עם הערכים שבה: היא חשופה
-- ב-view ‏agency_members_public, ומחיקה שלה הייתה שוברת קוראים ישנים בלי
-- שום רווח. היא פשוט אינה מוצגת יותר. הפרטים: docs/agency-page.md, סעיף 10.
-- ===========================================================================

create or replace function public.agent_onboarding_photos_done(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select btrim(coalesce(m.photo_url, '')) <> ''
       and (coalesce(m.role, '') <> 'manager'
            or coalesce((
                 select btrim(coalesce(a.logo_url, '')) <> ''
                    and btrim(coalesce(a.cover_url, '')) <> ''
                   from agencies a
                  where a.id = m.agency_id), false))
      from agency_members m
     where m.id = p_agent_id), false);
$$;

comment on function public.agent_onboarding_photos_done(uuid) is
  'האם צעד התמונות נסגר: תמונת סוכן/ת, ולמנהל/ת משרד גם לוגו ותמונת נושא למשרד. תמונת הנושא היא של המשרד בלבד.';

create or replace function public.agent_onboarding_state()
returns table (
  is_manager     boolean,
  whatsapp_done  boolean,
  profile_done   boolean,
  agency_done    boolean,
  property_done  boolean,
  client_done    boolean,
  agreement_done boolean,
  lead_done      boolean,
  just_finished  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid := public.current_agent_id();
  v_member   record;
  v_wa       boolean;
  v_photos   boolean;
  v_profile  boolean;
  v_agency   boolean;
  v_prop     boolean;
  v_client   boolean;
  v_agr      boolean;
  v_lead     boolean;
  v_just     boolean := false;
  v_rows     integer;
begin
  if v_id is null then
    return;                       -- אין כרטיס סוכן/ת: אין מדריך, ואין שגיאה
  end if;

  select m.id, m.role, m.tier, m.active, m.agency_id, m.photo_url,
         m.onboarding_started_at, m.onboarding_done_at
    into v_member
    from agency_members m
   where m.id = v_id;

  if not found or v_member.active is not true
     or v_member.tier not in ('mid', 'premium') then
    return;
  end if;

  if v_member.onboarding_done_at is not null then
    return;                       -- הושלם או הוסתר — ולתמיד
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

  v_wa      := exists (select 1 from whatsapp_conversations w where w.agent_id = v_id);
  v_agr     := exists (select 1 from agreements a where a.agent_id = v_id);
  v_lead    := public.agent_onboarding_lead_done(v_id);
  v_photos  := public.agent_onboarding_photos_done(v_id);
  -- ‏profile_done ו-agency_done מוחזרים בנפרד כדי שהכרטיס יוכל לומר *מה*
  -- חסר; ‏v_photos הוא ה-and שלהם, והוא מה שנבדק בכל מקום אחר.
  v_profile := btrim(coalesce(v_member.photo_url, '')) <> '';
  v_agency  := case when coalesce(v_member.role, '') = 'manager'
                    then coalesce((select btrim(coalesce(a.logo_url, '')) <> ''
                                      and btrim(coalesce(a.cover_url, '')) <> ''
                                     from agencies a where a.id = v_member.agency_id), false)
                    else true end;

  if v_wa and v_photos and v_prop and v_client and v_agr and v_lead then
    update agency_members
       set onboarding_done_at = now()
     where id = v_id
       and onboarding_done_at is null;
    get diagnostics v_rows = row_count;
    v_just := v_rows > 0;
  end if;

  return query select
    coalesce(v_member.role, '') = 'manager',
    v_wa, v_profile, v_agency, v_prop, v_client, v_agr, v_lead, v_just;
end;
$$;

comment on function public.agent_onboarding_state() is
  'מצב מדריך ההתחלה של הסוכן/ת המחובר/ת. מחזירה שורה אחת כשהמדריך פתוח, ואפס שורות אחרת. מחושבת מהמציאות, ומחזיקה את שתי החותמות.';

-- הטריגר: רק תמונת הפרופיל סוגרת את החצי האישי של הצעד
drop trigger if exists agency_members_onboarding_nudge on public.agency_members;
create trigger agency_members_onboarding_nudge
  after update of photo_url on public.agency_members
  for each row
  when (new.photo_url is distinct from old.photo_url)
  execute function public.agency_members_onboarding_nudge();

-- הרשאות — create or replace שומר אותן, אבל הן נכתבות שוב כדי שהקובץ יעמוד בפני עצמו
revoke all on function public.agent_onboarding_photos_done(uuid) from public, anon, authenticated;
revoke all on function public.agent_onboarding_state() from public, anon;
grant execute on function public.agent_onboarding_state() to authenticated;

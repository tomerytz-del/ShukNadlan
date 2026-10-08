-- ===========================================================================
-- מדריך ההתחלה: שלושה צעדים במקום שבעה
-- ===========================================================================
--
-- המדריך מנה גבריאלה, תמונות, נכס, לקוח/ה, הסכם וליד (ולמנהל/ת גם מיתוג).
-- שבעה צעדים נקראו כמשימה כבדה לפני שהתחילו, וארבעה מהם הם עבודה רגילה
-- ולא "הקמה". מעכשיו:
--
--   1. גבריאלה בוואטסאפ          (יש שורה ב-whatsapp_conversations)
--   2. הנכס הראשון               (יש שורה ב-properties)
--   3. תמונת פרופיל, ולמנהל/ת גם לוגו המשרד
--
-- תמונת הנושא של המשרד כבר אינה תנאי לצעד 3: היא רצויה, אבל "לוגו ותמונת
-- פרופיל" הוא מה שהופך את הכרטיס לממותג. יומן Google אינו צעד בכלל - הוא
-- מוצע ברגע שנקבעת פגישה, ראו docs/google-calendar.md.
--
-- מה כאן:
--   1. ‏agent_onboarding_photos_done — תמונת פרופיל, ולמנהל/ת לוגו.
--   2. ‏agent_onboarding_state — ‏agency_done = לוגו, והמדריך נסגר על שלושת
--      הצעדים. שאר הדגלים (לקוח, הסכם, ליד) עדיין מוחזרים, לתאימות.
--   3. שלושת טריגרי הדרבון של הנכס, הלקוח וההסכם יורדים: הם דרבנו לצעדים
--      שכבר אינם במדריך. הדרבון היחיד שנשאר הוא onboarding_property,
--      אחרי שמירת התמונה. הפונקציות עצמן נשארות (לא נקראות), כדי
--      שהחזרה תהיה טריגר אחד ולא שכתוב.
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
                   from agencies a
                  where a.id = m.agency_id), false))
      from agency_members m
     where m.id = p_agent_id), false);
$$;

comment on function public.agent_onboarding_photos_done(uuid) is
  'צעד 3 במדריך ההתחלה: תמונת סוכן/ת, ולמנהל/ת משרד גם לוגו המשרד.';

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
                                     from agencies a where a.id = v_member.agency_id), false)
                    else true end;

  -- שלושה צעדים: גבריאלה, הנכס הראשון, תמונת פרופיל (ולמנהל/ת לוגו)
  if v_wa and v_photos and v_prop then
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
  'מצב מדריך ההתחלה (שלושה צעדים: גבריאלה, נכס ראשון, תמונת פרופיל ולמנהל/ת לוגו). שורה אחת כשהמדריך פתוח, אפס שורות אחרת.';

drop trigger if exists properties_onboarding_nudge     on public.properties;
drop trigger if exists agent_clients_onboarding_nudge  on public.agent_clients;
drop trigger if exists agreements_onboarding_nudge     on public.agreements;

revoke all on function public.agent_onboarding_photos_done(uuid) from public, anon, authenticated;
revoke all on function public.agent_onboarding_state() from public, anon;
grant execute on function public.agent_onboarding_state() to authenticated;

-- ===========================================================================
-- מדריך ההתחלה: צעד רביעי למנהל/ת - "על המשרד"
-- ===========================================================================
--
-- ‏#652 הוסיף לדף המשרד מקטע "על המשרד" ושדה ב-CRM לכתוב אותו
-- (‏agencies.description). בבדיקת ה-SEO של 9.10.2026 לאף אחד מ-26 המשרדים
-- לא היה תיאור, ובלי תיאור דף המשרד הוא שם ורשימה: אין לגוגל ולמנועי AI מה
-- לקרוא על המשרד, ואין לגולש/ת מה לדעת עליו לפני שהוא/היא פונה. שדה שאיש
-- אינו מכיר נשאר ריק, ולכן הוא נכנס למדריך.
--
-- הצעד **למנהל/ת בלבד**, כמו הלוגו: התיאור של המשרד ולא של הסוכן/ת, ורק
-- מנהל/ת יכול/ה לערוך אותו (‏manager update own agency). לסוכן/ת about_done
-- הוא true, והמדריך שלו/ה נשאר שלושה צעדים.
--
-- ‏about_done נוסף **בסוף** ה-returns table. שינוי טיפוס החזרה אינו אפשרי
-- ב-create or replace, ולכן drop ואז create, וההרשאות נכתבות מחדש. היחיד
-- שקורא לפונקציה הוא loadOnboarding ב-assets/crm.js, ששולף לפי שם.
--
-- אידמפוטנטית.
-- ===========================================================================

drop function if exists public.agent_onboarding_state();

create function public.agent_onboarding_state()
returns table (
  is_manager     boolean,
  whatsapp_done  boolean,
  profile_done   boolean,
  agency_done    boolean,
  property_done  boolean,
  client_done    boolean,
  agreement_done boolean,
  lead_done      boolean,
  just_finished  boolean,
  about_done     boolean
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
  v_about    boolean;
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

  -- "על המשרד" - למנהל/ת בלבד; לסוכן/ת הצעד אינו קיים ולכן הוא "בוצע"
  v_about   := case when coalesce(v_member.role, '') = 'manager'
                    then coalesce((select btrim(coalesce(a.description, '')) <> ''
                                     from agencies a where a.id = v_member.agency_id), false)
                    else true end;

  -- גבריאלה, הנכס הראשון, תמונת פרופיל (ולמנהל/ת לוגו), ולמנהל/ת "על המשרד"
  if v_wa and v_photos and v_prop and v_about then
    update agency_members
       set onboarding_done_at = now()
     where id = v_id
       and onboarding_done_at is null;
    get diagnostics v_rows = row_count;
    v_just := v_rows > 0;
  end if;

  return query select
    coalesce(v_member.role, '') = 'manager',
    v_wa, v_profile, v_agency, v_prop, v_client, v_agr, v_lead, v_just, v_about;
end;
$$;

comment on function public.agent_onboarding_state() is
  'מצב מדריך ההתחלה (גבריאלה, נכס ראשון, תמונת פרופיל ולמנהל/ת לוגו, ולמנהל/ת "על המשרד"). שורה אחת כשהמדריך פתוח, אפס שורות אחרת.';

revoke all on function public.agent_onboarding_state() from public, anon, authenticated;
grant execute on function public.agent_onboarding_state() to authenticated;

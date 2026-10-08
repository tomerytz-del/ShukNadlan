-- ---------------------------------------------------------------------------
-- עמודות הבעלות של נכס ושל לקוח/ה משתנות רק דרך הפונקציות שלהן
--
-- ‏20270128090000_office_referrals.sql הבטיחה בהערה ש"ההעברה עצמה נעשית רק
-- דרך refer_to_agent()". ה-policies לא אוכפים את זה, ונבדק מול המסד
-- (pg_policies, has_column_privilege) ב-8.10.2026:
--
--   ‏· "referrer updates referred clients/properties" - ה-with check בודק רק
--     ש-referred_by נשאר של המנהל/ת. ‏update רגיל על agent_id ועל agency_id
--     עובר, ומעביר לקוח/ה (טלפון, ת.ז., הערות) או נכס לסוכן/ת במשרד אחר -
--     בלי הבדיקות של refer_to_agent (אותו משרד, פעיל/ה) ובלי התראה.
--   ‏· "agent manages own clients" - ה-with check בודק רק agent_id. הסוכן/ת
--     יכול/ה לכתוב ב-referred_by מזהה של כל חבר/ת צוות בפלטפורמה, גם במשרד
--     אחר, ומאותו רגע לאותו אדם יש קריאה ועריכה של הכרטיס.
--   ‏· "agent update own properties" (בלי with check, כלומר ה-using חל גם על
--     השורה החדשה) - agent_id נעול, אבל agency_id לא: נכס יכול לעבור למשרד
--     אחר ולהופיע באתר תחת המיתוג שלו.
--
-- התיקון הוא טריגר ולא policies חדשים, כי policies מתחברים ב-OR - כל אחד
-- מהשלושה היה צריך לנעול את אותן עמודות בנפרד, וה-policy הבא שייכתב היה
-- פותח את החור מחדש.
--
-- ‏**מי עדיין משנה את העמודות:** כל מי שאינו authenticated או anon. כלומר
-- ‏service_role (ה-Edge Functions והבוט), ו-SECURITY DEFINER שבבעלות postgres
-- - ‏refer_to_agent, refer_clients_to_agent, refer_properties_to_agent,
-- ‏close_agent_account, adopt_released_member_into_agency ושאר מי שמעביר
-- בעלות. נבדק במסד: אין אף פונקציית INVOKER שכותבת את העמודות האלה, ו-CRM
-- אינו כותב אותן ב-update (ב-insert הוא כותב את של הסוכן/ת עצמו/ה).
--
-- ‏**ב-insert** ‏referred_by חייב להיות ריק: הפנייה נוצרת רק בפונקציה. את
-- agent_id ו-agency_id של שורה חדשה כבר אוכפים ה-policies של ה-insert.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

create or replace function public.guard_ownership_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.referred_by is not null then
      raise exception 'הפנייה נוצרת רק דרך העברה מהמשרד'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.agent_id    is distinct from old.agent_id
  or new.agency_id   is distinct from old.agency_id
  or new.referred_by is distinct from old.referred_by
  or new.referred_at is distinct from old.referred_at then
    raise exception 'אי אפשר לשנות כאן את הסוכן/ת, המשרד או ההפנייה - רק דרך העברה מהמשרד'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_ownership_columns() is
  'נועל את agent_id, agency_id, referred_by ו-referred_at מפני update ישיר של משתמש/ת. העברה רק דרך הפונקציות (SECURITY DEFINER) או service_role.';

revoke all on function public.guard_ownership_columns() from public, anon, authenticated;

drop trigger if exists agent_clients_guard_ownership on public.agent_clients;
create trigger agent_clients_guard_ownership
  before insert or update on public.agent_clients
  for each row execute function public.guard_ownership_columns();

drop trigger if exists properties_guard_ownership on public.properties;
create trigger properties_guard_ownership
  before insert or update on public.properties
  for each row execute function public.guard_ownership_columns();

-- ============================================================================
-- שיתוף נכסים בין משרדי תיווך (שת"פ)
--
-- שלושה חלקים, בדיוק בסדר שבו סוכן/ת נתקל/ת בהם:
--   1. ‏agent_share_exclusions — בחירה חד-פעמית של המשרדים שאיתם *לא* משתפים.
--      הרשימה היא רשימת *הסרות* ולא רשימת בחירות, כי ברירת המחדל היא "כל
--      המשרדים": משרד חדש שנרשם לפלטפורמה מצטרף אוטומטית לשת"פ של כולם,
--      בלי שאיש יצטרך לחזור להגדרות ולסמן אותו.
--   2. ‏properties.shared_with_partners — הסימון על שורת הנכס ב-CRM.
--   3. ‏property_shares — ההפצה עצמה: שורה לכל צירוף נכס×משרד יעד. זו הטבלה
--      שממנה נבנית הרשימה "נכסים ששותפו איתי" בתחתית ה-CRM.
--
-- ההפצה עוברת דרך share_property_with_partners() ולא דרך insert מהדפדפן:
-- הפונקציה גוזרת את הסוכן/ת מה-JWT, מוודאת בעלות על הנכס, ומסנכרנת את
-- ההפצה מול רשימת השת"פ העדכנית — כך שהסרת משרד מהרשימה ולחיצה חוזרת
-- באמת מבטלת לו את הגישה.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב ושוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. סימון השיתוף על הנכס
--
-- דגל נגזר: אפשר היה לחשב אותו מ-property_shares בכל טעינה, אבל רשימת
-- הנכסים ב-CRM נטענת בשאילתה אחת ובלי join, והדגל הוא מה שמצייר את התגית
-- על שורת הנכס. share/unshare מעדכנים אותו יחד עם השורות, באותה טרנזקציה.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists shared_with_partners boolean not null default false,
  add column if not exists shared_at timestamptz;

comment on column public.properties.shared_with_partners is
  'הנכס הופץ למשרדי השת"פ של הסוכן/ת. מתעדכן רק דרך share_property_with_partners / unshare_property.';
comment on column public.properties.shared_at is
  'מועד ההפצה האחרונה למשרדי השת"פ.';

-- ---------------------------------------------------------------------------
-- 2. משרדים שהוסרו מרשימת השת"פ
--
-- ‏primary key (agent_id, agency_id) — שורה קיימת = "אל תשתף עם המשרד הזה".
-- אין שורות = משתפים עם כולם, וזו בדיוק ברירת המחדל לחשבון חדש.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_share_exclusions (
  agent_id   uuid not null references public.agency_members(id) on delete cascade,
  agency_id  uuid not null references public.agencies(id)       on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, agency_id)
);

comment on table public.agent_share_exclusions is
  'משרדי תיווך שהסוכן/ת בחר/ה לא לשתף איתם נכסים. רשימת הסרות — היעדר שורה משמעו שת"פ פעיל.';

alter table public.agent_share_exclusions enable row level security;
revoke all on table public.agent_share_exclusions from anon;

-- ההגדרה אישית לחלוטין: כל סוכן/ת רואה ומנהל/ת רק את הרשימה של עצמו/ה.
drop policy if exists "agent manages own share exclusions" on public.agent_share_exclusions;
create policy "agent manages own share exclusions"
  on public.agent_share_exclusions for all
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 3. ההפצה
--
-- ‏unique(property_id, shared_with_agency_id) הוא מה שהופך לחיצה חוזרת על
-- "שיתוף" לפעולה אידמפוטנטית: on conflict do nothing, בלי כפילויות וכמובן
-- בלי התראה שנייה לאותו משרד.
-- ---------------------------------------------------------------------------
create table if not exists public.property_shares (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references public.properties(id)     on delete cascade,
  owner_agent_id        uuid not null references public.agency_members(id) on delete cascade,
  owner_agency_id       uuid          references public.agencies(id)       on delete set null,
  shared_with_agency_id uuid not null references public.agencies(id)       on delete cascade,
  created_at            timestamptz not null default now(),
  unique (property_id, shared_with_agency_id)
);

comment on table public.property_shares is
  'נכסים שהופצו למשרדי שת"פ. שורה לכל צירוף נכס×משרד יעד. נכתבת רק דרך share_property_with_partners / unshare_property.';

create index if not exists property_shares_target_idx
  on public.property_shares (shared_with_agency_id, created_at desc);
create index if not exists property_shares_property_idx
  on public.property_shares (property_id);

alter table public.property_shares enable row level security;

-- אין policy של כתיבה ואין הרשאת כתיבה — הכתיבה היחידה היא מתוך
-- ‏share_property_with_partners / unshare_property, שרצות security definer.
revoke all on table public.property_shares from anon;
revoke insert, update, delete on table public.property_shares from authenticated;

-- שני צדדים קוראים את אותה שורה: מי ששיתף (כדי לראות למי הנכס הופץ)
-- ומי שקיבל (כדי לבנות את הרשימה "שותפו איתי").
drop policy if exists "share participants read property shares" on public.property_shares;
create policy "share participants read property shares"
  on public.property_shares for select
  using (owner_agent_id = public.current_agent_id()
      or shared_with_agency_id = public.current_agency_id());

-- ---------------------------------------------------------------------------
-- 4. הפצת נכס
--
-- ‏security definer אבל *בלי* פרמטר של מזהה סוכן/ת: הזהות נגזרת מה-JWT בתוך
-- הפונקציה, ולכן אפשר לחשוף אותה ל-authenticated בלי שאפשר יהיה להפיץ נכס
-- של מישהו אחר (בניגוד ל-purchase_rss_lead, שמזיזה כסף ולכן נעולה
-- ל-service_role ועוברת דרך Edge Function).
--
-- הפונקציה מסנכרנת ולא רק מוסיפה: קודם מוחקת הפצות למשרדים שכבר לא ברשימת
-- השת"פ, ואז מוסיפה את החסרים. כך "הסרתי משרד והפצתי מחדש" באמת מסירה.
-- ---------------------------------------------------------------------------
create or replace function public.share_property_with_partners(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent       public.agency_members%rowtype;
  v_prop        public.properties%rowtype;
  v_agency_name text;
  v_added       int := 0;
  v_revoked     int := 0;
  v_total       int := 0;
begin
  select * into v_agent from public.agency_members
   where user_id = (select auth.uid()) and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  if v_agent.agency_id is null then
    return jsonb_build_object('error', 'agent_without_agency');
  end if;

  -- ‏for update מסדר שתי לחיצות מקבילות בטור, כך שהספירה המוחזרת לא תשקר
  select * into v_prop from public.properties where id = p_property_id for update;
  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;
  if v_prop.agent_id <> v_agent.id then
    return jsonb_build_object('error', 'not_your_property');
  end if;
  if v_prop.status <> 'active' then
    return jsonb_build_object('error', 'property_not_active');
  end if;

  select name into v_agency_name from public.agencies where id = v_agent.agency_id;

  -- ביטול הפצות למשרדים שהוסרו מרשימת השת"פ מאז ההפצה הקודמת
  -- (וגם למשרד של הסוכן/ת עצמו/ה, אם השתנתה שיוך משרד מאז)
  delete from public.property_shares ps
   where ps.property_id = p_property_id
     and (ps.shared_with_agency_id = v_agent.agency_id
          or exists (select 1 from public.agent_share_exclusions ex
                      where ex.agent_id = v_agent.id
                        and ex.agency_id = ps.shared_with_agency_id));
  get diagnostics v_revoked = row_count;

  -- ההפצה עצמה + ההתראות, בהצהרה אחת. ה-CTE של ההתראות נשען על ה-returning
  -- של ההוספה, ולכן מי שכבר קיבל את הנכס בעבר (on conflict do nothing) לא
  -- מקבל התראה שנייה על אותו נכס.
  with targets as (
    select a.id
      from public.agencies a
     where a.id is distinct from v_agent.agency_id
       and not exists (select 1 from public.agent_share_exclusions ex
                        where ex.agent_id = v_agent.id and ex.agency_id = a.id)
  ),
  ins as (
    insert into public.property_shares
      (property_id, owner_agent_id, owner_agency_id, shared_with_agency_id)
    select p_property_id, v_agent.id, v_agent.agency_id, t.id from targets t
    on conflict (property_id, shared_with_agency_id) do nothing
    returning shared_with_agency_id
  ),
  notified as (
    insert into public.notifications (agent_id, type, title, body)
    select m.id,
           'system',
           'נכס חדש שותף איתך',
           coalesce(v_agency_name, 'משרד שותף') || ' שיתף/ה איתך נכס: ' || v_prop.title
      from ins
      join public.agency_members m
        on m.agency_id = ins.shared_with_agency_id
       and m.active = true
    returning 1
  )
  select count(*) into v_added from ins;

  select count(*) into v_total from public.property_shares where property_id = p_property_id;

  -- ‏0 משרדים = הוסרו כולם מרשימת השת"פ (או שאין עדיין משרד נוסף בפלטפורמה).
  -- במקרה כזה הדגל נשאר כבוי, כדי שלא תופיע תגית "משותף" על נכס שאיש לא קיבל.
  update public.properties
     set shared_with_partners = (v_total > 0),
         shared_at            = case when v_total > 0 then now() else null end,
         updated_at           = now()
   where id = p_property_id;

  return jsonb_build_object(
    'success',      true,
    'shared_count', v_total,
    'newly_shared', v_added,
    'revoked',      v_revoked
  );
end;
$$;

comment on function public.share_property_with_partners(uuid) is
  'מפיץ נכס לכל משרדי השת"פ של הסוכן/ת (כל המשרדים פחות agent_share_exclusions) ומתריע לחברי המשרדים שקיבלו אותו כעת.';

revoke all on function public.share_property_with_partners(uuid) from public;
revoke all on function public.share_property_with_partners(uuid) from anon;
grant execute on function public.share_property_with_partners(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. ביטול הפצה
-- ---------------------------------------------------------------------------
create or replace function public.unshare_property(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid;
  v_owner    uuid;
  v_removed  int := 0;
begin
  v_agent_id := public.current_agent_id();
  if v_agent_id is null then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select agent_id into v_owner from public.properties where id = p_property_id for update;
  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;
  if v_owner <> v_agent_id then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  delete from public.property_shares where property_id = p_property_id;
  get diagnostics v_removed = row_count;

  update public.properties
     set shared_with_partners = false,
         shared_at            = null,
         updated_at           = now()
   where id = p_property_id;

  return jsonb_build_object('success', true, 'removed', v_removed);
end;
$$;

comment on function public.unshare_property(uuid) is
  'מסיר נכס מכל משרדי השת"פ שקיבלו אותו ומכבה את סימון השיתוף.';

revoke all on function public.unshare_property(uuid) from public;
revoke all on function public.unshare_property(uuid) from anon;
grant execute on function public.unshare_property(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. הרשימה "נכסים ששותפו איתי"
--
-- ‏View בלי security_invoker — אותה תבנית כמו leads_masked ו-rss_leads_public
-- בפרויקט. הסינון על current_agency_id() הוא מה שמגדיר את ההרשאה: מי שאינו
-- מחובר מקבל null ולכן אפס שורות, ומשרד רואה רק את מה ששותף איתו.
--
-- ה-view חושף display_name ו-phone של מי ששיתף — זה כל תכלית השת"פ (צריך
-- למי להתקשר), ולכן הוא נלקח מ-agency_members ולא מ-agency_members_public
-- שאינו כולל טלפון. החשיפה מוגבלת לשורות ששותפו עם המשרד של הקורא/ת בלבד.
--
-- ‏p.status = 'active' כאן הוא גם מנגנון הניקוי: נכס שסומן כנמכר/הושכר נעלם
-- מיד מהרשימות של כל המשרדים, בלי צורך במחיקת שורות.
--
-- ה-linter של Supabase מסמן את התבנית כ-"Security Definer View" ברמת ERROR,
-- כמו אצל rss_leads_public ו-agency_members_public. כאן זה מכוון: ב-invoker
-- הקורא/ת היה זקוק/ה ל-SELECT ישיר על agency_members של משרד אחר — בדיוק מה
-- שה-RLS שם מונע — וה-view היה מחזיר אפס שורות.
-- ---------------------------------------------------------------------------
create or replace view public.shared_properties_for_me as
select
  ps.id                as share_id,
  ps.created_at        as shared_at,
  ps.owner_agency_id,
  oa.name              as owner_agency_name,
  oa.logo_url          as owner_agency_logo,
  ps.owner_agent_id,
  om.display_name      as owner_agent_name,
  om.phone             as owner_agent_phone,
  p.id                 as property_id,
  p.title,
  p.price,
  p.deal_type,
  p.category,
  p.property_type,
  p.rooms,
  p.floor,
  p.size_sqm,
  p.city,
  p.street,
  p.house_number,
  p.features,
  p.condition,
  p.images,
  p.created_at         as property_created_at
from public.property_shares ps
join public.properties p  on p.id  = ps.property_id
join public.agencies   oa on oa.id = ps.owner_agency_id
left join public.agency_members om on om.id = ps.owner_agent_id
where ps.shared_with_agency_id = public.current_agency_id()
  and p.status = 'active';

comment on view public.shared_properties_for_me is
  'נכסים שמשרדי תיווך אחרים שיתפו עם המשרד של המשתמש/ת המחובר/ת, כולל שם המשרד המשתף ופרטי הקשר של הסוכן/ת.';

revoke all on public.shared_properties_for_me from anon;
grant select on public.shared_properties_for_me to authenticated;

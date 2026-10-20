-- ---------------------------------------------------------------------------
-- תחום ואזורי פעילות: במה משתפים אותי
--
-- עד היום אזורי הפעילות (agency_members.service_markets) קבעו רק איפה
-- הסוכן/ת מופיע/ה באתר. השיתופים בין משרדים לא הסתכלו עליהם בכלל: כל נכס
-- ששותף הגיע לכל סוכן/ת בפלטפורמה, עם התראה - סוכן/ת מעפולה קיבל/ה צלצול על
-- חנות בקריית מלאכי. (docs/area-scope.md; העיצוב: docs/handoff/
-- crm-settings-redesign, סעיף 3.22.)
--
-- החלטות של תומר (20.10.2026):
--   ‏· **מה זה משנה:** את "שותפו איתי" (סינון ברירת מחדל) ואת ההתראה על נכס
--     ששותף. השיתוף עצמו (property_shares) לא משתנה - ההתאמות ללקוחות
--     ממשיכות למצוא נכסים מכל הרשת.
--   ‏· **משרד וסוכן/ת:** האזורים מתמזגים (של המשרד ועוד של הסוכן/ת - סוכן/ת
--     במשרד בעפולה שעובד/ת גם בחיפה), וסוג הנכס של הסוכן/ת גובר על של המשרד
--     כשנבחר. איחוד בסוג הנכס היה מבטל בחירה של "פרטיים בלבד".
--
-- מה נכנס:
--   1. agency_members.property_scope - ‏null = כמו המשרד.
--   2. agencies.service_markets ו-agencies.property_scope - ברירת המחדל של
--      המשרד. **בלי backfill**: משרד שלא בחר/ה אזורים אינו מסנן כלום, כדי
--      שהמיגרציה עצמה לא תשתיק התראות לאף אחד.
--   3. agent_share_fit() - האם נכס מתאים לסוכן/ת. מתאים כשאין אזורים בכלל,
--      כשהעיר אינה ידועה או אינה בשום שוק (לא מסתירים מה שאי אפשר לשייך).
--   4. shared_properties_for_me.fits_me - עמודה חדשה **בסוף** ה-view.
--   5. share_property_for_agent - ההתראה רק למי שהנכס מתאים לו/ה. העתק מלא
--      של הגרסה האחרונה (20270321093000; md5 בפרודקשן e06bfa87...) והשינוי
--      היחיד הוא תנאי אחד ב-CTE של ההתראות.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

alter table public.agency_members add column if not exists property_scope text;
alter table public.agencies add column if not exists property_scope text not null default 'all';
alter table public.agencies add column if not exists service_markets text[] not null default '{}';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_property_scope_chk') then
    alter table public.agency_members add constraint agency_members_property_scope_chk
      check (property_scope is null or property_scope in ('private', 'commercial', 'all'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agencies_property_scope_chk') then
    alter table public.agencies add constraint agencies_property_scope_chk
      check (property_scope in ('private', 'commercial', 'all'));
  end if;
  -- אותו אילוץ כמו agency_members.service_markets (20270321090000)
  if not exists (select 1 from pg_constraint where conname = 'agencies_service_markets_chk') then
    alter table public.agencies add constraint agencies_service_markets_chk
      check (cardinality(service_markets) <= 40
             and array_to_string(service_markets, ',') ~ '^([a-z0-9-]{2,40}(,[a-z0-9-]{2,40})*)?$');
  end if;
end $$;

comment on column public.agency_members.property_scope is
  'באילו נכסים הסוכן/ת עובד/ת: private / commercial / all. null = כמו המשרד (agencies.property_scope). docs/area-scope.md';
comment on column public.agencies.property_scope is
  'ברירת המחדל של סוכני המשרד לסוג הנכסים שמשתפים אותם בהם. docs/area-scope.md';
comment on column public.agencies.service_markets is
  'אזורי הפעילות של המשרד (slug-ים מ-assets/markets.js). מתמזגים עם של כל סוכן/ת. docs/area-scope.md';

-- ---------------------------------------------------------------------------
-- 3. האם הנכס מתאים לסוכן/ת
-- ---------------------------------------------------------------------------
create or replace function public.agent_share_fit(p_agent_id uuid, p_category text, p_city_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select coalesce(m.property_scope, g.property_scope, 'all') as scope,
           coalesce(m.service_markets, '{}'::text[]) || coalesce(g.service_markets, '{}'::text[]) as markets
      from public.agency_members m
      left join public.agencies g on g.id = m.agency_id
     where m.id = p_agent_id
  ),
  c as (
    select c.market_slug from public.cities c where c.id = p_city_id
  )
  select coalesce((
    select (case a.scope
              when 'private'    then p_category is distinct from 'commercial'
              when 'commercial' then p_category = 'commercial'
              else true end)
       and (cardinality(a.markets) = 0
            or not exists (select 1 from c where c.market_slug is not null)
            or exists (select 1 from c where c.market_slug = any(a.markets)))
      from a), true);
$$;

comment on function public.agent_share_fit(uuid, text, uuid) is
  'האם נכס (לפי קטגוריה ועיר) בתחום ובאזורי הפעילות של הסוכן/ת - של הסוכן/ת ושל המשרד יחד. מתאים כשאין אזורים או כשהעיר אינה בשום שוק. docs/area-scope.md';

-- נקראת מה-view ומ-share_property_for_agent (שתיהן רצות כבעלים), לא מהדפדפן
revoke all on function public.agent_share_fit(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.agent_share_fit(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. "שותפו איתי" - עמודה חדשה בסוף
-- ---------------------------------------------------------------------------
create or replace view public.shared_properties_for_me as
 select ps.id as share_id,
    ps.created_at as shared_at,
    ps.owner_agency_id,
    oa.name as owner_agency_name,
    oa.logo_url as owner_agency_logo,
    ps.owner_agent_id,
    om.display_name as owner_agent_name,
    om.phone as owner_agent_phone,
    p.id as property_id,
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
    p.created_at as property_created_at,
    public.agent_share_fit(public.current_agent_id(), p.category, p.city_id) as fits_me
   from public.property_shares ps
     join public.properties p on p.id = ps.property_id
     join public.agencies oa on oa.id = ps.owner_agency_id
     left join public.agency_members om on om.id = ps.owner_agent_id
  where ps.shared_with_agency_id = public.current_agency_id() and p.status = 'active';

-- ---------------------------------------------------------------------------
-- 5. ההתראה על נכס ששותף - רק למי שהנכס מתאים לו/ה
-- ---------------------------------------------------------------------------
create or replace function public.share_property_for_agent(
  p_agent_id    uuid,
  p_property_id uuid
)
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
   where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  if v_agent.agency_id is null then
    return jsonb_build_object('error', 'agent_without_agency');
  end if;

  -- ‏for update מסדר שתי בקשות מקבילות בטור, כך שהספירה המוחזרת לא תשקר
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
  -- (וגם למשרד של הסוכן/ת עצמו/ה, אם השתנה שיוך המשרד מאז)
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
    insert into public.notifications (agent_id, type, title, body, related_property_id)
    select m.id,
           'system',
           'נכס חדש שותף איתך',
           coalesce(v_agency_name, 'משרד שותף') || ' שיתף/ה איתך נכס: ' || v_prop.title,
           p_property_id
      from ins
      join public.agency_members m
        on m.agency_id = ins.shared_with_agency_id
       and m.active = true
     -- תחום ואזורי הפעילות (20270711090000): השיתוף לכולם, הצלצול רק למי שמתאים
     where public.agent_share_fit(m.id, v_prop.category, v_prop.city_id)
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
    'revoked',      v_revoked,
    'title',        v_prop.title
  );
end;
$$;

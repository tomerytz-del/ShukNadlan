-- ============================================================================
-- העדפות לידים לסוכנים שעוסקים בנכסים מסחריים
--
-- אשף בעלי הנכסים שולח לנכס מסחרי property_type = 'מסחרי' (PR #915),
-- והניתוב ב-owner-lead-intake משווה אותו ל-agent_lead_preferences. עד היום
-- אף סוכן/ת לא סימן/ה "מסחרי", ולכן ליד מסחרי לא היה מגיע לאיש.
--
-- סוכן/ת "עוסק/ת במסחרי" כשהמשרד שלו/ה סימן commercial או industrial ב-
-- agencies.specialties, או כשהוא/היא סימן/ה "מסחרי" ב-agency_members.specialties.
-- לכל סוכן/ת כזה/ו (החלטה של תומר, 24.10.2026):
--
--   * יש שורת העדפות - "מסחרי" נוסף לסוגי הנכס, ושום דבר אחר לא משתנה.
--   * אין שורה - נוצרת שורת ברירת מחדל: כל השכונות בשוק של המשרד, כל סוגי
--     הנכס (כולל מסחרי), מכירה והשכרה. בלי שורה הסוכן/ת לא קיבל/ה לידים
--     מבעלי נכסים בכלל.
--
-- בשני המקרים נכתבת התראה (lead_prefs_default) שמובילה להעדפות הלידים, כדי
-- שהסוכן/ת ידע/תדע מה הוגדר ויוכל/תוכל לשנות.
--
-- ההמשך: טריגרים על agencies ועל agency_members מפעילים את אותו כלל כשמשרד
-- או סוכן/ת **מוסיפים** את המסחרי (ולא בכל עדכון - מי שהסיר/ה "מסחרי"
-- מההעדפות בעצמו/ה לא מקבל/ת אותו בחזרה בשמירה הבאה של הפרופיל).
--
-- הקובץ אידמפוטנטי: ההוספה בודקת שה"מסחרי" חסר, והיצירה היא on conflict do nothing.
-- ============================================================================

select public.notification_types_add(array['lead_prefs_default']);

create or replace function public._agent_does_commercial(p_agency_specialties text[], p_member_specialties text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_agency_specialties, '{}'::text[]) && array['commercial', 'industrial']::text[]
      or 'מסחרי' = any(coalesce(p_member_specialties, '{}'::text[]));
$$;

revoke all on function public._agent_does_commercial(text[], text[]) from public, anon, authenticated;
grant execute on function public._agent_does_commercial(text[], text[]) to service_role;

create or replace function public._commercial_lead_prefs_apply(p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_types text[];
  v_hoods uuid[];
begin
  select p.preferred_property_types into v_types
    from public.agent_lead_preferences p
   where p.agent_id = p_agent_id;

  if found then
    if 'מסחרי' = any(v_types) then
      return;
    end if;
    update public.agent_lead_preferences
       set preferred_property_types = array_append(preferred_property_types, 'מסחרי'),
           updated_at = now()
     where agent_id = p_agent_id;
    insert into public.notifications (agent_id, type, title, body)
    values (p_agent_id, 'lead_prefs_default',
            'נוסף "מסחרי" להעדפות הלידים שלך',
            'מעכשיו יגיעו אליך גם לידים מבעלי נכסים מסחריים (משרד, חנות, מחסן) באזורים שבחרת. אפשר להסיר בהעדפות הלידים.');
    return;
  end if;

  -- השכונות בשוק של המשרד, כמו marketNeighborhoods() ב-crm.js. משרד בלי
  -- עיר או בשוק בלי שכונות מקבל רשימה ריקה, והליד מגיע אליו בסבב הכללי.
  select coalesce(array_agg(distinct n.id), '{}'::uuid[]) into v_hoods
    from public.agency_members am
    join public.agencies a on a.id = am.agency_id
    join public.cities ac on ac.id = a.city_id
    join public.cities c on c.market_slug = ac.market_slug
    join public.neighborhoods n on n.city_id = c.id
   where am.id = p_agent_id;

  insert into public.agent_lead_preferences
    (agent_id, preferred_neighborhoods, preferred_property_types, preferred_deal_types, active)
  values
    (p_agent_id, v_hoods, array['דירה', 'בית פרטי', 'דירת גן', 'מגרש', 'מסחרי'], array['rent', 'sale'], true)
  on conflict (agent_id) do nothing;

  if found then
    insert into public.notifications (agent_id, type, title, body)
    values (p_agent_id, 'lead_prefs_default',
            'הפעלנו לך לידים מבעלי נכסים',
            'הגדרנו העדפות ברירת מחדל: כל השכונות באזור, כל סוגי הנכסים כולל מסחרי, מכירה והשכרה. אפשר לשנות בכל רגע בהעדפות הלידים.');
  end if;
end;
$$;

revoke all on function public._commercial_lead_prefs_apply(uuid) from public, anon, authenticated;
grant execute on function public._commercial_lead_prefs_apply(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- המשרד הוסיף "נכסים מסחריים" (או "תעשייה") לתחומי ההתמחות
-- ---------------------------------------------------------------------------
create or replace function public.agencies_commercial_lead_prefs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  if not public._agent_does_commercial(new.specialties, null) then
    return new;
  end if;
  if tg_op = 'UPDATE' and public._agent_does_commercial(old.specialties, null) then
    return new;
  end if;
  for v_member in
    select am.id from public.agency_members am
     where am.agency_id = new.id and am.active
  loop
    perform public._commercial_lead_prefs_apply(v_member);
  end loop;
  return new;
end;
$$;

revoke all on function public.agencies_commercial_lead_prefs() from public, anon, authenticated;

drop trigger if exists agencies_commercial_lead_prefs on public.agencies;
create trigger agencies_commercial_lead_prefs
  after insert or update of specialties on public.agencies
  for each row execute function public.agencies_commercial_lead_prefs();

-- ---------------------------------------------------------------------------
-- סוכן/ת הוסיף/ה "מסחרי" לפרופיל, הצטרף/ה למשרד מסחרי, או חזר/ה לפעילות
-- ---------------------------------------------------------------------------
create or replace function public.agency_members_commercial_lead_prefs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_agency text[];
  v_old_agency text[];
begin
  if not new.active then
    return new;
  end if;
  select a.specialties into v_new_agency from public.agencies a where a.id = new.agency_id;
  if not public._agent_does_commercial(v_new_agency, new.specialties) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active then
    select a.specialties into v_old_agency from public.agencies a where a.id = old.agency_id;
    if public._agent_does_commercial(v_old_agency, old.specialties) then
      return new;
    end if;
  end if;
  perform public._commercial_lead_prefs_apply(new.id);
  return new;
end;
$$;

revoke all on function public.agency_members_commercial_lead_prefs() from public, anon, authenticated;

drop trigger if exists agency_members_commercial_lead_prefs on public.agency_members;
create trigger agency_members_commercial_lead_prefs
  after insert or update of specialties, agency_id, active on public.agency_members
  for each row execute function public.agency_members_commercial_lead_prefs();

-- ---------------------------------------------------------------------------
-- הסוכנים הקיימים
-- ---------------------------------------------------------------------------
do $$
declare
  v_member uuid;
begin
  for v_member in
    select am.id
      from public.agency_members am
      join public.agencies a on a.id = am.agency_id
     where am.active
       and public._agent_does_commercial(a.specialties, am.specialties)
  loop
    perform public._commercial_lead_prefs_apply(v_member);
  end loop;
end $$;

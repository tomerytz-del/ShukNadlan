-- ============================================================================
-- חיפוש לפי מפתח הרחוב - "העלייה", "עלייה", "העליה" ו"רחוב העלייה" הם רחוב אחד
-- ----------------------------------------------------------------------------
-- ‏public.street_name_key (‏20261109090000_street_registry.sql) כבר מכווץ את
-- צירי הכתיב לצורת בסיס אחת, וטופס הנכס ב-CRM משתמש בו בשמירה. החיפוש לא:
-- ‏ilike על "העלייה" לא מצא את חמשת הנכסים בעפולה ששמורים כ"עלייה".
--
-- ‏**רק תוספות.** עמודה מחושבת, אינדקס, ושתי פונקציות החיפוש בגרסה שמוסיפה
-- התאמה לפי המפתח לצד ה-ilike הקיים - באותה חתימה, אותו פלט, אותה אבטחה
-- ואותן הרשאות. ‏street_name_key עצמה אינה משתנה, ורחובות שמורים אינם
-- מתעדכנים.
--
-- ‏**סדר:** התאמה מדויקת (ilike על הכותרת, הרחוב או הכתובת) קודם, ורק אחריה
-- מה שנמצא דרך המפתח בלבד. העמודה x_exact משמשת למיון ויורדת מהפלט.
--
-- בדיקות לפני הוספת העמודה (31.10.2026, קריאה בלבד מהפרודקשן):
--   • אין הרשאות ברמת עמודה על properties (‏attacl ריק בכל העמודות) - ההרשאה
--     ברמת הטבלה חלה גם על העמודה החדשה.
--   • ה-views שתלויים ב-properties נבנו עם רשימת עמודות סגורה, ולכן אינם
--     משתנים מעמודה חדשה.
--   • אף טריגר על properties אינו משווה to_jsonb(new) מול to_jsonb(old).
--   • ‏IMP_REIMPORT_COLUMNS בייבוא מונה עמודות בשם, ועמודה מחושבת אינה נכתבת.
--
-- תיעוד: docs/street-registry.md, "חיפוש לפי המפתח"
-- ============================================================================

alter table public.properties
  add column if not exists street_key text
  generated always as (public.street_name_key(street)) stored;

create index if not exists properties_city_street_key_idx
  on public.properties (city, street_key);

-- ---------------------------------------------------------------------------
-- crm_search - הגוף מ-20270601120000_crm_search.sql (זהה לפרודקשן ב-31.10),
-- ובנכסים גם pr.street_key = street_name_key(v_q).
-- ---------------------------------------------------------------------------
create or replace function public.crm_search(p_q text, p_limit int default 6)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_me     uuid := current_agent_id();
  v_q      text := btrim(coalesce(p_q, ''));
  v_lim    int  := least(greatest(coalesce(p_limit, 6), 1), 20);
  v_like   text;
  v_key    text;
  v_digits text;
  v_phone  boolean;
  v_out    jsonb;
begin
  if v_me is null or char_length(v_q) < 2 then
    return jsonb_build_object('q', v_q, 'counts',
      jsonb_build_object('clients', 0, 'props', 0, 'leads', 0, 'deals', 0),
      'clients', '[]'::jsonb, 'props', '[]'::jsonb, 'leads', '[]'::jsonb, 'deals', '[]'::jsonb);
  end if;

  v_q := left(v_q, 80);
  -- תווי LIKE מהקלט הם טקסט ולא תבנית
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_key := public.street_name_key(v_q);
  v_digits := regexp_replace(v_q, '[^0-9]', '', 'g');
  if v_digits like '972%' then v_digits := '0' || substr(v_digits, 4); end if;
  v_phone := char_length(v_digits) >= 4;

  with
  c as (
    select ac.id, ac.full_name, ac.client_kind, ac.deal_type, ac.cities, ac.max_price, ac.status,
           coalesce(ac.updated_at, ac.created_at) as ts
    from agent_clients ac
    where ac.full_name ilike v_like
       or ac.email ilike v_like
       or (v_phone and public._crm_search_phone_match(ac.phone, v_digits))
  ),
  p as (
    select pr.id, pr.title, pr.city, pr.address, pr.price, pr.status, pr.deal_type,
           coalesce(pr.updated_at, pr.created_at) as ts,
           coalesce(pr.title ilike v_like or pr.street ilike v_like or pr.address ilike v_like,
                    false) as x_exact
    from properties pr
    where pr.agent_id = v_me
      and (pr.title ilike v_like or pr.address ilike v_like or pr.street ilike v_like
           or pr.street_key = v_key
           or pr.city ilike v_like
           or (v_digits <> '' and pr.listing_number::text = v_digits))
  ),
  l as (
    select lm.id, lm.display_name, lm.lead_type, lm.deal_type, lm.city, lm.status, lm.created_at,
           lm.created_at as ts
    from leads_masked lm
    where lm.agent_id = v_me
      and (lm.display_name ilike v_like or lm.city ilike v_like or lm.property_details ilike v_like
           or (v_phone and lm.status = 'unlocked'
               and public._crm_search_phone_match(lm.display_phone, v_digits)))
  ),
  d as (
    select ag.id, ag.title, ag.kind, ag.status, ag.exclusive_until,
           coalesce(ag.updated_at, ag.created_at) as ts
    from agreements ag
    where ag.agent_id = v_me
      and (ag.title ilike v_like
           or exists (select 1 from agent_clients ac
                      where ac.id = any(ag.client_ids) and ac.full_name ilike v_like))
  )
  select jsonb_build_object(
    'q', v_q,
    'counts', jsonb_build_object(
      'clients', (select count(*) from c), 'props', (select count(*) from p),
      'leads', (select count(*) from l), 'deals', (select count(*) from d)),
    'clients', coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from c order by ts desc limit v_lim) x), '[]'::jsonb),
    'props',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' - 'x_exact' order by x.x_exact desc, x.ts desc)
                         from (select * from p order by x_exact desc, ts desc limit v_lim) x), '[]'::jsonb),
    'leads',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from l order by ts desc limit v_lim) x), '[]'::jsonb),
    'deals',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from d order by ts desc limit v_lim) x), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.crm_search(text, int) from public, anon, authenticated;
grant execute on function public.crm_search(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_search - הגוף מ-20270630090000_admin_search.sql (זהה לפרודקשן ב-31.10).
-- עד כאן הנכסים לא חופשו לפי רחוב בכלל; עכשיו ilike על הרחוב וגם המפתח.
-- ---------------------------------------------------------------------------
create or replace function public.admin_search(p_q text, p_limit int default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := btrim(coalesce(p_q, ''));
  v_lim    int  := least(greatest(coalesce(p_limit, 6), 1), 20);
  v_like   text;
  v_key    text;
  v_digits text;
  v_out    jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  if char_length(v_q) < 2 then
    return jsonb_build_object('q', v_q, 'counts',
      jsonb_build_object('agencies', 0, 'agents', 0, 'aprops', 0),
      'agencies', '[]'::jsonb, 'agents', '[]'::jsonb, 'aprops', '[]'::jsonb);
  end if;

  v_q := left(v_q, 80);
  -- תווי LIKE מהקלט הם טקסט ולא תבנית (כמו ב-crm_search)
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_key := public.street_name_key(v_q);
  v_digits := regexp_replace(v_q, '[^0-9]', '', 'g');

  with
  ag as (
    select a.id, a.name, a.slug, c.name as city, a.created_at as ts,
           (select count(*) from public.agency_members m
             where m.agency_id = a.id and m.active and m.released_at is null) as agents
      from public.agencies a
      left join public.cities c on c.id = a.city_id
     where a.name ilike v_like or a.slug ilike v_like or c.name ilike v_like
  ),
  am as (
    select m.id, m.display_name, m.slug, m.tier, m.role, a.name as agency, m.created_at as ts
      from public.agency_members m
      left join public.agencies a on a.id = m.agency_id
     where m.active and m.released_at is null
       and (m.display_name ilike v_like or m.slug ilike v_like)
  ),
  pr as (
    select p.id, p.title, p.city, p.status, p.listing_number, a.name as agency,
           coalesce(p.updated_at, p.created_at) as ts,
           coalesce(p.title ilike v_like or p.street ilike v_like or p.address ilike v_like,
                    false) as x_exact
      from public.properties p
      left join public.agencies a on a.id = p.agency_id
     where p.title ilike v_like or p.address ilike v_like or p.city ilike v_like
        or p.street ilike v_like or p.street_key = v_key
        or (v_digits <> '' and p.listing_number::text = v_digits)
  )
  select jsonb_build_object(
    'q', v_q,
    'counts', jsonb_build_object(
      'agencies', (select count(*) from ag),
      'agents',   (select count(*) from am),
      'aprops',   (select count(*) from pr)),
    'agencies', coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                          from (select * from ag order by ts desc limit v_lim) x), '[]'::jsonb),
    'agents',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                          from (select * from am order by ts desc limit v_lim) x), '[]'::jsonb),
    'aprops',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' - 'x_exact' order by x.x_exact desc, x.ts desc)
                          from (select * from pr order by x_exact desc, ts desc limit v_lim) x), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.admin_search(text, int) from public, anon, authenticated;
grant execute on function public.admin_search(text, int) to authenticated;

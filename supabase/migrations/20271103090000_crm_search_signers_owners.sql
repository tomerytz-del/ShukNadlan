-- ===========================================================================
-- crm_search: הסכם לפי החותם/ת ולפי הנכס, ונכס לפי בעל/ת הנכס
--
-- הסכם נמצא עד היום רק לפי הכותרת ("הזמנת שירותי תיווך - מוכר") ולפי שמות
-- הלקוחות שב-client_ids. אבל חותם/ת נכנס/ת להסכם בשלוש דרכים, ושתיים מהן
-- אינן כותבות ל-client_ids: הזנה ידנית, ובטופס של צד הנכס - בעל/ת הנכס
-- מ-property_owners, שהאשף מכניס כחותם/ת בלי כרטיס בקובץ הלקוחות. כך
-- הסכם בלעדיות שנשלח ל"גבי שטרית" לא נמצא לא לפי שמו ולא לפי הרחוב.
--
-- ומאותה סיבה בעל/ת הנכס אינו/ה נמצא/ת תחת "לקוחות": הוא/היא אינו/ה
-- ב-agent_clients. החיפוש מוצא עכשיו את **הנכס** לפי שם או טלפון הבעלים.
--
-- נוסף:
--   • הסכמים: agreement_signers.full_name, טלפון החותם/ת (התאמה בלבד, לא
--     חוזר), snapshot->>'property_line' (גם נכס בהזנה ידנית), והנכסים
--     שב-property_ids לפי כותרת, כתובת, רחוב ו-street_key.
--   • נכסים: property_owners.owner_name ו-owner_phone.
--
-- עדיין security invoker: agreement_signers נקראת דרך ה-RLS של בעל/ת ההסכם,
-- ו-property_owners דרך ה-RLS של בעל/ת הנכס - והנכסים בחיפוש הם שלי ממילא.
-- אף טלפון אינו חוזר בפלט. צורת הפלט לא השתנתה.
-- ===========================================================================

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
  v_city_ids uuid[];
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
  v_city_ids := public.city_ids_for_name(v_q);

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
           or pr.city_id = any(v_city_ids)
           or exists (
             select 1 from cities gc
              where gc.id = any(v_city_ids) and gc.name = pr.city
           )
           or (v_digits <> '' and pr.listing_number::text = v_digits)
           -- בעל/ת הנכס אינו/ה בקובץ הלקוחות; חיפוש שמו/ה מוצא את הנכס
           or exists (
             select 1 from property_owners po
              where po.property_id = pr.id
                and (po.owner_name ilike v_like
                     or (v_phone and public._crm_search_phone_match(po.owner_phone, v_digits)))
           ))
  ),
  l as (
    select lm.id, lm.display_name, lm.lead_type, lm.deal_type, lm.city, lm.status, lm.created_at,
           lm.created_at as ts
    from leads_masked lm
    where lm.agent_id = v_me
      and (lm.display_name ilike v_like or lm.city ilike v_like or lm.property_details ilike v_like
           or exists (
             select 1 from cities gc
              where gc.id = any(v_city_ids) and gc.name = lm.city
           )
           or (v_phone and lm.status = 'unlocked'
               and public._crm_search_phone_match(lm.display_phone, v_digits)))
  ),
  d as (
    select ag.id, ag.title, ag.kind, ag.status, ag.exclusive_until,
           coalesce(ag.updated_at, ag.created_at) as ts
    from agreements ag
    where ag.agent_id = v_me
      and (ag.title ilike v_like
           or ag.snapshot->>'property_line' ilike v_like
           or exists (select 1 from agent_clients ac
                      where ac.id = any(ag.client_ids) and ac.full_name ilike v_like)
           -- חותם/ת בהזנה ידנית או בעל/ת הנכס - בלי כרטיס ב-client_ids
           or exists (select 1 from agreement_signers sg
                      where sg.agreement_id = ag.id
                        and (sg.full_name ilike v_like
                             or (v_phone and public._crm_search_phone_match(sg.phone, v_digits))))
           or exists (select 1 from properties ap
                      where ap.id = any(ag.property_ids)
                        and (ap.title ilike v_like or ap.address ilike v_like
                             or ap.street ilike v_like or ap.street_key = v_key)))
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

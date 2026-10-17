-- ============================================================================
-- crm_search - החיפוש האחוד ב-CRM (docs/crm-navigation.md, "חיפוש")
-- ----------------------------------------------------------------------------
-- שדה אחד שמחפש בבת אחת בנכסים, בלקוחות, בלידים ובהסכמים של הסוכן/ת.
-- מחזירה לכל קבוצה ספירה מלאה (במסד, לא בהורדת שורות - crm-startup) ועד
-- p_limit פריטים, הטריים קודם.
--
-- ‏**security invoker, ובכוונה:** כל קבוצה נקראת דרך מה שה-CRM כבר קורא, עם
-- ה-RLS שכבר חל עליו - ולכן אין כאן עותק שני של "מי רשאי/ת לראות מה":
--   • לקוחות - agent_clients, שה-RLS שלה פותח שלי ושהופנו אליי.
--   • לידים - leads_masked, ובאותו מיסוך בדיוק: ליד נעול מחזיר שם ממוסך.
--     ‏raw_phone ו-raw_message אינם נקראים כאן כלל.
--   • נכסים והסכמים - שלי בלבד (agent_id = current_agent_id()). ה-RLS של
--     properties פותח גם כל נכס פעיל באתר ולמנהל/ת את כל המשרד, וזה לא
--     "חיפוש בתיק שלי".
-- גם הלידים מסוננים ל-agent_id = current_agent_id(): מנהל/ת משרד רואה ב-RLS
-- את כל לידי המשרד, והחיפוש הוא של העבודה האישית.
--
-- ‏**חיפוש לפי טלפון מחזיר את הפריט ולא את הטלפון.** אף שדה טלפון אינו יוצא
-- בפלט. נרמול כמו ב-lead_visitor_groups: ספרות בלבד ו-972 בראש הופך ל-0.
-- מ-9 ספרות ומעלה ההתאמה היא ל-9 הספרות האחרונות; פחות מזה - הכלה. בליד
-- ההתאמה רק מול ליד פתוח: display_phone של ליד נעול ממוסך, והתאמה מולו
-- הייתה מאשרת למי שאינו/ה בעל/ת הליד שהמספר הזה שייך לפונה.
-- ============================================================================

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
           coalesce(pr.updated_at, pr.created_at) as ts
    from properties pr
    where pr.agent_id = v_me
      and (pr.title ilike v_like or pr.address ilike v_like or pr.street ilike v_like
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
    'props',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from p order by ts desc limit v_lim) x), '[]'::jsonb),
    'leads',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from l order by ts desc limit v_lim) x), '[]'::jsonb),
    'deals',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from d order by ts desc limit v_lim) x), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

-- ההשוואה של מספר טלפון שמור מול הספרות שהוקלדו. נפרדת כדי שהנרמול יהיה
-- אחד לשתי הטבלאות. immutable ובלי גישה לטבלה, ולכן אינה מגלה דבר בעצמה.
create or replace function public._crm_search_phone_match(p_stored text, p_digits text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_stored is null or coalesce(p_digits, '') = '' then false
    else (
      with n as (
        select case when d like '972%' then '0' || substr(d, 4) else d end as d
        from (select regexp_replace(p_stored, '[^0-9]', '', 'g') as d) s
      )
      select case when char_length(p_digits) >= 9 then right(n.d, 9) = right(p_digits, 9)
                  else position(p_digits in n.d) > 0 end
      from n
    )
  end
$$;

revoke all on function public.crm_search(text, int) from public, anon, authenticated;
grant execute on function public.crm_search(text, int) to authenticated;

revoke all on function public._crm_search_phone_match(text, text) from public, anon, authenticated;
grant execute on function public._crm_search_phone_match(text, text) to authenticated;

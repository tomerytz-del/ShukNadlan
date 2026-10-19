-- ============================================================================
-- admin_search - חיפוש Ctrl+K בתצוגת מנהל/ת הפלטפורמה (docs/admin-navigation.md)
-- ----------------------------------------------------------------------------
-- ‏crm_search (20270601120000) מחפש בתיק של הסוכן/ת: לקוחות, נכסים, לידים
-- והסכמים **שלי**. בתצוגת מנהל/ת הפלטפורמה השאלה אחרת - "איפה המשרד הזה",
-- "מי הסוכן/ת הזה/ו", "הנכס עם המספר הזה" - ועל כל הפלטפורמה. ולכן פונקציה
-- נפרדת ולא ענף ב-crm_search: אחרת היה בה ענף security definer שעוקף RLS
-- בתוך פונקציה שכל סוכן/ת קורא/ת.
--
-- ‏**security definer**, עם בדיקת current_is_platform_admin() בשורה הראשונה -
-- כמו platform_market_report: ה-RLS של agencies ו-agency_members אינו פתוח
-- למנהל/ת הפלטפורמה על כל המשרדים.
--
-- ‏**בלי לידים, ובלי טלפון או מייל בשום שורה.** שם הפונה הוא מידע אישי של
-- גולש/ת, ולידים ייכנסו לתיבת המשימות (שלב 3 בשדרוג האדמין) עם ההרשאות של
-- המקור שלהם. מה שחוזר כאן הוא מה שכבר פומבי באתר: שם משרד, שם סוכן/ת,
-- כותרת נכס ועיר - ומזהים לפתיחת הדף.
--
-- ספירה במסד ועד p_limit פריטים לקבוצה, הטריים קודם (crm-startup).
-- ============================================================================

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
           coalesce(p.updated_at, p.created_at) as ts
      from public.properties p
      left join public.agencies a on a.id = p.agency_id
     where p.title ilike v_like or p.address ilike v_like or p.city ilike v_like
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
    'aprops',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                          from (select * from pr order by ts desc limit v_lim) x), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.admin_search(text, int) is
  'חיפוש Ctrl+K בתצוגת מנהל/ת הפלטפורמה: משרדים, סוכנים ונכסים בכל הפלטפורמה. בלי לידים ובלי טלפון או מייל. security definer שמסרב ב-42501 למי שאינו/ה מנהל/ת.';

revoke all on function public.admin_search(text, int) from public, anon, authenticated;
grant execute on function public.admin_search(text, int) to authenticated;

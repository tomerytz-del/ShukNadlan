-- ===========================================================================
-- מודיעין שווקים: משרד ב-Google Places משויך לעיר שבכתובת שלו
-- ===========================================================================
--
-- עד היום כל משרד ששב מסריקה של עיר נרשם לעיר **שנסרקה**, והמספר בטבלה
-- היה market_intel_scans.offices - כמה משרדים גוגל החזירה סביב העיר. שתי
-- תקלות נבעו מזה, ושתיהן נראו בנתונים של 9.10.2026 בשוק עפולה והעמק:
--
--   1. **הסך היה כפול.** הסריקה מחפשת **סביב** מרכז העיר (locationBias,
--      ‏7 ק"מ) ולא בתוכה, ולכן משרד בעפולה חוזר גם בסריקה של אחוזת ברק.
--      הסך בפאנל (124) היה סכום של הסריקות, כלומר אותו משרד נספר פעמיים
--      ושלוש. ‏place_id בטבלה כבר היה ייחודי - רק המספר לא נשען עליה.
--   2. **הפירוק לפי עיר היה שגוי.** אחוזת ברק הראתה 15 משרדים בגוגל מול
--      14 מתווכים ברשם, כי משרדי עפולה נרשמו אליה.
--
-- מעכשיו: הסריקה מבקשת מגוגל גם את רכיבי הכתובת, ‏ads-admin מעבירה לכאן את
-- היישוב (locality) של כל משרד, והוא מפוענח ב-city_id_for_name - אותו פענוח
-- של כתובות הנכסים, כולל כינויים. **היישוב עצמו אינו נשמר**: תנאי השימוש
-- של גוגל מתירים לשמור place_id, ומה שנשמר כאן הוא השיוך שלנו לעיר.
--
--   | הכתובת בגוגל              | מה קורה                                  |
--   |---------------------------|------------------------------------------|
--   | יישוב שמוכר אצלנו          | נרשם לעיר הזו, גם אם נסרקה עיר אחרת       |
--   | יישוב שאינו מוכר אצלנו     | אינו נספר, ושורה ישנה שלו נמחקת           |
--   | בלי יישוב בכתובת           | נרשם לעיר שנסרקה - אין לנו מידע טוב יותר  |
--
-- והמספר בפאנל נספר מהטבלה (משרד אחד = שורה אחת = עיר אחת), כך שהסך אינו
-- יכול לספור משרד פעמיים.
--
-- ‏**השורות הקיימות** נשארות כפי שהן עד הסריקה הבאה של כל עיר, שמתקנת אותן.
-- ===========================================================================

create or replace function public.market_intel_store_places(p_places jsonb, p_scanned_city uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_place    jsonb;
  v_locality text;
  v_city     uuid;
  v_here     int := 0;
  v_moved    int := 0;
  v_outside  int := 0;
  v_unknown  int := 0;
begin
  for v_place in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
    continue when coalesce(v_place->>'id', '') = '';
    v_locality := nullif(btrim(coalesce(v_place->>'locality', '')), '');

    if v_locality is null then
      v_city := p_scanned_city;
      v_unknown := v_unknown + 1;
    else
      v_city := public.city_id_for_name(v_locality);
    end if;

    if v_city is null then
      -- יישוב שאינו אצלנו: לא נספר באף עיר. שורה שנרשמה בעבר לעיר שנסרקה
      -- (לפני התיקון) נמחקת, אחרת היא הייתה ממשיכה להיספר שם.
      delete from public.market_intel_places where place_id = v_place->>'id';
      v_outside := v_outside + 1;
      continue;
    end if;

    insert into public.market_intel_places (place_id, city_id, last_seen)
    values (v_place->>'id', v_city, now())
    on conflict (place_id) do update set city_id = excluded.city_id, last_seen = excluded.last_seen;

    if v_city = p_scanned_city then v_here := v_here + 1; else v_moved := v_moved + 1; end if;
  end loop;

  return jsonb_build_object('in_city', v_here, 'other_city', v_moved, 'outside', v_outside, 'no_locality', v_unknown);
end;
$$;

comment on function public.market_intel_store_places(jsonb, uuid) is
  'שומרת משרדים מסריקת Google Places לפי היישוב שבכתובת (city_id_for_name), ולא לפי העיר שנסרקה. היישוב אינו נשמר. נקראת מ-ads-admin בלבד. docs/marketing-console.md';

revoke all on function public.market_intel_store_places(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.market_intel_store_places(jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- אותה פונקציה (20270310090000_market_intel.sql), והמספר בגוגל נספר עכשיו
-- מ-market_intel_places. עיר שלא נסרקה ואין לה משרד משויך - null ("לא נסרק").
-- ‏create or replace שומר את ההרשאות הקיימות.
-- ---------------------------------------------------------------------------
create or replace function public.platform_market_intel(p_market text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(x) order by x.market_slug, x.registry_brokers desc nulls last, x.name), '[]'::jsonb)
    into v_out
    from (
      select c.id as city_id,
             c.name,
             c.market_slug,
             (select sum(r.brokers) from public.market_intel_registry r
               where r.city_key = public.city_name_key(c.name))::int as registry_brokers,
             case when s.city_id is null and g.n = 0 then null else g.n end as google_offices,
             s.capped  as google_capped,
             s.scanned_at,
             (select count(*) from public.agencies a where a.city_id = c.id)::int as platform_agencies,
             (select count(*) from public.agency_members m
                join public.agencies a on a.id = m.agency_id
               where a.city_id = c.id and m.active and m.released_at is null)::int as platform_agents
        from public.cities c
        left join public.market_intel_scans s on s.city_id = c.id
        cross join lateral (
          select count(*)::int as n from public.market_intel_places p where p.city_id = c.id
        ) g
       where c.market_slug is not null
         and (p_market is null or c.market_slug = p_market)
    ) x;

  return jsonb_build_object(
    'cities', v_out,
    'registry_refreshed_at', (select max(refreshed_at) from public.market_intel_registry)
  );
end;
$$;

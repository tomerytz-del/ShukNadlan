-- ============================================================================
-- התאמות ללקוח/ה מהלוחות (יד2 / מדלן), מדורגות באותו מנוע של הנכסים
--
-- מה חסר היום:
--   מודעות הלוחות מגיעות לסוכן/ת רק דרך גבריאלה, וגם שם בלי דירוג: חמש
--   האחרונות שנראו. בכרטיס הלקוח/ה ב-CRM אין להן זכר. במדידה של 19.11.2026
--   כרטיס עם עיר, מחיר וחדרים "התאים" ל-134 מודעות בחציון, כלומר לא התאים
--   לאף אחת: לא היה לפי מה לבחור.
--   מאז 20271119140000 המודעה נושאת גם שטח, קומה ושכונה (1,453 מתוך 1,607
--   עם שטח, 1,117 עם שכונה), ויש לפי מה לדרג.
--
-- מה נכנס:
--   1. board_listing_site_type(text): סוג הנכס של המודעה בכתיב של האתר
--      ("בית פרטי/ קוטג'" -> "בית פרטי/קוטג'", "פנטהאוז" -> "גג/פנטהאוז").
--      client_property_match משווה את סוג הנכס למה שבכרטיס הלקוח/ה בשוויון
--      מחרוזות, והכרטיס כתוב בכתיב של האתר.
--   2. client_board_matches(client, limit): **אין כאן כלל התאמה משלה**. לכל
--      מודעה נבנית שורת properties בזיכרון (כמו הנכס של דוח ה-CMA לכתובת),
--      והיא עוברת ב-client_property_match - מקור האמת היחיד לציון. כלל
--      שישתנה שם חל גם על הלוחות, בלי שורה כאן.
--   4. agent_client_board_matches_for_agent(agent, client, limit, waive): העטיפה
--      לגבריאלה (service_role), עם הוויתור על מאפיין חובה שהסוכן/ת אישר/ה שם.
--      כך הבוט וה-CRM מציגים את אותן מודעות באותו סדר.
--   3. agent_client_board_matches(client_id, limit): העטיפה לדפדפן. רק לקוח/ה
--      של הסוכן/ת המחובר/ת, כמו match_properties_for_client, ואותו סף ציון (50).
--
-- מה חוזר: status, total (כל מה שעבר את הסף, לפני החיתוך), top_score ו-
-- top_count (כמה מודעות חולקות את הציון הגבוה), ועד limit מודעות לפי ציון,
-- ובתוך אותו ציון: ירידת מחיר, מחיר למ"ר נמוך, ואז החדשה. לכל מודעה: לוח, עיר, שכונה, סוג, חדרים, שטח, קומה, מחיר, ציון,
-- הסיבות של המנוע, מתי נראתה לראשונה, ומחיר קודם אם ירדה ב-30 הימים האחרונים.
--
-- status שאינו 'ok' אומר למה אין מודעות, כדי שהמסך לא יכתוב "אין התאמות" על
-- מה שלא נבדק:
--   skipped_feature - בכרטיס יש מאפיין חובה (ממ"ד, מעלית), ובמודעת לוח אין
--                     מאפיינים. המנוע היה פוסל את כולן; אומרים שלא נבדק.
--   no_city         - בכרטיס אין עיר. לא סורקים את כל הארץ.
--   unavailable     - המלאי אינו מכסה את הערים של הכרטיס.
--   unsupported     - לקוח/ה מסחרי/ת שאינו/ה מחפש/ת מגרש: במלאי אין נכסים מסחריים.
--   none            - נבדק, ואין מודעה מעל הסף.
--
-- מה שנשמר מהכללים של המלאי (docs/listing-inventory.md): קריאה בלבד, אין
-- טלפון ואין שם, אין ליד, אין התראה, אין חיוב ואין פנייה לבעלים. הקישור
-- למודעה חוזר רק כשהוא https של יד2 או מדלן, והמסך מציג אותו ככפתור.
-- מודעה שסומנה is_duplicate (#1330, אותו נכס בלוח השני) אינה חוזרת פעמיים.
-- ============================================================================

create or replace function public.board_listing_site_type(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when t is null then null
    when t in ('בית פרטי', 'קוטג''', 'קוטג'' טורי', 'וילה') then 'בית פרטי/קוטג'''
    when t in ('פנטהאוז', 'מיני פנטהאוז', 'דירת גג') then 'גג/פנטהאוז'
    else t
  end
  from (select nullif(regexp_replace(btrim(coalesce(p_type, '')), '\s*/\s*', '/', 'g'), '') as t) s
$$;
comment on function public.board_listing_site_type(text) is
  'סוג הנכס של מודעת לוח בכתיב של האתר, כדי ש-client_property_match ישווה אותו למה שבכרטיס הלקוח/ה. docs/listing-inventory.md';
revoke all on function public.board_listing_site_type(text) from public, anon, authenticated;
grant execute on function public.board_listing_site_type(text) to service_role;

create or replace function public.client_board_matches(
  p_client public.agent_clients,
  p_limit int default 5,
  p_waive_features text[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit   int := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_min     int := 50;   -- אותו סף של match_properties_for_client
  v_waive   text[] := coalesce(p_waive_features, '{}'::text[]);
  v_wants_land boolean;
  v_city_ids uuid[];
  v_stock   int;
  v_out     jsonb;
begin
  if p_client.id is null
     or p_client.client_kind is distinct from 'seeker'
     or p_client.deal_type is null then
    return null;
  end if;
  -- מאפיין חובה שהסוכן/ת לא ויתר/ה עליו במפורש (p_waive_features, כמו בגבריאלה)
  -- חוסם: במודעה אין מאפיינים, והמנוע היה פוסל את כולן.
  if exists (select 1 from unnest(coalesce(p_client.required_features, '{}'::text[])) f
              where f is not null and f <> '' and not (f = any (v_waive))) then
    return jsonb_build_object('status', 'skipped_feature');
  end if;
  -- מגרש נכנס רק כשהכרטיס מבקש מגרש במפורש. כרטיס בלי סוג נכס מחפש בית,
  -- ומגרש ב-900 אלף אינו "דירה זולה".
  v_wants_land := coalesce(p_client.property_types, '{}'::text[]) && array['מגרש', 'מגרשים'];
  -- במלאי אין נכסים מסחריים (רק מגורים ומגרשים). לקוח/ה מסחרי/ת שאינו/ה
  -- מחפש/ת מגרש לא נבדק/ת כאן, וזה נאמר: "אין מודעות" היה שקר.
  if p_client.category is distinct from 'residential' and not v_wants_land then
    return jsonb_build_object('status', 'unsupported');
  end if;
  if cardinality(coalesce(p_client.cities, '{}'::text[])) = 0 then
    return jsonb_build_object('status', 'no_city');
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_city_ids
    from unnest(p_client.cities) c(name), unnest(public.city_ids_for_name(c.name)) x;

  select count(*)::int into v_stock
    from public.listing_inventory i
   where i.removed_at is null
     and i.deal_type = p_client.deal_type
     and i.city_id = any (v_city_ids);
  if v_stock = 0 then
    return jsonb_build_object('status', 'unavailable');
  end if;

  with cand as (
    -- סינון זול לפני המנוע: אותם גבולות מחיר של השער שלו, כדי לא להריץ
    -- אותו על מודעות שהוא ידחה ממילא.
    select i.id, i.source, i.city, i.city_id, i.deal_type, i.rooms, i.price, i.size_sqm,
           i.floor, i.neighborhood, i.url, i.first_seen_at,
           public.board_listing_site_type(i.property_type) as site_type,
           public.board_listing_kind(i.property_type) as kind
      from public.listing_inventory i
     where i.removed_at is null
       and i.deal_type = p_client.deal_type
       and i.city_id = any (v_city_ids)
       and i.price is not null and i.price > 0 and i.price <> 'NaN'::numeric
       and (p_client.max_price is null or i.price <= p_client.max_price * 1.10)
       and (p_client.min_price is null or i.price >= p_client.min_price * 0.85)
       -- רק מודעה שאפשר לפתוח: בלי קישור של לוח אין מה להציג, והיא לא
       -- נספרת ב-total ולא תופסת מקום בחמש הראשונות.
       and i.url ~ '^https://(www\.)?(yad2|madlan)\.co\.il/'
       -- to_jsonb ולא i.is_duplicate: העמודה מגיעה עם #1330, ועד אז אינה קיימת
       and not coalesce((to_jsonb(i) ->> 'is_duplicate')::boolean, false)
  ),
  typed as (
    -- סוג שאין לו סיווג (משק, בניין, חניה, מסחרי) אינו נכס מגורים ואינו מגרש:
    -- הוא לא נכנס. ומגרש רק למי שביקש מגרש.
    select c.* from cand c
     where c.kind is not null
       and (c.kind <> 'land' or v_wants_land)
       and (c.kind = 'land' or p_client.category = 'residential')
  ),
  hoods as (
    -- שם השכונה שבמודעה -> מזהה, פעם אחת לכל שם, ורק כשהכרטיס מבקש שכונה
    select h.city, h.neighborhood, public.neighborhood_ids_for(h.city, h.neighborhood) as ids
      from (select distinct c.city, c.neighborhood from typed c
             where p_client.neighborhood_id is not null and c.neighborhood is not null) h
  ),
  scored as (
    select c.*, m.score, m.reasons
      from typed c
      left join hoods h on h.city = c.city and h.neighborhood = c.neighborhood
      cross join lateral public.client_property_match(
        p_client,
        jsonb_populate_record(null::public.properties, jsonb_build_object(
          'id', c.id,
          'status', 'active',
          'deal_type', c.deal_type,
          -- מגרש אינו "מגורים" או "מסחרי" במודעת לוח: הוא מקבל את הקטגוריה
          -- ואת שם הסוג שבכרטיס ("מגרש" / "מגרשים"), אם הכרטיס מבקש מגרש.
          'category', case when c.kind = 'land' then p_client.category else 'residential' end,
          'property_type', case
              when c.kind = 'land' then coalesce(
                (select t from unnest(coalesce(p_client.property_types, '{}'::text[])) t
                  where t in ('מגרש', 'מגרשים') limit 1), c.site_type)
              else c.site_type end,
          'price', c.price,
          'rooms', c.rooms,
          'size_sqm', c.size_sqm,
          'floor', c.floor,
          'city', c.city,
          'city_id', c.city_id,
          'neighborhood_id', case
              when h.ids is null or cardinality(h.ids) = 0 then null
              when p_client.neighborhood_id = any (h.ids) then p_client.neighborhood_id
              else h.ids[1] end,
          'features', '{}'::text[])),
        v_waive
      ) m
     where m.score >= v_min
  ),
  priced as (
    select s.*,
           -- מחיר למ"ר רק במכירה: שכירות חודשית חלקי שטח אינה מחיר למ"ר
           case when s.size_sqm > 0 and s.kind is distinct from 'land' and s.deal_type = 'sale'
                then round(s.price / s.size_sqm) end as price_per_sqm,
           -- המחיר שהיה בתחילת 30 הימים, רק אם הוא גבוה מהמחיר היום (ירידה נטו)
           (select h.old_price
              from public.listing_inventory_price_history h
             where h.listing_id = s.id
               and h.changed_at >= pg_catalog.now() - interval '30 days'
             order by h.changed_at, h.id
             limit 1) as first_old
      from scored s
  ),
  ranked as (
    -- **הציון לבדו אינו מבחין.** הוא נמדד מול הדרישות שבכרטיס, וכרטיס רחב
    -- ("דירה, 4 חדרים ומעלה, עד 1.5 מיליון") נותן 100% למאות מודעות: 203 מתוך
    -- 268 בעפולה, נמדד 19.11.2026. לכן בתוך אותו ציון הסדר הוא: מודעה שירדה
    -- במחיר, אחר כך המחיר למ"ר הנמוך, אחר כך החדשה. זה סדר הצגה ולא כלל
    -- התאמה, ו-top_count אומר למסך כמה חולקות את הציון הגבוה.
    select p.*, count(*) over () as total,
           count(*) over (partition by p.score) as same_score,
           case when p.first_old > p.price and p.price >= p.first_old * 0.5 then p.first_old end as price_was,
           row_number() over (
             order by p.score desc,
                      case when p.first_old > p.price and p.price >= p.first_old * 0.5 then 0 else 1 end,
                      p.price_per_sqm asc nulls last,
                      p.first_seen_at desc, p.id) as rn
      from priced p
  )
  select jsonb_build_object(
           'status', 'ok',
           'total', max(r.total),
           'top_score', max(r.score),
           'top_count', max(r.same_score) filter (where r.rn = 1),
           'items', jsonb_agg(jsonb_build_object(
             'id', r.id,
             'source', r.source,
             'city', r.city,
             'deal_type', r.deal_type,
             'neighborhood', r.neighborhood,
             'property_type', r.site_type,
             'rooms', r.rooms,
             'size_sqm', r.size_sqm,
             'floor', r.floor,
             'price', r.price,
             'price_per_sqm', r.price_per_sqm,
             'score', r.score,
             'reasons', to_jsonb(r.reasons),
             'first_seen_at', r.first_seen_at,
             'price_was', r.price_was,
             'url', r.url
           ) order by r.rn))
    into v_out
    from ranked r
   where r.rn <= v_limit;

  -- אגרגט בלי group by מחזיר שורה גם על אפס מודעות (items הוא null), ולכן
  -- בודקים את items ולא את v_out.
  if v_out is null or jsonb_typeof(v_out->'items') is distinct from 'array' then
    return jsonb_build_object('status', 'none', 'total', 0);
  end if;
  return v_out;
end $$;

comment on function public.client_board_matches(public.agent_clients, int, text[]) is
  'מודעות יד2/מדלן שמתאימות ללקוח/ה, מדורגות ב-client_property_match על שורת properties שנבנית מהמודעה. בלי כלל התאמה משלה. status אומר למה אין מודעות (skipped_feature / no_city / unavailable / none). docs/listing-inventory.md';
revoke all on function public.client_board_matches(public.agent_clients, int, text[]) from public, anon, authenticated;
grant execute on function public.client_board_matches(public.agent_clients, int, text[]) to service_role;

create or replace function public.agent_client_board_matches(p_client_id uuid, p_limit int default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent  uuid := public.current_agent_id();
  v_client public.agent_clients;
begin
  if v_agent is null or p_client_id is null then
    return null;
  end if;
  -- רק לקוח/ה של הסוכן/ת המחובר/ת, כמו match_properties_for_client
  select * into v_client
    from public.agent_clients
   where id = p_client_id and agent_id = v_agent;
  if not found then
    return null;
  end if;
  return public.client_board_matches(v_client, p_limit, '{}'::text[]);
end $$;

comment on function public.agent_client_board_matches(uuid, int) is
  'התאמות ללקוח/ה מהלוחות יד2/מדלן, למגירת ההתאמות בכרטיס הלקוח/ה ב-CRM. רק לקוח/ה של הסוכן/ת. קריאה בלבד: בלי ליד, התראה או חיוב.';
revoke all on function public.agent_client_board_matches(uuid, int) from public, anon, authenticated;
grant execute on function public.agent_client_board_matches(uuid, int) to authenticated, service_role;

-- העטיפה לגבריאלה. הזהות מגיעה מהבוט (service_role), כמו ב-agent_client_matches,
-- ורק לקוח/ה של אותו/ה סוכן/ת. p_waive_features הוא ויתור שהסוכן/ת אישר/ה בשיחה.
create or replace function public.agent_client_board_matches_for_agent(
  p_agent_id       uuid,
  p_client_id      uuid,
  p_limit          int    default 5,
  p_waive_features text[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client public.agent_clients;
begin
  if p_agent_id is null or p_client_id is null then
    return null;
  end if;
  select * into v_client
    from public.agent_clients
   where id = p_client_id and agent_id = p_agent_id;
  if not found then
    return null;
  end if;
  return public.client_board_matches(v_client, p_limit, p_waive_features);
end $$;

comment on function public.agent_client_board_matches_for_agent(uuid, uuid, int, text[]) is
  'התאמות ללקוח/ה מהלוחות יד2/מדלן, לגבריאלה: אותו דירוג של agent_client_board_matches, עם ויתור על מאפיין חובה שהסוכן/ת אישר/ה. service_role בלבד.';
revoke all on function public.agent_client_board_matches_for_agent(uuid, uuid, int, text[]) from public, anon, authenticated;
grant execute on function public.agent_client_board_matches_for_agent(uuid, uuid, int, text[]) to service_role;

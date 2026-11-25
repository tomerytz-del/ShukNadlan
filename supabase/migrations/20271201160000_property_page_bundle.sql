-- דף הנכס: סבב אחד למסד במקום שניים
--
-- מה איטי היום: `og-tags.ts` (‏Netlify Edge) ממלא את דף הנכס בשני סבבים
-- ל-PostgREST, והשני תלוי בראשון - קודם שורת הנכס, ואז במקביל שלוש שאילתות
-- שצריכות שדות ממנה: מודעות באותו רחוב (להבדלת הכותרת), שם הסוכן/ת, וכרטיס
-- השכונה. כל סבב עולה כ-170ms של רשת מה-edge, והשאילתות עצמן 5-9ms. כך דף
-- הנכס הוא הדף היחיד ב"תגובה איטית" של הסוכן התפעולי בלי ששום שאילתה בו
-- איטית (‏25.11.2026: ‏60ms בלי מסד, ‏230ms בסבב אחד, ‏350-800ms בשניים).
--
-- מה נכנס: `property_page_bundle(uuid)` מחזירה את ארבעת החלקים בתשובה אחת.
-- ‏SECURITY INVOKER - היא רואה בדיוק מה ש-anon רואה בארבע השאילתות של היום,
-- ו-RLS חל כרגיל. אין כאן שום נתון שלא יצא כבר לדפדפן.
--
-- החוזה מול `og-tags.ts`:
--   ‏{"found": false}  - אין נכס פעיל במזהה הזה (404 בדף).
--   ‏{"found": true, "property": {...}, "siblings": [...] | null,
--    "agent_display": text | null, "hoods": [...]}
-- ‏`property` באותה צורה שהשאילתה ב-`propertyMeta` מחזירה (כולל ה-embed של
-- ‏`neighborhoods` ו-`agencies`). ‏`siblings` הוא null כשאין עיר או סוג נכס -
-- כמו `siblingFilter` שמחזיר מחרוזת ריקה.
--
-- ‏`property_public_street_name` היא **העתק** של `streetNameOf` +
-- ‏`maskHouseNumber` ב-`netlify/edge-functions/og-tags.ts` (וב-
-- ‏`assets/property.js`). שינוי באחד מחייב את אותו שינוי כאן. סינון האחים
-- הוא העתק של `siblingFilter` ב-`assets/listing-title.js`.
--
-- האתר סובל את היעדרה: כשהקריאה אינה מחזירה את הצורה הזו, `og-tags.ts` חוזר
-- למסלול של שני הסבבים. ‏create or replace: אידמפוטנטית.

create or replace function public.property_public_street_name(
  p_street       text,
  p_address      text,
  p_house_number text
)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select btrim(regexp_replace(regexp_replace(
    case
      when m.raw = '' or m.hn = '' then m.raw
      else btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
             m.raw,
             '(^|[^\d])' || regexp_replace(m.hn, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '(?!\d)',
             '\1', 'g'),
             '\s+', ' ', 'g'),
             '\s+([,·])', '\1', 'g'),
             '^[\s,·—–-]+|[\s,·—–-]+$', '', 'g'))
    end,
    '^רחוב\s+', ''), '\s+', ' ', 'g'))
  from (
    select btrim(coalesce(nullif(p_street, ''), p_address, '')) as raw,
           btrim(coalesce(p_house_number, '')) as hn
  ) m;
$fn$;

revoke all on function public.property_public_street_name(text, text, text) from public, anon, authenticated;
grant execute on function public.property_public_street_name(text, text, text) to anon, authenticated, service_role;

create or replace function public.property_page_bundle(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  with p as (
    select pr.*
      from public.properties pr
     where pr.id = p_id and pr.status = 'active'
  ), k as (
    select btrim(coalesce(p.city, '')) as city,
           btrim(coalesce(p.property_type, '')) as ptype,
           public.property_public_street_name(p.street, p.address, p.house_number) as street_name
      from p
  )
  select coalesce((
    select jsonb_build_object(
      'found', true,
      'property', (
        select to_jsonb(t) from (
          select p.title, p.house_number, p.address, p.street, p.city, p.sales_area, p.images,
                 p.price, p.deal_type, p.rooms, p.size_sqm, p.status,
                 (select jsonb_build_object('name', n.name, 'is_planned', n.is_planned)
                    from public.neighborhoods n where n.id = p.neighborhood_id) as neighborhoods,
                 p.description, p.marketing_description, p.marketing_description_stale,
                 p.property_type, p.floor, p.updated_at, p.price_per_sqm, p.category,
                 p.price_includes_vat, p.price_unit, p.total_floors, p.built_size_sqm,
                 p.garden_sqm, p.condition, p.move_in_date, p.move_in_soon, p.project_status,
                 p.furniture_details, p.maintenance_fee, p.arnona, p.features,
                 p.air_directions, p.living_room_sqm,
                 p.mamad_location, p.storage_location, p.restrooms_location,
                 p.agent_id, p.agent2_name,
                 (select jsonb_build_object('name', a.name, 'slug', a.slug, 'logo_url', a.logo_url)
                    from public.agencies a where a.id = p.agency_id) as agencies,
                 p.video_url, p.video_poster_url, p.city_id, p.lat, p.lng
        ) t
      ),
      'siblings', case when k.city = '' or k.ptype = '' then null else (
        select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) from (
          select x.id, x.street, x.address, x.house_number, x.city, x.rooms, x.size_sqm,
                 x.floor, x.deal_type, x.price, x.property_type, x.title
            from public.properties x
           where x.status = 'active'
             and x.city = k.city
             and x.property_type = k.ptype
             and case
                   when k.street_name <> '' then
                     x.street = k.street_name
                     or x.street = 'רחוב ' || k.street_name
                     or x.address ilike '%' || k.street_name || '%'
                   else
                     (x.street is null or x.street = '')
                     and (x.address is null or x.address = '')
                 end
        ) s
      ) end,
      'agent_display', (
        select m.display_name from public.agency_members_public m where m.id = p.agent_id
      ),
      'hoods', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name', i.name, 'city_slug', i.city_slug, 'slug', i.slug, 'props', i.props))
          from public.neighborhood_pages_public() i
          join public.neighborhoods n on n.id = p.neighborhood_id
         where i.city = k.city
           and i.name in (n.name, btrim(regexp_replace(n.name, '\s+', ' ', 'g')))
      ), '[]'::jsonb)
    )
    from p cross join k
  ), jsonb_build_object('found', false));
$fn$;

-- נקראת מה-edge עם המפתח הציבורי, כמו ארבע השאילתות שהיא מחליפה.
revoke all on function public.property_page_bundle(uuid) from public, anon, authenticated;
grant execute on function public.property_page_bundle(uuid) to anon, authenticated, service_role;

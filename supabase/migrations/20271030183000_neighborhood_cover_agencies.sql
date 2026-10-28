-- ============================================================================
-- דף שכונה: תמונת שער, משרדים פעילים, ורשימת נכסים לסינון בלי פרמטרים בכתובת
-- (docs/neighborhood-pages.md)
--
-- עד כאן לדף לא הייתה תמונה משלו, לא רשימת משרדים, והסינון שלח את הגולש
-- לדף הבית. תמונת השער היא ה-LCP, ולכן היא עמודה ולא קובץ שמגיע רק אחרי JS.
--
-- האתר עולה לפני המיגרציה. הקוד קורא את השדות החדשים רק אם הם באובייקט
-- ש-neighborhood_page מחזירה, ובלעדיהם הדף נשאר כמו שהיה.
-- ============================================================================

alter table public.neighborhood_descriptions
  add column if not exists hero_intro text;

comment on column public.neighborhood_descriptions.hero_intro is
  'פסקת פתיחה קצרה מתחת לכותרת בדף השכונה, וגם תיאור המטא כשהיא קיימת. עד 200 תווים. ריק = הלוגיקה הקודמת.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.neighborhood_descriptions'::regclass
      and conname = 'neighborhood_descriptions_hero_intro_len'
  ) then
    alter table public.neighborhood_descriptions
      add constraint neighborhood_descriptions_hero_intro_len
      check (hero_intro is null or char_length(hero_intro) <= 200);
  end if;
end $$;

alter table public.neighborhoods
  add column if not exists cover_path text,
  add column if not exists cover_alt text,
  add column if not exists cover_credit jsonb,
  add column if not exists poi jsonb not null default '{}'::jsonb;

comment on column public.neighborhoods.cover_path is
  'נתיב בתוך הדלי neighborhood-covers. ריק = הדף בלי תמונת שער.';
comment on column public.neighborhoods.cover_alt is
  'טקסט חלופי לתמונת השער. לא כתובת ולא מספר טלפון.';
comment on column public.neighborhoods.cover_credit is
  'קרדיט גלוי מתחת לתמונת השער: author, license, url. ריק = בלי שורה.';
comment on column public.neighborhoods.poi is
  'צ''יפים לדף: parks, transport, education, leisure. מערכי טקסט קצרים. ריק = בלי שורה.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.neighborhoods'::regclass
      and conname = 'neighborhoods_cover_shape'
  ) then
    alter table public.neighborhoods
      add constraint neighborhoods_cover_shape check (
        cover_path is null
        or cover_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
      );
  end if;
end $$;

-- נבדק מול הפרודקשן ב-28.10.2026: אין cover_credit ואין admin_hood_cover_set,
-- ולכן אין חתימה ישנה להסיר.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.neighborhoods'::regclass
      and conname = 'neighborhoods_cover_credit_shape'
  ) then
    alter table public.neighborhoods
      add constraint neighborhoods_cover_credit_shape check (
        cover_credit is null
        or (
          jsonb_typeof(cover_credit) = 'object'
          and cover_credit - 'author' - 'license' - 'url' = '{}'::jsonb
          and (not jsonb_exists(cover_credit, 'author') or (
            jsonb_typeof(cover_credit->'author') = 'string'
            and char_length(cover_credit->>'author') between 1 and 80
          ))
          and (not jsonb_exists(cover_credit, 'license') or (
            jsonb_typeof(cover_credit->'license') = 'string'
            and char_length(cover_credit->>'license') between 1 and 80
          ))
          and (not jsonb_exists(cover_credit, 'url') or (
            jsonb_typeof(cover_credit->'url') = 'string'
            and char_length(cover_credit->>'url') between 1 and 300
            and cover_credit->>'url' ~ '^https://'
          ))
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- דלי ציבורי. כתובת /object/public/ נפתחת בלי מדיניות SELECT.
-- מדיניות SELECT בלי TO הייתה נותנת לכל אחד לרשום את קבצי הדלי.
-- הכתיבה רק למנהל/ת פלטפורמה.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'neighborhood-covers', 'neighborhood-covers', true, 8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "hood cover public read" on storage.objects;

-- remove() צריך גם SELECT. בלי זה המחיקה שקטה, והקובץ נשאר בדלי.
-- "mfa required for storage" היא RESTRICTIVE, ולכן אין מדיניות אחרת שפותחת את הדלי.
drop policy if exists "hood cover admin select" on storage.objects;
create policy "hood cover admin select"
  on storage.objects for select to authenticated
  using (bucket_id = 'neighborhood-covers' and public.current_is_platform_admin());

drop policy if exists "hood cover admin insert" on storage.objects;
create policy "hood cover admin insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'neighborhood-covers' and public.current_is_platform_admin());

drop policy if exists "hood cover admin update" on storage.objects;
create policy "hood cover admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'neighborhood-covers' and public.current_is_platform_admin())
  with check (bucket_id = 'neighborhood-covers' and public.current_is_platform_admin());

drop policy if exists "hood cover admin delete" on storage.objects;
create policy "hood cover admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'neighborhood-covers' and public.current_is_platform_admin());

-- ---------------------------------------------------------------------------
-- שמירת השער והצ'יפים. לא כתיבה ישירה מהדפדפן לעמודות: הנתיב חייב להיות
-- קובץ שהמנהל/ת העלה לדלי, תחת תיקיית השכונה.
-- ---------------------------------------------------------------------------

create or replace function public.admin_hood_cover_set(
  p_id uuid,
  p_path text,
  p_alt text,
  p_credit text,
  p_poi jsonb,
  p_license text default null,
  p_credit_url text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
  v_alt text := nullif(left(btrim(translate(coalesce(p_alt, ''), '—–', '--')), 180), '');
  v_author text := nullif(left(btrim(translate(coalesce(p_credit, ''), '—–', '--')), 80), '');
  v_license text := nullif(left(btrim(translate(coalesce(p_license, ''), '—–', '--')), 80), '');
  v_url text := nullif(btrim(coalesce(p_credit_url, '')), '');
  v_credit jsonb;
  v_poi jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.neighborhoods where id = p_id) then
    raise exception 'hood_not_found' using errcode = '22023';
  end if;
  if v_url is not null and v_url !~ '^https://' then
    v_url := null;
  end if;
  v_credit := case
    when v_author is null and v_license is null and v_url is null then null
    else jsonb_strip_nulls(jsonb_build_object('author', v_author, 'license', v_license, 'url', left(v_url, 300)))
  end;

  if v_path is not null and v_path !~ (
    '^' || p_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception 'bad_cover_path' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'parks', coalesce((
      select jsonb_agg(s.t) from (
        select left(btrim(translate(x, '—–', '--')), 80) as t
          from jsonb_array_elements_text(
            case when jsonb_typeof(p_poi -> 'parks') = 'array' then p_poi -> 'parks' else '[]'::jsonb end
          ) x
         where btrim(coalesce(x, '')) <> ''
         limit 8
      ) s
    ), '[]'::jsonb),
    'transport', coalesce((
      select jsonb_agg(s.t) from (
        select left(btrim(translate(x, '—–', '--')), 80) as t
          from jsonb_array_elements_text(
            case when jsonb_typeof(p_poi -> 'transport') = 'array' then p_poi -> 'transport' else '[]'::jsonb end
          ) x
         where btrim(coalesce(x, '')) <> ''
         limit 8
      ) s
    ), '[]'::jsonb),
    'education', coalesce((
      select jsonb_agg(s.t) from (
        select left(btrim(translate(x, '—–', '--')), 80) as t
          from jsonb_array_elements_text(
            case when jsonb_typeof(p_poi -> 'education') = 'array' then p_poi -> 'education' else '[]'::jsonb end
          ) x
         where btrim(coalesce(x, '')) <> ''
         limit 8
      ) s
    ), '[]'::jsonb),
    'leisure', coalesce((
      select jsonb_agg(s.t) from (
        select left(btrim(translate(x, '—–', '--')), 80) as t
          from jsonb_array_elements_text(
            case when jsonb_typeof(p_poi -> 'leisure') = 'array' then p_poi -> 'leisure' else '[]'::jsonb end
          ) x
         where btrim(coalesce(x, '')) <> ''
         limit 8
      ) s
    ), '[]'::jsonb)
  ) into v_poi;

  update public.neighborhoods
     set cover_path = v_path,
         cover_alt = v_alt,
         cover_credit = v_credit,
         poi = v_poi
   where id = p_id;
end $$;

comment on function public.admin_hood_cover_set(uuid, text, text, text, jsonb, text, text) is
  'תמונת שער, קרדיט (צלם, רישיון, קישור) וצ''יפים של דף שכונה. מנהל/ת פלטפורמה בלבד (42501). הנתיב הוא קובץ בדלי neighborhood-covers.';

revoke all on function public.admin_hood_cover_set(uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.admin_hood_cover_set(uuid, text, text, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- הדף. אותו חוזה כמו 20270815090000, ועוד שער, משרדים ורשימה לסינון.
-- משרד: שם, slug, לוגו מהאחסון שלנו, ומספר נכסים. בלי טלפון, מייל או רישיון.
-- agency_is_live לפני ה-limit, כדי שמשרד לא חי לא יתפוס מקום של משרד חי.
-- ---------------------------------------------------------------------------

create or replace function public.neighborhood_page(p_city text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $page$
  with h as (
    select n.id, n.name, n.slug, c.id as city_id, c.name as city, c.slug as city_slug, c.market_slug,
           n.lat, n.lng, n.radius_m, n.cover_path, n.cover_alt, n.cover_credit, n.poi
      from public.neighborhoods n
      join public.cities c on c.id = n.city_id
     where c.slug = lower(btrim(coalesce(p_city, '')))
       and n.slug = public.neighborhood_slug(p_slug)
     order by n.created_at
     limit 1
  ), p as (
    select pr.id, pr.title, pr.property_type, pr.deal_type, pr.price, pr.price_unit,
           pr.rooms, pr.size_sqm, pr.built_size_sqm,
           pr.images[1] as image, pr.updated_at, pr.created_at,
           exists (
             select 1 from public.property_visualizations v
              where v.property_id = pr.id and v.status = 'done'
           ) as vis
      from public.properties pr, h
     where pr.neighborhood_id = h.id and pr.status = 'active'
  )
  select case when not exists (select 1 from h) then null else jsonb_build_object(
    'id', (select id from h),
    'city_id', (select city_id from h),
    'name', (select name from h),
    'slug', (select slug from h),
    'city', (select city from h),
    'city_slug', (select city_slug from h),
    'market_slug', (select market_slug from h),
    'lat', (select lat from h),
    'lng', (select lng from h),
    'radius_m', (select radius_m from h),
    'cover_path', (select cover_path from h),
    'cover_alt', (select cover_alt from h),
    'cover_credit', (select cover_credit from h),
    'poi', coalesce((select poi from h), '{}'::jsonb),
    'props_active', (select count(*) from p),
    'props_sale', (select count(*) from p where p.deal_type = 'sale'),
    'props_rent', (select count(*) from p where p.deal_type = 'rent'),
    'sale_min', (select min(p.price) from p where p.deal_type = 'sale' and p.price > 0),
    'sale_max', (select max(p.price) from p where p.deal_type = 'sale' and p.price > 0),
    'rent_min', (select min(p.price) from p where p.deal_type = 'rent' and p.price > 0),
    'rent_max', (select max(p.price) from p where p.deal_type = 'rent' and p.price > 0),
    'props', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc nulls last, x.id desc) from (
               select p.id, p.title, p.property_type, p.deal_type, p.price, p.price_unit,
                      p.rooms, p.size_sqm, p.built_size_sqm, p.image, p.updated_at, p.created_at, p.vis
                 from p order by p.updated_at desc nulls last, p.id desc limit 12) x), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc nulls last, x.id desc) from (
               select p.id, p.title, p.property_type, p.deal_type, p.price, p.price_unit,
                      p.rooms, p.size_sqm, p.built_size_sqm, p.image, p.updated_at, p.created_at, p.vis
                 from p order by p.updated_at desc nulls last, p.id desc limit 240) x), '[]'::jsonb),
    'agencies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', s.name, 'slug', s.slug, 'logo', s.logo, 'n', s.n
             ) order by s.n desc, s.name)
        from (
          select a.name, a.slug,
                 case when coalesce(a.logo_url, '') like 'https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/%'
                      then a.logo_url else null end as logo,
                 count(*)::int as n
            from public.properties pr
            join public.agencies a on a.id = pr.agency_id
           where pr.neighborhood_id = (select id from h)
             and pr.status = 'active'
             and public.agency_is_live(a.id)
           group by a.id, a.name, a.slug, a.logo_url
           order by count(*) desc, a.name
           limit 8
        ) s
    ), '[]'::jsonb),
    'deals', coalesce((select st.deals from public.neighborhood_deal_stats st, h
                        where st.neighborhood_id = h.id), 0),
    'period_start', (select st.period_start from public.neighborhood_deal_stats st, h
                      where st.neighborhood_id = h.id),
    'period_end', (select st.period_end from public.neighborhood_deal_stats st, h
                    where st.neighborhood_id = h.id),
    'median_price', (select st.median_price from public.neighborhood_deal_stats st, h
                      where st.neighborhood_id = h.id),
    'median_ppsqm', (select st.median_ppsqm from public.neighborhood_deal_stats st, h
                      where st.neighborhood_id = h.id),
    'by_rooms', coalesce((select st.by_rooms from public.neighborhood_deal_stats st, h
                           where st.neighborhood_id = h.id), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(jsonb_build_object(
                    'name', s.name, 'slug', s.slug, 'props', s.props
                  ) order by s.name)
                  from public.neighborhood_pages_public() s, h
                 where s.city_slug = h.city_slug and s.slug <> h.slug), '[]'::jsonb),
    'about', (select jsonb_build_object(
                'intro', d.intro, 'fits', d.fits, 'faq', d.faq,
                'hero_intro', d.hero_intro, 'approved_at', d.decided_at)
                from public.neighborhood_descriptions d, h
               where d.neighborhood_id = h.id and d.status = 'approved'
               limit 1)
  ) end
$page$;

comment on function public.neighborhood_page(text, text) is
  'הנתונים של /n/{עיר}/{שכונה}. עסקאות מ-neighborhood_deal_stats. משרדים חיים בלבד, בלי טלפון. null לשכונה לא קיימת. docs/neighborhood-pages.md';

revoke all on function public.neighborhood_page(text, text) from public, anon, authenticated;
grant execute on function public.neighborhood_page(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- האישור. חתימה חדשה (hero_intro בסוף, עם ברירת מחדל) כדי שקריאה ישנה
-- בלי השדה עדיין תעבוד. הטיוטה שומרת את מה שנשלח, עד 200 תווים, ו-3 שאלות.
-- ---------------------------------------------------------------------------

create or replace function public.admin_hood_drafts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', n.name, 'city', c.name, 'city_slug', c.slug, 'slug', n.slug,
      'intro', d.intro, 'hero_intro', d.hero_intro, 'fits', d.fits, 'faq', d.faq, 'created_at', d.created_at,
      'replaces', exists (select 1 from public.neighborhood_descriptions x
                           where x.neighborhood_id = d.neighborhood_id and x.status = 'approved'))
      order by d.created_at)
    from public.neighborhood_descriptions d
    join public.neighborhoods n on n.id = d.neighborhood_id
    left join public.cities c on c.id = n.city_id
   where d.status = 'draft'), '[]'::jsonb);
end $$;

comment on function public.admin_hood_drafts() is
  'הטיוטות שממתינות לאישור, כולל הפתיחה הקצרה. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_hood_drafts() from public, anon, authenticated;
grant execute on function public.admin_hood_drafts() to authenticated;

drop function if exists public.admin_hood_draft_decide(uuid, text, text, text, jsonb, text);

create or replace function public.admin_hood_draft_decide(
  p_id uuid, p_decision text, p_intro text default null, p_fits text default null,
  p_faq jsonb default null, p_note text default null, p_hero_intro text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_d public.neighborhood_descriptions;
  v_intro text := btrim(translate(coalesce(p_intro, ''), '—–', '--'));
  v_fits text := nullif(btrim(translate(coalesce(p_fits, ''), '—–', '--')), '');
  v_hero text := nullif(btrim(translate(coalesce(p_hero_intro, ''), '—–', '--')), '');
  v_faq jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  select * into v_d from public.neighborhood_descriptions where id = p_id for update;
  if not found or v_d.status <> 'draft' then
    raise exception 'draft_not_pending' using errcode = '22023';
  end if;

  if p_decision = 'reject' then
    update public.neighborhood_descriptions
       set status = 'rejected', decided_at = now(), decided_by = public.current_agent_id(),
           decision_note = left(p_note, 300)
     where id = p_id;
    return;
  end if;
  if p_decision <> 'approve' then
    raise exception 'bad_decision' using errcode = '22023';
  end if;

  if v_intro = '' then v_intro := v_d.intro; end if;
  if v_fits is null and p_fits is null then v_fits := v_d.fits; end if;
  if p_hero_intro is null then v_hero := nullif(btrim(coalesce(v_d.hero_intro, '')), ''); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'q', left(btrim(translate(e.item->>'q', '—–', '--')), 200),
           'a', left(btrim(translate(e.item->>'a', '—–', '--')), 800)) order by e.ord), '[]'::jsonb)
    into v_faq
    from (
      select e as item, ordinality as ord
        from jsonb_array_elements(coalesce(p_faq, v_d.faq)) with ordinality as t(e, ordinality)
       where btrim(coalesce(e->>'q', '')) <> '' and btrim(coalesce(e->>'a', '')) <> ''
       limit 3
    ) e;
  if char_length(v_intro) < 40 or char_length(v_intro) > 2000
     or char_length(coalesce(v_fits, '')) > 1200
     or char_length(coalesce(v_hero, '')) > 200 then
    raise exception 'text_length' using errcode = '22023';
  end if;

  update public.neighborhood_descriptions
     set status = 'replaced'
   where neighborhood_id = v_d.neighborhood_id and status = 'approved';
  update public.neighborhood_descriptions
     set status = 'approved', intro = v_intro, fits = v_fits, faq = v_faq, hero_intro = v_hero,
         decided_at = now(), decided_by = public.current_agent_id(), decision_note = left(p_note, 300)
   where id = p_id;
end $$;

comment on function public.admin_hood_draft_decide(uuid, text, text, text, jsonb, text, text) is
  'אישור (עם העריכה, כולל פתיחה קצרה עד 200 תווים ושלוש שאלות) או דחייה של טיוטת תיאור שכונה. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_hood_draft_decide(uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.admin_hood_draft_decide(uuid, text, text, text, jsonb, text, text) to authenticated;

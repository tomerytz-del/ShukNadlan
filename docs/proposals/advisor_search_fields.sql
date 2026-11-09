-- ============================================================================
-- אזורי פעילות מוצהרים ליועצי נדל״ן - החיפוש לפי התמחות ואזור (R8, PR 1010).
-- הצעה (‏docs/proposals): **לא רצה**. תומר מאשר ומעביר ל-supabase/migrations עם version חדש
-- (החלטת תומר 28.10.2026, 18:08). תלויה ב-dm_service_areas.sql (המשרדים) וב-dm_facets.sql.
--
-- למה: 19 מתוך 51 יועצי הנדל״ן ו-13 מתוך 35 המשרדים בלי נכס פעיל. הם מופיעים בסינון לפי
-- התמחות דרך ההצהרה (specialties), אבל לעולם לא בסינון לפי אזור - כי האזור נגזר מהנכסים.
-- העמודות כאן ממולאות בשדה "אזורי פעילות" ב-CRM (‏P1-U2). עד ההרצה הקוד קורא רק נכסים
-- והצהרות, והנתיב של האזור המוצהר רץ רק כש-rpc('homepage_dm_declared_areas') מצליח.
--
-- נבדק במסד (SELECT בלבד, 28.10): ‏cities.id ו-neighborhoods.id הם uuid; ל-agency_members
-- יש היום service_area (טקסט חופשי, ברמת שוק) ו-service_markets (slug של שוק) בלבד.
-- ============================================================================

alter table public.agency_members
  add column if not exists service_city_ids uuid[] not null default '{}',
  add column if not exists service_neighborhood_ids uuid[] not null default '{}';

comment on column public.agency_members.service_city_ids is
  'אזורי פעילות מוצהרים (ערים) - מ"אזורי פעילות" ב-CRM. לחיפוש יועצי נדל״ן לפי אזור, אחרי מי שיש לו נכסים.';
comment on column public.agency_members.service_neighborhood_ids is
  'אזורי פעילות מוצהרים (שכונות) - עד 8.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_service_neighborhoods_max8') then
    alter table public.agency_members
      add constraint agency_members_service_neighborhoods_max8
      check (coalesce(array_length(service_neighborhood_ids, 1), 0) <= 8);
  end if;
end $$;

-- ה-view הציבורי: העמודות החדשות **בסוף** (create or replace view - רק בסוף).
-- לפני ההרצה: להשוות את רשימת העמודות לגרסה החיה (pg_get_viewdef) - אם agent_card_fields.sql
-- רצה קודם, העמודות שלה באות לפני אלה.
create or replace view public.agency_members_public as
 select id, agency_id, slug, display_name, bio, photo_url, role, active, phone_e164, cover_url, license_number,
    ethics_code_accepted_at is not null and ethics_badge_revoked_at is null as has_ethics_badge,
    years_experience, specialties, credentials, service_area, photo_position, gallery, page_bg, service_markets,
    is_active_agent,
    service_city_ids, service_neighborhood_ids
   from public.agency_members
  where active = true and license_number is not null
    and (coalesce(license_status, ''::text) <> all (array['not_found'::text, 'inactive'::text]));

-- האזורים המוצהרים של יועצים ומשרדים בשוק, לסינון בדף הבית, ב-/agents וב-/agencies.
-- רק מזהים - בלי שמות, טלפונים או פרטים אחרים.
create or replace function public.homepage_dm_declared_areas()
returns table (kind text, id uuid, city_ids uuid[], neighborhood_ids uuid[])
language sql
stable
security invoker
set search_path = public
as $$
  select 'agent'::text, m.id, m.service_city_ids, m.service_neighborhood_ids
    from public.agency_members_public m
   where m.is_active_agent is not false
     and (cardinality(m.service_city_ids) > 0 or cardinality(m.service_neighborhood_ids) > 0)
  union all
  select 'agency'::text, a.id, a.service_city_ids, a.service_neighborhood_ids
    from public.agencies a
   where cardinality(a.service_city_ids) > 0 or cardinality(a.service_neighborhood_ids) > 0;
$$;

revoke all on function public.homepage_dm_declared_areas() from public, anon, authenticated;
grant execute on function public.homepage_dm_declared_areas() to anon, authenticated, service_role;

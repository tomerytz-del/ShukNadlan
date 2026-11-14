-- התג "✓ רישיון מאומת" בכרטיס היועץ (assets/agent-card.js) דורש license_verified,
-- וה-view הציבורי לא חשף אותו. מאומת = verified (המאגר אישר) או manual (אושר ידנית,
-- החלטת תומר 14.11.2026). unverified (המאגר לא ענה) תקין להצגת הדף אבל לא מאומת.
-- קריאה בלבד של הסטטוס: אין כאן כתיבה, ולכן הטריגרים של license_hold לא מופעלים.
-- העמודה החדשה בסוף בלבד; ההרשאות נשמרות ב-create or replace.
create or replace view public.agency_members_public as
 select id,
    agency_id,
    slug,
    display_name,
    bio,
    photo_url,
    role,
    active,
    phone_e164,
    cover_url,
    license_number,
    ((ethics_code_accepted_at is not null) and (ethics_badge_revoked_at is null)) as has_ethics_badge,
    years_experience,
    specialties,
    credentials,
    service_area,
    photo_position,
    gallery,
    page_bg,
    service_markets,
    is_active_agent,
    (coalesce(license_status, ''::text) in ('verified'::text, 'manual'::text)) as license_verified
   from agency_members
  where ((active = true) and (license_number is not null)
         and (coalesce(license_status, ''::text) <> all (array['not_found'::text, 'inactive'::text])));

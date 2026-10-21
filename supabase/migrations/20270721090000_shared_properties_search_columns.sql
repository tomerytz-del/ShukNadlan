-- ============================================================================
-- "נכסים ששותפו": שלוש עמודות שהחיפוש החופשי צריך, בסוף ה-view
-- ============================================================================
--
-- החיפוש בנכסים ב-CRM עובר מעכשיו באותו מפענח של השדה החכם בדף הבית
-- (‏docs/search-core.md, "ב-CRM"). שם, השכונה של נכס היא `neighborhood_id`
-- (ו-`sales_area` רק כשאין שכונה), וממ״ד של נכס מסחרי הוא
-- `mamad_location = 'unit'`. ‏shared_properties_for_me לא החזיר אף אחת מהשלוש,
-- ולכן בלשונית "נכסים ששותפו" חיפוש "ברובע" או "מסחרי עם ממד" לא היה מוצא
-- דבר - בעוד שב"הנכסים שלי" (שקורא את properties ישירות) הוא מוצא.
--
-- **בסוף בלבד** (‏create or replace view אינו מקבל עמודה באמצע). שאר ההגדרה -
-- כפי שהיא רצה בפרודקשן (‏pg_get_viewdef, 21.10.2026; ‏20270711090000).
-- ‏create or replace שומר את ההרשאות של ה-view. אידמפוטנטית.
-- ============================================================================

create or replace view public.shared_properties_for_me as
 select ps.id as share_id,
    ps.created_at as shared_at,
    ps.owner_agency_id,
    oa.name as owner_agency_name,
    oa.logo_url as owner_agency_logo,
    ps.owner_agent_id,
    om.display_name as owner_agent_name,
    om.phone as owner_agent_phone,
    p.id as property_id,
    p.title,
    p.price,
    p.deal_type,
    p.category,
    p.property_type,
    p.rooms,
    p.floor,
    p.size_sqm,
    p.city,
    p.street,
    p.house_number,
    p.features,
    p.condition,
    p.images,
    p.created_at as property_created_at,
    public.agent_share_fit(public.current_agent_id(), p.category, p.city_id) as fits_me,
    -- החיפוש החופשי ב-CRM (‏crmQueryMatches): שכונה, טקסט השכונה, וממ״ד מסחרי
    p.neighborhood_id,
    p.sales_area,
    p.mamad_location
   from public.property_shares ps
     join public.properties p on p.id = ps.property_id
     join public.agencies oa on oa.id = ps.owner_agency_id
     left join public.agency_members om on om.id = ps.owner_agent_id
  where ps.shared_with_agency_id = public.current_agency_id() and p.status = 'active';

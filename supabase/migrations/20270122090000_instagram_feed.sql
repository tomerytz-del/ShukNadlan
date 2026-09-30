-- ============================================================================
-- ‏instagram_feed — הנכסים שעלו לאינסטגרם, לדף ‏/instagram
--
-- ‏אינסטגרם אינה הופכת קישור בכיתוב ללחיץ; הקישור היחיד שנלחץ הוא זה
-- שבפרופיל. הוא מוביל ל-/instagram, ושם הגולש/ת מחפש/ת את מספר המודעה
-- שראה/תה בפוסט. לכן הדף מציג **בדיוק** את מה שעלה לאינסטגרם, מהחדש לישן —
-- ולא את כל הנכסים באתר.
--
-- ‏property_publications סגורה ל-anon (‏RLS, מנהלי פלטפורמה בלבד), ובצדק:
-- יש בה טקסט הפוסט, שגיאות ומזהים. הפונקציה חושפת ממנה עמודה אחת —
-- ‏posted_at — ורק לנכס שממילא ציבורי (‏status = 'active').
--
-- ‏**בלי רחוב ובלי מספר בית**: עיר ושכונה בלבד, לפי
-- ‏docs/property-address-privacy.md.
-- ============================================================================

create or replace function public.instagram_feed(p_limit int default 30)
returns table (
  property_id        uuid,
  listing_number     bigint,
  title              text,
  deal_type          text,
  category           text,
  property_type      text,
  price              numeric,
  price_includes_vat boolean,
  rooms              numeric,
  size_sqm           numeric,
  city               text,
  neighborhood       text,
  image              text,
  posted_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.listing_number, p.title, p.deal_type, p.category, p.property_type,
         p.price, p.price_includes_vat, p.rooms::numeric,
         coalesce(p.size_sqm, p.area_sqm)::numeric,
         p.city, n.name,
         coalesce(p.images[1], p.marketing_image),
         pub.posted_at
    from public.property_publications pub
    join public.properties p on p.id = pub.property_id
    left join public.neighborhoods n on n.id = p.neighborhood_id
   where pub.channel = 'instagram'
     and pub.status = 'posted'
     and p.status = 'active'
   order by pub.posted_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 60);
$$;

comment on function public.instagram_feed(int) is
  'הנכסים הפעילים שעלו לחשבון האינסטגרם, מהחדש לישן - לדף /instagram שאליו מוביל הקישור בפרופיל. עיר ושכונה בלבד, בלי רחוב.';

revoke all on function public.instagram_feed(int) from public, anon, authenticated;
grant execute on function public.instagram_feed(int) to anon, authenticated, service_role;

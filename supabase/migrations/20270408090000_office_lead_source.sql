-- ===========================================================================
-- מקור הליד בדאשבורד המשרד: אותה גזירה כמו בקרת הלידים
-- ---------------------------------------------------------------------------
-- ‏_office_lead_rows החזירה את leads.source כמו שהוא. לידים מטפסי האתר -
-- הדמיה בדף הנכס (property-visualize), פנייה על נכס (property-inquiry-intake)
-- ובעל/ת נכס מהאשף (owner-lead-intake) - נשמרים בלי source, ולכן כולם נספרו
-- בדאשבורד, בדשבורד האישי ובמאמן השבועי כ"אחר". בנדל"ן עפולה זה היה 54 מתוך
-- 57 הלידים ב-90 יום.
--
-- בקרת הלידים (lead_analytics, 20261122090000) פתרה את זה מזמן: מקור מיומן
-- הניתוב, אחר כך leads.source, ואחר כך גזירה דטרמיניסטית מ-lead_type - לכל
-- lead_type יש בדיוק פונקציית קליטה אחת. כאן אותה שרשרת, כדי ששני הדוחות
-- יספרו ערוץ זהה לאותו ליד. ‏lead_source_channel() ממפה את התוצאה לערוץ
-- כמו קודם (property_page_visualization → property_page וכן הלאה).
--
-- ‏lead_routing_log (lead_table, lead_id) ייחודי, ולכן ה-join מחזיר לכל היותר
-- שורה אחת לליד. החתימה לא משתנה, ולכן אין צורך לגעת בצרכנים.
-- ‏docs/office-dashboard.md, "מקורות".
-- ===========================================================================

create or replace function public._office_lead_rows(p_agency uuid, p_from date, p_to date)
returns table (lead_id uuid, agent_id uuid, created_at timestamptz, source text,
               property_id uuid, responded_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select l.id, l.agent_id, l.created_at,
         coalesce(
           rl.source,
           nullif(btrim(l.source), ''),
           case l.lead_type
             when 'visualization'        then 'property_page_visualization'
             when 'property_inquiry'     then 'property_page_inquiry'
             when 'agent_direct_inquiry' then 'agent_page_direct'
             when 'owner_inbound'        then 'homepage_owner_wizard'
           end,
           'unattributed'
         ),
         l.property_id, l.first_response_at
    from public.leads l
    left join public.lead_routing_log rl
      on rl.lead_table = 'leads' and rl.lead_id = l.id
   where l.agency_id = p_agency
     and l.created_at >= p_from
     and l.created_at <  p_to + 1;
$$;

revoke all on function public._office_lead_rows(uuid, date, date) from public, anon, authenticated;

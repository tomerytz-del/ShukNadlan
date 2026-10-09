-- ===========================================================================
-- ההדמיות בדף הנכס: ערוץ נפרד (visualization)
-- ---------------------------------------------------------------------------
-- עד היום property_page_visualization נכנס לערוץ property_page יחד עם טופס
-- הפנייה, "חושבים למכור" ומחשבון המשכנתא. בנדל"ן עפולה ההדמיות היו 47 מתוך
-- 51 הלידים של "דף הנכס" ב-90 יום - כלומר הערוץ "דף הנכס" היה בפועל
-- "הדמיות", ולא היה אפשר לראות כמה פניות רגילות מגיעות מהדף.
--
-- אותה פונקציה בדיוק (20270312090000_ads_leads_routing.sql), ועוד ענף אחד
-- **לפני** property_page. ‏create or replace שומר את ההרשאות הקיימות.
-- הערוץ חל על כל מי שקורא לפונקציה: בקרת הלידים (lead_analytics), דאשבורד
-- המשרד, הדשבורד האישי והמאמן השבועי. התווית ב-LX_CHANNELS (assets/crm.js).
-- ‏docs/lead-analytics.md, "ערוץ מול מקור".
-- ===========================================================================

create or replace function public.lead_source_channel(p_source text)
returns text
language sql
immutable
as $$
  select case
    when p_source is null                       then 'other'
    when p_source like 'whatsapp\_bot%'         then 'whatsapp_bot'
    when p_source = 'rss_engine'                then 'rss_engine'
    when p_source like 'homepage%'              then 'homepage'
    when p_source = 'footer_buyer_wizard'       then 'footer'
    -- לפני property_page: ההדמיה יושבת בדף הנכס, אבל היא כלי אחר עם קהל אחר
    when p_source = 'property_page_visualization' then 'visualization'
    when p_source like 'property\_page%'        then 'property_page'
    when p_source like 'agency\_page%'
      or p_source = 'agency'                    then 'agency_page'
    when p_source like 'agent\_page%'           then 'agent_page'
    when p_source like 'project%'               then 'project_page'
    when p_source = 'open_house_page'           then 'open_house'
    when p_source like 'meta\_ads%'             then 'meta_ads'
    when p_source = 'unattributed'              then 'unattributed'
    else 'other'
  end;
$$;

comment on function public.lead_source_channel(text) is
  'הערוץ שאליו שייך מזהה מקור הליד: whatsapp_bot · homepage · footer · property_page · visualization · agency_page · agent_page · project_page · open_house · meta_ads · rss_engine · unattributed · other. המיפוי בקידומת, כדי שמקור חדש ייכנס לערוץ הנכון בלי מיגרציה.';

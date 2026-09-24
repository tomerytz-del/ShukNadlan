-- ============================================================================
-- הדמיה מסחרית נשמרת לגולשים הבאים — סוג העסק נחשף ב-view
--
-- כל הדמיה מסחרית שהופקה נשמרה במסד ונחשפה ב-property_visualizations_recent,
-- אבל **בלי סוג העסק שהיא מדמה**. דף הנכס לא ידע להבחין בין "בית קפה"
-- ל"משרד רו"ח" באותו נכס, ולכן דילל לפי מטרה בלבד (exterior/interior_main)
-- והציג רק את העסק האחרון שמישהו ביקש. כל הדמיה קודמת נעלמה מהדף ברגע
-- שגולש/ת אחר/ת ביקש/ה עסק אחר — ומי שחזר/ה לראות את בית הקפה שלו/ה לא
-- מצא/ה אותו וביקש/ה אותו שוב. בנכס אחד נוצרו כך שבע הדמיות עסק שונות,
-- ורק האחרונה נראתה.
--
-- ‏business_type יושב על visualization_jobs ולא על השורה עצמה, ולכן ה-view
-- מצטרף אליה. העמודה נוספת **בסוף** — create or replace view אינו מקבל
-- עמודה באמצע. בהדמיה פרטית היא null.
--
-- ‏business_description אינו נחשף: הוא טקסט חופשי ארוך יותר, והדף אינו
-- שולח אותו ממילא.
-- ============================================================================

create or replace view public.property_visualizations_recent as
select
  v.property_id,
  v.kind,
  v.target,
  v.style_key,
  v.source_image_url,
  v.result_url,
  v.is_base,
  v.created_at,
  case when v.kind = 'commercial_business' then j.business_type end as business_type
from public.property_visualizations v
join public.properties p on p.id = v.property_id
left join public.visualization_jobs j on j.id = v.job_id
where v.status = 'done'
  and v.result_url is not null
  and p.status = 'active'
  and (v.kind <> 'private_room'
       or v.mode = public.visualization_render_mode(p.deal_type))
  and public.property_visualizations_enabled(v.property_id);

comment on view public.property_visualizations_recent is
  'כל ההדמיות המוכנות של נכסים פעילים וזכאים, במצב שתואם ל-deal_type הנוכחי - כולל אלה שנוצרו לפי דרישה. בהדמיה מסחרית גם סוג העסק, כדי שדף הנכס יציג כל עסק שהודמה בו. ללא job_id וללא error_detail.';

grant select on public.property_visualizations_recent to anon, authenticated;

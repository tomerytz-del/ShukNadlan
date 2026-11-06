-- ============================================================================
-- בלם הדמיות לגולש/ת: 10 בקשות שמייצרות הדמיה ב-24 שעות, לפי מכשיר או IP
-- (אישור תומר, 6.11.2026; ההצעה ישבה ב-docs/proposals/visualization_visitor_cap.sql
-- מ-PR 1010, חלק 2 §5.3)
--
-- ## למה
--
-- יצירת הדמיה מתוך דף ההחלקה (assets/swipe.js, VIZ_SWIPE_GENERATE) כבויה כי
-- כל הדמיה עולה כסף, וגולש/ת אנונימי/ת היה/תה יכול/ה לבקש בלי גבול. הקוד
-- שסופר בקשות לפי מכשיר ו-IP כבר בפונקציה (property-visualize, "בלם
-- לגולש/ת"): עד היום השאילתה שלו נכשלה על עמודה חסרה והבלם לא היה פעיל.
--
-- ## מה כאן
--
-- שתי עמודות ואינדקס חלקי לבקשות לפי דרישה. ה-IP עצמו לעולם לא נשמר: רק
-- sha256(ip || VIZ_IP_SALT), והסוד נקבע לפונקציות בנפרד (בלעדיו נספר רק
-- מזהה המכשיר, שמגיע מהדפדפן ב-x-sk-device).
--
-- ## הסדר
--
-- המיגרציה קודם, ב-PR משלה (אינה דיפלוי ב-Netlify). הדלקת VIZ_SWIPE_GENERATE
-- ב-swipe.js נכנסת ב-PR שאחריה, כשה-workflow ירוק (הסקיל deploy-path).
-- docs/property-visualizations.md, docs/swipe-mode.md.
-- ============================================================================

alter table public.visualization_jobs
  add column if not exists device_id text,
  add column if not exists client_ip_hash text;

create index if not exists visualization_jobs_ondemand_created_idx
  on public.visualization_jobs (created_at)
  where trigger_source = 'ondemand';

comment on column public.visualization_jobs.device_id is
  'מזהה המכשיר של הגולש/ת (x-sk-device) לבלם ההדמיות היומי; null לבקשה מהשרת';
comment on column public.visualization_jobs.client_ip_hash is
  'sha256 של ה-IP עם VIZ_IP_SALT לבלם ההדמיות היומי; ה-IP עצמו אינו נשמר';

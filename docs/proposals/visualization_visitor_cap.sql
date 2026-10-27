-- =====================================================================
-- הצעה בלבד - לא מיגרציה, ולא לרוץ בלי אישור של תומר (PR 1010, חלק 2 §5.3).
-- =====================================================================
-- בלם הדמיות לגולש/ת: 10 בקשות שמייצרות הדמיה ב-24 שעות, לפי מכשיר או IP.
-- הקובץ יושב ב-docs/proposals ולא ב-supabase/migrations בכוונה: כל קובץ שם
-- רץ אוטומטית במיזוג ל-main, כלומר "קובץ שלא רץ" לא יכול לשבת שם.
--
-- הקוד שקורא את העמודות כבר בפונקציה (‏property-visualize): עד שהמיגרציה
-- רצה השאילתה שלו נכשלת על עמודה חסרה, והבלם פשוט לא פעיל - כמו היום.
--
-- אחרי אישור:
--   1. להעתיק ל-supabase/migrations/<YYYYMMDDHHMMSS>_visualization_visitor_cap.sql
--      (version גדול מהאחרון).
--   2. לקבוע את הסוד VIZ_IP_SALT לפונקציות (מחרוזת אקראית ארוכה). בלעדיו
--      נשמר רק מזהה המכשיר, וה-IP לא נספר.
--   3. להדליק VIZ_SWIPE_GENERATE ב-assets/swipe.js, ב-PR שנכנס אחרי
--      המיגרציה (האתר עולה לפני המיגרציה - הסקיל deploy-path).
--
-- ה-IP עצמו לעולם לא נשמר: רק sha256(ip || VIZ_IP_SALT).
-- =====================================================================

alter table public.visualization_jobs
  add column if not exists device_id text,
  add column if not exists client_ip_hash text;

create index if not exists visualization_jobs_ondemand_created_idx
  on public.visualization_jobs (created_at)
  where trigger_source = 'ondemand';

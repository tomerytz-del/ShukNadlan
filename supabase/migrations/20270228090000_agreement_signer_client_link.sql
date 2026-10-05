-- ===========================================================================
-- חותם/ת מקושר/ת לכרטיס הלקוח/ה (agreement_signers.client_id)
--
-- מאז 20270223090000 לקוח/ה יכול/ה להשלים שם מלא ות.ז. בקישור לחתימה. מה
-- שהוא/היא מילא/ה נשמר בשורת החותם/ת, אבל לא בכרטיס ב-CRM - ולכן ההסכם הבא
-- עם אותו/אותה לקוח/ה נעצר שוב על אותה ת.ז. חסרה.
--
-- עד עכשיו לא היה דרך אמינה לדעת מאיזה כרטיס חותם/ת הגיע/ה: ל-agreements
-- יש client_ids (מערך, בלי סדר שמצביע על החותם/ת), ובשורת החותם/ת אין כלום.
-- העמודה הזו נכתבת ביצירה (באשף ובבוט) כשהחותם/ת נבחר/ה מקובץ הלקוחות,
-- ו-agreement-sign כותב לפיה את הת.ז. והשם המלא חזרה לכרטיס אחרי החתימה.
-- להסכמים שיצאו לפני כן יש נפילה בקוד: התאמה לפי נייד או מייל מתוך
-- agreements.client_ids.
--
-- ‏on delete set null: מחיקת כרטיס אינה נוגעת בהסכם - הוא מסמך חתום.
-- ‏agreement_signers לא הפנתה עד היום ל-agent_clients, ולכן אין כאן מפתח זר
-- שני לאותה טבלה ושום embed קיים אינו נעשה דו-משמעי.
-- ===========================================================================

alter table public.agreement_signers
  add column if not exists client_id uuid references public.agent_clients(id) on delete set null;

create index if not exists agreement_signers_client_idx
  on public.agreement_signers (client_id) where client_id is not null;

comment on column public.agreement_signers.client_id is
  'הכרטיס בקובץ הלקוחות שממנו החותם/ת נבחר/ה. ‏agreement-sign כותב אליו ת.ז. ושם מלא שהחותם/ת מילא/ה בקישור.';

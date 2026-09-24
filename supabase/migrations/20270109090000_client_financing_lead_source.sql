-- ---------------------------------------------------------------------------
-- קובץ הלקוחות: בשלות עסקה/מימון ומקור הגעה
--
-- טופס הלקוח/ה ב-CRM חולק לשני כרטיסים — פרטי איש קשר ופרופיל חיפוש — ובכרטיס
-- הראשון נוספו שני שדות שעד היום נכתבו, אם בכלל, בתוך "הערות" כטקסט חופשי:
--
--   ‏financing_status — עד כמה הלקוח/ה מוכן/ה לסגור. זה מה שמבדיל בין לקוח/ה
--     שאפשר לקבוע איתו/ה סיור מחר לבין מי שעוד לא דיבר/ה עם הבנק.
--   ‏lead_source — מאיפה הגיע/ה. בלי זה אין תשובה לשאלה איזה ערוץ מביא
--     לקוחות שסוגרים.
--
-- שניהם רשימה סגורה (check), כי מה שנכתב חופשי אי אפשר לספור. ושניהם
-- nullable: לקוח/ה ותיק/ה נשאר/ת בלי ערך, וזה "לא ידוע" ולא ברירת מחדל שקרית.
--
-- מנוע ההתאמות אינו מסנן לפיהם — אלה פרטי איש הקשר, לא דרישות החיפוש.
-- ---------------------------------------------------------------------------

alter table public.agent_clients add column if not exists financing_status text;
alter table public.agent_clients add column if not exists lead_source text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_clients_financing_status_check') then
    alter table public.agent_clients add constraint agent_clients_financing_status_check
      check (financing_status is null or financing_status in ('approved','pending_sale','initial'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_clients_lead_source_check') then
    alter table public.agent_clients add constraint agent_clients_lead_source_check
      check (lead_source is null or lead_source in ('social','yad2','sign','referral','other'));
  end if;
end $$;

comment on column public.agent_clients.financing_status is
  'בשלות עסקה: approved = יש אישור עקרוני / הון נזיל · pending_sale = תלוי במכירת נכס קיים · initial = בירור ראשוני. null = לא ידוע.';
comment on column public.agent_clients.lead_source is
  'מקור הגעה: social = פייסבוק/אינסטגרם · yad2 = יד 2 · sign = שלט על נכס · referral = המלצה/לקוח חוזר · other = אחר. null = לא ידוע.';

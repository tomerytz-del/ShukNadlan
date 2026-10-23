-- ===========================================================================
-- התראת וואטסאפ לבעל הפלטפורמה על כל ליד חדש מטופס מטא
-- ===========================================================================
--
-- ליד מטופס מיידי נשמר ב-ads_leads ומנותב למסלול שלו, אבל אף אחד לא שמע
-- עליו עד שנכנס ל-CRM. מעכשיו ads-leads-webhook ו-routePending ב-ads-admin
-- קוראים ל-alertLead, ששולח וואטסאפ למספר שב-ads_settings.
--
-- **לידים שכבר היו.** העמודה נולדת מלאה (alerted_at = now()) על כל השורות
-- הקיימות. בלי זה הפריסה הראשונה הייתה שולחת את כל ההיסטוריה בבת אחת.
-- המילוי רץ רק כשהעמודה נוספת עכשיו: הרצה חוזרת של הקובץ אינה מסמנת לידים
-- שהגיעו אחרי המיגרציה ועוד לא הופצה להם התראה.
--
-- **פעם אחת.** alertLead מעדכן alerted_at רק כשהוא null ומחזיר את השורה.
-- ה-webhook והסנכרון השעתי רצים על אותו ליד, ורק מי שתפס את השורה שולח.
-- כשל שליחה נשאר ב-alert_error; alerted_at אינו מתאפס, כדי שלא ייצאו שתיים.
--
-- המספר והסוגים יושבים ב-ads_settings (לא סוד): שינוי בלי פריסה. ברירת
-- המחדל היא כל סוג חוץ מ-ignore, כולל טופס שעוד לא שויך.
-- docs/whatsapp-setup.md
-- ===========================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ads_leads'
      and column_name = 'alerted_at'
  ) then
    alter table public.ads_leads add column alerted_at timestamptz;
    update public.ads_leads set alerted_at = now() where alerted_at is null;
  end if;
end $$;

alter table public.ads_leads add column if not exists alert_error text;

comment on column public.ads_leads.alerted_at is
  'מתי נתפסה התראת הוואטסאפ לבעל הפלטפורמה. null = עוד לא. מולא מראש ללידים שהיו לפני העמודה, כדי שפריסה לא תשלח את כולם. docs/whatsapp-setup.md';

comment on column public.ads_leads.alert_error is
  'שגיאת שליחת התראת הוואטסאפ, אם הייתה. alerted_at נשאר מלא גם בכשל, כדי ש-webhook וסנכרון לא ישלחו פעמיים.';

insert into public.ads_settings (key, value, description) values
  ('lead_alert_phone', '"972546929991"'::jsonb,
   'מספר וואטסאפ (ספרות, בלי +) שאליו יוצאת התראה על כל ליד חדש מטופס מטא'),
  ('lead_alert_kinds', '["broker","owner","property","buyer","unmapped"]'::jsonb,
   'סוגי טפסים שעליהם יוצאת ההתראה. unmapped = טופס שעוד לא שויך. ignore אינו ברשימה')
on conflict (key) do nothing;

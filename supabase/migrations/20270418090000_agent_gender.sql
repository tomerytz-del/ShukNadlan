-- ===========================================================================
-- מין של סוכן/ת: agency_members.gender
-- ---------------------------------------------------------------------------
-- עד היום לא היה במערכת מין לסוכנים, ולכן כל טקסט שמדבר על סוכן/ת בשמו/ה נכתב
-- עם לוכסן ("טל גייס/ה") או נוסח סביב השם. מאמן ה-AI השבועי הראה למה זה לא
-- מספיק: גם עם הנחיה מפורשת הוא כתב "לטל, שכרגע אין לו לידים".
--
-- השדה נבחר בפרופיל ב-CRM, ליד ת.ז. (זכר / נקבה), ואינו חובה. ריק = לא ידוע,
-- וכל מי שקורא אותו נופל לניסוח סביב השם. אינו מוצג בדף הסוכן/ת הציבורי ואינו
-- נכנס ל-agency_members_public.
--
-- הסוכן/ת מעדכן/ת את השדה בעצמו/ה: הוא אינו ברשימת השדות הנעולים של
-- protect_sensitive_agency_member_fields, בדיוק כמו id_number.
--
-- הצרכן הראשון: office-coach (‏docs/office-coach.md, "ניסוח ליד שמות").
-- ===========================================================================

alter table public.agency_members add column if not exists gender text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'agency_members_gender_check'
                    and conrelid = 'public.agency_members'::regclass) then
    alter table public.agency_members
      add constraint agency_members_gender_check check (gender in ('male', 'female'));
  end if;
end $$;

comment on column public.agency_members.gender is
  'מין הסוכן/ת לניסוח טקסטים (male / female). נבחר בפרופיל ב-CRM, לא חובה; ריק = לא ידוע, וטקסט שמזכיר את השם מנוסח סביבו. לא מוצג בציבור. docs/office-coach.md';

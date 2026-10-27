-- ============================================================================
-- עיר ברירת מחדל לנכס חדש, לסוכן/ת
--
-- סוכן אמר לגבריאלה שעפולה היא העיר הקבועה שלו. היא רשמה שישה נכסים בעיר
-- המשרד (כפר גדעון), ואז אמרה שאין לה איך לשמור את זה כהגדרה.
--
-- service_area הוא טקסט שיווקי ("עפולה והעמקים"). default_city בטופס לידים
-- של מטא הוא מיפוי טופס, לא הפרופיל. לכן עמודה משלה, ריקה עד שהסוכן/ת מבקש/ת.
-- השם נפתר ב-city_id_for_name (כולל city_aliases). אין כאן מיפוי נפרד.
--
-- ריק = ההתנהגות של היום: עיר המשרד, ואם אין - עפולה.
-- הפונקציה עולה לפני המיגרציה, ולכן קריאה לעמודה חסרה נבלעת בקוד.
-- ============================================================================

alter table public.agency_members
  add column if not exists default_city_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'agency_members_default_city_id_fkey'
  ) then
    alter table public.agency_members
      add constraint agency_members_default_city_id_fkey
      foreign key (default_city_id) references public.cities(id) on delete set null;
  end if;
end $$;

comment on column public.agency_members.default_city_id is
  'עיר לנכס חדש כשהסוכן/ת לא אמר/ה עיר. ריק = עיר המשרד. נשמרת מ-update_profile דרך city_id_for_name.';

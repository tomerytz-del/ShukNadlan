-- ============================================================================
-- ‏agency_members.social_prompt_dismissed - "לא להציע לי שוב" בכרטיס התיוג (PR 1010, P1-R, ד-7).
-- הצעה (‏docs/proposals): לא רצה. ברירת המחדל עד ההחלטה: localStorage בלבד
-- (‏shuknadlan.social_prompt_never ב-assets/crm.js) - כלומר בדפדפן אחד.
--
-- אחרי ההרצה: loadSocialPrompt קורא גם את העמודה (יציאה מוקדמת), ו"לא עכשיו" עם הסימון
-- מעדכן אותה בשורה של הסוכן/ת עצמו/ה. מדיניות העדכון הקיימת של agency_members כבר מגבילה
-- לשורה של המשתמש/ת; לבדוק ש-protect_sensitive_agency_member_fields אינו חוסם את העמודה.
-- ============================================================================

alter table public.agency_members
  add column if not exists social_prompt_dismissed boolean not null default false;

comment on column public.agency_members.social_prompt_dismissed is
  'הסוכן/ת ביקש/ה לא להציע שוב את כרטיס התיוג בפרסומים. אישור תיוג מאוחר יותר מאפס.';

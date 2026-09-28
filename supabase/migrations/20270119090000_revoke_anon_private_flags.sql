-- ‏סגירת שלוש פונקציות SECURITY DEFINER שהיו פתוחות ל-anon בלי צורך.
--
-- הסוכן התפעולי דיווח על תשע (`anon_secdef_unguarded`). שש מהן פומביות
-- בכוונה ונרשמו ב-`PUBLIC_RPC` ב-`ops_agent/config.py`, עם הקורא/ת של כל
-- אחת. שלוש הנותרות חושפות מידע פרטי על סוכן/ת, ואין להן קורא/ת מחוץ למסד:
--
-- * ‏`notification_type_enabled(uuid, text)` - אילו סוגי התראות סוכן/ת
--   השתיק/ה. קורא/ת יחיד/ה: הטריגר `notifications_apply_preferences`,
--   ‏SECURITY DEFINER, ולכן רץ כבעלים ואינו צריך את ההרשאה של המשתמש/ת.
-- * ‏`property_video_tier(uuid, uuid)` - המסלול בתשלום של סוכן/ת. קוראות:
--   ‏`agent_property_video_quote` ו-`start_property_video_job`, שתיהן
--   ‏SECURITY DEFINER. ב-crm.js ובtiers.js היא מוזכרת בהערה בלבד.
-- * ‏`property_virtual_tour_eligible(uuid)` - האם סוכן/ת במסלול premium.
--   **נשארת ל-authenticated:** ארבע policies של העלאת סיור (‏storage.objects
--   ו-property_virtual_tours) קוראות לה, ו-policy רצה בהרשאות המשתמש/ת.
--   כולן מוגבלות ל-authenticated, ולכן anon אינו צריך אותה.
--
-- ‏`from public, anon, authenticated` ולא `from public` - ‏CLAUDE.md, כלל 5.

do $$
begin
  if to_regprocedure('public.notification_type_enabled(uuid, text)') is not null then
    revoke all on function public.notification_type_enabled(uuid, text)
      from public, anon, authenticated;
    grant execute on function public.notification_type_enabled(uuid, text)
      to service_role;
  end if;

  if to_regprocedure('public.property_video_tier(uuid, uuid)') is not null then
    revoke all on function public.property_video_tier(uuid, uuid)
      from public, anon, authenticated;
    grant execute on function public.property_video_tier(uuid, uuid)
      to service_role;
  end if;

  if to_regprocedure('public.property_virtual_tour_eligible(uuid)') is not null then
    revoke all on function public.property_virtual_tour_eligible(uuid)
      from public, anon;
    grant execute on function public.property_virtual_tour_eligible(uuid)
      to authenticated, service_role;
  end if;
end $$;

-- טיוטה - HANDOFF.md סעיף 7. לא להחיל ידנית.
-- לקרוא קודם: 20261123090000_agent_onboarding.sql, 20270318090000_onboarding_three_steps.sql,
-- 20270328090000_onboarding_agency_about.sql, ואת ההגדרה העדכנית במסד:
--   select pg_get_functiondef('public.agent_onboarding_state'::regproc);

-- החתימה היום:
--   returns table(is_manager, whatsapp_done, profile_done, agency_done, property_done,
--                 client_done, agreement_done, lead_done, just_finished, about_done)
-- הוספת עמודות לפונקציה שמחזירה table מחייבת drop + create (create or replace נכשל על שינוי returns).
-- הסדר: לשמור את כל העמודות הקיימות במקומן, ולהוסיף בסוף:

--   license_done  boolean  -- אותו תנאי שמשחרר license_hold_at (agency_members_release_license_hold).
--                          -- לא להמציא תנאי שני: לחלץ אותו לפונקציה משותפת agent_license_ok(uuid) ולקרוא לה משני המקומות.
--   bio_done      boolean  -- photo_url is not null and length(btrim(coalesce(bio,''))) >= <סף, שאלה פתוחה 6>
--                          -- and cardinality(coalesce(service_markets,'{}')) > 0
--   calendar_done boolean  -- exists (select 1 from agent_calendar_connections c where c.agent_id = v_me and c.status = <ערך "מחובר">)
--                          -- עמודות (נבדק): agent_id, google_email, calendar_id, scopes, status, last_error, last_sync_at, connected_at
--                          -- !! לאמת את ערכי status מול docs/google-calendar.md
--   prefs_done    boolean  -- exists (select 1 from agent_lead_preferences p where p.agent_id = v_me and p.active)
--                          -- עמודות (נבדק): preferred_neighborhoods, preferred_property_types, preferred_deal_types, active
--   cover_done    boolean  -- cover_url is not null
--   review_done   boolean  -- exists (select 1 from review_requests r where r.agent_id = v_me)  -- (נבדק: agent_id קיים)
--   invite_done   boolean  -- מנהל/ת: exists (select 1 from agency_invitations i where i.agency_id = v_agency)

-- "המדריך הושלם" (onboarding_done_at) = שבעת הצעדים:
--   license_done and bio_done and property_done and whatsapp_done and client_done and calendar_done and prefs_done
--   כש-whatsapp אינו כלול במסלול (free): הצעד לא נספר בתנאי (כמו ההיגיון הקיים של mid ומעלה).
-- הצעדים הרשות (cover, review, invite, about/agency) אינם סוגרים את המדריך.

-- is_active_agent = false: לא מחזירים שורות לצעדים האישיים (רק מנהל/ת: agency_done, about_done, invite_done).

-- אחרי drop + create: להחזיר הרשאות בדיוק כמו היום
--   revoke all on function public.agent_onboarding_state() from public, anon, authenticated;
--   grant execute on function public.agent_onboarding_state() to authenticated;

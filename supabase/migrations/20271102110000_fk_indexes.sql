-- ============================================================================
-- אינדקסים למפתחות זרים שאין להם (ממצאי הסוכן התפעולי unindexed_fk)
--
-- ‏הבדיקה מציגה רק עשר בכל סריקה, ולכן נכנסות כאן כל החמש-עשרה שנמצאו
-- בשאילתה שלה בלי ה-limit (2.11.2026), כדי שהסריקה הבאה לא תחשוף עוד חמש.
--
-- ‏בלי אינדקס, מחיקה או עדכון של שורת אב (סגירת חשבון, מחיקת לקוח/ה,
-- פגישה או שכונה) סורקת את כל טבלת הבן כדי לבדוק אותה. הטבלאות קטנות,
-- ולכן create index רגיל (בלי concurrently - המיגרציה רצה בטרנזקציה)
-- לוקח שבריר שנייה.
--
-- ‏עמודה nullable מקבלת אינדקס חלקי (where ... is not null): בדיקת המפתח
-- הזר מחפשת ערך מסוים, ולכן החלקי משרת אותה, והוא קטן בהרבה בעמודות
-- כמו notifications.related_*_id שרובן ריקות. הבדיקה של הסוכן מזהה
-- אינדקס לפי העמודה הראשונה בלבד, וחלקי נספר.
-- ============================================================================

create index if not exists street_registry_created_by_fk_idx
  on public.street_registry (created_by) where created_by is not null;

create index if not exists notifications_related_meeting_id_fk_idx
  on public.notifications (related_meeting_id) where related_meeting_id is not null;

create index if not exists notifications_related_showcase_id_fk_idx
  on public.notifications (related_showcase_id) where related_showcase_id is not null;

create index if not exists notifications_related_agenda_item_id_fk_idx
  on public.notifications (related_agenda_item_id) where related_agenda_item_id is not null;

create index if not exists neighborhoods_created_by_fk_idx
  on public.neighborhoods (created_by) where created_by is not null;

create index if not exists ops_findings_scan_id_fk_idx
  on public.ops_findings (scan_id) where scan_id is not null;

create index if not exists properties_neighborhood_id_fk_idx
  on public.properties (neighborhood_id) where neighborhood_id is not null;

create index if not exists agent_coach_summaries_agency_id_fk_idx
  on public.agent_coach_summaries (agency_id);

create index if not exists property_shares_owner_agent_id_fk_idx
  on public.property_shares (owner_agent_id);

create index if not exists property_shares_owner_agency_id_fk_idx
  on public.property_shares (owner_agency_id) where owner_agency_id is not null;

create index if not exists news_items_source_id_fk_idx
  on public.news_items (source_id) where source_id is not null;

create index if not exists ai_usage_log_agent_id_fk_idx
  on public.ai_usage_log (agent_id) where agent_id is not null;

create index if not exists ai_usage_log_agency_id_fk_idx
  on public.ai_usage_log (agency_id) where agency_id is not null;

create index if not exists ads_actions_log_actor_id_fk_idx
  on public.ads_actions_log (actor_id) where actor_id is not null;

create index if not exists client_match_alerts_property_id_fk_idx
  on public.client_match_alerts (property_id);

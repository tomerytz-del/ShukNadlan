-- פרסום לאוויר מוואטסאפ נשמר כבקשה, כמו הנפקה. ה-check של
-- 20271028160000 מתיר רק reissue. בלי ההרחבה הזו insert של publish
-- נכשל ב-23514, והקוד מסרב לפרסם במקום לעלות לאוויר בלי אישור.

alter table public.whatsapp_pending_actions
  drop constraint if exists whatsapp_pending_actions_action_chk;

alter table public.whatsapp_pending_actions
  add constraint whatsapp_pending_actions_action_chk
  check (action in ('reissue', 'publish'));

comment on table public.whatsapp_pending_actions is
  'בקשת אישור מוואטסאפ שטרם בוצעה. reissue או publish. רק service_role. הכפתור נושא את id.';

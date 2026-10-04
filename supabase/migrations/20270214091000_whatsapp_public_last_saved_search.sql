-- ============================================================================
-- השאלה על מתווך/ת אחרי שמירת חיפוש בוואטסאפ
--
-- גבריאלה שומרת חיפוש מיד בלחיצה על "שמרי לי", בלי הסכמה ליצירת קשר, ובאותה
-- הודעה שואלת אם מתווך/ת יעזור/תעזור בחיפוש. התשובה מגיעה בתור **הבא**, ואז
-- צריך לדעת איזה חיפוש לעדכן: שליחה חוזרת של הקריטריונים הייתה נופלת על
-- הכפילות ב-create_saved_search, שאינה נוגעת בשורה הקיימת.
--
-- לכן מזהה החיפוש נשמר במצב השיחה, כמו last_property_id. ‏on delete set null:
-- חיפוש שנמחק אינו משאיר שיחה שמצביעה עליו. העמודה נמחקת עם השורה כולה
-- אחרי 30 יום של שקט (purge_whatsapp_public_conversations).
-- ‏docs/whatsapp-public-bot.md, "השאלה על מתווך/ת".
-- ============================================================================

alter table public.whatsapp_public_conversations
  add column if not exists last_saved_search_id uuid
    references public.saved_searches(id) on delete set null;

comment on column public.whatsapp_public_conversations.last_saved_search_id is
  'החיפוש האחרון שגבריאלה שמרה בשיחה, כדי ש"כן, אשמח לעזרה" בתור הבא ידליק את ההסכמה על אותה שורה (saved-search-intake, action=grant_consent).';

---
name: meeting-followup
description: הפולואפ ללקוח/ה על פגישה בריפו של שוק נדל״ן - אישור בוואטסאפ עם הוספה ליומן, תזכורות עם כפתורים ומשוב אחרי סיור. agent_agenda_client_messages, meeting-client, meeting.html, client_notify, ה-payload mtg:<קוד>. Use when touching meeting-client / _shared/meeting-client.ts / assets/meeting.js, when a client got no confirmation or reminder, got a message twice or after cancel, when a reminder button reached the public bot, or when changing agenda_add/agenda_update.
---

# פולואפ ללקוח/ה על פגישה

המסמך המלא: `docs/meeting-client-followup.md`. כאן מה ששובר **בשקט**, ולמה.

## הזרימה בשורה

`client_notify` נדלק (הבוט ב-`agenda_add`, או התיבה/הכפתור ב-CRM) ←
הטריגר `agent_agenda_client_outbox` כותב שורות ל-`agent_agenda_client_messages`
← ‏`pg_cron` כל דקה (‏`meeting-client-dispatch`) ← `agent_agenda_client_claim`
← `meeting-client` שולח ← הלקוח/ה לוחץ/ת כפתור ← `whatsapp-webhook` ←
`agent_agenda_client_respond` / `_feedback` ← התראה לסוכן/ת.

## 1. התוכן נבנה בזמן השליחה, לא בטריגר

הטריגר רושם **מה ומתי** בלבד. מי שמכניס/ה לתור טקסט מוכן שובר שני דברים:
פגישה שהוזזה לפני שהאישור יצא תשלח את המועד הישן, ותזכורת תישא מיקום
שהשתנה. סוג הודעה חדש = ערך ב-`agent_agenda_client_messages_kind_check`,
מועד ב-`agent_agenda_client_schedule` (אם הוא נגזר מהמועד), תנאי ב-`claim`,
ושורה ב-`lineFor` ב-`meeting-client`.

## 2. כל מועד נבנה מחדש בהזזה - ו"בוצע" אינו מוחק את המשוב

`agent_agenda_client_schedule` מוחק את כל המועדים הממתינים ובונה מחדש. מועד
חדש שאינו נכנס לרשימת ה-`delete` שם יוכפל בכל הזזה. ובכיוון השני:
הסוכן/ת מסמן/ת סיור "בוצע" **לפני** ששאלת המשוב יוצאת - לכן `done` ומועד
שעבר מוחקים הכול **חוץ מ-`feedback`**. ביטול מוחק גם אותה.

## 3. `sending` לפני השליחה, ולא חוזרים עליה

`claim` מסמנת `sending` לפני שמשהו יוצא. קריסה משאירה את השורה שם, ושום
דבר לא מחזיר אותה ל-`pending` - בכוונה: הודעה כפולה ללקוח/ה של סוכן/ת
גרועה מהודעה שלא יצאה. מי שמוסיף/ה "ניסיון חוזר" צריך/ה לדעת מה Meta
קיבלה (‏`wa_message_id`), לא רק שהשורה תקועה.

## 4. הכפתור נתפס **לפני** הניתוב ב-webhook

ה-payload הוא `mtg:<c|x|r|l|u|n>:<token>` - ב-`button.payload` (תבנית)
או ב-`interactive.button_reply.id` (בתוך החלון). הבדיקה ב-`handleMessage`
יושבת לפני זיהוי הסוכן/ת והבוט הציבורי. הזזה שלה אחרי הניתוב שולחת את
הלחיצה לבוט הציבורי, שיענה עליה כאילו נכתבה ביד - והסוכן/ת לא יידע/תדע.

**הסדר של הכפתורים הוא חוזה עם Meta.** בתבנית הכותרות קבועות שם, והקוד
שולח payload לפי **אינדקס** (`REMINDER_BUTTONS`, `FEEDBACK_BUTTONS`). שינוי
סדר בקוד בלי אישור תבנית חדשה = "ביטול" שנרשם כ"אישור". כותרות בהודעה
הרגילה: עד 20 תווים, מודדים (`node -e '...Array.from(t).length, t.length'`).

**ואותו כלל ל-`scr:<a|p|d>:<token>`** - בקשת תיאום ביקור לבעלים ולמתווכים
(‏`showing-coord.ts`). היא נתפסת מיד אחרי `mtg:`, לפני זיהוי השולח/ת: מתווך/ת
בשת"פ הוא/היא סוכן/ת, והלחיצה הייתה מגיעה לגבריאלה כאילו נכתבה ביד. הכותרת
השלישית ("לא מתאים, מועד אחר") בלי אימוג'י - איתו היא 21 יחידות UTF-16.
`docs/showing-coordination.md`.

## 5. תבנית או חלון - ובלעדיהם `no_channel`

בתוך 23 שעות מהודעה נכנסת של הלקוח/ה → טקסט וכפתורים רגילים. אחרת תבנית
(`WHATSAPP_MEETING_TEMPLATE`, ‏`_REMINDER_TEMPLATE`, ‏`_FEEDBACK_TEMPLATE`).
אין אף אחד → `no_channel`, לא נשלח כלום. "הלקוח/ה לא קיבל/ה" הוא כמעט תמיד
זה:

```sql
select kind, status, error, count(*) from agent_agenda_client_messages
 where created_at > now() - interval '7 days' group by 1, 2, 3 order by 4 desc;
```

## 6. ההתראה לסוכן/ת היא `agenda_reminder`, ולא סוג חדש

היא דחופה (עוקפת שעות שקט וימים שקטים - "ביטלתי" שעה לפני פגישה), ונפתחת על הפריט.
סוג חדש ב-`notifications_type_check` יוצא מיד לכל הסוכנים **בלי** עקיפת
השקט (סקיל `whatsapp-bots`, "ההתראות לסוכנים"). ‏`noreply` נסגרת בתוך
`claim` ולא נשלחת ללקוח/ה; היא מתריעה רק אם תזכורת **באמת יצאה**.

## 7. "נכסים דומים" אינו יוצא ללקוח/ה לבד

משוב "לא בשבילי" פותח לסוכן/ת משימה (`showing_feedback`), לא שולח מיניסייט.
מיניסייט נבנה מהמאגר שמותר לשלוח ממנו ונשלח בידי הסוכן/ת - סקיל
`client-showcase`. מי שהופך/ת את זה לאוטומטי עוקף/ת את הכלל הזה.

## 8. הדף מקבל רק מה שהלקוח/ה יודע/ת

`view` מחזיר מתי, איפה ועם מי. **לא `title` ולא `notes`** - שניהם נכתבים
בידי הסוכן/ת לעצמו/ה ("סיור עם רונית - לחוצה, תקציב גמיש"). אותו כלל
בהודעות: `lineFor` אינו משתמש ב-`title`.

## 9. ב-CRM: העמודה אולי עוד לא קיימת

האתר עולה לפני שהמיגרציה רצה. `client_notify` נשלח בשמירה רק כשהתיבה
מוצגת, והיא מוצגת רק כש-`agendaFollowupReady` (השאילתה על העמודות הצליחה).
בבוט: `PGRST204` בהוספה → הפגישה נקבעת בלי הפולואפ.

## 10. המסלול: אותו גייט של היומן

אין לפולואפ גייט משלו: הוא יוצא רק מפריט ב-`agent_agenda_items`, וכל פריט
עובר את `agent_agenda_enabled` (PROFESSIONAL ומעלה). כך הוא רשום בשורה שלו
ב-`pricing.html` וב-`GATES` שב-`check_tier_gates.py`. פתח חדש שישלח הודעה
ללקוח/ה **בלי** פריט ביומן עוקף את הגייט, ומחייב גייט משלו (הסקיל
`new-tier-capability`).

## לפני הדחיפה

```sh
python scripts/check_edge_types.py meeting-client whatsapp-webhook
python scripts/check_long_dash.py
python scripts/check_events.py      # meeting ב-PRIVATE_PAGES
python scripts/check_canonical.py   # meeting ב-PRIVATE
python scripts/check_function_grants.py
```

שינוי במיגרציה נבדק מקומית (Postgres 16 מותקן; `pg_ctlcluster 16 main start`)
עם טבלאות מדומות - התרחישים שכבר נבדקו רשומים במסמך, תחת "בדיקה".

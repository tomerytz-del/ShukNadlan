---
name: meeting-followup
description: עבודה על הפולואפ ללקוח/ה על פגישה בריפו של שוק נדל״ן - אישור בוואטסאפ עם הוספה ליומן, תזכורת יום לפני ושעה לפני עם כפתורי אישור/ביטול/מועד אחר, עדכון והודעת ביטול, משוב אחרי סיור שפותח משימה, והתראה לסוכן/ת כשאין תשובה. התור agent_agenda_client_messages, הפונקציה meeting-client, meeting.html, client_notify ב-agent_agenda_items, ה-payload ‏mtg:<קוד>:<token> ושלוש התבניות ב-Meta. Use when touching meeting-client / _shared/meeting-client.ts / meeting.html / assets/meeting.js / agent_agenda_client_* / client_notify, when a client did not get a meeting confirmation or reminder, when a client got a message twice or after the meeting was canceled, when a button press in a reminder reached the public bot instead, when adding a new kind of client follow-up message, when changing agenda_add/agenda_update in the agent bot, or when changing the agenda form in the CRM.
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

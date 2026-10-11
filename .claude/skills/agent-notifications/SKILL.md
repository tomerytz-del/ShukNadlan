---
name: agent-notifications
description: עבודה על ההתראות וההודעות לסוכנים בריפו של שוק נדל״ן - טבלת notifications, הפעמון ב-CRM (NOTIF_TYPES), הדחיפה לוואטסאפ (notification-push, notification_push_claim), סוג התראה חדש, והקישור הישיר לפריט (related_property_id / related_client_id / related_lead_id, ‏?property= / ?client= / ?lead= ב-crm.js). Use when adding a notification type or a new place that inserts into notifications, when writing any message to an agent that mentions a property, client or lead (WhatsApp, email, bell, bot tool result), when a notification links to /crm or to a whole category instead of the item, when touching notification-push / itemPath / handleGotoParam / openNotificationTarget, or when redefining a function that inserts into notifications, when a WhatsApp notification to an agent arrived late or never (daily cap, gap, quiet hours, notification_push_priority_types / notification_push_is_ambient), or when a migration adds a notification type (notification_types_add - never rewrite notifications_type_check).
---

# התראות והודעות לסוכנים

המסמך המלא: `docs/notifications-center.md`. כאן מה ששובר **בשקט**.

## 1. הכלל: הקישור פותח את הפריט, לא את הקטגוריה

הודעה לסוכן/ת על נכס, לקוח/ה או ליד **אחד/ת** נושאת קישור שפותח אותו/ה:

| הפריט | הקישור |
| --- | --- |
| נכס | `/crm?goto=accProperties&property=<id>` |
| לקוח/ה | `/crm?goto=accClients&client=<id>` (ועם `&focus=matches` - רשימת ההתאמות) |
| ליד | `/crm?goto=accLeads&lead=<id>` |
| נכס של משרד אחר (שיתוף) | `/crm?goto=accSharedWithMe&property=<id>` |
| הסכם | `/crm?goto=accAgreements&agreement=<id>` |
| ביקורת ממתינה (למאשר/ת) | `/crm?goto=accReviews&review=<id>`; מפורסמת - `/agent?slug=<slug>#reviewsSec` |
| פריט ביומן | `/crm?goto=accAgenda&agenda=<id>` |

לא `/crm` ולא `/crm?goto=accProperties`. הודעה כזו נראית תקינה לגמרי - היא
פשוט משאירה את הסוכן/ת לחפש נכס אחד בין עשרות. כך היה עם "נכתב תיאור
שיווקי לנכס" עד `20270320093000`.

**בטבלת `notifications` זה אומר לכתוב את המזהה באותו `insert`:**

```sql
insert into public.notifications (agent_id, type, title, body, related_property_id)
values (v_agent, 'marketing_copy', '...', '...', v_property_id);
```

‏`notification-push` (‏`itemPath()`) והפעמון (‏`openNotificationTarget()` ב-
`crm.js`) בונים מזה את הקישור, באותו סדר: פריט ביומן; הסכם; ביקורת;
`client_match` ← הלקוח/ה עם ההתאמות; נכס של משרד אחר ← "שותפו איתי"; נכס
(חוץ מ-`client_match` ו-`deal_closed`) ← הכרטיס שלו; לקוח/ה; ליד; אחרת
הקטגוריה. **שינוי סדר באחד מחייב את השני.**

**חריג אחד לפני הכול: תזכורת מהיומן שנושאת ליד** (`agenda_reminder` עם
`related_lead_id`, כמו "לחזור לליד חדש") פותחת את הליד ולא את הפריט ביומן -
שם מטפלים. ‏`agent_agenda_dispatch` כותבת את המזהה רק אחרי בדיקה שהליד עוד
ב-`leads`: ה-FK הוא `on delete cascade`, וליד שנמחק היה מפיל את כל סבב
ה-dispatch ולא רק את ההתראה שלו.

**"של מי הנכס" מוכרע ב-claim** (‏`property_mine`), לא לפי סוג ההתראה: אותו
סוג `system` נושא גם נכס שנמסר אליך בהפנייה (שלך) וגם נכס ששותף איתך (של
משרד אחר), ולכל אחד מסך אחר. ‏**וביקורת ממתינה מגיעה עם `review_id` רק למי
שאינו/ה הסוכן/ת שעליו/ה נכתבה** - לסוכן/ת אין מה לעשות איתה, ותור האישור
סגור בפניו/ה.

התראה על **כמה** פריטים (שלוש התאמות, מסירה של עשרה נכסים) נשארת בלי
מזהה - אין פריט אחד שהוא היעד. בקבוצה: `case when count(*) = 1 then
(array_agg(x.id))[1] end` (אין `min()` ל-`uuid` ב-Postgres).

**ומחוץ לטבלה** (הודעה ישירה מפונקציית Edge, תוצאת כלי של גבריאלה): אותם
קישורים. בבוט - `crm_link` לצד `link` (המודעה באתר), כמו ב-`create_property`
ו-`update_property`; הפרומפט אומר לצרף את שניהם.

### ‏וכשההודעה סופרת כמה נכסים - קישור מסונן

תזכורת כמו "3 נכסים באוויר בלי תמונה" (‏`agent-reminders`) מקשרת ל-
`/crm?goto=accProperties&filter=<סינון>` - הרשימה מסוננת בדיוק לנכסים
שנספרו, ונכס אחד נפתח ישר. הסינון חייב להיות מוגדר כמו הספירה במסד. הטבלה
המלאה: `docs/agent-reminders.md`, "הקישור שמוביל למקום שבו מטפלים".

## 2. פריט שלא נמצא - נחיתה רכה

‏`openPropertyFromParam` / `openLeadFromParam` / `openClientFromParam`
בודקים שהפריט ברשימה שנטענה, ואחרת משאירים את הקטגוריה פתוחה. נכס שנמסר
לסוכן/ת אחר/ת או נמחק אינו שגיאה. **‏`?property=` מנקה את הסינון ומרחיב את
חלון הטעינה (‏`propTabsShown`)** - בלי זה נכס ישן או מסונן לא מגיע ל-DOM,
והקישור "לא עושה כלום".

פרמטר חדש נמחק מהכתובת ב-`handleGotoParam` יחד עם השאר, אחרת רענון קופץ
שוב לאותו פריט.

## 3. החלפת פונקציה שכותבת התראה

כדי להוסיף מזהה ל-`insert` קיים מחליפים את הפונקציה ב-`create or replace`
- **מהגרסה האחרונה שלה**, לא מהראשונה. פונקציות כאן הוגדרו מחדש עד חמש
פעמים. מוצאים את האחרונה:

```sh
grep -ln "create or replace function public.<name>(" supabase/migrations/*.sql | tail -1
```

ומוודאים מול הפרודקשן בקריאה בלבד (‏`select md5(prosrc), length(prosrc) from
pg_proc where proname = '<name>'`). **ובודקים ש-`main` לא הגדיר אותה מחדש
בזמן שעבדתם** - מיגרציה שלכם עם גוף ישן דורסת את התיקון של מישהו אחר בלי
שום שגיאה. הסקיל `new-migration` לשאר הכללים.

## 4. סוג התראה חדש - ארבעה מקומות

1. ‏`notifications_type_check` (מיגרציה) - **רק** דרך
   ‏`select public.notification_types_add(array['הסוג'])`, ולא בכתיבה מחדש
   של הרשימה: רשימה קשיחה מוחקת סוג ש-PR מקביל הוסיף (‏#702 ו-#711, ‏10.2026),
   ו-`check_notif_type_constraint.py` חוסם אותה ב-CI. **הסוג יוצא מיד לכל
   הסוכנים בוואטסאפ** - ראו `whatsapp-bots`, "ההתראות לסוכנים", וסעיף 8 כאן.
2. ‏`NOTIF_TYPES` ב-`crm.js` - הצבע, הקטגוריה, והשורה ב"התראות והודעות".
3. ‏`ACC_BY_TYPE` ב-`notification-push` - קישור הקטגוריה כשאין פריט, **אותה
   קטגוריה כמו ב-`NOTIF_TYPES`**. סוג שנשכח כאן נופל ל-`MANAGE_ACC` (הגדרות
   ההתראות): עד 10.2026 שבעה סוגים שלחו כך לוואטסאפ קישור למסך ההגדרות.
   ‏`scripts/check_notif_links.py` חוסם ב-CI.
4. ‏`itemPath()` ו-`openNotificationTarget()` - אם הסוג נושא פריט אחד.

## 5. התבנית בוואטסאפ

מחוץ לחלון 24 השעות ההודעה היא תבנית, והקישור הישיר נכנס **לסוף הפריט
בפרמטר `{{2}}`**, לא לכפתור: הכפתור היחיד בתבנית הוא הדרך לכבות את הערוץ.
הפרמטר הוא שורה אחת (‏Meta דוחה `\n`) ונחתך ב-900 תווים; קישור שנחתך באמצע
מזהה נופל ב-`UUID_PARAM_RE` ומוביל לקטגוריה.

## 6. שקט - שעות **וימים**

מה שנשלח לסוכן/ת בוואטסאפ או במייל עובר בשקט שהסוכן/ת בחר/ה ב"התראות
והודעות" (‏`accNotifPrefs` - שם כל ההגדרות, גם של התזכורות; "תזכורות וטיפים"
היא רשימה בלבד), ושני השולחים קוראים אותו מאותה שורה ב-`agent_reminder_preferences`:
‏`notification_push_due_agents` (הפעמון בוואטסאפ) ו-`agent_reminder_due_agents`
(התזכורות). השקט הוא שני דברים: חלון שעות (‏`quiet_from_hour`/`quiet_to_hour`,
‏21→8) וימי שבוע שלמים (‏`quiet_days`, ברירת מחדל `{5,6}` - שישי ושבת;
‏0=ראשון לפי `extract(dow)`, שעון ישראל; ‏`20270412090000`).

**המלכודת:** יש שתי גרסאות של `agent_reminder_quiet_now`. ‏`(from, to)`
בודקת שעות בלבד, ו-`(from, to, days)` גם ימים. מי שמגדיר/ה מחדש אחד
השולחים ומעתיק/ה מגרסה שקודמת ל-`20270412090000` מקבל/ת את הקריאה בת שני
הפרמטרים - והימים השקטים נעלמים בלי שגיאה, וההודעות יוצאות בשבת. תמיד
להעתיק מהגרסה האחרונה (הפקודה בסעיף 3), ו-`coalesce(..., '{5,6}')` ולא
‏`'{}'` כשאין שורה.

‏`agenda_reminder` עוקף את שניהם (שעות וימים), בכוונה - "ביטלתי" שעה לפני
פגישה בשבת חייב לצאת.

## 7. הטופס אחד, הטבלאות שתיים

"התראות והודעות" שומר בכפתור אחד את `agent_notification_preferences`
(‏`saveNotifPrefsRows`) ואת `agent_reminder_preferences` (‏`saveReminderPrefs`),
במקביל, וכל אחת מחזירה `{ error, text }`. שדה חדש לאחת מהן נכנס לפונקציה
שלה ולא ל-submit. ו-`saveReminderPrefs` מדלגת כשבוררי השעות עוד ריקים - בורר
ריק נקרא 0, ו-0/0 הוא "בלי שעות שקט".

## 8. בוואטסאפ: עדיפות, רקע ותקרה

ההודעה לסוכן/ת בוואטסאפ מקבצת התראות, ושלושה שערים עוצרים אותה: שעות
שקט, מרווח קיבוץ (10 דקות) ותקרה של 12 הודעות ביממה. עד `20270420090000`
תקרה מלאה הוציאה את הסוכן/ת מהרשימה לכל היממה, ואחרי 12 שעות ההתראה נזרקה
- כך בקשת סיור מהמיניסייט ב-11.10.2026 לא הגיעה לעולם. מאז שלוש קבוצות:

| קבוצה | איפה | מה מקבלת |
| --- | --- | --- |
| עדיפות | `notification_push_priority_types()` - ‏`agenda_reminder`, ‏`showcase_meeting`, ‏`new_lead` | עוקפת מרווח ותקרה; נשמרת 72 שעות. שקט חל (חוץ מ-`agenda_reminder`) |
| רקע | `notification_push_is_ambient()` - ‏`platform_signup`, ‏`system` על נכס של משרד אחר ("שותף איתך") | לא מעירה שליחה לבד: מצטרפת להודעה הבאה, או תקציר אחרי 180 דקות. בהודעה - שורה אחת לכל סוג |
| כל השאר | | השערים כרגיל |

**סוג חדש - לאיזו קבוצה?** שאלה אחת: האם אדם מחכה לתשובה בצד השני (לקוח/ה,
ליד, פגישה)? אז עדיפות - רשימה ב-`notification_push_priority_types` וב-
`PRIORITY_TYPES` ב-`notification-push`, **שתיהן**. האם הוא נכתב בכמויות
(מאות ביום) ואינו דורש פעולה עכשיו? אז רקע - ב-`notification_push_is_ambient`
וב-`isShare`/`isSignup` (‏`arrange`) ב-`notification-push`. אחרת - כלום.

**ואל תוסיף/י סוג קיים לעדיפות כדי "לתקן עיכוב"** בלי לבדוק את הנפח שלו
(`select type, count(*) from notifications where created_at > now()-interval '7 days' group by 1`):
עדיפות עוקפת את התקרה, וסוג רועש בה הוא הדרך לחסימה של המספר מול Meta.

**חלוקה בתוך סוג קיים** (בקשת סיור מתוך `showcase_activity`) נעשית בסוג
חדש ולא בבדיקת כותרת - העדיפות נקבעת לפי `type`.

## לפני הדחיפה

```sh
node --check assets/crm.js
python3 scripts/check_migration_versions.py --base-ref origin/main
python3 scripts/check_function_grants.py
python3 scripts/check_long_dash.py
python3 scripts/check_notif_links.py
python3 scripts/check_notif_type_constraint.py
```

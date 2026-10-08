---
name: agent-notifications
description: עבודה על ההתראות וההודעות לסוכנים בריפו של שוק נדל״ן - טבלת notifications, הפעמון ב-CRM (NOTIF_TYPES), הדחיפה לוואטסאפ (notification-push, notification_push_claim), סוג התראה חדש, והקישור הישיר לפריט (related_property_id / related_client_id / related_lead_id, ‏?property= / ?client= / ?lead= ב-crm.js). Use when adding a notification type or a new place that inserts into notifications, when writing any message to an agent that mentions a property, client or lead (WhatsApp, email, bell, bot tool result), when a notification links to /crm or to a whole category instead of the item, when touching notification-push / itemPath / handleGotoParam / openNotificationTarget, or when redefining a function that inserts into notifications.
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

לא `/crm` ולא `/crm?goto=accProperties`. הודעה כזו נראית תקינה לגמרי - היא
פשוט משאירה את הסוכן/ת לחפש נכס אחד בין עשרות. כך היה עם "נכתב תיאור
שיווקי לנכס" עד `20270320093000`.

**בטבלת `notifications` זה אומר לכתוב את המזהה באותו `insert`:**

```sql
insert into public.notifications (agent_id, type, title, body, related_property_id)
values (v_agent, 'marketing_copy', '...', '...', v_property_id);
```

‏`notification-push` (‏`itemPath()`) והפעמון (‏`openNotificationTarget()` ב-
`crm.js`) בונים מזה את הקישור, באותו סדר: `client_match` ← הלקוח/ה עם
ההתאמות; נכס (חוץ מ-`client_match` ו-`deal_closed`) ← הכרטיס שלו; לקוח/ה;
ליד; אחרת הקטגוריה. **שינוי סדר באחד מחייב את השני.**

התראה על **כמה** פריטים (שלוש התאמות, מסירה של עשרה נכסים) נשארת בלי
מזהה - אין פריט אחד שהוא היעד. בקבוצה: `case when count(*) = 1 then
(array_agg(x.id))[1] end` (אין `min()` ל-`uuid` ב-Postgres).

**ומחוץ לטבלה** (הודעה ישירה מפונקציית Edge, תוצאת כלי של גבריאלה): אותם
קישורים. בבוט - `crm_link` לצד `link` (המודעה באתר), כמו ב-`create_property`
ו-`update_property`; הפרומפט אומר לצרף את שניהם.

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

1. ‏`notifications_type_check` (מיגרציה). **יוצא מיד לכל הסוכנים בוואטסאפ**
   - ראו `whatsapp-bots`, "ההתראות לסוכנים".
2. ‏`NOTIF_TYPES` ב-`crm.js` - הצבע, הקטגוריה, והשורה ב"ניהול התראות".
3. ‏`ACC_BY_TYPE` ב-`notification-push` - קישור הקטגוריה כשאין פריט.
4. ‏`itemPath()` ו-`openNotificationTarget()` - אם הסוג נושא פריט אחד.

## 5. התבנית בוואטסאפ

מחוץ לחלון 24 השעות ההודעה היא תבנית, והקישור הישיר נכנס **לסוף הפריט
בפרמטר `{{2}}`**, לא לכפתור: הכפתור היחיד בתבנית הוא הדרך לכבות את הערוץ.
הפרמטר הוא שורה אחת (‏Meta דוחה `\n`) ונחתך ב-900 תווים; קישור שנחתך באמצע
מזהה נופל ב-`UUID_PARAM_RE` ומוביל לקטגוריה.

## לפני הדחיפה

```sh
node --check assets/crm.js
python3 scripts/check_migration_versions.py --base-ref origin/main
python3 scripts/check_function_grants.py
python3 scripts/check_long_dash.py
```

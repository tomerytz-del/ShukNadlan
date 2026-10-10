---
name: client-matching
description: עבודה על קובץ הלקוחות ומנוע ההתאמות בריפו של שוק נדל״ן - agent_clients, client_property_match (מקור האמת היחיד לציון), match_properties_for_client / client_match_top / client_match_counts, התראות ההתאמה והטריגר שמריץ אותן, מחפש/ת מול בעל/ת נכס (client_kind), וכל הפתחים שיוצרים כרטיס לקוח/ה (הטופס ב-CRM, ייבוא מאקסל ומאנשי קשר, create_client של גבריאלה, "כן, תוסיף" אחרי סיכום שיחה). Use when touching agent_clients or a function that reads it, adding a requirement field or a scoring rule, adding a new way to create a client, when a client "matches everything" or has dozens of irrelevant matches, when a seller/landlord shows up as a buyer, when matches don't refresh after editing a client, or when the bot and the CRM show a different score.
---

# קובץ הלקוחות ומנוע ההתאמות

התיעוד המלא: `docs/client-matching.md`. כאן - מה שנשבר בשקט.

## ‏1. שדה ריק = "לא משנה", ולכן כרטיס ריק מתאים לכל נכס

זו התנהגות מכוונת: לקוח/ה עם שם וטלפון בלבד מקבל/ת התאמות מיד. המחיר:
**כל פתח שיוצר כרטיס בלי דרישות יוצר "קונה" שמתאים לכל המאגר.** כך מוכר
דירה בעפולה קיבל 27 התאמות, ובראשן בית באומן ב-4.1 מיליון עם 100%.

פתח חדש שיוצר כרטיס (טופס, ייבוא, כלי בבוט, Webhook) חייב להחליט:

- **בעל/ת נכס?** `client_kind = 'owner'` (מוכר/ת או משכיר/ה; `deal_type`
  ממשיך לומר sale/rent). בלי זה הכרטיס נולד `seeker`.
- **בלי שום דרישה, ובכמות?** `status = 'paused'` - כמו ייבוא אנשי הקשר
  (`docs/crm-contacts-import.md`), אחרת מאה כרטיסים מציפים את ההתראות.

הפתחים הקיימים: הטופס (`assets/crm.js`, `setClientFormKind`), ייבוא מאקסל
(`CLIENT_IO_FIELDS` ב-`assets/crm-office.js`), אנשי קשר, `create_client`
ב-`whatsapp-webhook/agent.ts`, ו"כן, תוסיף" אחרי סיכום שיחה (`twilio-voice`
מחזיר `needs.client_kind = "owner"`, וגבריאלה מעבירה את `needs` ל-
`create_client`).

## ‏2. `client_property_match` הוא המקום היחיד לכלל התאמה

הפאנל, הספירות (`client_match_counts`, `client_match_top`), ההתראות בשני
הכיוונים והבוט (`agent_client_matches`, `agent_property_client_matches`,
`agent_client_market_matches` - מה שמשרדים אחרים באזור מפרסמים ולא שיתפו)
קוראים כולם ל-`client_property_match(client, property)`. כלל שנוסף **שם**
חל על כולם; כלל שנוסף בתצוגה או בכלי של הבוט מפצל את הציון בין הוואטסאפ
לדשבורד.

- כל גרסה של הפונקציה היא **העתק מלא** - מעתיקים מהמיגרציה האחרונה
  שמגדירה אותה (`grep -l "function public.client_property_match" supabase/migrations/*.sql | tail -1`),
  ומשנים שורה.
- היא `immutable` ומקבלת את שורת `agent_clients` כטיפוס. עמודה חדשה
  מתווספת **לפני** ה-`create or replace` באותה מיגרציה.
- ‏`revoke ... from public, anon, authenticated` - שלושתם (הסקיל
  `new-migration`).

## ‏3. דרישה חדשה = גם בטריגר

`agent_clients_match_alerts_upd` מריץ מחדש את ההתראות רק כשאחת העמודות
**שברשימה שלו** השתנתה. עמודת דרישה שלא נוספה לרשימה: הסוכן/ת משנה
אותה, הפאנל מתעדכן (הוא מחושב בקריאה), וההתראות לא - ואין שום סימן.
את הטריגר יוצרים מחדש (`drop trigger if exists` + `create trigger`) עם
הרשימה המלאה.

## ‏4. בעל/ת נכס (`client_kind = 'owner'`)

- מסונן/ת ב-gate של `client_property_match` - אין צורך (ואסור) לסנן שוב
  בכל צרכן.
- מעבר ל-owner מוחק את ההתראות הפתוחות (`new`/`seen`) בטריגר
  `agent_clients_owner_clear_alerts`; `dismissed` נשמרת. מעבר חזרה ל-seeker
  מריץ התאמות דרך הטריגר מסעיף 3.
- בתצוגה: "מוכר/ת"/"משכיר/ה" ולא "קנייה"; אין כפתור התאמות; ההסכם
  `sell`/`landlord` ולא `buy`/`tenant`. כל מקום חדש שכותב "קנייה"/"שכירות"
  על כרטיס לקוח/ה עובר דרך `clientSideLabel()` (CRM) או `clientNeeds()`
  (בוט) / `needsLine()` (‏twilio-voice).
- **"למכירה" על מחפש/ת הוא דו-משמעי.** `clientNeeds` אמר כך על קונים, ומודל
  קורא בזה מוכר/ת. כותבים את הצד במפורש: "מחפש/ת לקנות", "בעל/ת נכס - מוכר/ת".
- מי שמוכר/ת **וגם** קונה הוא/היא `seeker`, והמכירה בהערות.

## ‏4א. ההתראה על התאמה מובילה ללקוח/ה

‏`generate_client_match_alerts` ו-`_for_client` כותבות `related_client_id`
(כשיש לקוח/ה אחד/ת) ו-`related_property_id` (כשיש נכס אחד), והקישור בוואטסאפ
ובפעמון פותח את כרטיס הלקוח/ה עם רשימת ההתאמות (`&focus=matches`). מי שמחליף/ה
את אחת מהן - מ-`20270320093000` ואילך - שומר/ת על שני המזהים. סקיל
`agent-notifications`.

## ‏4ב. מי מחזיק/ה בכרטיס - רק דרך הפונקציות

‏`agent_id`, ‏`agency_id`, ‏`referred_by` ו-`referred_at` של `agent_clients`
(ושל `properties`) נעולים בטריגר `guard_ownership_columns()`
(‏`20270323090000`): משתמש/ת מחובר/ת אינו/ה יכול/ה לשנות אותם ב-`update`, ו-
‏`insert` עם `referred_by` נדחה. הפתח הבא שיוצר כרטיס או מעביר אותו -
ייבוא, כפתור בבוט, מסירה מהמשרד - עובר דרך פונקציית `SECURITY DEFINER`
(‏`refer_to_agent`, ‏`refer_clients_to_agent`) או דרך `service_role`. קריאה
מהדפדפן עם `.update({ agent_id })` תיכשל עם "רק דרך העברה מהמשרד", וזו
הכוונה: ה-policies לבדם השאירו את העמודות האלה פתוחות. ‏`docs/office-referrals.md`.

## ‏4ג. כרטיס הלקוח/ה ב-CRM

‏`buildClientCard()` נבנה מחדש באוקטובר 2026 (כותרת, תגיות פרמטרים, תיבת
דרישה, ההתאמה המובילה, סרגל פעולות ומגירת התאמות). שני דברים נשברים בו בשקט:

- **אחיזות.** ‏`data-client-card`, ‏`.sc-pill-slot`, ‏`.match-cta`,
  ‏`.client-calls-btn`, ‏`.match-panel`, ‏`.match-head` ו-`.cc-bar` נקראים
  מקוד אחר (המיניסייט, ‏`?focus=matches`, "הצלב נכסים", קישור משיחה, יומן
  השיחות). שם שהשתנה = כפתור שלא עושה כלום, בלי שגיאה.
- **נכס יוצא ללקוח/ה רק דרך המיניסייט.** הכפתור "➕ למיניסייט" בכל התאמה
  קורא ל-`openShowcaseSend` עם הנכס הזה לבדו. אל תחזירו כפתור ששולח בוואטסאפ
  קישור לעמוד הנכס הציבורי: הוא חושף את המשרד המפרסם של נכס בשת"פ - בדיוק
  מה שהמיניסייט נבנה למנוע (הסקיל `client-showcase`) - ומאבד את המעקב.

הסגנון כולו תחת `.cc` ב-`crm.html`, כי `.match-card` ו-`.lead-actions`
משותפים לכרטיסים אחרים. הפריסה לפי `@container` (רוחב הכרטיס) ולא `@media`.

## ‏5. בדיקה

אין בדיקת CI למנוע. לפני דחיפה של מיגרציה שנוגעת בו: Postgres מקומי
(‏`/usr/lib/postgresql/16/bin`), טבלאות מינימליות, הרצת המיגרציה **פעמיים**
(אידמפוטנטיות), ו-`count(*)` של `client_property_match` לכרטיס לפני ואחרי.

---
name: client-matching
description: עבודה על קובץ הלקוחות ומנוע ההתאמות בריפו של שוק נדל״ן - agent_clients, client_property_match (מקור האמת היחיד לציון), match_properties_for_client / client_match_top / client_match_counts, התראות ההתאמה והטריגר שמריץ אותן, מחפש/ת מול בעל/ת נכס (client_kind), וכל הפתחים שיוצרים כרטיס לקוח/ה (הטופס ב-CRM, ייבוא מאקסל ומאנשי קשר, create_client של גבריאלה, "כן, תוסיף" אחרי סיכום שיחה). Use when touching agent_clients or a function that reads it, adding a requirement field or a scoring rule, adding a new way to create a client, when a client "matches everything" or has dozens of irrelevant matches, when a seller/landlord shows up as a buyer, when matches don't refresh after editing a client, or when the bot and the CRM show a different score. Also when a new office gets no matches from other offices (property_shares, share_backfill_for_agency), or when the bot says "5 matches" and the CRM shows more.
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

- **מאפייני החובה (`required_features`) הם סינון קשיח** (‏`20270417090000`).
  הגרסה בשלושה ארגומנטים מקבלת `p_waive_features` - ויתור שהסוכן/ת אישר/ה
  בבוט. מעתיקים את **השלושה-ארגומנטים**; את העטיפה בשניים לא נוגעים. צרכן
  חדש קורא לעטיפה, אלא אם הוא צריך ויתור מפורש - ואז הוויתור מגיע מהסוכן/ת,
  לא מקוד שמחליט ש"קרוב מספיק".

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

‏`client_match_alerts` נקראת גם **מהכיוון ההפוך**: תגית "N לקוחות מתאימים"
בכרטיס הנכס ב"הנכסים שלי" והסינון "יש לקוחות מתאימים" סופרים אותה לפי
`property_id` (בלי `dismissed`, בלי לקוח/ה `closed`). מי שמשנה את הסטטוסים
שלה, או מוחק/ת ממנה שורות, משנה גם את הספירה הזו. סקיל `property-card`.

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

## ‏4ד. המאגר השלישי (`property_shares`) ומספר ההתאמות בבוט

- **שתי פונקציות בלבד כותבות ל-`property_shares`:** ‏`share_property_for_agent`
  (סוכן/ת פותח/ת נכס לשת"פ) ו-`share_backfill_for_agency` (טריגר על הוספת משרד,
  ‏`20270423090000`). עד אז משרד חדש לא קיבל אף נכס שכבר הופץ, והמאגר
  השלישי שלו היה ריק - 821 הפצות חסרו ב-29 מתוך 30 משרדים. **מי שמשנה את
  כללי הבחירה של המשרדים באחת משנה גם בשנייה**, אחרת משרד חדש מקבל סט אחר
  ממשרד ותיק. ההשלמה שקטה (בלי "נכס חדש שותף איתך" ובלי התראות התאמה,
  דרך הדגל `app.share_backfill`), כי ההתאמות עצמן מחושבות בקריאה.
- **בדיקה שהמאגר תקין** - אפס הפצות חסרות. שאילתה אחת: נכסים פעילים עם
  `shared_with_partners`, כפול כל משרד שאינו של הבעלים ואינו ב-
  `agent_share_exclusions`, בלי שורה ב-`property_shares` (‏`docs/property-sharing.md`,
  "משרד שמצטרף אחרי ההפצה").
- **מספר ההתאמות שהבוט אומר הוא `total`, לא `count`.** ‏`client_matches`
  ו-`property_matches` מושכים עד 30 (‏`v_cap` במסד) וחותכים ב-`match-cut.ts`,
  **בלי להפריד בין ציונים שווים** - הסדר ביניהם הוא רק תאריך הפרסום, וכך
  נחתכה פעם ההתאמה הזולה מבין שש ב-100%. מי שמוריד את התקרה במסד או קורא
  לפונקציות האלה ממקום חדש עם `p_limit` קטן - מחזיר את הבאג.

## ‏4ה. רמות שיתוף וסיכום ההתאמות (‏`20270426090000`)

- **אין צלצול על התאמה.** ‏`generate_client_match_alerts` ו-`_for_client`
  כותבות רק ל-`client_match_alerts`; ‏`client_match_digest_run()` שולחת
  `match_digest` כל `match_digest_days` (‏3). מי שמחזיר/ה `insert` ל-
  `notifications` לאחת מהן מחזיר/ה את ההצפה. התראה חדשה על התאמה - לסיכום.
- **נכס `private`** נחסם בשורה ב-gate של `client_property_match`. גרסה חדשה
  שמועתקת מגרסה ישנה מ-`20270426090000` מאבדת אותה בשקט - ונכס פרטי מופיע
  אצל כל המשרד.
- **נכס `network` = שת״פ.** משנים דרך `set_share_level` או כפתורי השת״פ
  (הטריגר `properties_share_level_sync` מיישר), לא ב-`update` של `share_level`
  לבד - אחרת הרמה אומרת "רשת" ושום משרד לא קיבל את הנכס.
- **לקוח/ה** - הרמה קובעת רק מי מהמפרסמים שומע/ת בסיכום. פרטי הלקוח/ה לא
  נחשפים באף רמה, ו-RLS של `agent_clients` לא משתנה בגללה.

## ‏5. בדיקה

אין בדיקת CI למנוע. לפני דחיפה של מיגרציה שנוגעת בו: Postgres מקומי
(‏`/usr/lib/postgresql/16/bin`), טבלאות מינימליות, הרצת המיגרציה **פעמיים**
(אידמפוטנטיות), ו-`count(*)` של `client_property_match` לכרטיס לפני ואחרי.

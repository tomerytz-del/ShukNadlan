---
name: broker-license
description: עבודה על אימות רישיון התיווך בריפו של שוק נדל״ן - רשם המתווכים, הערעור (צילום רישיון), ומודל "קודם חשבון, אחר כך אוויר" - החשבון נפתח תמיד, ודף הסוכן/ת, דף המשרד והמודעות מחכים לאישור (license_hold_at, agency_members_public, agency_is_live). Use when touching agency-signup / create-own-agency / join-agency / broker-license-appeal / broker-license-gate.ts, when writing code that sets license_number or license_status, when a listing "doesn't go live" or an agent page/office page is missing from the site, when someone without a valid license appears on the site, when adding a new way to join the platform, or when changing the licenseHoldCard in the CRM.
---

# רישיון תיווך: קודם חשבון, אחר כך אוויר

המסמך המלא: `docs/broker-registry.md`. כאן מה ששובר **בשקט**.

## המודל במשפט

החשבון נפתח תמיד. מספר הרישיון נבדק בשמירה. כל עוד הוא לא תקין - דף
הסוכן/ת, דף המשרד והמודעות **לא באוויר**, והסוכן/ת רואה בראש הדשבורד
כרטיס עם הסטטוס, שליחת צילום ותיקון מספר. האישור מעלה הכול לאוויר מעצמו.

"תקין" = `license_number is not null` **וגם** `license_status not in
('not_found','inactive')`. ‏`unverified` (המאגר לא ענה) תקין - אתר ממשלתי
שנפל אינו סיבה להוריד מישהו מהאוויר.

עד `20270216090000_license_hold.sql` השער חסם את החשבון עצמו (403, ולא נוצר
כלום). זה הוביל לכך שמי ששלח/ה ערעור לא יכול/ה היה/הייתה להיכנס לבדוק סטטוס,
וכל ניסיון חוזר הציע לפתוח משרד חדש. **אל תחזירו 403 על רישיון.**

## המפה

| שכבה | איפה | מה |
| --- | --- | --- |
| הבדיקה | `_shared/broker-license-gate.ts` | `checkBrokerLicense` (מטמון, ערעור מאושר, המאגר), `licenseSummary` לדפדפן |
| פתיחת משרד | `agency-signup`, `create-own-agency` | בודקים, כותבים על הכרטיס, מחזירים `license` - **לא חוסמים**. מקבלים `manager_phone` (נשמר בעדכון נפרד, כשל אינו מפיל) ו-`id_number` ברשות - הטפסים כבר לא שולחים אותו, הת.ז. נשאלת בהסכם הראשון (הסקיל `agreement-signing`) |
| כניסת סוכן/ת | `join-agency` | `licenseGate` דורש מספר בלבד. `license_status`, `set_license` |
| ערעור | `broker-license-appeal` | `submit` (אנונימי), `list`/`decide` (מנהל/ת פלטפורמה) |
| המודעות | טריגר `properties_a_license_hold` | `active` של סוכן/ת לא תקין/ה → `unpublished` + `license_hold_at` |
| השחרור | טריגר `agency_members_release_license_hold` | רישיון נעשה תקין → המודעות שחיכו עולות |
| דף הסוכן/ת | `agency_members_public` | מסנן רישיון לא תקין |
| דף המשרד | `agency_is_live()` + המדיניות `public read agencies` | משרד בלי אף כרטיס תקין מוסתר |
| ה-CRM | `#licenseHoldCard`, `refreshLicenseHold()` | הסטטוס, הצילום, תיקון המספר. **הנוסח הוא הזמנה ולא אזהרה**: "החשבון שלך מוכן לעבודה!", בירוק, "העלאת אישור רישיון (לפרסום מיידי)" ו"המשך ללוח הבקרה" (מקפל לשורה, `LH_COMPACT_KEY`). אדום רק כשצילום נדחה. אותו נוסח ב-`showAccountReady` ב-`agency-signup.html` |
| התווית בנכס | `propertyStatusLabel()`, `.psp-held` | "ממתין לאישור רישיון" במקום "ירד מפרסום". מקום חדש שמציג סטטוס נכס - דרכה, ו-`license_hold_at` בעמודות |

## ששה דברים ששוברים בשקט

### 1. מספר רישיון נכתב רק דרך השרת

שדות `license_*` נעולים מול הדפדפן (`protect_sensitive_agency_member_fields`).
שמירה ישירה של `license_number` מה-CRM **מצליחה** - אבל משאירה על המספר החדש
את תוצאת הבדיקה של הקודם. לכן כל שינוי מספר עובר ב-`join-agency`
‏`set_license`, כולל טופס הפרופיל. מי שמוסיף/ה שדה רישיון למסך חדש - דרך
`saveLicenseNumber()` ולא `sb.from('agency_members').update`.

### 2. כל כתיבה של `license_status` מפעילה את השחרור

הטריגר על `agency_members` רץ על `update of license_status, license_number`.
זה מה שגורם לאישור ערעור, לתיקון מספר ולאימות לעלות לאוויר בלי צעד נוסף.
מי שכותב/ת סטטוס תקין בטעות (למשל backfill) **מעלה לאוויר** מודעות שחיכו.

### 3. דרך חדשה לפרסם מודעה עוברת דרך הטריגר מעצמה

הטריגר על `properties` מכסה כל מקור - CRM, הבוט, ייבוא, `service_role`. אל
תוסיפו בדיקת רישיון בקוד הפרסום: היא הייתה מתפצלת מהמסד. מה שכן צריך הוא
**הודעה נכונה** - המסד מחזיר הצלחה, והנכס נשאר `unpublished`. ב-CRM זה
`licenseState.cleared`; במסך אחר יש לבדוק אותו לפני שאומרים "מופיע באתר".

### 4. קריאה של משרדים או סוכנים לתצוגה ציבורית - דרך המפתח הציבורי

ההסתרה יושבת ב-RLS (`agencies`) ובתצוגה (`agency_members_public`). פונקציה
שקוראת ב-`service_role` את `agencies` או את `agency_members` ומציגה לגולשים
**עוקפת** את שתיהן. פונקציות ה-edge ב-Netlify קוראות עם מפתח anon, וזה בכוונה.

### 5. נרמול המספר זהה בשלושה מקומות

`normalizeLicense` (ספרות בלבד, בלי אפסים מובילים) הוא מה שנשמר ב-
`broker_license_appeals`, ולפיו `decide` מוצא את הכרטיסים לשחרר. `set_license`
שומר באותו נרמול. מספר שנשמר עם אפס מוביל לא ישתחרר באישור הערעור.

### 6. מודעה שנופלת בשחרור נשארת `unpublished` בלי סימון

השחרור עוטף כל נכס ב-`exception`: נכס שנפל (למשל על כלל הכפילות,
`properties_guard_duplicate`) אינו מפיל את עדכון הרישיון. הוא נשאר
`unpublished`, `license_hold_at` מתאפס, והסוכן/ת יראה/תראה את הסיבה בפרסום
ידני. זה מכוון - אל "תתקנו" את זה ל-raise.

## בדיקה לפני דחיפה

```sh
python3 scripts/check_edge_types.py       # ארבע הפונקציות
python3 scripts/check_function_grants.py  # agency_is_live פתוחה ל-anon בכוונה - היא בשימוש ב-RLS
node --check assets/crm.js
```

ומול המסד (קריאה בלבד): מי לא תקין/ה, ומה מחכה.

```sql
select id, display_name, license_number, license_status
  from agency_members
 where license_number is null or license_status in ('not_found','inactive');

select agent_id, count(*) from properties
 where license_hold_at is not null group by 1;
```

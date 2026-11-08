# חשבון בעל/ת מקצוע: כניסה וארנק, בלי רישיון תיווך

בעלי מקצוע (עו"ד, יועץ משכנתאות, שמאי...) נרשמים בכרטיסייה (`professional-signup`) ונכנסים לעריכה בקישור
עם אסימון (`professional-manage`), בלי התחברות ובלי ארנק. כדי לקנות לידים צריך ארנק, ופתיחת חשבון CRM
(`create-own-agency`, `join-agency`) דורשת מספר רישיון תיווך. לכן חשבון נפרד:
**`professional_accounts`**, כמו שליזמים יש `developers`.

## למה טבלה נפרדת ולא `agency_members`

`agency_members` הוא יחידת המנוי, החיוב והמכסה של עולם התיווך (רישיון, קוד אתי, דירוג, מדפי לידים של סוכנים,
רוטציית הפצה; `docs/new-projects.md`, "יזם אינו סוכן"). חשבון תיווך שאינו מתווך היה מקבל התראות "ביקוש פתוח"
לכל סוכן בעיר, נכנס לספירות המשרדים ורואה את מדפי הסוכנים: בדיוק מה שהעיקרון "מדף ממוקד למי שביקש"
(`docs/lead-routing.md`) אוסר. ב-#1186 המדף נבנה בטעות על `agency_members.is_lawyer`; המיגרציה
`20271108090000_professional_accounts.sql` העבירה אותו לכאן ומחקה את הדגל (0 לידים, 0 סימונים, ולכן בלי הגירה).

## הנתונים

| מה | איפה |
| --- | --- |
| החשבון | `professional_accounts`: `user_id` (auth), `card_id` (הכרטיסייה, ייחודי), `kind` (מהכרטיסייה), `city_id` (מ-`target_region`), `shelf_enabled`, `credit_balance`, `active` |
| מי רשאי/ת לראות ולקנות | `shelf_enabled` + `kind = 'real_estate_lawyer'`, **נקבע רק בידי מנהל/ת הפלטפורמה** (service_role). אין policy של כתיבה ל-`authenticated`, ולכן אין גם טריגר נעילה |
| הארנק | `credit_balance`, לפני מע"מ כמו `agency_members.credit_balance`. משתנה רק מ-service_role |
| זיכוי ידני | `professional_credit_add(account, amount, reason)` + `professional_credit_log` (עד שתהיה סליקה) |

## ההרשמה: מהכרטיסייה, עם האסימון

1. בעל/ת המקצוע נרשם/ת בכרטיסייה כרגיל וקיבל/ה את קישור העריכה.
2. ב-`professional-manage.html`, **לעורכי דין בלבד** (`advertiser_type = 'real_estate_lawyer'`), מוצג "חשבון כניסה וארנק":
   סיסמה ואישור תנאים. `load` מחזיר `has_account`.
3. `professional-account` (`verify_jwt = false`, כמו `professional-manage`): האסימון (UUID) מזהה את הכרטיסייה
   (`ad_placement_access`), **כתובת הכניסה היא ה-`contact_email` שבכרטיסייה** (לא כתובת מהגוף: טעות הקלדה
   הייתה יוצרת חשבון בלי איפוס סיסמה), נוצר משתמש + שורת חשבון עם ארנק ריק, ו-`shelf_enabled` נשאר `false`.
   נכשלה יצירת השורה: המשתמש נמחק, כדי שניסיון חוזר לא ייתקע על "הכתובת כבר רשומה".
   כתובת שכבר רשומה באתר (למשל סוכן/ת): `email_in_use`. אין חיבור של חשבון קיים לפי אסימון.
4. מנהל/ת הפלטפורמה מקבל/ת התראה (`announceProfessionalAccount`), ומאשר/ת את המדף:

```sql
update public.professional_accounts set shelf_enabled = true where id = '<id>';
-- ארנק, עד שתהיה סליקה:
select public.professional_credit_add('<id>', 100, 'טעינה ידנית');
```

5. `manage_link` (JWT): חשבון מחובר מקבל את קישור עריכת הכרטיסייה שלו (האסימון יוצא רק לפי JWT).

## אבטחה: מה נבדק, ומה נשאר החלטה

- **האסימון הוא ההרשאה, והכרטיסייה חייבת להיות של בעל מקצוע, חיה או ממתינה לאישור** (`placement_type = 'professional_card'`,
  `status` ב-`active`/`pending_approval`): אסימון של כרטיסייה שהוסרה אינו פותח ארנק.
- **העיר רק בהתאמה יחידה** לפי `target_region`: שם שמשותף לשתי ערים, או אזור שאינו עיר, משאירים `city_id` ריק
  (ההתראה למנהל/ת אומרת להשלים), כי העיר קובעת אילו לידים עו"ד רואה.
- **המייל בחשבון מסומן מאומת (`email_confirm: true`) בלי שהתיבה נבדקה.** זה אותו מצב כמו ב-`developer-signup`:
  מי שרשם כרטיסייה עם כתובת של אחר יוצר חשבון על הכתובת הזו. הנזק מוגבל (אין לחשבון מדף או ארנק עד שמנהל/ת מאשר/ת
  ומזכה), אבל הוא קיים: מי שיתחבר אחר כך לאתר עם אותה כתובת (למשל סוכן/ת עם Google) עלול להתחבר לחשבון הזה. הסגירה הנכונה
  היא קישור לקביעת סיסמה שנשלח לתיבה במקום סיסמה שבוחר מחזיק האסימון, והיא תלויה בהגדרות המייל וב-redirect של Supabase
  (אין היום מסלול "שכחתי סיסמה" בשום מקום באתר, וכפתור "שכחתי סיסמה" בדף האזור האישי לא נבדק מול הגדרות הפרויקט).
- **יומני הכסף שורדים מחיקת חשבון:** `lawyer_lead_purchases.professional_id` ו-`professional_credit_log.account_id` הם `on delete set null`.
  נבדק: מחיקת משתמש מוחקת את החשבון ומשאירה את רשומת הרכישה.
- **שגיאות נפרדות:** `not_a_lawyer` (תחום אחר) מול `shelf_not_approved` (עו"ד שעוד לא אושר).

## האזור האישי: `professional-crm.html`

כניסה (אימייל וסיסמה, איפוס סיסמה), הארנק, ומדף "שאלה לעו״ד" לעו"ד מאושר: המדף מ-`lawyer_leads_public`,
הרכישה ב-`lawyer-lead-purchase` (JWT + MFA), והלידים שנרכשו מ-`lawyer_leads` (policy לפי `sold_to_professional_id`).
דף פרטי: `noindex`, `Disallow` ב-`robots.txt` בשתי הצורות, בלי `events.js`. **המניפסט הוא הציבורי** (`/manifest.webmanifest`): `app-crm.webmanifest` נפתח על `/crm`, ואפליקציה מותקנת של עו"ד לא אמורה לנחות שם (מניפסט משלו עם `start_url` על הדף הזה הוא המשך אפשרי; `professional-manage` עדיין על `app-crm`). **המסך מסתיר מדף ללא אישור, אבל ההגנה במסד**
(`docs/lawyer-leads.md`).

## מה עוד לא כאן

- **סליקה לבעלי מקצוע.** הטעינה ידנית. הפתרון הוא סוג שישי ב-`wallet-topup-callback` (כמו `developer`, `course`),
  עם `start/complete_professional_topup` ו-`checkout.html?product=professional`. הכסף כאן הוא כסף אמיתי, ולכן ב-PR נפרד.
- **מחיקת חשבון ושמירת נתונים:** `professional_accounts` נושאת שם וטלפון. מחיקת חשבון (`account-erasure`) ו-
  `data_retention_run` צריכות לכסות אותה לפני שיהיו מספיק חשבונות.
- **יועצי משכנתאות** עדיין על `agency_members.is_mortgage_advisor` (חשבון אחד). מעבר אליהם לכאן הוא החלטה נפרדת.

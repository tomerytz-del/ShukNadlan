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
2. ב-`professional-manage.html`, **לכל תחום** (מ-10.11.2026; עד אז לעו"ד בלבד), מוצג "חשבון כניסה וארנק":
   אישור תנאים בלבד (בלי סיסמה). הנוסח לפי התחום (`ACCOUNT_PITCH`): עו"ד ויועצי משכנתאות שומעים על המדף שלהם, השאר על כניסה ועריכה בלי לשמור את הקישור.
   `load` מחזיר `has_account`, ו-`account_pending` כשההזמנה נשלחה ולא נלחצה (הטופס נשאר, עם "שליחה חוזרת").
3. `professional-account` (`verify_jwt = false`, כמו `professional-manage`): האסימון (UUID) מזהה את הכרטיסייה
   (`ad_placement_access`), **כתובת הכניסה היא ה-`contact_email` שבכרטיסייה** (לא כתובת מהגוף: טעות הקלדה
   הייתה יוצרת חשבון בלי איפוס סיסמה), נוצר משתמש **בהזמנה במייל** (`inviteUserByEmail`) + שורת חשבון עם ארנק ריק, ו-`shelf_enabled` נשאר `false`.
   הלחיצה על הקישור שבמייל מאמתת את הכתובת, ו-`professional-crm` מציג שם טופס קביעת סיסמה (ראו "אימות המייל" למטה).
   נכשלה יצירת השורה: המשתמש נמחק, כדי שניסיון חוזר לא ייתקע על "הכתובת כבר רשומה".
   כתובת שכבר רשומה באתר (למשל סוכן/ת): `email_in_use`. אין חיבור של חשבון קיים לפי אסימון.
4. מנהל/ת הפלטפורמה מקבל/ת התראה (`announceProfessionalAccount`), ומאשר/ת את המדף:

```sql
update public.professional_accounts set shelf_enabled = true where id = '<id>';
-- ארנק, עד שתהיה סליקה:
select public.professional_credit_add('<id>', 100, 'טעינה ידנית');
```

5. `manage_link` (JWT): חשבון מחובר מקבל את קישור עריכת הכרטיסייה שלו (האסימון יוצא רק לפי JWT).

## הכניסה: Google או סיסמה, כמו אצל הסוכנים (10.11.2026)

מסך הכניסה ב-`professional-crm.html` נושא כפתור "התחברות עם Google" ומתחתיו אימייל וסיסמה, באותו
ספק ואותן הגדרות של `crm.html` (`docs/google-login.md`: `prompt=select_account`, `redirectTo` הוא
הנתיב בלי query, `assets/auth-return.js` נטען לפני `supabase-js` ו-`AuthReturn.remember()` נקרא לפני
היציאה, כדי שתשובה שנחתה בדף הבית תחזור ל-`/professional-crm` ולא ל-`/crm`). שגיאה או ביטול מ-Google
מוצגים במסך הכניסה, והתשובה יורדת מהכתובת אחרי שה-session בידינו (`cleanAuthParamsFromUrl`).

**חשבון בכניסה הראשונה (`claim_by_login`, JWT).** מי שנכנס/ת ואין לו/ה שורת `professional_accounts`
אינו/ה נזרק/ת החוצה: `professional-account` מחפש/ת כרטיסייה חיה או ממתינה לאישור שה-`contact_email`
שלה הוא כתובת הכניסה **המאושרת** (Google מאשרת; סיסמה רק אחרי מייל האישור), הדף מציג "נמצאה הכרטיסייה X"
עם אישור תנאים, ובלחיצה החשבון נוצר (אותם שדות כמו במסלול האסימון, `shelf_enabled` נשאר `false`,
והתראה למנהל/ת). זה אותו עיקרון כמו "התאמת אימייל" ב-`join-agency`: הכניסה עצמה היא ההוכחה שמייל
ההזמנה במסלול הראשון בא לתת. כתובת בלי כרטיסייה: יציאה והסבר איפה נרשמים. כרטיסייה שכבר יש לה
חשבון **מאושר** של משתמש/ת אחר/ת: `card_has_account`, בלי חיבור שני; חשבון של הזמנה שלא נלחצה מפנה
את מקומו (כמו במסלול האסימון). כמה כרטיסיות באותה כתובת: בלי חשבון של אחר/ת, חיה לפני ממתינה, חדשה
לפני ישנה; גם `paused` נחשבת (בעליה לא אמור/ה להירשם שוב). כשל במסד הוא `db_error` (500) ולא "אין
כרטיסייה", והדף מבדיל: רק `no_card`, `email_not_verified` ו-`card_has_account` מוציאים; כשל זמני
משאיר מחובר/ת ומבקש רענון.

**בזמן מסך האישור ה-session אינו באחסון.** אחרי שנמצאה כרטיסייה הדף יוצא מקומית
(`signOut({ scope: 'local' })`), שומר את האסימון בזיכרון הדף, ומחזיר אותו ל-`supabase-js`
(`setSession`) רק אחרי שהחשבון נוצר. אחרת מי שסגר/ה את הלשונית בלי להחליט (או סוכן/ת שנכנס/ת לכאן
בטעות) היה/תה נשאר/ת מחובר/ת לכל האתר, ו-`/crm` היה פותח לו/ה "פתיחת משרד". קריאת שגיאת Google
וניקוי הכתובת: `AuthReturn.readError()` ו-`AuthReturn.cleanUrl()` ב-`assets/auth-return.js`, כדי לא
להחזיק עותק חמישי של רשימת המפתחות (`crm.js`, `csm-page.js` ו-`developer-crm.html` עדיין עם עותק משלהם).

**מה שלא נבדק:** כניסת Google אמיתית לחשבון שנוצר קודם בהזמנה (אותה כתובת): Supabase מצרפת את
זהות Google למשתמש הקיים לפי הכתובת, ואז `user_id` זהה והחשבון נמצא. אם במקרה כלשהו ייווצר משתמש
שני, התוצאה היא `card_has_account` והודעה לכתוב לנו, לא חשבון כפול.

## אבטחה: מה נבדק, ומה נשאר החלטה

- **האסימון הוא ההרשאה, והכרטיסייה חייבת להיות של בעל מקצוע, חיה או ממתינה לאישור** (`placement_type = 'professional_card'`,
  `status` ב-`active`/`pending_approval`): אסימון של כרטיסייה שהוסרה אינו פותח ארנק.
- **העיר רק בהתאמה יחידה** לפי `target_region`: שם שמשותף לשתי ערים, או אזור שאינו עיר, משאירים `city_id` ריק
  (ההתראה למנהל/ת אומרת להשלים), כי העיר קובעת אילו לידים עו"ד רואה.
- **אימות המייל: הזמנה במקום סיסמה בטופס.** האסימון מוחזר לטופס ההרשמה (`professional-signup`) ולא רק נשלח למייל, ולכן מי שרשם
  כרטיסייה עם כתובת של אחר מחזיק בו. לכן המשתמש נוצר ב-`auth.admin.inviteUserByEmail` (לא `createUser` עם `email_confirm: true`
  כמו ב-`developer-signup`, שם הכתובת היא של המקליד/ה), והסיסמה נקבעת רק אחרי הלחיצה על הקישור. בלי לחיצה אי אפשר להיכנס, ולכן אין ארנק ואין מדף.
  - **הנחיתה:** `redirectTo` הוא `/professional-crm`, וה-hash נושא `type=invite`. ‏`professional-crm.js` קורא אותו **לפני** שהספרייה מוחקת אותו (`inviteOpen`)
    ומציג את טופס הסיסמה (אותו כרטיס של איפוס סיסמה). ‏`otp_expired` ב-hash: הודעה שהקישור פג ושאפשר לבקש שוב. מי שסגר/ה את הדף לפני שקבע/ה סיסמה
    כבר מאומת/ת, ונכנס/ת עם "שכחתי סיסמה".
  - **הזמנה שלא נלחצה לא תופסת את הכתובת:** בקשה חוזרת מהכרטיסייה (לא לפני דקה, `resend_too_soon`) מוחקת את המשתמש שלא אושר ושולחת הזמנה חדשה.
    העיר ואישור המדף שמנהל/ת כבר קבע/ה עוברים לשורה החדשה, ואין התראה נוספת. אם ההזמנה החדשה נכשלה אחרי המחיקה (`invite_failed`), השורה הלכה: ניסיון חוזר פותח חשבון חדש.
    בטוח כי אי אפשר היה להיכנס אליו (אין יתרה, הזמנות או לידים), וה-`cascade` מוחק גם את שורת החשבון. משתמש **שאושר** לעולם לא נמחק כאן (`account_exists`).
  - **נכשלה שליחת המייל** (מגבלת המיילים של Supabase או SMTP): `invite_failed` (502), ולא נוצר חשבון.
  - **לא נבדק מול הפרויקט החי:** נוסח תבנית "Invite user" ב-Supabase (ברירת המחדל אנגלית; לערוך במסך Auth → Emails),
    ומגבלת המיילים של ה-SMTP המובנה. ‏`https://shuknadlan.co.il/*` ו-`/**` נמצאים ב-Redirect URLs.
- **יומני הכסף שורדים מחיקת חשבון:** `lawyer_lead_purchases.professional_id` ו-`professional_credit_log.account_id` הם `on delete set null`.
  נבדק: מחיקת משתמש מוחקת את החשבון ומשאירה את רשומת הרכישה.
- **שגיאות נפרדות:** `not_a_lawyer` (תחום אחר) מול `shelf_not_approved` (עו"ד שעוד לא אושר).

## האזור האישי: `professional-crm.html`

כניסה (אימייל וסיסמה, איפוס סיסמה), "עריכת הכרטיסייה" (`manage_link`), הארנק, ומדף לידים לשני תחומים (`SHELF_COPY` ב-`assets/professional-crm.js`):

| תחום | המדף | הרכישה | הלידים שנרכשו |
| --- | --- | --- | --- |
| עו"ד מאושר/ת | `lawyer_leads_public` (בעיר של החשבון) | מהארנק ב-`lawyer-lead-purchase`, או בכרטיס ב-`lawyer-lead-checkout` (JWT + MFA) | `lawyer_leads` לפי `sold_to_professional_id` |
| יועץ/ת משכנתאות מאושר/ת | `mortgage_leads_public` (ארצי, אותו מלאי כמו המגירה ב-CRM של הסוכנים) | **מהארנק בלבד**, ב-`mortgage-lead-purchase` (`resolveBuyer`: חברות CRM פעילה עם `is_mortgage_advisor` קודמת; אחרת חשבון בעל מקצוע מאושר → `purchase_mortgage_lead_professional`) | `mortgage_leads` לפי `sold_to_professional_id` (`20271110130000`) |
| שאר התחומים | אין עדיין מדף, והמסך אומר זאת | | |

**מדף המשכנתאות לחשבון בעל מקצוע (10.11.2026).** `current_is_mortgage_advisor()` מכיר שני סוגי קוראים: חברות ב-`agency_members` עם `is_mortgage_advisor`
(יועצים שנרשמו ל-CRM, `docs/mortgage-leads.md`), וחשבון בעל מקצוע `mortgage_advisor` עם `shelf_enabled`. מי שמחזיק/ה בשניהם קונה דרך ה-CRM (הסדר ב-`mortgage-lead-purchase`), והארנקים נפרדים.
`mortgage_lead_purchases.agent_id` כבר אינו `not null`; `professional_id` נוסף, ו-CHECK מבטיח קונה אחד. `lead_audience_size('mortgage_advisor')` סופר את שניהם, אחרת ליד משכנתאות היה נרשם `unrouted` כשיש יועץ/ת.
**תשלום בכרטיס על ליד משכנתאות עוד לא נבנה** (`lawyer_lead_orders` ו-`start/complete_lawyer_lead_order` הם של `lawyer_leads`); עד אז הארנק נטען ידנית (`professional_credit_add`). נבדק מקומית על Postgres 16 (סכימה מדומה, הרצה כפולה): מי רואה את המדף (מאושר/ת, CRM ומנהל/ת כן; ממתין/ה, שמאי/ת וזר/ה לא), הרכישה (תחום, אישור, יתרה, רכישה חוזרת בלי חיוב, ליד של אחר/ת), ה-policy לקונה, ו-`authenticated` שאינו קורא לפונקציות.

**שחזור קישור העריכה** (לכל תחום, בלי חשבון): `docs/professional-cards.md`, "איבדתם את הקישור?".
דף פרטי: `noindex`, `Disallow` ב-`robots.txt` בשתי הצורות, בלי `events.js`. **המניפסט הוא `app-professional.webmanifest`** (`start_url` ו-`id` על `/professional-crm`, בלי `share_target`): `app-crm.webmanifest` נפתח על `/crm`, ואפליקציה מותקנת של עו"ד לא אמורה לנחות שם. הדף נושא `data-first-visit="show"` כמו שאר דפי האזור האישי. גם `professional-manage` על אותו מניפסט (`docs/pwa-install.md`). **המסך מסתיר מדף ללא אישור, אבל ההגנה במסד**
(`docs/lawyer-leads.md`).

## מה עוד לא כאן

- **סליקה לבעלי מקצוע.** הטעינה ידנית. הפתרון הוא סוג שישי ב-`wallet-topup-callback` (כמו `developer`, `course`),
  עם `start/complete_professional_topup` ו-`checkout.html?product=professional`. הכסף כאן הוא כסף אמיתי, ולכן ב-PR נפרד.
- **מחיקת חשבון:** נבנתה (`close_professional_account`, `docs/account-closure.md`, "בעל/ת מקצוע"). **נשאר:** מדיניות שמירה לחשבון שלא היה פעיל
  (`data_retention_run`), שדורשת החלטה על משך.
- **תשלום בכרטיס על ליד משכנתאות** לחשבון בעל מקצוע (היום: ארנק בלבד). יועצים שסומנו ב-`agency_members.is_mortgage_advisor` ממשיכים לקנות מה-CRM; שני המסלולים חיים יחד.
- **מדף לשאר התחומים** (שמאי/ת, אדריכל/ית...): החשבון כבר נפתח להם, ומה שחסר הוא מלאי.

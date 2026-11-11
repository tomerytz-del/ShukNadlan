---
name: professional-leads
description: חשבונות בעלי מקצוע ומדף הלידים של עורכי הדין בריפו של שוק נדל״ן - professional_accounts, professional-crm.html, lawyer_leads / lawyer_leads_public, lawyer_lead_orders, lawyer-lead-purchase, lawyer-lead-checkout, current_is_lawyer ו-check_shelf_audience. Use when adding a lead shelf or a professional type that buys leads, when touching the lawyer shelf view or its purchase functions, when a lead is "stuck reserved" or a paid order shows refund_needed, when adding a payment kind to wallet-topup-callback, or when a professional asks why they cannot see the shelf.
---

# חשבונות בעלי מקצוע ומדף עורכי הדין

המסמכים המלאים: `docs/professional-accounts.md`, `docs/lawyer-leads.md`, `docs/lead-routing.md` ("מדפי הלידים ממוקדים"),
והנדאוף עם מה שנשאר: `docs/handoff-professional-leads-2026-11-07.md`.

## הכללים ששוברים בשקט

1. **בעל מקצוע אינו `agency_members`.** חשבון CRM דורש רישיון תיווך, ולעו"ד אין. לכן `professional_accounts` (כמו `developers`): חשבון
   נפרד שאינו מקבל התראות ביקוש, אינו נספר במשרדים ואינו רואה מדפי סוכנים. **אל תוסיפו דגל על `agency_members`** (כך נבנה #1186 ונמחק ב-#1189).
2. **המדף סגור ב-view, לא ב-JS.** `lawyer_leads_public` מחזיר שורות רק כש-`current_is_lawyer()` ורק בעיר של החשבון. שומר שהוסר נראה תקין בדפדפן
   וחושף לידים לכולם. `check_shelf_audience.py` בודק את ההגדרה **האחרונה** של כל מדף, ומדף חדש (`*_leads_public`) חייב להצהיר על קהלו.
   גם **הרכישה** אוכפת עיר ואישור, לא רק ה-view.
3. **`shelf_enabled` ו-`credit_balance` נכתבים רק מ-`service_role`.** אין policy של כתיבה ל-`authenticated`. האישור ידני (מנהל/ת הפלטפורמה).
4. **המחיר מ-`pricing_config.lawyer_lead_price`, בשרת.** הארנק לפני מע"מ (הסקיל `wallet-charges`); חיוב **בכרטיס** כולל מע"מ (₪50 ← ₪59), וב-`lawyer_lead_purchases.amount` נרשם תמיד המחיר הנקוב.
5. **פרטי הפונה נחשפים רק לקונה.** השאלה עוברת `redact_contact_text`, והפרטים חוזרים רק מ-`purchase_lawyer_lead` (service_role) או מ-policy שמוגבלת ל-`sold_to_professional_id`.

## חיוב ישיר בכרטיס: הסחורה יחידה

הזמנה (`lawyer_lead_orders`) **שומרת את הליד 15 דקות** (`reserved_until`); אחרים לא פותחים הזמנה ולא קונים מהארנק. כללים:

* **שולם והליד כבר אינו זמין = `refund_needed` + התראה למנהלי הפלטפורמה, לעולם לא הצלחה שקטה ולא מכירה כפולה.** גם אי-התאמת סכום אחרי גבייה היא
  `refund_needed`, לא `failed` (הכסף כבר נגבה). `refund_alerted_at` נקבע רק כשההתראה נכתבה, וה-reconcile שולח שוב עד שיצאה. ההחזר ידני במורנינג, ואז `refunded`.
* **הזמנה פתוחה בתוך 180 דקות נמשכת מחדש** (אותה שורה ואותו טופס) ומחדשת את השמירה. הזמנה שנייה על אותו ליד = שני תשלומים שרק אחד מהם ניתן להתאמה.
* **רכישה מהארנק אינה סוגרת הזמנת כרטיס פתוחה**: התשלום אולי כבר בדרך, ושורה `failed` הייתה מאבדת אותו.
* **הפונקציה `lawyer-lead-checkout` אינה סוגרת תשלום.** הסגירה רק ב-`wallet-topup-callback` אחרי אימות מול מורנינג. החזרה לדף עם `?lead_payment=success`
  אינה הוכחה: הדף שואל את השרת (`action: 'status'`), ופרטי הפונה מוחזרים רק מ-`success`.
* **סוג תשלום חדש ב-`wallet-topup-callback`** נכנס לשלושה מקומות באותו PR: `KINDS`/`ALL_KINDS`, תנאי ה-cron של `wallet-topup-reconcile` (מיגרציה שמגדירה אותו מחדש),
  ו-`docs/wallet-payments.md`. בלי התנאי, הזמנה שה-webhook שלה אבד מחכה לנצח.

## הקליטה: ליד נכנס pending ועולה למדף רק אחרי אימות

* **כרטיס המדף אומר "טלפון מאומת בוואטסאפ".** ליד שעולה למדף בלי אימות נמכר ב-₪59 עם מספר שאולי אינו של מי ששאל. הליד נכנס `pending`
  (`lawyer_lead_submit`), ועולה `new` רק ב-`lawyer_lead_wa_verify`.
* **המספר שממנו נשלחה ההודעה הוא ההוכחה** (`phone_e164 = from` של Meta), לא הקוד: שש ספרות יכולות לחזור אצל שני פונים. אותו עיקרון כמו
  `agreement-signing`, והקריאה ב-`whatsapp-webhook` נשארת **לפני זיהוי הסוכן/ת**, אחרת הפונה מקבל/ת "איני מזהה את מספר הטלפון שלך".
* **ההתראה לסוכן/ת הנכס אינה נושאת שם, טלפון, מייל או שאלה** (המוצר שנמכר), ומשתמשת בסוג `system` עם `related_property_id`. סוג חדש יוצא לכל
  הסוכנים בוואטסאפ (הסקיל `agent-notifications`).
* **ליד שאין לו עו"ד בעיר נרשם `unrouted`** ב-`lead_routing_log`, אחרת הוא יושב במדף שאיש אינו רואה. ערך `lead_kind`/`lead_table` חדש נכנס ל-CHECK, ל-`lead_audience_size` ולתווית ב-`alert_platform_admin_on_unrouted_lead`.
* **עמודה מחושבת (`phone_e164`) אינה נכתבת ב-`data_retention_run`**: `phone = ''` מחשב אותה מחדש. `question` מוחלפת בטקסט ולא ב-null (CHECK של 10 תווים).
* **פונקציית קליטה ציבורית חדשה** = `verify_jwt = false` ב-`config.toml`, שורה ב-`PUBLIC_EDGE_FUNCTIONS` ב-`ops_agent/config.py`, ובלם הצפה במסד.
* **קישור `wa.me` בדף נושא `data-site-contact`**, אחרת `events.js` סופר כל לחיצה כפנייה למתווך (`contact_agent`).

## מחיקת חשבון: השורה נשארת, ו-Auth נמחק אחרי שהיא מנותקת ממנו

* **`professional_accounts.user_id` הוא `on delete cascade`.** מחיקת משתמש ב-Auth בלי לאפס אותו קודם מוחקת בשקט את החשבון והארנק, והחיובים נותקים.
  `close_professional_account` מאפסת `user_id` (nullable) **לפני** שהפונקציה מוחקת את המשתמש, והשורה נשארת מאונונמת כי חיובים ויומן זיכויים מפנים אליה.
* **`close-account` חייב להכיר כל סוג חשבון.** סוג שאינו מוכר נחשב "none" ומוחק את המשתמש ב-Auth בלבד. סוג חשבון חדש נכנס ל-`close-account` וגם ל-`otherLiveProfile` ב-`_shared/account-erasure.ts`.
* **הזמנת תשלום פתוחה חוסמת מחיקה** (`payment_pending`), והיתרה מאופסת ביומן ומתריעה למנהל/ת (אין "יתרה שנטענה בתשלום" לבעל מקצוע).

## פתיחת חשבון: לכל תחום, והמייל מאומת בהזמנה, לא נוצר מאושר

* **החשבון נפתח לכל תחום** (מ-10.11.2026), לא רק לעו"ד: תיבת "חשבון כניסה וארנק" ב-`professional-manage.html` מוצגת לכל כרטיסייה, והנוסח לפי התחום (`ACCOUNT_PITCH`).
  מדף יש לשניים: עו"ד (`lawyer_leads_public`) ויועץ/ת משכנתאות (`mortgage_leads_public`, רכישה מהארנק בלבד דרך `mortgage-lead-purchase` → `purchase_mortgage_lead_professional`;
  `current_is_mortgage_advisor()` מכיר גם חשבון בעל מקצוע מאושר). תחום חדש עם מדף נכנס ל-`SHELF_COPY` ב-`assets/professional-crm.js`, ל-`announceProfessionalAccount` (`needsShelf`), ול-`lead_audience_size`.
* **כניסה עם Google כמו אצל הסוכנים** (`googleLoginBtn` ב-`professional-crm`, `select_account`, `auth-return.js` לפני `supabase-js`), ובכניסה ראשונה בלי חשבון
  `claim_by_login` (JWT) פותח חשבון לפי הכרטיסייה שה-`contact_email` שלה הוא כתובת הכניסה **המאושרת**, בצעד אחד (השורה "בכניסה אתם מאשרים את תנאי השימוש" במסך היא האישור; אין מסך ביניים). הכתובת מה-JWT, לא מהגוף; `shelf_enabled` לא נקבע שם.
  מי שאין לו/ה כרטיסייה יוצא/ת מיד (`no_card`), כשל זמני אינו "אין כרטיסייה". השער (`.gate`) נושא תמיד: שכחתי סיסמה, קישור העריכה שאבד, ותמיכה בוואטסאפ עם `data-site-contact`.
* **קישור העריכה שאבד משוחזר למייל שבכרטיסייה, לא בתשובה לדפדפן** (`professional-manage` ‏`action: 'recover_link'`, ‏`_shared/professional-link-mail.ts`, בלם עשר דקות ב-`ad_placement_access.link_sent_at`).
  הרשמה חוזרת לאותו מייל עם כרטיסייה `active`/`pending_approval` היא `card_exists` ושליחת הקישור, לא כרטיסייה שנייה. מנהל/ת הפלטפורמה מעתיק/ה את הקישור מהפאנל (`admin_professional_card_manage_link`).
* **`professional-account` יוצר משתמש ב-`inviteUserByEmail`, לא ב-`createUser` עם `email_confirm: true`.** האסימון מוחזר לטופס ההרשמה, ולכן מחזיק/ה בו
  מי שהגיש/ה את הכרטיסייה, גם עם כתובת של אחר. הסיסמה נקבעת בנחיתה מהקישור (`inviteOpen` ב-`assets/professional-crm.js`, נקרא לפני שה-hash נמחק).
* **משתמש שלא אישר נמחק בבקשה חוזרת** (לא לפני דקה), ו**אף פעם לא משתמש שאישר**: לפני שמוסיפים מחיקה כזו מוודאים שאי אפשר היה להיכנס אליו (אין יתרה או הזמנות).
  ‏`has_account` ב-`professional-manage` אינו נכון לחשבון שלא אושר, ולכן יש `account_pending`.

## מוסיפים קהל חדש (שמאי, אדריכל...)

* `kind` כבר ב-`professional_accounts.kind`, והחשבון כבר נפתח לו. מדף משלו = view משלו עם שומר `current_is_<kind>()`, שורה ב-`PROFESSIONAL_SHELVES` ב-`check_shelf_audience.py`,
  ובדיקה ב-`scripts/lawyer_shelf_test.mjs` (או קובץ מקביל).
* ליד של קהל אחד **לעולם אינו מוצג** למתווכים ולקהלים אחרים, ולהפך.
* לפני ששורה ראשונה נכנסת: `data_retention_run` מכסה את הטבלה (שם, טלפון, מייל, שאלה), ורישום ב-`lead_routing_log`.

## לפני דחיפה

```sh
node --test scripts/lawyer_shelf_test.mjs
python scripts/check_shelf_audience.py
python scripts/check_function_grants.py
python scripts/check_table_grants.py
```

מיגרציה שנוגעת בכסף נבדקת על Postgres מקומי (סכימה מדומה, הרצה כפולה, כל תפקיד עם `set local role` ו-`request.jwt.claim.sub`): כך נתפסו ה-view, ה-RLS והחיוב.

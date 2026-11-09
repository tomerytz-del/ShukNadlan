# הנדאוף: חשבונות בעלי מקצוע, מדף עורכי הדין וחיוב על לידים (7.11.2026)

מסמך להמשך עבודה בשיחה חדשה. הוא כתוב כך שאפשר להתחיל ממנו בלי לקרוא את השיחה הקודמת. **מה שלא כתוב כאן
כ"נבדק" לא נבדק.**

## 1. המצב עכשיו

| מה | סטטוס |
| --- | --- |
| שאלון "איזו שכונה מתאימה לי" + אירועי GA4 | מוזג (#1181, #1183). **חסר ממך:** ייבוא `docs/gtm-hood-quiz-import.json` ב-GTM (Merge), פרסום גרסה וייצוא מחדש ל-`gtm/container.json` |
| מדף המשכנתאות סגור ליועצי משכנתאות במסד + `check_shelf_audience.py` | מוזג ורץ בפרודקשן (#1183) |
| ארבעה דפי הצטרפות (`/join-*`) מתבנית אחת | מוזג (#1184), `docs/join-pages.md` |
| תשתית מדף עורכי הדין (על `agency_members.is_lawyer`) | מוזג (#1186) ורץ בפרודקשן, **ואז הוחלף** ב-#1189 |
| חשבון בעל מקצוע (`professional_accounts`) + `professional-crm.html` | מוזג (#1189), המיגרציה `20271108090000` בפרודקשן (נבדק 8.11.2026) |
| חיוב ישיר בכרטיס על ליד עו"ד (`lawyer_lead_orders`, `lawyer-lead-checkout`, סוג שישי ב-`wallet-topup-callback`) | מוזג (#1193). **סליקה אמיתית מול מורנינג טרם נבדקה**, ראו `docs/lawyer-leads.md` |

**אלדד סורק** (עו"ד, כרטיסייה `b2a917d1-6746-4620-ad6d-c96d9cd31edf`, `real_estate_lawyer`, `active`, אזור "עפולה", נרשם 27.9.2026):
אין לו חשבון כניסה ואין לו `agency_members`. אחרי מיזוג #1189 הוא פותח חשבון מקישור העריכה האישי שלו (`professional-manage?token=...`,
תיבת "חשבון כניסה וארנק"), ואז מנהל/ת הפלטפורמה מאשר/ת:

```sql
update public.professional_accounts set shelf_enabled = true where card_id = 'b2a917d1-6746-4620-ad6d-c96d9cd31edf';
select public.professional_credit_add((select id from public.professional_accounts where card_id = 'b2a917d1-6746-4620-ad6d-c96d9cd31edf'), 100, 'טעינה ידנית');
```

## 2. החלטות שכבר התקבלו (לא לפתוח מחדש בלי סיבה)

1. **מדפי לידים ממוקדים למי שביקש.** ליד של עו"ד לא מוצג למתווכים ולא ליועצי משכנתאות, ולהפך. הסינון ב-**view במסד**, לא ב-JS.
   `scripts/check_shelf_audience.py` חוסם מדף חדש שלא מצהיר על קהל. (`docs/lead-routing.md`, "מדפי הלידים ממוקדים")
2. **בעלי מקצוע = טבלה נפרדת (`professional_accounts`), לא `agency_members`**, כמו `developers`. הסיבה: חשבון תיווך שאינו מתווך
   היה מקבל התראות ביקוש פתוח, נספר במשרדים ורואה מדפי סוכנים. פתיחת חשבון CRM דורשת מספר רישיון תיווך, שלעו"ד אין.
3. **הרשמה מהכרטיסייה, באסימון.** ‏`professional-account` (מ-`professional-manage.html`, לעורכי דין בלבד).
4. **אישור המדף ידני** (`shelf_enabled`, service_role בלבד). **המחיר ₪50 לפני מע"מ** (`pricing_config.lawyer_lead_price`).
5. **הארנק לפני מע"מ** (הסקיל `wallet-charges`), אבל חיוב **ישיר בכרטיס** כולל מע"מ (כמו כרטיסיית בעל מקצוע: `amount_before_vat`, `vat_rate`, `amount`).
6. **אין מחירים ואין "פרסום חינם" בדפי ההצטרפות** (עוד מקום לעדכן כשההטבה נגמרת).

## 3. הוחלט (8.11.2026): חיוב ישיר בכרטיס על כל ליד. נבנה ב-#1193

> **סטטוס:** נבנה ומוזג. המימוש, ההחלטות שנלוו אליו (שמירת הליד ל-15 דקות, `refund_needed`, משיכת הזמנה פתוחה) ומה שנבדק מפורטים ב-`docs/lawyer-leads.md`, "חיוב ישיר בכרטיס". מה שמתחת נשאר כהקשר להחלטה; הרשימה "מה לבנות" כבר בוצעה.

### ההקשר המקורי: ארנק, או חיוב ישיר על כל ליד?

**למה בעלי מקצוע לא יכולים לטעון ארנק היום?** לא בגלל חסם טכני אלא כי זה לא נבנה. צינור הטעינה
(`start_wallet_topup` / `complete_wallet_topup` / `wallet-topup` / `wallet-topup-callback`) קשור ל-`agency_members.credit_balance`.
לחשבון בעל מקצוע יש ארנק (`professional_accounts.credit_balance`) אבל רק זיכוי ידני (`professional_credit_add`). הושאר ל-PR נפרד כי זה כסף אמיתי.
יש תקדים: `developers` (`start/complete_developer_topup`, סוג נוסף ב-`wallet-topup-callback`).

**אפשר חיוב ישיר וחד-פעמי על כל ליד, בלי ארנק? כן, ויש לזה תקדים בקוד:** כרטיסיית בעל מקצוע (`ad_orders`) היא בדיוק זה: הזמנה, טופס תשלום
של מורנינג (`createPaymentForm`), `wallet-topup-callback` שמאמת מול ה-API של מורנינג, ואז `complete_ad_order`. אין שם ארנק, ואין JWT.

| | חיוב ישיר לכל ליד | ארנק |
| --- | --- | --- |
| מתאים ל | קונה מזדמן (עו"ד שקונה כמה לידים בחודש) | קונה קבוע ובנפח |
| כסף שמוחזק אצלנו | אין (אין התחייבות להחזר יתרה, `request_wallet_refund`) | יש |
| עמלת סליקה | על כל ₪59: עמלה קבועה + אחוז, וחשבונית לכל ליד | על הטעינה |
| חיכוך | מעבר לדף תשלום בכל רכישה | חד-פעמי |
| מורכבות | הזמנה, **שמירת הליד (reservation)**, ניקוי, החזר אם הליד נמכר בינתיים | טעינה + ניהול יתרה |

**המלצה (אומצה):** חיוב ישיר לכל ליד לעורכי דין (פשוט משפטית, בלי כסף מוחזק, מתאים לנפח הנמוך), והארנק רק אם יתברר שיש נפח. שניהם יכולים לחיות יחד:
`purchase_lawyer_lead` מקבלת היום חשבון, ואפשר להוסיף לה מקור תשלום. **להחליט עם תומר לפני שמתחילים.**

### מה היה לבנות (בוצע ב-#1193)

1. **טבלה `lawyer_lead_orders`:** `lead_id`, `professional_id`, `amount_before_vat` (50), `vat_rate` (מ-`pricing_config.vat_rate`), `amount`, `status`
   (`pending` · `paid` · `failed` · `expired` · `refund_needed`), `provider_form_id`, `provider_payment_url`, `reserved_until`.
2. **שמירת הליד:** פתיחת הזמנה מסמנת את הליד "שמור ל-15 דקות" (עמודה/סטטוס חדש) כך ששני עורכי דין לא משלמים על אותו ליד. הליד לא יורד מהמדף של האחרים באופן מבלבל
   (מסומן "בטיפול") וחוזר כשההזמנה פגה. **זו הנקודה הקשה.**
3. **פונקציית Edge `lawyer-lead-checkout`** (JWT + MFA, כמו `lawyer-lead-purchase`): `start_lawyer_lead_order` ואז `createPaymentForm` (אותו דפוס כמו `professional-signup`,
   ‏`successUrl`/`failureUrl` עם `order_id` בלבד, **בלי אסימון בכתובות**).
4. **סוג נוסף ב-`wallet-topup-callback`** (כמו `course`, הסוג החמישי): אימות מול מורנינג, השוואת סכום, ואז `complete_lawyer_lead_order` שמוכרת את הליד (אותה לוגיקה של `purchase_lawyer_lead`, בלי ניכוי יתרה) ורושמת ב-`lawyer_lead_purchases` עם `payment_method = 'card'`.
5. **reconcile** (אותו `?mode=reconcile` של ה-cron): הזמנה תקועה נשאלת מול מורנינג. **תשלום שהתקבל אחרי שהשמירה פגה והליד נמכר לאחר/ת = `refund_needed` והתראה למנהל/ת**, לא "הצלחה" שקטה.
6. **הדף `professional-crm.html`:** כפתור "רכישה" פותח הזמנה ומפנה לתשלום; חזרה עם `order_id` שואלת את הסטטוס (כמו `professional-signup?payment=success`) ומציגה את הפרטים רק אחרי `paid`.
7. **חשבונית:** מורנינג מפיקה אותה מהמסמך (`readDocumentShape`); פרטי הלקוח (שם, עסק, ח.פ) כמו ב-`checkout.html`.

קבצים לקרוא קודם: `supabase/functions/professional-signup/index.ts` (הזרימה), `supabase/functions/wallet-topup-callback/index.ts`, `supabase/functions/_shared/morning.ts`,
`supabase/migrations/20261024090000_professional_card_payments.sql` (`start_ad_order`/`complete_ad_order`), `docs/wallet-payments.md`, הסקיל `wallet-charges`.

## 4. משימות להמשך, לפי סדר

1. ~~למזג #1189~~ **בוצע** (מיגרציה מאומתת בפרודקשן).
2. **להכניס את אלדד** (סעיף 1): הוא פותח חשבון מהקישור האישי, ואז מאשרים לו את המדף. עם חיוב ישיר אין חובה לטעון ארנק.
3. ~~החלטה: ארנק או חיוב ישיר~~ **בוצע** (#1193). נשאר: **תשלום ראשון אמיתי אחד** בפרודקשן, כדי לאמת את הטופס, ה-webhook והחשבונית.
4. ~~**קליטה: "שאלה לעו״ד" בדף הנכס**~~ **בוצעה** (ראו `docs/lawyer-leads.md`, "הקליטה"). הפירוט המקורי נשאר כהקשר (בנוי עם `agreement-wa-verify.ts` כמודל):
   - טופס בשני שלבים (קודם השאלה, אחר כך שם וטלפון, עם שורת הגילוי "הפרטים יועברו ליועץ/ת הנכס ולעו״ד בלבד"), בדף הנכס ולא בכרטיס.
   - ליד נכנס `pending`, **אימות טלפון בהודעה נכנסת בוואטסאפ** (הודעה שהפונה שולח/ת אלינו, לא קוד יוצא) והוא עולה למדף (`new`) רק אחרי האימות. **כרטיס המדף כבר אומר "טלפון מאומת בוואטסאפ"**, והקליטה חייבת לעמוד בזה.
   - `city_id` מהנכס, `property_id`.
   - **התראה לסוכן/ת של הנכס** שהלקוח/ה ביקש/ה ייעוץ משפטי (הסקיל `agent-notifications`: `related_property_id`, סוג התראה דרך `notification_types_add`). **המתווך לא נעקף.**
   - **`data_retention_run`** חייבת לכסות את `lawyer_leads` (שם, טלפון, מייל, שאלה) **לפני** ששורה ראשונה נכנסת (`docs/data-retention.md`; מלכודת: `check_data_retention_generated.py`).
   - **`lead_routing_log`** (`lead_kind` חדש): ליד בעיר בלי עו"ד מאושר צריך להפוך להתראה למנהל/ת.
   - הדיסקליימרים בעברית: "הגשת שאלה אינה יוצרת יחסי עו״ד-לקוח", "אל תשלחו סיסמאות, פרטי תשלום או מסמכי זהות".
   - נקודת הקליטה היא פונקציה ציבורית חדשה: `PUBLIC_EDGE_FUNCTIONS` ב-`ops_agent/config.py`, והגבלת קצב.
5. **אימות המייל בחשבון בעל המקצוע** - נבנה: הזמנה במייל (`inviteUserByEmail`) וקביעת סיסמה אחרי הלחיצה, ראו `docs/professional-accounts.md`. נשאר לבדוק עם תיבה אמיתית (נוסח התבנית ב-Supabase).
6. **מחיקת חשבון ושמירת נתונים** ל-`professional_accounts` (`account-erasure`, `data_retention_run`).
7. **מניפסט משלו** ל-`professional-crm` (`start_url` על הדף; היום המניפסט הציבורי).
8. **"אודות" עם פנים ושמות:** ממתין לשמות, תפקיד של שורה אחת ותמונה לכל אחד (אין בריפו נתוני צוות, ולא ממציאים). **סרטון דמו** לדפי ההצטרפות: הסקיל `marketing-video-production`, תסריט לאישור קודם.
9. **מהרשימה הישנה:** תרגום תיאור הנכס, דוח שוק רבעוני, סיורי coach-mark (פעם אחת למכשיר, עם דילוג, נמדד, לא בדף הבית).
10. **תזכורות:** בדיקה חוזרת ב-Google AI Mode (2-3 שבועות); מדרגות מס רכישה ב-16.1.2028 (`assets/purchase-costs.js` בלבד).

## 5. איך עובדים בריפו הזה (מה שעלה כסף)

- **כל משימה מתחילה מהסקיל** (`CLAUDE.md`): `new-migration`, `wallet-charges`, `new-edge-function`, `new-page`, `professionals-pages`, `agent-notifications`, `pricing-change`.
- **PR שנוגע באתר או ב-`supabase/` עובר `/code-review` ברמה high לפני בקשת מיזוג.** כל סבב מצא דברים אמיתיים (חור בדף שפתח את כל הסוכנים מחוץ ל-CRM בחלון שבין הפריסה למיגרציה, חשבון שמחבר מייל לא מאומת, יומני כסף שנמחקים עם החשבון).
- **לא ממזגים בלי "תמזג" מתומר.** אחרי מיזוג: מנוי ובדיקת ביטחון מתבטלים, ובודקים ב-Actions שהמיגרציה ירוקה ואז מול המסד (`execute_sql` לקריאה בלבד; **אסור DDL מחוץ לצינור**).
- **"Require branches to be up to date":** `main` מתקדם בין PR-ים, ו-405 "required status checks are expected" פירושו "מזגו main לענף". **ענף שכבר מוזג בסקווש:** `git fetch && git checkout -B <ענף> origin/main`, ודחיפה עם `--force-with-lease`.
- **גרסת מיגרציה חייבת להיות גדולה מהאחרונה ב-`main`** (`check_migration_versions.py`); פונקציה שמוחלפת: להשוות `md5(prosrc)` מול פרודקשן לפני שמעתיקים (כך נעשה עם `protect_sensitive_agency_member_fields`).
- **הדף לא נטען מ-`main` באתר החי עד המיזוג:** האתר עולה דקות לפני המיגרציה, ולכן עמודה חדשה **לא** נכנסת ל-`AGENT_FIELDS` ב-`crm.js` (היא נכנסת לסל הסובלני).
- **טקסט מוצג:** בלי מקף ארוך (`check_long_dash.py`), "יועצי נדל״ן" ולא "מתווכים" (`check_yoetz_copy.py`, כולל הערות ב-`crm.js`).
- **הרצה לפני דחיפה:** כל `scripts/check_*.py` (חוץ מ-`check_edge_types.py`, שדורש `deno` שאין בסשן הענן ורץ ב-CI), `node --test scripts/lawyer_shelf_test.mjs`, `python scripts/build_join_pages.py --check`.

## 6. איך אימתתי (ומה לא)

- **מיגרציות SQL: Postgres 16 מקומי.** הבינארים ב-`/usr/lib/postgresql/16/bin`, ורצים כמשתמש שאינו root (`useradd pgu`, `su pgu -c ...`). בונים סכימה מדומה (`auth.uid()` מ-`request.jwt.claim.sub`, התפקידים `anon`/`authenticated`/`service_role`,
  `agency_members`, `agencies`, `cities` עם `market_slug`, `properties`, `ad_placements`, `auth.users`, `pricing_config` ופונקציות העזר `normalize_msisdn`, `rss_set_updated_at`, `current_agent_id`, `current_is_platform_admin`, `agent_works_city`, `redact_contact_text`),
  מריצים את המיגרציה (ושוב, לאידמפוטנטיות), ובודקים כל תפקיד עם `set local role authenticated` + `set_config('request.jwt.claim.sub', ...)`. `pip install pglast` מאמת תחביר. **אין לדלג על זה:** כך נתפסו ה-view, ה-RLS והחיוב.
- **דף: Playwright עם מוק.** `window.supabase` מוחלף ב-`addInitScript`, בקשות CDN/פונט/GTM נחסמות, ופונקציית ה-Edge מדומה ב-`page.route`. אין גישה ל-CDN בסשן ענן.
- **לא נבדק:** יצירת משתמש אמיתי ב-Supabase (`auth.admin.createUser`), מייל איפוס סיסמה, סליקה אמיתית מול מורנינג, וטעינת ה-CRM אחרי הפריסה.

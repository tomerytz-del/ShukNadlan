# מדף הלידים של עורכי הדין

"שאלה לעו״ד" מדף נכס, כמדף לידים: גולש/ת משאיר/ה שאלה וטלפון, הליד מוצג לעורכי הדין **בעיר
של הנכס** בלי פרטי קשר, ומי שרוכש/ת (₪50 מהארנק) רואה אותם. אותו מוצר כמו לידי המשכנתאות
(`docs/mortgage-leads.md`), על קהל אחר.

> **מצב נוכחי:** התשתית, חשבון בעל המקצוע (`docs/professional-accounts.md`) והחיוב הישיר בכרטיס. **אין עדיין נקודת
> קליטה**: הטופס בדף הנכס, אימות הטלפון בוואטסאפ וההתראה לסוכן/ת באים ב-PR נפרד, והטבלה ריקה עד אז.
> המדף נבנה ב-#1186 על `agency_members.is_lawyer`, והועבר ל-`professional_accounts` כי לעו"ד אין רישיון תיווך ולכן אין חשבון CRM.

## העיקרון: ממוקד למי שביקש

ליד של עורך/ת דין לא מוצג למתווכים ולא ליועצי משכנתאות, ולהפך (`docs/lead-routing.md`, "מדפי
הלידים ממוקדים"). ההפרדה **ב-view עצמו**, לא ב-JS:

- `lawyer_leads_public` מחזיר שורות רק כש-`current_is_lawyer()`: חשבון עו"ד פעיל עם `shelf_enabled` שמנהל/ת הפלטפורמה אישר/ה, או מנהל/ת פלטפורמה (לצפייה).
- וגם רק לליד **בעיר שהעו"ד עובד/ת בה** (`current_professional_works_city`: העיר של החשבון, או אותו שוק לפי `cities.market_slug`),
  או ליד בלי עיר, או מנהל/ת פלטפורמה.
- **גם הרכישה אוכפת את העיר** (`purchase_lawyer_lead` מחזירה `lead_not_available`): מי שהגיע/ה למזהה של ליד מעיר אחרת (קישור שהועבר, התראה) לא קונה אותו.
- רק `status = 'new'`. ליד שנמכר יורד מהמדף, ומי שרכש/ה קורא/ת אותו מהטבלה (policy לפי `sold_to_professional_id`).
- **השאלה עוברת `redact_contact_text`**: שם משתמש ברשת, קישור, טלפון, מייל ושם הפונה מוסתרים,
  אחרת עו"ד היה פונה לפונה בלי לרכוש.
- `check_shelf_audience.py` (ו-`lawyer_leads_public` ב-`PROFESSIONAL_SHELVES`) חוסם ב-CI מדף שהשומר שלו הוסר.

## החלקים

| מה | איפה |
| --- | --- |
| החשבון והארנק | `professional_accounts` (`docs/professional-accounts.md`) |
| הלידים | `lawyer_leads` (`status`: `pending` לפני אימות · `new` במדף · `sold` · `archived`), ליד פתוח אחד לכל טלפון, `sold_to_professional_id` |
| הרכישות | `lawyer_lead_purchases`, `unique(lead_id)`, `professional_id` |
| המדף | `lawyer_leads_public` |
| הרכישה | `purchase_lawyer_lead(lead, account)` (service_role בלבד) דרך `lawyer-lead-purchase` (JWT + MFA) |
| המחיר | `pricing_config.lawyer_lead_price` (50). הארנק לפני מע"מ: הרכישה מורידה את המחיר הנקוב |
| הממשק | `professional-crm.html` + `assets/professional-crm.js` |
| הבדיקות | `scripts/lawyer_shelf_test.mjs` (workflow `lawyer_shelf.yml`), `check_shelf_audience.py` |

נבדק מקומית על Postgres 16 (סכימה מדומה, כולל הרצה חוזרת): עו"ד בעיר א' רואה את הלידים של שוק א' ושל "בלי עיר", עו"ד בשוק ב' את של ב', עו"ד שלא אושר, שמאי, מתווך ויועץ משכנתאות 0, מנהל/ת פלטפורמה את כולם, ו-`anon` נדחה;
רכישה: מי שלא אושר או שאינו עו"ד, ליד שלא אומת, עיר אחרת, יתרה חסרה, רכישה חוזרת (בלי חיוב נוסף) ועו"ד אחר (נדחים); `authenticated` אינו קורא ל-`purchase_lawyer_lead` ול-`professional_credit_add`.

## חיוב ישיר בכרטיס (בלי ארנק)

עו"ד קונה מזדמן, ולכן ליד נרכש גם **בתשלום חד-פעמי בכרטיס** (₪50 + מע"מ = ₪59), באותה מכונת מצבים של כרטיסיית בעל מקצוע
(`ad_orders`): הזמנה `pending`, טופס תשלום של מורנינג, אימות חוזר מול ה-API שלהם ב-`wallet-topup-callback`
(הסוג השישי, `lawyer_lead` ← `lawyer_lead_orders`), ורק אז `complete_lawyer_lead_order` מוכרת את הליד. הארנק נשאר, ושני המסלולים
מוכרים דרך אותה שורה ב-`lawyer_lead_purchases` (`payment_method = 'card'` או `'balance'`; בכרטיס נרשם המחיר הנקוב, `order_id` מצביע להזמנה).

| מה | איפה |
| --- | --- |
| ההזמנות | `lawyer_lead_orders` (`pending` · `success` · `failed` · `refund_needed` · `refunded`), נקראת רק ע"י הבעלים ומנהל/ת |
| פתיחה ושמירה | `start_lawyer_lead_order(lead, account)` דרך `lawyer-lead-checkout` `action: 'start'` (JWT + MFA), מחזירה `redirect_url` |
| החזרה מהתשלום | `action: 'status'`: פרטי הפונה רק כשההזמנה `success`, ודרך `purchase_lawyer_lead` ("כבר שלך", בלי חיוב נוסף) |
| הסגירה | `complete_lawyer_lead_order`, **רק** מ-`wallet-topup-callback`; `fail_lawyer_lead_order` משחררת את השמירה |

**שמירת הליד.** ליד הוא סחורה יחידה: פתיחת הזמנה שומרת אותו ל-15 דקות (`lawyer_leads.reserved_by_professional_id` / `reserved_until`).
בזמן הזה עו"ד אחר/ת לא פותח/ת הזמנה, וגם הרכישה מהארנק נדחית (`lead_reserved`); במדף הליד נשאר, עם `reserved_by_other` והכפתור "בטיפול".
לחיצה כפולה, חזרה מדף התשלום או לשונית שנשארה פתוחה מעבר ל-15 הדקות מחזירה את **אותה הזמנה ואותו טופס** (כל עוד היא `pending` בתוך 180 דקות, כמו חלון ה-reconcile) ומחדשת את השמירה; הזמנה שנייה על אותו ליד הייתה מאפשרת שני תשלומים. אם הבקשה הראשונה עוד יוצרת את הטופס, השנייה מקבלת `order_in_progress`. **עד שלוש שמירות פתוחות לחשבון**, כדי שמי שפותח/ת הזמנות ולא משלם/ת לא יתפוס/תתפוס את המדף.

**תשלום שהגיע והליד כבר אינו זמין.** חלון התשלום של מורנינג ארוך מ-15 דקות, ולכן ייתכן שהשמירה פגה והליד נמכר לאחר/ת (או נקנה מהארנק).
הכסף כבר נגבה, ולכן `complete_lawyer_lead_order` **לא** מחזירה הצלחה ולא מוכרת פעמיים: ההזמנה עוברת ל-`refund_needed` עם סיבה
(`lead_sold_to_other`, `already_owned`, `lead_reserved_by_other`, `lead_not_available`, `lead_deleted`, `account_deleted`), ומנהלי הפלטפורמה מקבלים התראה
(`announceLawyerLeadRefundNeeded`, בלי פרטי הפונה) עם הסכום, מזהה ההזמנה והמסמך במורנינג. **אותו דבר כשהסכום שמורנינג דיווחה שונה מהרשום** (`amount_mismatch`):
הכסף נגבה, ולכן זה לא `failed` שקט כמו בשאר הסוגים. ההתראה נרשמת ב-`refund_alerted_at` רק כשנכתבה, וה-reconcile שולח שוב כל `refund_needed` שלא הותרע (גם אם הפונקציה נפלה אחרי המסד). **ההחזר ידני במורנינג**, ואז מסמנים `refunded`:

```sql
update public.lawyer_lead_orders set status = 'refunded' where id = '<order_id>' and status = 'refund_needed';
```

רכישה מהארנק **אינה סוגרת** הזמנת כרטיס פתוחה של אותו/ה עו"ד על אותו ליד: ייתכן שהתשלום כבר בדרך, ושורה `failed` הייתה מאבדת אותו.
אם יגיע, זה `refund_needed` (`already_owned`); אם לא, ה-reconcile סוגר אחרי חלון התשלום.

**נבדק מקומית על Postgres 16** (סכימה מדומה, כולל הרצה חוזרת): פתיחה ושמירה, הזמנה חוזרת (אותה שורה), עו"ד אחר נדחה (`lead_reserved`) גם בארנק, עיר אחרת וליד שלא אומת נדחים,
ה-view מסמן `reserved_by_other` נכון לכל קורא/ת, `authenticated` אינו קורא ל-start/complete, אי-התאמת סכום נותנת `refund_needed` ומשחררת את השמירה, הזמנה שהשמירה שלה פגה נמשכת מחדש (אותה שורה), השלמה מוכרת פעם אחת בלבד (חוזרת בלי כפילות),
השלמה אחרי מכירה לאחר/ת נותנת `refund_needed` בלי רכישה כפולה, `fail` משחררת רק שמירה של מי שנכשל, והחסם על שלוש שמירות. **לא נבדק:** סליקה אמיתית מול מורנינג
(טופס, webhook, חשבונית), ושליחת ההתראה למנהל/ת.

## מה עוד לא כאן (ה-PR הבא)

1. **טופס "שאלה לעו״ד" בדף הנכס** עם אימות טלפון בוואטסאפ (הודעה נכנסת, כמו בחתימת הסכם:
   `agreement-wa-verify.ts`): הליד נכנס כ-`pending` ועולה למדף (`new`) רק אחרי האימות. **כרטיס המדף כבר אומר
   "טלפון מאומת בוואטסאפ"**, והקליטה חייבת לעמוד בזה.
2. **התראה לסוכן/ת של הנכס** שהלקוח/ה ביקש/ה ייעוץ משפטי, עם קישור לנכס (הסקיל `agent-notifications`).
3. **`data_retention_run`** יכסה את `lawyer_leads` (שם, טלפון, מייל ושאלה) **לפני** ששורה ראשונה נכנסת (`docs/data-retention.md`).
4. **רישום ניתוב** ב-`lead_routing_log` (`lead_kind` חדש), כדי שליד שאין לו עו"ד בעיר ייראה למנהל/ת.
5. **הדיסקליימרים בעברית** בטופס: השאלה אינה יוצרת יחסי עו"ד-לקוח, ואין לשלוח סיסמאות, פרטי תשלום או מסמכי זהות.

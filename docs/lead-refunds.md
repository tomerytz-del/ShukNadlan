# דיווח על ליד לא תקין והחזר לארנק

הוחלט ב-11.11.2026 (תומר). חיוב על ליד יורד ברגע הפתיחה (`claim_lead`), ועד עכשיו
לא הייתה דרך לקבל אותו בחזרה אם הפונה לא היה אמיתי.

## הכללים

| | |
| --- | --- |
| **סיבות** | מספר שגוי או מנותק, ספאם, הפונה הוא יועץ/ת נדל״ן, כפילות |
| **חלון** | 48 שעות מפתיחת הליד (`pricing_config.lead_refund_window_hours`) |
| **מי מחליט** | **אוטומטי.** דיווח בתוך החלון מוחזר מיד, בלי אישור של אדם |
| **תקרת ניצול** | עד 2 דיווחים ב-30 יום תמיד אוטומטיים (`lead_refund_auto_min`). מעבר לזה, אם הדיווחים הם יותר מ-20% מהלידים שהסוכן/ת פתח/ה ב-30 יום (`lead_refund_auto_pct`) - הדיווח **ממתין לבדיקה ידנית** של מנהל/ת הפלטפורמה |
| **צורת ההחזר** | לארנק, **לפי מה שנגבה בפועל** (שורת `lead_charges`), לא לפי המחיר היום |
| **מכסת החינם** | ליד שנספר ב-10 הפניות של Pay&GO ומדווח - הפנייה חוזרת למונה, **רק באותו חודש** (אחרי חילופי חודש המונה כבר של חודש אחר) |
| **הליד אחרי ההחזר** | **נסגר**: נכנס ל-`lead_archives` (הטריגר הקיים סוגר את השלב ומבטל תזכורות). הוא אינו חוזר למאגר ואינו נמכר שוב, ו**אי אפשר להחזיר אותו מהארכיון**: טריגר `lead_archives_guard_refunded` חוסם מחיקה ישירה של שורת הארכיון שלו (מחיקה ב-cascade עוברת, כדי לא לשבור שמירת נתונים), והכפתור "החזרה מהארכיון" מוסתר |

המינימום של שני דיווחים קיים כי בלעדיו סוכן/ת עם שני לידים בחודש היה עובר
לבדיקה ידנית כבר בדיווח הראשון (50%).

## מה בנוי

| | איפה |
| --- | --- |
| טבלה, הגדרות ופונקציות | `20271111100000_lead_invalid_reports.sql` |
| דיווח (הסוכן/ת, JWT) | `report_invalid_lead(p_lead, p_reason, p_details)` |
| ההחזר עצמו | `_lead_report_apply` - ‏`service_role` בלבד, אידמפוטנטית. נקראת רק מהשתיים שמעליה ומתחתיה |
| רשימת המנהל/ת וההחלטה | `lead_reports_admin`, ‏`lead_report_review` (מנהל/ת פלטפורמה בלבד, `42501` לאחרים) |
| כפתור בכרטיס הליד, וחלון הדיווח | `assets/crm-lead-reports.js` (‏`leadReportMount`, ‏`openLeadReport`), נקרא מ-`buildLeadCard` |
| "דיווחי לידים" למנהל/ת | `#accLeadReports` ב-`crm.html`, קבוצת "היום" |
| ההבטחה לסוכן | שאלה "מה זה בעצם ליד" ב-`pricing.html` (גם ב-JSON-LD) |

הסוכן/ת נגזר/ת מ-`current_agent_id()`, לא מפרמטר, ורק מי שפתח/ה את הליד
(`unlocked_by`) יכול/ה לדווח. הפונקציה `security definer`, ולכן
`protect_sensitive_agency_member_fields` מרשה את שינוי `credit_balance` (כמו
`request_wallet_refund`). **שני דיווחים במקביל לא עוברים את התקרה שניהם:** הפונקציה
נועלת את שורת הסוכן/ת.

## מה לא כלול

- **שיחות** (`lead_type = 'call'`) - חויבו ב-`phone_line_charges` ואין להן שורה ב-`lead_charges`.
  הן נדחות כ-`not_supported`.

## לידי חנות (מ-11.11.2026, הסעיף "לידי החנות בלבד")

ליד חנות הוא שורה ב-`leads` עם `lead_type = 'store'` ו-`origin_id` = מזהה הפריט במקור, שנוצרת בטריגר
`store_purchase_to_lead`. **אין לה שורה ב-`lead_charges` ואין לה `unlocked_by`**, ולכן:

| מה | איך |
| --- | --- |
| הבעלים | `agent_id` (לא `unlocked_by`) |
| החיוב | `_lead_store_purchase(origin_id, agent)`: `rss_lead_purchases` (חנות הלידים), `mortgage_lead_purchases` או `saved_search_lead_purchases` (מחפשי דירה), לפי `origin_id` והסוכן/ת |
| ההחזר | הסכום שנגבה לארנק, והרכישה בטבלת המקור `status = 'refunded'` (אותו אילוץ שכבר הכיר `refunded`) |
| המקור | rss_leads / saved_searches / mortgage_leads **נשאר "נמכר"** ואינו חוזר לחנות: הליד נסגר, כמו כל ליד |
| מכסה | אין (ליד חנות אינו נספר ב-10 הפניות), ולכן ליד חנות בלי תשלום (`amount = 0`) הוא `nothing_to_refund` |
| תקרת הניצול | לידי חנות נספרים במניין "לידים שנפתחו" |
| הסימנים לבודק/ת | `evidence.store = true`, ו-`phone_invalid` הוא `null` כשאין `phone_e164` (ליד rss בלי טלפון אינו "מספר לא תקין") |
- **ליד במנוי** (`subscription_unlimited`) - לא נגבה כסף ולא נספרה מכסה, ולכן אין מה
  להחזיר (`nothing_to_refund`).
- **ליד של Facebook מהסריקה** נכלל רק אם נפתח ב-`claim_lead`.

## מה לדעת

- **דיווח אחד לליד, גם אם נדחה** (`unique(lead_id)`). בלי זה דחייה הייתה הזמנה לנסות שוב.
- **הסימנים לבודק/ת** (`evidence`: מספר שאינו בפורמט, אותו מספר כבר אצל הסוכן/ת,
  המספר רשום כסוכן/ת, כמה דיווחים מתוך כמה לידים) **אינם תנאי להחזר** - ההחלטה היא
  אוטומטי. הם רק עוזרים להחלטה הידנית.
- **החשיפה לפני הדיווח היא מכוונת.** הסוכן/ת כבר ראה/תה את הטלפון כשפתח/ה את הליד.
  מה שמגביל ניצול הוא התקרה, לא הסתרה.
- ‏`lead_charges.status = 'refunded'` מוציא את השורה מסכומי ההכנסה בדשבורד הפלטפורמה
  (הם סופרים `success` בלבד).
- התראות: לסוכן/ת - ‏`system` עם `related_lead_id` (הכרטיס נפתח ישר), בכל תוצאה; **בלי וואטסאפ** כשהוא/היא
  הרגע דיווח/ה (`suppress_push`), ועם וואטסאפ כשמנהל/ת החליט/ה אחרי. למנהלי הפלטפורמה - ‏`system` עם
  `action_path = '/crm?goto=accLeadReports'` כשדיווח עובר לבדיקה: הליד אינו שלהם ואין להם גישה אליו, והיעד הוא הרשימה.
  אין סוג התראה חדש (סוג חדש = ארבעה מקומות, `agent-notifications`).
- המונה על "דיווחי לידים" נטען עם שאר טעינות המנהל/ת בכניסה (`ADMIN_LOAD_FNS`).
- ‏`lead_charges.status` חייב להכיר `refunded`; המיגרציה מוסיפה אותו אם חסר.

## מגבלות ידועות

- **התראת "חרג מזמן היעד" של התיבה** (`admin_inbox_notify_overdue`) אומרת "פריט חרג/ה מזמן היעד" ל-`lead_report`
  (אין לו ענף בכותרת, כמו `hood_draft`). הפירוט בתיבה עצמה.
- **מנהל/ת שמאשר/ת דיווח על ליד חנות שהרכישה שלו כבר טופלה** מקבל/ת `nothing_to_refund`, והדיווח נשאר ממתין
  (`_lead_report_apply` לא מסמנת "הוחזר ₪0" ולא מארכבת). דוחים אותו ידנית.

## בדיקה

המיגרציה נבדקה על Postgres מקומי עם טבלאות stub: ליד בתשלום, ליד במכסה (המונה יורד),
חלון שנסגר, סוכן אחר, ליד במנוי, ליד מהחנות משלושת המקורות (ובלי תשלום), דיווח כפול, מעבר לתקרה, אישור ודחייה
של מנהל/ת, ומשתמש שאינו מנהל/ת.

## בדיקה על הדיווח הראשון בפרודקשן

הבדיקה על Postgres מקומי אינה מחליפה את הדיווח הראשון האמיתי. כשהוא קורה (שורה ראשונה ב-`lead_invalid_reports`),
בודקים בקריאה בלבד שכל החלקים מסכימים:

```sql
select r.id, r.status, r.reason, r.refund_amount, r.quota_returned, r.auto,
       (select c.status from public.lead_charges c
         where c.lead_id = r.lead_id and c.agent_id = r.agent_id
         order by c.created_at desc limit 1)                          as charge_status,
       exists (select 1 from public.lead_archives a where a.lead_id = r.lead_id) as archived,
       exists (select 1 from public.notifications n
                where n.related_lead_id = r.lead_id and n.agent_id = r.agent_id)  as agent_notified,
       (select m.credit_balance from public.agency_members m where m.id = r.agent_id) as balance_now
  from public.lead_invalid_reports r
 order by r.created_at limit 5;
```

**`refunded` תקין** כש-`charge_status = 'refunded'` (כשהוחזר סכום), `archived` ו-`agent_notified` אמת, ו-
`refund_amount` שווה לסכום שנגבה ב-`lead_charges`. **`pending_review` תקין** כש-`archived` שקר ויש התראה
למנהל/ת הפלטפורמה. אי-התאמה בין אלה היא באג בפרודקשן ולא רעש.


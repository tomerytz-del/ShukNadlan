---
name: lead-refunds
description: דיווח על ליד לא תקין והחזר לארנק בריפו של שוק נדל״ן - report_invalid_lead, lead_invalid_reports, _lead_report_apply, lead_report_review, חלון 48 שעות, תקרת ניצול, מכסת החינם שחוזרת, והליד שנסגר. Use when an agent asks for money back on a lead, when touching claim_lead or lead_charges, when changing the refund window or the abuse cap, when adding a lead source or type that is charged, or when a refunded lead came back from the archive.
---

# החזר על ליד לא תקין

התיעוד המלא: `docs/lead-refunds.md`. הוחלט ב-11.11.2026 (תומר).

## ההחלטות, ואל תשנו אחת בלי שהוא החליט

| | |
| --- | --- |
| סיבות | מספר שגוי או מנותק, ספאם, הפונה הוא יועץ/ת נדל״ן, כפילות |
| חלון | **48 שעות** מפתיחת הליד (`pricing_config.lead_refund_window_hours`) |
| מי מחליט | **אוטומטי.** מעל התקרה - מנהל/ת הפלטפורמה, ב"דיווחי לידים" |
| תקרה | עד 2 דיווחים ב-30 יום תמיד אוטומטיים (`lead_refund_auto_min`); מעבר לזה מעל 20% מהלידים שנפתחו (`lead_refund_auto_pct`) ממתין |
| צורה | **לארנק, לפי שורת החיוב** - לא לפי `pricing_config` היום |
| מכסת החינם | חוזרת, **רק באותו חודש** שנספרה בו |
| הליד | נסגר: ארכיון, בלי חזרה למאגר ובלי החזרה מהארכיון |

## חמישה דברים שנשברים בשקט

1. **ההחזר עובר רק דרך `_lead_report_apply`.** היא אידמפוטנטית, ונקראת מ-
   `report_invalid_lead` (אוטומטי) ומ-`lead_report_review` (ידני). פונקציה
   שמזכה את `credit_balance` בדרך אחרת לא מעדכנת `lead_charges` ולא סוגרת את
   הליד - הכסף חוזר והליד נשאר לעבודה בחינם.
2. **`lead_charges.status = 'refunded'`.** דשבורד הפלטפורמה סופר `success` בלבד,
   ולכן זה מה שמוריד את ההחזר מההכנסה. אל תמחקו שורה ואל תכתבו סכום שלילי.
3. **חיוב חדש שאינו עובר ב-`claim_lead`** (חנות, שיחות, סוג ליד חדש) **אין לו
   שורה ב-`lead_charges`** ולכן אינו בהחזר. מחליטים במפורש: מוסיפים אותו ל-
   `_lead_report_apply` או משאירים אותו בחוץ ומתעדים ב"מה לא כלול". `store` ו-
   `call` נדחים כ-`not_supported`.
4. **ליד שהוחזר נשאר בארכיון.** הטריגר `lead_archives_guard_refunded` חוסם מחיקה
   ישירה (`pg_trigger_depth() > 1` = cascade, חייב לעבור לשמירת נתונים), והכפתור
   "החזרה מהארכיון" מוסתר (`leadReportBlocksUnarchive`). מי שמוסיף דרך חדשה
   להוציא ליד מהארכיון - אותו כלל.
5. **התראה: `suppress_push` מפורש בכל `insert`.** הסוכן/ת שדיווח/ה הרגע רואה את
   התוצאה במסך (`true`); החלטה ידנית נדחפת אליו/ה (`false`). `check_notification_backfill.py`
   חוסם insert בלי העמודה. התראה למנהל/ת נושאת `action_path`, לא `related_lead_id`:
   הליד אינו שלו/ה ואין לו/ה גישה אליו.

## כשמשנים כלל

- **חלון, תקרה, אחוז** - `pricing_config`, לא קוד. ההערה בעמודת `description` אומרת מה זה.
- **`LEAD_REPORT_WINDOW_HOURS` ב-`assets/crm-lead-reports.js` הוא תצוגה**; המסד קובע.
  שינוי בחלון = שני המקומות, ושורת השאלה "מה זה בעצם ליד" ב-`pricing.html`
  (**גם** ב-JSON-LD שבראש הדף) שאומרת "48 שעות".
- **הכפתור אינו כלל.** `leadReportEligible` רק מסתיר כפתור שברור שיידחה; מקור חיוב
  חדש לא נחסם שם (כך כל מה שאינו ברשימת "בלי חיוב" מקבל כפתור והמסד מחליט).

## בדיקה

אין בדיקת deno למיגרציה. הדרך שעבדה: Postgres מקומי (`/usr/lib/postgresql/16/bin`),
טבלאות stub (`agency_members`, `leads`, `lead_charges`, `lead_archives`, `notifications`)
ו-`current_agent_id()` שקורא `current_setting('app.agent')`, והמיגרציה פעמיים. תרחישים
שחייבים לעבור: ליד בתשלום, ליד במכסה, חלון שנסגר, סוכן אחר, `unlocked_at` ריק, מנוי,
חנות, כפול, מעבר לתקרה, אישור ודחייה, מנהל/ת שאינו/ה מנהל/ת, מחיקת ארכיון ישירה
(נחסמת) ומחיקת הליד (עוברת). ובקריאה: `select` על מה שהמסד **אומר** (`pg_constraint`
של `lead_charges`), לא על מה שהקוד מניח.

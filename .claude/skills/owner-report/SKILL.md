---
name: owner-report
description: הדוח השבועי לבעל הנכס בריפו של שוק נדל״ן - owner_report_create, owner_report_links, owner-report-link, owner-report.html, assets/owner-report.js, assets/crm-owner-report.js. Use when adding a metric to the owner report, when an owner says the link expired or the numbers do not add up, when someone asks to send the report automatically to owners, or when touching the "דוח לבעלים" tile on the property card.
---

# דוח שבועי לבעל הנכס

התיעוד המלא: `docs/owner-report.md`. הוחלט ב-11.11.2026 (תומר).

## הכלל שמעל הכול: **היועץ/ת שולח/ת, לא המערכת**

בעל נכס לא נתן לפלטפורמה הסכמה לקבל הודעות. הדוח יוצא בשם היועץ/ת ובערוץ שלו/ה,
והחלון ב-CRM רק פותח את וואטסאפ או את תיבת המייל שלו/ה עם נוסח מוכן.
**ביקשו שליחה אוטומטית לבעלים? זו החלטה על ערוץ, הסכמה וביטול הרשמה** (תבנית
וואטסאפ מאושרת של Meta או מייל), לא תוספת קוד: מסבירים ועוצרים עד שתומר מחליט.

## ארבעה דברים שנשברים בשקט

1. **הדוח מספרים בלבד, והקישור עובר הלאה.** בלי שם, טלפון או מקור של גולש/ת, ובלי
   פרטי נכס אחר. 32 תווים אקראיים, 30 יום, `noindex`, `Disallow`, ובלי `events.js`
   (`owner-report` ב-`PRIVATE` של `check_canonical.py` וב-`PRIVATE_PAGES` של `check_events.py`).
2. **החלון הוא לפי תאריך בישראל** (היום ו-6 שלפניו), לא 168 שעות. הגרף והסכום
   חייבים להסכים, ובעלים מחברים את העמודות. אותו חלון בצפיות, בפניות ובהשוואה לשוק.
3. **ההרשאה ב-`owner_report_create` חייבת להיות null-safe.** `current_agency_id()` ו-
   `current_member_role()` יכולות להחזיר null, ו-`not (false or null)` הוא null:
   `if` לא נכנס וההרשאה נעקפת. העטיפה ב-`coalesce(..., false)` היא מה שמגן
   (נתפס בבדיקה על Postgres מקומי). **רק מודעה שבאוויר** (`status = 'active'`),
   והאריח בכרטיס משתמש באותו תנאי בדיוק, לא ב-`canReferRow`.
4. **ההשוואה לשוק מוצגת תמיד כשיש מדגם (מ-5 נכסים), גם כשאינה מחמיאה.** דוח שמציג
   רק את הנוח הוא דוח שבעלים מפסיקים לסמוך עליו. אל תוסיפו מתג "הסתר".

## מדד חדש

נכנס ל-`_owner_report_build` ול-`render` ב-`assets/owner-report.js` **יחד**. הדוח הוא
תמונת מצב שנשמרת ב-`report`, ולכן דוח ישן לא יכיל אותו - הדף חייב לסבול מפתח חסר.
כל ערך מהמסד ב-`innerHTML` עובר ב-`esc()`, והערת היועץ/ת ב-`white-space:pre-wrap`
דרך `esc`, לא כ-HTML.

## פתיחות

`owner_report_open(p_id, p_count)`: "צפייה בדוח" של היועץ/ת נשלחת עם `&p=1` ואינה
נספרת. `open_count` משוער בכוונה (רענון ותצוגה מקדימה של קישור שמריצה JS נספרים)
ואין בו התראה: סוג התראה חדש הוא ארבעה מקומות (הסקיל `agent-notifications`).

## המיגרציה והאתר

האתר עולה לפני המיגרציה והפונקציה (`deploy-path`, סעיף 2). בחלון הזה לחיצה על
האריח נכשלת בהודעה מטופלת. הדף עצמו לא נפתח בלי קישור שנוצר, ולכן אין דף שבור.

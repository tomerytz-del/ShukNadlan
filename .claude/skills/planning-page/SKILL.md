---
name: planning-page
description: מידע תכנוני דרך גבריאלה בריפו של שוק נדל״ן - כפתור "📄 מידע תכנוני" לדף הבדיקה /plan?k= ותו לא (planning_lookup, planning_info, planningButton), planning_links ו-planning-link, הדף (plan.html, assets/plan.js) עם השיתוף וההורדה, וסוג הבעלות מהטאבו. Use when changing what Gabriela answers about gush/helka, land use, plans, 77-78 notices or ownership, when someone wants the bot to write planning info as text or send the result as a WhatsApp message, when touching plan.html / plan.js / planning-link / planning_links, when adding a field or a share option to the planning page, or when a planning link "expired" or "did nothing".
---

# מידע תכנוני דרך גבריאלה - כפתור לדף, ותו לא

המסמך המלא: `docs/govmap.md`, "דף הבדיקה". הרקע על המקורות: הסקיל `govmap`.

## ‏1. הכלל (תומר, 22.10.2026)

**כל מידע תכנוני שגבריאלה נותנת יוצא ככפתור לדף הבדיקה, ולא כטקסט.** גוש,
חלקה, ייעוד, תוכניות, הודעות 77-78 וסוג הבעלות - הכול בדף. לא בתשובה, ולא
בהודעה שנשלחת אחרי שהבדיקה רצה.

| מה | איך |
| --- | --- |
| השאלה | `planning_lookup` (כתובת או גוש+חלקה) או `planning_info` (נכס של הסוכן/ת) |
| מה הכלי עושה | `planningButton` ← `planning_link_create` ← כפתור `cta` ב-outbox (‏`crmButton`) |
| מה גבריאלה כותבת | שורה אחת: הכתובת ו-👇. בלי קישור, בלי מידע, בלי התנצלות |
| הכפתור | גוף "לצפייה במידע תכנוני לנכס המבוקש:", תווית "📄 מידע תכנוני" |
| בתור מייל (אין כפתורים) | `planning_url` כטקסט, עם אותו גוף |

**למה לא טקסט:** הדף נוח לצפייה ולשיתוף, והוא מציג את אותו דבר בכל פעם. תשובה
בטקסט הייתה נשענת על מקורות שונים לפי עיר (שכבת העירייה בעפולה, מטמון, השכבה
הפתוחה ו-XPlan) - ונראית אחרת בכל פעם.

**מי שמבקש/ת "שגבריאלה תכתוב את הייעוד"** - זו החלטה שהתקבלה במפורש. לא לשנות
בלי תומר.

### התווית: 20 תווים

‏Meta דוחה כפתור `cta_url` שהתווית שלו מעל 20 תווים - **את ההודעה כולה**, בשקט
מבחינת הסוכן/ת. "לצפייה במידע תכנוני לנכס המבוקש" הוא 31, ולכן הוא גוף ההודעה,
והתווית "📄 מידע תכנוני". שינוי תווית נספר ביחידות UTF-16 (אימוג'י = 2). הסקיל
`whatsapp-bots`, "הודעות כפתורים".

## ‏2. הדף

`plan.html` + `assets/plan.js`, נפתח מ-`/plan?k=<32 תווים>`:

1. ‏GovMap מתחיל להיטען מיד, במקביל ל-`planning-link` (‏`open`)
2. ‏`GovmapLookup.addressRecord` - **אותה** רשומה של ההשלמה ב-CRM
3. מוצג, ונשלח ל-`planning-link` (‏`complete`): נשמר דרך `_govmap_address_store`
   (אותן בדיקות כמו `govmap_address_save`), ומקבל את סוג הבעלות מהטאבו
   (‏`land_ownership_of`) - הדף מוצג מחדש איתו
4. קישור שכבר נענה מציג את התוצאה השמורה, בלי GovMap

**שיתוף והורדה:** וואטסאפ, שיתוף של הטלפון, העתקה, מייל, PDF (חלון ההדפסה) וקובץ
טקסט. **הטקסט המשותף בלי הקישור לדף** - הוא אישי לסוכן/ת. שם הקובץ באנגלית
(‏`planning-<גוש>-<חלקה>.txt`): שם עברי נמחק בהורדת blob ויוצא "download".

**שדה חדש בדף** עובר ב: ‏`addressRecord` (אם הוא מ-GovMap), `summarize` ב-
`supabase/functions/planning-link/summary.ts` **וגם** `summarize` ב-`plan.js`
(אחרת קישור שנפתח שוב לא יציג אותו), `render`, ו-`shareText`.

## ‏3. הקישור הוא ההרשאה

‏`planning_links` ל-service_role בלבד; הדף מדבר רק עם `planning-link`
(‏`verify_jwt = false`). 32 תווים אקראיים, 7 ימים, **תוצאה אחת**, עד 40 קישורים
ביום לסוכן/ת, ואותה שאלה בשעה האחרונה מקבלת את אותו קישור. הרשומה מהדפדפן היא
קלט זר: המסד מאמת כל שדה, ו-`summarize` מנקה (קישור רק למבא"ת).

## ‏4. מה **לא** בשימוש בבוט, ולמה זה עדיין קיים

‏`parcels_open`, ‏`address_parcel_from_deals`, ‏`netlify/functions/xplan.mjs` ומטמון
הכתובות (‏`govmap_address_planning_get`) - הבוט כבר לא קורא אותם מאז שהמידע
עבר לדף. הם נשארים כנכסי נתונים (‏`docs/parcels-open.md`). מי שרוצה להחזיר
תשובה בטקסט - סעיף 1.

## בדיקות

```sh
node --experimental-strip-types scripts/planning_link_test.ts   # הסיכום
python3 scripts/check_edge_types.py
python3 scripts/check_long_dash.py
```

ובדפדפן: Playwright עם GovMap ו-`planning-link` מדומים (‏GovMap נעול לדומיין
האתר) - שהדף נטען, ששתי הקריאות יוצאות, ושהזרקת HTML מוצגת כטקסט.

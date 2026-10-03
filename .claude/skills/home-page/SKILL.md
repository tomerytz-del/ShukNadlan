---
name: home-page
description: עבודה על דף הבית של שוק נדל״ן (index.html) - כרטיס גבריאלה ב-hero, שורת החיפוש החופשית, המפה שנפתחת ב"הצג במפה" (map-closed / map-open), סדר הסקציות מתחת ל-hero, הערכת השווי וההסתייגות על השמאי, והפינות המעוגלות מול design-system.css. Use when changing anything in the home page hero or sections, adding a section or a button to index.html, when a style in index.html "doesn't apply" or a corner comes out square, when the Gabriela button drops below the fold on mobile, when touching the owner valuation wizard, or when a sentence on the page breaks in the middle.
---

# דף הבית

אוקטובר 2026: ה-hero הוא כרטיס גבריאלה, המפה יוצאת ממנו ונפתחת בכפתור, והדף
מתחתיו עבר לשפה מעוגלת ורכה. המסמכים: `docs/search-map-experience.md` סעיף 0.0
(ה-hero והמפה), `docs/home-page-sections.md` (הסקציות, הערכת השווי, הפינות).

## 1. סגנון שלא חל: ‏design-system.css נטען *אחרי* ה-`<style>`

`index.html` מכיל את ה-CSS שלו בתוך `<style>` (‏CLAUDE.md: ה-CSS נשאר מוטבע),
ו-`assets/design-system.css` נטען **אחריו**. כלל בדף בספציפיות שווה לכלל שם -
**מפסיד**, גם עם `!important` מול `!important`. הכשל שקט: הקוד נראה תקין,
והמסך מציג את הערך של design-system.

**הכלל:** כלל ב-`index.html` שמתחרה במשהו מ-design-system (צבע של המבזק, פינות,
כפתורים) נושא מזהה (`#ownerBannerWrap …`) או `html body` לפניו. כך תוקנו המבזק
(`main div.ticker`) והפינות (`html body .map-open-btn`).

אותו דבר בתוך הדף עצמו: כלל בטלפון שנכתב **מוקדם** בקובץ מפסיד לכלל באותה
ספציפיות שנכתב מאוחר יותר. כשמשהו "לא משתנה", לבדוק ב-DevTools מי גובר לפני
שמוסיפים עוד כלל.

## 2. הכפתור לגבריאלה - במסך הראשון בטלפון

הפעולה שבשבילה הכרטיס קיים היא "פתחו שיחה עם גבריאלה". **כל שינוי ב-hero**
(שורה נוספת, גלולה, גופן) עלול להוריד אותה מתחת לקיפול - וזה קרה פעמיים:
הכרטיס המקורי (‎~200px‎ מתחת), ושורת "סינון מתקדם" שהחזירה ‎40px‎ ב-320×568.

לפני דחיפה, למדוד את תחתית `#gabCtaWrap .gab-cta` ב-Playwright (מכשיר נייד)
ב-320×568, ‏360×640, ‏390×700 ו-412×740 - בכולם היא חייבת להיות ≤ גובה המסך.
המספרים האחרונים ב-`docs/search-map-experience.md` סעיף 0.0.

**והכפתור עצמו נבנה רק ב-`renderGabrielaCta()`** - לא `wa.me` ביד. כשהמתג
`ENABLED` ב-`bot-link.js` כבוי, אותה פונקציה מחליפה אותו בכפתור לסוכן החכם
(`source=homepage_gabriela`); קישור שנבנה ביד היה נשאר ושולח ל"איני מזהה".
ראו גם הסקיל `whatsapp-bots`.

## 3. המפה: לא נמחקת, רק סגורה

`#heroSection` נולד `map-closed`; `openMapView()` מחליף ל-`map-open` (מסך מלא).
Leaflet מאותחל בטעינה בגודל 0, ולכן כל פתיחה קוראת `invalidateSize` +
`fitMapToMarkers`. מה שמסתמך על "המפה גלויה" (התצוגה המפוצלת, `revealSplitRow`,
‏`updateSplitPanel`) בודק `mapViewIsOpen()` / `mapStripOn()`. כל דבר שפותח את
המפה נושא `data-map-open="<מקור>"` - מאזין אחד מטפל בכולם.

## 4. הערכת השווי - ההסתייגות בכל שלב

> \* הערכת השווי ניתנת על ידי מתווך/ת, ואינה מהווה תחליף לשומה של שמאי מקרקעין מוסמך.

`.wiz-disclaimer` מתחת לכפתור **בכל שלב ובמסך התודה** - ארבעה עותקים. זו
הסתייגות משפטית; מי שמוסיף/ה שלב לאשף מוסיף/ה גם אותה. מזהי האשף
(`#ownerWizardForm`, ‏`#wizAddress`, ‏`#ownerStartBtn`…) לא משתנים - `home.js` נקשר
אליהם.

## 5. פינות מעוגלות - ההעדפה

**ההעדפה היא פינות מעוגלות** (החלטת בעל/ת האתר, אוקטובר 2026), **בכל האתר**.
הסולם יושב ב-`design-system.css` סעיף 3 (כפתורים ושדות 10px, כרטיסים 16px,
חלונות 18px, גלולות 999px, תגיות 6px) ובטוקנים `--radius-*`. רכיב חדש מקבל
פינה מהסולם - לא `border-radius:0`, ולא ערך שרירותי משלו.

מי שמוסיף/ה תבנית מחלקה לסולם - צר: הכלל המרובע הישן תפס כל ‎-modal‎ ו-‎-panel‎,
וזה כלל את שכבת הרקע של חלון במסך מלא (‏`.filter-modal-overlay`). עם עיגול
זה נראה מיד.

## 6. משפט לא נשבר באמצע

design-system.css נותן `text-wrap:balance` לכותרות ו-`pretty` לפסקאות. צירוף
שחייב להישאר יחד ("פחות מדקה", "1.6 מיליון ₪", "הכל כאן.") עוטפים ב-
`<span class="nw">`. כפתור שהכיתוב שלו לא נכנס בטלפון צר - מקטינים גופן
מתחת ל-375px, לא נותנים לו להישבר; ורק אם גם זה לא מספיק (כפתור הסוכן במצב
הכבוי) - שתי שורות **מאוזנות**.

## 7. דברים שלא נוגעים בהם

- כרטיסי הנכסים (`property-card.js`, ‏`.pc-*`) והמדף (`.pp-tags`, ‏`.pp-sort`).
- `#dealmakers` - כולל התגיות על כרטיסי המשרדים והמתווכים.
- הדמות של גבריאלה (`assets/gabriela-*.webp`) - לא חותכים, לא צובעים, לא מחליפים.
- הלוגו.

## לפני הדחיפה

```sh
python scripts/check_long_dash.py
python scripts/check_events.py      # כל wa.me של גבריאלה נושא data-bot
python scripts/check_gtm.py && python scripts/check_pwa.py && python scripts/check_canonical.py
node scripts/sentence_search_test.cjs   # אם נגעת בחיפושים המוקלדים
```

ובדפדפן: 320, ‏390, ‏900, ‏1440 - `scrollWidth` שווה לרוחב המסך, הכפתור לגבריאלה
במסך הראשון בטלפון, אין שגיאות בקונסול. ‏Supabase ו-jsdelivr חסומים בסביבת
הענן: מגישים את Leaflet מ-npm ונתוני דמה ב-`ctx.route` (ראו `perf-measure`
לגבי מתי *אסור* ליירט - במדידת ביצועים).

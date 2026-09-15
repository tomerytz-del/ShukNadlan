---
name: new-page
description: יצירת דף HTML חדש בשורש האתר (שוק נדל״ן) — GTM, מדידת אירועים, בריחת HTML, פוטר ו-robots. Use when adding a new page to the site, creating a new .html file in the repo root, or when a page was added and something about it is not measured / not styled / not escaped.
---

# דף חדש באתר

לאתר **אין תבנית משותפת**. כל דף הוא קובץ HTML עצמאי ש-Netlify מפרסם כמו
שהוא, ולכן כל מה שדף צריך — נמצא בתוכו. דף שנוצר בהעתקה חלקית נטען,
נראה תקין, ומתנהג כרגיל — והפער מתגלה חודש אחרי.

**הדרך הבטוחה: להעתיק דף קיים דומה ולשנות אותו**, ולא לכתוב head מאפס.
לדף תוכן — `about.html`. לדף עם נתונים מ-Supabase — `agents.html`.

## סדר הפעולות

### 1. מאיזה סוג הדף

| סוג | דוגמאות | טוען `events.js`? |
| --- | --- | --- |
| ציבורי | נכס, משרד, כתבה, מחירון | **כן** |
| אזור אישי | `crm`, `developer-crm`, `professional-manage` | **לא** |

הכלל הזה אינו סגנוני. `events.js` סופר כל לחיצת `wa.me` ו-`tel:` בדף
כפניית גולש/ת לסוכן/ת. באזור האישי סוכנים מתקשרים ללקוחות של **עצמם**,
וטעינת הקובץ שם הייתה מזהמת את המדד. פרטים: `docs/analytics-events.md`.

### 2. ה-`<head>` — לפי הסדר הזה

```html
<meta charset="UTF-8">
<!-- Google Tag Manager -->  ← מיד אחרי charset, מועתק מ-index.html כלשונו
<script src="assets/esc.js"></script>        ← אם הדף מכניס ערכים ל-innerHTML
<script src="assets/events.js"></script>     ← דף ציבורי בלבד
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>… | שוק נדל״ן</title>
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<meta name="description" content="…">
<link rel="stylesheet" href="assets/design-system.css">
<link rel="stylesheet" href="assets/site-footer.css">
<script defer src="assets/site-footer.js"></script>
```

`<meta charset>` נשאר **ראשון**. דחיפת ה-GTM לפניו גורמת לדפדפן לנחש
קידוד, והעברית מוצגת כג'יבריש.

ומיד אחרי `<body>` — קטע ה-`noscript` של GTM. גם הוא מועתק כלשונו, וגם
הוא חייב להיות **מיד** אחרי `<body>`: iframe שנדחק אחרי תוכן הדף נטען
מאוחר, ובדפים ארוכים עלול לא להיטען כלל.

### 3. ערכים מהמסד → תמיד דרך `escapeHtml`

הדף טוען `assets/esc.js` ומשתמש ב-`escapeHtml` הגלובלית. **אין להגדיר
בריחה משלך בדף** — זה בדיוק מה שיצר את ההזרקה שתוקנה ב-`buildSearchRow`.

```js
row.innerHTML = `<div class="t">${escapeHtml(p.title)}</div>`;
```

כתובת תמונה בתוך `url('…')` שבתוך `style="…"` היא מקרה אחר — שם צריך
`cssUrl` (ראו `index.html`), כי `escapeHtml` אינה מגינה על גרש בודד
בתוך CSS.

### 4. פרטיות כתובת

דף שמציג נכס מציג **רחוב ושכונה, לא מספר בית**. יש `maskHouseNumber`
ו-`publicAddressText` ב-`property.html`. הכלל והנימוק:
`docs/property-address-privacy.md`.

### 5. האם הדף צריך להיסרק

דף פרטי (אזור אישי, תשלום, חתימה, קישור עם טוקן) נוסף ל-`robots.txt`
**בשתי הצורות** — עם `.html` ובלעדיה, כי Netlify מגיש את שתיהן:

```
Disallow: /my-page
Disallow: /my-page.html
```

דף ציבורי נוסף ל-`sitemap.xml`.

### 6. לפני הדחיפה

```sh
python scripts/check_gtm.py        # תגיות GTM בכל דף
python scripts/check_escapers.py   # בריחה אחת, מלאה
```

שתיהן חוסמות ב-CI. הפלט שלהן מראה בדיוק מה להדביק ואיפה.

## מה שנשכח הכי הרבה

1. **קטע ה-`noscript`** — קל לזכור את ה-`<script>` ולשכוח אותו.
2. **`events.js` בדף ציבורי** — הדף עובד, פשוט לא נמדד.
3. **הדף לא נוסף ל-`sitemap.xml`/`robots.txt`.**
4. **תיעוד** — יכולת חדשה מקבלת מסמך ב-`docs/`, באותו PR.

---
name: new-page
description: יצירת דף HTML חדש בשורש האתר (שוק נדל״ן) — GTM, בלוק PWA, מדידת אירועים, בריחת HTML, פוטר ו-robots. Use when adding a new page to the site, creating a new .html file in the repo root, or when a page was added and something about it is not measured / not styled / not escaped.
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
← כאן בלוק ה-PWA, מועתק מ-index.html כלשונו (ראו סעיף 3)
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

### 3. בלוק ה-PWA — האתר ניתן להתקנה, וגם הדף הזה

מיד אחרי `<link rel="icon">`, מועתק מ-`index.html` כלשונו:

```html
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0e2a6b">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="שוק נדל״ן">
<script defer src="assets/pwa-install.js"></script>
```

| סוג הדף | מה משתנה |
| --- | --- |
| ציבורי | כלשונו |
| אזור אישי | `href="/app-crm.webmanifest"`, והכותרת `content="אזור אישי"` |
| תהליך (תשלום, חתימה) | `<script … data-no-auto>` — בלי רצועה אוטומטית |
| סרגל קבוע בתחתית | `<script … data-bottom="124px">` (‏ה-CRM) |

דף בלי הבלוק נטען ונראה תקין; מה שחסר הוא ההצעה להתקין, ומי שכבר התקין/ה
עלול/ה לצאת מהאפליקציה לדפדפן כשיגיע אליו. `scripts/check_pwa.py` חוסם
זאת ב-CI. הפרטים: `docs/pwa-install.md`.

### 4. ערכים מהמסד → תמיד דרך `escapeHtml`

הדף טוען `assets/esc.js` ומשתמש ב-`escapeHtml` הגלובלית. **אין להגדיר
בריחה משלך בדף** — זה בדיוק מה שיצר את ההזרקה שתוקנה ב-`buildSearchRow`.

```js
row.innerHTML = `<div class="t">${escapeHtml(p.title)}</div>`;
```

כתובת תמונה בתוך `url('…')` שבתוך `style="…"` היא מקרה אחר — שם צריך
`cssUrl` (ראו `index.html`), כי `escapeHtml` אינה מגינה על גרש בודד
בתוך CSS.

### 5. פרטיות כתובת

דף שמציג נכס מציג **רחוב ושכונה, לא מספר בית**. יש `maskHouseNumber`
ו-`publicAddressText` ב-`property.html`. הכלל והנימוק:
`docs/property-address-privacy.md`.

### 6. האם הדף צריך להיסרק

דף פרטי (אזור אישי, תשלום, חתימה, קישור עם טוקן) נוסף ל-`robots.txt`
**בשתי הצורות** — עם `.html` ובלעדיה, כי Netlify מגיש את שתיהן:

```
Disallow: /my-page
Disallow: /my-page.html
```

דף ציבורי נוסף ל-`sitemap.xml`.

### 7. לפני הדחיפה

```sh
python scripts/check_gtm.py        # תגיות GTM בכל דף
python scripts/check_escapers.py   # בריחה אחת, מלאה
python scripts/check_pwa.py        # בלוק ה-PWA בכל דף
```

שלושתן חוסמות ב-CI. הפלט שלהן מראה בדיוק מה להדביק ואיפה.

## מה שנשכח הכי הרבה

1. **קטע ה-`noscript`** — קל לזכור את ה-`<script>` ולשכוח אותו.
2. **`events.js` בדף ציבורי** — הדף עובד, פשוט לא נמדד.
3. **בלוק ה-PWA** — הדף נטען, פשוט לא ניתן להתקנה.
4. **הדף לא נוסף ל-`sitemap.xml`/`robots.txt`.**
5. **תיעוד** — יכולת חדשה מקבלת מסמך ב-`docs/`, באותו PR.

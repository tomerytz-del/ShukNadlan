---
name: new-page
description: יצירת דף HTML חדש בשורש האתר (שוק נדל״ן) — GTM, בלוק PWA, אימות Search Console, canonical, sitemap, מדידת אירועים, בריחת HTML, פוטר ו-robots. Use when adding a new page to the site, creating a new .html file in the repo root, or when a page was added and something about it is not measured / not indexed / not escaped.
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

**ובדף ציבורי — כל קישור קשר בו חייב להיות מסווג.** המאזין מואצל וסופר
כל `wa.me` וכל `tel:` בדף, ולא כל אחד מהם הוא ליד:

| הקישור בדף | הסימון |
| --- | --- |
| מספר של סוכן/ת | (ללא) |
| העוזר הציבורי בוואטסאפ | `data-bot` |
| "שתפו בוואטסאפ" (`wa.me/?text=`, בלי מספר) | `data-share` |
| המספר או המייל של שוק נדל״ן בבלוק הקשר | `data-site-contact` |
| חברה יזמית, ומשרד המכירות של פרויקט שלה | `data-developer` |

**‏`data-site-contact` היא המלכודת:** בלוק הקשר מועתק לכל דף חדש, ובלי
הסימון כל לחיצה על המספר שלנו נספרת כפנייה למתווך/ת.

**ו-`data-developer` היא זו שדורשת מחשבה ולא העתקה:** היא אינה מתקנת
קישור שנספר בטעות אלא מפרידה משפך. קונה מיזם ישירות אינו פנייה
למתווך/ת — אין עמלה ואין בלעדיות — ולכן גם "חיוג למשרד המכירות" בדף
פרויקט נושא אותה, ולא רק דף החברה.

**ואסור לשלוח פרטים אישיים ל-GA4** — לא אימייל, לא טלפון, לא שם ולא
כתובת. `scripts/check_events.py` חוסם את שני הכללים ב-CI.

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
← ומיד אחריו תגית האימות של Search Console (ראו סעיף 4)
← ואחריה canonical — בדף ציבורי סטטי בלבד (ראו סעיף 7)
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

### 4. תגית האימות של Search Console

מיד אחרי בלוק ה-PWA, זהה בכל דף ובכל סוג דף:

```html
<meta name="google-site-verification" content="_ALC1h51UGYFz3-d53Q9wYeB88QS5ow5DbJ-ZgV1PDA">
```

היא מוכיחה לגוגל שהאתר שלנו. בלי אימות אין גישה לדוחות החיפוש, אין הגשת
`sitemap` ואין בקשת אינדוקס — וגוגל בודקת את התגית שוב גם אחרי שהאימות
עבר. `scripts/check_search_console.py` חוסם דף חסר ב-CI, ו-`--fix` שותל
אותה. הפרטים: `docs/security-headers.md`.

### 5. ערכים מהמסד → תמיד דרך `escapeHtml`

הדף טוען `assets/esc.js` ומשתמש ב-`escapeHtml` הגלובלית. **אין להגדיר
בריחה משלך בדף** — זה בדיוק מה שיצר את ההזרקה שתוקנה ב-`buildSearchRow`.

```js
row.innerHTML = `<div class="t">${escapeHtml(p.title)}</div>`;
```

כתובת תמונה בתוך `url('…')` שבתוך `style="…"` היא מקרה אחר — שם צריך
`cssUrl` (ראו `index.html`), כי `escapeHtml` אינה מגינה על גרש בודד
בתוך CSS.

### 6. פרטיות כתובת

דף שמציג נכס מציג **רחוב ושכונה, לא מספר בית**. יש `maskHouseNumber`
ו-`publicAddressText` ב-`property.html`. הכלל והנימוק:
`docs/property-address-privacy.md`.

### 7. האם הדף צריך להיסרק

**דף פרטי** (אזור אישי, חתימה, קישור עם טוקן) נוסף ל-`robots.txt` **בשתי
הצורות** — עם `.html` ובלעדיה, כי Netlify מגיש את שתיהן:

```
Disallow: /my-page
Disallow: /my-page.html
```

**דף ציבורי סטטי** צריך שני דברים, ושניהם ידניים:

1. שורה ב-`sitemap.xml` — הקובץ הוא מקור האמת לדפים הסטטיים.
2. תגית `canonical` ב-`<head>`, מיד אחרי תגית האימות:

```html
<link rel="canonical" href="https://shuknadlan.co.il/my-page">
```

הכתובת היא **בלי הסיומת**, כי Netlify מגיש כל דף גם כ-`/my-page` וגם
כ-`/my-page.html` — שתי כתובות לאותו תוכן, וגוגל בוחרת לבד איזו לאנדקס
אם לא נאמר לה. לדף הבית זו `https://shuknadlan.co.il/`.

**דף פירוט** (קובץ אחד שמגיש רשומות מהמסד לפי `?id=` או `?slug=`) הוא
המקרה ההפוך, ובשלושה מקומות:

| מה | איפה | למה |
| --- | --- | --- |
| הכתובות | `SOURCES` ב-`netlify/edge-functions/sitemap.ts` | הקישורים אליו נבנים ב-JS, וסורק אינו יכול לעקוב אחריהם |
| `canonical` ו-`og:` | `config.path` ב-`netlify/edge-functions/og-tags.ts` | מוזרקות בשרת מהמסד |
| `canonical` סטטית | **אין.** אסור | ראו למטה |

**ואסור לתת לדף פירוט תגית `canonical` סטטית.** היא יכולה להצהיר רק על
`/my-page` בלי הפרמטר, ו-`og-tags.ts` נופלת בחזרה לדף כמו שהוא בכל כשל
(Supabase איטי, רשומה שאינה פעילה) — כלומר תקלה של דקה בשרת הייתה מאחדת
את **כל** הרשומות לכתובת אחת ומוחקת אותן מהאינדקס.

```sh
python scripts/check_canonical.py        # בודקת את כל הסעיף הזה
python scripts/check_canonical.py --fix  # שותלת canonical בדף סטטי
```

הבדיקה מחזיקה את שלוש המחלקות בשמן, ולכן **דף חדש שאינה מכירה נחשב דף
סטטי ציבורי** — ואז היא דורשת ממנו canonical ושורה ב-sitemap. זו הכוונה:
דף חדש מכריח החלטה במקום להישמט. הפרטים: `docs/security-headers.md`,
`docs/sitemap.md`.

### 8. לפני הדחיפה

```sh
python scripts/check_gtm.py             # תגיות GTM בכל דף
python scripts/check_escapers.py        # בריחה אחת, מלאה
python scripts/check_pwa.py             # בלוק ה-PWA בכל דף
python scripts/check_search_console.py  # תגית האימות בכל דף
python scripts/check_canonical.py       # canonical, sitemap ו-robots
python scripts/check_events.py          # סיווג קישורי קשר, ואין PII
```

שישתן חוסמות ב-CI. הפלט שלהן מראה בדיוק מה להדביק ואיפה.

## מה שנשכח הכי הרבה

1. **קטע ה-`noscript`** — קל לזכור את ה-`<script>` ולשכוח אותו.
2. **`events.js` בדף ציבורי** — הדף עובד, פשוט לא נמדד. וגרוע מזה:
   **`data-site-contact` על המספר שלנו** בבלוק הקשר שהועתק לדף — שם
   המדידה כן עובדת, והיא מנפחת את המדד העסקי המרכזי בלי שום סימן.
3. **בלוק ה-PWA** — הדף נטען, פשוט לא ניתן להתקנה.
4. **תגית האימות** — הדף נטען, פשוט לא ניתן לאמת אותו מול גוגל.
5. **הדף לא נוסף ל-`sitemap.xml`/`robots.txt`, או בלי `canonical`** — הדף
   נטען, פשוט אינו מופיע בגוגל. `developer.html` היה כך עד שנתפס.
6. **תיעוד** — יכולת חדשה מקבלת מסמך ב-`docs/`, באותו PR.

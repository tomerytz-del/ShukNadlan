---
name: market-go-live
description: הדלקת שוק מקומי לגולשים באתר שוק נדל״ן (למשל חיפה והקריות) - בדיקת הסף (משרד אחד ו-10 נכסים פעילים), live: true ב-assets/markets.js, העברת ה-_redirects מ-market-soon ל-index, השורה ב-sitemap.xml, והבדיקות שאחרי. Use when a market reached its inventory threshold, when asked to "open" or "launch" a region to buyers, when switching /haifa-krayot from "coming soon" to the real home page, or when check_markets.py fails on a live market.
---

# הדלקת שוק

שוק נולד **לא חי** (הסקיל `new-market`): הכתובת שלו מגישה "נפתחים בקרוב"
ב-noindex, ואף זיהוי אוטומטי אינו מפנה אליו. הדלקה הופכת אותו לדף הבית
של כל מי שנמצא/ת באזור - ולכן יש לה סף, ויש לה תנאי קוד.

## 0. מה כבר לא חוסם

**שני התנאים שהיו כאן בשלב 1 נפתרו בשלב 2** (`docs/regional-pages.md`):

- **דף הבית מסנן לפי שוק** - `MARKET_FILTER` ב-`assets/home.js`, והכלל עצמו
  ב-`assets/market-scope.js`. `check_markets.py` בודק שהסימן קיים; **אל
  תסירו אותו**, והוא אינו תחליף לסינון - הוא הסימן שהסינון שם.
- **הערים אינן צריכות להיות `is_live` במסד.** הסינון קורא את
  `market_cities_public` (מזהה ו-slug של שוק, בלי שמות), ולא את
  `cities_public`. ‏`cities.is_live` נשאר שער לדף **עיר** (שעוד לא קיים), לא
  לדף שוק - ולכן גם אין צורך בקואורדינטות מהלמ"ס כדי להדליק שוק.

## 1. הסף

**משרד אחד לפחות ו-10 נכסים פעילים בערי השוק.** דף עם אפס נכסים גרוע מאין
דף: הוא מלמד את גוגל שהאתר דק, ואת המבקר הראשון שהאתר ריק
(`docs/cities-and-regions.md`, `is_live`).

איפה רואים:

- ‏CRM ← תצוגת מנהל/ת ← **שווקים מקומיים** ← השוק. המדים "מה חסר עד
  הפתיחה" הם בדיוק הסף.
- או ב-SQL: `.claude/skills/new-market/status.sql`, השאילתה הראשונה.

**ומה לבדוק שם מעבר למספר:**

- **נכסים בלי פין** - הם לא על המפה. שוק שחצי ממנו בלי פינים נראה ריק.
- **משרד שלא מופיע** - משרד בלי כתובת רשומה אינו משויך לעיר, ולכן אינו
  נספר. כתובת במשרד פותרת.
- **נכסים פעילים שאינם שייכים לאף שוק** (בתחתית הפאנל) - לפעמים זה המלאי
  החסר: עיר שנכתבה אחרת ("ק. ביאליק"). כינוי ב-`city_aliases`, לא שכתוב
  של `properties.city`.

## 2. השינויים - שלושה, באותו PR

| המקום | לפני | אחרי |
| --- | --- | --- |
| `assets/markets.js` | `live: false` | `live: true` |
| `_redirects` | `/haifa-krayot    /market-soon    200` | `/haifa-krayot    /index    200` |
| `sitemap.xml` | - | `<url><loc>https://shuknadlan.co.il/haifa-krayot</loc></url>` |
`check_markets.py` מצליב את שלושתם, ו-`check_canonical.py` מכיר את כתובות
השווקים (הוא קורא את `assets/markets.js`), כך שהשורה ב-sitemap אינה נחשבת
"דף שאינו קיים". ‏`market-pages.ts` אינו משתנה:
הוא קורא את `live` מהרשימה ומחליף בעצמו noindex ב-canonical עצמי.

**מה ההדלקה מדליקה מעצמה, ולכן כדאי לדעת:**

- **הפניה אוטומטית.** מי שה-GPS שלו/ה נמצא בשוק, או שבחר/ה אותו, מופנה/ית
  מ-`/` אליו. גם IP שנופל בתיבה שלו - מחשבים בבית ובעבודה. זה מיידי, ואין
  לו מתג נפרד.
- **גוגל.** הדף נכנס ל-sitemap עם canonical עצמי (‏`market-pages.ts`
  מחליף את ה-noindex בעצמו לפי `live`).
- **הבורר.** השוק עובר מ"בקרוב" ל"בחירת אזור" ב-`assets/city-menu.js`.
- **הסוכן התפעולי.** `market_ready` נסגר מעצמו, ומעכשיו `market_below_gate`
  מתריע אם השוק יורד מתחת לסף.

## 3. אחרי המיזוג

1. **Actions** - המיגרציה, אם הייתה.
2. **הדף עצמו**, בחלון פרטי: `https://shuknadlan.co.il/haifa-krayot` - כותרת
   השוק, נכסים של השוק בלבד, מפה על המרכז שלו.
3. **המקור** (`view-source:`): canonical אחד, בלי `noindex`,
   ו-`window.SHUK_MARKET` עם `"live":true`.
4. **ההפניה**: בחלון פרטי, `document.cookie = "shuk_market=haifa-krayot%7Cchoice"`
   וטעינה של `/` - צריך לנחות על `/haifa-krayot`.
5. **Search Console** ← בדיקת כתובת ← בקשת אינדוקס לכתובת השוק.
6. `docs/regional-pages.md` - השוק בטבלה עם תאריך ההדלקה.

## כיבוי

אותם שלושה שינויים בכיוון ההפוך. **ה-slug נשאר** - הכתובת כבר בקישורים
ובעוגיות, ו-`market-soon` ימשיך להגיש אותה. שוק שמתבטל לגמרי מקבל שורת
‏301 ב-`_redirects` לשוק שמחליף אותו, ולא מחיקה.

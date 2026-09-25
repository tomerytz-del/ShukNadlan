---
name: market-go-live
description: הדלקת שוק מקומי לגולשים באתר שוק נדל״ן (למשל חיפה והקריות) - בדיקת הסף (משרד אחד ו-10 נכסים פעילים), live: true ב-assets/markets.js, העברת ה-_redirects מ-market-soon ל-index, השורה ב-sitemap.xml, והבדיקות שאחרי. Use when a market reached its inventory threshold, when asked to "open" or "launch" a region to buyers, when switching /haifa-krayot from "coming soon" to the real home page, or when check_markets.py fails on a live market.
---

# הדלקת שוק

שוק נולד **לא חי** (הסקיל `new-market`): הכתובת שלו מגישה "נפתחים בקרוב"
ב-noindex, ואף זיהוי אוטומטי אינו מפנה אליו. הדלקה הופכת אותו לדף הבית
של כל מי שנמצא/ת באזור - ולכן יש לה סף, ויש לה תנאי קוד.

## 0. שני תנאים שאינם במספרים

**א. דף הבית מסנן נכסים לפי שוק.** זה שלב 2 ב-`docs/regional-pages.md`.
בלעדיו `/haifa-krayot` מגיש את `index.html` עם **כל** הנכסים - כלומר את
נכסי עפולה תחת הכותרת "חיפה והקריות". `check_markets.py` חוסם הדלקה כל
עוד אין `MARKET_FILTER` ב-`assets/home.js`. **אל תוסיפו את המחרוזת כדי
לעבור את הבדיקה** - היא הסימן שהסינון קיים, לא הסינון עצמו.

**ב. הערים של השוק חיות במסד.** `cities_public` מציג רק `is_live`, והסינון
בדפדפן קורא משם את מזהי הערים (anon אינו רואה את `cities`). עיר חיה חייבת
`lat`/`lng` (`cities_live_needs_center_chk`) ו-slug אמיתי
(`cities_live_needs_real_slug_chk`) - כלומר את הזנת הלמ"ס, או קואורדינטות
ממקור רשמי. **לא מנחשים קואורדינטה כדי לעבור אילוץ.**

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

## 2. השינויים - ארבעה, באותו PR

| המקום | לפני | אחרי |
| --- | --- | --- |
| `assets/markets.js` | `live: false` | `live: true` |
| `_redirects` | `/haifa-krayot    /market-soon    200` | `/haifa-krayot    /index    200` |
| `sitemap.xml` | - | `<url><loc>https://shuknadlan.co.il/haifa-krayot</loc></url>` |
| מיגרציה | - | `update cities set is_live = true where market_slug = '...'` (אחרי תנאי ב) |

`check_markets.py` מצליב את שלושת הראשונים. ‏`market-pages.ts` אינו משתנה:
הוא קורא את `live` מהרשימה ומחליף בעצמו noindex ב-canonical עצמי.

**מה ההדלקה מדליקה מעצמה, ולכן כדאי לדעת:**

- **הפניה אוטומטית.** מי שה-GPS שלו/ה נמצא בשוק, או שבחר/ה אותו, מופנה/ית
  מ-`/` אליו. גם IP שנופל בתיבה שלו - מחשבים בבית ובעבודה. זה מיידי, ואין
  לו מתג נפרד.
- **גוגל.** הדף נכנס ל-sitemap עם canonical עצמי. `check_canonical.py`
  מכיר רק דפים סטטיים ועמודי תוצאות - אם הוא מתלונן על `/haifa-krayot`
  כ"אין דף סטטי כזה", צריך ללמד אותו את השווקים (לקרוא את `assets/markets.js`),
  לא להוריד את השורה מה-sitemap.

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

אותם ארבעה שינויים בכיוון ההפוך. **ה-slug נשאר** - הכתובת כבר בקישורים
ובעוגיות, ו-`market-soon` ימשיך להגיש אותה. שוק שמתבטל לגמרי מקבל שורת
‏301 ב-`_redirects` לשוק שמחליף אותו, ולא מחיקה.

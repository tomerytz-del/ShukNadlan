---
name: seo-edge
description: רינדור ל-SEO ב-edge של שוק נדל״ן - סטטוס בכשל (404 מול 503, בלי noindex על כשל זמני), מילוי HTML ראשון באותם id שה-JS כותב, שמירה על בלוק ב-sitemap, דף נחיתה עם מודעות (canonical ממסנן, noindex רק על רשימה ריקה), וכללי LCP/CLS (תמונת שער ב-HTML, מקום שמור, כרטיס ראשון, מפה עצלה). Use when changing neighborhood-page, deals-page, prices-page, og-tags, sitemap.ts, silo-page, search-pages, a detail page's initial HTML, the property hero, or the homepage map and neighborhood load.
---

# רינדור ל-SEO ב-edge

האתר הוא HTML סטטי, ופונקציות edge ממלאות אותו לפני שהסורק רואה אותו.
הכשל כאן שקט: הדף נטען, נראה תקין, וגוגל מקבלת 200 בלי התוכן או עם
כותרת גנרית. אין שגיאה בקונסול.

ארבעה כללים. כל אחד מהם נשבר בלי סימן.

## 1. סטטוס בכשל - 404, 503, או 200

החוזה של `neighborhood-page.ts` ו-`deals-page.ts`: `undefined` הוא כשל
זמני (timeout, `!res.ok`, זריקה). `null` הוא "המסד אמר שאין". אובייקט
הוא רשומה. **אין `noindex` על `undefined`.** ה-canonical נכתב מהכתובת
לפני הקריאה למסד, כדי שסופאבייס איטי לא יאחד דפים.

| מצב | סטטוס | `noindex` | מטמון |
| --- | --- | --- | --- |
| נתיב או slug לא תקין, או שהמסד אמר שאין (`null`) | 404 | כן | `no-store` בשתי הכותרות, בלי `Retry-After` |
| timeout, סטטוס שאינו 200, זריקה, או גוף שאינו אובייקט (כולל מערך) | 503 | **לא** | `no-store` בשתי הכותרות, `Retry-After: 60` |
| דף שאינו לאינדקס: שכונה בלי מודעה פעילה או מחוץ לשוק חי; יישוב עם פחות מ-5 עסקאות, בלי מודעה פעילה, או מחוץ לשוק חי (`lib/indexability.ts`, אותו כלל ב-sitemap) | 200 | כן | מטמון ההצלחה |
| מערך ריק (`prices`, אינדקס `/deals`, בלוק העסקאות ב-sitemap) | 200 | לא | מטמון ההצלחה |
| דף נחיתה או מדור מתווכים: המסד ענה במערך ריק | 200 | כן | `no-store` בשתי הכותרות, בלי `Retry-After` |
| אותו דף, כשל מסד (`undefined`) | 503 | **לא** | `no-store` בשתי הכותרות, `Retry-After: 60` |

שתי כותרות המטמון, תמיד ביחד: `Cache-Control` ו-`Netlify-CDN-Cache-Control`.
אחת בלי השנייה משאירה את התשובה ב-CDN. `Retry-After` רק על 503.

גוף ה-503 הוא מעטפת ה-HTML, כדי שה-JS בדפדפן עדיין יוכל למלא. לא דף
שגיאה חלופי, ולא `noindex`.

**דף נכס בלבד** (`og-tags.ts`, הנתיב נגמר ב-`/property`): חסר הוא 404
עם `noindex` ו-`no-store`; כשל מסד הוא 503 בלי `noindex`. שאר דפי
הפירוט (משרד, סוכן/ת, כתבה, פרויקט, יזם, בעל מקצוע) נשארים כמו שהם -
חסר הוא 200 עם `noindex`, וכשל מחזיר את התשובה המקורית. שאילתת
הסוכן/ת היא שאילתה שנייה, וכישלון שלה אינו מפיל את דף הנכס.

מערך ריק אינו "אין רשומה". גוף שאינו אובייקט אינו 404.

## 2. מילוי ה-HTML הראשון

מה שהסורק צריך לראות נכתב לתוך **אותם `id`** שה-JS כותב אחר כך
(`fillText` / `fillInner` / `unhide` ב-`og-tags.ts`). `fillText` נוגע
רק באלמנט שאין בתוכו תגיות. `fillInner` ממלא רק אלמנט ריק. תווית,
סדר גלולות וסדר הדגשות מועתקים מהדף, עם הערה שמצביעה על הקובץ
(‏`assets/property.js` אינו מודול). בלי אייקונים: ה-JS דורס את
ה-`innerHTML`, והסורק צריך את הטקסט.

‏H1 אחד. בלוק "לא נמצא" אינו כותרת, ואינו ב-DOM של דף שהצליח. הוא
נוצר כפסקה רק ב-404 או כשהדפדפן לא מצא את הרשומה.

## 3. בלוק ב-sitemap שלא נשמט בשקט

מקור GET שנכשל חוזר כרשימה ריקה. sitemap חלקי אינו מוחק מהאינדקס, ולכן
במקורות הרגילים חלקי עדיף על 500. כישלון של **כל** המקורות נופל אל
`sitemap.xml` הסטטי, ב-200.

בלוק "עסקאות לפי יישוב" הוא היוצא מן הכלל (`sitemap.ts`):

- POST אל `deal_settlements_public`, כמו `deals-page.ts`, עם timeout
  של 8 שניות. ה-GET ב-2.5 שניות נכשל בשקט.
- `200 []` הוא תשובה לגיטימית ונשאר 200, עם אפס בשורת הספירה.
- כשל (timeout, סטטוס שאינו 200, גוף שאינו מערך) **ויש כתובות ממקור
  אחר** יוצא 503, `Retry-After: 60`, ושתי כותרות `no-store`. לא
  מפרסמים 200 שבלוק העסקאות ריק בו והשאר מלא.
- הבדיקה שנופלת על ההשמטה השקטה: `scripts/sitemap_test.ts`.

## 4. וידאו ה-hero ו-LCP

תמונת השער היא ה-LCP: `<img class="bento-video-bg">` עם
`fetchpriority="high"`, בלי הפילטר של המחלקה עד שהנגן רץ. אין
`autoplay`. `preload="none"`. אין `src` בזמן הרינדור, ואין `play()`.

ה-`src` נקבע בלחיצה, או ב-idle **אחרי** `window` `load`
(‏`requestIdleCallback` עם timeout של כ-4000, ואחרת `setTimeout` של
כ-2000). ה-idle רק קובע `src` ואינו מנגן. הלחיצה הראשונה מנגנת
מושתק; לחיצה שאחריה משאירה את מתג ההשתקה. `prefers-reduced-motion`,
‏Save-Data ו-2G נשארים בלי קובץ (`heroVideoSource` מחזיר `null`).

## 5. CLS ו-LCP של תמונה

הכשלים כאן שקטים. הדף נראה תקין, והמספר מתגלה רק ב-Lighthouse.

### מקום שמור לפני שהתוכן נכנס

`#propertyContent{display:none}` עד שה-JS מצייר שם את `footer.site` במסך הראשון. כשהגוף נפתח הפוטר קופץ (נמדד סביב 0.9). `body.has-sticky-bar` שנוסף אחר כך מוסיף עוד 78px. בדף נכס **שנמצא**, `og-tags` מוסיף `property-ready` ו-`has-sticky-bar` כבר ב-HTML הראשון. 404 ו-503 לא מקבלים את המחלקות, כדי לא להציג שלד ריק.

קבוצות הפוטר הן `<details open>`. `site-footer.js` סוגר אותן אחרי הטעינה, וזה בעצמו הזזה. במובייל הן מוסתרות מהציור הראשון (`html.fold-cols` עד 559px, `html.fold-seo` עד 759px). לחיצה במסך הצר פותחת עם `is-open` בלי להוריד את `open`, כדי שבלי JS הכל נשאר פרוש.

### תמונת ה-LCP ב-HTML הראשון, לא אחרי ה-JS

תמונה שנוצרת ב-JS משלמת את השהיית הטעינה (נמדד כ-80% מ-LCP של 12 שניות). בדף נכס התמונה נכתבת ל-`#bentoGrid` עם `data-lcp` ו-`fetchpriority="high"`, ו-`<link rel="preload" as="image">` **לאותה כתובת**, בלי `crossorigin`. `preconnect` ל-Supabase פעמיים: בלי `crossorigin` לתמונה, ועם `crossorigin` ל-REST. אין `<video>` ואין `src` של סרטון ב-HTML הזה.

`data-count` זהה לזה ש-`renderGallery` יכתוב. ה-JS שומר את **אותו צומת** `img` רק אם ה-`src`, ה-`data-count` **וגם** פריסת הסרטון (`bento-video`) תואמים. `data-count` של שער עם סרטון ושל גלריה רגילה מתלכד כשיש שתי תמונות ומעלה. reduced-motion, Save-Data ו-2G לא ידועים לשרת, ולכן אי-התאמה של המחלקה בונה את הגלריה מחדש.

תמונה מ-`/storage/v1/object/public/` יורדת ב-`render/image`, לא כקובץ המלא. `src` ו-`preload` הם אותה כתובת: 800×500, `resize=cover`, איכות 60. `srcset` מוסיף 1200×800. `sizes` הוא `(min-width:640px) 640px, 100vw`. `posterForHero` ב-`assets/property.js` מחזיר את מחרוזת ה-800 הזו בדיוק. מחרוזת אחרת מוחקת את הצומת, והדפדפן מוריד שוב. `data-full` וה-`onerror` חוזרים למקור. `og:image` וה-JSON-LD נשארים על הקובץ המלא. כתובת שאינה מהאחסון לא משתנה. הטרנספורם הראשון של כתובת חדשה איטי (נמדד כ-679ms מול 38ms אחרי שהתוצאה נשמרה). אגודל עצל של אותה תמונה עדיין יכול להוריד את הקובץ המלא.

### כרטיס ראשון בדף שכונה

התמונה הראשונה מהאחסון שלנו (`IMG_HOST`) היא `fetchpriority="high"` ובלי `loading="lazy"`. השאר `loading="lazy"`. הקובץ המלא (מאות KB) מוחלף ב-`render/image`: רוחב 400 ו-800, גובה 250 ו-500, `resize=cover`, איכות 60, עם `srcset`. `onerror` מוריד את ה-`srcset` וחוזר לכתובת המקורית. `preload` מצביע על כתובת ה-800, אותה כתובת כמו `src`. תמונה שאינה מהאחסון שלנו לא נכנסת ל-`src`.

### מפת דף הבית

`heroMap` נוצר בטעינה. עשרות פונקציות בודקות `if (heroMap)`, ואתחול שנדחה משנה את הסדר שלהן. מה שנדחה הוא `MapLibre`: `MapTiles.addTo` מוריד כ-280KB גם כש-`#hero-map` הוא `display:none`. `armMapTiles` נקרא בפתיחת המפה, וגם מ-`IntersectionObserver` (מרווח 240px) אם המפה גלויה.

`neighborhoods` בטעינה בלי `boundary` (המצולע הוא רוב המשקל). העמודות שנשארות: `id,name,city,city_id,lat,lng,radius_m,is_planned`. בלי `is_planned` אזור בתכנון בלי נכסים חוזר לרשימה. `boundary` נטען ב-`drawHoodShapes` רק לשכונות שנבחרו; כשל מסמן `null` ומצייר עיגול.

סקריפטים שחסמו את הציור (Leaflet, supabase, כרטיסים) יושבים בסוף ה-`body`, עדיין בלי `defer`, מיד לפני `home.js`. `defer` היה מריץ את `home.js` לפניהם, או את גבריאלה לפני `home.js`.

תמונת ה-LCP של דף הבית היא רקע CSS על `#heroSection`: `hero-valley-800.webp` עד 759px, ו-`hero-valley.webp` משם. `preload` בלי `fetchpriority="high"` לא הקדים את ההורדה. מדידה ישנה: כ-420ms פחות ב-LCP וכ-320ms יותר ב-FCP. `media` על התג לא מספיק: ב-Lighthouse לנייד ירד גם `hero-valley.webp` (כ-260KB).

`city-context.js` ו-`bot-link.js` נשארים ב-`head`. `markets.js` יושב אחרי ה-CSS של התמונה ומיד לפני `CityContext.label()`: ההכרעה הראשונה נשמרת, ו-`market-pages` מזריק `SHUK_MARKET` לפני התג `src="assets/markets.js"`. סוף הדף היה נועל עיר לא נכונה. `auth-return.js` לפני `supabase.js`. `leaflet.css` עם `media="print"` ו-`onload` ל-`all` אינו חוסם את הציור הראשון.

גופן שנטען מראש צריך `crossorigin` גם מאותו דומיין, אחרת ההורדה כפולה. Heebo בדף הבית הוא קובץ משתנה אחד לכל `unicode-range`, והעברית היא מה שנטען מראש. `font-display` נשאר `swap`. אחסון מקומי לא שיפר את ה-FCP במדידה: חמשת הקבצים יורדים מאותו מקור כמו תמונת ה-LCP.

## 6. דף נחיתה עם המודעות

עמוד תוצאות ב-`search-pages.ts` רק מחליף כותרת, תיאור, canonical ו-H1 בתוך `index.html`. המודעות נשארות ב-JS. דף שגוגל כבר מדרגת דרך מסנן (`/?deal=sale&rooms=3` וחבריו) וצריך לאנדקס את המודעות עצמן הוא דף נפרד, באותו דפוס של דף שכונה.

- **הכתובת הציבורית נקובה, וההתאמה ב-Netlify מקודדת.** שורה עברית ב-`_redirects` וב-`config.path` לא נתפסת: הבקשה (`%D7...`) חוזרת 404 של הפלטפורמה, בלי שהפונקציה רצה. ב-`_redirects` יש שורה מקודדת אל המעטפת (`/silo` 200), בלי `/afula/*` שם, כי rewrite כזה היה מגיש גם את דף המתווכים מאותו קובץ. ב-`config.path` יש `/afula/*` (כמו `/n/*`). נתיב שאינו של הפונקציה חוזר מ-`context.next()` כמו שהוא, בלי 404: אחרת הפונקציה הראשונה בשרשרת בולעת את הדף השני. `/silo` בלי סוג נשאר 404 עם `noindex`.
- **ה-canonical של המסנן מצביע על הדף**, כולל שתי הצורות של גרש בסוג הנכס (`'` ו-`%27`, וגם גרש עברי). `matchKey` מנרמל אותן לאותו מפתח. שורה ב-`SEARCH_PAGES` עם `landing` כותבת את ה-canonical אל הדף ולא אל `/?query`.
- **הרשימה ב-HTML הראשון**, מאותו קובץ render שהדפדפן מריץ כשאין `data-ssr`. כרטיס ראשון עם מידות ו-`render/image`, כמו דף שכונה.
- **רשימה ריקה אינה כשל.** מערך ריק הוא 200 עם `noindex` ו-`no-store`, בלי `Retry-After`. זה שונה במכוון משורת `prices` בטבלה למעלה: שם דף ריק הוא הדף. כאן אין מה לאנדקס. `undefined` נשאר 503 בלי `noindex`, עם ה-canonical של הכתובת כבר כתוב.
- **שלושה בלוקי JSON-LD**, לא אחד במקום השני: `WebPage`, `BreadcrumbList`, `ItemList`. `<` בתוך JSON הוא `\u003c`. הבדיקה מפרסרת את שלושתם. `FAQPage` הוא בלוק רביעי, והשאלות זהות ל-`<details>` שבעמוד. הוא אינו מחליף אף אחד מהשלושה.
- **תמונת הגיבור** היא תמונת העמק, `fetchpriority="high"`, עם `srcset` ו-`preload` שמצביע עליה. הגובה בטלפון צר הוא `min(56svh, 460px)`, ומ-760px `min(460px, 100svh - 67px)` (שולחן נשאר 460px, טלפון לרוחב מתכווץ). לכרטיסים יש `width` ו-`height`, והם `loading="lazy"`.
- **השורה ב-sitemap סטטית** (`sitemap.xml`), בלי `lastmod`. לא מוסיפים את אותו URL גם כמקור ב-`sitemap.ts`: הוא היה מופיע פעמיים. `check_canonical.py` דורש את הכתובת ב-sitemap ואת הפונקציה ב-`OWN_EDGE`, ולא רושם את המעטפת כמקור דינמי.

מדור מתווכים (`/afula/מתווכים`) יושב על אותו חוזה סטטוס. ה-`ItemList` שלו הוא `LocalBusiness` + `RealEstateAgent`, ועוד `BreadcrumbList`. הוא אינו מחליף את `/about`.

## מה לא לערבב לכאן

מדיניות "שכונה דקה ב-sitemap", דף עיר `/n/{עיר}`, ו-HTML של רשימות שנבנה רק בדפדפן - החלטות נפרדות. שינוי שלהן אינו תיקון של הכללים למעלה. כללי ה-LCP של דף הבית יושבים בסעיף 5, לא כתוספת אגבית לתיקון סטטוס.

מיגרציה שמקצרת שאילתה של דף edge (טבלה מוכנה מראש) נכנסת רק כקובץ
ב-`supabase/migrations/`, עם version גדול מהאחרון ב-`main`, ואינה
מוחלת מהדשבורד. הסקיל `new-migration`.

## בדיקה

```sh
node --experimental-strip-types scripts/neighborhood_page_test.ts
node --experimental-strip-types scripts/deals_page_test.ts
node --experimental-strip-types scripts/prices_page_test.ts
node --experimental-strip-types scripts/og_tags_test.ts
node --experimental-strip-types scripts/sitemap_test.ts
node --experimental-strip-types scripts/property_hero_video_test.ts
node --experimental-strip-types scripts/silo_page_test.ts
node --experimental-strip-types scripts/search_pages_test.ts
```

התיעוד: `docs/neighborhood-pages.md`, `docs/settlement-deals.md`,
`docs/city-prices.md`, `docs/social-preview.md`, `docs/sitemap.md`,
`docs/property-marketing-video.md`, `docs/search-map-experience.md`,
`docs/search-landing-pages.md`.

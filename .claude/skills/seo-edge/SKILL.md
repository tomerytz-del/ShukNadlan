---
name: seo-edge
description: רינדור ל-SEO ב-edge של שוק נדל״ן - סטטוס בכשל (404 מול 503, בלי noindex על כשל זמני), מילוי HTML ראשון באותם id שה-JS כותב, שמירה על בלוק ב-sitemap, וכללי LCP לווידאו. Use when changing neighborhood-page, deals-page, prices-page, og-tags, sitemap.ts, a detail page's initial HTML, or the property hero video.
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
| דף דק: יש רשומה, ומעט תוכן (שכונה בלי נכסים ופחות מ-5 עסקאות; יישוב עם פחות מ-5) | 200 | כן | מטמון ההצלחה |
| מערך ריק (`prices`, אינדקס `/deals`, בלוק העסקאות ב-sitemap) | 200 | לא | מטמון ההצלחה |

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

## מה לא לערבב לכאן

מדיניות "שכונה דקה ב-sitemap", דף עיר `/n/{עיר}`, HTML של רשימות
שנבנה רק בדפדפן, ו-LCP של דף הבית - החלטות נפרדות. שינוי שלהן אינו
תיקון של הכללים למעלה.

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
```

התיעוד: `docs/neighborhood-pages.md`, `docs/settlement-deals.md`,
`docs/city-prices.md`, `docs/social-preview.md`, `docs/sitemap.md`,
`docs/property-marketing-video.md`.

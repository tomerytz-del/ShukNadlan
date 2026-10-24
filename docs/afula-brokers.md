# מתווכים בעפולה

`/about` דורג על "מתווכים בעפולה" ו"משרדי תיווך בעפולה" כי לא היה דף
שעונה על החיפוש. `/agencies` ו-`/agents` נטענים ב-JS.

`/afula/מתווכים` הוא דף אחד (`brokers.html`, שורת 200 ב-`_redirects`,
גם בצורתה המקודדת). נתיב עברי לבדו לא נתפס ב-Netlify. הפונקציה רצה על
`/afula/*` ומחזירה נתיב אחר כמו שהוא, כדי לא לבלוע דף נחיתה.
`netlify/edge-functions/brokers-page.ts` ממלא אותו לפני שהסורק רואה אותו:

- משרדים ש-`city_id` שלהם הוא עפולה. RLS של `agencies` כבר מחזיר רק משרד
  עם רישיון בתוקף (`agency_is_live`). הטבלה `cities` אינה קריאה לאנונימי,
  ולכן מזהה העיר יושב ב-`assets/brokers-render.js`.
- מתווכים מ-`agency_members_public` ששייכים למשרדים האלה.
- מספר נכסים פעילים מ-`homepage_agency_cards`, כשהקריאה מצליחה.

כשל בשאילתת המשרדים הוא 503, `Retry-After: 60`, שתי כותרות `no-store`,
בלי `noindex`. כשל במתווכים או בספירה אינו מפיל את הדף. רשימת משרדים
ריקה אחרי תשובה מהמסד היא 200 עם `noindex`.

JSON-LD: `WebPage`, `BreadcrumbList`, ו-`ItemList` של `LocalBusiness`
ו-`RealEstateAgent`. הקישור לדף יושב ב-`/about`, ב-`/agencies` ובפוטר.
כותרת `/about` מתארת את הפלטפורמה, והגוף שלו לא נמחק.

```sh
node --experimental-strip-types scripts/brokers_page_test.ts
```

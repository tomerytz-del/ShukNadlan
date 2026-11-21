# חשיפה למנועי AI

מה מאפשר למנועי AI (ChatGPT, Perplexity, Claude, Gemini) למצוא את האתר ולצטט אותו,
ומה נבדק ב-CI. הביקורת המלאה על האתר החי: הסקיל `seo-geo-aeo`, ‏`docs/seo-audits/`.

## מה יש

| רכיב | איפה | הערה |
| --- | --- | --- |
| מפת האתר למנועי AI | `llms.txt` | נכתב ביד. `_headers` מכריז `charset=utf-8` |
| `robots.txt` | שורש הריפו | `User-agent: *` בלבד. אין חסימה של סורק AI בשמו |
| JSON-LD | דפי HTML ופונקציות `netlify/edge-functions/` | הרשימה בסקיל `seo-edge` |

## הבדיקה

`python scripts/check_ai_visibility.py`, ב-workflow ‏`ai_visibility.yml`:

1. אין `Disallow` ב-`robots.txt` (לא ב-`*` ולא בסורק בשמו) שחוסם דף ציבורי.
2. אין `X-Robots-Tag` על `llms.txt`, `robots.txt` או `sitemap.xml`.
3. כל קישור ב-`llms.txt` מגיע לדף שקיים.
4. כל דף סטטי ב-`sitemap.xml` מופיע ב-`llms.txt`, חוץ מ-`NOT_IN_LLMS` בבדיקה.

## חסימת בוטים על ה-CRM

חסימת בוטים ברמת Netlify, ה-CDN או ה-WAF אינה בריפו, ולכן הבדיקה לא רואה אותה.
הכלל: **החסימה חלה על נתיבי האזור האישי בלבד** (`/crm`, `/developer-crm`,
`/professional-crm`, `/professional-manage`, `/csm`, וכן `/sign`, `/showcase`, `/m/`,
`/meeting`, `/plan`, `/cma`, `/owner-report`, `/learn`), ולא על האתר.

- חסימה גורפת של סורקים לפי user-agent על כל הדומיין מוחקת את האתר מתשובות AI בלי שום
  שגיאה גלויה.
- חייבים להישאר פתוחים לכל סורק: `/robots.txt`, ‏`/sitemap.xml`, ‏`/llms.txt`, וכל
  דף ציבורי.
- ‏`robots.txt` אינו חסימה אמיתית: בוט חשוד מתעלם ממנו. מי שחוסם בוטים זדוניים עושה
  זאת בשכבת הרשת, ורק על נתיבי ה-CRM.

## עובדות ש-`llms-full.txt` משכפל, ושמתעדכנות יחד

הקובץ נכתב ביד ולכן מתיישן בשקט. כשאחד מאלה משתנה, מעדכנים גם אותו (ואת `llms.txt` אם יש שורה):

- השווקים הפתוחים (`assets/markets.js`, `live`) ואיזה שוק "פתוח לגולשים".
- פרטי הקשר, הכתובת והטלפון (`about.html`).
- חלון העסקאות (12 חודשים) וסף התא (5 עסקאות): `docs/city-prices.md`.
- "חינמי למי שמחפש נכס" והמודל העסקי (`about.html`, `faq.html`).
- פרטי המייסד: מספר הרישיון, "15 שנה", הפרס והקהילות (`about.html`).

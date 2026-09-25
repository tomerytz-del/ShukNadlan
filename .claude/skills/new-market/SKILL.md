---
name: new-market
description: פתיחת שוק מקומי חדש באתר שוק נדל״ן (אזור כמו "חיפה והקריות", "עפולה והעמק") או הוספת עיר לשוק קיים - השורה ב-assets/markets.js, המיגרציה ששייכת ערים, ה-_redirects, ה-config.path של market-pages.ts, בדיקת ה-GPS, ונתוני העיר (גאוקוד, רחובות, שכונות, עסקאות). Use when adding a new region/market or city, onboarding offices in a new area, when a URL like /krayot or /nazareth-area is needed, when properties in a new city don't appear under any market, or when cities.market_slug needs changing.
---

# שוק מקומי חדש

"שוק" הוא מה שהגולש/ת רואה כשהאתר נפתח - "עפולה והעמק", "חיפה והקריות".
**הוא אינו `areas`** (היקף השת״פ במסלול Pay&GO, רחב בכוונה) **ואינו עיר**
(חיפה והקריות הן שבע רשויות). הרקע המלא: `docs/regional-pages.md`.

שוק חדש נולד **לא חי**: הכתובת שלו מגישה דף "נפתחים בקרוב" ב-noindex,
וזה הקישור לגיוס המשרדים באזור. ההדלקה לגולשים היא תהליך נפרד, אחרי שיש
מלאי - הסקיל `market-go-live`.

## חמשת המקומות, וכולם חייבים להסכים

| # | המקום | מה נשבר בלעדיו |
| --- | --- | --- |
| 1 | `assets/markets.js` - שורה ב-`MARKETS` | אין שוק. כל השאר נגזר מכאן |
| 2 | מיגרציה: `cities.market_slug` לערי השוק | השוק אינו מסנן כלום, ותצוגת המנהל/ת ריקה |
| 3 | `_redirects`: `/<slug>  /market-soon  200` | הכתובת היא 404 |
| 4 | `config.path` ב-`netlify/edge-functions/market-pages.ts` | הדף יוצא בלי שם השוק, בלי תגיות שיתוף **ובלי noindex** |
| 5 | `scripts/markets_test.ts` - מקרה `locate` לנקודה בשוק | כפתור ה-GPS עלול לשלוח את האזור לשוק אחר, ואף בדיקה לא תראה |

```sh
python scripts/check_markets.py                               # 1-4 מסכימים
node --experimental-strip-types scripts/markets_test.ts       # 5 וההתנהגות
```

שתיהן רצות ב-CI (`.github/workflows/markets.yml`).

## 1. השורה ב-`assets/markets.js`

```js
{
  slug: 'krayot',
  label: 'הקריות',
  path: '/krayot',
  live: false,
  isDefault: false,
  center: [32.84, 35.08],
  zoom: 13,
  bbox: [32.80, 35.04, 32.88, 35.13],   // [lat_min, lng_min, lat_max, lng_max]
  title: 'שוק נדל״ן | הקריות',
  description: '...'
}
```

- **`slug` שפורסם אינו משתנה לעולם** - הוא בקישורים ששלחתם בוואטסאפ, בעוגיות
  של גולשים וב-`cities.market_slug`. אותיות לטיניות קטנות ומקף.
  ‏`path` הוא תמיד `/` + slug.
- **`center` ו-`bbox` הם מסגור, לא עובדות.** המרכז הוא מה שהמפה תיפתח עליו.
  התיבה עונה רק על "האם נקודת GPS שייכת לשוק הזה", ולכן **רחבה מהערים**:
  מי שגר/ה מטר מחוץ לגבול המוניציפלי עדיין שייך/ת. נקודה מחוץ לכל תיבה
  עוברת לשוק הקרוב עד `NEAR_KM` (‏25 ק"מ).
- **תיבות של שני שווקים לא חופפות.** `locate` מחזיר את **הראשון** שהנקודה
  בתיבה שלו - חפיפה פירושה שסדר השורות בקובץ מחליט לאיזה שוק גולש/ת נשלח/ת.
- **‏`description` בין 70 ל-160 תווים, ובלי מקף ארוך** (`check_long_dash.py`).
- **אין `export` בקובץ.** הוא נטען כ-`<script src>` רגיל בדפדפן, ו-`export`
  הוא שגיאת תחביר שם - שמפילה את כל הדפים שטוענים אותו. ה-edge מייבא אותו
  לתופעת הלוואי (`globalThis.ShukMarkets`).

## 2. המיגרציה ששייכת ערים

הסקיל `new-migration` חל במלואו. התבנית, מ-`20270112090000_markets.sql`:

```sql
insert into public.cities (area_id, name, slug, market_slug, source)
select a.id, v.name, v.slug, v.market, 'manual'
  from (values
    ('haifa-galil-mar', 'קריית אתא', 'kiryat-ata', 'krayot')
  ) as v(area_slug, name, slug, market)
  join public.areas a on a.slug = v.area_slug
on conflict (slug) do update
   set market_slug = coalesce(public.cities.market_slug, excluded.market_slug);
```

ואחריה ההשלמה - בלעדיה נכסים ומשרדים שכבר קיימים בערים האלה לא ייספרו:

```sql
do $$ declare v int; begin
  loop v := public.properties_backfill_city_id(200); exit when v = 0; end loop;
end $$;
select * from public.agencies_backfill_city_id();
update public.neighborhoods n set city_id = public.city_id_for_name(n.city)
 where n.city_id is null and public.city_id_for_name(n.city) is not null;
```

**המלכודות שנתפסו כאן:**

- **`source` מקבל רק `seed`, `gov` או `manual`** (`cities_source_chk`). עיר
  שמוסיפים ביד היא `manual`. ערך אחר מפיל את כל המיגרציה.
- **העיר כבר קיימת?** (אחרי הזנת הלמ"ס, או משוק אחר) - אל תכניסו שורה שנייה.
  ‏`cities_name_key_uniq` יפיל אותה, וזה רצוי. הכתיב הנכון הוא `update
  public.cities set market_slug = ... where name_key = public.city_name_key('...')`.
- **עיר עוברת בין שווקים?** ה-`coalesce` למעלה **אינו** דורס שיוך קיים -
  בכוונה, כדי שהרצה חוזרת לא תבטל החלטה של מנהל/ת. מעבר הוא `update` מפורש.
- **אל תנחשו קואורדינטות, סמל יישוב או אוכלוסייה.** שורה ידנית נושאת שם, אזור,
  slug ושוק בלבד. העובדות מגיעות מקובץ הלמ"ס (`docs/cities-and-regions.md`,
  "הזנת הערים"), וההזנה משלימה את השורה לפי `name_key`.
- **אל תשכתבו את `properties.city`** לשם הקנוני. `client_property_match` משווה
  טקסט, ויישור צד אחד מנתק התאמות בשקט.
- **"קרית" / "קריית"** מתכנסות לבד (`city_name_key` מכווץ יו"ד כפולה). שם
  חלופי אמיתי ("תל אביב" / "תל אביב-יפו", "זכרון" / "זיכרון") הוא שורה
  ב-`city_aliases`, לא הרחבה של המפתח.
- **אזור (`area_id`) הוא לא שוק.** בחרו את ה-`areas.slug` שהעיר שייכת אליו
  מנהלית (11 האזורים ב-`20261210090000_cities_regions.sql`).

## 3-4. הכתובת

```
/krayot    /market-soon    200
```

ב-`_redirects`, ו-`"/krayot"` במערך `config.path` של `market-pages.ts`
(ליטרל - Netlify קורא אותו בזמן הבנייה, ולכן אי אפשר לגזור אותו מהרשימה).

## 5. מקרה `locate` בבדיקה

נקודה אחת לפחות בתוך השוק החדש, ואחת **בגבול עם השוק השכן** - שם טעויות
תיבה מתגלות:

```ts
check("קריית מוצקין → krayot", reg.locate(32.8378, 35.0795)?.slug === "krayot");
```

## נתוני העיר - מה שהופך דף ריק לשוק

בלי אלה השוק קיים, אבל המתווכים באזור עובדים קשה יותר ממה שצריך:

| מה | איך | מה קורה בלעדיו |
| --- | --- | --- |
| פין לנכס בשמירה | **כבר עובד**: טופס הנכס ב-CRM שואל את GovMap בדפדפן לכל עיר שאינה עפולה (`crm.js`, ‏`GovmapLookup`) | - |
| פין בהשלמה האוטומטית | שורה ב-`city_geocode_sources` - **רק** כשיש ספק ממומש לסוג שלה | נכס שיובא בקובץ נשאר בלי פין |
| רחובות | אין עדיין טוען GovMap (`docs/govmap.md` שלב 2); הטופס מקבל טקסט חופשי | אין השלמה אוטומטית של רחוב |
| שכונות | CRM ← ניהול שכונות, **עם בחירת העיר**; גבול על המפה ב-`/neighborhood-boundary` | בלי שכונות אין סינון לפי שכונה |
| עסקאות רשמיות | הדבקה ידנית מ-GovMap ב-CRM, ו-`DEALS_CITIES` ב-GitHub vars | דוח ה-CMA בשוק בלי השוואות |
| מבזקים | היקף החדשות הוא `afula`/`region`/`national` - שוק חדש מקבל ארצי בלבד | אין מבזקים מקומיים (שלב 4) |

**שתי מלכודות בטבלה הזו:**

- **אל תדליקו שורה ב-`city_geocode_sources` בלי ספק ממומש.** היום יש רק
  `municipal_wfs` (עפולה). שורה פעילה מסוג `govmap` נכנסת לתור, ו-
  `geocodeAddress` זורקת עליה "אין מימוש" בכל סבב. `docs/geocoding.md`.
- **GovMap מחזיר רק 1,500 עסקאות אחרונות ליישוב.** בעיר גדולה זה כמה חודשים,
  לא שנתיים - `market_deals_coverage()` תראה טווח קצר. ‏`docs/market-deals-official.md`.

## משרד שלא מופיע בשוק

משרד משויך לעיר לפי **הכתובת הרשומה** שלו (`agencies.city_id`, מ-
`city_id_from_address`), ואם אין כתובת - לפי העיר השכיחה בנכסים הפעילים
שלו. משרד חדש בלי כתובת ובלי נכסים **לא יופיע** בתצוגת השוק. הפתרון הוא
כתובת במשרד, או `update agencies set city_id = ...` ידני - הטריגר אינו
דורס שיוך קיים.

## בסוף

1. `python scripts/check_markets.py` ו-`markets_test.ts` - ירוקים.
2. `docs/regional-pages.md` - שורה בטבלת השווקים (סעיף 1) עם הערים שאושרו.
3. אחרי המיזוג: **Actions** (המיגרציה), ואז CRM ← תצוגת מנהל/ת ← שווקים
   מקומיים ← השוק החדש. שם רואים את הערים, המשרדים, כמה חסר עד הפתיחה,
   ואת הקישור להפצה.
4. בדיקת מצב מהירה ב-SQL: `.claude/skills/new-market/status.sql`.

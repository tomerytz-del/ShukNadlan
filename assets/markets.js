/* ============================================================================
   השווקים המקומיים - הרשימה הסגורה

   ‏"שוק" הוא מה שהגולש/ת רואה כשהאתר נפתח: "עפולה והעמק", "חיפה והקריות".
   הוא אינו `areas` (היקף השת״פ) ואינו עיר - חיפה והקריות הן שבע רשויות.
   ‏docs/regional-pages.md.

   ## מקור אחד לשרת ולדפדפן

   הקובץ נטען כ-`<script src>` רגיל בדפדפן, **ומיובא** בשתי פונקציות ה-edge
   (`search-pages.ts`, `market-pages.ts`) כייבוא לצורך תופעת הלוואי שלו. שתי
   רשימות שצריכות להסכים הן רשימה אחת שמתיישנת - הכלל שכבר נלמד ב-
   `maskHouseNumber` וב-`SEARCH_PAGES`. לכן אין כאן `export`: קובץ עם
   `export` הוא שגיאת תחביר בדפדפן כשהוא נטען כ-`<script src>` רגיל.

   ## מה כאן ומה במסד

   כאן: המזהה, הטקסטים, מרכז המפה, תיבת הזיהוי ו-`live`. במסד:
   `cities.market_slug` - איזו עיר שייכת לאיזה שוק, כי הסינון נעשה שם.
   ‏`scripts/check_markets.py` מצליב, ומוודא גם ש-`_redirects` ו-
   `market-pages.ts` מכירים כל שוק שאינו ברירת המחדל.

   ## ‏`center` ו-`bbox` הם מסגור, לא עובדות

   מרכז התצוגה נבחר ביד, בדיוק כמו AFULA_CENTER שקדם לו - הוא אינו
   "מרכז העיר" ואינו ראיה לדבר (docs/cities-and-regions.md, ‏ITM). התיבה
   עונה על שאלה אחת: "האם נקודה נמצאת בשוק הזה", ולכן היא רחבה מהערים
   עצמן ובכוונה - מי שגר/ה בקצה הקריות שייך/ת לשוק גם אם הנקודה שלו/ה
   נופלת מטר מחוץ לגבול המוניציפלי.

   ## ‏`live`

   שוק חי מופיע בזיהוי האוטומטי (IP ו-GPS מפנים אליו) וב-sitemap. שוק שאינו
   חי מגיש דף "נפתחים בקרוב" ב-noindex, ומשמש לגיוס המשרדים של האזור - כי
   דף עם אפס נכסים גרוע מאין דף (docs/cities-and-regions.md, `is_live`).
   הכלל להדלקה: משרד אחד לפחות ו-10 נכסים פעילים בערי השוק.
   ============================================================================ */
(function (g) {
  'use strict';

  var MARKETS = [
    {
      slug: 'afula-emek',
      label: 'עפולה והעמק',
      path: '/',
      live: true,
      isDefault: true,
      center: [32.6078, 35.2897],
      zoom: 13,
      /* [lat_min, lng_min, lat_max, lng_max] - עפולה ועמק יזרעאל */
      bbox: [32.50, 35.15, 32.72, 35.45],
      title: 'שוק נדל״ן | עפולה והעמק',
      description: 'העסקה הבאה שלך בעפולה מתחילה בשוק הנדל״ן - כל הדירות, כל המתווכים, בכתובת אחת.'
    },
    {
      slug: 'haifa-krayot',
      label: 'חיפה והקריות',
      path: '/haifa-krayot',
      live: false,
      isDefault: false,
      center: [32.805, 35.03],
      zoom: 12,
      /* חיפה, נשר, טירת כרמל והקריות - מחוף הכרמל ועד קריית אתא */
      bbox: [32.72, 34.94, 32.89, 35.13],
      title: 'שוק נדל״ן | חיפה והקריות',
      description: 'שוק הנדל״ן של חיפה והקריות - כל הדירות, כל המתווכים, בכתובת אחת. נפתחים בקרוב בחיפה, בנשר ובקריות.'
    }
  ];

  /* עד המרחק הזה משוק, נקודה מחוץ לתיבה עדיין שייכת אליו. מעבר לו - "עוד
     לא הגענו לאזור שלך", ולא הפניה לשוק שנמצא שעה נסיעה משם. */
  var NEAR_KM = 25;

  function bySlug(slug) {
    for (var i = 0; i < MARKETS.length; i++) {
      if (MARKETS[i].slug === slug) return MARKETS[i];
    }
    return null;
  }

  function byPath(path) {
    var p = String(path || '').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    if (p === '/index') p = '/';
    for (var i = 0; i < MARKETS.length; i++) {
      if (MARKETS[i].path === p) return MARKETS[i];
    }
    return null;
  }

  function defaultMarket() {
    for (var i = 0; i < MARKETS.length; i++) {
      if (MARKETS[i].isDefault) return MARKETS[i];
    }
    return MARKETS[0];
  }

  function inBox(m, lat, lng) {
    var b = m.bbox;
    return lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];
  }

  /* מרחק קו אווירי בק"מ. לבחירת שוק זה מדויק מספיק בהרבה. */
  function km(lat1, lng1, lat2, lng2) {
    var r = Math.PI / 180;
    var dLat = (lat2 - lat1) * r;
    var dLng = (lng2 - lng1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* השוק של נקודה: תיבה קודם, ואז הקרוב ביותר עד NEAR_KM. `onlyLive` -
     לזיהוי האוטומטי, שאסור לו להפנות לשוק שעוד לא נפתח. */
  function locate(lat, lng, onlyLive) {
    lat = Number(lat); lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var pool = MARKETS.filter(function (m) { return !onlyLive || m.live; });
    for (var i = 0; i < pool.length; i++) {
      if (inBox(pool[i], lat, lng)) return pool[i];
    }
    var best = null, bestKm = Infinity;
    for (var j = 0; j < pool.length; j++) {
      var d = km(lat, lng, pool[j].center[0], pool[j].center[1]);
      if (d < bestKm) { best = pool[j]; bestKm = d; }
    }
    return bestKm <= NEAR_KM ? best : null;
  }

  g.ShukMarkets = {
    list: MARKETS,
    NEAR_KM: NEAR_KM,
    bySlug: bySlug,
    byPath: byPath,
    defaultMarket: defaultMarket,
    locate: locate,
    km: km
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

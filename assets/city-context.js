/* ============================================================================
   העיר הפעילה

   האתר מציג **עיר אחת**, והעיר היא משתנה. הקובץ הזה הוא המקום היחיד שיודע
   איזו עיר זו, ומחליף שלושה עותקים של AFULA_CENTER שישבו ב-assets/home.js,
   ב-agencies.html וב-neighborhood-boundary.html.

   ## שרשרת ההכרעה, וכולה סינכרונית

     1. ‏?city=<slug>            קישור עמוק
     2. ‏localStorage            מה שנבחר בביקור הקודם
     3. ‏cookie shuk_geo         מה שה-edge זיהה לפי IP
     4. ברירת מחדל: עפולה

   **שלושתן סינכרוניות, וזו כל התכנית נגד ריצוד.** המפה מאותחלת פעם אחת על
   המרכז הנכון ואינה מוזזת אחרי הציור. ‏GPS אינו בשרשרת הזו בכוונה: הוא
   אסינכרוני ודורש הרשאה, ולכן הוא רץ **רק בלחיצה מפורשת** ומעדכן אחר כך.

   ## למה הקואורדינטה נוסעת עם המזהה

   הרישום (`cities_public`) נטען מהמסד, כלומר אסינכרונית. אם המזהה בלבד
   היה נשמר, כל ביקור היה נפתח על ברירת המחדל וזז אחרי שהרישום מגיע - וזה
   בדיוק הריצוד שהקובץ הזה נועד למנוע. לכן `localStorage` והעוגייה נושאים
   `slug|lat|lng|zoom|label`, וההכרעה אינה ממתינה לרשת.

   ## ‏`cities` ריקה היום, וזה מצב תקין

   מיגרציית ההזנה טרם רצה, ולכן `all()` מחזירה רשימה ריקה והשרשרת נופלת
   לברירת המחדל. ההתנהגות זהה לחלוטין למה שהייתה לפני הקובץ הזה, וזה
   הקריטריון: כל עוד הרישום ריק, אסור שמשהו ייראה אחרת.
   ============================================================================ */
(function (global) {
  'use strict';

  /* ברירת המחדל. אלה בדיוק הערכים שישבו ב-home.js, ולכן הדף נפתח על אותה
     נקודה ובאותו זום כמו קודם. */
  var DEFAULT_CITY = {
    slug: 'afula',
    name: 'עפולה',
    label: 'עפולה והעמק',
    lat: 32.6078,
    lng: 35.2897,
    zoom: 13
  };

  var STORAGE_KEY = 'shuk_city';
  var COOKIE_NAME = 'shuk_geo';
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  var active = null;
  var registry = null;      // ‏cities_public, כשהוא נטען
  var registryPromise = null;

  function clampNum(v, min, max) {
    var n = Number(v);
    return (isFinite(n) && n >= min && n <= max) ? n : null;
  }

  /* ‏slug|lat|lng|zoom|label — פורמט אחד ל-localStorage ולעוגייה, כדי
     ששתי השכבות לא יתפצלו. שדה פגום פוסל את כל הרשומה: עיר חלקית שנפתחת
     על קואורדינטה שגויה גרועה מנפילה לברירת המחדל. */
  function decode(raw) {
    if (!raw) return null;
    var p = String(raw).split('|');
    if (p.length < 3) return null;
    var slug = String(p[0] || '').trim();
    if (!SLUG_RE.test(slug)) return null;
    var lat = clampNum(p[1], -90, 90);
    var lng = clampNum(p[2], -180, 180);
    if (lat === null || lng === null) return null;
    return {
      slug: slug, lat: lat, lng: lng,
      zoom: clampNum(p[3], 3, 18) || DEFAULT_CITY.zoom,
      label: (p[4] || '').trim() || slug,
      name: (p[4] || '').trim() || slug
    };
  }

  function encode(city) {
    return [city.slug, city.lat, city.lng, city.zoom, city.label || city.name].join('|');
  }

  function readStore() {
    try { return decode(localStorage.getItem(STORAGE_KEY)); }
    catch (e) { return null; }   // מצב פרטי או אחסון חסום
  }

  function writeStore(city) {
    try { localStorage.setItem(STORAGE_KEY, encode(city)); }
    catch (e) { /* אין מה לעשות, וההכרעה עובדת גם בלי */ }
  }

  function readCookie() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)shuk_geo=([^;]+)/);
      return m ? decode(decodeURIComponent(m[1])) : null;
    } catch (e) { return null; }
  }

  function fromQuery() {
    try {
      var slug = new URLSearchParams(location.search).get('city');
      if (!slug || !SLUG_RE.test(slug)) return null;
      /* קישור עמוק נושא מזהה בלבד. אם הוא במקרה העיר ששמורה אצלנו, יש לנו
         גם את הפין; אחרת נחזיר שלד, והמפה תתמקם כשהרישום יגיע. זה המסלול
         היחיד שבו ייתכן מרכוז מאוחר, והוא נדיר: ביקור ראשון בעיר מקישור. */
      var saved = readStore() || readCookie();
      if (saved && saved.slug === slug) return saved;
      return { slug: slug, lat: null, lng: null, zoom: DEFAULT_CITY.zoom, label: null, name: null };
    } catch (e) { return null; }
  }

  /* ---------- השווקים (docs/regional-pages.md) ----------

     מאז שיש יותר משוק אחד, **הכתובת היא מקור האמת לשוק שהדף מציג**:
     ‏`/haifa-krayot` מציג את חיפה והקריות, ו-`/` את ברירת המחדל. בחירה
     שמורה, תוצאת GPS וזיהוי IP אינם מחליפים את מה שהדף מציג - הם קובעים
     **לאן מפנים**, וההפניה נעשית בשרת (`search-pages.ts`) לפני שהדף נטען.

     הסיבה: דף שהכתובת שלו אומרת "עפולה" והכותרת שלו "חיפה" אי אפשר לשתף,
     אי אפשר לאנדקס, ואי אפשר לסמוך עליו. ובשלב הזה דף הבית עוד אינו מסנן
     נכסים לפי שוק - שם בחיפה מעל נכסי עפולה היה שקר.

     ‏localStorage והעוגייה עדיין נקראים - בדפים שאינם שייכים לשוק
     (`/agencies`, `/agents`) - אבל רק כשהם מצביעים על שוק **חי**. */

  var MARKET_COOKIE = 'shuk_market';

  function markets() { return global.ShukMarkets || null; }

  /* שוק ברישום → הצורה שהשרשרת כאן מכירה. */
  function fromMarket(m) {
    if (!m) return null;
    return {
      slug: m.slug, name: m.label, label: m.label,
      lat: m.center[0], lng: m.center[1], zoom: m.zoom || DEFAULT_CITY.zoom,
      market: m
    };
  }

  /* רשומה שמורה עוברת רק אם היא שוק חי שהרישום מכיר. רשומה של עיר (לפני
     השווקים) או של שוק שנסגר נופלת לברירת המחדל - בלי להחיל אותה חלקית. */
  function liveMarketOf(c) {
    var M = markets();
    if (!c || !M) return null;
    var m = M.bySlug(c.slug);
    return (m && m.live) ? m : null;
  }

  function pageMarket() {
    var M = markets();
    var injected = global.SHUK_MARKET;
    if (injected && M && M.bySlug(injected.slug)) return M.bySlug(injected.slug);
    if (!M) return null;
    try { return M.byPath(location.pathname); } catch (e) { return null; }
  }

  function writeMarketCookie(slug, source) {
    try {
      document.cookie = MARKET_COOKIE + '=' + encodeURIComponent(slug + '|' + source) +
        '; Max-Age=31536000; Path=/; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) { /* בלי עוגייה ההפניה בשרת לא תדע, והבחירה עדיין חלה כאן */ }
  }

  function resolve() {
    var M = markets();
    if (M) {
      var onPage = pageMarket();
      if (onPage) return Object.assign(fromMarket(onPage), { source: 'path' });
      var kept = liveMarketOf(readStore()) || liveMarketOf(readCookie());
      if (kept) return Object.assign(fromMarket(kept), { source: 'stored' });
      return Object.assign(fromMarket(M.defaultMarket()), { source: 'default' });
    }

    /* ‏markets.js לא נטען: השרשרת הישנה, כמו שהייתה. */
    var c = fromQuery() || readStore() || readCookie();
    if (!c) return Object.assign({}, DEFAULT_CITY, { source: 'default' });
    /* שלד מקישור עמוק, בלי פין: מחזיקים את המזהה ונופלים לברירת המחדל
       לתצוגה, עד ש-hydrate() ימצא אותו ברישום. */
    if (c.lat === null || c.lng === null) {
      return Object.assign({}, DEFAULT_CITY, { slug: c.slug, pending: true, source: 'query' });
    }
    return Object.assign({ source: 'stored' }, c);
  }

  var CityContext = {
    DEFAULT: DEFAULT_CITY,

    /** העיר הפעילה. סינכרוני תמיד, ולעולם אינו null. */
    active: function () {
      if (!active) active = resolve();
      return active;
    },

    center: function () { var c = this.active(); return [c.lat, c.lng]; },
    zoom:   function () { return this.active().zoom || DEFAULT_CITY.zoom; },

    /** ‏display_label - מה שנכנס ל-H1. "עפולה והעמק" אינו "עפולה". */
    label: function () { var c = this.active(); return c.label || c.name || DEFAULT_CITY.label; },
    name:  function () { var c = this.active(); return c.name || c.label || DEFAULT_CITY.name; },

    isDefault: function () {
      var a = this.active();
      if (a.market) return !!a.market.isDefault;
      return a.slug === DEFAULT_CITY.slug;
    },

    /** השוק שהדף מציג, או null כשהרישום לא נטען. */
    market: function () { return this.active().market || null; },

    /** בחירה מפורשת של שוק (בורר, "לשוק של עפולה") או תוצאת GPS.
        נשמרת ב-localStorage לדפים בלי שוק, ובעוגייה - כדי שההפניה בשרת
        תכיר אותה בביקור הבא. **אינה מחליפה את מה שהדף הנוכחי מציג**:
        הקורא/ת מנווט/ת לכתובת של השוק. `source`: ‏choice | gps. */
    choose: function (m, source) {
      if (!m || !SLUG_RE.test(String(m.slug || ''))) return null;
      var src = source === 'gps' ? 'gps' : 'choice';
      writeStore(fromMarket(m));
      writeMarketCookie(m.slug, src);
      return m;
    },

    /** קביעת העיר הפעילה ושמירתה לביקור הבא. אינה מרעננת את הדף. */
    set: function (city) {
      if (!city || !SLUG_RE.test(String(city.slug || ''))) return this.active();
      var next = {
        slug: city.slug,
        name: city.name || city.label || city.slug,
        label: city.display_label || city.label || city.name || city.slug,
        lat: clampNum(city.lat, -90, 90),
        lng: clampNum(city.lng, -180, 180),
        zoom: clampNum(city.default_zoom || city.zoom, 3, 18) || DEFAULT_CITY.zoom,
        source: 'set'
      };
      if (next.lat === null || next.lng === null) return this.active();
      active = next;
      writeStore(next);
      return active;
    },

    /** כל הערים החיות. ריק כל עוד הרישום לא הוזן, וזה מצב תקין. */
    all: function (sb) {
      if (registry) return Promise.resolve(registry);
      if (registryPromise) return registryPromise;
      if (!sb) return Promise.resolve([]);
      registryPromise = sb.from('cities_public').select('*')
        .then(function (res) {
          registry = (res && !res.error && res.data) ? res.data : [];
          return registry;
        })
        .catch(function () { registry = []; return registry; });
      return registryPromise;
    },

    /** מחוז → אזור → ערים, לתפריט הבורר. */
    byRegion: function (sb) {
      return this.all(sb).then(function (rows) {
        var out = [];
        var byRegion = new Map();
        rows.forEach(function (c) {
          if (!byRegion.has(c.region_slug)) {
            var r = { slug: c.region_slug, name: c.region_name, sort: c.region_sort, areas: new Map() };
            byRegion.set(c.region_slug, r); out.push(r);
          }
          var r = byRegion.get(c.region_slug);
          if (!r.areas.has(c.area_slug)) {
            r.areas.set(c.area_slug, { slug: c.area_slug, name: c.area_name, sort: c.area_sort, cities: [] });
          }
          r.areas.get(c.area_slug).cities.push(c);
        });
        out.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
        out.forEach(function (r) {
          r.areas = Array.from(r.areas.values()).sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
          r.areas.forEach(function (a) {
            a.cities.sort(function (x, y) { return String(x.name).localeCompare(String(y.name), 'he'); });
          });
        });
        return out;
      });
    },

    /* השלמת עיר שהגיעה מקישור עמוק בלי פין. מחזירה true אם משהו השתנה,
       כדי שהקורא יידע אם בכלל יש מה למרכז מחדש. */
    hydrate: function (sb) {
      var self = this;
      var cur = this.active();
      if (!cur.pending) return Promise.resolve(false);
      return this.all(sb).then(function (rows) {
        var hit = rows.filter(function (r) { return r.slug === cur.slug; })[0];
        if (!hit) return false;
        self.set(hit);
        return true;
      });
    }
  };

  global.CityContext = CityContext;
})(window);

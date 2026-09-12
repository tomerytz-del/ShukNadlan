/* ============================================================================
   שכבת הבסיס של המפה — הגדרה אחת לכל המפות באתר
   ----------------------------------------------------------------------------
   באתר חמש מפות: דף הבית, מפת משרדי התיווך, דף הנכס, מפת התכנון ב-CRM ועורך
   גבולות השכונות. עד היום כל אחת מהן החזיקה את כתובת שרת האריחים שלה בעצמה,
   ולכן כשספק האריחים שינה תנאים באוגוסט 2026 — CARTO התחילו לדרוש מפתח API
   והטביעו "API KEY REQUIRED" על כל אריח — שתי מפות תוקנו ושלוש נשארו שבורות.
   אף אחד לא שם לב, כי לא היה מקום אחד להסתכל בו. הקובץ הזה הוא המקום הזה.

   ============================================================================
   למה OpenFreeMap
   ----------------------------------------------------------------------------
   הבעיה עם CARTO לא הייתה המחיר — היא הייתה שספק יכול לשנות תנאים מתחת לאתר
   חי, ואנחנו נגלה את זה מהטבעה על המסך. מפתח CARTO חינמי היה מחזיר את המפות
   לעבודה, אבל משאיר בדיוק את אותה חשיפה, ועוד על שירות שהם כבר מוציאים
   בהדרגה משימוש.

   ‏OpenFreeMap מוציא את החשיפה הזאת מהמשוואה: בלי מפתח, בלי הרשמה, בלי מגבלת
   בקשות, רישיון MIT, והנתונים מ-OpenStreetMap. אין מה לפוג ואין מה להיחסם.
   ואם השירות הציבורי ייעלם ביום מן הימים — הוא בנוי לאחסון עצמי, וגם זה
   יהיה שינוי בקובץ הזה בלבד.

   המחיר: אלה אריחים **וקטוריים**, ולכן צריך מנוע ציור (MapLibre GL) והם
   דורשים WebGL 2. שני אלה מטופלים כאן:

     · ‏MapLibre נטען בעצלתיים, מתוך הקובץ הזה, ורק בדף שבאמת יש בו מפה. אין
       תגית <script> חוסמת בראש הדף — הדף לא משלם 230KB לפני הציור הראשון.
     · דפדפן בלי WebGL 2 (מכשירים ישנים, WebView מוגבל, WebGL מכובה) מקבל
       אריחי ראסטר מ-OpenStreetMap במקום. מפה פחות יפה היא לא מפה שבורה.

   ============================================================================
   שימוש
   ----------------------------------------------------------------------------
       MapTiles.addTo(map);                  // שכבת הבסיס
       MapTiles.addTo(map, { maxZoom:20 });  // מפה שמתקרבת מעבר לרגיל
       MapTiles.ready().then(…)              // למי שצריך לדעת מתי נטענה

   ‏addTo לא מחזיר את השכבה: כשהמנוע עדיין נטען היא נוספת מאוחר יותר, ולכן
   ערך החזרה היה משקר בחצי מהמקרים. אף קורא באתר לא היה צריך אותו.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- הספק ----------
     ‏bright הוא היורש הטבעי של Voyager שהיה כאן: בהיר, כבישים לבנים, מים
     תכלת, פארקים ירוקים — רקע שסמן נכס בולט מעליו ולא נבלע בו. שאר
     הסגנונות של OpenFreeMap (liberty, positron, dark, fiord) יושבים באותו
     נתיב ומתחלפים בהחלפת מילה אחת כאן. */
  var STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

  /* מעבר לזום הזה נגמר המידע ב-OpenStreetMap ברוב המקומות, והמפה רק מותחת
     את מה שיש. זו התקרה שמפה מקבלת כשלא ביקשה אחרת. */
  var GL_MAX_ZOOM = 20;

  var MAPLIBRE_VERSION = '5.24.0';   // הגרסה האחרונה עם בילד UMD; ‏6.x היא ESM בלבד
  var BINDING_VERSION  = '0.1.4';
  var CDN = 'https://cdn.jsdelivr.net/npm/';
  var MAPLIBRE_JS  = CDN + 'maplibre-gl@' + MAPLIBRE_VERSION + '/dist/maplibre-gl.js';
  var MAPLIBRE_CSS = CDN + 'maplibre-gl@' + MAPLIBRE_VERSION + '/dist/maplibre-gl.css';
  var BINDING_JS   = CDN + '@maplibre/maplibre-gl-leaflet@' + BINDING_VERSION + '/leaflet-maplibre-gl.js';

  /* ‏MapLibre מסדר טקסט לפי סדר לוגי ולא ויזואלי, ולכן בלי התוסף הזה "עפולה"
     מצויר "הלופע" — כל שם עברי על המפה הפוך. זה לא ניתן לתיקון בסגנון או
     בגופן; זו שכבת עיצוב הטקסט (ICU BiDi) שיושבת בתוסף נפרד.
     ‏0.2.3 ולא הגרסה האחרונה: היא הבילד היחיד שהוא קובץ אחד עצמאי. החדשות
     מפצלות ‎icu.wasm‎ לקובץ אחות שצריך להימצא לצדו, וזה שביר מ-CDN. */
  var RTL_PLUGIN = CDN + '@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js';

  /* ‏OpenFreeMap מבקשים קרדיט לעצמם כרשות; הקרדיט ל-OpenStreetMap ול-
     OpenMapTiles הוא דרישת רישיון ולא נימוס. */
  var ATTRIBUTION =
    '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; ' +
    '<a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
    'נתונים מ-<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  /* נפילה־לאחור לדפדפן בלי WebGL 2 או כש-CDN של MapLibre לא נענה.
     שרת האריחים הציבורי של OSM מיועד לתעבורה צנועה, ולכן זו רשת ביטחון
     למיעוט קטן ולא היעד — היעד הוא הווקטור למעלה. */
  var RASTER = {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxNative: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  };

  /* ---------- זיהוי WebGL 2 ----------
     ‏MapLibre GL v5 דורש WebGL 2 ולא מסתפק ב-1. הבדיקה נעשית פעם אחת,
     על קנבס שנזרק מיד, ותוצאתה נשמרת. */
  var webgl2 = null;
  function hasWebGL2() {
    if (webgl2 !== null) return webgl2;
    try {
      var c = document.createElement('canvas');
      webgl2 = !!(global.WebGL2RenderingContext && c.getContext('webgl2'));
    } catch (e) {
      webgl2 = false;
    }
    return webgl2;
  }

  /* ---------- טעינת המנוע ----------
     פעם אחת לכל הדף, גם אם חמש מפות מבקשות אותו באותה שנייה: ההבטחה
     נשמרת ומוחזרת לכולן. */
  var loading = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;          // שומר על סדר: MapLibre לפני הגשר שנשען עליו
      s.onload = resolve;
      s.onerror = function () { reject(new Error('לא נטען: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadEngine() {
    if (loading) return loading;

    if (!hasWebGL2()) {
      loading = Promise.reject(new Error('אין WebGL 2'));
      /* בלי המאזין הזה הדפדפן מדווח על דחייה לא־מטופלת עוד לפני
         שהקורא הראשון הספיק לחבר catch משלו. */
      loading.catch(function () {});
      return loading;
    }

    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = MAPLIBRE_CSS;
    document.head.appendChild(css);

    loading = loadScript(MAPLIBRE_JS)
      .then(function () { return loadScript(BINDING_JS); })
      .then(function () {
        if (!global.L || !global.L.maplibreGL) throw new Error('הגשר ל-Leaflet לא נרשם');
        enableRtlText();
      });
    return loading;
  }

  /* ---------- כיוון הכתיבה ----------
     נקרא פעם אחת בלבד לכל הדף — ‏MapLibre זורק שגיאה בקריאה שנייה — ולכן
     הבדיקה היא על הסטטוס ולא על דגל משלנו. כישלון בטעינת התוסף לא מפיל את
     המפה: היא תיפתח עם שמות הפוכים, וזה עדיין הרבה יותר טוב ממפה שלא נפתחה. */
  function enableRtlText() {
    try {
      var ml = global.maplibregl;
      if (!ml || !ml.setRTLTextPlugin || !ml.getRTLTextPluginStatus) return;
      if (ml.getRTLTextPluginStatus() !== 'unavailable') return;
      /* ‏false ולא lazy: באתר עברי הטקסט ה-RTL הראשון מופיע בפריים הראשון,
         ולכן טעינה עצלה רק מבטיחה הבזק של שמות הפוכים לפני התיקון. */
      var p = ml.setRTLTextPlugin(RTL_PLUGIN, false);
      if (p && p.catch) p.catch(function (e) { console.warn('MapTiles: תוסף ה-RTL לא נטען —', e && e.message); });
    } catch (e) {
      console.warn('MapTiles: תוסף ה-RTL לא נטען —', e && e.message);
    }
  }

  /* ---------- תוויות בעברית ----------
     סגנונות OpenMapTiles מציגים ‎{name:latin}‎ ואחריו ‎{name:nonlatin}‎, כלומר
     בישראל מתקבל תעתיק לטיני ומתחתיו השם העברי. באתר עברי זה הפוך: העברית
     היא השם, והלטינית היא הרעש. כאן כל שכבת טקסט מקבלת סדר עדיפויות חדש —
     עברית, ואם אין, מה שהיה.

     שכבה שנפילה בה תשבור את המפה כולה לא שווה את זה, ולכן כל שכבה עטופה
     בנפרד: מה שנכשל נשאר כפי שהיה, והשאר ממשיך. */
  function preferHebrew(glMap) {
    var style;
    try { style = glMap.getStyle(); } catch (e) { return; }
    if (!style || !style.layers) return;

    style.layers.forEach(function (layer) {
      if (layer.type !== 'symbol') return;
      var field = layer.layout && layer.layout['text-field'];
      if (!field) return;
      /* רק שכבות ששמות בהן מקום — לא מספרי בתים, לא סמלי כביש */
      if (JSON.stringify(field).indexOf('name') === -1) return;
      try {
        glMap.setLayoutProperty(layer.id, 'text-field', [
          'coalesce',
          ['get', 'name:he'],
          ['get', 'name:latin'],
          ['get', 'name'],
        ]);
      } catch (e) { /* השכבה נשארת כמו שהייתה */ }
    });
  }

  /* ---------- השכבות ---------- */
  function rasterLayer(opts) {
    return global.L.tileLayer(RASTER.url, {
      attribution: opts.attribution || RASTER.attribution,
      maxZoom: opts.maxZoom || RASTER.maxNative,
      /* ‏maxNativeZoom הוא הזום האחרון שיש בו אריח אמיתי. מעבר לו Leaflet
         מותח את האחרון במקום להציג ריק — לכן מפת התכנון שמבקשת זום 20
         עובדת גם מול שרת שנעצר ב-19. */
      maxNativeZoom: RASTER.maxNative,
    });
  }

  function glLayer(opts) {
    var layer = global.L.maplibreGL({
      style: opts.style || STYLE_URL,
      /* הקרדיט נמסר דרך ‎attributionControl.customAttribution‎ ולא דרך
         ‎attribution‎ של Leaflet: הגשר מגדיר ‎getAttribution()‎ משלו, שקורא
         מכאן, ומזין את הפקד של Leaflet שכבר יושב בפינה בכל המפות באתר.
         ‏attribution רגיל היה נבלע ולא מוצג. */
      attributionControl: { customAttribution: opts.attribution || ATTRIBUTION },
    });
    layer.once('add', function () {
      var gl = layer.getMaplibreMap && layer.getMaplibreMap();
      if (!gl) return;
      var patch = function () { preferHebrew(gl); };
      if (gl.isStyleLoaded && gl.isStyleLoaded()) patch();
      else gl.once('styledata', patch);
    });
    return layer;
  }

  /* ---------- גבולות הזום ----------
     ‏L.TileLayer מודיע למפה על ה-maxZoom שלו מעצמו; שכבת GL היא L.Layer רגילה
     ולא עושה זאת, ולכן בלי השורות האלה מפה שהחליפה ראסטר בווקטור מאבדת את
     תקרת הזום שהייתה לה ומאפשרת להתקרב עד שנגמר המידע. הערכים נקבעים רק אם
     המפה לא הגדירה לעצמה — אנחנו משלימים חסר, לא דורסים החלטה.

     ‏minZoom:1 הוא באג מתועד בגשר: בזום 0 המפה של Leaflet והמפה של MapLibre
     יוצאות מסנכרון. אף מפה באתר לא מתקרבת לשם, וזו ביטוח זול. */
  function applyZoomLimits(map, requestedMax) {
    if (map.options.maxZoom == null) map.setMaxZoom(requestedMax || GL_MAX_ZOOM);
    if (map.options.minZoom == null) map.setMinZoom(1);
  }

  /* ---------- ה-API ---------- */
  function addTo(map, opts) {
    if (!global.L) throw new Error('MapTiles: ‏Leaflet לא נטען');
    var o = opts || {};

    return loadEngine().then(function () {
      var layer = glLayer(o);
      applyZoomLimits(map, o.maxZoom);
      layer.addTo(map);
      return layer;
    }).catch(function (err) {
      console.warn('MapTiles: נופלים לאריחי ראסטר —', err && err.message);
      var layer = rasterLayer(o);
      layer.addTo(map);
      return layer;
    });
  }

  global.MapTiles = {
    addTo: addTo,
    ready: loadEngine,
    styleUrl: function () { return STYLE_URL; },
    attribution: function () { return ATTRIBUTION; },
    supported: hasWebGL2,
  };
})(window);

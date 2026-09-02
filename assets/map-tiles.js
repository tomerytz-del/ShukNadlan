/* ============================================================================
   ספק אריחי המפה — הגדרה אחת לכל המפות באתר
   ----------------------------------------------------------------------------
   באתר חמש מפות: המפה בדף הבית, מפת משרדי התיווך, המפה בדף הנכס, מפת התכנון
   ב-CRM ועורך גבולות השכונות. עד היום כל אחת מהן החזיקה את כתובת שרת האריחים
   שלה בעצמה, ולכן כשספק האריחים שינה תנאים באוגוסט 2026 — CARTO התחילו לדרוש
   מפתח API והטביעו "API KEY REQUIRED" על כל אריח — שתי מפות תוקנו והועברו
   ל-OpenStreetMap ושלוש נשארו מאחור ושבורות. אף אחד לא שם לב, כי לא היה מקום
   אחד להסתכל בו.

   הקובץ הזה הוא המקום הזה. שינוי ספק הוא מעכשיו שינוי בקובץ אחד.

   ‏שימוש:
       <script src="https://…/leaflet.min.js"></script>
       <script src="assets/map-tiles.js"></script>
       …
       MapTiles.addTo(map);                 // ברירת המחדל
       MapTiles.addTo(map, { maxZoom:20 }); // מפה שמתקרבת מעבר לזום הטבעי

   ============================================================================
   ‏CARTO_KEY — קראו את זה לפני שמשנים משהו אחר
   ----------------------------------------------------------------------------
   כל עוד המחרוזת ריקה, כל המפות באתר רצות על שרת האריחים הציבורי של
   OpenStreetMap: בלי מפתח, בלי הטבעה, ועובד. זו נפילה־לאחור ולא היעד —
   מדיניות השימוש של OSMF מייעדת את השרת ההוא לתעבורה צנועה ולא לשירות
   מסחרי, והם אכן חוסמים דומיינים שחורגים ממנה.

   היעד הוא מפתח CARTO: חינם, בלי חשבון ובלי תור אישור, נשלח במייל מ-
   https://carto.com/basemaps/apikey/ , ומכסה 5 מיליון בקשות אריח בחודש —
   סדר גודל אחר לגמרי ממה שהאתר צורך. הדביקו אותו כאן, וכל חמש המפות חוזרות
   באותו רגע למראה ה-Voyager הבהיר שהיה להן קודם.

   ‏המפתח גלוי בקוד הדף, וזה תקין: מפתח בסיסמפ נועד להיות ציבורי, בדיוק כמו
   המפתח הציבורי של Supabase שכבר יושב בכל דף כאן. ההגנה עליו היא הגבלת
   דומיין בצד CARTO, לא הסתרה.

   ‏הערה לטווח ארוך: CARTO מוציאים בהדרגה את שירות האריחים הראסטריים לטובת
   וקטוריים. כשזה יקרה, שתי החלופות הן OpenFreeMap (וקטורי, בלי מפתח ובלי
   מגבלה, דורש MapLibre) או MapTiler עם מפתח. שתיהן הן שינוי בקובץ הזה בלבד.
   ========================================================================== */
(function (global) {
  'use strict';

  var CARTO_KEY = '';   // ← כאן. ראו ההסבר למעלה.

  /* שני הספקים. ‏maxNative הוא הזום האחרון שבו לשרת יש אריח אמיתי — מעבר לו
     Leaflet מותח את האריח האחרון במקום להציג ריק, וזו הסיבה שמפה שמבקשת
     זום 20 (מפת התכנון ב-CRM) עובדת גם מול שרת שנעצר ב-19. */
  var PROVIDERS = {
    carto: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=' +
           encodeURIComponent(CARTO_KEY),
      subdomains: 'abcd',
      maxNative: 20,
      detectRetina: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; ' +
                   '<a href="https://carto.com/attributions">CARTO</a>',
    },
    osm: {
      /* בלי ‎{s}‎: תת־הדומיינים a/b/c של OSM הוצאו משימוש, והצורה הזאת היא
         היחידה שהם ממליצים עליה היום. וגם בלי ‎{r}‎ — אין להם אריחי @2x. */
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      subdomains: 'abc',
      maxNative: 19,
      detectRetina: false,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  };

  var active = CARTO_KEY ? 'carto' : 'osm';

  if (active === 'osm' && global.console && console.info) {
    console.info(
      'MapTiles: רץ על אריחי OpenStreetMap הציבוריים (נפילה־לאחור). ' +
      'להדבקת מפתח CARTO — ראו assets/map-tiles.js'
    );
  }

  function layer(opts) {
    if (!global.L) throw new Error('MapTiles: ‏Leaflet לא נטען');
    var o = opts || {};
    var p = PROVIDERS[active];
    return global.L.tileLayer(p.url, {
      subdomains: p.subdomains,
      attribution: o.attribution || p.attribution,
      /* הזום שהמפה מרשה לגולש/ת מול הזום שלשרת באמת יש אריחים בשבילו */
      maxZoom: o.maxZoom || p.maxNative,
      maxNativeZoom: p.maxNative,
      detectRetina: p.detectRetina,
    });
  }

  function addTo(map, opts) {
    var l = layer(opts);
    l.addTo(map);
    return l;
  }

  global.MapTiles = {
    layer: layer,
    addTo: addTo,
    provider: function () { return active; },
    maxNativeZoom: function () { return PROVIDERS[active].maxNative; },
  };
})(window);

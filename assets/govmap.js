/* ============================================================================
   ‏GovMap — טעינה עצלה, מקום אחד לטוקן, ושליפת מיקום ומידע תכנוני

   **הטוקן ציבורי מטבעו.** מפ"י משייכת אותו לדומיין shuknadlan.co.il והוא
   נשלח מהדפדפן בכל קריאה, ולכן אין דרך להסתיר אותו - בדיוק כמו
   ‏sb_publishable_… ב-crm.js. ההגנה היא נעילת הדומיין, לא הסודיות.
   כתוצאה מכך הוא **אינו עובד** מ-localhost או מ-deploy preview.

   קבוע אחד כאן, ולא בכל דף: שני עותקים של ערך הם שני ערכים ביום שמחליפים
   אחד (אותה סיבה כמו escapeHtml ב-esc.js).

   הסקריפט של GovMap נטען **רק בקריאה ל-govmapReady()** ולא בטעינת הדף -
   הוא צד שלישי, וטעינה מוקדמת מוסיפה RTT לכל גולש/ת בשביל פיצ'ר שרובם לא
   יפעילו. אין להוריד אותו ל-assets: מפ"י דורשת לעבוד מול הגרסה החיה.

   ## החוזה של GovmapLookup - אותו חוזה של _shared/geocode/types.ts

     null   = תשובה **סופית**: GovMap ענה, ואין שם מה שביקשנו.
     throw  = תשובה **זמנית**: לא הצלחנו לשאול. לא לסמן כ"לא נמצא".

   ## כל מה שכאן נמדד מול האתר החי ב-24.9.2026 (docs/govmap.md)

   - ‏search עם isAccurate:true החזיר **"כורש 8 עפולה"** לשאלה "חורש 8
     עפולה", ו-isAccurate:false החזיר את **הפרסה 5 בהרצליה** לשאלה על
     עפולה. לכן `lookupAddress` מאמת רחוב, מספר ויישוב בעצמו.
   - ‏getLayerFeaturesByLocation מחזירה שגיאה **בתוך** תשובה תקינה
     (`errors: {LAYER: [...]}`) ומערך ריק לצידה. לכן `errors` נבדק תמיד.
   - ‏getLayerFilterFields מחזירה מערך ולא `{data}` כמו בתיעוד (לא בשימוש כאן:
     השדות קבועים למטה, כדי לא לשלם קריאה נוספת בכל שמירה).

   הכללים המלאים: .claude/skills/govmap/SKILL.md · הרקע: docs/govmap.md
   ============================================================================ */
(function () {
  // ריק = GovMap כבוי. govmapReady() נדחית, והקוראים נופלים להתנהגות הקיימת.
  // הטוקן נעול לדומיין האתר; החלפה (אם מפ"י תנפיק חדש) היא השורה הזו בלבד.
  var GOVMAP_TOKEN = 'a888579d-2bc4-4768-97d5-bd1642e2633b';
  var SRC = 'https://www.govmap.gov.il/govmap/api/govmap.api.js';
  var PROJ4_SRC = 'https://cdn.jsdelivr.net/npm/proj4@2.9.0/dist/proj4.js';

  // **אותה מחרוזת בדיוק** כמו ITM_DEF ב-supabase/functions/_shared/geocode/itm.ts.
  // שני עותקים הם מחיר של דף סטטי בלי מודול משותף; מי שמשנה אחד משנה את
  // השני, אחרת הפין בטופס והפין מהסורק זזים במטרים זה מזה.
  var ITM_DEF = '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs +type=crs';

  // שדות מפורשים: בלעדיהם getLayerFeaturesByLocation עונה "No fields specified".
  var LAYER_FIELDS = {
    PARCEL_ALL: ['gush_num', 'gush_suffix', 'parcel', 'legal_area', 'status_text'],
    retzefMigrashim: ['kodyeud', 'migrash', 'tochnit', 'kodishuv', 'taarich', 'kvuz_trg', 'targumyeud'],
    neighborhoods_area: ['fname', 'setl_name', 'nbr_code'],
  };

  var pending = null;
  var projPending = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function govmapReady() {
    if (!GOVMAP_TOKEN) return Promise.reject(new Error('govmap: no token'));
    if (window.govmap) return Promise.resolve(window.govmap);
    if (pending) return pending;
    pending = loadScript(SRC).then(function () {
      if (!window.govmap) throw new Error('govmap: script loaded without govmap global');
      return window.govmap;
    }, function (e) {
      pending = null; // לאפשר ניסיון חוזר אחרי תקלת רשת
      throw e;
    });
    return pending;
  }

  function projReady() {
    if (window.proj4) return Promise.resolve(window.proj4);
    if (projPending) return projPending;
    projPending = loadScript(PROJ4_SRC).then(function () {
      if (!window.proj4) throw new Error('proj4 not available');
      return window.proj4;
    }, function (e) { projPending = null; throw e; });
    return projPending;
  }

  /* ‏[lng, lat] - אותו סדר כמו itmToWgs84 בשרת. */
  function itmToWgs84(proj4, x, y) {
    return proj4(ITM_DEF, 'WGS84', [x, y]);
  }

  /* ‏"POINT (227406.71 724372.49)" -> {x, y}, או null. */
  function parsePoint(wkt) {
    var m = /POINT\s*Z?\s*\(\s*([-\d.]+)\s+([-\d.]+)/i.exec(String(wkt || ''));
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  }

  /* ‏"MULTIPOLYGON Z (((x y 0, ...)), ((...)))" -> מערך פוליגונים של טבעות
     של [x, y]. מספיק למה ש-getSearchResultData מחזירה לחלקה. */
  function parseMultiPolygon(wkt) {
    var s = String(wkt || '');
    if (!/^\s*(MULTI)?POLYGON/i.test(s)) return null;
    var polys = [];
    var polyRe = /\(\(([^()]*(?:\)\s*,\s*\([^()]*)*)\)\)/g;
    var pm;
    while ((pm = polyRe.exec(s))) {
      var rings = pm[1].split(/\)\s*,\s*\(/).map(function (ring) {
        return ring.split(',').map(function (pt) {
          var n = pt.trim().split(/\s+/).map(Number);
          return [n[0], n[1]];
        }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
      });
      polys.push(rings);
    }
    return polys.length ? polys : null;
  }

  /* מפתח השוואה למחרוזת "רחוב מספר יישוב".
     מילה-מילה, בכוונה בלי תלות בגבול בין רחוב ליישוב: "הפרסה 5 עפולה"
     ו-"פרסה 5 עפולה" מתכנסים, ו-"חורש" ו-"כורש" לא. ה"א פותחת/סופית ויו"ד
     כפולה הם שלושת הצירים של street_name_key; וי"ו כפולה היא הציר של
     city_name_key. */
  function textKey(s) {
    return String(s == null ? '' : s)
      .replace(/['"`׳״‘’“”]/g, '')
      .replace(/[־\-,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(רחוב|רח|שדרות|שדרת|שד)\s+/, '')
      .split(' ')
      .map(function (w) {
        return w.replace(/^ה(?=.{2,})/, '').replace(/י{2,}/g, 'י').replace(/ו{2,}/g, 'ו').replace(/ה$/, '');
      })
      .join(' ');
  }

  // הכשלים שמותר לבלוע הם "אין תשובה"; כל השאר זמני.
  function assertSearchShape(r) {
    if (!r || !Array.isArray(r.results)) throw new Error('govmap search: unexpected response');
  }

  function assertNoLayerErrors(r) {
    if (!r || !r.layers) throw new Error('govmap layers: unexpected response');
    var errs = r.errors || {};
    var keys = Object.keys(errs).filter(function (k) { return errs[k] && errs[k].length; });
    if (keys.length) throw new Error('govmap layers: ' + keys.map(function (k) { return k + ': ' + errs[k].join('; '); }).join(' | '));
  }

  /**
   * כתובת -> נקודת בית. `precision: 'rooftop'` רק כשהרחוב, המספר והיישוב
   * זהים למה שביקשנו. תוצאה אחרת נדחית ולא "מתוקנת" - פין ברחוב כורש
   * שנראה מושלם גרוע בהרבה מ"לא נמצא".
   */
  function lookupAddress(q) {
    var street = String(q.street || '').trim();
    var num = String(q.houseNumber || '').trim();
    var city = String(q.city || '').trim();
    if (!street || !num || !city) return Promise.resolve(null);
    var want = textKey(street + ' ' + num + ' ' + city);

    return govmapReady().then(function (gm) {
      return gm.search({ apiKey: GOVMAP_TOKEN, searchText: street + ' ' + num + ' ' + city,
                         isAccurate: true, maxResults: 5, language: 'he' });
    }).then(function (r) {
      assertSearchShape(r);
      for (var i = 0; i < r.results.length; i++) {
        var hit = r.results[i];
        if (hit.type !== 'address') continue;
        // בחלק מהערים `text` באנגלית (HERZELIA) ו-originalText בעברית.
        var got = textKey(hit.originalText || hit.text);
        if (got !== want) continue;
        var p = parsePoint(hit.centroid);
        if (p) return { x: p.x, y: p.y, precision: 'rooftop', matched: hit.originalText || hit.text };
      }
      return null;
    });
  }

  /** גוש/חלקה -> מרכז החלקה ו-SearchData (לשליפת הגאומטריה). */
  function lookupParcel(gush, helka) {
    var g = String(gush || '').trim(), h = String(helka || '').trim();
    if (!/^\d+$/.test(g) || !/^\d+$/.test(h)) return Promise.resolve(null);
    var want = 'גוש ' + g + ' חלקה ' + h;
    return govmapReady().then(function (gm) {
      return gm.search({ apiKey: GOVMAP_TOKEN, searchText: g + '/' + h, isAccurate: true, maxResults: 3, language: 'he' });
    }).then(function (r) {
      assertSearchShape(r);
      for (var i = 0; i < r.results.length; i++) {
        var hit = r.results[i];
        if (hit.type === 'parcel' && String(hit.text).trim() === want) {
          var p = parsePoint(hit.centroid);
          if (p) return { x: p.x, y: p.y, hit: hit };
        }
      }
      return null;
    });
  }

  function layersAt(point, radius) {
    return govmapReady().then(function (gm) {
      return gm.getLayerFeaturesByLocation({
        geometry: 'POINT(' + point.x + ' ' + point.y + ')',
        radius: radius,
        layers: Object.keys(LAYER_FIELDS).map(function (name) { return { name: name, fields: LAYER_FIELDS[name] }; }),
      }, GOVMAP_TOKEN);
    }).then(function (r) {
      assertNoLayerErrors(r);
      return r.layers;
    });
  }

  function first(arr) { return (arr && arr.length) ? arr[0].attributes || {} : null; }

  /**
   * מידע תכנוני בנקודה, בצורה של שורת property_planning_info.
   * ‏null כשאין חלקה בנקודה (גם לא ב-10 מטר) - כתובת על כביש או בשטח לא מוסדר.
   */
  function planningAt(point) {
    return layersAt(point, 0).then(function (layers) {
      if (layers.PARCEL_ALL && layers.PARCEL_ALL.length === 1) return layers;
      // נקודת כתובת שנפלה על קו חלקה או על המדרכה. רק תוצאה **יחידה**
      // מתקבלת: שתי חלקות בטווח פירושן שאיננו יודעים איזו, ואז null.
      return layersAt(point, 10).then(function (l2) {
        return (l2.PARCEL_ALL && l2.PARCEL_ALL.length === 1) ? l2 : null;
      });
    }).then(function (layers) {
      if (!layers) return null;
      var parcel = first(layers.PARCEL_ALL);
      var lot = first(layers.retzefMigrashim);
      var nbr = first(layers.neighborhoods_area);
      var plans = [];
      if (lot && lot.tochnit) {
        plans.push({ number: String(lot.tochnit), description: null,
                     date: lot.taarich ? String(lot.taarich).slice(0, 10) : null, area_sqm: null });
      }
      return {
        gush: parcel.gush_num != null ? String(parcel.gush_num) : null,
        helka: parcel.parcel != null ? String(parcel.parcel) : null,
        gush_suffix: parcel.gush_suffix || 0,
        parcel_area_sqm: parcel.legal_area != null ? Number(parcel.legal_area) : null,
        parcel_status: parcel.status_text || null,
        // ‏kvuz_trg הוא הנוסח שעפולה מציגה ("מגורים ב"); targumyeud הוא קבוצת-על.
        land_use_designation: (lot && (lot.kvuz_trg || lot.targumyeud)) || null,
        applicable_plans: plans,
        neighborhood: nbr ? nbr.fname || null : null,
        cbs_settlement_code: lot && lot.kodishuv ? Number(lot.kodishuv) : null,
      };
    });
  }

  /** גאומטריית החלקה ב-WGS84 (GeoJSON MultiPolygon), או null. לא זורקת:
      צורת החלקה היא העשרה, ואסור לה להפיל את כל השליפה. */
  function parcelGeometryWgs84(gush, helka) {
    return lookupParcel(gush, helka).then(function (p) {
      if (!p) return null;
      return Promise.all([govmapReady(), projReady()]).then(function (mods) {
        return mods[0].getSearchResultData(p.hit, GOVMAP_TOKEN).then(function (d) {
          var polys = parseMultiPolygon(d && d.geom);
          if (!polys) return null;
          return { type: 'MultiPolygon', coordinates: polys.map(function (rings) {
            return rings.map(function (ring) { return ring.map(function (pt) { return itmToWgs84(mods[1], pt[0], pt[1]); }); });
          }) };
        });
      });
    }).catch(function (e) {
      console.warn('govmap: parcel geometry failed', e);
      return null;
    });
  }

  /**
   * הכול בקריאה אחת, לטופס הנכס: כתובת (ואם לא נמצאה - גוש/חלקה) ->
   * lat/lng + שורת תכנון. מחזירה null כשאין לא כתובת ולא חלקה.
   *
   * ‏`source: 'address'` = הפין הוא נקודת הבית. ‏`'parcel'` = הפין הוא מרכז
   * החלקה, כי הכתובת אינה בשכבת הכתובות של GovMap (כך החורש 8 בעפולה).
   */
  function lookupProperty(q) {
    return lookupAddress(q).then(function (addr) {
      if (addr) return { point: addr, pinSource: 'address' };
      return lookupParcel(q.gush, q.helka).then(function (p) {
        return p ? { point: p, pinSource: 'parcel' } : null;
      });
    }).then(function (found) {
      if (!found) return null;
      return Promise.all([projReady(), planningAt(found.point)]).then(function (res) {
        var ll = itmToWgs84(res[0], found.point.x, found.point.y);
        var planning = res[1];
        var out = { lat: ll[1], lng: ll[0], pinSource: found.pinSource, itm: found.point, planning: planning };
        if (!planning || !planning.gush || !planning.helka) return out;
        return parcelGeometryWgs84(planning.gush, planning.helka).then(function (geom) {
          planning.geometry_wgs84 = geom;
          return out;
        });
      });
    });
  }

  /** כתובת -> {lat, lng} בלבד, בלי מידע תכנוני. לפין בשמירת נכס ולחיפוש
      עסקאות לפי כתובת: קריאת search אחת, ו-proj4 שנטען פעם אחת. */
  function addressLatLng(q) {
    return lookupAddress(q).then(function (addr) {
      if (!addr) return null;
      return projReady().then(function (proj4) {
        var ll = itmToWgs84(proj4, addr.x, addr.y);
        return { lat: ll[1], lng: ll[0], matched: addr.matched };
      });
    });
  }

  window.GOVMAP_TOKEN = GOVMAP_TOKEN;
  window.govmapReady = govmapReady;
  window.GovmapLookup = {
    lookupAddress: lookupAddress,
    lookupParcel: lookupParcel,
    planningAt: planningAt,
    lookupProperty: lookupProperty,
    addressLatLng: addressLatLng,
    _textKey: textKey,                 // לבדיקות בלבד
    _parseMultiPolygon: parseMultiPolygon,
  };
})();

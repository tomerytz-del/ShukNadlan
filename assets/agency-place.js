/* ============================================================================
   כותרת דף המשרד - אותו כלל בשרת ובדפדפן
   ----------------------------------------------------------------------------
   ‏og-tags.ts מייבאת את הקובץ הזה, ו-agency.html טוען אותו לפני agency.js.
   הכותרת היא "<שם> - משרד תיווך ב<עיר> | שוק נדל״ן". העיר נלקחת מהכתובת,
   ואם אין בה יישוב מוכר - מאזורי הפעילות. הרשימה היא places ו-city של
   assets/markets.js (‏ShukMarkets), הארוך קודם, כדי ש"עפולה עלית" לא
   תתקצר ל"עפולה".

   ‏המסד אינו חושף את שם העיר ל-anon (‏cities חסום, cities_public רק
   ליישובים חיים), ולכן אי אפשר לקרוא city_id ולהציג "עפולה".
   ========================================================================== */
(function (root) {
  var SITE_NAME = 'שוק נדל״ן';
  var TITLE_MAX = 90;

  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /* ארוך קודם, בלי כפילויות. נקרא בזמן הבקשה, אחרי ש-markets.js נטען. */
  function places() {
    var reg = root.ShukMarkets;
    var list = reg && reg.list ? reg.list : [];
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (m) {
      [m && m.city].concat(m && m.places || []).forEach(function (p) {
        var name = clean(p);
        if (!name || seen[name]) return;
        seen[name] = true;
        out.push(name);
      });
    });
    out.sort(function (a, b) { return b.length - a.length; });
    return out;
  }

  function containsPlace(hay, place) {
    var esc = place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^\\u0590-\\u05FF])' + esc + '(?![\\u0590-\\u05FF])').test(hay);
  }

  function matchCity(text) {
    var hay = clean(text);
    if (!hay) return '';
    var list = places();
    for (var i = 0; i < list.length; i++) {
      if (containsPlace(hay, list[i])) return list[i];
    }
    return '';
  }

  /* הכתובת קודם: "עפולה" בה כתובת גוברת על "בית שאן" שרק באזורי הפעילות. */
  function officeCity(agency) {
    var a = agency || {};
    var fromAddress = matchCity(a.address);
    if (fromAddress) return fromAddress;
    var areas = Array.isArray(a.specialty_areas) ? a.specialty_areas.join(' ') : '';
    return matchCity(areas);
  }

  /* הסיומת נשארת שלמה גם כשהשם ארוך: חיתוך באמצע "| שוק נדל״ן" מאבד את האתר. */
  function title(name, city) {
    var base = clean(name) || 'משרד תיווך';
    var suffix = city ? (' - משרד תיווך ב' + city + ' | ' + SITE_NAME) : (' - משרד תיווך | ' + SITE_NAME);
    var full = base + suffix;
    if (full.length <= TITLE_MAX) return full;
    var room = TITLE_MAX - suffix.length;
    if (room < 8) return full.slice(0, TITLE_MAX - 1).trimEnd() + '…';
    var short = base.slice(0, room - 1).trimEnd() + '…';
    return short + suffix;
  }

  root.ShukAgencyPlace = { officeCity: officeCity, title: title, SITE_NAME: SITE_NAME };
})(typeof globalThis !== 'undefined' ? globalThis : this);

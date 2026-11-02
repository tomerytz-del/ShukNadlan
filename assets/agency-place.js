/* ============================================================================
   כותרת דף המשרד - אותו כלל בשרת ובדפדפן
   ----------------------------------------------------------------------------
   ‏og-tags.ts מייבאת את הקובץ הזה, ו-agency.html טוען אותו לפני agency.js.
   הכותרת היא "<שם> | משרד תיווך ב<עיר> - נכסים למכירה ולהשכרה | שוק נדל״ן".
   בלי עיר: "<שם> | משרד תיווך - נכסים למכירה ולהשכרה | שוק נדל״ן".
   העיר נלקחת מהכתובת,
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
    var place = city ? ('משרד תיווך ב' + city) : 'משרד תיווך';
    var suffix = ' | ' + place + ' - נכסים למכירה ולהשכרה | ' + SITE_NAME;
    var full = base + suffix;
    if (full.length <= TITLE_MAX) return full;
    var room = TITLE_MAX - suffix.length;
    if (room < 8) return full.slice(0, TITLE_MAX - 1).trimEnd() + '…';
    var short = base.slice(0, room - 1).trimEnd() + '…';
    return short + suffix;
  }

  /* תגית ה-meta. חלקים חסרים נופלים, בלי משפט "בדף הזה".
     total/sale/rent הם null כשהספירה לא הצליחה - לא ממציאים מספר.
     tagline גובר על המשפט הראשון של התיאור. */
  /* נכס בודד בפיצול נכתב "נכס אחד למכירה" או "נכס אחד להשכרה", בלי לוכסן.
     שניים ויותר הם המספר. "ו-" רק לפני ספרה ("2 למכירה ו-3 להשכרה").
     לפני מילה הוו נדבקת ("3 למכירה ונכס אחד להשכרה").
     כשכל הנכסים באותו צד אין לחזור על המספר: "4 נכסים פעילים למכירה",
     ונכס יחיד הוא "נכס פעיל אחד למכירה". */
  function dealCount(n, one, many) {
    return n === 1 ? one : (n + many);
  }

  function countSentence(total, sale, rent) {
    if (total == null || !isFinite(total) || total <= 0) return '';
    var head = total === 1 ? 'נכס פעיל אחד' : (total + ' נכסים פעילים');
    if (sale == null || rent == null) return head;
    var saleN = Number(sale) || 0;
    var rentN = Number(rent) || 0;
    var n = Number(total);
    if (rentN === 0 && saleN === n) return n === 1 ? 'נכס פעיל אחד למכירה' : (n + ' נכסים פעילים למכירה');
    if (saleN === 0 && rentN === n) return n === 1 ? 'נכס פעיל אחד להשכרה' : (n + ' נכסים פעילים להשכרה');
    var saleText = saleN > 0 ? dealCount(saleN, 'נכס אחד למכירה', ' למכירה') : '';
    var rentText = rentN > 0 ? dealCount(rentN, 'נכס אחד להשכרה', ' להשכרה') : '';
    var join = rentText && /^[0-9]/.test(rentText) ? ' ו-' : ' ו';
    var split = saleText && rentText ? (saleText + join + rentText) : (saleText || rentText);
    return split ? (head + ': ' + split) : head;
  }

  function firstSentence(text) {
    var t = clean(text);
    if (!t) return '';
    var cut = t.split(/[.!?。]/)[0];
    return clean(cut || t);
  }

  function description(opts) {
    var o = opts || {};
    var name = clean(o.name) || 'משרד תיווך';
    var city = clean(o.city);
    var who = city ? ('משרד תיווך ב' + city) : 'משרד תיווך';
    var address = clean(o.address);
    var lead = name + ', ' + (address ? (who + ' (' + address + ')') : who) + '.';
    var counts = countSentence(o.total, o.sale, o.rent);
    if (counts) lead += ' ' + counts + '.';
    var extra = clean(o.tagline) || firstSentence(o.aboutFirst);
    if (extra && /[.!?]$/.test(extra) === false) extra += '.';
    var close = '';
    if (o.hasPhone) close = 'טלפון, וואטסאפ ויועצי הנדל״ן של המשרד.';
    else if (o.hasAgents) close = 'יועצי הנדל״ן של המשרד.';
    var parts = [lead, extra, close].filter(Boolean);
    while (parts.length > 1 && parts.join(' ').length > 200) parts.pop();
    var out = parts.join(' ');
    return out.length <= 200 ? out : out.slice(0, 199).trimEnd() + '…';
  }

  root.ShukAgencyPlace = {
    officeCity: officeCity,
    title: title,
    description: description,
    SITE_NAME: SITE_NAME,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

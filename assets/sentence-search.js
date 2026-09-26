/* ============================================================================
   חיפוש במשפט — "אני רוצה [לקנות] [דירה] ב[גבעת המורה] עם [3-4 חדרים] ב[עד 1.6 מ׳]"

   הכרטיס שמחליף את סרגל החיפוש בדף הבית. שלוש שכבות: המשפט (כל ערך בו
   הוא כפתור), הבורר שנפתח מתחתיו (בטלפון - בפאנל התחתון, ליד האגודל),
   והשדה החכם שמפרש טקסט חופשי. ‏docs/sentence-search.md.

   ## שתי שכבות בקובץ אחד

   ‏**Core** — טהור, בלי DOM: המצב, רשימות האפשרויות, ההתאמה, הספירה,
   הפירוש והמיפוי לכתובת. הוא נבדק ב-Node (‏scripts/sentence_search_test.cjs),
   ולכן אין בו גישה ל-window או ל-document.
   ‏**mount()** — הממשק: מצייר, מאזין למקלדת ולעכבר, ומודיע לדף על כל שינוי.
   הוא אינו יודע דבר על המפה, על Supabase או על מדפי הנכסים; את כל אלה
   הדף (‏assets/home.js) מחבר דרך onChange/onSubmit.

   ## הספירה נעשית בדפדפן, על המלאי שכבר נטען

   המפה ממילא טוענת את כל הנכסים הפעילים בשוק (‏loadProperties, עד 300),
   ולכן כל מונה בבורר הוא ‎filter().length‎ על אותה רשימה - בלי שאילתה נוספת,
   בלי debounce ובלי מטמון, ומה שהמונה אומר הוא בדיוק מה שהמפה תציג: אותה
   פונקציה (‏matches) מזינה את שניהם. מעבר ל-~2,000 נכסים בשוק אחד זה
   צריך endpoint של facets במסד - ראו התיעוד.
   ============================================================================ */
(function (root) {
  'use strict';

  /* ---------- סוגי הנכס ----------
     כל סוג הוא קבוצה של ערכי property_type מהמסד (אותן מחרוזות שב-
     RESIDENTIAL_PTYPES / COMMERCIAL_PTYPES ב-home.js). ‏url הוא הערך
     הקנוני שנכתב ל-‎?ptype=‎ - אותו ערך שעמודי החיפוש הפופולרי כבר
     משתמשים בו (‏netlify/edge-functions/search-pages.ts), ולכן
     ‎?deal=sale&ptype=דירת גן‎ ממשיך לנחות על אותו חיפוש.
     ‏noRooms: סוגים שאין להם "חדרים" - שם החלק "עם N חדרים" יורד מהמשפט. */
  var TYPES = [
    { key: 'any', label: 'נכס' },
    { key: 'apt', label: 'דירה', ptypes: ['דירה', 'דופלקס', 'טריפלקס', 'סטודיו/לופט', 'יחידת דיור', 'מרתף/פרטר'], residential: true },
    { key: 'garden', label: 'דירת גן', ptypes: ['דירת גן'], url: 'דירת גן', residential: true },
    { key: 'penthouse', label: 'פנטהאוז', ptypes: ['גג/פנטהאוז'], url: 'גג/פנטהאוז', residential: true },
    { key: 'house', label: 'בית פרטי', ptypes: ["בית פרטי/קוטג'", 'דו משפחתי', 'משק חקלאי/נחלה', 'משק עזר'], url: "בית פרטי/קוטג'", residential: true },
    { key: 'land', label: 'מגרש', ptypes: ['מגרש', 'מגרשים'], noRooms: true },
    { key: 'shop', label: 'חנות', ptypes: ['חנויות/שטח מסחרי'], url: 'חנויות/שטח מסחרי', commercial: true, noRooms: true },
    { key: 'office', label: 'משרד', ptypes: ['משרדים'], url: 'משרדים', commercial: true, noRooms: true },
    { key: 'commercial', label: 'נכס מסחרי', commercial: true, noRooms: true },
  ];
  var TYPE_BY_KEY = {};
  TYPES.forEach(function (t) { TYPE_BY_KEY[t.key] = t; });

  /* ‏?ptype=‏ שאינו אחת הקבוצות (‏"דופלקס", "מחסנים") נשמר כסוג "גולמי": הוא
     מוצג במשפט כמו שהוא ומסנן בשוויון, כמו שעשה החיפוש הקודם. */
  function typeDef(key) {
    if (TYPE_BY_KEY[key]) return TYPE_BY_KEY[key];
    if (typeof key === 'string' && key.indexOf('raw:') === 0) {
      var v = key.slice(4);
      return { key: key, label: v, ptypes: [v], url: v, raw: true };
    }
    return TYPE_BY_KEY.any;
  }

  /* ---------- חדרים ----------
     טווח סגור [מ, עד]. חצאים נכללים בכוונה: "3-4 חדרים" הוא [3, 4.5], אחרת
     דירת 4.5 חדרים לא הייתה נופלת באף מדרגה חוץ מ"כל גודל". 99 = "ומעלה". */
  var ROOM_BUCKETS = [[2, 2.5], [3, 4.5], [4, 5.5], [5, 99]];
  var ROOMS_OPEN = 99;

  function roomsLabel(r) {
    if (!r) return 'כל גודל';
    var lo = r[0], hi = r[1];
    if (hi >= ROOMS_OPEN) return lo + '+ חדרים';
    var top = Math.floor(hi);
    if (top <= lo) return lo + ' חדרים';
    return lo + '-' + top + ' חדרים';
  }

  /* ---------- תקציב ----------
     הסולם תלוי בעסקה, ובשכירות גם בסוג: שכר דירה למשרד בעפולה נע בין 2,000
     ל-70,000, וסולם של דירות (עד 7,000) היה משאיר את רובם תחת "כל תקציב". */
  function priceScale(deal, typeKey) {
    if (deal === 'rent') {
      return typeDef(typeKey).commercial ? [5000, 10000, 20000, null] : [4000, 5500, 7000, null];
    }
    return [1200000, 1600000, 2000000, 2800000, null];
  }

  function trimNum(n) { return String(Math.round(n * 100) / 100); }

  function priceLabel(v, deal) {
    if (v === null || v === undefined) return 'כל תקציב';
    if (deal === 'rent' || v < 100000) return 'עד ₪' + Number(v).toLocaleString('en-US');
    if (v >= 1000000) return 'עד ' + trimNum(v / 1000000) + ' מ׳';
    return 'עד ' + trimNum(v / 1000) + ' אלף';
  }

  function defaultState() {
    /* ‏deal: null - לפני שנבחר משהו, המשפט אינו מסנן כלום: המפה והכפתור
       מציגים את כל הנכסים, כמו לפני החיפוש במשפט. "לקנות" כברירת מחדל
       היה מציג "הצג 36 נכסים" לגולש/ת שעוד לא ביקש/ה דבר. */
    return { deal: null, type: 'any', area: 'all', rooms: null, priceMax: null, priceMin: null, ai: false };
  }

  /* ---------- נרמול עברית ----------
     אותו נרמול לשמות האזורים ולטקסט החופשי: בלי גרשיים ומרכאות, מקף הוא
     רווח, ו"עילית" היא "עלית" - כך כתוב במסד ("עפולה עלית"), ואילו גולשים
     כותבים בשתי הצורות. */
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/(\d),(?=\d{3})/g, '$1')        // 1,600,000 → 1600000
      .replace(/(\d)\.(?=\d)/g, '$1\u0000')     // 2.8 שורד את ניקוי הנקודות
      .replace(/[׳'"״`]/g, '')
      .replace(/[-\u05BE\u2013\u2014.,:;!?()]/g, ' ')
      .replace(/עילית/g, 'עלית')
      .replace(/\u0000/g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- אזורים ----------
     נגזרים מהנכסים עצמם ולא מרשימה קבועה: מוצג רק מה שיש בו לפחות נכס אחד.
     שכונות לפי ‎neighborhood_id‎, ויישובים לפי ‎city‎ - חוץ מהיישוב העיקרי
     של השוק, שהוא ממילא "כל ‎<השוק>‎" ("עפולה" לבד = כל עפולה). */
  function deriveAreas(props) {
    var hoods = {}, cities = {};
    (props || []).forEach(function (p) {
      if (p.neighborhood_id && p.neighborhood_name) {
        var h = hoods[p.neighborhood_id] || (hoods[p.neighborhood_id] = { key: 'hood:' + p.neighborhood_id, label: p.neighborhood_name, count: 0 });
        h.count++;
      }
      if (p.city) cities[p.city] = (cities[p.city] || 0) + 1;
    });
    var cityNames = Object.keys(cities).sort(function (a, b) { return cities[b] - cities[a]; });
    var mainCity = cityNames[0] || '';
    var list = Object.keys(hoods).map(function (k) { return hoods[k]; })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label, 'he'); });
    cityNames.slice(1).forEach(function (c) { list.push({ key: 'city:' + c, label: c, count: cities[c] }); });
    list.mainCity = mainCity;
    return list;
  }

  /* השמות שהטקסט החופשי יכול להתאים להם, לכל אזור: השם המלא, בלי הסוגריים,
     מה שבתוך הסוגריים, ובלי הסיומת הלטינית ("לב העמק C1" → "לב העמק").
     ‏ALIASES הם כינויים שאינם נגזרים מהשם. */
  var ALIASES = [
    [/(^| )[ובלמה]{0,2}גבעה( |$)/, 'גבעת המורה'],
    [/(^| )[ובלמה]{0,2}עפולה ע( |$)/, 'עפולה עלית'],
    [/(^| )[ובלמה]{0,2}ע ?עלית( |$)/, 'עפולה עלית'],
    [/(^| )[ובלמה]{0,2}עלית( |$)/, 'עפולה עלית'],
  ];

  function areaNames(a) {
    var full = norm(a.label);
    var names = [full];
    var noParen = norm(a.label.replace(/\([^)]*\)/g, ''));
    if (noParen && noParen !== full) names.push(noParen);
    var paren = a.label.match(/\(([^)]*)\)/);
    if (paren && norm(paren[1])) names.push(norm(paren[1]));
    var noLatin = norm(a.label.replace(/[A-Za-z0-9]+/g, ''));
    if (noLatin && names.indexOf(noLatin) < 0) names.push(noLatin);
    return names.filter(function (n) { return n.length >= 2; });
  }

  /* השם כמילה שלמה, ומותר לפניו צירוף של אותיות השימוש: "בגבעת המורה",
     "וליד מרכז העיר" → "ול", "מהיוגב". */
  function hasWord(t, name) {
    var esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^| )[ובלמהשכ]{0,3}' + esc + '( |$)').test(t);
  }

  function findArea(text, areas) {
    var t = norm(text);
    var best = null, bestLen = 0;
    (areas || []).forEach(function (a) {
      areaNames(a).forEach(function (n) {
        if (n.length > bestLen && hasWord(t, n)) { best = a; bestLen = n.length; }
      });
    });
    if (best) return best;
    for (var i = 0; i < ALIASES.length; i++) {
      if (ALIASES[i][0].test(t)) {
        var target = norm(ALIASES[i][1]);
        var hit = (areas || []).filter(function (a) { return areaNames(a).indexOf(target) >= 0; })[0];
        if (hit) return hit;
      }
    }
    return null;
  }

  function areaLabel(key, areas, ctx) {
    if (!key || key === 'all') return 'כל ' + ((ctx && ctx.marketLabel) || 'האזור');
    if (key === 'near') return 'לידי';
    if (key === 'drawn') return 'האזור שסימנתי';
    if (key.indexOf('text:') === 0) return key.slice(5);
    var a = (areas || []).filter(function (x) { return x.key === key; })[0];
    if (a) return a.label;
    return key.replace(/^(hood|city):/, '');
  }

  /* המילית שלפני האזור. "לידי" עומד בלי "ב", ו"האזור שסימנתי" נבלע בה. */
  function areaPrefix(key) {
    if (key === 'near') return '';
    return 'ב';
  }

  var NEAR_KM = 2.5;
  function distanceKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------- ההתאמה ----------
     פונקציה אחת לכל מה שמוצג: המפה, השורות, המונה בכפתור, המונים בבורר
     והמקרא. ‏skip מדלג על slot אחד - לחישוב "כמה יהיו אם אשנה רק אותו". */
  function matches(p, st, ctx, skip) {
    ctx = ctx || {};
    if (skip !== 'deal' && st.deal && p.deal_type !== st.deal) return false;

    if (skip !== 'type' && st.type && st.type !== 'any') {
      var t = typeDef(st.type);
      if (t.commercial && p.category !== 'commercial') return false;
      if (t.residential && p.category === 'commercial') return false;
      if (t.ptypes && t.ptypes.indexOf(p.property_type) < 0) return false;
    }

    if (skip !== 'area' && st.area && st.area !== 'all') {
      var a = st.area;
      if (a.indexOf('hood:') === 0) { if (String(p.neighborhood_id) !== a.slice(5)) return false; }
      else if (a.indexOf('city:') === 0) { if (p.city !== a.slice(5)) return false; }
      else if (a.indexOf('text:') === 0) {
        var q = norm(a.slice(5));
        var hay = norm([p.title, p.street, p.address, p.city, p.neighborhood_name].join(' '));
        if (q && hay.indexOf(q) < 0) return false;
      }
      else if (a === 'near') {
        if (!ctx.near || !p.lat || !p.lng) return false;
        if (distanceKm(ctx.near, { lat: +p.lat, lng: +p.lng }) > NEAR_KM) return false;
      }
      else if (a === 'drawn') {
        if (ctx.inDrawn && !ctx.inDrawn(p)) return false;
      }
    }

    if (skip !== 'rooms' && st.rooms && !typeDef(st.type).noRooms) {
      var r = Number(p.rooms);
      if (p.rooms === null || p.rooms === undefined || !isFinite(r)) return false;
      if (r < st.rooms[0] || r > st.rooms[1]) return false;
    }

    if (skip !== 'price') {
      var price = Number(p.price);
      var priced = p.price !== null && p.price !== undefined && isFinite(price);
      if (st.priceMax !== null && st.priceMax !== undefined && (!priced || price > st.priceMax)) return false;
      if (st.priceMin && (!priced || price < st.priceMin)) return false;
    }

    if (st.ai && ctx.aiIds && !ctx.aiIds.has(p.id)) return false;
    /* הסינון המתקדם (קומה, מ״ר, מאפיינים…) מגיע מהדף כפרדיקט: הוא חל על
       כל מונה בדיוק כמו ה-slots, ולכן המספרים נשארים נכונים גם איתו. */
    if (skip !== 'extra' && ctx.extra && !ctx.extra(p)) return false;
    return true;
  }

  function filter(props, st, ctx, skip) {
    return (props || []).filter(function (p) { return matches(p, st, ctx, skip); });
  }

  function assign(a, b) {
    var o = {};
    Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { o[k] = b[k]; });
    return o;
  }

  /* שינוי אחד במצב, עם התוצאות הנגררות שלו - במקום אחד, כדי שהבורר,
     הפירוש, המקרא והכתובת לא יוכלו להיפרד:
       - עסקה שהתחלפה → התקציב מתאפס (‏₪5,500 אינו מחיר של דירה למכירה).
       - סוג שאין לו חדרים → החדרים יורדים. */
  function applyPatch(st, patch) {
    var next = assign(st, patch);
    if ('deal' in patch && patch.deal !== st.deal && !('priceMax' in patch)) next.priceMax = null;
    if (typeDef(next.type).noRooms) next.rooms = null;
    return next;
  }

  /* ---------- ה-slots והאפשרויות ---------- */
  var SLOT_ORDER = ['deal', 'type', 'area', 'rooms', 'price'];
  var SLOT_TITLES = { deal: 'מה בא לכם?', type: 'איזה נכס?', area: 'איפה?', rooms: 'כמה חדרים?', price: 'תקציב' };
  var SLOT_NAMES = { deal: 'סוג עסקה', type: 'סוג נכס', area: 'אזור', rooms: 'חדרים', price: 'תקציב' };

  function dealLabel(d) { return d === 'rent' ? 'לשכור' : d === 'sale' ? 'לקנות' : 'למצוא'; }

  function slotsFor(st, areas, ctx) {
    var out = [
      { slot: 'deal', pre: '', value: dealLabel(st.deal) },
      { slot: 'type', pre: '', value: typeDef(st.type).label },
      { slot: 'area', pre: areaPrefix(st.area), value: areaLabel(st.area, areas, ctx) },
    ];
    if (!typeDef(st.type).noRooms) out.push({ slot: 'rooms', pre: 'עם', value: roomsLabel(st.rooms) });
    out.push({ slot: 'price', pre: 'ב', value: priceLabel(st.priceMax, st.deal) });
    return out;
  }

  function sameRooms(a, b) { return (!a && !b) || (a && b && a[0] === b[0] && a[1] === b[1]); }

  function options(slot, st, props, ctx, areas) {
    var list = [];
    var count = function (patch) { return filter(props, applyPatch(st, patch), ctx).length; };
    if (slot === 'deal') {
      list = ['sale', 'rent', null].map(function (d) {
        return { value: d, label: d ? dealLabel(d) : 'לקנות או לשכור', count: count({ deal: d }), selected: st.deal === d };
      });
    } else if (slot === 'type') {
      var keys = TYPES.map(function (t) { return t.key; });
      if (keys.indexOf(st.type) < 0) keys.push(st.type);
      list = keys.map(function (k) {
        return { value: k, label: typeDef(k).label, count: count({ type: k }), selected: st.type === k };
      });
    } else if (slot === 'area') {
      list.push({ value: 'all', label: areaLabel('all', areas, ctx), count: count({ area: 'all' }), selected: st.area === 'all' });
      if (ctx && ctx.canNear) list.push({ value: 'near', label: '📍 לידי', count: st.area === 'near' ? count({ area: 'near' }) : null, selected: st.area === 'near' });
      if (st.area === 'drawn') list.push({ value: 'drawn', label: 'האזור שסימנתי', count: count({ area: 'drawn' }), selected: true });
      if (st.area.indexOf('text:') === 0) list.push({ value: st.area, label: st.area.slice(5), count: count({ area: st.area }), selected: true });
      (areas || []).forEach(function (a) {
        var c = count({ area: a.key });
        /* אזור בלי אף התאמה יורד מהרשימה (בשונה משאר ה-slots): רשימת
           שכונות היא ארוכה, ואפס בה הוא רעש ולא מידע. הנבחר נשאר תמיד. */
        if (c > 0 || st.area === a.key) list.push({ value: a.key, label: a.label, count: c, selected: st.area === a.key });
      });
    } else if (slot === 'rooms') {
      var buckets = ROOM_BUCKETS.slice();
      if (st.rooms && !buckets.some(function (b) { return sameRooms(b, st.rooms); })) buckets.push(st.rooms);
      list = buckets.map(function (b) {
        return { value: b, label: roomsLabel(b), count: count({ rooms: b }), selected: sameRooms(b, st.rooms) };
      });
      list.push({ value: null, label: 'כל גודל', count: count({ rooms: null }), selected: !st.rooms });
    } else if (slot === 'price') {
      var scale = priceScale(st.deal, st.type);
      if (st.priceMax !== null && scale.indexOf(st.priceMax) < 0) {
        scale = scale.filter(function (v) { return v !== null; }).concat([st.priceMax]).sort(function (a, b) { return a - b; }).concat([null]);
      }
      list = scale.map(function (v) {
        return { value: v, label: v === null ? 'בלי הגבלה' : priceLabel(v, st.deal), count: count({ priceMax: v }), selected: st.priceMax === v };
      });
    }
    return list;
  }

  function nextSlot(slot, st) {
    var order = SLOT_ORDER.filter(function (s) { return !(s === 'rooms' && typeDef(st.type).noRooms); });
    var i = order.indexOf(slot);
    return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
  }

  /* ---------- כשאין תוצאה ----------
     לעולם לא נגמרים במסך ריק: מחפשים את ה-slot האחד שהרחבה שלו מחזירה
     משהו, בסדר של מה שהכי סביר שהגולש/ת מוכן/ה לוותר עליו. */
  var WIDEN = [
    { slot: 'price', patch: { priceMax: null, priceMin: null }, text: 'בהרחבת התקציב', action: 'הרחב תקציב' },
    { slot: 'rooms', patch: { rooms: null }, text: 'בכל מספר חדרים', action: 'כל גודל' },
    { slot: 'area', patch: { area: 'all' }, text: 'בכל האזור', action: 'הרחב אזור' },
    { slot: 'type', patch: { type: 'any' }, text: 'בכל סוגי הנכסים', action: 'כל נכס' },
    { slot: 'ai', patch: { ai: false }, text: 'בלי מסנן ההדמיות', action: 'בטל מסנן' },
  ];
  function widenHint(st, props, ctx) {
    if (ctx && ctx.extra) {
      var withoutExtra = filter(props, st, ctx, 'extra').length;
      if (withoutExtra > 0) return { slot: 'extra', patch: {}, count: withoutExtra, text: 'בלי הסינון המתקדם', action: 'נקה סינון מתקדם' };
    }
    for (var i = 0; i < WIDEN.length; i++) {
      var w = WIDEN[i];
      var changes = Object.keys(w.patch).some(function (k) {
        return JSON.stringify(st[k]) !== JSON.stringify(w.patch[k]);
      });
      if (!changes) continue;
      var n = filter(props, applyPatch(st, w.patch), ctx).length;
      if (n > 0) return { slot: w.slot, patch: w.patch, count: n, text: w.text, action: w.action };
    }
    return null;
  }

  /* ---------- המילה המתחלפת ----------
     ה-slot הבא שהגולש/ת עוד לא בחר/ה מתחלף בין כמה מהאפשרויות שלו - כמו
     "מחפשים [דירה למשפחה]" בדף הבית הקודם - כדי שיהיה ברור שזו שורת חיפוש
     ולא עוד כותרת. רק אפשרויות שיש בהן נכסים, וקצרות: ה-slot מקבל את רוחב
     הארוכה שבהן, ושם של 25 תווים היה מותח את כל המשפט. */
  function rollLabels(slot, st, props, ctx, areas) {
    /* גם העסקה מתחלפת רק בין אפשרויות שיש בהן נכסים: "אני רוצה לשכור דירה
       בגבעת המורה" מעל שתי דירות למכירה הוא משפט שמשקר. כשרק אחת קיימת אין
       חילוף, וה-slot עומד על "למצוא". */
    if (slot === 'deal') {
      return ['sale', 'rent'].filter(function (d) {
        return filter(props, applyPatch(st, { deal: d }), ctx).length > 0;
      }).map(dealLabel);
    }
    var list = options(slot, st, props, ctx, areas).filter(function (o) {
      if (o.value === null || o.value === 'all' || o.value === 'any' || o.value === 'near') return false;
      return (o.count === null || o.count > 0) && String(o.label).length <= 14;
    });
    if (slot === 'area') list.sort(function (a, b) { return b.count - a.count; });
    return list.slice(0, 5).map(function (o) { return o.label; });
  }

  /* ---------- הפירוש של הטקסט החופשי ----------
     חוקים ולא מודל: מה שזוהה מעדכן את ה-slot שלו, ומה שלא זוהה נשאר כפי
     שהיה במשפט. מחזיר ‎{ patch, fields }‎ - ‏fields הם שמות ה-slots שזוהו,
     לשורת "הבנתי" ולאנליטיקס. */
  var NUM_WORDS = { 'שני': 2, 'שתי': 2, 'שניים': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6 };

  function roomsFromNumber(n, plus) {
    if (plus && n < 5) return [n, ROOMS_OPEN];
    if (n >= 5) return [5, ROOMS_OPEN];
    if (n >= 4) return [4, 5.5];
    if (n >= 3) return [3, 4.5];
    return [Math.min(n, 2), 2.5];
  }

  function parse(text, st, areas) {
    var patch = {}, fields = [];
    var t = norm(text);
    if (!t) return { patch: patch, fields: fields };
    var padded = ' ' + t + ' ';

    if (/שכיר|לשכור|השכר|שכד/.test(t)) patch.deal = 'rent';
    else if (/לקנות|קני|מכיר|לרכוש|רכיש/.test(t)) patch.deal = 'sale';

    if (/פנטהאוז|פנטהאוס|פנטהויז|דירת גג|(^| )גג( |$)/.test(t)) patch.type = 'penthouse';
    else if (/דירות? גן|(^| )גן( |$)/.test(t)) patch.type = 'garden';
    else if (/(^| )בית|בתים|וילה|וילות|קוטג|דו משפחתי|צמוד קרקע/.test(t)) patch.type = 'house';
    else if (/מגרש|(^| )קרקע/.test(t)) patch.type = 'land';
    else if (/חנות|חנויות|שטח מסחרי/.test(t)) patch.type = 'shop';
    else if (/משרד/.test(t)) patch.type = 'office';
    else if (/מסחרי|(^| )עסק/.test(t)) patch.type = 'commercial';
    else if (/דיר/.test(t)) patch.type = 'apt';

    var rest = t;
    var rm = t.match(/(\d+(?:\.5)?)\s*(\+)?\s*(?:חד|ח( |$))/);
    if (rm) {
      patch.rooms = roomsFromNumber(parseFloat(rm[1]), !!rm[2]);
      rest = t.replace(rm[0], ' ');
    } else {
      var wm = padded.match(/ (שני|שתי|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה) (\+ )?חדר/);
      if (wm) { patch.rooms = roomsFromNumber(NUM_WORDS[wm[1]], !!wm[2]); rest = padded.replace(wm[0], ' '); }
    }
    /* ‏"4 חדרים" בלי סוג הוא כמעט תמיד דירה - וכך גם הדוגמה שבאפיון
       ("לשכור 4 חדרים בגבעת המורה" → דירה). על סוג שכבר נבחר ויש לו חדרים
       (בית, דירת גן) זה לא דורס. */
    if (patch.rooms && !patch.type && (st.type === 'any' || typeDef(st.type).noRooms)) patch.type = 'apt';

    var value = null;
    var mm = rest.match(/(\d+(?:\.\d+)?)\s*(?:מיליון|מליון|מלין|מ(?= |$)|m(?= |$))/);
    var km = rest.match(/(\d+(?:\.\d+)?)\s*(?:אלף|אלפים|k(?= |$))/);
    var nm = rest.replace(/(\d),(\d{3})/g, '$1$2').match(/(\d{4,})/);
    if (mm) value = parseFloat(mm[1]) * 1000000;
    else if (km) value = parseFloat(km[1]) * 1000;
    else if (nm) value = parseInt(nm[1], 10);

    if (value) {
      /* סכום בלי מילת עסקה מספר בעצמו מה מחפשים: 1.7 מיליון אינו שכר דירה,
         ו-5,500 אינו מחיר של דירה. */
      if (!patch.deal) {
        if (value >= 200000 && st.deal !== 'sale') patch.deal = 'sale';
        else if (value <= 30000 && st.deal !== 'rent') patch.deal = 'rent';
      }
      var deal = patch.deal || st.deal;
      var scale = priceScale(deal, patch.type || st.type);
      var step = null;
      for (var i = 0; i < scale.length; i++) { if (scale[i] !== null && scale[i] >= value) { step = scale[i]; break; } }
      patch.priceMax = step;
    }

    var area = findArea(t, areas);
    if (area) patch.area = area.key;
    else if (areas && areas.mainCity && t.indexOf(norm(areas.mainCity)) >= 0) patch.area = 'all';

    SLOT_ORDER.forEach(function (s) {
      var k = s === 'price' ? 'priceMax' : s;
      if (k in patch) fields.push(s);
    });
    return { patch: patch, fields: fields };
  }

  /* "הבנתי: שכירות · גבעת המורה · 4-5 חדרים · עד ₪5,500" - מה שהפירוש שינה,
     כפי שהוא מופיע עכשיו במשפט. */
  function parsedNote(fields, st, areas, ctx) {
    return fields.map(function (s) {
      if (s === 'deal') return st.deal === 'rent' ? 'שכירות' : 'קנייה';
      if (s === 'type') return typeDef(st.type).label;
      if (s === 'area') return areaLabel(st.area, areas, ctx);
      if (s === 'rooms') return roomsLabel(st.rooms);
      if (s === 'price') return st.priceMax === null ? 'כל תקציב' : priceLabel(st.priceMax, st.deal);
      return '';
    }).filter(Boolean).join(' · ');
  }

  function sentenceText(st, areas, ctx) {
    return ['אני רוצה'].concat(slotsFor(st, areas, ctx).map(function (s) {
      return s.pre ? (s.pre.length === 1 ? s.pre + s.value : s.pre + ' ' + s.value) : s.value;
    })).join(' ');
  }

  /* ---------- הכתובת ----------
     אותם שמות פרמטרים שהאתר כבר מדבר בהם (‏deal, ptype, rooms, minPrice,
     maxPrice, q, ai) ובאותו סדר - כך ‎?deal=sale&rooms=4‎, הכתובת של עמוד
     חיפוש פופולרי, נקראת כאן כמו שהיא ונכתבת בחזרה בדיוק כך. */
  function parseRooms(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    var m;
    if ((m = s.match(/^(\d+(?:\.5)?)-(\d+)$/))) return [parseFloat(m[1]), parseFloat(m[2]) + 0.5];
    if ((m = s.match(/^\+?(\d+(?:\.5)?)\+?$/)) && /\+/.test(s)) return [parseFloat(m[1]), ROOMS_OPEN];
    var nums = s.split(',').map(function (v) {
      v = v.trim();
      if (v === '+6') return { n: 6, open: true };
      var n = parseFloat(v);
      return isFinite(n) ? { n: n, open: false } : null;
    }).filter(Boolean);
    if (!nums.length) return null;
    var lo = Math.min.apply(null, nums.map(function (x) { return x.n; }));
    var hi = Math.max.apply(null, nums.map(function (x) { return x.n; }));
    if (nums.some(function (x) { return x.open; })) hi = ROOMS_OPEN;
    if (lo <= 0 || lo > 20) return null;
    return [lo, hi];
  }

  function fromParams(params) {
    var st = defaultState();
    var get = function (k) { var v = params.get(k); return v === null ? '' : String(v).trim(); };
    var deal = get('deal');
    if (deal === 'sale' || deal === 'rent') st.deal = deal;
    else if (deal === 'commercial') { st.deal = null; st.type = 'commercial'; }

    var ptype = get('ptype');
    var tkey = get('type');
    if (ptype) {
      var group = TYPES.filter(function (t) { return t.url === ptype; })[0];
      if (group) st.type = group.key;
      else if (/^[֐-׿\w'"/ .-]{1,40}$/.test(ptype)) st.type = 'raw:' + ptype;
    } else if (TYPE_BY_KEY[tkey]) st.type = tkey;

    st.rooms = parseRooms(get('rooms'));
    var num = function (k) { var n = Number(get(k)); return get(k) && isFinite(n) && n > 0 ? Math.round(n) : null; };
    st.priceMax = num('maxPrice');
    st.priceMin = num('minPrice');
    var q = get('q').slice(0, 80);
    if (q) st.area = 'text:' + q;
    st.ai = get('ai') === '1';
    if (typeDef(st.type).noRooms) st.rooms = null;
    return st;
  }

  /* ‏text:גבעת המורה (מה שנקרא מ-‎?q=‎) הופך לשכונה עצמה ברגע שהאזורים ידועים. */
  function resolveArea(st, areas) {
    if (!st.area || st.area.indexOf('text:') !== 0) return st;
    var q = norm(st.area.slice(5));
    if (areas && areas.mainCity && q === norm(areas.mainCity)) return assign(st, { area: 'all' });
    var hit = (areas || []).filter(function (a) { return areaNames(a).indexOf(q) >= 0; })[0] || findArea(q, areas);
    return hit ? assign(st, { area: hit.key }) : st;
  }

  /* ‏"3-4" הוא [3, 4.5] - כמו התווית "3-4 חדרים" - ו-"4" לבד הוא בדיוק 4, כמו
     בעמודי החיפוש הפופולרי. טווח שאינו מדרגה נכתב כרשימה ("3,4"). */
  function roomsParam(r) {
    if (!r) return '';
    if (r[1] >= ROOMS_OPEN) return r[0] + '+';
    if (r[0] === r[1]) return String(r[0]);
    if (r[1] % 1 === 0.5) return r[0] + '-' + Math.floor(r[1]);
    return r[0] + ',' + r[1];
  }

  function toParams(st, areas, ctx) {
    var p = [];
    var t = typeDef(st.type);
    if (st.deal) p.push(['deal', st.deal]);
    else if (t.commercial) p.push(['deal', 'commercial']);
    if (t.url) p.push(['ptype', t.url]);
    else if (st.type && st.type !== 'any' && !(t.key === 'commercial' && !st.deal)) p.push(['type', st.type]);
    if (st.rooms) p.push(['rooms', roomsParam(st.rooms)]);
    if (st.priceMin) p.push(['minPrice', String(st.priceMin)]);
    if (st.priceMax !== null && st.priceMax !== undefined) p.push(['maxPrice', String(st.priceMax)]);
    /* ‏"לידי" ו"האזור שסימנתי" אינם נכתבים: הם תלויים במיקום ובציור של מי
       שנמצא/ת כאן עכשיו, וקישור ששותף איתם היה נוחת על משהו אחר לגמרי. */
    if (st.area && st.area !== 'all' && st.area !== 'near' && st.area !== 'drawn') p.push(['q', areaLabel(st.area, areas, ctx)]);
    if (st.ai) p.push(['ai', '1']);
    return p.map(function (kv) { return kv[0] + '=' + encodeURIComponent(kv[1]); }).join('&');
  }

  var Core = {
    TYPES: TYPES, ROOM_BUCKETS: ROOM_BUCKETS, SLOT_ORDER: SLOT_ORDER, NEAR_KM: NEAR_KM,
    typeDef: typeDef, roomsLabel: roomsLabel, priceLabel: priceLabel, priceScale: priceScale,
    defaultState: defaultState, norm: norm, deriveAreas: deriveAreas, findArea: findArea,
    areaLabel: areaLabel, matches: matches, filter: filter, applyPatch: applyPatch,
    slotsFor: slotsFor, options: options, nextSlot: nextSlot, widenHint: widenHint, rollLabels: rollLabels,
    parse: parse, parsedNote: parsedNote, sentenceText: sentenceText,
    fromParams: fromParams, resolveArea: resolveArea, toParams: toParams, parseRooms: parseRooms,
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = Core; return; }

  /* ==========================================================================
     הממשק
     ========================================================================== */
  var doc = root.document;
  var MOBILE_MQ = '(max-width:759px)';


  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function fmtCount(n) { return Number(n).toLocaleString('he-IL'); }

  /* ‏mount({ ... }) - מחבר את הכרטיס שב-index.html. מחזיר API קטן שהדף
     משתמש בו: setProperties, setDrawn, setAi, setDeal, setType, reset, state. */
  function mount(opts) {
    var ids = function (id) { return doc.getElementById(id); };
    var card = ids('ssCard');
    if (!card) return null;
    var sentenceEl = ids('ssSentence');
    var picker = ids('ssPicker');
    var pickerTitle = ids('ssPickerTitle');
    var optionsEl = ids('ssOptions');
    var form = ids('ssSmart');
    var input = ids('ssQuery');
    var goBtns = [].slice.call(doc.querySelectorAll('[data-ss-go]'));
    var countEls = [].slice.call(doc.querySelectorAll('[data-ss-count]'));
    var noteEl = ids('ssNote');
    var emptyEl = ids('ssEmpty');
    var emptyText = ids('ssEmptyText');
    var emptyBtn = ids('ssEmptyBtn');
    var dock = ids('ssDock');
    var closeBtn = ids('ssPickerClose');
    var micBtn = ids('ssMic');
    var liveEl = ids('ssLive');

    var props = [];
    var areas = [];
    var loaded = false;
    var ctx = {
      marketLabel: opts.marketLabel || 'האזור',
      aiIds: null,
      inDrawn: null,
      near: null,
      canNear: !!(root.navigator && 'geolocation' in root.navigator),
    };
    var st = defaultState();
    var active = null;            // ה-slot שהבורר שלו פתוח
    var keyboardOpen = false;     // הבורר נפתח מהמקלדת → הפוקוס עובר אליו
    var parsedText = '';          // הטקסט שכבר פורש, כדי ש"הצג" לא יפרש אותו שוב
    var urlTouched = false;       // הכתובת נכתבת רק אחרי שינוי של הגולש/ת
    /* ה-slots שהגולש/ת כבר בחר/ה בהם. הראשון שעוד לא נבחר הוא "המילה הבאה"
       - היחיד שמתחלף. אף פעם לא שתי מילים מתחלפות בו זמנית. */
    var touched = {};
    var rollIndex = 0, rollSlot = null;
    var reduceMq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    var mq = root.matchMedia ? root.matchMedia(MOBILE_MQ) : { matches: false, addEventListener: function () {} };

    function track(name, params) {
      if (typeof opts.track === 'function') opts.track(name, params || {});
    }

    function results() { return filter(props, st, ctx); }

    function noMotion() {
      return reduceMq.matches || doc.documentElement.classList.contains('a11y-nomotion');
    }

    function hintSlot() {
      var list = slotsFor(st, areas, ctx);
      for (var i = 0; i < list.length; i++) if (!touched[list[i].slot]) return list[i].slot;
      return null;
    }

    /* ערך שהגיע מקישור אמיתי (עמוד חיפוש פופולרי, קישור ששותף) הוא בחירה:
       הוא מוצג קבוע, והמילה המתחלפת היא הראשונה שעוד לא נבחרה. כתובת שהדף
       עצמו כתב אינה מגיעה לכאן בכלל - היא מתחילה נקייה (initSentenceSearch
       ב-home.js), ולכן
       בכניסה רגילה המילה הראשונה היא זו שמתחלפת. מילה מתחלפת שיש לה ערך
       שמסנן הייתה מראה "לשכור" מעל מונה של נכסי מכירה. */
    function touchNonDefault() {
      var d = defaultState();
      if (st.deal !== d.deal) touched.deal = true;
      if (st.type !== d.type) touched.type = true;
      if (st.area !== d.area) touched.area = true;
      if (st.rooms) touched.rooms = true;
      if (st.priceMax !== null && st.priceMax !== undefined) touched.price = true;
    }

    /* ---------- ציור ---------- */
    function renderSentence() {
      var hadFocus = doc.activeElement && doc.activeElement.dataset && doc.activeElement.dataset.slot;
      sentenceEl.textContent = '';
      sentenceEl.appendChild(el('span', 'ss-lead', 'אני רוצה'));
      var hint = hintSlot();
      slotsFor(st, areas, ctx).forEach(function (s) {
        var seg = el('span', 'ss-seg' + (s.pre.length === 1 ? ' is-tight' : ''));
        if (s.pre) seg.appendChild(el('span', 'ss-pre', s.pre));
        var isNext = s.slot === hint && !active;
        var labels = isNext && loaded && !noMotion() ? rollLabels(s.slot, st, props, ctx, areas) : [];
        var b;
        if (labels.length >= 2) {
          /* כל התוויות באותו תא של grid: ה-slot מקבל את רוחב הארוכה שבהן,
             ולכן החילוף אינו מזיז את שאר המשפט. */
          if (rollSlot !== s.slot) { rollSlot = s.slot; rollIndex = 0; }
          b = el('button', 'ss-slot is-next is-rolling');
          var roll = el('span', 'ss-roll');
          roll.setAttribute('aria-hidden', 'true');
          labels.forEach(function (l, i) { roll.appendChild(el('span', 'ss-roll-item' + (i === rollIndex % labels.length ? ' is-on' : ''), l)); });
          b.appendChild(roll);
        } else {
          b = el('button', 'ss-slot' + (active === s.slot ? ' is-active' : '') + (isNext ? ' is-next' : ''), s.value);
        }
        b.type = 'button';
        b.dataset.slot = s.slot;
        b.setAttribute('aria-haspopup', 'listbox');
        b.setAttribute('aria-expanded', String(active === s.slot));
        b.setAttribute('aria-controls', 'ssOptions');
        b.setAttribute('aria-label', SLOT_NAMES[s.slot] + ': ' + s.value + (isNext ? ' - לחצו לבחירה' : ''));
        seg.appendChild(b);
        sentenceEl.appendChild(seg);
        /* שבירת שורה אחרי האזור - בטלפון בלבד (‏‎.ss-break‎ ב-CSS): "עם N
           חדרים" ו"בתקציב" יורדים יחד לשורה האחרונה, במקום שהחדרים ייתלו
           בסוף שורת האזור והתקציב יישאר לבד מתחתיה. */
        if (s.slot === 'area') sentenceEl.appendChild(el('span', 'ss-break'));
      });
      if (hadFocus) {
        var again = sentenceEl.querySelector('[data-slot="' + hadFocus + '"]');
        if (again) again.focus();
      }
    }

    function renderPicker() {
      if (!active) {
        picker.hidden = true;
        card.classList.remove('has-picker');
        return;
      }
      pickerTitle.textContent = SLOT_TITLES[active];
      optionsEl.setAttribute('aria-label', SLOT_TITLES[active]);
      optionsEl.textContent = '';
      var opts2 = options(active, st, props, ctx, areas);
      var selIndex = 0;
      opts2.forEach(function (o, i) {
        var b = el('button', 'ss-opt' + (o.selected ? ' is-selected' : '') + (loaded && o.count === 0 ? ' is-zero' : '') +
          (String(o.label).length > 15 ? ' is-wide' : ''));
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(!!o.selected));
        b.tabIndex = -1;
        b.appendChild(el('span', 'ss-opt-label', o.label));
        if (loaded && o.count !== null && o.count !== undefined && !o.selected) {
          b.appendChild(el('span', 'ss-opt-count', fmtCount(o.count)));
          b.setAttribute('aria-label', o.label + ', ' + o.count + ' נכסים');
        }
        b._ssValue = o.value;
        if (o.selected) selIndex = i;
        optionsEl.appendChild(b);
      });
      var all = optionsEl.children;
      if (all[selIndex]) all[selIndex].tabIndex = 0;
      picker.hidden = false;
      card.classList.add('has-picker');
      if (keyboardOpen && all[selIndex]) all[selIndex].focus();
    }

    function renderCount() {
      var n = results().length;
      countEls.forEach(function (c) { c.textContent = loaded ? fmtCount(n) : ''; });
      goBtns.forEach(function (b) {
        b.setAttribute('aria-label', loaded ? 'הצג ' + n + ' נכסים' : 'הצג נכסים');
      });
      if (liveEl && loaded) liveEl.textContent = n === 1 ? 'נכס אחד תואם' : n + ' נכסים תואמים';

      var hint = loaded && n === 0 ? widenHint(st, props, ctx) : null;
      if (emptyEl) {
        emptyEl.hidden = !(loaded && n === 0);
        if (loaded && n === 0) {
          emptyText.textContent = hint
            ? 'אין כרגע התאמה מדויקת. ' + hint.text + ' יש ' + (hint.count === 1 ? 'נכס אחד' : fmtCount(hint.count) + ' נכסים') + '.'
            : 'אין כרגע נכסים שמתאימים לחיפוש הזה.';
          emptyBtn.hidden = !hint;
          if (hint) { emptyBtn.textContent = hint.action; emptyBtn._ssHint = hint; }
        }
      }
    }

    function render() {
      renderSentence();
      renderPicker();
      renderCount();
    }

    /* ---------- שינוי מצב ---------- */
    function commitUrl() {
      if (!urlTouched || !root.history || !root.history.replaceState) return;
      try {
        var url = new URL(root.location.href);
        var qs = toParams(st, areas, ctx);
        url.search = qs ? '?' + qs : '';
        root.history.replaceState(root.history.state, '', url);
      } catch (e) { /* דפדפן שחוסם היסטוריה - החיפוש עדיין עובד */ }
    }

    function change(patch, reason) {
      var prev = st;
      st = applyPatch(st, patch);
      if (prev.area === 'drawn' && st.area !== 'drawn' && typeof opts.onLeaveDrawn === 'function') opts.onLeaveDrawn();
      if (reason !== 'init') urlTouched = true;
      commitUrl();
      render();
      if (loaded && typeof opts.onChange === 'function') opts.onChange(results(), st, reason || 'change');
    }

    function open(slot, viaKeyboard) {
      keyboardOpen = !!viaKeyboard;
      active = slot;
      render();
      if (slot) track('search_slot_open', { slot: slot });
    }

    function close(returnFocus) {
      var was = active;
      active = null;
      keyboardOpen = false;
      render();
      if (returnFocus && was) {
        var b = sentenceEl.querySelector('[data-slot="' + was + '"]');
        if (b) b.focus();
      }
    }

    function pick(value) {
      var slot = active;
      var patch = {};
      if (slot === 'deal') patch.deal = value;
      else if (slot === 'type') patch.type = value;
      else if (slot === 'rooms') patch.rooms = value;
      else if (slot === 'price') patch.priceMax = value;
      else if (slot === 'area') {
        if (value === 'near') { locateNear(); return; }
        patch.area = value;
      }
      /* הבורר נסגר אחרי כל בחירה, והמילה הבאה במשפט מתחילה להתחלף - היא
         ההזמנה לבחירה הבאה. מהמקלדת הפוקוס עובר אליה, כך ש-Enter אחד פותח
         אותה; אחרי ה-slot האחרון הוא חוזר ל-slot שנבחר. */
      var wasKeyboard = keyboardOpen;
      touched[slot] = true;
      active = null;
      keyboardOpen = false;
      change(patch, 'slot');
      /* ‏option ולא value: ‏value שמור ב-GA4 לערך כספי (המרות). מפתח של
         אפשרות ולא טקסט - שם שכונה נשלח כ-'area' בלבד. */
      track('search_slot_select', { slot: slot, option: slot === 'area' ? (value === 'all' ? 'all' : 'area') : String(value) });
      if (wasKeyboard) {
        var b = sentenceEl.querySelector('[data-slot="' + (hintSlot() || slot) + '"]');
        if (b) b.focus();
      }
    }

    /* ‏"📍 לידי": מיקום מהדפדפן, רק בלחיצה (ראו assets/near-me.js - אותם
       נימוקים). מי שנמצא/ת בשוק אחר עובר/ת אליו דרך הכפתור הקיים של
       near-me.js, שיודע לשמור את הבחירה ולנווט; מי שנמצא/ת כאן מקבל/ת את
       הנכסים ברדיוס NEAR_KM. הקואורדינטות נשמרות בזיכרון בלבד. */
    function locateNear() {
      var say = function (t) { if (noteEl) noteEl.textContent = t; };
      if (!ctx.canNear) return;
      say('מאתרים את המיקום שלך...');
      root.navigator.geolocation.getCurrentPosition(function (pos) {
        var here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        var M = root.ShukMarkets, C = root.CityContext;
        var m = M && M.locate ? M.locate(here.lat, here.lng, false) : null;
        var cur = C && C.market ? C.market() : null;
        if (m && cur && m.slug !== cur.slug) {
          var nearBtn = doc.getElementById('heroNearBtn');
          if (nearBtn && !nearBtn.hidden) { nearBtn.click(); return; }
        }
        ctx.near = here;
        var n = filter(props, applyPatch(st, { area: 'near' }), ctx).length;
        say(n ? 'הבנתי: נכסים ברדיוס ' + NEAR_KM + ' ק״מ ממך' : 'אין כרגע נכסים ברדיוס ' + NEAR_KM + ' ק״מ ממך - אפשר להרחיב את האזור.');
        touched.area = true;
        active = null;
        change({ area: 'near' }, 'slot');
      }, function (err) {
        say(err && err.code === 1
          ? 'לא התקבלה הרשאה למיקום. אפשר לאשר אותה בהגדרות הדפדפן ולנסות שוב.'
          : 'לא הצלחנו לאתר את המיקום כרגע. אפשר לנסות שוב בעוד רגע.');
      }, { enableHighAccuracy: false, maximumAge: 600000, timeout: 12000 });
    }

    /* ---------- השדה החכם ---------- */
    function runParse() {
      var text = (input.value || '').trim();
      parsedText = text;
      if (!text) return false;
      var res = parse(text, st, areas);
      var fields = res.fields.slice();
      var patch = res.patch;
      /* לא זוהה כלום - אולי זה שם רחוב. השדה הישן ("עיר, שכונה או רחוב")
         ידע לחפש כתובת, ומי שכותב/ת "הנרקיס" לא צריך/ה ללמוד שזה כבר לא
         עובד: אם יש נכסים שהטקסט מופיע בכתובת או בכותרת שלהם, זה האזור. */
      if (!fields.length && text.length >= 2 && text.length <= 40) {
        var asText = 'text:' + text;
        if (filter(props, applyPatch(st, { area: asText }), ctx, 'price').length) { patch = { area: asText }; fields = ['area']; }
      }
      active = null;
      keyboardOpen = false;
      if (fields.length) {
        fields.forEach(function (f) { touched[f] = true; });
        change(patch, 'freetext');
        noteEl.textContent = 'הבנתי: ' + parsedNote(fields, st, areas, ctx);
      } else {
        render();
        noteEl.textContent = 'לא זיהיתי - נסו לבחור במשפט למעלה';
      }
      track('search_freetext_submit', { parsed_fields: fields.join(',') || 'none', field_count: fields.length });
      return fields.length > 0;
    }

    function submit() {
      if ((input.value || '').trim() && input.value.trim() !== parsedText) runParse();
      active = null;
      keyboardOpen = false;
      render();
      var list = results();
      track('search_submit', { result_count: list.length });
      if (typeof opts.onSubmit === 'function') opts.onSubmit(list, st);
    }

    /* ---------- אירועים ---------- */
    sentenceEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-slot]');
      if (!b) return;
      var slot = b.dataset.slot;
      /* ‏detail===0 הוא Enter/רווח על הכפתור - אז הפוקוס עובר לבורר */
      if (active === slot) close(false); else open(slot, e.detail === 0);
    });
    sentenceEl.addEventListener('keydown', function (e) {
      var b = e.target.closest('[data-slot]');
      if (!b) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); open(b.dataset.slot, true); }
      if (e.key === 'Escape' && active) { e.preventDefault(); close(true); }
    });

    optionsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.ss-opt');
      if (!b) return;
      if (e.detail === 0) keyboardOpen = true;
      pick(b._ssValue);
    });
    optionsEl.addEventListener('keydown', function (e) {
      var items = [].slice.call(optionsEl.children);
      var i = items.indexOf(doc.activeElement);
      var go = function (j) {
        if (!items.length) return;
        j = (j + items.length) % items.length;
        items.forEach(function (x) { x.tabIndex = -1; });
        items[j].tabIndex = 0;
        items[j].focus();
      };
      /* ‏RTL: החץ הימני הוא "אחורה" */
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); go(i + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); go(i - 1); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });
    if (closeBtn) closeBtn.addEventListener('click', function () { close(true); });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && active && !card.contains(e.target) && !(dock && dock.contains(e.target))) close(false);
    });
    /* לחיצה מחוץ לכרטיס סוגרת את הבורר בדסקטופ. בטלפון הבורר בפאנל התחתון
       נסגר רק מ"סגור" או מבחירה - גלילה של המפה היא לא "התחרטתי". */
    doc.addEventListener('click', function (e) {
      if (!active || mq.matches) return;
      /* ‏isConnected: הלחיצה שפתחה את הבורר מגיעה לכאן אחרי שהמשפט צויר
         מחדש, כלומר הכפתור שנלחץ כבר אינו בדף - והוא אינו "מחוץ לכרטיס". */
      if (!e.target.isConnected || card.contains(e.target)) return;
      close(false);
    });

    /* ‏Enter בשדה מפרש את הטקסט ומעדכן את המשפט - הוא לא "הצג". בשליחה
       מרומזת (Enter) הדפדפן מדווח את כפתור הזהב כ-submitter, ולכן בלי
       הסימון הזה כל Enter היה פותח את התוצאות ואת התצוגה המפוצלת. */
    var enterSubmit = false;
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') enterSubmit = true; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fromButton = !enterSubmit && e.submitter && e.submitter.hasAttribute('data-ss-go');
      enterSubmit = false;
      if (fromButton) { submit(); return; }
      runParse();
    });
    goBtns.forEach(function (b) {
      if (b.form === form) return;           // הכפתור שבתוך הטופס נתפס ב-submit
      b.addEventListener('click', submit);
    });
    if (emptyBtn) emptyBtn.addEventListener('click', function () {
      var h = emptyBtn._ssHint;
      if (!h) return;
      track('search_empty_widen', { slot: h.slot });
      if (h.slot === 'extra') { if (typeof opts.onClearExtra === 'function') opts.onClearExtra(); return; }
      change(h.patch, 'widen');
    });

    /* מיקרופון: Web Speech API היכן שיש, ואחרת הכפתור לא מוצג בכלל. */
    var Rec = root.SpeechRecognition || root.webkitSpeechRecognition;
    if (micBtn) {
      if (!Rec) micBtn.hidden = true;
      else {
        micBtn.hidden = false;
        micBtn.addEventListener('click', function () {
          try {
            var rec = new Rec();
            rec.lang = 'he-IL';
            rec.interimResults = false;
            rec.maxAlternatives = 1;
            micBtn.classList.add('is-listening');
            micBtn.setAttribute('aria-pressed', 'true');
            rec.onresult = function (ev) {
              var said = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : '';
              if (said) { input.value = said; runParse(); }
              else if (noteEl) noteEl.textContent = '';
            };
            var stop = function () {
              micBtn.classList.remove('is-listening');
              micBtn.setAttribute('aria-pressed', 'false');
            };
            rec.onend = stop;
            /* כשל שקט הוא בדיוק מה שקרה כאן (‏microphone=() ב-_headers): הכפתור
               נלחץ ולא קרה דבר. עכשיו כל כשל אומר מה קרה. */
            rec.onerror = function (ev) {
              stop();
              var code = ev && ev.error;
              /* קוד השגיאה נכתב בסוגריים: בלעדיו "לא עובד" מהטלפון של גולש/ת
                 אינו ניתן לאבחון - ‏not-allowed (הרשאה/מדיניות), ‏network (שירות
                 הזיהוי של הדפדפן), ‏audio-capture (אין מיקרופון) הם שלוש בעיות
                 שונות לגמרי. */
              if (noteEl) noteEl.textContent =
                (code === 'not-allowed' || code === 'service-not-allowed'
                  ? 'אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות האתר בדפדפן, או לכתוב בשדה.'
                  : code === 'no-speech'
                    ? 'לא שמענו כלום - נסו שוב, או כתבו בשדה.'
                    : code === 'audio-capture'
                      ? 'לא נמצא מיקרופון במכשיר - אפשר לכתוב בשדה.'
                      : 'החיפוש הקולי לא זמין כרגע - אפשר לכתוב בשדה.') +
                (code ? ' (' + code + ')' : '');
            };
            if (noteEl) noteEl.textContent = 'מקשיבים...';
            rec.start();
          } catch (err) {
            micBtn.classList.remove('is-listening');
            if (noteEl) noteEl.textContent = 'החיפוש הקולי לא זמין בדפדפן הזה - אפשר לכתוב בשדה. (' + ((err && err.name) || 'error') + ')';
          }
        });
      }
    }

    /* הבורר עובר לפאנל התחתון בטלפון, ובחזרה לכרטיס מעל 760px. אלמנט אחד
       שזז, ולא שני עותקים - כדי שלא יהיו שני listbox עם אותו id. */
    var longPlaceholder = input.getAttribute('placeholder') || '';
    var shortPlaceholder = input.getAttribute('data-short-placeholder') || longPlaceholder;

    function placeholder() {
      input.setAttribute('placeholder', mq.matches ? shortPlaceholder : longPlaceholder);
    }
    placeholder();
    if (mq.addEventListener) mq.addEventListener('change', placeholder);

    /* טיימר אחד למילה המתחלפת. הוא מחפש אותה בכל פעימה (המשפט מצויר מחדש
       עם כל שינוי) ועוצר כשהבורר פתוח, כשאין מילה הבאה, או כשהגולש/ת ביקש/ה
       בלי אנימציות. */
    root.setInterval(function () {
      if (active || doc.hidden) return;
      var roll = sentenceEl.querySelector('.ss-roll');
      if (!roll) return;
      var items = roll.children;
      if (items.length < 2) return;
      /* קודם היוצאת נעלמת, ורק אחרי שנעלמה הנכנסת מופיעה - אף פעם לא שתיהן */
      items[rollIndex % items.length].classList.remove('is-on');
      rollIndex = (rollIndex + 1) % items.length;
      var next = rollIndex;
      root.setTimeout(function () {
        var now = sentenceEl.querySelector('.ss-roll');
        if (now === roll && roll.children[next]) roll.children[next].classList.add('is-on');
      }, 260);
    }, 2200);

    render();

    return {
      Core: Core,
      state: function () { return assign(st, {}); },
      results: results,
      areas: function () { return areas; },
      loaded: function () { return loaded; },
      /* הנכסים הגיעו: האזורים נגזרים, ‎?q=‎ נפתר לשכונה, והדף מקבל את
         הרשימה המסוננת הראשונה. */
      setProperties: function (list, extra) {
        props = (list || []).slice();
        areas = deriveAreas(props);
        loaded = true;
        if (extra && extra.aiIds) ctx.aiIds = extra.aiIds;
        st = resolveArea(st, areas);
        render();
        if (typeof opts.onChange === 'function') opts.onChange(results(), st, 'load');
      },
      setAiIds: function (set) { ctx.aiIds = set; if (st.ai) change({}, 'ai'); else render(); },
      /* מצב מהכתובת. נקרא לפני שהנכסים נטענו, ולכן בלי onChange. */
      setFromParams: function (params) {
        st = fromParams(params);
        if (loaded) st = resolveArea(st, areas);
        touchNonDefault();
        render();
      },
      setAi: function (on) { change({ ai: !!on }, 'ai'); },
      setDeal: function (deal) {
        touched.deal = true;
        var patch = { deal: deal };
        if (typeDef(st.type).commercial) patch.type = 'any';
        change(patch, 'legend');
      },
      setType: function (type) { touched.type = true; change({ type: type }, 'legend'); },
      /* הסינון המתקדם: פרדיקט מהדף (או null לניקוי) */
      setExtra: function (fn) { ctx.extra = fn || null; change({}, 'extra'); },
      /* המודאל של הסינון המתקדם: מה שיש לו מקום במשפט (חדרים, מחיר, סוג,
         עסקה) נכנס למשפט, והשאר הוא הפרדיקט. שינוי אחד, ציור אחד. */
      applyAdvanced: function (patch, fn) {
        ctx.extra = fn || null;
        var d = defaultState();
        Object.keys(patch).forEach(function (k) {
          var slot = k === 'priceMax' ? 'price' : k;
          if (JSON.stringify(patch[k]) !== JSON.stringify(d[k]) && slot in SLOT_NAMES) touched[slot] = true;
        });
        change(patch, 'extra');
      },
      hasExtra: function () { return !!ctx.extra; },
      setDrawn: function (on, inDrawn) {
        ctx.inDrawn = inDrawn || null;
        if (on) touched.area = true;
        if (on) change({ area: 'drawn' }, 'drawn');
        else if (st.area === 'drawn') change({ area: 'all' }, 'drawn');
      },
      reset: function () {
        input.value = '';
        parsedText = '';
        if (noteEl) noteEl.textContent = '';
        active = null;
        touched = {};
        rollIndex = 0;
        ctx.extra = null;
        change(defaultState(), 'reset');
      },
      count: function (patch) { return filter(props, applyPatch(st, patch || {}), ctx).length; },
      /* יש מה לנקות: משפט שאינו ברירת המחדל, סינון מתקדם, או טקסט בשדה */
      isClean: function () {
        return JSON.stringify(st) === JSON.stringify(defaultState()) && !ctx.extra && !(input.value || '').trim();
      },
      describe: function () { return sentenceText(st, areas, ctx); },
      close: function () { close(false); },
    };
  }

  root.SentenceSearch = { Core: Core, mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);

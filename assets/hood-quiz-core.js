/* ============================================================================
   "איזו שכונה מתאימה לי?" - הדירוג
   ----------------------------------------------------------------------------
   חישוב טהור (בלי DOM ובלי רשת) על הנכסים הפעילים שדף הבית כבר טען, ולכן הוא
   עובד גם כשה-CDN חסום ונבדק ב-node (‏scripts/hood_quiz_test.cjs).

   ## מה הדירוג אומר, ומה לא
   **רק עובדות שיש לנו:** כמה מודעות פעילות עכשיו מתאימות לתקציב, לחדרים ולמה
   שחייב להיות בנכס, ובאילו מחירים. הוא **לא** אומר איזו שכונה "טובה" - אין לנו
   נתון על שקט, תחבורה או בתי ספר, וניחוש כזה היה טענה שאי אפשר לעמוד מאחוריה.
   לכן הכותרת בתוצאות היא "איפה יש כרגע הכי הרבה נכסים שמתאימים", וכל שכונה
   מקשרת לדף שלה (‏/n/{עיר}/{שכונה}) להכרת השכונה עצמה.

   ## מי נספר
   נכס מגורים (לא מסחרי ולא מגרש), במחיר כולל (לא למ"ר), לקנייה או להשכרה, שיש
   לו שכונה (‏neighborhood_id). נכס בלי שכונה אינו משתתף: אין לאיזו שורה לשים אותו.

   ## חדרים ומאפיינים - אותם כללים כמו בחיפוש
   - "4 חדרים" הם 4 וגם 4.5 (כמו ‏roomsFromNumber ב-sentence-search.js); "5" הוא 5
     ומעלה. נכס בלי מספר חדרים נופל כשנבחרו חדרים.
   - "יש בנכס" לפי ‏SearchCore.hasFeature (ליבת החיפוש המשותפת, ‏docs/search-core.md),
     לא קריאה ישירה של ‏features: מרפסת שסומנה ‏sun_balcony, ממ״ד שיושב בעמודת מיקום.

   ‏docs/home-page-sections.md, "איזו שכונה מתאימה לי".
   ============================================================================ */
(function (global) {
  'use strict';

  var BUDGET = {
    sale: { min: 400000, max: 5000000, step: 50000, fallback: 1500000 },
    rent: { min: 1500, max: 12000, step: 250, fallback: 4500 },
  };
  var ROOM_CHOICES = ['any', '2', '3', '4', '5'];
  var FEATURES = ['elevator', 'parking', 'mamad', 'balcony'];
  var LAND_RE = /מגרש|קרקע|נחל|משק|חקלא/;   // זהה ל-LAND_RE ב-property.js ול-isLandType ב-_shared/visualization.ts
  var MIN_FOR_TYPICAL = 3;                    // מתחת לשלוש מודעות אין "מחיר טיפוסי": זה מקרה, לא שכונה

  function median(nums) {
    var a = nums.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }

  /* נכס שהשאלון יכול לדבר עליו */
  function isHome(p, deal) {
    if (!p || p.category === 'commercial') return false;
    if (LAND_RE.test(String(p.property_type || ''))) return false;
    if (p.price_unit === 'sqm') return false;
    if (!p.neighborhood_id) return false;
    if (deal && p.deal_type !== deal) return false;
    return Number(p.price) > 0;
  }

  function roomsOk(p, choice) {
    if (!choice || choice === 'any') return true;
    var r = Number(p.rooms), n = Number(choice);
    if (!(r > 0) || !(n > 0)) return false;
    return n >= 5 ? r >= 5 : (r >= n && r <= n + 0.5);
  }

  function featureTest(opts) {
    if (opts && typeof opts.hasFeature === 'function') return opts.hasFeature;
    if (global.SearchCore && typeof global.SearchCore.hasFeature === 'function') return global.SearchCore.hasFeature;
    return function (p, code) { return Array.isArray(p.features) && p.features.indexOf(code) >= 0; };
  }

  function clampBudget(deal, value) {
    var b = BUDGET[deal] || BUDGET.sale;
    var v = Math.round((Number(value) || b.fallback) / b.step) * b.step;
    return Math.min(Math.max(v, b.min), b.max);
  }

  /* תקציב פתיחה: חציון המחירים של העסקה, כדי שהסליידר לא יתחיל במקום שבו אין כלום */
  function defaultBudget(props, deal) {
    var prices = (props || []).filter(function (p) { return isHome(p, deal); }).map(function (p) { return Number(p.price); });
    var m = median(prices);
    return clampBudget(deal, m == null ? (BUDGET[deal] || BUDGET.sale).fallback : m);
  }

  /* ‏answers: { deal: 'sale' | 'rent', budget, rooms: 'any' | '2'..'5', feats: [קודים] }
     ‏opts: { hasFeature, names: Map(neighborhood_id → שם) } */
  function rank(props, answers, opts) {
    var deal = answers && answers.deal === 'rent' ? 'rent' : 'sale';
    var budget = Number(answers && answers.budget) || 0;
    var feats = ((answers && answers.feats) || []).filter(function (f) { return FEATURES.indexOf(f) >= 0; });
    var has = featureTest(opts);
    var names = (opts && opts.names) || null;
    var byHood = {};
    var eligible = 0;

    (props || []).forEach(function (p) {
      if (!isHome(p, deal)) return;
      eligible++;
      if (!roomsOk(p, answers && answers.rooms)) return;
      if (feats.some(function (f) { return !has(p, f); })) return;
      var id = String(p.neighborhood_id);
      var h = byHood[id] || (byHood[id] = {
        id: id,
        name: String(p.neighborhood_name || (names && names.get(p.neighborhood_id)) || '').trim(),
        prices: [], matchPrices: [],
      });
      var price = Number(p.price);
      h.prices.push(price);
      if (price <= budget) h.matchPrices.push(price);
    });

    var hoods = Object.keys(byHood).map(function (k) { return byHood[k]; }).filter(function (h) { return h.name; });
    var results = hoods.filter(function (h) { return h.matchPrices.length; }).map(function (h) {
      var mp = h.matchPrices;
      return {
        id: h.id, name: h.name,
        matches: mp.length,
        min: Math.min.apply(null, mp), max: Math.max.apply(null, mp), median: median(mp),
        poolCount: h.prices.length,
        typical: h.prices.length >= MIN_FOR_TYPICAL ? median(h.prices) : null,
      };
    }).sort(function (a, b) {
      return (b.matches - a.matches) || (a.median - b.median) || a.name.localeCompare(b.name, 'he');
    });

    /* בלי אף התאמה: איפה זה הכי קרוב - הנכס הזול ביותר שמתאים לחדרים ולמאפיינים, מעל התקציב */
    var nearest = results.length ? [] : hoods.map(function (h) {
      var cheapest = Math.min.apply(null, h.prices);
      return { id: h.id, name: h.name, cheapest: cheapest, overPct: budget > 0 ? Math.round((cheapest / budget - 1) * 100) : null };
    }).sort(function (a, b) { return (a.cheapest - b.cheapest) || a.name.localeCompare(b.name, 'he'); }).slice(0, 3);

    return {
      deal: deal, budget: budget,
      results: results,
      nearest: nearest,
      matching: results.reduce(function (s, r) { return s + r.matches; }, 0),
      eligible: eligible,
    };
  }

  global.HoodQuiz = {
    BUDGET: BUDGET, ROOM_CHOICES: ROOM_CHOICES, FEATURES: FEATURES, MIN_FOR_TYPICAL: MIN_FOR_TYPICAL,
    isHome: isHome, roomsOk: roomsOk, clampBudget: clampBudget, defaultBudget: defaultBudget, rank: rank,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* ---------------------------------------------------------------------------
 * ‏canVisualize(p, sb) - האם להציע הדמיית AI לנכס (PR 1010, P1-K1). Promise<boolean>.
 *
 * הכלל עצמו יושב **רק** ב-RPC ‏property_visualizations_enabled (במסד: נכס פעיל ויועץ/ת
 * ‏premium; ובהצעה docs/proposals/viz_eligibility_single_exterior.sql - גם "לא תמונת חוץ
 * יחידה" בדירה ובמסחרי). כאן רק מה שאפשר לדעת בלי המסד: קרקע ונכס בלי תמונות - לא.
 * אסור לשכפל את הכלל ב-JS. מטמון לפי מזהה, כדי שהחלקה, דף הנכס וגבריאלה ישאלו פעם אחת.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.canVisualize) return;
  var LAND_RE = /מגרש|קרקע|נחל|משק|חקלא/;   // זהה ל-isLandType ב-_shared/visualization.ts
  var cache = new Map();
  function hasImages(p) { return Array.isArray(p && p.images) && p.images.some(Boolean); }
  window.canVisualize = function (p, sb) {
    if (!p || !p.id) return Promise.resolve(false);
    if (cache.has(p.id)) return cache.get(p.id);
    var client = sb || window.sbClient || null;
    var pr = LAND_RE.test(p.property_type || '') || !hasImages(p) || !client || !client.rpc ? Promise.resolve(false)
      : client.rpc('property_visualizations_enabled', { p_property_id: p.id })
        .then(function (r) { return !!(r && !r.error && r.data); }, function () { return false; });
    cache.set(p.id, pr);
    return pr;
  };
})();

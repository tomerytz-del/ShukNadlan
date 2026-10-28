/* ---------------------------------------------------------------------------
 * ‏FilterConfig - מפת סוגי הנכס האחת של הסינון באתר (‏A3-1, PR 1010, תומר 20:12).
 *
 * צ'יפי הסוג מעל התוצאות בדף הבית, המשפט (‏assets/sentence-search.js) וגיליון הסינון
 * של /swipe קוראים מכאן את אותם סוגים, באותן תוויות ובאותו סדר - כדי שהמונים יסכימו
 * בכל מקום. הקבוצות עצמן (אילו ערכי property_type בכל סוג) נשארות בליבה
 * (‏assets/search-core.js, ‏PROPERTY_TYPES), חוץ מאחד:
 *
 *   ‏משקים ונחלות (‏C3, תומר 22:12): קטגוריה משלה - לא בתים ולא מגרשים. בליבה (ובבוטים)
 *   הם עדיין חלק מ-house; באתר הם יוצאים משם (‏sentence-search.js, ‏HOUSE_PTYPES).
 *
 * ‏TYPES.res - שורת הסוגים כשהעסקה מכירה או השכרה (‏C4: "למכירה" הוא מגורים בלבד,
 * והמסחרי רק תחת "מסחרי"); ‏TYPES.comm - כשהלשונית מסחרי. המפתחות הם המפתחות של
 * ‏SentenceSearch.Core.TYPES. ‏docs/sentence-search.md, "סוגי הנכס".
 * ------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  var FARM_PTYPES = ['משק חקלאי/נחלה', 'משק עזר'];
  var FilterConfig = {
    FARM_PTYPES: FARM_PTYPES,
    TYPES: {
      res: [
        { key: 'any', label: 'הכול' },
        { key: 'flats', label: 'דירות' },
        { key: 'house', label: 'בתים' },
        { key: 'farm', label: 'משקים ונחלות' },
        { key: 'land', label: 'מגרשים' },
        { key: 'commercial', label: 'מסחרי' },
      ],
      comm: [
        { key: 'commercial', label: 'הכול' },
        { key: 'office', label: 'משרדים' },
        { key: 'shop', label: 'חנויות' },
        { key: 'industry', label: 'מבני תעשייה' },
        { key: 'warehouse', label: 'מחסנים' },
        { key: 'comm_land', label: 'מגרשים מסחריים' },
      ],
    },
    isFarm: function (p) { return !!p && FARM_PTYPES.indexOf(String(p.property_type || '').trim()) >= 0; },
  };
  if (typeof module === 'object' && module.exports) module.exports = FilterConfig;
  else root.FilterConfig = FilterConfig;
})(typeof window !== 'undefined' ? window : this);

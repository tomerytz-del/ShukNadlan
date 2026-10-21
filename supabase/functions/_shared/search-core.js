/* ============================================================================
   ליבת החיפוש - הכללים שכל מנגנון חיפוש בפלטפורמה חייב לחלוק
   (docs/search-core.md)

   ארבעה מקומות מחליטים "האם הנכס הזה מתאים לבקשה": שורת החיפוש באתר
   (‏sentence-search.js + home.js, בדפדפן), שני הבוטים בוואטסאפ
   (‏property-search.ts, שאילתה למסד), וההתראות וההתאמות במסד
   (‏saved_search_matches, ‏client_property_match, ב-SQL). כלל שתוקן באחד לא
   תוקן באחרים: "מרפסת כוללת מרפסת שמש" תוקן פעמיים בנפרד, וחיפוש של
   "3 חדרים עם ממ״ד" החזיר באתר דירות בלי ממ״ד (‏#874).

   כאן יושבים הכללים עצמם, פעם אחת:
     ‏• FEATURES   - מה נחשב "יש בנכס" (‏hasFeature), ואותו דבר כתנאי
                    PostgREST (‏featureFilter) לבוטים. מרפסת ← גם מרפסת שמש;
                    ממ״ד ← גם mamad_location = 'unit' (נכס מסחרי).
     ‏• featuresIn - המילים שגולש/ת כותב/ת ("עם ממד", "מעלית") ← קודים,
                    ו"בלי מעלית" / "לא צריך חניה" **אינם** בקשה.
     ‏• dealFromPrice - "עד 4,000" הוא שכירות, "עד 1.5 מיליון" קנייה.
     ‏• norm       - נרמול הטקסט שכל הפירוש נשען עליו.

   **הקובץ קיים פעמיים, זהה בבית:** ‏assets/search-core.js (נטען בדף הבית לפני
   sentence-search.js) ו-supabase/functions/_shared/search-core.js (‏import
   לצד-אפקט בשרת). ‏scripts/check_search_core.py חוסם ב-CI שני עותקים שונים -
   עורכים את assets/ ומעתיקים (‏--fix). ה-SQL אינו יכול להריץ את הקובץ, ולכן
   scripts/search_feature_cases.json הוא החוזה: אותן דוגמאות רצות מול הליבה
   ב-CI ומול שתי פונקציות המסד בסוכן התפעולי (‏search_rules_drift).

   סקריפט רגיל ולא מודול, כמו ליבת הייבוא: בדף הבית הכול סקריפטים רגילים,
   ובשרת `import` של קובץ שאינו מייצא דבר משאיר את globalThis.SearchCore.
   ============================================================================ */
(function (root) {
  'use strict';

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/(\d),(?=\d{3})/g, '$1')        // 1,600,000 → 1600000
      .replace(/(\d)\.(?=\d)/g, '$1\u0000')     // 2.8 שורד את ניקוי הנקודות
      .replace(/[׳'"״`]/g, '')
      .replace(/[-־–—.,:;!?()]/g, ' ')
      .replace(/עילית/g, 'עלית')
      .replace(/\u0000/g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- מה נחשב "יש בנכס" ----------
     ‏also: קודים נוספים במערך features שמקיימים את המאפיין. ‏column: עמודה
     שערך בה מקיים אותו. כל השאר - הקוד עצמו במערך, ותו לא. */
  var FEATURES = {
    // ‏14.10.2026: 15 מודעות פעילות מסמנות רק sun_balcony, ונעלמו מחיפוש של מרפסת
    balcony: { also: ['sun_balcony'] },
    // ממ״ד בנכס מסחרי יושב בעמודת מיקום ולא במערך (3 נכסים פעילים, 21.10.2026)
    mamad: { column: ['mamad_location', 'unit'] },
  };

  function hasFeature(p, code) {
    var feats = p && Array.isArray(p.features) ? p.features : [];
    if (feats.indexOf(code) >= 0) return true;
    var rule = FEATURES[code];
    if (!rule) return false;
    if (rule.also && rule.also.some(function (c) { return feats.indexOf(c) >= 0; })) return true;
    if (rule.column && p && p[rule.column[0]] === rule.column[1]) return true;
    return false;
  }

  function hasFeatures(p, codes) {
    return (codes || []).every(function (c) { return hasFeature(p, c); });
  }

  /* אותו כלל כתנאי PostgREST: ‏strict - קודים שמספיק להם `contains`,
     ‏groups - קבוצת "או" לכל קוד שיש לו כלל (ל-`or`, ‏property-search.ts). */
  function featureFilter(codes) {
    var strict = [], groups = [];
    (codes || []).forEach(function (c) {
      var rule = FEATURES[c];
      if (!rule) { strict.push(c); return; }
      var g = ['features.cs.{' + c + '}'];
      (rule.also || []).forEach(function (a) { g.push('features.cs.{' + a + '}'); });
      if (rule.column) g.push(rule.column[0] + '.eq.' + rule.column[1]);
      groups.push(g);
    });
    return { strict: strict, groups: groups };
  }

  /* ---------- המילים ----------
     על טקסט אחרי norm(). ‏"מרפסת שמש" גוברת על "מרפסת" (היא כבר כוללת אותה). */
  var FEATURE_WORDS = [
    [/חני[יה]|חנייה|חניות/, 'parking'],
    [/(^| )[ובלה]?מעלית( |$)/, 'elevator'],
    [/מרפסת שמש/, 'sun_balcony'],
    [/מרפסת|מרפסות/, 'balcony'],
    [/(^| )[ובלה]?ממד( |$)/, 'mamad'],
    [/מרוהט/, 'furnished'],
    [/מיזוג|ממוזג|מזגן/, 'ac'],
    [/משופצ/, 'renovated_feature'],
    [/נגיש|גישה לנכים/, 'accessible'],
    [/עמדת טעינה|טעינה לרכב/, 'ev_charger'],
  ];
  var STORAGE_WORD = /(^| )[ובלה]?מחסן( |$)/;
  var FEATURE_LABELS = { parking: 'חניה', elevator: 'מעלית', sun_balcony: 'מרפסת שמש', balcony: 'מרפסת',
    mamad: 'ממ״ד', furnished: 'מרוהטת', ac: 'מיזוג', renovated_feature: 'משופצת', accessible: 'נגישה',
    ev_charger: 'עמדת טעינה', storage: 'מחסן' };

  /* ‏"בלי מעלית", "ללא חניה", "לא צריך ממד" - שלילה ממש לפני המילה. עד
     21.10.2026 הן נקראו כבקשה, ו"דירה בלי מעלית" סיננה דווקא דירות עם מעלית. */
  var NEGATION = /(^| )ו?(בלי|ללא|לא|אין|לא צריך|לא צריכה|לא צריכים|לא חייב|לא חייבת|לא חייבים|אין צורך ב?|לא משנה) ?$/;

  function wanted(t, re) {
    var g = new RegExp(re.source, 'g');
    var m;
    while ((m = g.exec(t))) {
      var start = m.index + (m[1] ? m[1].length : 0);
      if (!NEGATION.test(t.slice(Math.max(0, start - 16), start))) return true;
      if (g.lastIndex === m.index) g.lastIndex++;
    }
    return false;
  }

  /* ‏opts.residential: מחסן הוא מאפיין רק בנכס למגורים (במסחרי זה מיקום). */
  function featuresIn(text, opts) {
    var t = norm(text);
    var out = [];
    if (!t) return out;
    FEATURE_WORDS.forEach(function (fw) {
      if (out.indexOf(fw[1]) < 0 && wanted(t, fw[0])) out.push(fw[1]);
    });
    if (out.indexOf('sun_balcony') >= 0) out = out.filter(function (f) { return f !== 'balcony'; });
    if (opts && opts.residential && wanted(t, STORAGE_WORD)) out.push('storage');
    return out;
  }

  function featuresNote(list) {
    return (list || []).map(function (f) { return FEATURE_LABELS[f] || f; }).join(', ');
  }

  /* ---------- עסקה מתוך תקציב ----------
     ‏"דירה עד 4,000" בלי "להשכרה" היא שכירות, ו"עד 1.5 מיליון" קנייה. באמצע -
     אין הכרעה. */
  var RENT_MAX = 30000, SALE_MIN = 200000;
  function dealFromPrice(n) {
    n = Number(n);
    if (!isFinite(n) || n <= 0) return null;
    if (n <= RENT_MAX) return 'rent';
    if (n >= SALE_MIN) return 'sale';
    return null;
  }

  var SearchCore = {
    norm: norm,
    FEATURES: FEATURES, hasFeature: hasFeature, hasFeatures: hasFeatures, featureFilter: featureFilter,
    FEATURE_WORDS: FEATURE_WORDS, FEATURE_LABELS: FEATURE_LABELS, featuresIn: featuresIn, featuresNote: featuresNote,
    RENT_MAX: RENT_MAX, SALE_MIN: SALE_MIN, dealFromPrice: dealFromPrice,
  };
  root.SearchCore = SearchCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = SearchCore;
})(typeof window !== 'undefined' ? window : globalThis);

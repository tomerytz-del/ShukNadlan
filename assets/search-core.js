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

  /* ---------- אזורים ושכונות ----------
     שני כללים, אחד לכל צד של השאלה "האם הנכס בשכונה שביקשו":

     ‏1. **איפה הנכס.** ‏`neighborhood_id` - שיוך מהמצולע במפה או מבחירת
        סוכן/ת (‏docs/neighborhood-assignment.md). ‏`sales_area` הוא טקסט חופשי
        שהסוכן/ת כותב/ת, ואינו אמין: "מרכז העיר" כתוב על נכסים באזור
        התעשייה, ו"אזור עפולה והעמקים" על חצי עיר (‏47 נכסים פעילים שבהם הוא
        סותר את השכונה, 21.10.2026). לכן הוא נקרא **רק** כשאין שכונה, ורק דרך
        אותו מפענח שמות - לא בהתאמה חלקית. עד כאן הבוט התאים לו כ-substring,
        וחיפוש "מרכז העיר" החזיר נכסים באזור התעשייה.
     ‏2. **מה ביקשו.** שמות השכונות ועוד הכינויים מ-`neighborhood_aliases`
        (מקור אחד לאתר ולבוטים; עד כאן לאתר היו כינויים משלו בקוד), במפתח
        השוואה אחד (‏areaKey: "סי 1" = "C-1" = "c1"), כמילה שלמה עם אותיות
        השימוש ("בגבעת המורה"). ההתאמה הארוכה גוברת, ובשוויון - שם השכונה על
        הכינוי: "מרכז עפולה עלית" הוא עפולה עלית ולא "מרכז עפולה". כינוי
        משותף ("הדר" בחיפה) מחזיר כמה שכונות. ‏"מעלית" אינה "עלית".

     ‏opts.partial - התאמה חלקית למפתח (‏"המורה" ← גבעת המורה), רק כשידוע
     שהטקסט הוא שם של אזור (שדה area של הבוט). בשורת החיפוש באתר הטקסט הוא
     משפט שלם, ושם היא הייתה תופסת כל מילה. */
  var HEB_LATIN = [
    // אותיות השימוש לפני האות ("בסי 1") נשארות - hasWord מדלג עליהן
    [/(^| )([ובלמה]{0,2})סי(?= ?\d)/g, '$1$2c'], [/(^| )([ובלמה]{0,2})בי(?= ?\d)/g, '$1$2b'],
    [/(^| )([ובלמה]{0,2})די(?= ?\d)/g, '$1$2d'], [/(^| )([ובלמה]{0,2})אי(?= ?\d)/g, '$1$2a'],
  ];
  function areaKey(s) {
    var t = norm(s);
    HEB_LATIN.forEach(function (r) { t = t.replace(r[0], r[1]); });
    return t.replace(/([a-z]) +(?=\d)/g, '$1')
      .replace(/[^0-9a-zא-ת ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function compactKey(s) { return areaKey(s).replace(/ /g, ''); }

  // מילים שאינן שם: "שכונה 5" בלי המספר היא "שכונה", והיא הייתה תופסת כל משפט
  var GENERIC = ['שכונה', 'שכונת', 'אזור', 'איזור', 'העיר', 'עיר', 'רובע'];

  /* השמות שהשכונה נקראת בהם: השם המלא, בלי הסוגריים, מה שבתוכם, בלי הסיומת
     הלטינית ("לב העמק C1" ← "לב העמק"), ובלי ה' הידיעה ("ביוגב"). */
  function areaNames(label) {
    var label0 = String(label || '');
    var full = areaKey(label0);
    var out = [full];
    var add = function (n) { if (n && n.length >= 2 && out.indexOf(n) < 0 && GENERIC.indexOf(n) < 0) out.push(n); };
    add(areaKey(label0.replace(/\([^)]*\)/g, '')));
    var paren = label0.match(/\(([^)]*)\)/);
    if (paren) add(areaKey(paren[1]));
    add(areaKey(label0.replace(/[A-Za-z0-9]+/g, '')));
    if (/^ה[^ ]{3,}/.test(full)) add(full.slice(1));
    return out.filter(function (n) { return n.length >= 2; });
  }

  /* האינדקס: ‏areas = [{ target, label, aliases? }]. ‏target הוא מה שחוזר -
     ‏'hood:<id>' באתר, מזהה השכונה בבוט, ‏'city:<שם>' ליישוב באתר. */
  /* ‏opts.stop - שמות שמילה מתוכם לעולם אינה "מזהה" (היישוב העיקרי, העיר
     של הבוט): "בעפולה" אינו עפולה עלית. */
  var NOT_DISTINCT = ['שכונה', 'שכונת', 'השכונה', 'אזור', 'איזור', 'האזור', 'עיר', 'העיר'];
  function areaIndex(areas, opts) {
    var entries = [];
    (areas || []).forEach(function (a) {
      areaNames(a.label).forEach(function (k) { entries.push({ key: k, target: a.target, name: true, text: a.label }); });
      (a.aliases || []).forEach(function (al) {
        var k = areaKey(al);
        if (k.length >= 2) entries.push({ key: k, target: a.target, name: false, text: al });
      });
    });
    /* מילה מזהה: מופיעה בשמות ובכינויים של אזור אחד בלבד ("רובע" ← רובע
       יזרעאל, "המורה" ← גבעת המורה). מילה של שני אזורים - אינה מזהה. */
    var stop = {};
    ((opts && opts.stop) || []).forEach(function (x) { areaKey(x).split(' ').forEach(function (w) { if (w) stop[w] = true; }); });
    var owners = {};
    entries.forEach(function (e) {
      e.words = e.key.split(' ');
      e.words.forEach(function (w) { (owners[w] = owners[w] || {})[e.target] = e.text; });
    });
    var distinct = {};
    Object.keys(owners).forEach(function (w) {
      var targets = Object.keys(owners[w]);
      if (targets.length === 1 && w.length >= 3 && !/^\d+$/.test(w) && !stop[w] && NOT_DISTINCT.indexOf(w) < 0) distinct[w] = targets[0];
    });
    entries.distinct = distinct;
    return entries;
  }

  function hasLocWord(t, key) {
    var esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^| )(?:ו?ב|ו?מה?|ו?ל)' + esc + '( |$)').test(t);
  }

  function hasWord(t, key) {
    var esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^| )[ובלמהשכ]{0,3}' + esc + '( |$)').test(t);
  }

  /* ← { targets: [...], text: מה שזוהה, exact } או null */
  function findAreas(text, index, opts) {
    var t = areaKey(text).replace(/(^| )[ובלה]?מעלית(?= |$)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || !index || !index.length) return null;
    var best = null;
    index.forEach(function (e) {
      if (!hasWord(t, e.key)) return;
      var better = !best || e.key.length > best.key.length || (e.key.length === best.key.length && e.name && !best.name);
      if (better) best = e;
    });
    if (best) {
      var targets = [];
      index.forEach(function (e) {
        if (e.key === best.key && e.name === best.name && targets.indexOf(e.target) < 0) targets.push(e.target);
      });
      return { targets: targets, text: best.text, exact: true };
    }
    /* כל המילים של שם, בסדר אחר: "המורה גבעת", "יזרעאל רובע" */
    var multi = null;
    index.forEach(function (e) {
      if (e.words.length < 2 || !e.words.every(function (w) { return hasWord(t, w); })) return;
      if (!multi || e.key.length > multi.key.length || (e.key.length === multi.key.length && e.name && !multi.name)) multi = e;
    });
    if (multi) return { targets: [multi.target], text: multi.text, exact: false };
    /* מילה מזהה אחת: "ברובע" ← רובע יזרעאל. בשורת החיפוש באתר רק אחרי מילת
       מקום ("ב", "מה", "ל") - שם הטקסט הוא משפט שלם; בשדה area של הבוט בכל מקום. */
    var dist = index.distinct || {}, found = {}, foundText = '';
    Object.keys(dist).forEach(function (w) {
      if (opts && opts.partial ? hasWord(t, w) : hasLocWord(t, w)) { found[dist[w]] = true; foundText = foundText || w; }
    });
    var ft = Object.keys(found);
    if (ft.length === 1) {
      var lbl = index.filter(function (e) { return e.target === ft[0] && e.name; })[0];
      return { targets: ft, text: lbl ? lbl.text : foundText, exact: false };
    }
    if (opts && opts.partial) {
      var needle = t.replace(/^(?:(?:שכונת|שכונה|אזור|איזור|באזור|בשכונת) )+/, '').replace(/ /g, '');
      needle = needle.replace(/^(וב|ב|ה)(?=.{3})/, '');
      if (needle.length < 3) return null;
      var hits = [];
      index.forEach(function (e) {
        if (e.key.replace(/ /g, '').indexOf(needle) >= 0 && hits.indexOf(e.target) < 0) hits.push(e.target);
      });
      if (hits.length) return { targets: hits, text: text, exact: false };
    }
    return null;
  }

  /* השכונות של נכס, כ-targets של האינדקס. ‏hoodTarget(id) ממיר מזהה לצורת
     ה-target (באתר 'hood:'+id). ‏sales_area רק כשאין שכונה (ראו למעלה). */
  function propertyAreas(p, index, hoodTarget) {
    if (!p) return [];
    if (p.neighborhood_id !== null && p.neighborhood_id !== undefined && p.neighborhood_id !== '') {
      return [hoodTarget ? hoodTarget(p.neighborhood_id) : String(p.neighborhood_id)];
    }
    if (!p.sales_area) return [];
    var hit = findAreas(p.sales_area, index);
    return hit ? hit.targets : [];
  }

  function inAreas(p, targets, index, hoodTarget) {
    var mine = propertyAreas(p, index, hoodTarget);
    return mine.some(function (t) { return targets.indexOf(t) >= 0; });
  }

  /* שם שאינו שכונה (רחוב, יישוב, שם פרויקט - "עפולה ירוקה", "יוקה פארק"):
     הטקסט של הנכס. כאן `sales_area` כן נקרא - הוא בדיוק המקום שבו סוכן/ת
     כותב/ת שם פרויקט - כי השאלה אינה "באיזו שכונה" אלא "איפה כתוב". */
  /* ‏**בכל סדר, וחלק מהשם מספיק** (21.10.2026): "רום יעל" הוא "יעל רום",
     ו"הנשיא" הוא "הנשיא ויצמן". כל מילה של החיפוש צריכה להופיע כמילה (או
     כתחילת מילה) בטקסט של הנכס; ה' הידיעה ו"רחוב"/"שדרות" אינם חלק מההשוואה. */
  var STREET_WORDS = ['רחוב', 'רח', 'שדרות', 'שד', 'דרך', 'סמטת', 'כיכר'];
  function textWords(s) {
    return areaKey(s).split(' ').filter(function (w) { return w && STREET_WORDS.indexOf(w) < 0; })
      .map(function (w) { return w.length > 3 ? w.replace(/^ה/, '') : w; });
  }
  function textMatches(p, q) {
    var hood = p.neighborhood_name || (p.neighborhoods && p.neighborhoods.name) || '';
    return textHas([p.title, p.street, p.address, p.city, hood, p.sales_area].join(' '), q);
  }

  /* אותו כלל על כל טקסט - ב-CRM גם שם הבעלים, הטלפון ומספר המודעה. */
  function textHas(hay, q) {
    var needle = norm(q);
    if (!needle) return true;
    if (norm(hay).indexOf(needle) >= 0) return true;
    var qw = textWords(q);
    if (!qw.length) return false;
    var hw = textWords(hay);
    return qw.every(function (w) {
      return hw.some(function (h) { return h === w || (w.length >= 3 && h.indexOf(w) === 0); });
    });
  }

  /* ---------- שם מקום שלא זוהה ----------
     מה שגולש/ת כתב/ה אחרי "ב" ואינו שכונה, יישוב או מילה מוכרת: "דירה ביוקה
     פארק עם ממד" ← "יוקה פארק". זה מה שנרשם ל-area_name_misses, ומשם
     מנהל/ת מאשר/ת אותו ככינוי - כך האתר והבוטים לומדים את השמות המקומיים
     (‏docs/search-core.md, "הלולאה"). עד 3 מילים, בלי ספרות, ועד המילה
     המוכרת הבאה. ‏opts.exclude - שמות שאינם חסרים (היישוב העיקרי);
     ‏opts.whole - כשלא זוהה דבר, הטקסט כולו (עד 3 מילים) הוא המועמד. */
  var KNOWN_WORD = new RegExp('^(?:' + [
    'דירה', 'דירת', 'דירות', 'בית', 'בתים', 'נכס', 'נכסים', 'משרד', 'משרדים', 'חנות', 'חנויות', 'מגרש', 'מגרשים',
    'פנטהאוז', 'פנטהאוס', 'דופלקס', 'סטודיו', 'קוטג', 'וילה', 'גג', 'גן', 'יחידת', 'יחידה', 'דיור', 'מחסן',
    'חדר', 'חדרים', 'חד', 'עם', 'בלי', 'ללא', 'עד', 'מעל', 'מתחת', 'מיליון', 'אלף', 'אלפים', 'שח', 'שקל', 'שקלים',
    'למכירה', 'להשכרה', 'לקנות', 'לקנייה', 'לקניה', 'לשכור', 'קנייה', 'קניה', 'מכירה', 'השכרה', 'שכירות',
    'מחיר', 'תקציב', 'זול', 'זולה', 'גדול', 'גדולה', 'קטן', 'קטנה', 'חדש', 'חדשה', 'קומה', 'קומת', 'קרקע',
    'מעלית', 'חניה', 'חנייה', 'ממד', 'ממק', 'מרפסת', 'מרפסות', 'שמש', 'מרוהטת', 'מרוהט', 'משופצת', 'משופץ', 'מיזוג',
    'ו', 'או', 'של', 'את', 'יש', 'רוצה', 'רוצים', 'מחפש', 'מחפשת', 'מחפשים', 'אני', 'אנחנו', 'לי', 'לנו', 'גם', 'כל',
    'אזור', 'האזור', 'שכונה', 'השכונה', 'העיר', 'עיר', 'מרכזי', 'מיידית', 'כניסה', 'מיידי', 'משפחה', 'זוג', 'ילדים',
  ].join('|') + ')$');
  var AREA_LEAD = /^ו?(?:באזור|בשכונת|בשכונה|ברחוב|בישוב|ביישוב|בקיבוץ|במושב)$/;

  function areaCandidate(text, opts) {
    opts = opts || {};
    var words = areaKey(text).split(' ').filter(Boolean);
    var known = function (w) { return /\d/.test(w) || KNOWN_WORD.test(w) || KNOWN_WORD.test(w.replace(/^[ובלה]/, '')); };
    var out = null;
    for (var i = 0; i < words.length && !out; i++) {
      var w = words[i], first = null, start = i + 1;
      if (AREA_LEAD.test(w)) { first = words[i + 1]; start = i + 2; if (first && known(first)) first = null; }
      else {
        var m = w.match(/^ו?ב(.{2,})$/);
        if (m && !known(w) && !known(m[1])) first = m[1];
      }
      if (!first) continue;
      var got = [first];
      for (var j = start; j < words.length && got.length < 3 && !known(words[j]); j++) got.push(words[j]);
      out = got.join(' ');
    }
    if (!out && opts.whole && words.length && words.length <= 3 && !words.some(known)) out = words.join(' ');
    if (!out || out.length < 2) return null;
    var key = compactKey(out);
    if ((opts.exclude || []).some(function (x) { return x && compactKey(x) === key; })) return null;
    return out;
  }

  var SearchCore = {
    norm: norm, textMatches: textMatches, textHas: textHas, areaCandidate: areaCandidate,
    areaKey: areaKey, compactKey: compactKey, areaNames: areaNames, areaIndex: areaIndex,
    findAreas: findAreas, propertyAreas: propertyAreas, inAreas: inAreas, hasWord: hasWord,
    FEATURES: FEATURES, hasFeature: hasFeature, hasFeatures: hasFeatures, featureFilter: featureFilter,
    FEATURE_WORDS: FEATURE_WORDS, FEATURE_LABELS: FEATURE_LABELS, featuresIn: featuresIn, featuresNote: featuresNote,
    RENT_MAX: RENT_MAX, SALE_MIN: SALE_MIN, dealFromPrice: dealFromPrice,
  };
  root.SearchCore = SearchCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = SearchCore;
})(typeof window !== 'undefined' ? window : globalThis);

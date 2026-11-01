#!/usr/bin/env node
/* בדיקות לליבת החיפוש (‏assets/search-core.js) - החוזה שבין האתר לבוטים.
   ‏docs/search-core.md. הרצה: node scripts/search_core_test.cjs

   שלושה דברים נבדקים מול scripts/search_feature_cases.json:
     1. ‏hasFeatures - מה שהאתר מסנן לפיו.
     2. ‏featureFilter - התנאי ש-property-search.ts שולח למסד (שני הבוטים),
        מוערך כאן על אותו נכס. אם השניים חלוקים, האתר והבוט מחזירים נכסים
        שונים לאותה בקשה - וזה בדיוק מה שהליבה קיימת כדי למנוע.
     3. ‏featuresIn ו-dealFromPrice - המילים והעסקה מתוך תקציב.
   מול פונקציות המסד אותן דוגמאות רצות בסוכן התפעולי (‏search_rules_drift). */
'use strict';
const assert = require('assert');
const path = require('path');
const SC = require(path.join(__dirname, '..', 'assets', 'search-core.js'));
const SPEC = require(path.join(__dirname, 'search_feature_cases.json'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

// מעריך תנאי PostgREST מהצורה ש-featureFilter מייצרת על נכס אחד
function term(p, t) {
  let m = t.match(/^features\.cs\.\{([^}]+)\}$/);
  if (m) return (p.features || []).includes(m[1]);
  m = t.match(/^(\w+)\.eq\.(.+)$/);
  if (m) return String(p[m[1]]) === m[2];
  throw new Error('תנאי לא מוכר: ' + t);
}
function viaQuery(p, codes) {
  const f = SC.featureFilter(codes);
  return f.strict.every(c => (p.features || []).includes(c)) && f.groups.every(g => g.some(t => term(p, t)));
}

SPEC.cases.forEach(c => {
  test('אתר: ' + c.name, () => assert.strictEqual(SC.hasFeatures(c.property, c.require), c.match));
  test('בוטים: ' + c.name, () => assert.strictEqual(viaQuery(c.property, c.require), c.match));
});

SPEC.phrases.forEach(c => {
  test('מילים: ' + c.text, () => assert.deepStrictEqual(
    SC.featuresIn(c.text, { residential: true }).sort(), c.features.slice().sort()));
});

SPEC.deals.forEach(c => {
  test('עסקה מ-' + c.price, () => assert.strictEqual(SC.dealFromPrice(c.price), c.deal));
});

// ---------- אזורים: אותו מפענח לאתר ולבוטים ----------
const A = SPEC.areas;
const INDEX = SC.areaIndex(A.hoods.map(h => ({ target: h.id, label: h.name, aliases: h.aliases })), { stop: A.stop || [] });
A.phrases.forEach(c => {
  test('אזור: ' + c.text, () => {
    const hit = SC.findAreas(c.text, INDEX);
    assert.deepStrictEqual(hit ? hit.targets : [], c.hoods);
    const part = SC.findAreas(c.text, INDEX, { partial: true });
    assert.deepStrictEqual(part ? part.targets : [], c.partial || c.hoods);
  });
});
A.properties.forEach(c => {
  test('נכס בשכונה: ' + c.name, () => assert.strictEqual(SC.inAreas(c.property, [c.hood], INDEX), c.match));
});
A.text.forEach(c => {
  test('טקסט: ' + c.name, () => assert.strictEqual(SC.textMatches(c.property, c.q), c.match));
});

test('שם מקום שלא זוהה: מה שאחרי "ב", בלי המילים המוכרות', () => {
  const ex = { exclude: ['עפולה'] };
  assert.strictEqual(SC.areaCandidate('דירה ביוקה פארק', ex), 'יוקה פארק');
  assert.strictEqual(SC.areaCandidate('3 חדרים בנווה עמק עם ממד', ex), 'נווה עמק');
  assert.strictEqual(SC.areaCandidate('למכירה בשכונת הפרחים', ex), 'הפרחים');
  assert.strictEqual(SC.areaCandidate('דירה בעפולה', ex), null);
  assert.strictEqual(SC.areaCandidate('בית ב3 חדרים', ex), null);
  assert.strictEqual(SC.areaCandidate('דירה במחיר טוב', ex), null);
  assert.strictEqual(SC.areaCandidate('יוקה פארק', ex), null);
  assert.strictEqual(SC.areaCandidate('יוקה פארק', Object.assign({ whole: true }, ex)), 'יוקה פארק');
});

test('מחסן הוא מאפיין רק במגורים', () => {
  assert.deepStrictEqual(SC.featuresIn('עם מחסן', { residential: true }), ['storage']);
  assert.deepStrictEqual(SC.featuresIn('עם מחסן', { residential: false }), []);
});

test('לכל מילה יש תווית', () => {
  SC.FEATURE_WORDS.forEach(fw => assert.ok(SC.FEATURE_LABELS[fw[1]], fw[1]));
});

test('כל מילה מתורגמת לקוד שנכס יכול לשאת', () => {
  SC.FEATURE_WORDS.forEach(fw => assert.ok(SC.knownFeature(fw[1]), fw[1]));
  assert.ok(SC.knownFeature('storage'));
  assert.ok(!SC.knownFeature('garden'));
});

// ---------- סוגי נכס: אותו מפענח לאתר ולבוטים ----------
SPEC.types.words.forEach(c => {
  test('סוג: ' + c.text, () => assert.strictEqual(SC.typeIn(c.text), c.type));
});
SPEC.types.bot.forEach(c => {
  test('סוג בבוט: ' + c.in.join(','), () => assert.deepStrictEqual(SC.botTypes(c.in), { types: c.types, unknown: c.unknown }));
});
test('כל קבוצת סוג נשענת על ערכים שבמסד', () => {
  Object.keys(SC.PROPERTY_TYPES).forEach(k => SC.PROPERTY_TYPES[k].forEach(v => assert.ok(SC.PTYPE_NAMES.includes(v), k + ': ' + v)));
  assert.deepStrictEqual(SC.typePtypes('raw:סטודיו/לופט'), ['סטודיו/לופט', 'סטודיו']);
  assert.strictEqual(SC.typePtypes('commercial'), null);
});

test('מאפיין שלא זוהה: מה שאחרי "עם", בלי מה שכבר מזוהה', () => {
  assert.strictEqual(SC.featureCandidate('דירה עם גינה'), 'גינה');
  assert.strictEqual(SC.featureCandidate('משרד עם נוף לעמק בעפולה'), 'נוף לעמק');
  assert.strictEqual(SC.featureCandidate('דירה עם ממד'), null);
  assert.strictEqual(SC.featureCandidate('דירה עם 3 חדרים'), null);
  assert.strictEqual(SC.featureCandidate('דירה עם מרפסת שמש'), null);
  assert.strictEqual(SC.featureCandidate('דירה בגבעת המורה'), null);
  assert.strictEqual(SC.featureCandidate('בית עם מחסן וגינה'), null);
});

test('מחיר להשוואה: מחיר למ״ר כפול השטח (docs/price-unit.md)', () => {
  // ‏price_total מהמסד גובר - זו אותה עמודה שהשאילתות בשרת משוות מולה
  assert.strictEqual(SC.comparablePrice({ price: 140, price_unit: 'sqm', size_sqm: 170, price_total: 23800 }), 23800);
  // בלי price_total - אותה נוסחה: בנוי קודם, ובמגרש שטח המגרש
  assert.strictEqual(SC.comparablePrice({ price: 140, price_unit: 'sqm', built_size_sqm: 170, size_sqm: 200 }), 23800);
  assert.strictEqual(SC.comparablePrice({ price: 20, price_unit: 'sqm', size_sqm: 2250 }), 45000);
  // למ״ר בלי שטח - המחיר כמו שהוא; ובלי יחידה - המחיר
  assert.strictEqual(SC.comparablePrice({ price: 140, price_unit: 'sqm' }), 140);
  assert.strictEqual(SC.comparablePrice({ price: 4800, size_sqm: 90 }), 4800);
  assert.strictEqual(SC.comparablePrice({ price: null }), null);
});

test('כתיב מלא וחסר: יו"ד וו"ו כפולות וה"א סופית (docs/street-registry.md)', () => {
  const street = 'דירה ברחוב עלייה 5, עפולה';
  ['העלייה', 'עלייה', 'העליה', 'עליה', 'רחוב העלייה'].forEach(q => assert.ok(SC.textHas(street, q), q));
  assert.ok(SC.textHas('העליה השניה 3', 'העלייה השנייה'));
  assert.ok(SC.textHas('שכונת נוף הגלבוע', 'נוף הגלבוע'));
  assert.ok(SC.textHas('רחוב דוד', 'דווד'));
  assert.deepStrictEqual(SC.textWords('העלייה'), ['עלי']);
  assert.deepStrictEqual(SC.textWords('עליה'), ['עלי']);
  assert.deepStrictEqual(SC.textWords('בית'), ['בית']);
  // ה"א סופית שירדה - מילה שלמה בלבד: "עליה" אינו "עלית"
  assert.strictEqual(SC.textHas('עפולה עלית', 'עליה'), false);
  assert.strictEqual(SC.textHas('עפולה עלית', 'העלייה'), false);
  // מה שהתאים קודם עדיין מתאים: חלק מהשם, בכל סדר, וה' הידיעה
  assert.ok(SC.textHas('הנשיא ויצמן 4', 'הנשיא'));
  assert.ok(SC.textHas('יעל רום', 'רום יעל'));
  assert.ok(SC.textHas('העמק 12', 'עמק'));
  assert.ok(SC.textHas('הרצל 10', 'הרצל'));
  assert.strictEqual(SC.textHas('העמק 12', 'הרצל'), false);
});

const Sentence = require(path.join(__dirname, '..', 'assets', 'sentence-search.js'));
const TAANACH = ['אביטל', 'אדירים', 'ברק', 'גדיש', 'דבורה', 'מלאה', 'מיטב', 'אומן', 'חבר', 'יעל', 'ניר יפה', 'פרזון'];
const TAANACH_GROUPS = [{
  name: 'חבל תענך',
  aliases: ['תענכים', 'התענכים', 'חבל תענך', 'תענך', 'יישובי תענך', 'ישובי תענך', 'גוש תענך', 'אזור תענך'],
  member_names: TAANACH,
}];
function taanachCities(q, ptype) {
  const props = TAANACH.map((city, i) => ({
    id: 't' + i, category: 'residential', city, deal_type: 'sale', property_type: ptype,
    rooms: 4, price: 1500000, lat: 32.6, lng: 35.29,
  }));
  [1, 2, 3].forEach(n => props.push({
    id: 'af' + n, category: 'residential', city: 'עפולה', deal_type: 'sale', property_type: ptype,
    rooms: 4, price: 1500000, lat: 32.6, lng: 35.29,
  }));
  const areas = Sentence.deriveAreas(props, [], TAANACH_GROUPS);
  const ctx = { areaIndex: areas.index };
  const hit = SC.findAreas(q, areas.index);
  assert.strictEqual(hit.targets.length, q === 'אומן' ? 1 : 12, q);
  const parsed = Sentence.compileQuery(q, Sentence.defaultState(), areas, props, ctx, []);
  const st = Sentence.applyPatch(Sentence.defaultState(), parsed.patch);
  const rows = Sentence.filter(props, st, ctx);
  return { cities: [...new Set(rows.map(p => p.city))].sort(), n: rows.length };
}
test('חבל תענך בליבה: תענכים, התענכים, דירה בחבל תענך ובית בתענך הם 12 היישובים בלי עפולה', () => {
  const want = TAANACH.slice().sort();
  [['תענכים', 'דירה'], ['התענכים', 'דירה'], ['דירה בחבל תענך', 'דירה']].forEach(([q, ptype]) => {
    const got = taanachCities(q, ptype);
    assert.deepStrictEqual(got.cities, want, q);
    assert.strictEqual(got.n, 12, q);
    assert.ok(!got.cities.includes('עפולה'), q);
  });
  const house = taanachCities('בית בתענך', "בית פרטי/קוטג'");
  assert.deepStrictEqual(house.cities, want);
  assert.strictEqual(house.n, 12);
});
test('אומן לבד בליבה הוא רק אומן', () => {
  const got = taanachCities('אומן', 'דירה');
  assert.deepStrictEqual(got.cities, ['אומן']);
  assert.strictEqual(got.n, 1);
});

console.log(passed + ' בדיקות עברו' + (process.exitCode ? ' - ויש כישלונות' : ''));

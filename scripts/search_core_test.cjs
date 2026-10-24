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

console.log(passed + ' בדיקות עברו' + (process.exitCode ? ' - ויש כישלונות' : ''));

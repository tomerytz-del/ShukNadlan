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

test('מחסן הוא מאפיין רק במגורים', () => {
  assert.deepStrictEqual(SC.featuresIn('עם מחסן', { residential: true }), ['storage']);
  assert.deepStrictEqual(SC.featuresIn('עם מחסן', { residential: false }), []);
});

test('לכל מילה יש תווית', () => {
  SC.FEATURE_WORDS.forEach(fw => assert.ok(SC.FEATURE_LABELS[fw[1]], fw[1]));
});

console.log(passed + ' בדיקות עברו' + (process.exitCode ? ' - ויש כישלונות' : ''));

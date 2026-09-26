#!/usr/bin/env node
/* בדיקות ל-Core של assets/sentence-search.js - הפירוש, הכתובת והספירה.
   ‏docs/sentence-search.md. הרצה: node scripts/sentence_search_test.cjs

   המלאי כאן בנוי כמו המלאי האמיתי של עפולה: שמות השכונות הם אלה שבמסד
   ("עפולה עלית" בלי יוד, "לב העמק C1"), ולא הרשימה מהאפיון. */
'use strict';
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'assets', 'sentence-search.js'));

const P = (o) => Object.assign({ id: String(Math.random()), category: 'residential', city: 'עפולה', lat: 32.6, lng: 35.29 }, o);
const PROPS = [
  P({ id: 'a', deal_type: 'sale', property_type: 'דירה', rooms: 4, price: 1650000, neighborhood_id: 1, neighborhood_name: 'גבעת המורה' }),
  P({ id: 'b', deal_type: 'sale', property_type: 'דירה', rooms: 3.5, price: 1250000, neighborhood_id: 1, neighborhood_name: 'גבעת המורה' }),
  P({ id: 'c', deal_type: 'rent', property_type: 'דירה', rooms: 4, price: 5200, neighborhood_id: 1, neighborhood_name: 'גבעת המורה' }),
  P({ id: 'd', deal_type: 'rent', property_type: 'דירה', rooms: 3, price: 3500, neighborhood_id: 2, neighborhood_name: 'מרכז העיר' }),
  P({ id: 'e', deal_type: 'sale', property_type: "בית פרטי/קוטג'", rooms: 5, price: 2390000, neighborhood_id: 3, neighborhood_name: 'עפולה עלית' }),
  P({ id: 'f', deal_type: 'sale', property_type: 'דו משפחתי', rooms: 5, price: 1900000, neighborhood_id: 3, neighborhood_name: 'עפולה עלית' }),
  P({ id: 'g', deal_type: 'rent', category: 'commercial', property_type: 'משרדים', rooms: null, price: 4000, neighborhood_id: 4, neighborhood_name: 'לב העמק C1' }),
  P({ id: 'h', deal_type: 'sale', property_type: 'מגרש', rooms: null, price: 3900000, city: 'היוגב' }),
  P({ id: 'i', deal_type: 'sale', property_type: 'דירת גן', rooms: 4, price: null, neighborhood_id: 2, neighborhood_name: 'מרכז העיר', street: 'הנרקיס' }),
];
const AREAS = C.deriveAreas(PROPS);
const CTX = { marketLabel: 'עפולה והעמק' };

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

// המשפט, כפי שהוא מוצג, אחרי פירוש על מצב נתון
function afterParse(text, st) {
  st = st || C.defaultState();
  const r = C.parse(text, st, AREAS);
  const next = C.applyPatch(st, r.patch);
  return { st: next, fields: r.fields, slots: C.slotsFor(next, AREAS, CTX).map(s => s.value) };
}

test('האזורים נגזרים מהמלאי, והיישוב העיקרי אינו אזור', () => {
  const labels = AREAS.map(a => a.label);
  assert.ok(labels.includes('גבעת המורה'));
  assert.ok(labels.includes('היוגב'));
  assert.ok(!labels.includes('עפולה'));
  assert.strictEqual(AREAS.mainCity, 'עפולה');
});

test('קבלה 1: "לשכור 4 חדרים בגבעת המורה עד 5500"', () => {
  const { slots } = afterParse('לשכור 4 חדרים בגבעת המורה עד 5500');
  assert.deepStrictEqual(slots, ['לשכור', 'דירה', 'גבעת המורה', '4-5 חדרים', 'עד ₪5,500']);
});

test('קבלה 2: "בית פרטי בעפולה עד 2.8 מיליון" - גם כשהמצב הקודם היה שכירות', () => {
  const rentState = C.applyPatch(C.defaultState(), { deal: 'rent', area: 'hood:2' });
  const { st, slots } = afterParse('בית פרטי בעפולה עד 2.8 מיליון', rentState);
  assert.strictEqual(st.deal, 'sale');
  assert.strictEqual(st.area, 'all');
  assert.deepStrictEqual([slots[0], slots[1], slots[2], slots[slots.length - 1]], ['לקנות', 'בית פרטי', 'כל עפולה והעמק', 'עד 2.8 מ׳']);
});

test('דוגמת ה-placeholder: "דירת 4 חדרים בגבעת המורה עד 1.7 מיליון" מתעגל למדרגה', () => {
  const { st } = afterParse('דירת 4 חדרים בגבעת המורה עד 1.7 מיליון');
  assert.strictEqual(st.type, 'apt');
  assert.deepStrictEqual(st.rooms, [4, 5.5]);
  assert.strictEqual(st.priceMax, 2000000);
  assert.strictEqual(st.area, 'hood:1');
});

test('כתיב חלופי: "עפולה עילית", "גבעה", "לב העמק"', () => {
  assert.strictEqual(afterParse('בית בעפולה עילית').st.area, 'hood:3');
  assert.strictEqual(afterParse('דירה בגבעה').st.area, 'hood:1');
  assert.strictEqual(afterParse('משרד בלב העמק').st.area, 'hood:4');
});

test('מספר עם פסיקים, "5+ חדרים", ומספר במילים', () => {
  assert.strictEqual(afterParse('עד 1,600,000').st.priceMax, 1600000);
  assert.deepStrictEqual(afterParse('5+ חדרים').st.rooms, [5, 99]);
  assert.deepStrictEqual(afterParse('שלושה חדרים').st.rooms, [3, 4.5]);
});

test('תקציב מעל הסולם = בלי הגבלה, ומה שלא זוהה נשאר', () => {
  const base = C.applyPatch(C.defaultState(), { rooms: [3, 4.5] });
  const { st } = afterParse('עד 9 מיליון', base);
  assert.strictEqual(st.priceMax, null);
  assert.deepStrictEqual(st.rooms, [3, 4.5]);
});

test('טקסט בלי שום זיהוי מחזיר fields ריק', () => {
  assert.deepStrictEqual(afterParse('שלום').fields, []);
});

test('שינוי עסקה מאפס את התקציב, וסוג בלי חדרים מוריד אותם', () => {
  let st = C.applyPatch(C.defaultState(), { priceMax: 1600000, rooms: [3, 4.5] });
  st = C.applyPatch(st, { deal: 'rent' });
  assert.strictEqual(st.priceMax, null);
  st = C.applyPatch(st, { type: 'office' });
  assert.strictEqual(st.rooms, null);
  assert.ok(!C.slotsFor(st, AREAS, CTX).some(s => s.slot === 'rooms'));
});

test('המונים בבורר שווים לתוצאה בפועל של כל בחירה', () => {
  const st = C.applyPatch(C.defaultState(), { rooms: [3, 4.5] });
  ['deal', 'type', 'area', 'rooms', 'price'].forEach(slot => {
    C.options(slot, st, PROPS, CTX, AREAS).forEach(o => {
      if (o.count === null) return;
      const patch = { deal: { deal: o.value }, type: { type: o.value }, area: { area: o.value }, rooms: { rooms: o.value }, price: { priceMax: o.value } }[slot];
      assert.strictEqual(o.count, C.filter(PROPS, C.applyPatch(st, patch), CTX).length, slot + ':' + o.label);
    });
  });
});

test('אזור בלי התאמה יורד מהרשימה, ושאר האפשרויות עם 0 נשארות', () => {
  const st = C.applyPatch(C.defaultState(), { deal: 'rent' });
  const areas = C.options('area', st, PROPS, CTX, AREAS).map(o => o.label);
  assert.ok(!areas.includes('עפולה עלית'));
  const types = C.options('type', st, PROPS, CTX, AREAS);
  assert.ok(types.some(o => o.count === 0));
});

test('כשאין תוצאה - הרחבה שמחזירה משהו', () => {
  const st = C.applyPatch(C.defaultState(), { deal: 'sale', area: 'hood:1', priceMax: 1200000, rooms: [4, 5.5] });
  assert.strictEqual(C.filter(PROPS, st, CTX).length, 0);
  const hint = C.widenHint(st, PROPS, CTX);
  assert.strictEqual(hint.slot, 'price');
  assert.strictEqual(hint.count, 1);
});

test('כתובות החיפוש הפופולרי נקראות ונכתבות בחזרה כמו שהן', () => {
  [
    'deal=sale&rooms=4',
    'deal=sale&maxPrice=1500000',
    'deal=sale&ptype=' + encodeURIComponent('דירת גן'),
    'deal=sale&ptype=' + encodeURIComponent("בית פרטי/קוטג'"),
    'deal=rent&maxPrice=4000',
    'deal=commercial&ptype=' + encodeURIComponent('משרדים'),
  ].forEach(qs => {
    const st = C.fromParams(new URLSearchParams(qs));
    assert.strictEqual(C.toParams(st, AREAS, CTX), qs, qs);
  });
});

test('?deal=sale&q=גבעת המורה נפתר לשכונה, ו-?rooms=3,3.5,4 לטווח', () => {
  let st = C.fromParams(new URLSearchParams('deal=sale&q=' + encodeURIComponent('גבעת המורה')));
  st = C.resolveArea(st, AREAS);
  assert.strictEqual(st.area, 'hood:1');
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=3,3.5,4')).rooms, [3, 4]);
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=%2B6')).rooms, [6, 99]);
});

test('rooms=3-4 הוא המדרגה "3-4 חדרים", ו-rooms=4 בדיוק 4', () => {
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=3-4')).rooms, [3, 4.5]);
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=4')).rooms, [4, 4]);
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=5%2B')).rooms, [5, 99]);
  C.ROOM_BUCKETS.forEach(b => {
    const st = C.applyPatch(C.defaultState(), { rooms: b });
    assert.deepStrictEqual(C.fromParams(new URLSearchParams(C.toParams(st, AREAS, CTX))).rooms, b);
  });
});

test('מצב → כתובת → מצב שומר על החיפוש', () => {
  const st = C.applyPatch(C.defaultState(), { deal: 'rent', type: 'apt', area: 'hood:1', rooms: [4, 5.5], priceMax: 5500 });
  const back = C.resolveArea(C.fromParams(new URLSearchParams(C.toParams(st, AREAS, CTX))), AREAS);
  ['deal', 'type', 'area', 'rooms', 'priceMax'].forEach(k => assert.deepStrictEqual(back[k], st[k], k));
});

test('לפני כל בחירה המשפט אינו מסנן: כל הנכסים', () => {
  assert.strictEqual(C.filter(PROPS, C.defaultState(), CTX).length, PROPS.length);
  assert.strictEqual(C.toParams(C.defaultState(), AREAS, CTX), '');
  const deal = C.options('deal', C.defaultState(), PROPS, CTX, AREAS);
  assert.deepStrictEqual(deal.map(o => o.value), ['sale', 'rent', null]);
  assert.ok(deal[2].selected);
});

test('המילה המתחלפת: רק אפשרויות עם נכסים, וקצרות', () => {
  assert.deepStrictEqual(C.rollLabels('deal', C.defaultState(), PROPS, CTX, AREAS), ['לקנות', 'לשכור']);
  const types = C.rollLabels('type', C.defaultState(), PROPS, CTX, AREAS);
  assert.ok(types.includes('דירה') && !types.includes('פנטהאוז') && !types.includes('נכס'));
  const hoods = C.rollLabels('area', C.defaultState(), PROPS, CTX, AREAS);
  assert.strictEqual(hoods[0], 'גבעת המורה');
  assert.ok(hoods.every(l => l.length <= 14));
});

test('סינון מתקדם חל על המונים, וההרחבה מציעה לנקות אותו', () => {
  const ctx = Object.assign({}, CTX, { extra: p => p.rooms === 99 });
  const st = C.defaultState();
  assert.strictEqual(C.filter(PROPS, st, ctx).length, 0);
  const hint = C.widenHint(st, PROPS, ctx);
  assert.strictEqual(hint.slot, 'extra');
  assert.strictEqual(hint.count, PROPS.length);
});

test('תוויות המשפט בלי מקף ארוך', () => {
  const st = C.applyPatch(C.defaultState(), { rooms: [3, 4.5] });
  C.slotsFor(st, AREAS, CTX).forEach(s => assert.ok(!/[–—]/.test(s.value), s.value));
});

console.log(passed + ' בדיקות עברו' + (process.exitCode ? ' - ויש כישלונות' : ''));

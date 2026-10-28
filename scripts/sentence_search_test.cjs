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
/* הכינויים כפי שהם ב-neighborhood_aliases (‏21.10.2026) - מקור אחד לאתר
   ולבוטים. "עלית" נוסף במיגרציה 20270717090000 (היה עד אז ALIASES בקוד). */
const ALIASES = [
  { neighborhood_id: 1, alias: 'גבעה' }, { neighborhood_id: 1, alias: 'הגבעה' }, { neighborhood_id: 1, alias: 'נוף יזרעאל' },
  { neighborhood_id: 3, alias: 'עלית' }, { neighborhood_id: 3, alias: 'עפולה הצעירה' },
  { neighborhood_id: 4, alias: 'לב העמק' }, { neighborhood_id: 4, alias: 'C1' }, { neighborhood_id: 4, alias: 'סי 1' },
  { neighborhood_id: 2, alias: 'מרכז' }, { neighborhood_id: 2, alias: 'מרכז עפולה' },
];
const AREAS = C.deriveAreas(PROPS, ALIASES);
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
  assert.deepStrictEqual(slots, ['לשכור', 'דירה', 'גבעת המורה', '4 חדרים', 'עד ₪5,500']);
});

test('קבלה 2: "בית פרטי בעפולה עד 2.8 מיליון" - גם כשהמצב הקודם היה שכירות', () => {
  const rentState = C.applyPatch(C.defaultState(), { deal: 'rent', area: 'hood:2' });
  const { st, slots } = afterParse('בית פרטי בעפולה עד 2.8 מיליון', rentState);
  assert.strictEqual(st.deal, 'sale');
  assert.strictEqual(st.area, 'all');
  assert.deepStrictEqual([slots[0], slots[1], slots[2], slots[slots.length - 1]], ['לקנות', 'בית פרטי', 'כל עפולה והעמק', 'עד 2.8 מ׳']);
});

test('דוגמת ה-placeholder: "דירת 4 חדרים בגבעת המורה עד 1.7 מיליון" - התקציב כמו שנאמר', () => {
  const { st } = afterParse('דירת 4 חדרים בגבעת המורה עד 1.7 מיליון');
  assert.strictEqual(st.type, 'apt');
  assert.deepStrictEqual(st.rooms, [4, 4.5]);
  assert.strictEqual(st.priceMax, 1700000);
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
  assert.deepStrictEqual(afterParse('שלושה חדרים').st.rooms, [3, 3.5]);
});

test('"4 חדרים" הוא 4 עד 4.5 - בלי דירות 5 חדרים, ונשמר בכתובת', () => {
  const st = afterParse('4 חדרים להשכרה').st;
  assert.deepStrictEqual(st.rooms, [4, 4.5]);
  assert.strictEqual(C.roomsLabel(st.rooms), '4 חדרים');
  assert.deepStrictEqual(afterParse('4.5 חדרים').st.rooms, [4.5, 4.5]);
  assert.deepStrictEqual(afterParse('5 חדרים').st.rooms, [5, 5.5]);
  assert.deepStrictEqual(afterParse('4+ חדרים').st.rooms, [4, 99]);
  const back = C.fromParams(new URLSearchParams(C.toParams(st, AREAS, CTX)));
  assert.deepStrictEqual(back.rooms, [4, 4.5]);
});

test('תקציב מעל הסולם נשאר כמו שנאמר, ומה שלא זוהה נשאר', () => {
  const base = C.applyPatch(C.defaultState(), { rooms: [3, 4.5] });
  const { st } = afterParse('עד 9 מיליון', base);
  assert.strictEqual(st.priceMax, 9000000);
  assert.deepStrictEqual(st.rooms, [3, 4.5]);
});

test('"דירה במגדל העמק" באתר של עפולה - נכסי העיר ולא כל הדירות בעפולה', () => {
  require(path.join(__dirname, '..', 'assets', 'markets.js'));
  const places = globalThis.ShukMarkets.list.flatMap(m => (m.places || []).map(name => ({
    name, market: { label: m.label, live: m.live, path: m.path }, here: m.label === CTX.marketLabel, main: name === m.city,
  })));
  const r = C.parse('דירה במגדל העמק', C.defaultState(), AREAS, places);
  assert.deepStrictEqual(r.fields, ['type', 'area']);
  assert.strictEqual(r.patch.area, 'text:מגדל העמק');
  assert.strictEqual(r.place.here, false);
  const st = C.applyPatch(C.defaultState(), r.patch);
  // לפני שנכסי העיר נטענו - אפס, ולא 86 דירות בעפולה
  assert.strictEqual(C.filter(PROPS, st, CTX).length, 0);
  // אחרי הטעינה (‏_away): מופיעים בחיפוש של העיר בלבד
  const away = [P({ id: 'm1', _away: true, deal_type: 'sale', property_type: 'דירה', rooms: 4, city: 'מגדל העמק' })];
  const all = PROPS.concat(away);
  assert.deepStrictEqual(C.filter(all, st, CTX).map(p => p.id), ['m1']);
  assert.ok(!C.filter(all, C.defaultState(), CTX).some(p => p._away), 'לא ב"כל עפולה והעמק"');
  // חיפוש רחוב אחרי - רק נכסי השוק, גם כשלנכס של מגדל העמק אותו רחוב
  const street = C.applyPatch(C.defaultState(), { area: 'text:הנרקיס' });
  const awayStreet = all.concat([P({ id: 'm2', _away: true, deal_type: 'sale', property_type: 'דירה', city: 'מגדל העמק', street: 'הנרקיס' })]);
  assert.deepStrictEqual(C.filter(awayStreet, street, CTX).map(p => p.id), ['i']);
  assert.ok(!C.deriveAreas(all).some(a => a.label === 'מגדל העמק'), 'לא אזור של השוק');
  assert.strictEqual(C.placeNote(r.place, 1, 'עפולה והעמק'), 'נכס אחד במגדל העמק - מחוץ לעפולה והעמק');
  assert.strictEqual(C.placeNote(r.place, 0, 'עפולה והעמק'), 'אין כרגע נכסים במגדל העמק');
  assert.strictEqual(C.placeNote(r.place, null), 'מחפשים נכסים במגדל העמק…');
  // כתיב בלי יוד, ועיר בשוק הנוכחי שאין בה נכס
  assert.strictEqual(C.parse('דירה בקרית אתא', C.defaultState(), AREAS, places).place.name, 'קריית אתא');
  const here = C.parse('בית בבלפוריה', C.defaultState(), AREAS, places).place;
  assert.strictEqual(C.placeNote(here, 0), 'אין כרגע נכסים בבלפוריה');
  // שכונה ויישוב שיש בהם נכסים עדיין קודמים, והיישוב העיקרי הוא "הכול"
  assert.strictEqual(C.parse('דירה בהיוגב', C.defaultState(), AREAS, places).patch.area, 'city:היוגב');
  assert.strictEqual(C.parse('דירה בעפולה', C.defaultState(), AREAS, places).patch.area, 'all');
  // לפני שהמלאי נטען אין mainCity - ועפולה עדיין אינה "עיר בלי נכסים"
  assert.ok(!('area' in C.parse('דירה בעפולה', C.defaultState(), C.deriveAreas([]), places).patch));
});

test('דיוק (14.10.2026): תקציב בלי עיגול, חלל, דופלקס, מעלית, יוגב ומאפיינים', () => {
  // התקציב שנאמר - לא המדרגה שמעליו
  assert.strictEqual(afterParse('דירה עד 1.5 מיליון').st.priceMax, 1500000);
  assert.strictEqual(afterParse('דירה עד 3000 לחודש').st.priceMax, 3000);
  // "חלל" הוא מסחרי, לא כל הנכסים להשכרה
  assert.strictEqual(afterParse('חלל להשכרה').st.type, 'commercial');
  // סוגים שלא זוהו והחזירו את כל המלאי
  assert.strictEqual(afterParse('דופלקס למכירה').st.type, 'raw:דופלקס');
  assert.strictEqual(afterParse('סטודיו להשכרה').st.type, 'raw:סטודיו/לופט');
  // "מעלית" אינה עפולה עלית, והיא מאפיין
  const elev = C.parse('דירה עם מעלית', C.defaultState(), AREAS);
  assert.ok(!('area' in elev.patch), 'מעלית נקראה כאזור');
  assert.deepStrictEqual(elev.features, ['elevator']);
  assert.strictEqual(C.parse('בית בעפולה עלית', C.defaultState(), AREAS).patch.area, 'hood:3');
  // ה' הידיעה בשם יישוב: "ביוגב" = היוגב
  assert.strictEqual(C.parse('מגרש ביוגב', C.defaultState(), AREAS).patch.area, 'city:היוגב');
  // מאפיינים
  assert.deepStrictEqual(C.parse('דירה מרוהטת עם חניה וממ"ד', C.defaultState(), AREAS).features.sort(), ['furnished', 'mamad', 'parking']);
  assert.deepStrictEqual(C.parse('דירה עם מרפסת שמש', C.defaultState(), AREAS).features, ['sun_balcony']);
  assert.deepStrictEqual(C.parse('דירה עם מחסן', C.defaultState(), AREAS).features, ['storage']);
  assert.deepStrictEqual(C.parse('מחסן להשכרה', C.defaultState(), AREAS).features, [], 'מחסן לבד הוא סוג נכס');
  assert.strictEqual(C.parse('מחסן להשכרה', C.defaultState(), AREAS).patch.type, 'warehouse');
  assert.strictEqual(C.featuresNote(['elevator', 'parking']), 'מעלית, חניה');
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

test('rooms=3-4 הוא המדרגה "3-4 חדרים", ו-rooms=4 כולל 4.5', () => {
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=3-4')).rooms, [3, 4.5]);
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=4')).rooms, [4, 4.5]);
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=3.5')).rooms, [3.5, 3.5]);
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=5%2B')).rooms, [5, 99]);
  // הצורה הישנה של "4 חדרים" שהוקלד עדיין נקראת, ונכתבת בחזרה כ-rooms=4
  assert.deepStrictEqual(C.fromParams(new URLSearchParams('rooms=4,4.5')).rooms, [4, 4.5]);
  assert.strictEqual(C.toParams(C.fromParams(new URLSearchParams('rooms=4,4.5')), AREAS, CTX), 'rooms=4');
  C.ROOM_BUCKETS.forEach(b => {
    const st = C.applyPatch(C.defaultState(), { rooms: b });
    assert.deepStrictEqual(C.fromParams(new URLSearchParams(C.toParams(st, AREAS, CTX))).rooms, b);
  });
});

test('דף נחיתה: city מסנן, חדרים כוללים חצי, ומסחרי יוצא', () => {
  const extra = [
    P({ id: 'off', deal_type: 'sale', category: 'commercial', property_type: 'משרדים', rooms: 3, city: 'עפולה', street: 'המלאכה' }),
    P({ id: 'off2', deal_type: 'sale', category: 'residential', property_type: 'משרדים', rooms: 3, city: 'עפולה' }),
    P({ id: 'shop', deal_type: 'sale', category: 'commercial', property_type: 'חנויות/שטח מסחרי', rooms: 3, city: 'עפולה' }),
    P({ id: 'g3', deal_type: 'sale', property_type: 'דירת גן', rooms: 3, city: 'עפולה' }),
    P({ id: 'a3', deal_type: 'sale', property_type: 'דירה', rooms: 3, city: 'עפולה' }),
    P({ id: 'a35', deal_type: 'sale', property_type: 'דירה', rooms: 3.5, city: 'עפולה' }),
    P({ id: 'a4', deal_type: 'sale', property_type: 'דירה', rooms: 4, city: 'עפולה' }),
    P({ id: 'mig', deal_type: 'sale', property_type: 'דירה', rooms: 3, city: 'מגדל העמק' }),
    P({ id: 'nof', deal_type: 'sale', property_type: 'דירה', rooms: 3.5, city: 'נוף הגליל' }),
    P({ id: 'house', deal_type: 'sale', property_type: "בית פרטי/קוטג'", rooms: 3, city: 'עפולה' }),
    P({ id: 'ph', deal_type: 'sale', property_type: 'גג/פנטהאוז', rooms: 3.5, city: 'עפולה' }),
  ];
  const qs = 'deal=sale&rooms=3&city=' + encodeURIComponent('עפולה') + '&utm_source=google&utm_medium=cpc&utm_campaign=3rooms&gclid=abc';
  const st = C.fromParams(new URLSearchParams(qs));
  const plain = C.fromParams(new URLSearchParams('deal=sale&rooms=3&city=' + encodeURIComponent('עפולה')));
  assert.strictEqual(st.city, 'עפולה');
  assert.deepStrictEqual(st.rooms, [3, 3.5]);
  assert.strictEqual(st.deal, 'sale');
  assert.strictEqual(st.type, 'any');
  ['deal', 'type', 'area', 'rooms', 'city', 'priceMax', 'priceMin', 'ai'].forEach(k => {
    assert.deepStrictEqual(st[k], plain[k], k);
  });
  // b במלאי הבסיסי: דירה למכירה, 3.5, עפולה
  const ids = C.filter(PROPS.concat(extra), st, CTX).map(p => p.id).sort();
  assert.deepStrictEqual(ids, ['a3', 'a35', 'b', 'g3', 'house', 'ph']);
  const back = C.toParams(st, AREAS, CTX);
  assert.strictEqual(back, 'deal=sale&rooms=3&city=' + encodeURIComponent('עפולה'));
  const again = C.fromParams(new URLSearchParams(back));
  assert.strictEqual(again.city, 'עפולה');
  assert.deepStrictEqual(again.rooms, [3, 3.5]);
  const slots = C.slotsFor(st, AREAS, CTX).map(s => s.value);
  assert.ok(slots.includes('עפולה'), slots.join(' | '));
  assert.ok(slots.includes('3 חדרים'), slots.join(' | '));
  // q= של היישוב העיקרי נשאר "כל השוק", ולא מסנן לעיר
  const qst = C.resolveArea(C.fromParams(new URLSearchParams('q=' + encodeURIComponent('עפולה'))), AREAS);
  assert.strictEqual(qst.area, 'all');
  assert.strictEqual(qst.city, null);
  assert.strictEqual(C.fromParams(new URLSearchParams('city=<script>')).city, null);
  assert.strictEqual(C.fromParams(new URLSearchParams('city=' + encodeURIComponent('עפולה1'))).city, null);
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
  // בעפולה עלית יש רק בתים למכירה - אין "לשכור" להציע
  assert.deepStrictEqual(C.rollLabels('deal', C.applyPatch(C.defaultState(), { area: 'hood:3' }), PROPS, CTX, AREAS), ['לקנות']);
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

test('וויזארד: השלבים נספרים לפי המשפט, וחנות מורידה את שלב החדרים', () => {
  const st = C.defaultState();
  assert.deepStrictEqual(C.stepOf('type', st), { index: 2, total: 5 });
  const shop = C.applyPatch(st, { type: 'shop' });
  assert.deepStrictEqual(C.slotOrder(shop), ['deal', 'type', 'area', 'price']);
  assert.deepStrictEqual(C.stepOf('price', shop), { index: 4, total: 4 });
});

test('וויזארד: בחירה עוברת לשלב הבא שעוד לא נבחר, ובסוף - null', () => {
  const st = C.defaultState();
  assert.strictEqual(C.nextOpenSlot('deal', st, { deal: true }), 'type');
  // מי שחוזר/ת לתקן מילה אחת לא נגרר/ת שוב דרך מה שכבר נבחר
  const all = { deal: true, type: true, area: true, rooms: true, price: true };
  assert.strictEqual(C.nextOpenSlot('deal', st, all), null);
  assert.strictEqual(C.nextOpenSlot('deal', st, { deal: true, type: true }), 'area');
  // אחרי חנות אין חדרים - מהאזור ישר לתקציב
  const shop = C.applyPatch(st, { type: 'shop' });
  assert.strictEqual(C.nextOpenSlot('area', shop, { deal: true, type: true, area: true }), 'price');
  assert.strictEqual(C.nextOpenSlot('price', st, {}), null);
  assert.strictEqual(C.nextOpenSlot('nope', st, {}), null);
});

test('כותרות השלבים בלי מקף ארוך', () => {
  Object.values(C.SLOT_TITLES).forEach(t => assert.ok(!/[–—]/.test(t), t));
});

test('תוויות המשפט בלי מקף ארוך', () => {
  const st = C.applyPatch(C.defaultState(), { rooms: [3, 4.5] });
  C.slotsFor(st, AREAS, CTX).forEach(s => assert.ok(!/[–—]/.test(s.value), s.value));
});

/* הדוגמאות שמוקלדות בשדה החופשי בדף הבית. examplePhrases כבר מסננת את מה
   שלא עובר - ולכן הבדיקה כאן היא שהסינון לא אכל את הרשימה: שוק עם מלאי
   מקבל את כל שבע הדוגמאות, וכל אחת מזהה לפחות שני שדות כשמריצים אותה
   כמו שגולש/ת היה/תה מקליד/ה אותה. */
test('הדוגמאות המוקלדות: כולן עוברות ב-parse עם לפחות שני שדות', () => {
  [false, true].forEach(short => {
    const list = C.examplePhrases(AREAS, short);
    assert.strictEqual(list.length, 7, (short ? 'נייד: ' : 'מחשב: ') + JSON.stringify(list));
    list.forEach(p => {
      const r = C.parse(p, C.defaultState(), AREAS);
      assert.ok(r.fields.length >= 2, p + ' → ' + r.fields.join(','));
      assert.ok(!/[–—]/.test(p), p);
      if (short) assert.ok(p.length <= C.SHORT_MAX, p + ' ארוך מדי לנייד');
    });
  });
});

test('הדוגמאות המוקלדות נבנות מהשוק ולא מקובעות לעפולה', () => {
  const props = [
    P({ id: 'x1', city: 'חיפה', deal_type: 'sale', property_type: 'דירה', rooms: 4, price: 1900000, neighborhood_id: 9, neighborhood_name: 'כרמל צרפתי' }),
    P({ id: 'x2', city: 'חיפה', deal_type: 'sale', property_type: 'דירה', rooms: 3, price: 1500000, neighborhood_id: 8, neighborhood_name: 'נווה שאנן' }),
    P({ id: 'x3', city: 'טירת כרמל', deal_type: 'rent', property_type: 'דירה', rooms: 3, price: 4200 }),
  ];
  const areas = C.deriveAreas(props);
  const list = C.examplePhrases(areas, false);
  assert.ok(list.some(p => p.includes('כרמל צרפתי')), JSON.stringify(list));
  assert.ok(list.some(p => p.includes('בחיפה')), JSON.stringify(list));
  assert.ok(!list.some(p => p.includes('עפולה')), JSON.stringify(list));
  list.forEach(p => assert.ok(C.parse(p, C.defaultState(), areas).fields.length >= 2, p));
});

test('הדוגמאות המוקלדות לפני שהמלאי נטען: רק כאלה שאינן תלויות באזור', () => {
  const list = C.examplePhrases([], true);
  assert.ok(list.length >= 3, JSON.stringify(list));
  list.forEach(p => assert.ok(C.parse(p, C.defaultState(), []).fields.length >= 2, p));
});

test('חיפוש עם ממ״ד שאין לו התאמה: לא מציגים בלעדיו, ואומרים על מה מוותרים', () => {
  const st = C.applyPatch(C.defaultState(), { deal: 'sale', rooms: [3, 3.5] });
  const ctx = Object.assign({}, CTX, { extra: p => (p.features || []).includes('mamad'), extraLabel: 'ממ״ד' });
  assert.strictEqual(C.filter(PROPS, st, ctx).length, 0);
  const hint = C.widenHint(st, PROPS, ctx);
  assert.strictEqual(hint.slot, 'extra');
  assert.strictEqual(hint.text, 'בלי ממ״ד');
  assert.strictEqual(hint.action, 'גם בלי ממ״ד');
  assert.strictEqual(hint.count, C.filter(PROPS, st, CTX).length);
  // בלי תווית (סינון מתקדם מעורב) - הנוסח הכללי
  assert.strictEqual(C.widenHint(st, PROPS, Object.assign({}, ctx, { extraLabel: null })).action, 'נקה סינון מתקדם');
});

test('"בלי מעלית" אינו בקשה למעלית - והממ״ד שאחריו כן (‏search-core.js)', () => {
  assert.deepStrictEqual(C.parse('3 חדרים בלי מעלית ועם ממד', C.defaultState(), AREAS).features, ['mamad']);
  assert.deepStrictEqual(C.parse('דירה ללא חנייה', C.defaultState(), AREAS).features, []);
});

test('רחוב בתוך משפט אינו נזרק, ובכל סדר (‏search-core.js, 21.10.2026)', () => {
  // נכס i - רחוב הנרקיס. עד כאן "דירה ברחוב הנרקיס" חיפש בכל האזור
  const r = C.parse('דירת גן ברחוב הנרקיס', C.defaultState(), AREAS);
  assert.ok(!('area' in r.patch), 'parse עצמו אינו מכיר רחובות - runParse משלים מול המלאי');
  const st = C.applyPatch(C.defaultState(), { area: 'text:נרקיס' });
  assert.deepStrictEqual(C.filter(PROPS, st, { areaIndex: AREAS.index }).map(p => p.id), ['i']);
});

test('compileQuery - אותו פענוח לשדה החכם ולחיפוש בנכסים ב-CRM', () => {
  const ctx = { areaIndex: AREAS.index };
  // רחוב בתוך משפט: הסוג זוהה, והרחוב נבדק מול המלאי
  let cq = C.compileQuery('דירת גן ברחוב הנרקיס', C.defaultState(), AREAS, PROPS, ctx, []);
  assert.strictEqual(cq.patch.area, 'text:הנרקיס');
  assert.ok(cq.fields.includes('area') && cq.fields.includes('type'));
  // שכונה מכינוי, ומאפיין
  cq = C.compileQuery('3 חדרים בגבעה עם ממד', C.defaultState(), AREAS, PROPS, ctx, []);
  assert.strictEqual(cq.patch.area, 'hood:1');
  assert.deepStrictEqual(cq.features, ['mamad']);
  // שם שאינו מקום ואינו במלאי - לא מומצא אזור
  cq = C.compileQuery('כהן', C.defaultState(), AREAS, PROPS, ctx, []);
  assert.ok(!cq.fields.length && !cq.features.length);
});

/* ‏R8: מספרים שנאמרו בקול - לספרות לפני הפענוח (‏spokenNumbers) */
test('חיפוש קולי: מספרים במילים', () => {
  const cases = [
    ['דירה עד מיליון ושבע מאות אלף', 1700000], ['דירה עד מיליון ושבע מאות', 1700000], ['עד שני מיליון', 2000000],
    ['דירה עד מיליון וחצי', 1500000], ['דירה עד מיליון', 1000000], ['שניים וחצי מיליון', 2500000],
    ['דירה להשכרה עד חמשת אלפים', 5000], ['להשכרה עד שלושת וחצי', 3500], ['דירה עד שבע מאות אלף', 700000],
    ['עד שבע מאות וחמישים אלף', 750000], ['להשכרה עד ארבעת אלפים וחמש מאות', 4500], ['להשכרה עד אלף וחמש מאות', 1500],
  ];
  cases.forEach(([text, want]) => {
    const r = C.parse(C.spokenNumbers(text), C.defaultState(), AREAS);
    assert.strictEqual(r.patch.priceMax, want, text + ' → ' + C.spokenNumbers(text));
  });
  // מילים שאינן מחיר לא משתנות
  assert.strictEqual(C.spokenNumbers('דירת ארבעה חדרים בעפולה'), 'דירת ארבעה חדרים בעפולה');
  assert.strictEqual(C.spokenNumbers('עד 5 אלף'), 'עד 5 אלף');
  assert.strictEqual(C.spokenNumbers('עד 1.5 מיליון'), 'עד 1.5 מיליון');
});

/* ‏A3-1 / C3 / C4 / R5 (PR 1010): משקים ונחלות, "למכירה" כמגורים, והכתובת הקנונית */
test('משק ונחלה - סוג משלו, לא בית', () => {
  const props = PROPS.concat([P({ id: 'farm1', deal_type: 'sale', property_type: 'משק חקלאי/נחלה', rooms: 5, price: 3000000 })]);
  assert.strictEqual(C.parse('נחלה בעמק', C.defaultState(), AREAS).patch.type, 'farm');
  assert.strictEqual(C.parse('משק עזר', C.defaultState(), AREAS).patch.type, 'farm');
  const st = Object.assign(C.defaultState(), { deal: 'sale' });
  assert.deepStrictEqual(C.filter(props, Object.assign({}, st, { type: 'farm' }), CTX).map(p => p.id), ['farm1']);
  assert.ok(!C.filter(props, Object.assign({}, st, { type: 'house' }), Object.assign({ farmSplit: true }, CTX)).some(p => p.id === 'farm1'));
  // בלי הדגל (‏farmSplit) - כמו היום: הנחלה היא גם "בית"
  assert.ok(C.filter(props, Object.assign({}, st, { type: 'house' }), CTX).some(p => p.id === 'farm1'));
});
test('C4: למכירה בלי סוג - מגורים בלבד, רק עם saleResidential', () => {
  const props = PROPS.concat([P({ id: 'shop1', deal_type: 'sale', category: 'commercial', property_type: 'חנויות/שטח מסחרי', price: 900000 })]);
  const st = Object.assign(C.defaultState(), { deal: 'sale' });
  assert.ok(C.filter(props, st, CTX).some(p => p.id === 'shop1'));
  assert.ok(!C.filter(props, st, Object.assign({ saleResidential: true }, CTX)).some(p => p.id === 'shop1'));
  assert.ok(C.filter(props, Object.assign({}, st, { type: 'commercial' }), Object.assign({ saleResidential: true }, CTX)).some(p => p.id === 'shop1'));
});
test('R5: type= במקום ptype=, ו-ptype= עדיין נקרא', () => {
  const st = Object.assign(C.defaultState(), { deal: 'sale', type: 'garden' });
  assert.ok(/(^|&)type=garden(&|$)/.test(C.toParams(st, AREAS, { typeParam: true })));
  assert.ok(!/ptype=/.test(C.toParams(st, AREAS, { typeParam: true })));
  const multi = Object.assign(C.defaultState(), { deal: 'sale', types: ['flats', 'farm'] });
  const back = C.fromParams(new URLSearchParams(C.toParams(multi, AREAS, { typeParam: true })));
  assert.deepStrictEqual(back.types, ['flats', 'farm']);
  assert.strictEqual(C.fromParams(new URLSearchParams('ptype=' + encodeURIComponent('דירת גן'))).type, 'garden');
  assert.strictEqual(C.fromParams(new URLSearchParams('type=' + encodeURIComponent('raw:דופלקס'))).type, 'raw:דופלקס');
  assert.strictEqual(C.fromParams(new URLSearchParams('type=nonsense')).type, 'any');
});

console.log(passed + ' בדיקות עברו' + (process.exitCode ? ' - ויש כישלונות' : ''));

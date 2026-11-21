/**
 * שחרור תגית ממדף הנכסים (ppShelfToMap ב-assets/home.js).
 *
 * עם החיפוש במשפט (sentence.loaded()) מציירים שוב את sentence.results()
 * בלי שאילתה; בלי המשפט נשארת ההתנהגות הישנה (runSearch או כל המלאי).
 * הפונקציה נקראת מהקובץ ורצה על גלובלים מדומים - בלי דפדפן ובלי רשת.
 *
 *     node scripts/home_shelf_release_test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const src = readFileSync(join(root, 'home.js'), 'utf8');
const block = src.match(/async function ppShelfToMap\(items, filtered\)\{[\s\S]*?\n\}/);
if (!block) throw new Error('ppShelfToMap לא נמצא ב-home.js');

/* מצב ושתי הפונקציות החיצוניות מוגדרים מחדש בכל בדיקה. ההגדרות הן ליד
   הפונקציה כדי שמשתנים כמו ppShelfFiltered יהיו חופשיים בה, כמו בקובץ. */
function setup({ sentence = null, searchHasRun = false, resultsMode = false, filtered = true } = {}) {
  const calls = [];
  const allActiveProperties = ['all-1', 'all-2', 'all-3'];
  const make = new Function('ctx', `
    let ppShelfFiltered = ctx.filtered, sentence = ctx.sentence,
        searchHasRun = ctx.searchHasRun, resultsMode = ctx.resultsMode,
        allActiveProperties = ctx.allActiveProperties;
    const renderPropertyGrid = (...a) => ctx.calls.push(['render', ...a]);
    const renderSentenceMapTag = (...a) => ctx.calls.push(['mapTag', ...a]);
    const runSearch = async () => ctx.calls.push(['runSearch']);
    ${block[0]}
    return { ppShelfToMap, isFiltered: () => ppShelfFiltered };
  `);
  const api = make({ calls, sentence, searchHasRun, resultsMode, filtered, allActiveProperties });
  return { calls, allActiveProperties, ...api };
}

const loadedSentence = (results, st = { deal: 'rent' }) => ({
  loaded: () => true, results: () => results, state: () => st,
});

test('בחירת תגית מציירת את הפריטים כתוצאות חיפוש ומסמנת סינון', async () => {
  const t = setup({ filtered: false });
  await t.ppShelfToMap(['a', 'b'], true);
  assert.deepEqual(t.calls, [['render', ['a', 'b'], true]]);
  assert.equal(t.isFiltered(), true);
});

test('שחרור כשלא הייתה תגית פעילה אינו עושה כלום', async () => {
  const t = setup({ filtered: false, sentence: loadedSentence(['x']) });
  await t.ppShelfToMap([], false);
  assert.deepEqual(t.calls, []);
});

test('עם המשפט: מציירים את תוצאות המשפט ולא מריצים חיפוש (אחרי חיפוש)', async () => {
  const results = ['r1', 'r2'];
  const st = { deal: 'rent' };
  const t = setup({ sentence: loadedSentence(results, st), searchHasRun: true, resultsMode: true });
  await t.ppShelfToMap([], false);
  assert.deepEqual(t.calls, [['render', results, true], ['mapTag', results, st]]);
  assert.equal(t.isFiltered(), false);
});

test('עם המשפט ובלי שרץ חיפוש: אותו ציור, עם resultsMode כמו שהוא', async () => {
  const results = ['r1'];
  const t = setup({ sentence: loadedSentence(results), searchHasRun: false, resultsMode: false });
  await t.ppShelfToMap([], false);
  assert.deepEqual(t.calls.map(c => c[0]), ['render', 'mapTag']);
  assert.equal(t.calls[0][2], false);
  assert.equal(t.calls.some(c => c[0] === 'runSearch'), false);
});

test('בלי המשפט אחרי חיפוש: runSearch כמו קודם', async () => {
  const t = setup({ sentence: null, searchHasRun: true });
  await t.ppShelfToMap([], false);
  assert.deepEqual(t.calls, [['runSearch']]);
});

test('משפט שעוד לא נטען נחשב כמו בלי משפט', async () => {
  const notLoaded = { loaded: () => false, results: () => { throw new Error('אסור'); }, state: () => ({}) };
  const t = setup({ sentence: notLoaded, searchHasRun: true });
  await t.ppShelfToMap([], false);
  assert.deepEqual(t.calls, [['runSearch']]);
});

test('בלי המשפט ובלי חיפוש: חוזרים לכל המלאי הפעיל', async () => {
  const t = setup({ sentence: null, searchHasRun: false });
  await t.ppShelfToMap([], false);
  assert.deepEqual(t.calls, [['render', t.allActiveProperties]]);
});

/* ============================================================================
   איזו חלקה נבחרת בנקודה, ולמה "לא נמצא" (GovmapLookup.addressRecordWhy)

   GovMap אינו זמין מ-CI (הטוקן נעול לדומיין האתר), ולכן התשובות מדומות.
   מה שנבדק:

   - pickParcel: יחידה, כפולה, שתיים, החלקה שביקשנו בין שתיים, strict
   - מרכז חלקה שנופל על שכנה: החלקה שביקשנו חוזרת **בלי** הייעוד והתוכניות
     של השכנה (offPoint), ו-plansAt אינה נשאלת
   - ארבע הסיבות, ו-addressRecord שומרת על החוזה הוותיק (null)
   - רשימת הסיבות זהה בשלושת המקומות: govmap.js, ‏planning-link, ‏plan.js

       node scripts/govmap_parcel_pick_test.cjs

   ‏docs/govmap.md ("דף הבדיקה"), הסקיל planning-page.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'assets', 'govmap.js'), 'utf8');

const P = (g, h, sfx) => ({ attributes: { gush_num: g, parcel: h, gush_suffix: sfx || 0, legal_area: 500, status_text: 'מוסדר' } });
const LOT = { attributes: { kvuz_trg: 'מגורים ב', tochnit: 'ג/1' } };

function load(o){
  const calls = [];
  const win = {
    proj4: (from, to, xy) => xy,
    govmap: {
      search: () => Promise.resolve({ results: o.results || [] }),
      getLayerFeaturesByLocation: (q) => {
        calls.push(q);
        const L = {};
        q.layers.forEach(l => { L[l.name] = []; });
        if ('PARCEL_ALL' in L) { L.PARCEL_ALL = (q.radius ? o.r10 : o.r0) || []; L.retzefMigrashim = [LOT]; }
        return Promise.resolve({ layers: L, errors: {} });
      },
    },
  };
  const doc = { head: { appendChild(){} }, createElement: () => ({}) };
  new Function('window', 'document', 'console', src)(win, doc, { warn(){} });
  return { G: win.GovmapLookup, calls };
}

const ADDR = { city: 'עפולה', street: 'הקונגרס הציוני', house_number: '22' };
const PAR = { gush: '16659', helka: '59' };
const hitAddr = { type: 'address', text: 'הקונגרס הציוני 22 עפולה', centroid: 'POINT (227000 724000)' };
const hitPar = { type: 'parcel', text: 'גוש 16659 חלקה 59', centroid: 'POINT (227000 724000)' };

(async () => {
  let fail = 0; const ok = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); if (!c) fail++; };
  const pick = load({}).G._pickParcel;
  const want = { gush: '16659', helka: ' 59 ' };

  ok('חלקה יחידה נבחרת', !!pick([P(1, 2)]).feature);
  ok('אותה חלקה פעמיים היא חלקה אחת', !!pick([P(1, 2), P(1, 2)]).feature);
  ok('שתי חלקות בלי want - לא מנחשים', pick([P(1, 2), P(1, 3)]).count === 2);
  ok('תת-גוש שונה הוא חלקה אחרת', pick([P(1, 2, 0), P(1, 2, 1)]).count === 2);
  ok('רשומה בלי גוש או חלקה אינה חלקה', pick([{ attributes: {} }, {}]).count === 0);
  ok('שתיים, ואחת היא שביקשנו (גם עם רווחים)', pick([P(16659, 58), P(16659, 59)], want).feature.attributes.parcel === 59);
  ok('בלי strict: חלקה יחידה אחרת עדיין מתקבלת (הכתובת היא האמת)', pick([P(16659, 58)], want).feature.attributes.parcel === 58);
  ok('strict: חלקה יחידה אחרת נדחית', pick([P(16659, 58)], want, true).count === 0);

  let r = await load({ results: [], r0: [] }).G.addressRecordWhy(ADDR);
  ok('כתובת שאינה בשכבה -> no_address', r.record === null && r.reason === 'no_address');
  r = await load({ results: [] }).G.addressRecordWhy(PAR);
  ok('גוש/חלקה שלא נמצאו -> no_parcel', r.record === null && r.reason === 'no_parcel');
  r = await load({ results: [hitAddr], r0: [], r10: [] }).G.addressRecordWhy(ADDR);
  ok('כתובת בלי חלקה בנקודה -> no_parcel_at_point', r.reason === 'no_parcel_at_point');
  r = await load({ results: [hitAddr], r0: [P(1, 1), P(1, 2)], r10: [P(1, 1), P(1, 2)] }).G.addressRecordWhy(ADDR);
  ok('כתובת בין שתי חלקות -> ambiguous_parcel', r.reason === 'ambiguous_parcel');
  ok('addressRecord: החוזה הוותיק, null',
    (await load({ results: [hitAddr], r0: [], r10: [] }).G.addressRecord(ADDR)) === null);

  let t = load({ results: [hitPar], r0: [P(16659, 58), P(16659, 59)] });
  r = await t.G.addressRecordWhy(PAR);
  ok('גוש/חלקה, שתיים בנקודה: החלקה שביקשנו, עם הייעוד',
    r.record && r.record.helka === '59' && r.record.land_use_designation === 'מגורים ב' && r.record.pin_source === 'parcel');

  t = load({ results: [hitPar], r0: [P(16659, 58)], r10: [P(16659, 58), P(16659, 59)] });
  r = await t.G.addressRecordWhy(PAR);
  ok('מרכז על שכנה: החלקה שביקשנו, לא השכנה', r.record && r.record.helka === '59');
  ok('מרכז על שכנה: בלי הייעוד והתוכנית של השכנה',
    r.record && r.record.land_use_designation === null && r.record.applicable_plans.length === 0 && !r.record.govmap_plans);
  ok('מרכז על שכנה: plansAt לא נשאלה על הנקודה', !t.calls.some(c => c.layers.some(l => l.name === '203')));

  r = await load({ results: [hitPar], r0: [P(16659, 58)], r10: [P(16659, 58)] }).G.addressRecordWhy(PAR);
  ok('החלקה אינה בטווח -> no_parcel_at_point, ולא השכנה', r.record === null && r.reason === 'no_parcel_at_point');

  // רשימה סגורה בשלושה מקומות: סיבה שנוספה רק באחד נשמרת null ומוצגת בנוסח הכללי
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const listed = (read('supabase/functions/planning-link/index.ts').match(/NOT_FOUND_REASONS = \[([^\]]*)\]/) || ['', ''])[1]
    .replace(/["\s]/g, '').split(',').sort().join(',');
  const produced = [...new Set(src.match(/'(?:no|ambiguous)_[a-z_]+'/g) || [])].map(x => x.replace(/'/g, '')).sort();
  ok('planning-link מקבלת בדיוק את הסיבות ש-govmap.js מייצרת (' + produced.join(', ') + ')',
    listed === produced.join(',') && produced.length === 4);
  ok('ל-plan.js יש נוסח לכל סיבה', produced.every(x => read('assets/plan.js').includes("'" + x + "'")));

  if (fail) { console.error(fail + ' failed'); process.exit(1); }
})();

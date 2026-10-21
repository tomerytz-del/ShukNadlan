/* ============================================================================
   הבדיקה של התוכניות משכבות 203/14 של GovMap (GovmapLookup.plansAt)

   GovMap אינו זמין מ-CI (הטוקן נעול לדומיין האתר), ולכן התשובות מדומות -
   והן **התשובות האמיתיות** של plans-probe.js הרצה 2 (22.10.2026) על
   החורש 8 בעפולה (16742/96), בקיצור. מה שנבדק:

   - הודעה לפי סעיף 77-78 מזוהה, ו-pl_date_8 שלה אינו "אושרה"
   - "שמכוחה לא ניתן" -> permits: false, "שמכוחה ניתן" -> true
   - ייעוד משכבה 14 מוצמד לתוכנית שלו; "עפ"י תכנית מאושרת אחרת" (995) לא
   - קישור רק למבא"ת
   - שם השכבה נשלח כמחרוזת (מספר עונה 400 ומפיל את הבקשה)
   - שגיאה בתוך תשובה תקינה זורקת, ולא מחזירה []

       node scripts/govmap_plans_test.cjs

   ‏docs/govmap.md, הסקיל govmap.
   ========================================================================== */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'assets', 'govmap.js'), 'utf8');

const L203 = [
  { attributes: { entity_subtype_desc: 'הודעה לפי סעיף 77 ו 78 לחוק התכנון והבניה',
    pl_number: 'תמא/ 15/ ג/ סעיף-77-78', pl_name: 'שדה תעופה משלים בנבטים', pl_date_8: '2025-12-04T00:00:00.000Z',
    plan_charactor_name: 'תכנית שמכוחה לא ניתן להוציא היתרים או הרשאות',
    pl_url: 'https://mavat.iplan.gov.il/SV4/1/99005336124/310' } },
  { attributes: { entity_subtype_desc: 'תכנית כוללנית', pl_number: '215-0898114', pl_name: 'תכנית מתאר כוללנית עפולה',
    depositing_date: '2022-04-04T00:00:00.000Z', pl_date_8: '2025-07-16T00:00:00.000Z',
    plan_charactor_name: 'תכנית שמכוחה לא ניתן להוציא היתרים או הרשאות',
    pl_url: 'https://mavat.iplan.gov.il/SV4/1/2005093152/310' } },
  { attributes: { entity_subtype_desc: 'תכנית מתאר ארצית', pl_number: 'תמא/ 15/ ד', pl_name: 'שדה תעופה משלים ברמת דוד',
    pl_date_8: null, plan_charactor_name: 'תכנית שמכוחה ניתן להוציא היתרים או הרשאות',
    pl_url: 'javascript:alert(1)' } },
];
const L14 = [
  { attributes: { mavat_name: 'מגורים', mavat_code: 10, pl_number: '215-0898114' } },
  { attributes: { mavat_name: 'יעוד עפ"י תכנית מאושרת אחרת', mavat_code: 995, pl_number: 'תמא/ 15/ ד' } },
  { attributes: { mavat_name: 'מגבלות בניה ופיתוח', mavat_code: 996, pl_number: 'תמא/ 15/ ג/ סעיף-77-78' } },
];

function load(opts){
  const calls = [];
  const win = {
    proj4: (from, to, xy) => xy,
    govmap: {
      getLayerFeaturesByLocation: (p) => {
        calls.push(p);
        if (opts.error) return Promise.resolve({ layers: { '203': [] }, errors: { '203': ['boom'] } });
        return Promise.resolve({ layers: { '203': L203, '14': L14 } });
      },
    },
  };
  const doc = { head: { appendChild(){} }, createElement: () => ({}) };
  new Function('window', 'document', 'console', src)(win, doc, { warn(){} });
  return { G: win.GovmapLookup, calls };
}

(async () => {
  let fail = 0; const ok = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); if (!c) fail++; };
  const { G, calls } = load({});
  const plans = await G.plansAt({ x: 227673.75, y: 724876.11 });

  ok('שלוש תוכניות', plans.length === 3);
  ok('שמות השכבות נשלחו כמחרוזות', calls[0].layers.every(l => typeof l.name === 'string'));
  ok('רדיוס 0 - מה שחל על הנקודה עצמה', calls[0].radius === 0);

  const n = plans.find(p => p.number.indexOf('77') >= 0);
  ok('הודעה 77-78 מזוהה', n && n.notice === true && n.stage === 'notice');
  ok('תאריך פרסום ההודעה אינו "אושרה"', n && n.stage !== 'approved');
  ok('ייעוד "מגבלות בניה ופיתוח" מוצמד להודעה', n && n.designation === 'מגבלות בניה ופיתוח');

  const m = plans.find(p => p.number === '215-0898114');
  ok('מתאר כוללנית: אושרה 2025-07-16', m && m.stage === 'approved' && m.date === '2025-07-16');
  ok('"שמכוחה לא ניתן" -> permits: false', m && m.permits === false);
  ok('ייעוד "מגורים" מוצמד לתוכנית', m && m.designation === 'מגורים');
  ok('קישור למבא"ת נשמר', m && m.url === 'https://mavat.iplan.gov.il/SV4/1/2005093152/310');

  const t = plans.find(p => p.number === 'תמא/ 15/ ד');
  ok('"שמכוחה ניתן" -> permits: true', t && t.permits === true);
  ok('995 ("עפ"י תכנית מאושרת אחרת") אינו ייעוד', t && t.designation === null);
  ok('קישור שאינו למבא"ת נזרק', t && t.url === null);

  const e = load({ error: true });
  let threw = false;
  try { await e.G.plansAt({ x: 1, y: 2 }); } catch (err) { threw = /boom/.test(err.message); }
  ok('שגיאה בתוך תשובה תקינה - זורקת, לא []', threw);

  ok('כפילות לפי מספר בלי רווחים', G._cleanPlanLayers({ '203': [L203[1], { attributes: { pl_number: '215 -0898114'.replace(' ', '') } }] }).length === 1);

  if (fail) { console.error(fail + ' failed'); process.exit(1); }
})();

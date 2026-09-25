/* ============================================================================
   הבדיקה של ייבוא השכונות מ-GovMap (GovmapLookup.neighborhoodsInArea)

   GovMap עצמו אינו זמין מ-CI (הטוקן נעול לדומיין האתר), ולכן GovMap ו-proj4
   מדומים כאן. מה שנבדק הוא הלוגיקה שלנו - בדיוק החלקים שנכשלים בשקט:

   - כפילויות מעיגולי סריקה חופפים (אותה שכונה נספרת פעם אחת)
   - יישוב מחוץ לשוק אינו נכנס; "קרית"/"קריית" מתאימים, והשם שנשמר הוא שלנו
   - מצולע שחזר מחיפוש אבל שייך לשכונה אחרת - נדחה (עדיף בלי גבול)
   - שגיאה בתוך תשובה תקינה של GovMap זורקת, ולא מחזירה רשימה חלקית
   - הריצה הראשונה באתר החי (25.9.2026) חזרה בלי אף גבול, ולכן: מצולע שחוזר
     כבר מהסריקה נלקח משם; חיפוש עם layers שנכשל נופל לחיפוש בלעדיו; טקסט
     בלי שם היישוב מאומת בשכבה על המרכז; מצולע מחוץ לתיבה נדחה; ו-diag
     נושא את התשובות הגולמיות לאבחון

       node scripts/govmap_hoods_test.cjs

   ‏docs/regional-pages.md, הסקיל govmap.
   ========================================================================== */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'assets', 'govmap.js'), 'utf8');
function run(opts){
  const calls = { layer: 0, verify: 0, search: [] };
  const win = {
    proj4: (from, to, xy) => xy,                       // זהות: מספיק לבדיקת הלוגיקה
    govmap: {
      getLayerFeaturesByLocation: (p) => {
        if (p.radius < 100) { calls.verify++;                // אימות על מרכז החיפוש
          return Promise.resolve({ layers: { neighborhoods_area: [
            { attributes: { fname: opts.verifyName || 'נווה שאנן', setl_name: 'חיפה' } }] } }); }
        calls.layer++;
        if (opts.layerFeatures) return Promise.resolve({ layers: { neighborhoods_area: opts.layerFeatures } });
        if (opts.layerError) return Promise.resolve({ layers: { neighborhoods_area: [] }, errors: { neighborhoods_area: ['boom'] } });
        return Promise.resolve({ layers: { neighborhoods_area: [
          { attributes: { fname: 'נווה שאנן', setl_name: 'חיפה', nbr_code: 11 } },
          { attributes: { fname: 'בת גלים', setl_name: 'חיפה', nbr_code: 12 } },
          { attributes: { fname: 'גבעת עמל', setl_name: 'קרית ביאליק', nbr_code: 21 } },
          { attributes: { fname: 'מרכז', setl_name: 'עכו', nbr_code: 31 } },
        ] } }); },
      search: (p) => { calls.search.push(p.searchText + (p.layers ? ' [L]' : ''));
        if (opts.layersReject && p.layers) return Promise.reject(new Error('bad layers'));
        if (opts.bareText) return Promise.resolve({ resultsCount: 1, results: [{ type: 'neighborhood', text: 'נווה שאנן', centroid: 'POINT (35.0 32.8)' }] });
        const wrong = p.searchText.startsWith('בת גלים');   // מחזיר שכונה אחרת - חייב להידחות
        return Promise.resolve({ resultsCount: 1, results: [{ type: 'neighborhood',
          text: wrong ? 'הדר, חיפה' : p.searchText.replace(' ', ', '), centroid: 'POINT (35.0 32.8)' }] }); },
      getSearchResultData: () => Promise.resolve(opts.farPolygon
        ? { geom: 'MULTIPOLYGON (((32.8 35.0, 32.81 35.0, 32.81 35.01, 32.8 35.01, 32.8 35.0)))' }   // צירים הפוכים
        : { geom: 'MULTIPOLYGON (((35.0 32.8, 35.01 32.8, 35.01 32.81, 35.0 32.81, 35.0 32.8)))' }),
    },
  };
  const sandbox = { window: win, document: { head: { appendChild(){} }, createElement: () => ({}) }, console: { warn(){} } };
  new Function('window', 'document', 'console', src)(win, sandbox.document, sandbox.console);
  return win.GovmapLookup.neighborhoodsInArea([32.72, 34.94, 32.89, 35.13], ['חיפה', 'קריית ביאליק'], () => {}).then(r => ({ r, calls }), e => ({ err: e.message, calls }));
}
(async () => {
  let fail = 0; const ok = (n, c) => { console.log((c ? '✓ ' : '✗ ') + n); if (!c) fail++; };
  const { r, calls } = await run({});
  ok('רשת נקודות על התיבה (20-40 קריאות)', calls.layer >= 20 && calls.layer <= 40);
  ok('שלוש שכונות, בלי כפילויות מהעיגולים החופפים', r.length === 3);
  ok('עכו (לא בשוק) לא נכנסה', !r.some(h => h.name === 'מרכז'));
  ok('"קרית ביאליק" של GovMap מתאים ל"קריית ביאליק" שלנו, בשם שלנו', r.some(h => h.name === 'גבעת עמל' && h.settlement === 'קריית ביאליק'));
  const ns = r.find(h => h.name === 'נווה שאנן');
  ok('נווה שאנן: גבול [lat,lng] ומרכז', ns.boundary && ns.boundary.length >= 3 && ns.boundary[0][0] === 32.8 && ns.boundary[0][1] === 35 && ns.lat === 32.8);
  const bg = r.find(h => h.name === 'בת גלים');
  ok('בת גלים: המצולע שחזר הוא של "הדר" - נדחה, בלי גבול', bg && !bg.boundary);
  const e = await run({ layerError: true });
  ok('שגיאה בתוך תשובה תקינה - זורקת, לא רשימה ריקה', !!e.err && /boom/.test(e.err));
  ok('diag נושא את התשובות הגולמיות', r.diag && r.diag.layerFeature && r.diag.searchHood && r.diag.resultData);

  const sq = { attributes: { fname: 'נווה שאנן', setl_name: 'חיפה' }, geometry: 'POLYGON ((35.0 32.8, 35.02 32.8, 35.02 32.82, 35.0 32.8))' };
  const g = await run({ layerFeatures: [sq] });
  ok('מצולע שחזר כבר בסריקה - נלקח, בלי חיפוש', g.r.length === 1 && g.r[0].boundary && g.r[0].boundary.length === 4 && g.calls.search.length === 0 && g.r[0].lat != null);
  const esri = await run({ layerFeatures: [{ attributes: { fname: 'נווה שאנן', setl_name: 'חיפה' }, geometry: { rings: [[[35.0, 32.8], [35.02, 32.8], [35.02, 32.82]]] } }] });
  ok('גם Esri JSON (rings)', esri.r[0].boundary && esri.r[0].boundary.length === 3);

  const lr = await run({ layersReject: true });
  const lrNs = lr.r.find(h => h.name === 'נווה שאנן');
  ok('חיפוש עם layers נכשל - נופל לחיפוש בלעדיו', lrNs.boundary && lr.calls.search.some(t => !t.endsWith('[L]')) && /^ERR/.test(lr.r.diag.searchHood));

  const bt = await run({ bareText: true, layerFeatures: [{ attributes: { fname: 'נווה שאנן', setl_name: 'חיפה' } }] });
  ok('טקסט בלי יישוב - מאומת בשכבה על המרכז, ומתקבל', bt.r[0].boundary && bt.calls.verify === 1);
  const bx = await run({ bareText: true, verifyName: 'הדר', layerFeatures: [{ attributes: { fname: 'נווה שאנן', setl_name: 'חיפה' } }] });
  ok('טקסט בלי יישוב, והשכבה על המרכז היא שכונה אחרת - נדחה', !bx.r[0].boundary && bx.r[0].lat == null);

  const far = await run({ farPolygon: true, layerFeatures: [{ attributes: { fname: 'נווה שאנן', setl_name: 'חיפה' } }] });
  ok('מצולע מחוץ לתיבת השוק (צירים הפוכים) - נדחה', !far.r[0].boundary && far.r[0].lat === 32.8);

  console.log(fail ? `\n✗ ${fail} נכשלו` : '\n✓ סריקת השכונות מתנהגת כמתוכנן');
  process.exit(fail ? 1 : 0);
})();

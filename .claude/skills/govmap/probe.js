/* ============================================================================
   ‏GovMap — בדיקת היתכנות להחלפת ה-WFS של עפולה (גרסה 2)

   מריצים בקונסול של https://shuknadlan.co.il (לא localhost - הטוקן נעול
   לדומיין). בסוף: copy(JSON.stringify(__govmapProbe, null, 1)) ומדביקים.

   ## למה גרסה 2
   ההרצה הראשונה (24.9.2026) החזירה מערכים ריקים לכל השכבות ואפס תוצאות
   לשתי כתובות הייחוס - בלי שגיאה אחת. הסקריפט שמר רק את הצורה **שציפה
   לה** (`f.data`, `s.results`), ולכן "ריק" לא הבדיל בין "אין הרשאה",
   "פורמט אחר" ו"אין נתונים". כאן **כל תשובה נשמרת גולמית** (חתוכה), וזה
   הכלל לכל בדיקה מול מקור שהתיעוד שלו לא אומת.

   ## מה נבדק
     1. search לכתובות הייחוס, מדויק ולא מדויק - האם השם אצל GovMap שונה.
     2. getLayerFilterFields - התשובה הגולמית.
     3. getLayerFeaturesByLocation בנקודה ידועה (חטיבה תשע 18, שנמצאה
        בהרצה הקודמת) - עם שדות ריקים, כדי לראות מה השכבה מחזירה מעצמה.
   ============================================================================ */
(async () => {
  const T = 'a888579d-2bc4-4768-97d5-bd1642e2633b';
  const LAYERS = ['PARCEL_ALL', 'SUB_GUSH_ALL', 'retzefMigrashim', 'neighborhoods_area', '218358', '212537', '16'];
  const KNOWN_POINT = 'POINT(227406.71 724372.49)';   // חטיבה תשע 18 עפולה, מ-search
  const QUERIES = ['החורש 8 עפולה', 'חורש 8 עפולה', 'הפרסה 5 עפולה', 'פרסה 5 עפולה',
                   'גוש 16742 חלקה 96', '16742/96'];

  const out = { v: 2, at: new Date().toISOString(), origin: location.origin, search: {}, fields: {}, byLocation: {}, errors: [] };
  window.__govmapProbe = out;
  const cut = (x) => { try { return JSON.stringify(x).slice(0, 1500); } catch (e) { return String(x).slice(0, 1500); } };
  const err = (where, e) => out.errors.push({ where, e: String((e && e.message) || e).slice(0, 300) });

  if (!window.govmap) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://www.govmap.gov.il/govmap/api/govmap.api.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }).catch(e => err('load', e));
  }
  if (!window.govmap) { console.error('govmap לא נטען', out); return; }

  for (const q of QUERIES) {
    for (const isAccurate of [true, false]) {
      try {
        const r = await govmap.search({ apiKey: T, searchText: q, isAccurate, maxResults: 5, language: 'he' });
        out.search[q + (isAccurate ? ' [accurate]' : ' [loose]')] = cut(r);
      } catch (e) { err('search:' + q, e); }
    }
  }

  for (const layer of LAYERS) {
    try { out.fields[layer] = cut(await govmap.getLayerFilterFields(layer, T)); }
    catch (e) { err('fields:' + layer, e); }
    try {
      const r = await govmap.getLayerFeaturesByLocation(
        { geometry: KNOWN_POINT, radius: 30, layers: [{ name: layer, fields: [] }] }, T);
      out.byLocation[layer] = cut(r);
    } catch (e) { err('byLocation:' + layer, e); }
  }

  console.log('%cGovMap probe v2 done - run: copy(JSON.stringify(__govmapProbe, null, 1))', 'font-weight:bold', out);
})();

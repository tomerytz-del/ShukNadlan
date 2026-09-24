/* ============================================================================
   ‏GovMap — בדיקת שוויון מול ה-WFS של עפולה (גרסה 3)

   מריצים בקונסול של https://shuknadlan.co.il. בסוף:
   copy(JSON.stringify(__govmapProbe, null, 1)) ומדביקים.

   ## מה למדנו בגרסאות 1-2 (24.9.2026), ומה זה שינה כאן
   - ‏getLayerFilterFields מחזירה **מערך** ולא `{data}` כמו בתיעוד.
   - ‏getLayerFeaturesByLocation מסרבת בלי שמות שדות ("No fields
     specified"), ולכן השמות נלקחים מ-getLayerFilterFields של אותה שכבה.
   - חיפוש כתובת לא מצא את החורש 8 ואת הפרסה 5 בעפולה, אבל גוש/חלקה
     נמצאו. לכן הנקודה כאן היא **מרכז החלקה** מ-search על "גוש/חלקה".

   ## מה נבדק
   לכל חלקת ייחוס: שטח רשום (PARCEL_ALL), ייעוד ותוכנית (retzefMigrashim),
   ושכונה (neighborhoods_area) - מול מה ש-property_planning_info כבר יודעת.
   ============================================================================ */
(async () => {
  const T = 'a888579d-2bc4-4768-97d5-bd1642e2633b';
  const LAYERS = ['PARCEL_ALL', 'retzefMigrashim', 'neighborhoods_area'];
  const REFS = [
    { q: '16742/96', addr: 'החורש 8', expect: { area: 1252, landUse: 'מגורים ב', plans: ['ג/20010', 'ג/12567', '215-0898114'] } },
    { q: '16697/64', addr: 'הפרסה 5', expect: { area: 1264, landUse: 'תעשיה', plans: ['ג/בת/180', 'ג/12567', '215-0898114'] } },
  ];

  const out = { v: 3, at: new Date().toISOString(), fieldNames: {}, refs: [], errors: [] };
  window.__govmapProbe = out;
  const err = (where, e) => out.errors.push({ where, e: String((e && e.message) || e).slice(0, 300) });
  const cut = (x, n) => { try { return JSON.stringify(x).slice(0, n || 4000); } catch (e) { return String(x); } };

  if (!window.govmap) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://www.govmap.gov.il/govmap/api/govmap.api.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }).catch(e => err('load', e));
  }
  if (!window.govmap) { console.error('govmap לא נטען', out); return; }

  for (const layer of LAYERS) {
    try {
      const f = await govmap.getLayerFilterFields(layer, T);
      const arr = Array.isArray(f) ? f : (f && f.data) || [];
      out.fieldNames[layer] = arr.map(x => x.name + ' = ' + x.displayName);
    } catch (e) { err('fields:' + layer, e); }
  }

  for (const ref of REFS) {
    const r = { q: ref.q, addr: ref.addr, expect: ref.expect, byRadius: {} };
    try {
      const s = await govmap.search({ apiKey: T, searchText: ref.q, isAccurate: true, maxResults: 1, language: 'he' });
      const hit = s && s.results && s.results[0];
      r.hit = hit ? { id: hit.id, text: hit.text, centroid: hit.centroid } : null;
      if (hit) {
        try { r.detail = cut(await govmap.getSearchResultData(hit, T), 3000); }
        catch (e) { err('detail:' + ref.q, e); }
        const layers = LAYERS.filter(l => out.fieldNames[l])
          .map(l => ({ name: l, fields: out.fieldNames[l].map(x => x.split(' = ')[0]) }));
        // רדיוס 0 = מה שמכיל את מרכז החלקה; 15 = מה שנוגע בה (מגרש שחוצה חלקות)
        for (const radius of [0, 15]) {
          try {
            r.byRadius[radius] = cut(await govmap.getLayerFeaturesByLocation({ geometry: hit.centroid, radius, layers }, T));
          } catch (e) { err('byLocation:' + ref.q + ':' + radius, e); }
        }
      }
    } catch (e) { err('ref:' + ref.q, e); }
    out.refs.push(r);
  }

  console.log('%cGovMap probe v3 done - run: copy(JSON.stringify(__govmapProbe, null, 1))', 'font-weight:bold', out);
})();

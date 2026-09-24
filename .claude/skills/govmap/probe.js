/* ============================================================================
   ‏GovMap — בדיקת היתכנות להחלפת ה-WFS של עפולה

   מריצים בקונסול של https://shuknadlan.co.il (לא localhost - הטוקן נעול
   לדומיין). בסוף: `copy(__govmapProbe)` ומדביקים את התוצאה בשיחה.

   מה היא עונה עליו:
     1. האם GovMap מחזיר את מה שה-WFS של עפולה מחזיר היום, **על אותן
        כתובות** - גוש, חלקה, שטח, סטטוס, ייעוד, תוכניות. שתי כתובות הייחוס
        למטה נשלפו מ-property_planning_info, כלומר התשובה הנכונה ידועה.
     2. אילו שדות יש בכל שכבה (getLayerFilterFields).
     3. לאילו כתובות הדפדפן פונה בפועל (resource timing) - הצעד הראשון
        בשאלה אם אפשר לקרוא ל-GovMap גם מהשרת.

   שכבות תוכניות וייעוד: השמות לא ידועים לנו. ב-govmap.gov.il מדליקים את
   שכבות "תכניות" / "ייעודי קרקע" / "מגרשים", לוחצים "שתף", ומעתיקים את
   הערכים שאחרי lay= אל EXTRA_LAYERS.
   ============================================================================ */
(async () => {
  const T = 'a888579d-2bc4-4768-97d5-bd1642e2633b';
  // ערכי lay= מ-apiManagement ב-24.9.2026 (שכבת "עסקאות נדל\"ן" ושכנותיה). מזהה
  // מספרי ו-layer_<id> שניהם מתועדים כתקפים; שולחים את שניהם ורואים מי עונה.
  const EXTRA_LAYERS = ['218358', '212537', '16', 'layer_218358', 'layer_212537'];
  const LAYERS = ['PARCEL_ALL', 'SUB_GUSH_ALL', 'retzefMigrashim', 'neighborhoods_area', ...EXTRA_LAYERS];
  const REFS = [
    { q: 'החורש 8 עפולה', expect: { gush: '16742', helka: '96', area: 1252, landUse: 'מגורים ב', plan: 'ג/20010' } },
    { q: 'הפרסה 5 עפולה', expect: { gush: '16697', helka: '64', area: 1264, landUse: 'תעשיה', plan: 'ג/בת/180' } },
  ];

  const out = { at: new Date().toISOString(), origin: location.origin, fields: {}, refs: [], urls: [], errors: [] };
  window.__govmapProbe = out;
  const err = (where, e) => out.errors.push({ where, e: String((e && e.message) || e) });

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
      out.fields[layer] = (f && f.data || []).map(x => ({ name: x.name, display: x.displayName, type: x.fieldType,
        top: x.values && x.values.topValues ? x.values.topValues.slice(0, 5) : undefined }));
    } catch (e) { err('fields:' + layer, e); }
  }

  for (const ref of REFS) {
    const r = { q: ref.q, expect: ref.expect };
    try {
      const s = await govmap.search({ apiKey: T, searchText: ref.q, isAccurate: true, maxResults: 3, language: 'he' });
      r.search = s && s.results ? s.results.map(x => ({ type: x.type, text: x.text, centroid: x.centroid, id: x.id })) : s;
      const hit = s && s.results && s.results.find(x => x.type === 'address');
      if (hit) {
        const layers = LAYERS.filter(l => out.fields[l]).map(l => ({ name: l, fields: out.fields[l].map(f => f.name) }));
        const g = await govmap.getLayerFeaturesByLocation({ geometry: hit.centroid, radius: 25, layers }, T);
        r.features = g && g.layers;
      }
    } catch (e) { err('ref:' + ref.q, e); }
    out.refs.push(r);
  }

  out.urls = [...new Set(performance.getEntriesByType('resource')
    .map(e => e.name).filter(u => /govmap/i.test(u))
    .map(u => u.replace(/([?&](?:token|apiKey|apiToken)=)[^&]+/gi, '$1…')))];

  console.log('%cGovMap probe done - run: copy(__govmapProbe)', 'font-weight:bold', out);
})();

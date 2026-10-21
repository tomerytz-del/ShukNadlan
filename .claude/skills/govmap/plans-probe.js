/* ============================================================================
   ‏GovMap — בדיקת שכבות התוכניות החלות (12.10.2026)

   מפ"י הציעו לתוכניות החלות את "שכבת המגרשים" ואת "הקווים הכחולים של
   מבא"ת", בקישור `?lay=203,14`. לא ידוע אם ה-API מקבל את המספרים האלה או
   שם אחר (כמו PARCEL_ALL מול המספר שב-URL), ולכן הבדיקה מנסה כמה מועמדים.

   מריצים בקונסול של https://shuknadlan.co.il (לא localhost). בסוף:
   copy(JSON.stringify(__govmapPlans, null, 1)) ומדביקים.

   קריאות SDK מתועדות בלבד (getLayerFilterFields, search,
   getLayerFeaturesByLocation) — שימוש מעבר לתיעוד אינו מורשה (docs/govmap.md).
   ============================================================================ */
(async () => {
  const T = 'a888579d-2bc4-4768-97d5-bd1642e2633b';
  // המספרים מהקישור קודם; אחריהם שמות שמופיעים בקטלוג או מנוחשים
  const CANDIDATES = ['203', '14', 203, 14, 'migrashim_msbs', 'mavat', 'kav_kachol', 'blue_lines', 'tochniyot'];
  // התשובה ידועה מעפולה (property_planning_info): 5-7 תוכניות לחלקה, כולל מתאר
  const REFS = [
    { q: '16742/96', addr: 'החורש 8', plans: ['ג/20010', 'ג/12567', '215-0898114'] },
    { q: '16697/64', addr: 'הפרסה 5', plans: ['ג/בת/180', 'ג/12567', '215-0898114'] },
  ];

  const out = { v: 1, at: new Date().toISOString(), layers: {}, refs: [], errors: [] };
  window.__govmapPlans = out;
  const err = (where, e) => out.errors.push({ where, e: String((e && e.message) || e).slice(0, 300) });
  const cut = (x, n) => { try { return JSON.stringify(x).slice(0, n || 6000); } catch (e) { return String(x); } };

  if (!window.govmap) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://www.govmap.gov.il/govmap/api/govmap.api.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }).catch(e => err('load', e));
  }
  if (!window.govmap) { console.error('govmap לא נטען', out); return; }

  // ‏1. איזה מועמד הוא שכבה שה-API מכיר? מערך ריק אינו "אין שכבה" בוודאות,
  //    ולכן נשמרת גם התשובה הגולמית
  for (const c of CANDIDATES) {
    const key = typeof c + ':' + c;
    try {
      const f = await govmap.getLayerFilterFields(c, T);
      const arr = Array.isArray(f) ? f : (f && f.data) || [];
      out.layers[key] = { name: c, fields: arr.map(x => x.name + ' = ' + x.displayName), raw: cut(f, 1500) };
    } catch (e) { err('fields:' + key, e); }
  }
  const usable = Object.values(out.layers).filter(l => l.fields.length);
  if (!usable.length) {
    console.warn('אף מועמד לא החזיר שדות. להדליק את השכבות ב-govmap.gov.il, "שתף", ולשלוח את ה-URL', out);
    return;
  }

  // ‏2. מה השכבות מחזירות על שתי חלקות הייחוס, בתוך החלקה וסביבה
  for (const ref of REFS) {
    const r = { q: ref.q, addr: ref.addr, expectPlans: ref.plans, byRadius: {} };
    try {
      const s = await govmap.search({ apiKey: T, searchText: ref.q, isAccurate: true, maxResults: 1, language: 'he' });
      const hit = s && s.results && s.results[0];
      r.hit = hit ? { text: hit.text, centroid: hit.centroid } : null;
      if (hit) {
        const layers = usable.map(l => ({ name: l.name, fields: l.fields.map(x => x.split(' = ')[0]) }));
        for (const radius of [0, 15]) {
          try {
            const res = await govmap.getLayerFeaturesByLocation({ geometry: hit.centroid, radius, layers }, T);
            // שגיאה חוזרת בתוך תשובה תקינה (SKILL.md סעיף 3) — לבדוק errors לפני מערך ריק
            r.byRadius[radius] = { errors: res && res.errors, counts: {}, raw: cut(res) };
            for (const [name, feats] of Object.entries((res && res.layers) || {})) r.byRadius[radius].counts[name] = feats.length;
          } catch (e) { err('byLocation:' + ref.q + ':' + radius, e); }
        }
      }
    } catch (e) { err('ref:' + ref.q, e); }
    out.refs.push(r);
  }

  console.log('%cGovMap plans probe done - run: copy(JSON.stringify(__govmapPlans, null, 1))', 'font-weight:bold', out);
})();

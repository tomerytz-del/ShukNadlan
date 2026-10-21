/* בדיקת עיר חדשה מול GovMap: 20 כתובות מעסקאות רשות המיסים (הגוש והחלקה שבעסקה הם התשובה הנכונה).
   מריצים בקונסול של https://shuknadlan.co.il/crm. להחליף את A בכתובות מהעיר - שאילתה ב-market_deals_official.
   קריאה בלבד, לא שומר. תוצאות 22.10.2026: docs/govmap.md, "בדיקת ערים". */
(async () => {
  // 20 כתובות מעסקאות רשות המיסים, עם הגוש והחלקה הרשומים בעסקה (התשובה הנכונה)
  const A = [
    ['חיפה','צה"ל','27','10915','2'],['חיפה','דוכיפת','9','11193','343'],['חיפה','הקשת','8','11728','19'],
    ['חיפה','דרך הים','150','12325','2'],['חיפה','חניתה','49','10882','147'],
    ['כרמיאל','הרימון','29','18998','23'],['כרמיאל','השושנים','9','19062','6'],['כרמיאל','מבצע בן עמי','11','19872','17'],
    ['כרמיאל','אשכולות','66','19069','16'],['כרמיאל','הדס','2','18983','362'],
    ['נוף הגליל','יזרעאל','12','17833','11'],['נוף הגליל','השושנים','9','17745','11'],['נוף הגליל','גלעד','28','16650','36'],
    ['נוף הגליל','נורית','11','17747','82'],['נוף הגליל','עטרה','8','17748','2'],
    ['קריית ביאליק','אהובה עוזרי','6','10160','76'],['קריית ביאליק','סאלד','31','11538','117'],['קריית ביאליק','יקינתון','5','10236','135'],
    ['קריית ביאליק','ירושלים','2','11538','91'],['קריית ביאליק','בן גוריון','55','11554','221'],
  ];
  if (!window.GovmapLookup) { console.error('GovmapLookup לא נטען - להריץ בתוך ה-CRM'); return; }
  const rows = [];
  for (const [city, street, num, gush, helka] of A) {
    const r = { city, addr: street + ' ' + num };
    console.log('…', r.city, r.addr);
    try {
      // קודם כתובת בלבד - כך נמדד כיסוי שכבת הכתובות
      let res = await GovmapLookup.lookupProperty({ street, houseNumber: num, city });
      r.found = res ? res.pinSource : 'none';
      // לא נמצאה - דרך המילוט, לפי הגוש והחלקה של העסקה
      if (!res) { res = await GovmapLookup.lookupProperty({ street, houseNumber: num, city, gush, helka }); r.byParcel = !!res; }
      const p = res && res.planning;
      if (p) {
        r.parcel = p.gush + '/' + p.helka;
        r.parcelOk = String(p.gush) === gush && String(p.helka) === helka;
        r.zoning = p.land_use_designation || '';
        r.detailedPlan = (p.applicable_plans[0] || {}).number || '';
        r.hood = p.neighborhood || '';
      }
      if (res && res.itm) {
        const plans = await GovmapLookup.plansAt(res.itm);
        r.plans203 = plans.length;
        r.notices = plans.filter(x => x.notice).length;
        r.planNums = plans.map(x => x.number).join(' | ');
      }
    } catch (e) { r.error = String((e && e.message) || e).slice(0, 120); }
    rows.push(r);
  }
  const n = rows.length, c = f => rows.filter(f).length;
  const summary = {
    'כתובת נמצאה': c(r => r.found === 'address') + '/' + n,
    'נמצא רק לפי גוש/חלקה': c(r => r.byParcel) + '/' + n,
    'גוש/חלקה זהים לעסקה': c(r => r.parcelOk) + '/' + c(r => r.parcel),
    'יש ייעוד מגרש': c(r => r.zoning) + '/' + c(r => r.parcel),
    'יש תוכנית מפורטת': c(r => r.detailedPlan) + '/' + c(r => r.parcel),
    'יש תוכניות מ-203': c(r => r.plans203) + '/' + c(r => r.plans203 != null),
    'שגיאות': c(r => r.error),
  };
  window.__cityProbe = { at: new Date().toISOString(), summary, rows };
  console.table(rows);
  console.table(summary);
  console.log('%cdone - run: copy(JSON.stringify(__cityProbe, null, 1))', 'font-weight:bold');
})();

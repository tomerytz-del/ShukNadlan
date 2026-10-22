/* ============================================================================
   דף הבדיקה התכנונית - plan.html?k=<קישור>
   ----------------------------------------------------------------------------
   גבריאלה שולחת את הקישור כשהיא לא יכולה לענות מהשרת: GovMap מותר מצד
   הלקוח בלבד (מפ"י). כאן הבדיקה רצה מיד בדפדפן - בלי כניסה ובלי ה-CRM, שטעינה
   שלו לקחה זמן וסוכנים נטשו באמצע (22.10.2026).

     1. GovMap מתחיל להיטען מיד, במקביל לשאלה על הקישור
     2. planning-link (‏open) - הכתובת או הגוש/חלקה של הקישור
     3. GovmapLookup.addressRecord - אותה רשומה כמו בהשלמה ב-CRM
     4. התוצאה מוצגת, ונשלחת ל-planning-link (‏complete): נשמרת לגבריאלה
        ויוצאת לסוכן/ת בוואטסאפ

   ‏docs/govmap.md, "דף הבדיקה".
   ========================================================================== */
(function(){
  'use strict';

  const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  const FN_URL = SUPABASE_URL + '/functions/v1/planning-link';
  const K = (new URLSearchParams(location.search).get('k') || '').trim();
  const app = document.getElementById('app');

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }

  async function call(action, payload){
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(Object.assign({ action, k: K }, payload || {})),
    });
    let data = {};
    try { data = await res.json(); } catch(_){ /* גוף ריק */ }
    if (!res.ok || data.error) {
      const err = new Error(data.message || data.error || ('HTTP ' + res.status));
      err.userMessage = data.message || '';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function label(l){
    if (l.street && l.house_number) return l.street + ' ' + l.house_number + (l.city ? ', ' + l.city : '');
    return 'גוש ' + l.gush + ' חלקה ' + l.helka;
  }

  function showError(title, text, retry){
    app.innerHTML = '<div class="card"><h1>' + esc(title) + '</h1><p class="sub">' + esc(text) + '</p>' +
      (retry ? '<button class="btn" id="retry" type="button">לנסות שוב</button>' : '') + '</div>';
    if (retry) document.getElementById('retry').addEventListener('click', run);
  }

  const STAGE = { approved: 'מאושרת', deposited: 'בהפקדה', notice: 'הודעה לפי סעיף 77-78' };
  const MAVAT_RE = /^https:\/\/mavat\.iplan\.gov\.il\/[A-Za-z0-9\/]+$/;

  /* הסיכום כאן מגיע או מהדפדפן (‏addressRecord) או מהשרת (‏result של קישור
     שכבר נענה) - ובשני המקרים כל ערך עובר esc, וקישור יוצא רק למבא"ת. */
  function render(link, s, sentNote){
    if (!s) {
      app.innerHTML = '<div class="card"><h1>' + esc(label(link)) + '</h1>' +
        '<p class="sub">GovMap לא מצא את הכתובת בשכבת הכתובות. אם הגוש והחלקה ידועים, ' +
        'שלח/י אותם לגבריאלה בוואטסאפ והיא תבדוק לפיהם.</p></div>';
      return;
    }
    const facts = [];
    if (s.gush && s.helka) facts.push(['גוש ' + s.gush + ' חלקה ' + s.helka, 'גוש וחלקה']);
    if (s.area_sqm) facts.push([Number(s.area_sqm).toLocaleString('he-IL') + ' מ"ר', 'שטח רשום']);
    if (s.parcel_status) facts.push([s.parcel_status, 'סטטוס']);
    if (s.neighborhood) facts.push([s.neighborhood, 'שכונה']);
    const plans = (s.plans || []).map(p =>
      '<div class="plan"><div class="plan-num">' + esc(p.number) + (p.name ? ' · ' + esc(p.name) : '') + '</div>' +
      '<div class="plan-meta">' + esc([p.notice ? STAGE.notice : p.kind, !p.notice && p.stage ? STAGE[p.stage] : '',
        p.designation ? 'ייעוד: ' + p.designation : ''].filter(Boolean).join(' · ')) + '</div>' +
      (p.url && MAVAT_RE.test(p.url) ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">התוכנית במבא"ת</a>' : '') +
      '</div>').join('');
    const detailed = (s.detailed || []).map(n =>
      '<div class="plan"><div class="plan-num">' + esc(n) + '</div><div class="plan-meta">תוכנית מפורטת</div></div>').join('');
    app.innerHTML =
      '<div class="card"><h1>' + esc(label(link)) + '</h1>' +
      (s.pin_source === 'parcel' ? '<p class="sub">הכתובת אינה בשכבת הכתובות - המידע לפי הגוש והחלקה.</p>' : '') +
      '<div class="facts">' + facts.map(f => '<div class="fact"><b>' + esc(f[0]) + '</b><span>' + esc(f[1]) + '</span></div>').join('') +
      '<div class="fact wide"><b>' + esc(s.designation || 'לא נמצא בשכבות') + '</b><span>ייעוד קרקע</span></div></div>' +
      ((s.plans || []).some(p => p.notice)
        ? '<div class="notice">יש הודעה לפי סעיף 77-78: ייתכנו מגבלות על היתרים באזור עד שהתוכנית תאושר או תבוטל.</div>' : '') +
      '</div>' +
      ((plans || detailed) ? '<div class="card"><p class="sec-title">תוכניות החלות במקום</p>' + detailed + plans + '</div>' : '') +
      (sentNote ? '<div class="status ' + sentNote[0] + '">' + esc(sentNote[1]) + '</div>' : '') +
      '<p class="note">המידע כללי, מבוסס על GovMap (המרכז למיפוי ישראל) ומבא"ת, ואינו תחליף לבדיקה מול הוועדה המקומית לתכנון ובנייה. ' +
      'כל זכויות היוצרים שמורות למרכז למיפוי ישראל.</p>';
  }

  /* אותו סיכום שהשרת שומר (‏summary.ts) - כדי שהדף והוואטסאפ יראו אותו דבר */
  function summarize(r){
    if (!r) return null;
    const plans = (r.govmap_plans || []).slice(0, 8);
    const approved = plans.find(p => p.designation && !p.notice && p.stage === 'approved');
    return {
      gush: r.gush || null, helka: r.helka || null,
      area_sqm: r.parcel_area_sqm || null, parcel_status: r.parcel_status || null,
      designation: r.land_use_designation || (approved ? approved.designation : null),
      neighborhood: r.neighborhood || null, pin_source: r.pin_source || null,
      plans, detailed: (r.applicable_plans || []).map(p => p && p.number).filter(Boolean).slice(0, 8),
    };
  }

  async function run(){
    if (!/^[0-9a-f]{32}$/.test(K)) {
      showError('הקישור אינו תקין', 'בקש/י מגבריאלה בוואטסאפ קישור חדש לבדיקה.');
      return;
    }
    app.innerHTML = '<div class="card state"><div class="spin"></div><p>בודקת את הכתובת ב-GovMap…</p></div>';
    // ‏GovMap ו-proj4 נטענים במקביל לשאלה על הקישור - זה רוב הזמן
    const ready = window.govmapReady ? window.govmapReady().catch(() => null) : Promise.resolve(null);
    let link;
    try {
      link = (await call('open')).link;
    } catch(err) {
      if (err.status === 404 || err.status === 401) {
        showError('הקישור פג תוקף', err.userMessage || 'בקש/י מגבריאלה בוואטסאפ קישור חדש לבדיקה.');
      } else {
        showError('משהו השתבש', 'לא הצלחנו לפתוח את הבדיקה. נסה/י שוב בעוד רגע.', true);
      }
      return;
    }
    if (link.done) { render(link, link.result || null); return; }
    app.querySelector('p').textContent = 'בודקת את ' + label(link) + ' ב-GovMap…';

    let record;
    try {
      await ready;
      record = await GovmapLookup.addressRecord(link);
    } catch(err) {
      console.warn('GovMap:', err);
      showError('GovMap לא ענה', 'שכבות המיפוי לא ענו כרגע. נסה/י שוב בעוד רגע.', true);
      return;
    }
    const s = summarize(record);
    render(link, s);
    try {
      const res = await call('complete', { record });
      // רק כתובת נשמרת במטמון של גבריאלה; גוש/חלקה היא כבר עונה מהשכבה הפתוחה
      const cached = link.street && s ? ', ובפעם הבאה אענה על הכתובת הזו ישירות בוואטסאפ' : '';
      render(link, s, ['ok', (res.sent ? 'שלחתי לך את התוצאה גם בוואטסאפ' : 'התוצאה נשמרה') + cached + '.']);
    } catch(err) {
      console.warn('planning-link complete:', err);
    }
  }

  run();
})();

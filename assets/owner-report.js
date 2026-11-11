/* ============================================================================
   דף הדוח לבעל הנכס - owner-report.html?k=<קישור>
   ----------------------------------------------------------------------------
   יועץ/ת הנדל״ן מפיק/ה את הדוח ב-CRM (owner_report_create) ושולח/ת את
   הקישור לבעלים בערוץ שלו/ה. הדף מציג את הדוח השמור (תמונת מצב של רגע
   ההפקה) בצבעי המשרד, בלי כניסה.

     1. owner-report-link - הדוח, ההערה של הסוכן/ת והמיתוג של היום
     2. ציור: שלושה מספרים, גרף 7 ימים, השוואה לשוק ועובדות הנכס
     3. הדפסה / PDF והעתקת הקישור

   מספרים בלבד: בלי שם או זהות של גולש/ת. ‏docs/owner-report.md.
   ========================================================================== */
(function(){
  'use strict';

  const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  const FN_URL = SUPABASE_URL + '/functions/v1/owner-report-link';
  const K = (new URLSearchParams(location.search).get('k') || '').trim();
  const PREVIEW = new URLSearchParams(location.search).get('p') === '1';
  const state = document.getElementById('orState');
  const HEX = /^#[0-9a-fA-F]{6}$/;

  // escapeHtml מ-assets/esc.js (CLAUDE.md, "בריחת HTML")
  const esc = s => escapeHtml(s);
  const num = n => Number(n || 0).toLocaleString('he-IL');
  const shekel = n => '₪' + Number(n).toLocaleString('he-IL');

  function showError(title, text, retry){
    state.hidden = false;
    document.getElementById('orWrap').hidden = true;
    state.innerHTML = '<h1>' + esc(title) + '</h1><p class="sub">' + esc(text) + '</p>'
      + (retry ? '<button class="or-btn" id="retry" type="button" style="margin:12px auto 0;padding:0 22px">לנסות שוב</button>' : '');
    if (retry) document.getElementById('retry').addEventListener('click', run);
  }

  /* צבעי המשרד כמשתנים. ערך שאינו hex תקין לא נכנס (השרת כבר מנרמל, וזו
     הגנה שנייה: שדה מהמסד אינו הופך ל-CSS שרירותי). */
  function applyBrand(b){
    if (!b) return;
    const root = document.documentElement.style;
    [['--brand', b.primary], ['--brand-dark', b.primaryDark], ['--accent', b.accent], ['--on-brand', b.onPrimary]]
      .forEach(([k, v]) => { if (typeof v === 'string' && HEX.test(v)) root.setProperty(k, v); });
  }

  /* "▲ 3 לעומת 7 הימים שלפני" - המילים אומרות את הכיוון, לא רק הצבע */
  function delta(cur, prev){
    cur = Number(cur || 0); prev = Number(prev || 0);
    if (!cur && !prev) return '';
    const diff = cur - prev;
    if (diff === 0) return '<div class="d">כמו ב-7 הימים שלפני</div>';
    const word = diff > 0 ? 'יותר' : 'פחות';
    return '<div class="d ' + (diff > 0 ? 'is-up' : 'is-down') + '">' + (diff > 0 ? '▲ ' : '▼ ')
      + num(Math.abs(diff)) + ' ' + word + ' מ-7 הימים שלפני (' + num(prev) + ')</div>';
  }

  function statCard(label, n, extra){
    return '<div class="or-stat"><div class="l">' + esc(label) + '</div><div class="n">' + num(n) + '</div>' + (extra || '') + '</div>';
  }

  function barsHtml(daily){
    const days = Array.isArray(daily) ? daily : [];
    const max = Math.max(0, ...days.map(d => Number(d.n || 0)));
    return '<div class="or-bars" role="img" aria-label="צפיות בנכס בכל אחד מ-7 הימים האחרונים">' + days.map(d => {
      const n = Number(d.n || 0);
      const h = max ? Math.max(3, Math.round(n / max * 100)) : 3;
      const date = new Date(String(d.d) + 'T12:00:00');
      const label = isNaN(date) ? '' : date.toLocaleDateString('he-IL', { weekday: 'narrow' }) + ' ' + date.getDate();
      return '<div class="or-bar' + (n ? '' : ' is-zero') + '"><b>' + num(n) + '</b><i style="height:' + h + '%"></i><span>' + esc(label) + '</span></div>';
    }).join('') + '</div>';
  }

  function render(data){
    const r = data.report || {};
    const p = r.property || {};
    const v = r.views || {};
    const q = r.inquiries || {};
    const b = data.brand || {};
    const rent = p.deal_type === 'rent';
    const generated = r.generated_at ? new Date(r.generated_at) : new Date(data.created_at);
    const dateText = isNaN(generated) ? '' : generated.toLocaleDateString('he-IL');

    const logo = b.logo ? '<span class="or-logo"><img src="' + esc(b.logo) + '" alt="" loading="lazy"></span>' : '';
    const subtitle = [p.city, rent ? 'להשכרה' : 'למכירה',
      p.rooms ? num(p.rooms) + ' חדרים' : '', p.area_sqm ? num(p.area_sqm) + ' מ״ר' : ''].filter(Boolean).join(' · ');

    let html = '<div class="or-brandbar"><div class="or-brand-id">' + logo
      + '<span class="or-agency">' + esc(b.agencyName || 'שוק נדל״ן') + '</span></div>'
      + '<div class="or-doc-title"><span class="or-kicker">דוח שבועי לבעל הנכס</span>'
      + '<span class="or-date">' + esc(dateText) + '</span></div></div>';

    html += '<div class="or-hero"><h1>' + esc(p.title || 'הנכס שלכם') + '</h1><p class="or-sub">' + esc(subtitle) + '</p></div>';

    if (data.note){
      html += '<div class="or-note"><b>הערה מיועץ/ת הנדל״ן</b><p>' + esc(data.note) + '</p></div>';
    }

    html += '<section class="or-sec"><h2 class="or-h">7 הימים האחרונים</h2><div class="or-stats">'
      + statCard('מבקרים בנכס', v.unique_week)
      + statCard('צפיות במודעה', v.week, delta(v.week, v.prev_week))
      + statCard('פניות על הנכס', q.week, delta(q.week, q.prev_week))
      + '</div></section>';

    html += '<section class="or-sec"><h2 class="or-h">צפיות לפי יום</h2>' + barsHtml(v.daily)
      + '<p class="or-cap">כל עמודה היא יום אחד, לפי שעון ישראל. ' + (Number(v.week || 0)
        ? '' : 'אם לא הייתה תנועה השבוע, זה הזמן לדבר על מחיר, תמונות או חשיפה. ') + '</p></section>';

    const m = r.market;
    if (m && typeof m.beat_pct === 'number'){
      html += '<section class="or-sec"><h2 class="or-h">מול השוק</h2><div class="or-market"><span class="big">'
        + esc(m.beat_pct) + '%</span> מהנכסים ' + (rent ? 'להשכרה' : 'למכירה') + (p.city ? ' ב' + esc(p.city) : '')
        + ' קיבלו פחות צפיות מהנכס שלכם ב-7 הימים האחרונים.'
        + '<p class="or-cap" style="margin-top:6px">ההשוואה היא מול ' + num(m.sample) + ' נכסים פעילים נוספים מאותו סוג עסקה.</p></div></section>';
    }

    const facts = [
      ['ימים באוויר', num(p.days_listed)],
      ['מחיר מבוקש', p.price ? shekel(p.price) + (rent ? ' לחודש' : '') : '-'],
      ['צפיות מאז העלאת המודעה', num(v.total)],
      ['פניות מאז העלאת המודעה', num(q.total)],
    ];
    html += '<section class="or-sec"><h2 class="or-h">הנכס במספרים</h2><dl class="or-facts">'
      + facts.map(f => '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>').join('') + '</dl></section>';

    const name = b.agentName || '';
    const photo = b.agentPhoto
      ? '<img class="or-agent-photo" src="' + esc(b.agentPhoto) + '" alt="" loading="lazy">'
      : '<span class="or-agent-photo is-initial" aria-hidden="true">' + esc((name || 'י').charAt(0)) + '</span>';
    const phone = b.phone ? '<a href="tel:' + esc(b.phone.replace(/[^\d+]/g, '')) + '">' + esc(b.phone) + '</a>' : '';
    const mail = b.email ? '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' : '';
    html += '<div class="or-agent">' + photo + '<div><div class="or-agent-name">' + esc(name || 'יועץ הנדל״ן שלכם') + '</div>'
      + '<div class="or-agent-meta">' + [phone, mail, b.license ? 'רישיון ' + esc(b.license) : ''].filter(Boolean).join(' · ') + '</div></div></div>';

    html += '<p class="or-foot">הנתונים מבוססים על כניסות לדף הנכס באתר שוק נדל״ן ועל פניות שהתקבלו עליו, עד מועד הפקת הדוח. '
      + 'צפיות הן ספירת כניסות ולא מספר אנשים, ו"מבקרים" הם גולשים שונים לפי ביקור בדפדפן. הדוח הוא תמונת מצב ואינו מתעדכן.</p>';

    document.getElementById('orBody').innerHTML = html;
    document.title = 'דוח שבועי' + (p.title ? ' - ' + p.title : '') + ' | שוק נדל״ן';
  }

  function wireActions(){
    const msg = document.getElementById('orMsg');
    document.getElementById('orPrint').addEventListener('click', () => window.print());
    document.getElementById('orCopy').addEventListener('click', async () => {
      // בלי ?p=1: זה קישור תצוגה מקדימה של היועץ/ת, והעתקה שלו לבעלים הייתה מעלימה את הפתיחות שלהם
      try { await navigator.clipboard.writeText(location.origin + location.pathname + '?k=' + encodeURIComponent(K)); msg.textContent = 'הקישור הועתק'; }
      catch(_){ msg.textContent = 'לא הצלחנו להעתיק. אפשר להעתיק מהכתובת למעלה.'; }
    });
  }

  let wired = false;
  async function run(){
    if (!/^[0-9a-f]{32}$/.test(K)){
      showError('הקישור אינו תקין', 'אפשר לבקש מיועץ הנדל״ן קישור חדש.', false);
      return;
    }
    state.hidden = false;
    state.innerHTML = '<div class="spin"></div><p>טוענים את הדוח…</p>';
    let data;
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ k: K, preview: PREVIEW }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok || data.error){
        const gone = res.status === 404;
        showError(gone ? 'הקישור לדוח פג תוקף' : 'לא הצלחנו לטעון את הדוח',
          data.message || (gone ? 'אפשר לבקש מיועץ הנדל״ן קישור חדש.' : 'נסו שוב בעוד רגע.'), !gone);
        return;
      }
    } catch(_){
      showError('לא הצלחנו לטעון את הדוח', 'בדקו את החיבור לאינטרנט ונסו שוב.', true);
      return;
    }
    try {
      applyBrand(data.brand);
      render(data);
    } catch(err){
      console.error(err);
      showError('לא הצלחנו להציג את הדוח', 'נסו לרענן את הדף.', true);
      return;
    }
    state.hidden = true;
    document.getElementById('orWrap').hidden = false;
    if (!wired){ wired = true; wireActions(); }
  }

  run();
})();

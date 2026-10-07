/* ============================================================================
   דף הפגישה ללקוח/ה - meeting.html?t=<token>
   ----------------------------------------------------------------------------
   נפתח מהכפתור באישור שגבריאלה שולחת ללקוח/ה כשסוכן/ת קובע/ת איתו/ה פגישה.
   מה יש כאן: מתי ואיפה, הוספה ליומן (Google בקישור, Apple ו-Outlook בקובץ
   ‎.ics‎), ניווט, אישור הגעה / ביטול / בקשת מועד אחר, ודרך לפנות לסוכן/ת.
   ואחרי סיור: "איך היה?" (אהבתי / מתלבט/ת / לא בשבילי).

   כל הנתונים מגיעים מ-meeting-client (‏Edge Function), שמחזירה רק מה שהלקוח/ה
   ממילא יודע/ת - בלי הערות הסוכן/ת. הפרטים: docs/meeting-client-followup.md
   ========================================================================== */
(function(){
  'use strict';

  const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  const FN_URL = SUPABASE_URL + '/functions/v1/meeting-client';

  const TOKEN = (new URLSearchParams(location.search).get('t') || '').trim();
  const app = document.getElementById('app');
  let state = null;

  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }

  async function call(action, payload){
    const res = await fetch(FN_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(Object.assign({ action, t: TOKEN }, payload || {})),
    });
    let data = {};
    try { data = await res.json(); } catch(_){ /* גוף ריק */ }
    if (!res.ok || data.error) {
      const err = new Error(data.message || data.error || ('HTTP ' + res.status));
      err.code = data.error || res.status;
      err.userMessage = data.message || '';
      throw err;
    }
    return data;
  }

  /* ---------- יומן ---------- */
  function gcalDate(iso){
    return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function googleCalendarUrl(m, a){
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: m.noun + (a.name ? ' עם ' + a.name : ''),
      dates: gcalDate(m.starts_at) + '/' + gcalDate(m.ends_at),
      details: [a.phone ? 'טלפון: +' + a.phone : '', location.href].filter(Boolean).join('\n'),
      ctz: 'Asia/Jerusalem',
    });
    if (m.location) p.set('location', m.location);
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }
  function icsUrl(){
    return FN_URL + '?t=' + encodeURIComponent(TOKEN) + '&ics=1';
  }

  /* ---------- תצוגה ---------- */
  const FEEDBACK = [
    ['liked', '👍 אהבתי', '👍 תודה! שמחים שאהבת.'],
    ['unsure', '🤔 מתלבט/ת', '🤔 תודה! הסוכן/ת יחזור/תחזור אליך לעזור להחליט.'],
    ['not_for_me', '👎 לא בשבילי', '👎 תודה! הסוכן/ת יחפש/תחפש נכסים שמתאימים יותר.'],
  ];

  function statusBox(m){
    if (m.status === 'canceled') return '<div class="status bad">הפגישה בוטלה.</div>';
    const fb = FEEDBACK.find(f => f[0] === m.client_feedback);
    if (fb) return '<div class="status ok">' + esc(fb[2]) + '</div>';
    if (m.status === 'past') return '<div class="status warn">הפגישה כבר עברה.</div>';
    if (m.client_response === 'confirmed') return '<div class="status ok">✅ אישרת הגעה. נתראה!</div>';
    if (m.client_response === 'reschedule') return '<div class="status warn">📆 ביקשת מועד אחר - הסוכן/ת יחזור/תחזור אליך.</div>';
    return '';
  }

  function render(){
    const m = state.meeting;
    const a = state.agent || {};
    const open = m.status === 'open';
    const hello = state.client_first_name ? 'שלום ' + esc(state.client_first_name) + ', ' : '';
    const photo = a.photo_url ? `<img src="${esc(a.photo_url)}" alt="${esc(a.name || '')}">` : '';
    const sub = [a.agency_name, a.phone ? '0' + String(a.phone).replace(/^972/, '') : ''].filter(Boolean).join(' · ');

    let html = `
      <section class="card">
        <div class="agent">
          ${photo}
          <div>
            <div class="agent-name">${esc(a.name || 'הסוכן/ת שלך')}</div>
            ${sub ? `<div class="agent-sub">${esc(sub)}</div>` : ''}
          </div>
        </div>
        <h1 style="margin-top:14px">${hello}${esc(m.noun)}${a.name ? ' עם ' + esc(a.name) : ''}</h1>
        ${m.when_text ? `<div class="when">🗓 ${esc(m.when_text)}</div>` : ''}
        ${m.location ? `<div class="where">📍 ${esc(m.location)}</div>` : ''}
        ${statusBox(m)}
      </section>`;

    if (open){
      html += `
      <section class="card">
        <h2 class="sec-title">הוספה ליומן</h2>
        <div class="grid">
          <a class="btn btn-primary" href="${esc(googleCalendarUrl(m, a))}" target="_blank" rel="noopener">יומן Google</a>
          <a class="btn btn-soft" href="${esc(icsUrl())}">אייפון / Outlook</a>
        </div>
        <p class="note">ביומן נכנסת גם תזכורת שעה לפני. ושעה לפני נשלח לך גם תזכורת בוואטסאפ.</p>
      </section>`;

      if (m.location){
        const q = encodeURIComponent(m.location);
        html += `
      <section class="card">
        <h2 class="sec-title">ניווט</h2>
        <div class="grid">
          <a class="btn btn-soft" href="https://waze.com/ul?q=${q}&navigate=yes" target="_blank" rel="noopener">Waze</a>
          <a class="btn btn-soft" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Google Maps</a>
        </div>
      </section>`;
      }

      html += `
      <section class="card">
        <h2 class="sec-title">מגיעים?</h2>
        <div class="grid">
          <button type="button" class="btn btn-ok" data-resp="confirmed" ${m.client_response === 'confirmed' ? 'disabled' : ''}>✅ אישור הגעה</button>
          <button type="button" class="btn btn-soft" data-resp="reschedule" ${m.client_response === 'reschedule' ? 'disabled' : ''}>📆 לשנות מועד</button>
          <button type="button" class="btn btn-bad full" data-resp="canceled">❌ ביטול הפגישה</button>
        </div>
        <p class="note" id="respNote" role="status"></p>
      </section>`;
    }

    if (m.feedback_open){
      html += `
      <section class="card">
        <h2 class="sec-title">איך היה הסיור?</h2>
        <div class="grid">
          ${FEEDBACK.map((f, i) => `<button type="button" class="btn ${f[0] === 'liked' ? 'btn-ok' : 'btn-soft'}${i === 2 ? ' full' : ''}" data-fb="${f[0]}" ${m.client_feedback === f[0] ? 'disabled' : ''}>${esc(f[1])}</button>`).join('')}
        </div>
        <p class="note" id="fbNote" role="status"></p>
      </section>`;
    }

    if (a.phone){
      html += `
      <section class="card">
        <h2 class="sec-title">שאלה ל${esc(a.name || 'סוכן/ת')}?</h2>
        <div class="grid">
          <a class="btn btn-soft" href="https://wa.me/${esc(a.phone)}" target="_blank" rel="noopener">וואטסאפ</a>
          <a class="btn btn-soft" href="tel:+${esc(a.phone)}">חיוג</a>
          ${a.page_url ? `<a class="btn btn-soft full" href="${esc(a.page_url)}" target="_blank" rel="noopener">הנכסים של ${esc(a.name || 'הסוכן/ת')}</a>` : ''}
        </div>
      </section>`;
    }

    app.innerHTML = html;
    app.querySelectorAll('[data-resp]').forEach(btn => btn.addEventListener('click', () => respond(btn.dataset.resp)));
    app.querySelectorAll('[data-fb]').forEach(btn => btn.addEventListener('click', () => sendFeedback(btn.dataset.fb)));
  }

  async function sendFeedback(feedback){
    const note = document.getElementById('fbNote');
    app.querySelectorAll('[data-fb]').forEach(b => { b.disabled = true; });
    try {
      const res = await call('feedback', { feedback });
      state.meeting.client_feedback = feedback;
      render();
      const after = document.getElementById('fbNote');
      if (after && res.message) after.textContent = res.message;
    } catch (err) {
      if (note) note.textContent = err.userMessage || 'משהו השתבש. אפשר לנסות שוב בעוד רגע.';
      app.querySelectorAll('[data-fb]').forEach(b => { b.disabled = false; });
    }
  }

  async function respond(response){
    if (response === 'canceled' && !confirm('לבטל את הפגישה? נעדכן את הסוכן/ת.')) return;
    const note = document.getElementById('respNote');
    app.querySelectorAll('[data-resp]').forEach(b => { b.disabled = true; });
    try {
      const res = await call('respond', { response });
      state.meeting.client_response = response;
      if (response === 'canceled') state.meeting.status = 'canceled';
      render();
      const after = document.getElementById('respNote');
      if (after && res.message) after.textContent = res.message;
    } catch (err) {
      if (note) note.textContent = err.userMessage || 'משהו השתבש. אפשר לנסות שוב בעוד רגע.';
      app.querySelectorAll('[data-resp]').forEach(b => { b.disabled = false; });
      if (err.code === 'canceled' || err.code === 'past') load();
    }
  }

  function showError(text){
    app.innerHTML = `<div class="card state"><p>${esc(text)}</p></div>`;
  }

  async function load(){
    if (!/^[0-9a-f]{48}$/.test(TOKEN)) { showError('הקישור אינו תקין.'); return; }
    try {
      state = await call('view');
      render();
    } catch (err) {
      showError(err.code === 'not_found' ? 'לא מצאנו את הפגישה. ייתכן שהקישור אינו תקין.' : 'לא הצלחנו לטעון את הפגישה. אפשר לנסות שוב בעוד רגע.');
    }
  }

  load();
})();

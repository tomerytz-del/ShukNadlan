/* ============================================================================
   המיניסייט האישי ללקוח/ה - showcase.html?t=<token>
   ----------------------------------------------------------------------------
   כל הנתונים מגיעים מ-client-showcase (‏Edge Function), שכבר סיננה מה שאסור
   שיגיע לכאן: משרד מפרסם של נכס בשת"פ, מספר בית, תמונה עם לוגו. הדף הזה
   אינו פונה למסד ישירות ואינו יודע מאיזה משרד כל נכס - וזה בכוונה: מה שלא
   נשלח לדפדפן אינו יכול לדלוף מה-DevTools.

   שלוש לשוניות: "לבחירה" (נכסים שעוד לא הגיבו עליהם), "אהבתי", ו"הודעות
   וסיורים". נכס שסומן "לא בשבילי" יורד מהעמוד מיד, עם "ביטול" לכמה שניות.
   הפרטים: docs/client-showcase.md
   ========================================================================== */
(function(){
  'use strict';

  const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  const FN_URL = SUPABASE_URL + '/functions/v1/client-showcase';

  const params = new URLSearchParams(location.search);
  const TOKEN = (params.get('t') || '').trim();
  // תצוגה מקדימה מה-CRM: אינה נספרת כפתיחה של הלקוח/ה
  const PREVIEW = params.get('preview') === '1';

  const FEATURE_LABELS = {
    parking:'חניה', elevator:'מעלית', balcony:'מרפסת', sun_balcony:'מרפסת שמש', ac:'מיזוג', bars:'סורגים',
    accessible:'גישה לנכים', renovated_feature:'משופצת', furnished:'מרוהטת', mamad:'ממ״ד',
    building_shelter:'מקלט בבניין', mamak:'ממ״ק', storage:'מחסן', high_ceiling:'תקרה גבוהה', cameras:'מצלמות',
    kitchenette:'מטבחון', alarm:'אזעקה', meeting_room:'חדר ישיבות', loading_ramp:'רמפת העמסה',
    comms:'תקשורת', cold_room:'חדר קירור', moshav_kibbutz_only:'במושב/קיבוץ',
  };
  const REASONS = [
    ['price','המחיר'], ['location','המיקום'], ['size','הגודל'], ['condition','מצב הנכס'],
    ['layout','החלוקה'], ['floor','הקומה'], ['photos','לא אהבתי מהתמונות'], ['other','משהו אחר'],
  ];

  let state = null;
  let tab = 'pending';
  const openThreads = new Set();
  const app = document.getElementById('app');

  /* ---------- רשת ---------- */
  async function call(action, payload){
    const res = await fetch(FN_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(Object.assign({ action, t: TOKEN }, payload || {})),
    });
    let data = {};
    try { data = await res.json(); } catch(_){ /* גוף ריק */ }
    if (!res.ok || data.error) {
      const err = new Error(data.error || ('HTTP ' + res.status));
      err.code = data.error || res.status;
      throw err;
    }
    return data;
  }

  /* ---------- עזרי תצוגה ---------- */
  function esc(s){ return escapeHtml(s == null ? '' : String(s)); }
  const shekel = n => n == null || n === '' ? '' : '₪' + Number(n).toLocaleString('he-IL');
  function priceText(it){
    if (it.price == null) return 'מחיר לפי פנייה';
    return shekel(it.price) + (it.deal_type === 'rent' ? ' לחודש' : '') + (it.price_includes_vat ? ' כולל מע״מ' : '');
  }
  function whatText(it){
    const parts = [it.property_type || 'נכס'];
    if (it.rooms) parts.push(it.rooms + ' חדרים');
    return parts.join(' · ') + (it.deal_type === 'rent' ? ' להשכרה' : ' למכירה');
  }
  function whereText(it){
    return [it.street, it.neighborhood, it.city].filter(Boolean).join(', ');
  }
  function shortWhere(it){
    return [it.property_type || 'נכס', [it.street, it.city].filter(Boolean).join(', ')].filter(Boolean).join(' ב');
  }
  function fmtWhen(iso){
    return new Date(iso).toLocaleString('he-IL', { timeZone:'Asia/Jerusalem', weekday:'long', day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function fmtTime(iso){
    return new Date(iso).toLocaleString('he-IL', { timeZone:'Asia/Jerusalem', day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function phoneDigits(p){ return String(p || '').replace(/[^\d+]/g, ''); }
  function waNumber(p){
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = '972' + d.slice(1);
    return d.length >= 11 ? d : '';
  }

  let toastTimer = null;
  function toast(text, undo){
    const box = document.getElementById('toast');
    document.getElementById('toastText').textContent = text;
    const btn = document.getElementById('toastUndo');
    btn.hidden = !undo;
    btn.onclick = ()=>{ box.hidden = true; if (undo) undo(); };
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ box.hidden = true; }, undo ? 7000 : 3500);
  }

  function errorText(code){
    return ({
      rate_limited:'נשלחו הרבה הודעות בשעה האחרונה. נסו שוב מעט מאוחר יותר.',
      slot_taken:'המועד הזה נתפס בינתיים. בחרו מועד אחר.',
      too_many_open:'יש כבר כמה בקשות סיור שממתינות לאישור.',
      bad_time:'המועד שנבחר אינו זמין.',
    })[code] || 'משהו השתבש. נסו שוב בעוד רגע.';
  }

  /* ---------- טעינה ---------- */
  async function load(){
    if (!/^[0-9a-f]{48}$/.test(TOKEN)) return showState('הקישור אינו תקין', 'כדאי לבקש מהסוכן/ת קישור חדש.');
    try {
      state = await call('view', { preview: PREVIEW });
    } catch(err){
      if (err.code === 'closed') return showState('המיניסייט הזה נסגר', 'הסוכן/ת סגר/ה את הרשימה. אפשר לפנות אליו/ה ישירות.');
      if (err.code === 'not_found') return showState('הקישור אינו תקין', 'כדאי לבקש מהסוכן/ת קישור חדש.');
      return showState('לא הצלחנו לטעון את הנכסים', 'נסו לרענן את הדף בעוד רגע.');
    }
    const brandName = state.agent.agency_name || 'שוק נדל״ן';
    document.title = (state.agent.name ? 'הנכסים ש' + state.agent.name + ' בחר/ה בשבילך' : 'הנכסים שנבחרו בשבילך') + ' | ' + brandName;
    applyBrand(state.agent.colors || {});
    render();
    renderContactFab();
  }

  function showState(title, sub){
    app.innerHTML = `<div class="card state"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>`;
  }

  /* ---------- מיתוג המשרד ----------
     הדף נושא את הצבעים, הלוגו והסוכן/ת של מי ששלח/ה אותו. הצבעים מגיעים
     מהשרת אחרי בדיקת hex, וכאן נבדק רק שטקסט לבן קריא עליהם - אותה בדיקה
     של agencyReadableOn בדף הנכס. גוון בהיר מדי נופל ל-primary_dark, ואם
     גם הוא בהיר - לכחול של ברירת המחדל. */
  function readableOn(hex){
    const full = hex.length === 4 ? '#' + hex.slice(1).split('').map(c => c + c).join('') : hex;
    const lum = [1, 3, 5].map(i => {
      const ch = parseInt(full.slice(i, i + 2), 16) / 255;
      return ch <= 0.03928 ? ch / 12.92 : Math.pow((ch + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    return (1.05) / (L + 0.05) >= 3;
  }
  function applyBrand(c){
    const root = document.documentElement.style;
    const main = [c.primary, c.primary_dark].find(h => h && readableOn(h));
    if (main){
      root.setProperty('--blue', main);
      root.setProperty('--blue-tint', main + '14');
    }
    if (c.accent && readableOn(c.accent)) root.setProperty('--love', c.accent);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && main) meta.setAttribute('content', main);
  }

  /* ---------- כל הדרכים לסוכן/ת ---------- */
  function contactLinks(){
    const a = state.agent;
    const wa = waNumber(a.phone);
    const greet = `היי ${a.name || ''}, לגבי הנכסים ששלחת לי`.replace(/\s+,/, ',');
    return [
      a.phone && { icon:'📞', label:'חיוג', href:'tel:' + phoneDigits(a.phone) },
      wa && { icon:'💬', label:'וואטסאפ', href:'https://wa.me/' + wa + '?text=' + encodeURIComponent(greet), blank:true },
      a.phone && { icon:'📩', label:'SMS', href:'sms:' + phoneDigits(a.phone) },
      a.email && { icon:'✉️', label:'מייל', href:'mailto:' + a.email + '?subject=' + encodeURIComponent('הנכסים ששלחת לי') },
      a.slug && { icon:'👤', label:'העמוד שלי', href:'/agent?slug=' + encodeURIComponent(a.slug), blank:true },
      a.agency_slug && { icon:'🏢', label:'המשרד', href:'/agency?slug=' + encodeURIComponent(a.agency_slug), blank:true },
    ].filter(Boolean);
  }
  function contactHtml(cls){
    return contactLinks().map(l => `<a class="${cls}" href="${esc(l.href)}"${l.blank ? ' target="_blank" rel="noopener noreferrer"' : ''}><span aria-hidden="true">${l.icon}</span> ${esc(l.label)}</a>`).join('');
  }
  function renderContactFab(){
    const links = contactLinks();
    if (!links.length) return;
    const fab = document.createElement('div');
    fab.className = 'fab';
    fab.innerHTML = `
      <div class="fab-sheet" hidden role="dialog" aria-label="יצירת קשר">
        <div class="fab-head">${state.agent.photo_url ? `<img src="${esc(state.agent.photo_url)}" alt="">` : ''}<b>${esc(state.agent.name || 'הסוכן/ת')}</b></div>
        <div class="fab-links">${contactHtml('fab-link')}</div>
      </div>
      <button type="button" class="fab-btn" aria-expanded="false">💬 דברו עם ${esc((state.agent.name || 'הסוכן/ת').split(' ')[0])}</button>`;
    document.body.appendChild(fab);
    const btn = fab.querySelector('.fab-btn');
    const sheet = fab.querySelector('.fab-sheet');
    btn.addEventListener('click', ()=>{ sheet.hidden = !sheet.hidden; btn.setAttribute('aria-expanded', String(!sheet.hidden)); });
    document.addEventListener('click', e => { if (!fab.contains(e.target)){ sheet.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  }

  /* ---------- שיתוף העמוד ----------
     מי שמחליט/ה יחד (בן/בת זוג, הורים) רואה/ה את אותו עמוד ואת אותן העדפות.
     הקישור הוא המפתח, ולכן משתפים אותו כמו שהוא - בלי ?preview. */
  async function sharePage(){
    const url = location.origin + '/showcase?t=' + encodeURIComponent(TOKEN);
    const text = 'הנכסים ש' + (state.agent.name || 'הסוכן/ת') + ' בחר/ה בשבילנו - מה דעתך?';
    if (navigator.share){
      try { await navigator.share({ title: document.title, text, url }); return; }
      catch(err){ if (err && err.name === 'AbortError') return; }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(text + '\n' + url), '_blank', 'noopener');
  }

  /* ---------- ציור ---------- */
  function render(){
    const pending = state.items.filter(i => !i.reaction);
    const liked = state.items.filter(i => i.reaction === 'liked');
    const a = state.agent;

    app.innerHTML = `
      ${(a.agency_logo || a.agency_name) ? `<header class="brandbar">
        ${a.agency_logo ? `<img src="${esc(a.agency_logo)}" alt="${esc(a.agency_name || '')}">` : ''}
        ${a.agency_name ? `<span>${esc(a.agency_name)}</span>` : ''}
      </header>` : ''}
      <section class="card hero">
        <div class="hero-top">
          ${a.photo_url ? `<img class="agent" src="${esc(a.photo_url)}" alt="${esc(a.name)}">` : ''}
          <div style="min-width:0">
            <div class="agent-name">${esc(a.name || '')}</div>
            <div class="agent-sub">${esc(['מתווך/ת מוסמך/ת', a.license_number && 'רישיון ' + a.license_number, a.agency_name].filter(Boolean).join(' · '))}</div>
          </div>
        </div>
        <h1>${esc(state.client_name)}, ${a.name ? 'בחרתי' : 'נבחרו'} בשבילך ${state.items.length === 1 ? 'נכס אחד' : esc(state.items.length) + ' נכסים'}</h1>
        <div class="sub">סמנו מה אהבתם ומה לא - ומהנכסים שאהבתם נתאם סיור.</div>
        <div class="always">🔖 העמוד הזה שלך וזמין תמיד - נכסים חדשים יתווספו כאן.
          <button type="button" class="share-btn" data-share-page>📤 שיתוף עם המשפחה</button></div>
        <label class="wa-pref"><input type="checkbox" data-wa-pref ${state.wa_notify !== false ? 'checked' : ''}>
          📲 עדכון בוואטסאפ כש${esc((a.name || 'הסוכן/ת').split(' ')[0])} עונה או מאשר/ת סיור</label>
        <div class="contact-grid">${contactHtml('pill-btn')}</div>
      </section>
      ${state.intro ? `<section class="card intro">${esc(state.intro)}</section>` : ''}
      <nav class="tabs" role="tablist">
        <button type="button" role="tab" data-tab="pending" aria-selected="${tab === 'pending'}">לבחירה<span class="n">${pending.length}</span></button>
        <button type="button" role="tab" data-tab="liked" aria-selected="${tab === 'liked'}">❤️ אהבתי<span class="n">${liked.length}</span></button>
        <button type="button" role="tab" data-tab="talk" aria-selected="${tab === 'talk'}">💬 הודעות וסיורים</button>
      </nav>
      <div id="tabBody"></div>
      <p class="foot">מיניסייט אישי ופרטי${a.agency_name ? ' מ' + esc(a.agency_name) : ''}<br><small>באמצעות שוק נדל״ן</small></p>
    `;
    app.querySelector('[data-share-page]').addEventListener('click', sharePage);
    app.querySelector('[data-wa-pref]').addEventListener('change', async e => {
      const on = e.target.checked;
      try {
        await call('wa_pref', { on });
        state.wa_notify = on;
        toast(on ? 'נעדכן אותך בוואטסאפ' : 'לא יישלחו עדכונים בוואטסאפ');
      } catch(err){
        e.target.checked = !on;
        toast(errorText(err.code));
      }
    });
    app.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', ()=>{ tab = b.dataset.tab; render(); window.scrollTo({ top: 0 }); }));

    const body = document.getElementById('tabBody');
    if (tab === 'pending'){
      if (!pending.length) body.innerHTML = `<div class="card empty">${liked.length ? 'עברת על הכול. הנכסים שאהבת מחכים בלשונית "אהבתי".' : 'אין כרגע נכסים חדשים. הסוכן/ת יוסיף/תוסיף כאן נכסים כשימצאו.'}</div>`;
      pending.forEach(it => body.appendChild(propCard(it)));
    } else if (tab === 'liked'){
      if (!liked.length) body.innerHTML = '<div class="card empty">עוד לא סימנת נכס שאהבת. הלב שבכרטיס שומר אותו כאן.</div>';
      liked.forEach(it => body.appendChild(propCard(it)));
    } else {
      renderTalk(body);
    }
    renderBanner(liked);
  }

  function propCard(it){
    const el = document.createElement('article');
    el.className = 'card prop';
    const specs = [
      it.size_sqm && `📐 ${it.size_sqm} מ״ר`,
      it.built_size_sqm && it.built_size_sqm !== it.size_sqm && `בנוי ${it.built_size_sqm} מ״ר`,
      it.garden_sqm && `🌿 גינה ${it.garden_sqm} מ״ר`,
      it.floor != null && `🏢 קומה ${it.floor}${it.total_floors ? ' מתוך ' + it.total_floors : ''}`,
      it.condition && `✨ ${it.condition}`,
      it.move_in_soon ? '🔑 כניסה מיידית' : (it.move_in_date && `🔑 כניסה ${new Date(it.move_in_date).toLocaleDateString('he-IL')}`),
      it.maintenance_fee && `ועד בית ${shekel(it.maintenance_fee)}`,
      it.arnona && `ארנונה ${shekel(it.arnona)}`,
    ].filter(Boolean);
    const feats = (it.features || []).map(f => FEATURE_LABELS[f]).filter(Boolean);
    const msgs = state.messages.filter(m => m.item_id === it.id);
    const imgs = it.images || [];

    el.innerHTML = `
      <div class="gallery">${imgs.length
        ? imgs.map((u, i) => `<img src="${esc(u)}" alt="${esc(shortWhere(it))} - תמונה ${i + 1}" loading="${i ? 'lazy' : 'eager'}">`).join('')
        : '<div class="noimg">תמונות יישלחו בהמשך</div>'}</div>
      ${imgs.length > 1 ? `<div class="gal-count">${imgs.length} תמונות - החליקו לצפייה</div>` : ''}
      <div class="prop-body">
        <div class="price">${esc(priceText(it))}</div>
        <div class="what">${esc(whatText(it))}</div>
        <div class="where">📍 ${esc(whereText(it))}</div>
        ${specs.length ? `<div class="specs">${specs.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
        ${it.agent_note ? `<div class="note"><b>${esc(state.agent.name || 'הסוכן/ת')}:</b> ${esc(it.agent_note)}</div>` : ''}
        ${it.description ? `<div class="desc">${esc(it.description)}</div><button type="button" class="more" hidden>המשך קריאה</button>` : ''}
        ${feats.length ? `<div class="feats">${feats.map(f => `<span>✓ ${esc(f)}</span>`).join('')}</div>` : ''}
        <div class="react">
          <button type="button" class="love" aria-pressed="${it.reaction === 'liked'}">${it.reaction === 'liked' ? '❤️ אהבתי' : '🤍 אהבתי'}</button>
          <button type="button" class="nope">✕ לא בשבילי</button>
        </div>
        <div class="reasons" hidden></div>
        <button type="button" class="ask">💬 שאלה על הנכס${msgs.length ? ` (${msgs.length})` : ''}</button>
        <div class="thread" ${openThreads.has(it.id) ? '' : 'hidden'}></div>
      </div>`;

    const desc = el.querySelector('.desc');
    if (desc){
      const more = el.querySelector('.more');
      requestAnimationFrame(()=>{ more.hidden = desc.scrollHeight <= desc.clientHeight + 2; });
      more.addEventListener('click', ()=>{
        const open = desc.classList.toggle('open');
        more.textContent = open ? 'הצגה מקוצרת' : 'המשך קריאה';
      });
    }

    el.querySelector('.love').addEventListener('click', ()=> react(it, it.reaction === 'liked' ? null : 'liked'));
    el.querySelector('.nope').addEventListener('click', ()=> openReasons(el, it));
    el.querySelector('.ask').addEventListener('click', ()=>{
      const th = el.querySelector('.thread');
      if (th.hidden){ openThreads.add(it.id); th.hidden = false; drawThread(th, it.id); th.querySelector('textarea').focus(); }
      else { openThreads.delete(it.id); th.hidden = true; }
    });
    if (openThreads.has(it.id)) drawThread(el.querySelector('.thread'), it.id);
    return el;
  }

  function openReasons(el, it){
    const box = el.querySelector('.reasons');
    if (!box.hidden){ box.hidden = true; return; }
    /* שני שלבים: למה, ואז "בטוח/ה?". הרשימה משותפת ללקוח/ה ולסוכן/ת, והסרה
       בלחיצה אחת הייתה קלה מדי לנכס שאולי רק נראה פחות טוב בתמונה. */
    const picked = new Set();
    const agentName = state.agent.name || 'הסוכן/ת';
    const stepWhy = ()=>{
      box.innerHTML = `
        <p>מה לא התאים? (לא חובה - זה עוזר למצוא את הבא)</p>
        <div class="chips">${REASONS.map(([k, l]) => `<button type="button" data-r="${k}" aria-pressed="${picked.has(k)}">${esc(l)}</button>`).join('')}</div>
        <div class="row"><button type="button" class="btn btn-primary" data-next>המשך</button><button type="button" class="btn btn-ghost" data-cancel>חזרה</button></div>`;
      box.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', ()=>{
        const on = !picked.has(b.dataset.r);
        on ? picked.add(b.dataset.r) : picked.delete(b.dataset.r);
        b.setAttribute('aria-pressed', String(on));
      }));
      box.querySelector('[data-cancel]').addEventListener('click', ()=>{ box.hidden = true; });
      box.querySelector('[data-next]').addEventListener('click', stepSure);
    };
    const stepSure = ()=>{
      box.innerHTML = `
        <p>בטוח/ה שרוצה להסיר את הנכס מהרשימה המשותפת לך ול${esc(agentName)}?</p>
        <div style="font-size:.86rem;color:var(--ink-soft)">${esc(agentName)} יראה/תראה מה סימנת, כדי למצוא לך את הנכס הבא.</div>
        <div class="row"><button type="button" class="btn btn-primary" data-go>כן, להסיר</button><button type="button" class="btn btn-ghost" data-keep>לא, להשאיר</button></div>`;
      box.querySelector('[data-keep]').addEventListener('click', ()=>{ box.hidden = true; });
      box.querySelector('[data-go]').addEventListener('click', ()=> react(it, 'disliked', [...picked]));
    };
    box.hidden = false;
    stepWhy();
  }

  async function react(it, reaction, reasons){
    const prev = it.reaction;
    try {
      await call('react', { item_id: it.id, reaction, reasons: reasons || [] });
    } catch(err){
      toast(errorText(err.code));
      return;
    }
    if (reaction === 'disliked'){
      // ‏"יורד מהמיניסייט": השרת לא יחזיר אותו בטעינה הבאה, וכאן הוא יוצא מיד
      state.items = state.items.filter(x => x.id !== it.id);
      render();
      toast('הנכס הוסר מהרשימה', async ()=>{
        try {
          await call('react', { item_id: it.id, reaction: prev || null });
          it.reaction = prev || null;
          state.items.push(it);
          render();
        } catch(_){ toast('לא הצלחנו להחזיר את הנכס'); }
      });
      return;
    }
    it.reaction = reaction;
    render();
    if (reaction === 'liked') toast('נשמר ב"אהבתי" ❤️');
  }

  /* ---------- שיחה ---------- */
  function drawThread(box, itemId){
    const msgs = state.messages.filter(m => (m.item_id || null) === (itemId || null));
    box.innerHTML = `
      ${msgs.map(m => `<div class="msg ${m.author === 'client' ? 'client' : 'agent'}">${esc(m.body)}<time>${esc(fmtTime(m.created_at))}</time></div>`).join('')
        || `<div class="lead-meta" style="font-size:.86rem;color:var(--ink-soft)">${itemId ? 'שאלה על הנכס הזה תגיע ישירות ל' : 'הודעה כללית תגיע ישירות ל'}${esc(state.agent.name || 'סוכן/ת')}.</div>`}
      <form class="compose">
        <textarea maxlength="1000" rows="2" placeholder="${itemId ? 'למשל: יש חניה צמודה? אפשר לראות בערב?' : 'כתבו כאן...'}" aria-label="הודעה"></textarea>
        <button type="submit" class="btn btn-primary">שליחה</button>
      </form>`;
    const form = box.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const ta = form.querySelector('textarea');
      const text = ta.value.trim();
      if (!text) return;
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const res = await call('message', { item_id: itemId || null, body: text });
        state.messages.push(res.message);
        ta.value = '';
        drawThread(box, itemId);
        toast('ההודעה נשלחה');
      } catch(err){
        toast(errorText(err.code));
        btn.disabled = false;
      }
    });
  }

  function renderTalk(body){
    const meetings = state.meetings || [];
    const itemById = new Map(state.items.map(i => [i.id, i]));
    const general = document.createElement('section');
    general.className = 'card tour';
    general.innerHTML = '<h2>הודעה ל' + esc(state.agent.name || 'סוכן/ת') + '</h2><div class="thread"></div>';
    drawThread(general.querySelector('.thread'), null);

    const meets = document.createElement('section');
    meets.className = 'card tour';
    meets.style.marginTop = '12px';
    const ST = { requested:'ממתין לאישור', confirmed:'מאושר', declined:'לא מתאים' };
    meets.innerHTML = `<h2>סיורים</h2>${meetings.length ? meetings.map(m => `
      <div class="meet">
        <div>
          <b>${esc(fmtWhen(m.starts_at))}</b>
          <div style="color:var(--ink-soft);font-size:.86rem">${esc((m.item_ids || []).map(id => itemById.get(id)).filter(Boolean).map(shortWhere).join(' · '))}</div>
          ${m.agent_note ? `<div style="font-size:.86rem">💬 ${esc(m.agent_note)}</div>` : ''}
        </div>
        <div style="text-align:left">
          <span class="st st-${esc(m.status)}">${esc(ST[m.status] || m.status)}</span>
          ${m.status !== 'declined' && new Date(m.starts_at) > new Date() ? `<div><button type="button" class="more" data-cancel-meet="${esc(m.id)}">ביטול</button></div>` : ''}
        </div>
      </div>`).join('') : '<p style="color:var(--ink-soft);margin:0">עוד לא נקבע סיור. אחרי שתסמנו נכסים שאהבתם, אפשר לבחור מועד.</p>'}`;
    meets.querySelectorAll('[data-cancel-meet]').forEach(b => b.addEventListener('click', async ()=>{
      if (!confirm('לבטל את הסיור?')) return;
      try {
        await call('cancel_meeting', { meeting_id: b.dataset.cancelMeet });
        state.meetings = state.meetings.filter(m => m.id !== b.dataset.cancelMeet);
        render();
        toast('הסיור בוטל');
      } catch(err){ toast(errorText(err.code)); }
    }));

    body.appendChild(meets);
    body.appendChild(general);
    // סיור שכבר ממתין או אושר: הטופס מתקפל לכפתור, כדי שלא ייראה כאילו הבקשה לא נקלטה
    if (state.items.some(i => i.reaction === 'liked')){
      const upcoming = meetings.some(m => m.status !== 'declined' && new Date(m.starts_at) > new Date());
      if (!upcoming) body.insertBefore(tourForm(), meets);
      else {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'ask';
        more.style.marginBottom = '12px';
        more.textContent = '📅 בקשת סיור נוסף';
        more.addEventListener('click', ()=>{ more.replaceWith(tourForm()); });
        body.insertBefore(more, meets);
      }
    }
  }

  /* ---------- קביעת סיור ---------- */
  function renderBanner(liked){
    const banner = document.getElementById('tourBanner');
    const open = (state.meetings || []).some(m => m.status !== 'declined' && new Date(m.starts_at) > new Date());
    const show = !(!liked.length || tab === 'talk' || open);
    document.body.classList.toggle('has-banner', show);
    if (!show){ banner.hidden = true; return; }
    document.getElementById('tourBannerText').textContent =
      liked.length === 1 ? 'אהבת נכס אחד - רוצה לראות אותו מקרוב?' : `אהבת ${liked.length} נכסים - נתאם סיור באחד מהם או בכולם?`;
    document.getElementById('tourBannerBtn').onclick = ()=>{ tab = 'talk'; render(); window.scrollTo({ top: 0 }); };
    banner.hidden = false;
  }

  /* ‏Asia/Jerusalem → UTC. הדפדפן של הלקוח/ה לא בהכרח בישראל, והשעה שהוא/היא
     בוחר/ת היא שעה בישראל - כי שם הסיור. */
  function ilToIso(dateStr, hh, mm){
    const [y, m, d] = dateStr.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Jerusalem', hourCycle:'h23',
      year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).formatToParts(new Date(guess));
    const g = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const asIl = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute);
    return new Date(guess - (asIl - guess)).toISOString();
  }
  function ilDateKey(dt){
    return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Jerusalem' }).format(dt);
  }
  function ilWeekday(dateStr){
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  }

  function tourForm(){
    const liked = state.items.filter(i => i.reaction === 'liked');
    const sec = document.createElement('section');
    sec.className = 'card tour';
    sec.style.marginBottom = '12px';

    // 14 ימים קדימה, בלי שבת. שישי עד 13:30.
    const days = [];
    for (let i = 0; days.length < 12 && i < 20; i++){
      const key = ilDateKey(new Date(Date.now() + i * 86400000));
      if (ilWeekday(key) === 6) continue;
      days.push(key);
    }
    const chosen = new Set(liked.map(i => i.id));
    let day = days[0];
    let slot = null;

    sec.innerHTML = `
      <h2>📅 תיאום סיור</h2>
      ${state.has_agreement ? '' : `<div class="legal">לפני הסיור ${esc(state.agent.name || 'הסוכן/ת')} ישלח/תשלח לך הזמנת שירותי תיווך לחתימה דיגיטלית - כך מחייב חוק המתווכים, ולוקח דקה.</div>`}
      <fieldset><legend>אילו נכסים?</legend>
        ${liked.map(i => `<label class="pick"><input type="checkbox" value="${esc(i.id)}" checked> ${esc(shortWhere(i))} · ${esc(priceText(i))}</label>`).join('')}
      </fieldset>
      <fieldset><legend>באיזה יום?</legend><div class="days"></div></fieldset>
      <fieldset><legend>באיזו שעה?</legend><div class="slots"></div></fieldset>
      <fieldset><legend>הערה (לא חובה)</legend>
        <textarea maxlength="600" rows="2" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px" placeholder="למשל: מעדיפים אחרי העבודה, נגיע עם הילדים"></textarea>
      </fieldset>
      <button type="button" class="btn btn-primary" data-send style="width:100%">שליחת בקשה לסיור</button>`;

    const daysBox = sec.querySelector('.days');
    const slotsBox = sec.querySelector('.slots');
    const busy = (state.busy || []).map(b => [new Date(b.from).getTime(), new Date(b.to).getTime()]);

    function drawDays(){
      daysBox.innerHTML = days.map(k => {
        const label = new Date(ilToIso(k, 12, 0)).toLocaleDateString('he-IL', { timeZone:'Asia/Jerusalem', weekday:'short', day:'numeric', month:'numeric' });
        return `<button type="button" data-day="${k}" aria-pressed="${k === day}">${esc(label)}</button>`;
      }).join('');
      daysBox.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', ()=>{ day = b.dataset.day; slot = null; drawDays(); drawSlots(); }));
    }
    function drawSlots(){
      const lastHour = ilWeekday(day) === 5 ? 13.5 : 20;
      const out = [];
      for (let h = 9; h <= lastHour; h += 0.5){
        const hh = Math.floor(h), mm = h % 1 ? 30 : 0;
        const iso = ilToIso(day, hh, mm);
        const t = new Date(iso).getTime();
        // שעה מעכשיו לפחות, ולא בתוך שעה מפגישה קיימת ביומן
        const taken = t < Date.now() + 3600000 || busy.some(([f, to]) => t > f - 3600000 && t < to);
        out.push(`<button type="button" data-slot="${iso}" ${taken ? 'disabled' : ''} aria-pressed="${iso === slot}">${String(hh).padStart(2, '0')}:${mm ? '30' : '00'}</button>`);
      }
      slotsBox.innerHTML = out.join('');
      slotsBox.querySelectorAll('[data-slot]:not([disabled])').forEach(b => b.addEventListener('click', ()=>{ slot = b.dataset.slot; drawSlots(); }));
      if (!slotsBox.querySelector('[data-slot]:not([disabled])')) slotsBox.innerHTML = '<span style="color:var(--ink-soft);font-size:.88rem">אין שעות פנויות ביום הזה. בחרו יום אחר.</span>';
    }
    drawDays(); drawSlots();

    sec.querySelectorAll('.pick input').forEach(cb => cb.addEventListener('change', ()=>{
      cb.checked ? chosen.add(cb.value) : chosen.delete(cb.value);
    }));
    sec.querySelector('[data-send]').addEventListener('click', async e => {
      if (!chosen.size) return toast('סמנו לפחות נכס אחד');
      if (!slot) return toast('בחרו שעה');
      e.target.disabled = true;
      try {
        const res = await call('meeting', { item_ids: [...chosen], starts_at: slot, note: sec.querySelector('textarea').value });
        state.meetings.push(res.meeting);
        render();
        toast('הבקשה נשלחה. נעדכן כאן כשהסיור יאושר.');
      } catch(err){
        toast(errorText(err.code));
        e.target.disabled = false;
        if (err.code === 'slot_taken') load();
      }
    });
    return sec;
  }

  load();
})();

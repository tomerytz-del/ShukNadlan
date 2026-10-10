/* ==========================================================================
   המיניסייט האישי ללקוח/ה - הצד של הסוכן/ת ב-CRM

   שלושה מקומות:

   1. **פאנל ההתאמות** בכרטיס הלקוח/ה - תיבת סימון בכל התאמה, ופס
      "שליחה למיניסייט". הנכסים נכנסים דרך `showcase_add_properties()`
      במסד, שבודקת שכל נכס במאגר של הסוכן/ת (המשרד + מה ששותף איתו).
   2. **חלון השליחה** - הודעה אישית, ואחרי השליחה: בדיקת לוגו בתמונות של
      הנכסים (‏client-showcase, ‏action=scan), והקישור לשליחה בוואטסאפ.
   3. **פאנל המיניסייט** בכרטיס - מה אהב/ה, מה פסל/ה ולמה, ההודעות לכל נכס
      עם תשובה, ובקשות הסיור עם אישור/דחייה (‏`showcase_decide_meeting()`,
      שגם רושמת ביומן).

   הקובץ נטען **לפני** `crm.js` ומגדיר פונקציות בלבד: `sb`, `currentAgent`,
   ‏`esc`, `showToast`, `shekel`, `plural`, `waLink` ו-`addCardAction` נקראים
   בזמן ריצה. מסד שהמיגרציה עוד לא רצה בו: הטעינה נכשלת בשקט, ופשוט אין
   תיבות סימון ואין פאנל. ‏docs/client-showcase.md
   ========================================================================== */

const SHOWCASE_FN_PATH = '/functions/v1/client-showcase';
const SHOWCASE_REASON_LABELS = {
  price:'מחיר', location:'מיקום', size:'גודל', condition:'מצב הנכס',
  layout:'חלוקה', floor:'קומה', photos:'התמונות', other:'אחר',
};

let showcaseSummaries = {};   // client_id → סיכום המיניסייט הפעיל
let showcaseReady = false;    // false = הטבלאות עוד לא קיימות במסד

function showcaseUrl(token, preview){
  return location.origin + '/showcase?t=' + encodeURIComponent(token) + (preview ? '&preview=1' : '');
}

/* שורת אזהרה לחלון האישור לפני סגירה או מחיקה של לקוח/ה. הסגירה עצמה נעשית
   במסד (הטריגר agent_clients_close_showcase, ובמחיקה on delete cascade) -
   כאן רק אומרים לסוכן/ת מראש שהקישור שנשלח יפסיק לעבוד. */
function showcaseCloseWarning(clientId){
  const s = showcaseSummaries[clientId];
  if (!s) return '';
  const seen = s.view_count ? ` (נצפה ${plural(s.view_count, 'פעם אחת', 'פעמים')})` : '';
  return `\n\nגם המיניסייט של הלקוח/ה${seen} ייסגר, והקישור שנשלח אליו/ה יפסיק לעבוד.`;
}

/* ---------- סיכום לכל הלקוחות - קריאה אחת ---------- */
async function loadShowcaseSummaries(){
  showcaseSummaries = {};
  try {
    const { data, error } = await sb
      .from('client_showcases')
      .select('id, client_id, token, intro, view_count, last_viewed_at, created_at,'
        + ' wa_notify, wa_pending_at, wa_last_sent_at, wa_last_status, wa_last_error,'
        + ' client_showcase_items(property_id, reaction, removed_at, coop_status),'
        + ' client_showcase_messages(author, read_at),'
        + ' client_showcase_meetings(status, starts_at)')
      .eq('status', 'active');
    if (error) throw error;
    showcaseReady = true;
    (data || []).forEach(s => {
      const items = (s.client_showcase_items || []).filter(i => !i.removed_at);
      const now = Date.now();
      showcaseSummaries[s.client_id] = {
        id: s.id, token: s.token, intro: s.intro || '',
        wa: { notify: s.wa_notify !== false, pending: s.wa_pending_at, sent: s.wa_last_sent_at, status: s.wa_last_status, error: s.wa_last_error },
        view_count: s.view_count, last_viewed_at: s.last_viewed_at,
        property_ids: new Set(items.map(i => i.property_id)),
        liked: items.filter(i => i.reaction === 'liked').length,
        disliked: items.filter(i => i.reaction === 'disliked').length,
        pending: items.filter(i => !i.reaction).length,
        unread: (s.client_showcase_messages || []).filter(m => m.author === 'client' && !m.read_at).length,
        coop: items.filter(i => i.coop_status === 'needed').length,
        requested: (s.client_showcase_meetings || [])
          .filter(m => m.status === 'requested' && new Date(m.starts_at).getTime() > now).length,
      };
    });
  } catch (err){
    // ‏Netlify מפרסם את ה-HTML לפני שהמיגרציה רצה ב-Actions
    showcaseReady = false;
    console.warn('המיניסייט אינו זמין:', err && err.message);
  }
}

function showcasePillHtml(clientId){
  const s = showcaseSummaries[clientId];
  if (!s) return '';
  const hot = s.unread || s.requested || s.coop;
  const bits = [
    s.liked && `❤️ ${s.liked}`,
    s.unread && `💬 ${s.unread}`,
    s.requested && '📅 סיור',
    s.coop && '🤝 לתאם',
  ].filter(Boolean).join(' ');
  return `<span class="status-pill ${hot ? 'sc-hot' : 'status-shared'}" title="המיניסייט של הלקוח/ה">🌐 ${esc(bits || (s.view_count ? 'נצפה' : 'נשלח'))}</span>`;
}

/* ---------- 1. פאנל ההתאמות ---------- */

/* נקרא מ-renderClientMatches אחרי שהפאנל נבנה. מחזיק את הבחירה על הפאנל
   עצמו (‏panel._showcase), כי renderMatchCards מצייר מחדש בכל החלפת סינון
   והבחירה חייבת לשרוד את זה. */
function showcaseMatchTools(panel, rows, client){
  if (!showcaseReady || !client) return;
  const already = (showcaseSummaries[client.id] || {}).property_ids || new Set();
  const ctx = panel._showcase || { selected: new Set(), client, already };
  ctx.client = client;
  ctx.already = already;
  ctx.rows = rows;
  panel._showcase = ctx;

  let bar = panel.querySelector('.sc-bar');
  if (!bar){
    bar = document.createElement('div');
    bar.className = 'sc-bar';
    panel.insertBefore(bar, panel.firstChild);
  }
  ctx.sync = ()=>{
    const n = ctx.selected.size;
    bar.innerHTML = `
      <span class="sc-bar-text">🌐 <b>מיניסייט ללקוח/ה</b> - ${n ? `נבחרו ${plural(n, 'נכס אחד', 'נכסים')}` : 'סמנו נכסים לשליחה'}</span>
      <span class="sc-bar-actions">
        <button type="button" class="btn btn-ghost" data-sc-all>סימון הכול</button>
        <button type="button" class="btn btn-gold" data-sc-send ${n ? '' : 'disabled'}>📨 שליחה</button>
      </span>`;
    bar.querySelector('[data-sc-all]').addEventListener('click', ()=>{
      const fresh = ctx.rows.filter(m => !ctx.already.has(m.property_id));
      const all = fresh.every(m => ctx.selected.has(m.property_id));
      fresh.forEach(m => all ? ctx.selected.delete(m.property_id) : ctx.selected.add(m.property_id));
      panel.querySelectorAll('.sc-pick input').forEach(cb => { cb.checked = ctx.selected.has(cb.value); });
      ctx.sync();
    });
    bar.querySelector('[data-sc-send]').addEventListener('click', ()=> openShowcaseSend(ctx.client, [...ctx.selected], ()=>{
      ctx.selected.clear();
      ctx.already = (showcaseSummaries[ctx.client.id] || {}).property_ids || new Set();
      panel.querySelectorAll('.sc-pick').forEach(l => {
        const cb = l.querySelector('input');
        if (ctx.already.has(cb.value)) l.outerHTML = '<span class="sc-in">✓ במיניסייט</span>';
        else cb.checked = false;
      });
      ctx.sync();
    }));
  };
  ctx.sync();
}

/* נקרא מ-renderMatchCards לכל כרטיס */
function showcaseDecorateMatch(card, m, ctx){
  if (!ctx) return;
  const head = card.querySelector('.match-head');
  if (!head) return;
  if (ctx.already.has(m.property_id)){
    head.insertAdjacentHTML('beforeend', '<span class="sc-in" title="הנכס כבר במיניסייט של הלקוח/ה">✓ במיניסייט</span>');
    return;
  }
  const label = document.createElement('label');
  label.className = 'sc-pick';
  // "בחירה" ולא "למיניסייט": הכפתור "➕ למיניסייט" בתחתית הכרטיס שולח את
  // הנכס הזה לבדו, והתיבה אוספת כמה נכסים לשליחה אחת מהפס שלמעלה
  label.title = 'סימון לשליחה של כמה נכסים יחד למיניסייט';
  label.innerHTML = `<input type="checkbox" value="${esc(m.property_id)}" ${ctx.selected.has(m.property_id) ? 'checked' : ''}> בחירה`;
  label.querySelector('input').addEventListener('change', e => {
    e.target.checked ? ctx.selected.add(m.property_id) : ctx.selected.delete(m.property_id);
    ctx.sync();
  });
  head.appendChild(label);
}

/* ---------- 2. חלון השליחה ---------- */
function showcaseModal(){ return document.getElementById('showcaseModal'); }
function closeShowcaseModal(){ const m = showcaseModal(); if (m) m.style.display = 'none'; }

function openShowcaseSend(client, propertyIds, onDone){
  const modal = showcaseModal();
  if (!modal || !propertyIds.length) return;
  const existing = showcaseSummaries[client.id];
  const count = propertyIds.length;
  modal.querySelector('.pm-card').innerHTML = `
    <div class="pm-title">שליחה למיניסייט של ${esc(client.full_name)}</div>
    <p class="exp-note">${existing
      ? `${plural(count, 'נכס אחד יתווסף', 'נכסים יתווספו')} למיניסייט הקיים - הלקוח/ה יראה/תראה אותם באותו קישור.`
      : `ייפתח מיניסייט אישי עם ${plural(count, 'נכס אחד', 'נכסים')}. הלקוח/ה יוכל/תוכל לסמן מה אהב/ה, לשאול על כל נכס ולבקש סיור.`}</p>
    <div class="field">
      <label for="scIntro">הודעה אישית בראש המיניסייט (לא חובה)</label>
      <textarea id="scIntro" rows="3" maxlength="1000" placeholder="למשל: בחרתי בשבילך כמה דירות שעונות על מה שדיברנו. את הראשונה כדאי לראות השבוע.">${esc(existing ? existing.intro : '')}</textarea>
    </div>
    <p class="exp-note">🔒 המיניסייט ממותג במשרד שלך ובפרטים שלך, והנכסים עצמם <b>בלי מיתוג</b>: אין בהם שם משרד, סוכן/ת, טלפון או מספר בית, ותמונה עם לוגו או סימן מים מוסתרת אוטומטית. כך הלקוח/ה אינו/ה יכול/ה לדעת איזה נכס הגיע בשת"פ.</p>
    <div class="pm-actions">
      <button type="button" class="btn btn-ghost" data-close>ביטול</button>
      <button type="button" class="btn btn-gold" data-go>יצירת הקישור</button>
    </div>`;
  modal.style.display = 'flex';
  modal.querySelector('[data-close]').addEventListener('click', closeShowcaseModal);
  modal.querySelector('[data-go]').addEventListener('click', async e => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'יוצר…';
    const { data, error } = await sb.rpc('showcase_add_properties', {
      p_client_id: client.id,
      p_property_ids: propertyIds,
      p_intro: modal.querySelector('#scIntro').value,
    });
    if (error || !data || data.error){
      btn.disabled = false; btn.textContent = 'יצירת הקישור';
      showToast('לא הצלחנו ליצור את המיניסייט: ' + heErr((data && data.error) || error));
      return;
    }
    await loadShowcaseSummaries();
    if (typeof onDone === 'function') onDone();
    renderShowcaseShare(client, data, true);
    refreshClientCardPill(client);
  });
}

async function showcaseScan(showcaseId){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error:'no_session' };
  try {
    const res = await fetch(SUPABASE_URL + SHOWCASE_FN_PATH, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey: SUPABASE_ANON_KEY, Authorization:'Bearer ' + session.access_token },
      body: JSON.stringify({ action:'scan', showcase_id: showcaseId }),
    });
    return await res.json();
  } catch (err){
    return { error: err.message };
  }
}

function scanSummaryText(r){
  if (!r || r.error) return '⚠️ בדיקת הלוגו לא הושלמה. תמונות שלא נבדקו מוסתרות עד שהבדיקה תעבור.';
  if (!r.properties) return '';
  const parts = [`🔍 נבדקו התמונות של ${plural(r.properties, 'נכס אחד', 'נכסים')}`];
  if (r.branded) parts.push(`${plural(r.branded, 'תמונה אחת עם לוגו הוסתרה', 'תמונות עם לוגו הוסתרו')}`);
  if (r.pending) parts.push(`${plural(r.pending, 'תמונה אחת טרם נבדקה ומוסתרת', 'תמונות טרם נבדקו ומוסתרות')}`);
  return parts.join(' · ');
}

async function renderShowcaseShare(client, sc, scan){
  const modal = showcaseModal();
  const link = showcaseUrl(sc.token);
  const first = String(client.full_name || '').trim().split(/\s+/)[0] || '';
  /* ההודעה הראשונה מסבירה מה הקישור: עמוד אישי שזמין תמיד, שמתעדכן כשנכנסים
     נכסים חדשים, ושאפשר לשתף עם מי שמחליט/ה יחד (בן/בת זוג, הורים). */
  const text = `היי ${first}, ריכזתי בשבילך עמוד אישי עם הנכסים שמתאימים למה שחיפשת:\n${link}\n\n`
    + `הקישור הזה שלך וזמין תמיד - אפשר לחזור אליו מתי שנוח, לראות את הנכסים שמעניינים אותך, לסמן מה אהבת ומה לא, לשאול על כל נכס ולבקש סיור. `
    + `נכסים חדשים שאמצא יתווספו לאותו עמוד.\n\n`
    + `רוצה להתייעץ? אפשר לשתף את העמוד עם בן/בת הזוג או המשפחה, והם יראו בדיוק את מה שאת/ה רואה.`;
  const wa = waLink(client.phone);
  modal.querySelector('.pm-card').innerHTML = `
    <div class="pm-title">✅ המיניסייט מוכן</div>
    ${sc.added != null ? `<p class="exp-note">${plural(sc.added, 'נכס אחד נוסף', 'נכסים נוספו')}${sc.skipped ? ` · ${plural(sc.skipped, 'נכס אחד דולג', 'נכסים דולגו')} (כבר במיניסייט או לא זמין)` : ''}</p>` : ''}
    <div class="field">
      <label for="scLink">הקישור האישי של ${esc(client.full_name)}</label>
      <input id="scLink" type="text" readonly value="${esc(link)}" dir="ltr">
    </div>
    <p class="exp-note" id="scScan">${scan ? '🔍 בודק לוגואים וסימני מים בתמונות…' : ''}</p>
    <div class="pm-actions" style="flex-wrap:wrap">
      <button type="button" class="btn btn-ghost" data-close>סגירה</button>
      <a class="btn btn-ghost" href="${esc(showcaseUrl(sc.token, true))}" target="_blank" rel="noopener noreferrer">👁 תצוגה מקדימה</a>
      <button type="button" class="btn btn-ghost" data-copy>📋 העתקה</button>
      ${wa ? `<a class="btn btn-gold" href="${esc(wa + '?text=' + encodeURIComponent(text))}" target="_blank" rel="noopener noreferrer">💬 שליחה בוואטסאפ</a>` : ''}
    </div>`;
  modal.style.display = 'flex';
  modal.querySelector('[data-close]').addEventListener('click', closeShowcaseModal);
  modal.querySelector('[data-copy]').addEventListener('click', async ()=>{
    try { await navigator.clipboard.writeText(text); showToast('ההודעה והקישור הועתקו'); }
    catch(_){ modal.querySelector('#scLink').select(); }
  });
  if (scan){
    const r = await showcaseScan(sc.showcase_id || sc.id);
    const el = modal.querySelector('#scScan');
    if (el) el.textContent = scanSummaryText(r);
  }
}

function refreshClientCardPill(client){
  const card = document.querySelector(`[data-client-card="${CSS.escape(client.id)}"]`);
  const slot = card && card.querySelector('.sc-pill-slot');
  if (slot) slot.innerHTML = showcasePillHtml(client.id);
}

/* ---------- 3. פאנל המיניסייט בכרטיס ---------- */

/* כפתור בכרטיס הלקוח/ה. נקרא מ-buildClientCard. */
function addShowcaseAction(actions, el, client){
  if (!showcaseReady) return;
  const s = showcaseSummaries[client.id];
  const panel = document.createElement('div');
  panel.className = 'sc-panel';
  panel.hidden = true;
  el.appendChild(panel);
  addCardAction(actions, {
    label: s ? '🌐 המיניסייט' + ((s.unread || s.requested) ? ' •' : '') : '🌐 מיניסייט',
    title: 'הנכסים ששלחת ללקוח/ה, מה אהב/ה, הודעות ובקשות סיור',
    onClick: ()=>{
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderShowcasePanel(client, panel);
    },
  });
}

async function renderShowcasePanel(client, panel){
  const s = showcaseSummaries[client.id];
  if (!s){
    panel.innerHTML = '<div class="lead-meta">עדיין לא נשלח מיניסייט. פתחו את ההתאמות, סמנו נכסים ולחצו "📨 שליחה".</div>';
    return;
  }
  panel.innerHTML = '<div class="lead-meta">טוען…</div>';

  const [items, msgs, meets, agr, owners] = await Promise.all([
    sb.from('client_showcase_items')
      .select('id, property_id, source, agent_note, reaction, reaction_reasons, reacted_at, removed_at, coop_status,'
        + ' properties(property_type, deal_type, price, rooms, city, street, house_number, status)')
      .eq('showcase_id', s.id).is('removed_at', null).order('position'),
    sb.from('client_showcase_messages').select('id, item_id, author, body, created_at, read_at')
      .eq('showcase_id', s.id).order('created_at'),
    sb.from('client_showcase_meetings').select('id, property_ids, starts_at, note, status, agent_note')
      .eq('showcase_id', s.id).neq('status', 'canceled').order('starts_at'),
    sb.from('agreements').select('id').eq('status', 'signed').in('kind', ['buy', 'tenant'])
      .contains('client_ids', [client.id]).limit(1),
    // המתווך/ת המקורי/ת של כל נכס בשת"פ - מה ש-shared_properties_for_me
    // חושף ממילא למשרד שקיבל את השת"פ, ושאיתו/ה מתאמים
    sb.from('shared_properties_for_me').select('property_id, owner_agent_name, owner_agent_phone, owner_agency_name'),
  ]);
  if (items.error){ panel.innerHTML = '<div class="lead-meta">שגיאה בטעינת המיניסייט: ' + esc(heErr(items.error)) + '</div>'; return; }

  const rows = items.data || [];
  const messages = msgs.data || [];
  const meetings = meets.data || [];
  const hasAgreement = (agr.data || []).length > 0;
  const ownerByProp = new Map((owners.data || []).map(o => [o.property_id, o]));
  const COOP_LABELS = { needed:'לתאם', contacted:'פניתי', agreed:'סוכם', declined:'לא יצא' };
  const byProp = new Map(rows.map(r => [r.property_id, r]));
  const propText = r => {
    const p = r.properties || {};
    return [p.property_type || 'נכס', [p.street, p.house_number].filter(Boolean).join(' '), p.city].filter(Boolean).join(', ');
  };
  const fmt = iso => new Date(iso).toLocaleString('he-IL', { weekday:'short', day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' });

  const groups = [
    ['liked', '❤️ אהב/ה', rows.filter(r => r.reaction === 'liked')],
    ['pending', '⏳ טרם הגיב/ה', rows.filter(r => !r.reaction)],
    ['disliked', '✕ לא אהב/ה', rows.filter(r => r.reaction === 'disliked')],
  ];

  const thread = itemId => {
    const list = messages.filter(m => (m.item_id || null) === (itemId || null));
    return `<div class="sc-thread">
      ${list.map(m => `<div class="sc-msg ${m.author}"><span>${esc(m.body)}</span><time>${esc(fmt(m.created_at))}</time></div>`).join('')}
      <form class="sc-reply" data-item="${esc(itemId || '')}">
        <input type="text" maxlength="1000" placeholder="${list.length ? 'תשובה…' : (itemId ? 'הודעה על הנכס הזה…' : 'הודעה כללית ללקוח/ה…')}">
        <button type="submit" class="btn btn-ghost">שליחה</button>
      </form>
    </div>`;
  };

  panel.innerHTML = `
    <div class="sc-head">
      ${waStatusHtml(s.wa, fmt)}
      <div class="lead-meta">${s.view_count ? `👁 נצפה ${plural(s.view_count, 'פעם אחת', 'פעמים')} · לאחרונה ${esc(fmt(s.last_viewed_at))}` : 'הלקוח/ה עדיין לא פתח/ה את הקישור'}</div>
      <div class="lead-actions">
        <button type="button" class="btn btn-ghost" data-share>🔗 הקישור</button>
        <a class="btn btn-ghost" href="${esc(showcaseUrl(s.token, true))}" target="_blank" rel="noopener noreferrer">👁 תצוגה מקדימה</a>
        <button type="button" class="btn btn-ghost" data-scan>🔍 בדיקת לוגו</button>
        <button type="button" class="btn btn-ghost" data-close-sc>סגירת המיניסייט</button>
      </div>
    </div>
    ${meetings.length ? `<div class="sc-sec"><div class="sc-sec-title">📅 בקשות סיור</div>
      ${!hasAgreement && meetings.some(m => m.status === 'requested') ? `<div class="sc-warn">אין הזמנת שירותי תיווך חתומה עם ${esc(client.full_name)}. לפי חוק המתווכים, בלי הזמנה חתומה אין זכאות לדמי תיווך - כדאי להחתים לפני הסיור.
        <button type="button" class="btn btn-ghost" data-sign>✍️ החתמה</button></div>` : ''}
      ${meetings.some(m => m.status === 'requested' && (m.property_ids || []).some(pid => {
          const r = byProp.get(pid);
          return r && r.source === 'shared' && r.coop_status !== 'agreed';
        })) ? '<div class="sc-warn">🤝 הסיור כולל נכס בשת"פ שטרם תואם עם המתווך/ת המקורי/ת. כדאי לסגור את השת"פ לפני שמאשרים מועד.</div>' : ''}
      ${meetings.map(m => `<div class="sc-meet">
        <div><b>${esc(fmt(m.starts_at))}</b> · ${esc((m.property_ids || []).map(pid => byProp.get(pid)).filter(Boolean).map(propText).join(' · '))}
          ${m.note ? `<div class="lead-meta">💬 ${esc(m.note)}</div>` : ''}
          ${m.agent_note ? `<div class="lead-meta">התשובה שלך: ${esc(m.agent_note)}</div>` : ''}</div>
        <div class="sc-meet-act">${m.status === 'requested'
          ? `<button type="button" class="btn btn-gold" data-meet="${esc(m.id)}" data-ok="1">אישור</button>
             <button type="button" class="btn btn-ghost" data-meet="${esc(m.id)}" data-ok="0">מועד אחר</button>`
          : `<span class="status-pill ${m.status === 'confirmed' ? 'status-unlocked' : 'status-shared'}">${m.status === 'confirmed' ? 'מאושר' : 'נדחה'}</span>`}</div>
      </div>`).join('')}</div>` : ''}
    ${groups.map(([key, title, list]) => list.length ? `<div class="sc-sec"><div class="sc-sec-title">${title} <span class="lead-meta">(${list.length})</span></div>
      ${list.map(r => {
        const p = r.properties || {};
        const n = messages.filter(m => m.item_id === r.id).length;
        return `<div class="sc-item" data-row="${esc(r.id)}">
          <div class="sc-item-top">
            <div><b>${esc(propText(r))}</b> · ${esc(p.deal_type === 'rent' ? shekel(p.price) + ' לחודש' : shekel(p.price))}
              ${r.source === 'shared' ? '<span class="src-tag src-shared" title="הלקוח/ה אינו/ה רואה את פרטי המשרד">🤝 שת״פ - מוסתר</span>' : ''}
              ${p.status && p.status !== 'active' ? '<span class="status-pill status-shared">לא פעיל - מוסתר מהלקוח/ה</span>' : ''}</div>
            <div class="sc-item-act">
              <a class="btn btn-ghost" href="/property?id=${encodeURIComponent(r.property_id)}" target="_blank" rel="noopener noreferrer" title="עמוד הנכס">🏠</a>
              <button type="button" class="btn btn-ghost" data-note title="הערה שלך שהלקוח/ה רואה">✏️</button>
              <button type="button" class="btn btn-ghost" data-remove title="הסרה מהמיניסייט">🗑</button>
            </div>
          </div>
          ${r.reaction === 'disliked' && (r.reaction_reasons || []).length ? `<div class="match-gap">למה לא: ${esc(r.reaction_reasons.map(k => SHOWCASE_REASON_LABELS[k] || k).join(', '))}</div>` : ''}
          ${r.agent_note ? `<div class="lead-meta">📝 ${esc(r.agent_note)}</div>` : ''}
          ${coopBlockHtml(r, ownerByProp.get(r.property_id), COOP_LABELS)}
          <details ${n ? 'open' : ''}><summary class="lead-meta">💬 ${n ? plural(n, 'הודעה אחת', 'הודעות') : 'הודעה על הנכס'}</summary>${thread(r.id)}</details>
        </div>`;
      }).join('')}</div>` : '').join('')}
    <div class="sc-sec"><div class="sc-sec-title">💬 הודעות כלליות</div>${thread(null)}</div>
    ${dislikeInsightHtml(rows)}`;

  // סימון הודעות הלקוח/ה כנקראו - הפאנל נפתח, הסוכן/ת רואה אותן
  const unreadIds = messages.filter(m => m.author === 'client' && !m.read_at).map(m => m.id);
  if (unreadIds.length){
    sb.from('client_showcase_messages').update({ read_at: new Date().toISOString() }).in('id', unreadIds)
      .then(()=>{ s.unread = 0; refreshClientCardPill(client); });
  }

  const reload = async ()=>{ await loadShowcaseSummaries(); refreshClientCardPill(client); renderShowcasePanel(client, panel); };

  panel.querySelector('[data-share]').addEventListener('click', ()=>{
    renderShowcaseShare(client, { token: s.token, showcase_id: s.id }, false);
  });
  panel.querySelector('[data-scan]').addEventListener('click', async e => {
    e.target.disabled = true;
    const r = await showcaseScan(s.id);
    e.target.disabled = false;
    showToast(scanSummaryText(r) || 'אין במיניסייט נכסים של משרדים אחרים', 5000);
  });
  panel.querySelector('[data-close-sc]').addEventListener('click', async ()=>{
    if (!confirm('לסגור את המיניסייט? הקישור יפסיק לעבוד אצל הלקוח/ה. אפשר לפתוח חדש בכל עת מההתאמות.')) return;
    const { error } = await sb.from('client_showcases').update({ status:'closed', closed_at: new Date().toISOString() }).eq('id', s.id);
    if (error) return showToast('שגיאה: ' + heErr(error));
    showToast('המיניסייט נסגר');
    reload();
  });
  const sign = panel.querySelector('[data-sign]');
  if (sign && typeof openAgreementWizard === 'function'){
    sign.addEventListener('click', ()=> openAgreementWizard({ kind: client.deal_type === 'rent' ? 'tenant' : 'buy', clientId: client.id }));
  }
  panel.querySelectorAll('[data-meet]').forEach(b => b.addEventListener('click', async ()=>{
    const ok = b.dataset.ok === '1';
    const note = prompt(ok ? 'הודעה ללקוח/ה (לא חובה) - למשל נקודת מפגש:' : 'מה להציע במקום? (הלקוח/ה יראה/תראה את זה במיניסייט)');
    if (note === null) return;
    const { data, error } = await sb.rpc('showcase_decide_meeting', { p_meeting_id: b.dataset.meet, p_confirm: ok, p_note: note });
    if (error || (data && data.error)) return showToast('שגיאה: ' + heErr((data && data.error) || error));
    const waNote = s.wa && s.wa.notify ? ' · הלקוח/ה יקבל/תקבל עדכון בוואטסאפ' : '';
    showToast((ok ? (data && data.agenda_item_id ? 'הסיור אושר ונרשם ביומן' : 'הסיור אושר') : 'נשלחה תשובה ללקוח/ה') + waNote, 4500);
    reload();
  }));
  panel.querySelectorAll('.sc-item').forEach(row => {
    const id = row.dataset.row;
    const r = rows.find(x => x.id === id);
    row.querySelectorAll('[data-coop]').forEach(b => b.addEventListener('click', async ()=>{
      const { error } = await sb.from('client_showcase_items')
        .update({ coop_status: b.dataset.coop, coop_updated_at: new Date().toISOString() }).eq('id', id);
      if (error) return showToast('שגיאה: ' + heErr(error));
      reload();
    }));
    row.querySelector('[data-note]').addEventListener('click', async ()=>{
      const note = prompt('הערה שהלקוח/ה יראה/תראה מעל הנכס (למשל: "המחיר גמיש, הבעלים ממהרים"):', r.agent_note || '');
      if (note === null) return;
      const { error } = await sb.from('client_showcase_items').update({ agent_note: note.trim().slice(0, 600) || null }).eq('id', id);
      if (error) return showToast('שגיאה: ' + heErr(error));
      reload();
    });
    row.querySelector('[data-remove]').addEventListener('click', async ()=>{
      if (!confirm('להסיר את הנכס מהמיניסייט?')) return;
      const { error } = await sb.from('client_showcase_items').update({ removed_at: new Date().toISOString() }).eq('id', id);
      if (error) return showToast('שגיאה: ' + heErr(error));
      reload();
    });
  });
  panel.querySelectorAll('.sc-reply').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    const input = form.querySelector('input');
    const body = input.value.trim();
    if (!body) return;
    const { error } = await sb.from('client_showcase_messages')
      .insert({ showcase_id: s.id, item_id: form.dataset.item || null, author:'agent', body });
    if (error) return showToast('שגיאה: ' + heErr(error));
    showToast(s.wa && s.wa.notify ? 'נשלח. הלקוח/ה יקבל/תקבל עדכון בוואטסאפ עם קישור לתשובה' : 'נשלח. הלקוח/ה יראה/תראה את זה במיניסייט');
    reload();
  }));
}

/* ---------- הוואטסאפ ללקוח/ה ----------
   תשובה ואישור סיור יוצאים ללקוח/ה בוואטסאפ דרך תור במסד (‏20270209090000):
   הודעה אחת לרצף, 08:00-22:00, ולא אם כבר פתח/ה את העמוד. השורה כאן אומרת
   לסוכן/ת מה קרה עם העדכון האחרון - בלעדיה "שלחתי לו" ו"זה לא הגיע" נראים
   אותו דבר. */
function waStatusHtml(wa, fmt){
  if (!wa) return '';
  if (!wa.notify) return '<div class="lead-meta">📲 הלקוח/ה כיבה/תה עדכונים בוואטסאפ - כדאי להודיע לו/ה ישירות</div>';
  if (wa.pending) return '<div class="lead-meta">📲 עדכון בוואטסאפ ממתין לשליחה (עד 5 דקות, ובלילה - בבוקר)</div>';
  const label = {
    sent: wa.sent ? '📲 עדכון אחרון נשלח בוואטסאפ ב-' + fmt(wa.sent) : '',
    seen: '📲 הלקוח/ה ראה/תה את העדכון האחרון בעמוד לפני שנשלח וואטסאפ',
    no_channel: '⚠️ העדכון האחרון לא נשלח בוואטסאפ - תבנית ההודעה עדיין לא אושרה ב-Meta. כדאי להודיע ללקוח/ה ישירות',
    no_phone: '⚠️ אין מספר טלפון תקין בכרטיס - העדכון לא נשלח בוואטסאפ',
    opted_out: '⚠️ הלקוח/ה חסם/ה הודעות מהעסק בוואטסאפ - כדאי להודיע לו/ה ישירות',
    failed: '⚠️ שליחת הוואטסאפ האחרונה נכשלה - כדאי להודיע ללקוח/ה ישירות',
  }[wa.status];
  return label ? `<div class="lead-meta" title="${esc(wa.error || '')}">${esc(label)}</div>` : '';
}

/* ---------- תיאום שת"פ ----------
   הלקוח/ה אהב/ה נכס של משרד אחר - ולא יודע/ת שהוא כזה. מכאן זה עבודה של
   הסוכן/ת: לפנות למתווך/ת המקורי/ת, לסגור שת"פ, ורק אז לתאם סיור. הבלוק
   מופיע בכל פריט שת"פ שאהב/ה, או שכבר יש לו סטטוס. */
function coopBlockHtml(r, owner, labels){
  if (r.source !== 'shared' || !(r.reaction === 'liked' || r.coop_status)) return '';
  const p = r.properties || {};
  const status = r.coop_status || 'needed';
  const where = [p.street, p.city].filter(Boolean).join(', ');
  const wa = owner && owner.owner_agent_phone && waLink(owner.owner_agent_phone);
  const text = `היי${owner && owner.owner_agent_name ? ' ' + owner.owner_agent_name.split(' ')[0] : ''}, יש לי לקוח/ה שאהב/ה את הנכס שלך${where ? ' ב' + where : ''} (שת"פ בשוק נדל״ן). נתאם שת"פ וסיור?`;
  return `<div class="sc-coop sc-coop-${esc(status)}">
    <div><b>🤝 תיאום שת"פ</b> · <span class="sc-coop-st">${esc(labels[status] || status)}</span></div>
    ${owner ? `<div class="lead-meta">${esc([owner.owner_agent_name, owner.owner_agency_name].filter(Boolean).join(' · '))}${owner.owner_agent_phone ? ' · ' + esc(owner.owner_agent_phone) : ''}</div>`
      : '<div class="lead-meta">השת"פ על הנכס כבר אינו פעיל - הלקוח/ה אינו/ה רואה אותו יותר.</div>'}
    <div class="sc-coop-act">
      ${owner && owner.owner_agent_phone ? `<a class="btn btn-ghost" href="tel:${esc(String(owner.owner_agent_phone).replace(/[^\d+]/g, ''))}">📞 חיוג</a>` : ''}
      ${wa ? `<a class="btn btn-ghost" href="${esc(wa + '?text=' + encodeURIComponent(text))}" target="_blank" rel="noopener noreferrer">💬 וואטסאפ</a>` : ''}
      ${['contacted', 'agreed', 'declined'].map(k => `<button type="button" class="btn ${status === k ? 'btn-gold' : 'btn-ghost'}" data-coop="${k}">${esc(labels[k])}</button>`).join('')}
    </div>
  </div>`;
}

/* ‏"למה לא" מצטבר: שלוש פסילות על מחיר אומרות משהו על התקציב שבכרטיס.
   זה לא משנה את הדרישות לבד - רק אומר את זה בקול, ליד כפתור העריכה. */
function dislikeInsightHtml(rows){
  const counts = {};
  rows.filter(r => r.reaction === 'disliked').forEach(r => (r.reaction_reasons || []).forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
  const top = Object.entries(counts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  if (!top.length) return '';
  const hint = { price:'אולי התקציב בכרטיס גבוה ממה שנוח ללקוח/ה', location:'כדאי לחדד את הערים או השכונות', size:'כדאי לעדכן את המ״ר המינימלי', floor:'כדאי לעדכן את הקומה המקסימלית', layout:'כדאי לשאול מה חסר בחלוקה' };
  return `<div class="sc-insight">💡 ${top.map(([k, n]) => `${esc(SHOWCASE_REASON_LABELS[k] || k)} - ${n} פסילות${hint[k] ? ': ' + esc(hint[k]) : ''}`).join(' · ')}</div>`;
}

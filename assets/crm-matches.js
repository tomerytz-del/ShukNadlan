/* ==========================================================================
   "התאמות חדשות" - מקובצות לפי לקוח/ה או לפי נכס
   --------------------------------------------------------------------------
   שלב 7 בעיצוב מחדש (סעיף 3.12; docs/client-matching.md, "התאמות חדשות").
   הנתונים הם אותו client_match_alerts_feed (loadClientAlerts ב-crm.js), והכרטיס
   המלא של התראה (buildAlertCard) נפתח ב"פרטים" - כאן רק הקיבוץ:

     · כרטיס לכל לקוח/ה עם מונה "5 חדשות", אחד פתוח בכל פעם (mtOpen)
     · בתוכו הנכסים, עם תיבת בחירה, תגית מקור, מחיר ו"% התאמה"
     · "שליחה ל<שם> בוואטסאפ (N)" - כמה נכסים בהודעה אחת (wa.me), והם
       מסומנים כנצפו. אין בשרת שליחה מרוכזת; ההודעה נפתחת אצל הסוכן/ת
     · "לפי נכס" - אותו רעיון הפוך: כרטיס לנכס, ובתוכו הלקוחות שהוא מתאים להם

   נטען לפני assets/crm.js; הפונקציות נקראות רק אחרי שהוא רץ.
   ========================================================================== */

let mtView = 'client';          // 'client' | 'property'
let mtOpen = null;              // מפתח הכרטיס הפתוח
const mtSelected = new Set();   // ids של התראות שסומנו לשליחה
const mtDetails = new Set();    // ids של התראות שה"פרטים" שלהן פתוחים

function mtGroups(){
  const map = new Map();
  alertRows.forEach(a => {
    const key = mtView === 'client' ? 'c:' + a.client_id : 'p:' + a.property_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  });
  const groups = [...map.entries()].map(([key, rows]) => ({
    key, rows: rows.slice().sort((x, y) => (y.score || 0) - (x.score || 0)),
    fresh: rows.filter(r => r.status === 'new').length,
  }));
  return groups.sort((a, b) => b.fresh - a.fresh || b.rows.length - a.rows.length);
}

function renderMatchesGrouped(){
  const listEl = document.getElementById('alertsList');
  const unseen = alertRows.filter(a => a.status === 'new').length;
  accSetCount('accAlerts', unseen ? plural(unseen, 'התראה אחת חדשה', 'חדשות') : '', unseen);
  document.getElementById('alertsMarkAll').hidden = unseen === 0;

  document.querySelectorAll('#mtView [data-mt-view]').forEach(b => {
    const on = b.dataset.mtView === mtView;
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('aria-selected', String(on));
  });
  document.getElementById('mtNewOnly').setAttribute('aria-pressed', String(alertScope() === 'new'));

  // פס הסיכום: כמה חדשות, לכמה לקוחות, ומי הכי הרבה
  const byClient = new Map();
  alertRows.filter(a => a.status === 'new').forEach(a => byClient.set(a.client_id, [...(byClient.get(a.client_id) || []), a]));
  const top = [...byClient.values()].sort((a, b) => b.length - a.length)[0];
  const summary = document.getElementById('mtSummary');
  summary.hidden = !unseen;
  if (unseen){
    document.getElementById('mtSummaryN').textContent = unseen;
    document.getElementById('mtSummaryT').innerHTML = escapeHtml(`ל-${plural(byClient.size, 'לקוח/ה אחד/ת', 'לקוחות')}.`)
      + (top && byClient.size > 1 ? ` הכי הרבה: <strong>${escapeHtml(top[0].client_name || 'לקוח/ה')}</strong> עם ${escapeHtml(plural(top.length, 'נכס אחד', 'נכסים'))}.` : '');
  }

  if (!alertRows.length){
    document.getElementById('alertsFilterCount').textContent = '';
    listEl.innerHTML = '<div class="empty-state">' +
      (alertScope() === 'new'
        ? 'אין התאמות חדשות. כשייכנס נכס שעונה על הדרישות של אחד הלקוחות בקובץ - הוא יופיע כאן.'
        : 'עדיין לא נפתחו התראות התאמה.') + '</div>';
    return;
  }

  const groups = mtGroups();
  if (mtOpen && !groups.some(g => g.key === mtOpen)) mtOpen = null;
  if (!mtOpen) mtOpen = groups[0].key;
  document.getElementById('alertsFilterCount').textContent = mtView === 'client'
    ? `${plural(alertRows.length, 'התאמה אחת', 'התאמות')} ל-${plural(groups.length, 'לקוח/ה אחד/ת', 'לקוחות')}`
    : `${plural(alertRows.length, 'התאמה אחת', 'התאמות')} ב-${plural(groups.length, 'נכס אחד', 'נכסים')}`;

  listEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ui-scope mt-list';
  groups.forEach(g => wrap.appendChild(mtGroupCard(g)));
  listEl.appendChild(wrap);
}

function mtInitials(name){
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('') || '?';
}

function mtGroupCard(g){
  const first = g.rows[0];
  const open = g.key === mtOpen;
  const byClient = mtView === 'client';
  const title = byClient ? (first.client_name || 'לקוח/ה')
    : (first.property_type || 'נכס') + ' · ' + (alertAddressLine(first) || first.title || '');
  const sub = byClient
    ? plural(g.rows.length, 'נכס אחד מתאים', 'נכסים מתאימים')
    : [shekel(first.price) + (first.deal_type === 'rent' ? ' לחודש' : ''), plural(g.rows.length, 'לקוח/ה אחד/ת', 'לקוחות')].join(' · ');
  const panelId = 'mtPanel-' + g.key.replace(/[^\w-]/g, '');
  const card = document.createElement('article');
  card.className = 'mt-card' + (open ? ' is-open' : '');
  card.innerHTML =
      `<button type="button" class="mt-head" aria-expanded="${open}" aria-controls="${panelId}">`
    + `<span class="mt-ava" aria-hidden="true">${byClient ? escapeHtml(mtInitials(first.client_name)) : '🏠'}</span>`
    + `<span class="mt-head-text"><span class="mt-name">${escapeHtml(title)}</span><span class="mt-sub">${escapeHtml(sub)}</span></span>`
    + (g.fresh ? `<span class="mt-count">${escapeHtml(plural(g.fresh, 'חדשה', 'חדשות'))}</span>` : '')
    + `<svg class="mt-chev" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>`
    + `</button><div class="mt-body" id="${panelId}"${open ? '' : ' hidden'}></div>`;
  card.querySelector('.mt-head').addEventListener('click', () => {
    mtOpen = open ? '' : g.key;
    renderMatchesGrouped();
  });
  if (open) mtFillBody(card.querySelector('.mt-body'), g);
  return card;
}

function mtFillBody(body, g){
  const byClient = mtView === 'client';
  g.rows.forEach(a => {
    const row = document.createElement('div');
    row.className = 'mt-row' + (a.status === 'new' ? ' is-new' : '');
    const sel = mtSelected.has(a.id);
    const src = a.source === 'shared' ? (a.listing_agency_name || 'משרד שותף')
      : a.source === 'own' ? 'שלך' : 'מהמשרד שלך';
    const label = byClient
      ? (a.property_type || 'נכס') + ' · ' + (alertAddressLine(a) || a.title || '')
      : (a.client_name || 'לקוח/ה');
    row.innerHTML =
        (byClient ? `<button type="button" class="mt-sel" aria-pressed="${sel}" aria-label="${escapeHtml((sel ? 'הסרה מהשליחה: ' : 'בחירה לשליחה: ') + label)}">`
          + '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></button>' : '')
      + `<span class="mt-row-text"><span class="mt-row-t">${escapeHtml(label)}</span>`
      + `<span class="mt-row-s"><span class="ui-tag ${a.source === 'shared' ? '' : 'ui-tag--navy'}">${escapeHtml(src)}</span>`
      + `<span>${escapeHtml(tabShortDate(a.created_at))}</span>${a.status === 'new' ? '<span class="mt-new">חדשה</span>' : ''}</span></span>`
      + `<span class="mt-row-end">${byClient ? `<span class="mt-price">${escapeHtml(shekel(a.price))}</span>` : ''}`
      + `<span class="mt-score">${escapeHtml(String(a.score || 0))}% התאמה</span></span>`
      + `<button type="button" class="ui-link mt-det" aria-expanded="${mtDetails.has(a.id)}">פרטים</button>`
      + `<div class="mt-row-card"${mtDetails.has(a.id) ? '' : ' hidden'}></div>`;
    row.querySelector('.mt-sel')?.addEventListener('click', () => {
      if (mtSelected.has(a.id)) mtSelected.delete(a.id); else mtSelected.add(a.id);
      renderMatchesGrouped();
    });
    const box = row.querySelector('.mt-row-card');
    if (mtDetails.has(a.id)) box.appendChild(buildAlertCard(a));
    row.querySelector('.mt-det').addEventListener('click', e => {
      const on = !mtDetails.has(a.id);
      if (on){ mtDetails.add(a.id); box.innerHTML = ''; box.appendChild(buildAlertCard(a)); }
      else { mtDetails.delete(a.id); box.innerHTML = ''; }
      box.hidden = !on;
      e.currentTarget.setAttribute('aria-expanded', String(on));
    });
    body.appendChild(row);
  });

  const foot = document.createElement('div');
  foot.className = 'mt-foot';
  const fresh = g.rows.filter(r => r.status === 'new');
  if (fresh.length){
    const seen = document.createElement('button');
    seen.type = 'button';
    seen.className = 'ui-link mt-seen';
    seen.textContent = 'סימון כנצפה';
    seen.addEventListener('click', () => mtMarkSeen(fresh.map(r => r.id), seen));
    foot.appendChild(seen);
  }
  if (byClient){
    const first = g.rows[0];
    const chosen = g.rows.filter(r => mtSelected.has(r.id));
    const wa = waLink(first.client_phone);
    const send = document.createElement('a');
    send.className = 'ui-btn mt-send' + (chosen.length && wa ? '' : ' is-off');
    const name = String(first.client_name || '').trim().split(/\s+/)[0] || 'ללקוח/ה';
    send.textContent = wa ? `שליחה ל${name} בוואטסאפ (${chosen.length})` : 'אין טלפון ללקוח/ה';
    if (chosen.length && wa){
      send.href = wa + '?text=' + encodeURIComponent(mtMessage(first, chosen));
      send.target = '_blank';
      send.rel = 'noopener';
      // אחרי השליחה הנכסים כבר אינם "חדשים" אצלי
      send.addEventListener('click', () => {
        const ids = chosen.filter(r => r.status === 'new').map(r => r.id);
        chosen.forEach(r => mtSelected.delete(r.id));
        if (ids.length) mtMarkSeen(ids);
      });
    } else {
      send.setAttribute('aria-disabled', 'true');
      send.title = wa ? 'סמנו נכסים לשליחה' : 'אין מספר טלפון בכרטיס הלקוח/ה';
    }
    foot.appendChild(send);
  }
  body.appendChild(foot);
}

/* הודעה אחת עם כל הנכסים שנבחרו - שם, כותרת, מחיר וקישור ציבורי לכל אחד */
function mtMessage(first, rows){
  const lines = [`שלום ${first.client_name || ''},`.replace(' ,', ','),
    rows.length === 1 ? 'מצאתי נכס שיכול להתאים למה שאתם מחפשים:' : `מצאתי ${rows.length} נכסים שיכולים להתאים למה שאתם מחפשים:`, ''];
  rows.forEach((a, i) => {
    const addr = alertAddressLine(a);
    lines.push(`${i + 1}. ${a.title || a.property_type || 'נכס'}${addr ? ' ב' + addr : ''} - ${a.deal_type === 'rent' ? shekel(a.price) + ' לחודש' : shekel(a.price)}`);
    lines.push(propertyPublicLink(a.property_id));
  });
  return lines.join('\n');
}

async function mtMarkSeen(ids, btn){
  if (!ids.length) return;
  if (btn) btn.disabled = true;
  const { error } = await sb.from('client_match_alerts')
    .update({ status:'seen', seen_at:new Date().toISOString() }).in('id', ids);
  if (btn) btn.disabled = false;
  if (error){ showToast('שגיאה בעדכון ההתראות: ' + heErr(error)); return; }
  if (alertScope() === 'new') alertRows = alertRows.filter(r => !ids.includes(r.id));
  else alertRows.forEach(r => { if (ids.includes(r.id)) r.status = 'seen'; });
  renderMatchesGrouped();
}

document.addEventListener('click', e => {
  const v = e.target.closest('#mtView [data-mt-view]');
  if (v){ mtView = v.dataset.mtView; mtOpen = null; renderMatchesGrouped(); return; }
  if (e.target.closest('#mtNewOnly')){
    const input = document.getElementById('alertScopeFilter');
    input.value = input.value === 'new' ? 'all' : 'new';
    loadClientAlerts();
  }
});

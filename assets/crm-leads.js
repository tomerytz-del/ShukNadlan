/* ==========================================================================
   "הלידים שלי" - רשימה אחת לפי סדר עדיפות
   --------------------------------------------------------------------------
   שלב 4 בעיצוב מחדש (סעיף 3.10; docs/leads-unified.md). מאז מיגרציה
   20270712090000 גם שיחה למספר וירטואלי וגם ליד שנרכש בחנות הם שורה ב-leads
   (lead_type 'call' / 'store'), ולכן יש לכולם שלב, ארכיון וזמן תגובה.

   **מה כאן ומה לא:** כאן הכרטיס העליון של כל ליד - מספר עדיפות, מקור בצבע,
   "למה עכשיו", מה זוהה בשיחה, פס השלבים והפעולות. הכרטיס המלא הקיים
   (buildLeadCard / buildLeadGroupTab ב-crm.js - פתיחת ליד נעול, הערה, הודעת
   וואטסאפ, בקשת חוות דעת, לידים של אותו/ה פונה) נפתח מתחת ב"פרטים", בלי
   שינוי. כל פתח פנייה קורא ל-markLeadResponded (הסקיל lead-card, כלל 2).

   סדר העדיפות: ליד בעלים ← ליד שנרכש ← שיחה ← פנייה מהאתר, ובתוך כל רמה
   החדש קודם. מוצגים 3, ו"עוד 3".

   הקובץ נטען לפני assets/crm.js; הפונקציות נקראות רק אחרי שהוא רץ.
   ========================================================================== */

const LEAD_SRC = {
  owner: { label:'ליד בעלים',   tone:'urgent', why:'בלעדיות שעומדת להיגמר' },
  store: { label:'חנות הלידים', tone:'navy',   why:'ליד ששילמת עליו' },
  call:  { label:'שיחה',        tone:'warn',   why:'התקשר/ה אליך' },
  prop:  { label:'דף נכס',      tone:'accent', why:'פנייה מהאתר' },
  agent: { label:'דף הסוכן',    tone:'accent', why:'פנייה מהדף שלך' },
  site:  { label:'האתר',        tone:'accent', why:'פנייה מהאתר' },
};
const LEAD_SRC_FILTERS = [['all', 'כל המקורות'], ['owner', 'לידי בעלים'], ['call', 'שיחות'], ['prop', 'דפי נכסים'], ['agent', 'דף הסוכן'], ['store', 'חנות הלידים']];
const LEAD_PRIO = { owner:0, store:1, call:2, prop:3, agent:3, site:3 };
/* ארבעה שלבים בפס (lead_work.stage). "לא רלוונטי" אינו בפס - הוא ארכוב */
const LEAD_BAR = [['new', 'חדש'], ['contacted', 'יצרתי קשר'], ['meeting', 'פגישה'], ['won', 'נסגר']];
const LEADS_STEP = 3;

let leadsTab = 'new';
let leadsSrc = 'all';
let leadsShown = LEADS_STEP;
let leadsOpenDetails = new Set();
let leadCallById = new Map();     // lead_id -> השיחה (לידי שיחה)

function leadSrcKey(l){
  if (l.lead_type === 'owner_inbound') return 'owner';
  if (l.lead_type === 'store') return 'store';
  if (l.lead_type === 'call') return 'call';
  if (l.source === 'agent_page' || l.source === 'agency_page') return 'agent';
  if (l.property_id || l.lead_type === 'property_inquiry' || l.lead_type === 'visualization') return 'prop';
  return 'site';
}

function leadStageOf(l){ return (leadWork.get(l.id) || {}).stage || 'new'; }

/* סוף הבלעדיות של ליד בעלים: יצירה + owner_lead_exclusivity_hours, ובלי
   חלון לליד שהגיע מהדף של הסוכן/ת או המשרד (claim_lead, 20261230090000) */
function leadExclusiveEnd(l){
  if (l.lead_type !== 'owner_inbound' || l.status === 'unlocked') return null;
  if (l.source === 'agent_page' || l.source === 'agency_page') return null;
  const end = new Date(l.created_at).getTime() + priceOf('owner_lead_exclusivity_hours', 12) * 3600e3;
  return end > Date.now() ? end : null;
}

function leadAgo(iso){
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600e3);
  if (h < 1) return 'לפני ' + Math.max(1, Math.round(ms / 60e3)) + ' דק׳';
  if (h < 24) return 'לפני ' + plural(h, 'שעה', 'שעות');
  return new Date(iso).toLocaleDateString('he-IL', { day:'numeric', month:'numeric' });
}

/* מה זוהה בשיחה - מ-agent_calls.extracted.needs (twilio-voice) */
function leadCallFacts(call){
  const n = (call && call.extracted && call.extracted.needs) || {};
  const out = [];
  if (n.deal_type === 'sale') out.push('קנייה');
  if (n.deal_type === 'rent') out.push('שכירות');
  (Array.isArray(n.cities) ? n.cities : []).slice(0, 2).forEach(c => out.push(c));
  if (n.min_rooms != null) out.push(n.min_rooms + ' חדרים');
  if (n.min_price != null || n.max_price != null){
    const lo = n.min_price != null ? shekelCompact(n.min_price) : '';
    const hi = n.max_price != null ? shekelCompact(n.max_price) : '';
    out.push(lo && hi ? `${lo}-${hi}` : (hi ? 'עד ' + hi : 'מ-' + lo));
  }
  return out;
}

function leadWants(l, call){
  if (call && call.extracted && call.extracted.needs_text) return call.extracted.needs_text;
  const parts = [l.deal_type === 'rent' ? 'השכרה' : l.deal_type === 'sale' ? 'מכירה' : '', l.property_type, l.city].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return (l.display_message || '').slice(0, 120);
}

/* השיחות של לידי השיחה - בקשה אחת, רק כשיש לידים כאלה */
async function loadLeadCalls(leads){
  const ids = leads.filter(l => l.lead_type === 'call').map(l => l.id);
  if (!ids.length){ leadCallById = new Map(); return; }
  const { data, error } = await sb.from('agent_calls')
    .select('id, lead_id, status, duration_sec, recording_path, summary, extracted, from_number, created_at')
    .in('lead_id', ids).order('created_at', { ascending:false });
  if (error){ leadCallById = new Map(); return; }
  leadCallById = new Map();
  (data || []).forEach(c => { if (!leadCallById.has(c.lead_id)) leadCallById.set(c.lead_id, c); });
}

/* ---------- הציור ---------- */
function renderLeadsUnified(agentId){
  const listEl = document.getElementById('leadsList');
  if (!listEl) return;
  const active = allLeads.filter(l => !archivedLeadIds.has(l.id));
  const archived = allLeads.filter(l => archivedLeadIds.has(l.id));
  const fresh = active.filter(l => leadStageOf(l) === 'new');
  const work = active.filter(l => leadStageOf(l) !== 'new');

  accSetCount('accLeads', fresh.length);
  syncLeadsSettings();
  renderClientsTop();
  accSetSummary('accLeads', active.length
    ? plural(active.length, 'ליד פתוח אחד', 'לידים פתוחים') + (fresh.length ? ' · ' + plural(fresh.length, 'אחד חדש', 'חדשים') : '')
    : '');

  // הלשוניות
  const counts = { new: fresh.length, work: work.length, archive: archived.length };
  document.querySelectorAll('#leadsTabs [data-leads-tab]').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.leadsTab === leadsTab));
    b.querySelector('[data-n]').textContent = counts[b.dataset.leadsTab];
  });

  const pool = leadsTab === 'archive' ? archived : leadsTab === 'work' ? work : fresh;

  // צ'יפים של מקור - רק מקורות שיש בהם משהו בלשונית הזו
  const srcCount = {};
  pool.forEach(l => { const k = leadSrcKey(l); srcCount[k] = (srcCount[k] || 0) + 1; });
  if (leadsSrc !== 'all' && !srcCount[leadsSrc]) leadsSrc = 'all';
  document.getElementById('leadsSrc').innerHTML = LEAD_SRC_FILTERS
    .filter(([k]) => k === 'all' || srcCount[k] || (k === 'prop' && srcCount.site))
    .map(([k, label]) => uiChip(label, { value:k, on: leadsSrc === k, icon:false,
      count: k === 'all' ? pool.length : (srcCount[k] || 0) + (k === 'prop' ? (srcCount.site || 0) : 0) })).join('');

  const filtered = pool.filter(l => leadsSrc === 'all' || leadSrcKey(l) === leadsSrc || (leadsSrc === 'prop' && leadSrcKey(l) === 'site'));
  const sorted = leadsTab === 'archive'
    ? filtered.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    : filtered.slice().sort((a, b) => (LEAD_PRIO[leadSrcKey(a)] - LEAD_PRIO[leadSrcKey(b)])
        || (new Date(b.created_at) - new Date(a.created_at)));

  // לידים של אותו/ה פונה יחד - הכרטיס של הדחוף, והשאר ב"פרטים"
  const groups = groupLeadsByVisitor(sorted);

  // באנר: ליד בעלים שמחכה יותר משעה ובלעדיות עוד רצה
  const waiting = fresh.filter(l => leadExclusiveEnd(l) && Date.now() - new Date(l.created_at) > 3600e3)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
  const banner = document.getElementById('leadsUrgent');
  banner.hidden = !waiting;
  if (waiting){
    const hrs = Math.floor((Date.now() - new Date(waiting.created_at)) / 3600e3);
    document.getElementById('leadsUrgentText').textContent =
      `ליד בעלים${waiting.city ? ' ב' + waiting.city : ''} מחכה לתגובה כבר ${plural(hrs, 'שעה', 'שעות')}. הבלעדיות שלך נגמרת בקרוב.`;
    banner.dataset.lead = waiting.id;
  }

  const shown = Math.min(Math.max(leadsShown, LEADS_STEP), groups.length);
  document.getElementById('leadsCountLine').textContent = groups.length
    ? (leadsTab === 'archive' ? `מוצגים ${shown} מתוך ${groups.length}` : `לפי סדר עדיפות: ${shown} מתוך ${groups.length}`)
    : '';

  if (!groups.length){
    listEl.innerHTML = '<div class="empty-state">' + (
      leadsTab === 'archive' ? 'אין לידים בארכיון.'
      : leadsTab === 'work' ? 'אין לידים בטיפול. ליד שיצרת איתו קשר עובר לכאן.'
      : allLeads.length === 0
        ? 'אין עדיין לידים.<br>פנייה מהאתר, שיחה למספר וירטואלי או ליד שנרכש יופיעו כאן.'
        : 'אין לידים חדשים. כל הכבוד!') + '</div>';
    document.getElementById('leadsMore').innerHTML = '';
    return;
  }

  listEl.innerHTML = '';
  groups.slice(0, shown).forEach((g, i) => listEl.appendChild(buildLeadPriorityCard(g, i + 1, agentId)));

  const left = groups.length - shown;
  document.getElementById('leadsMore').innerHTML =
    (left > 0 ? `<button type="button" class="ui-more" data-leads-more>עוד ${Math.min(LEADS_STEP, left)} לידים (נשארו ${left})</button>` : '')
    + (shown > LEADS_STEP && left === 0 ? `<button type="button" class="ui-link" data-leads-less>הצגת ${LEADS_STEP} בלבד</button>` : '');
}

function buildLeadPriorityCard(group, rank, agentId){
  const lead = group[0];
  const src = leadSrcKey(lead);
  const meta = LEAD_SRC[src];
  const call = leadCallById.get(lead.id);
  const stage = leadStageOf(lead);
  const locked = lead.status !== 'unlocked';
  const archived = archivedLeadIds.has(lead.id);
  const excl = leadExclusiveEnd(lead);
  const urgent = !!excl && stage === 'new';
  const name = lead.display_name || (call && call.extracted && call.extracted.caller_name) || (src === 'call' ? callLocalPhone(lead.display_phone) : 'ללא שם');

  let detail = lead.source_detail || '';
  if (src === 'owner' && excl) detail = 'בלעדיות עוד ' + plural(Math.max(1, Math.ceil((excl - Date.now()) / 3600e3)), 'שעה', 'שעות');
  if (src === 'prop' && group.length > 1) detail = plural(group.length, 'פנייה אחת', 'פניות');
  let why = meta.why;
  if (src === 'owner' && !excl) why = 'ליד בעלים';
  if (src === 'call' && call && call.status && call.status !== 'answered') why = 'התקשר/ה ולא נענה/תה';
  const facts = src === 'call' ? leadCallFacts(call) : [];
  const wants = leadWants(lead, call);

  const el = document.createElement('article');
  el.className = 'ui-scope lp-card' + (urgent ? ' is-urgent' : '');
  el.dataset.leadId = lead.id;
  el.innerHTML =
    `<div class="lp-head">`
    + `<span class="lp-rank" aria-label="עדיפות ${rank}">${rank}</span>`
    + `<span class="lp-avatar" aria-hidden="true">${esc(String(name).trim().charAt(0) || '?')}</span>`
    + `<div class="lp-who"><div class="lp-name">${esc(name)}</div>`
    + `<div class="lp-meta"><span class="ui-tag ui-tag--${meta.tone}">${esc(meta.label)}${detail ? ' · ' + esc(detail) : ''}</span>`
    + `<span class="ui-muted">${esc(leadAgo(lead.created_at))}</span></div></div>`
    + `</div>`
    + (wants ? `<p class="lp-wants">${esc(wants)}</p>` : '')
    + `<p class="lp-why"><strong>למה עכשיו:</strong> ${esc(why)}</p>`
    + (facts.length ? `<div class="lp-facts" aria-label="מה זוהה בשיחה">${facts.map(f => `<span class="ui-tag">${esc(f)}</span>`).join('')}</div>` : '')
    + (locked || archived ? '' : `<ol class="lp-steps" aria-label="שלב">` + LEAD_BAR.map(([k, label], i) => {
        const at = LEAD_BAR.findIndex(s => s[0] === stage);
        return `<li><button type="button" class="lp-step${i <= at ? ' is-on' : ''}${k === stage ? ' is-current' : ''}" data-lp-stage="${k}"`
          + `${k === stage ? ' aria-current="step"' : ''}${leadWorkReady ? '' : ' disabled'}>${esc(label)}</button></li>`;
      }).join('') + `</ol>`)
    + `<div class="lp-acts"></div>`
    + `<div class="lp-details" hidden></div>`;

  const acts = el.querySelector('.lp-acts');
  const tel = String(lead.display_phone || '').replace(/[^\d+]/g, '');
  const wa = !locked ? waLink(lead.display_phone) : null;
  const addBtn = (label, cls, attrs, fn) => {
    const isLink = attrs && attrs.href;
    const b = document.createElement(isLink ? 'a' : 'button');
    if (!isLink) b.type = 'button';
    b.className = cls;
    b.innerHTML = label;
    Object.entries(attrs || {}).forEach(([k, v]) => b.setAttribute(k, v));
    if (fn) b.addEventListener('click', fn);
    acts.appendChild(b);
    return b;
  };
  // פנייה: מתעדת מענה (markLeadResponded) ומקדמת ל"יצרתי קשר"
  const contacted = () => {
    markLeadResponded(lead);
    if (leadWorkReady && leadStageOf(lead) === 'new') saveLeadWork(lead, { stage:'contacted' }).then(ok => { if (ok) renderLeads(agentId); });
  };
  if (locked){
    addBtn('פתיחת הליד', 'ui-btn', null, () => {
      leadsOpenDetails.add(lead.id);
      toggleLeadDetails(el, group, agentId, true);
    });
  } else if (!archived){
    if (tel.replace(/\D/g, '').length >= 9) addBtn('📞 התקשרות', 'ui-btn', { href:'tel:' + tel }, contacted);
    if (wa) addBtn('💬 וואטסאפ', 'ui-btn ui-btn--secondary', { href: wa + '?text=' + encodeURIComponent(leadWhatsAppText(lead, leadPropertyContext(lead))), target:'_blank', rel:'noopener' }, contacted);
    if (call && call.recording_path) addBtn('▶ האזנה', 'ui-btn ui-btn--secondary', null, e => playLeadCall(e.currentTarget, call));
    addBtn('הוספה כלקוח/ה', 'ui-link', null, () => leadToClient(lead, call));
  }
  const det = addBtn('פרטים', 'ui-link', { 'aria-expanded':'false' }, () => toggleLeadDetails(el, group, agentId));
  det.classList.add('lp-details-btn');
  if (!locked && !archived){
    addBtn('לארכיון', 'ui-link lp-archive', null, e => archiveLead(lead, e.currentTarget, agentId));
  }

  el.querySelector('.lp-steps')?.addEventListener('click', e => {
    const b = e.target.closest('[data-lp-stage]');
    if (!b || b.disabled) return;
    saveLeadWork(lead, { stage: b.dataset.lpStage }).then(ok => { if (ok) renderLeads(agentId); });
  });

  if (leadsOpenDetails.has(lead.id)) toggleLeadDetails(el, group, agentId, true);
  return el;
}

/* "פרטים": הכרטיס המלא הקיים - פתיחת ליד נעול, הערה, ההודעה המלאה ולידים
   נוספים של אותו/ה פונה */
function toggleLeadDetails(card, group, agentId, forceOpen){
  const box = card.querySelector('.lp-details');
  const btn = card.querySelector('.lp-details-btn');
  const open = forceOpen || box.hidden;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  const id = group[0].id;
  if (open){
    leadsOpenDetails.add(id);
    if (!box.firstChild){
      const tab = group.length > 1 ? buildLeadGroupTab(group, agentId) : buildLeadTab(group[0], agentId);
      box.appendChild(tab);
      const head = tab.querySelector('.prop-tab-head');
      if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
    }
  } else leadsOpenDetails.delete(id);
}

async function playLeadCall(btn, call){
  btn.disabled = true;
  const { data, error } = await sb.storage.from('call-recordings').createSignedUrl(call.recording_path, 3600);
  btn.disabled = false;
  if (error || !data){ showToast('ההקלטה לא נטענה'); return; }
  const audio = document.createElement('audio');
  audio.controls = true; audio.src = data.signedUrl; audio.className = 'lp-audio';
  btn.replaceWith(audio);
  audio.play().catch(() => {});
}

/* "הוספה כלקוח/ה" - אותו טופס של "הוספה לקובץ" משיחה */
function leadToClient(lead, call){
  const phone = callLocalPhone(lead.display_phone);
  gotoSection('accClients');
  openClientFormWithContact({ name: lead.display_name || (call && call.extracted && call.extracted.caller_name) || '',
    phone, phones: phone ? [phone] : [], email:'' });
  if (call && call.extracted && call.extracted.needs) fillClientFormNeeds(call.extracted.needs);
  else if (lead.deal_type) setClientFormDeal(lead.deal_type);
  const notes = document.getElementById('clNotes');
  const text = (call && call.extracted && call.extracted.needs_text) || lead.display_message;
  if (notes && !notes.value && text) notes.value = 'מהליד: ' + String(text).slice(0, 400);
}

/* קישור עמוק לליד (?lead=, התראה): הלשונית שלו, בלי סינון, מספיק מנות כדי
   שיופיע, והפרטים פתוחים */
function openLeadUnified(id){
  const lead = allLeads.find(l => l.id === id);
  if (!lead) return;
  leadsTab = archivedLeadIds.has(id) ? 'archive' : leadStageOf(lead) === 'new' ? 'new' : 'work';
  leadsSrc = 'all';
  leadsOpenDetails.add(id);
  const visitor = leadVisitorOf.get(id);
  if (visitor){
    const first = allLeads.find(l => leadVisitorOf.get(l.id) === visitor && l.id !== id);
    if (first) leadsOpenDetails.add(first.id);
  }
  leadsShown = Math.max(leadsShown, allLeads.length);
}

/* ---------- המאזינים ---------- */
(function wireLeads(){
  const tabs = document.getElementById('leadsTabs');
  if (!tabs) return;
  const rerender = () => renderLeads(currentAgent && currentAgent.id);
  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-leads-tab]');
    if (!b) return;
    leadsTab = b.dataset.leadsTab; leadsShown = LEADS_STEP; rerender();
  });
  document.getElementById('leadsSrc').addEventListener('input', () => {
    leadsSrc = uiChipValues(document.getElementById('leadsSrc'))[0] || 'all'; leadsShown = LEADS_STEP; rerender();
  });
  document.getElementById('leadsMore').addEventListener('click', e => {
    if (e.target.closest('[data-leads-more]')){ leadsShown += LEADS_STEP; rerender(); }
    if (e.target.closest('[data-leads-less]')){ leadsShown = LEADS_STEP; rerender(); }
  });
  document.getElementById('leadsUrgentGo').addEventListener('click', () => {
    const id = document.getElementById('leadsUrgent').dataset.lead;
    leadsTab = 'new'; leadsSrc = 'all';
    const i = allLeads.findIndex(l => l.id === id);
    if (i >= 0) leadsOpenDetails.add(id);
    rerender();
    document.querySelector(`.lp-card[data-lead-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block:'center' });
  });
  // "לחזור לליד חדש תוך שעה" - אותה משימה אוטומטית של היומן (lead_followup)
  document.getElementById('leadsFollowupSwitch').addEventListener('input', async e => {
    const sw = e.currentTarget;
    const on = sw.getAttribute('aria-pressed') === 'true';
    if (!currentAgent) return;
    const off = on ? agendaAutoOff.filter(k => k !== 'lead_followup') : [...new Set(agendaAutoOff.concat('lead_followup'))];
    sw.disabled = true;
    const { error } = await sb.from('agent_agenda_preferences').upsert({
      agent_id: currentAgent.id, auto_off: off, updated_at: new Date().toISOString(),
    }, { onConflict:'agent_id' });
    sw.disabled = false;
    if (error){ sw.setAttribute('aria-pressed', String(!on)); showToast(heErr(error)); return; }
    agendaAutoOff = off;
    if (typeof renderAgendaAuto === 'function') renderAgendaAuto();
    syncLeadsSettings();
  });
  // המתג של לידי הבעלים - אותו מתג של "ההגדרות שלי", מסונכרן
  document.getElementById('leadsOwnerSwitch').addEventListener('input', e => {
    const main = document.getElementById('setOwnerSwitch');
    main.setAttribute('aria-pressed', e.currentTarget.getAttribute('aria-pressed'));
    setOwnerLeadsActive(main);
  });
  document.getElementById('leadsEditPrefs').addEventListener('click', () => openLeadPrefs());
})();

/* שורת הסיכום והמתגים של "הגדרות לידים" */
function syncLeadsSettings(){
  const sum = document.getElementById('leadsSetSummary');
  if (!sum) return;
  const row = typeof leadPrefsRow !== 'undefined' ? leadPrefsRow : null;
  const ownerOn = !!(row && row.active);
  const followOn = assistantTierOk() && !(typeof agendaAutoOff !== 'undefined' && agendaAutoOff.includes('lead_followup'));
  document.getElementById('leadsOwnerSwitch').setAttribute('aria-pressed', String(ownerOn));
  document.getElementById('leadsOwnerSwitch').disabled = !row;
  const fs = document.getElementById('leadsFollowupSwitch');
  fs.setAttribute('aria-pressed', String(followOn));
  fs.disabled = !assistantTierOk();
  sum.textContent = [
    !row ? 'לידי בעלים לא הוגדרו' : ownerOn ? 'לידי בעלים פעילים · ' + plural((row.preferred_neighborhoods || []).length, 'שכונה אחת', 'שכונות') : 'לידי בעלים מושהים',
    followOn ? 'משימה לחזור תוך שעה' : '',
  ].filter(Boolean).join(' · ');
}

/* ==========================================================================
   קובץ הלקוחות - הראש (סעיף 3.11)
   ========================================================================== */
let clientsKind = 'seekers';

/* השורה ללידים, שלושת האריחים והמונים בלשוניות. נקרא מ-renderClients ומ-
   renderLeadsUnified - הנתונים של שניהם נטענים בזמנים שונים */
function renderClientsTop(){
  const tiles = document.getElementById('clientsTiles');
  if (!tiles) return;
  const rows = typeof clientRows !== 'undefined' ? clientRows : [];
  const owners = rows.filter(c => isOwnerClient(c)).length;
  const counts = { seekers: rows.length - owners, owners, all: rows.length };
  document.querySelectorAll('#clientsKindTabs [data-clients-kind]').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.clientsKind === clientsKind));
    b.querySelector('[data-n]').textContent = counts[b.dataset.clientsKind];
  });

  const leads = typeof allLeads !== 'undefined' ? allLeads : [];
  const freshLeads = leads.filter(l => !archivedLeadIds.has(l.id) && leadStageOf(l) === 'new');
  const callLeads = freshLeads.filter(l => l.lead_type === 'call').length;
  const link = document.getElementById('clientsLeadsLink');
  link.hidden = !freshLeads.length;
  document.getElementById('clientsLeadsText').textContent =
    freshLeads.length ? plural(freshLeads.length, 'ליד חדש אחד מחכה', 'לידים חדשים מחכים') + ' לך ב"הלידים שלי"' : '';

  const matches = accCountOf('accAlerts');
  tiles.innerHTML =
    `<div class="clients-tile"><b>${rows.length}</b><span>לקוחות בקובץ</span></div>`
    + `<button type="button" class="clients-tile is-dark" data-goto="accAlerts"><b>${matches}</b><span>התאמות שמחכות לך ←</span></button>`
    + `<button type="button" class="clients-tile" data-clients-calls><b>${callLeads}</b><span>שיחות שמחכות להחלטה</span></button>`;
}

(function wireClientsTop(){
  const tabs = document.getElementById('clientsKindTabs');
  if (!tabs) return;
  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-clients-kind]');
    if (!b) return;
    clientsKind = b.dataset.clientsKind;
    renderClients();
  });
  // שיחות שמחכות להחלטה = לידי שיחה חדשים, ב"הלידים שלי" עם סינון לשיחות
  document.getElementById('clientsTiles').addEventListener('click', e => {
    if (!e.target.closest('[data-clients-calls]')) return;
    leadsTab = 'new'; leadsSrc = 'call'; leadsShown = LEADS_STEP;
    gotoSection('accLeads');
    renderLeads(currentAgent && currentAgent.id);
  });
})();

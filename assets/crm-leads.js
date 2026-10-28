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
  social:{ label:'רשתות חברתיות', tone:'accent', why:'פנייה מפייסבוק או מאינסטגרם' },
};
const LEAD_SRC_FILTERS = [['all', 'כל המקורות'], ['owner', 'לידי בעלים'], ['call', 'שיחות'], ['prop', 'דפי נכסים'], ['agent', 'דף הסוכן'], ['social', 'רשתות חברתיות'], ['store', 'חנות הלידים']];
const LEAD_PRIO = { owner:0, store:1, call:2, prop:3, agent:3, site:3, social:3 };
/* גבריאלה בפייסבוק ובאינסטגרם (social-lead-intake, docs/social-leads.md) */
const LEAD_SOCIAL_SOURCES = new Set(['facebook_dm', 'facebook_comment', 'instagram_dm', 'instagram_comment',
  // פוסט בקבוצה או במרקטפלייס, אחרי הסכמה (scraped_lead_set_consent, docs/scraped-leads.md)
  'facebook_group', 'facebook_marketplace']);
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
  // לפני 'prop': פנייה מפייסבוק על נכס נושאת property_id, והייתה נספרת כדף נכס
  if (LEAD_SOCIAL_SOURCES.has(l.source)) return 'social';
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

/* זמן יחסי לליד. "אתמול" הוא יום לוח, לא 24 שעות. התאריך המלא יושב
   ב-title וב-aria (leadWhen), כי "לפני 12 דק׳" בלי התאריך נעלם אחרי רענון. */
function leadAgo(iso){
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60e3);
  if (min < 1) return 'עכשיו';
  if (min < 60) return 'לפני ' + min + ' דק׳';
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  if (d >= startToday) return 'לפני ' + plural(Math.floor(ms / 3600e3), 'שעה', 'שעות');
  const startYest = new Date(startToday);
  startYest.setDate(startYest.getDate() - 1);
  if (d >= startYest) return 'אתמול';
  const days = Math.round((startToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days > 0 && days < 7) return 'לפני ' + plural(days, 'יום', 'ימים');
  return d.toLocaleDateString('he-IL', { day:'numeric', month:'numeric' });
}

function leadWhen(iso){
  const d = new Date(iso);
  const title = Number.isFinite(d.getTime())
    ? d.toLocaleString('he-IL', { weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '';
  return { text: leadAgo(iso), title };
}

/* שלב מהרשימה הקיימת של lead_work בלבד. ערך לא מוכר נופל ל"חדש",
   כמו בורר הכרטיס, ולא ממציא תווית. */
function leadStageClass(stage){
  return ({ new:1, contacted:1, meeting:1, not_relevant:1, won:1 })[stage] ? stage : 'new';
}

function leadStageTagHtml(lead){
  const stage = leadStageClass(leadStageOf(lead));
  const label = (typeof LEAD_STAGE_LABEL !== 'undefined' && LEAD_STAGE_LABEL[stage])
    || ({ new:'חדש', contacted:'נוצר קשר ראשוני', meeting:'בתיאום פגישה / סיור', not_relevant:'לא רלוונטי / לא ענה', won:'נסגר בהצלחה' })[stage];
  return `<span class="lp-st lp-st-${stage}">${esc(label)}</span>`;
}

/* מה זוהה בשיחה - extracted.facts מהסיכום (twilio-voice). שיחה שסוכמה לפני
   שהשדה נולד - נגזר מ-extracted.needs */
function leadCallFacts(call){
  const x = (call && call.extracted) || {};
  if (Array.isArray(x.facts) && x.facts.length) return x.facts.slice(0, 6);
  const n = x.needs || {};
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

/* שיחה שנקטעה באמצע (extracted.call_status) - "כדאי לחזור" */
function callCutOff(c){
  return !!(c && c.extracted && c.extracted.call_status === 'cut_off');
}

/* תגיות "מה זוהה" והצעד הבא - אותו בלוק בשורת השיחה ובתצוגת המשרד */
function callInsightsHtml(c){
  const facts = leadCallFacts(c);
  const next = c && c.extracted && c.extracted.next_step;
  return (facts.length ? `<div class="call-facts" aria-label="מה זוהה בשיחה">${facts.map(f => `<span class="call-fact">${esc(f)}</span>`).join('')}</div>` : '')
    + (next ? `<p class="call-next"><b>הצעד הבא:</b> ${esc(next)}</p>` : '')
    + (callCutOff(c) ? '<p class="call-cut">כדאי לחזור: השיחה לא הסתיימה</p>' : '');
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
/* סדר העדיפות: בעלים, נרכש, שיחה, אתר - ובתוך כל מקור החדש ביותר */
function leadsPrioritySort(list){
  return list.slice().sort((a, b) => (LEAD_PRIO[leadSrcKey(a)] - LEAD_PRIO[leadSrcKey(b)])
    || (new Date(b.created_at) - new Date(a.created_at)));
}

/* הלידים החדשים שלי בסדר העדיפות, מקובצים לפי פונה - "לחזור אליהם קודם"
   ו"מחכה לך" בדף הבית (crm-home.js) קוראים מכאן, כדי שהסדר יהיה אותו סדר */
function leadsPriorityGroups(){
  if (typeof allLeads === 'undefined' || !currentAgent) return [];
  const fresh = allLeads.filter(l => !archivedLeadIds.has(l.id) && leadStageOf(l) === 'new'
    && (!l.agent_id || l.agent_id === currentAgent.id));
  return groupLeadsByVisitor(leadsPrioritySort(fresh));
}

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
  const counts = { new: fresh.length, work: work.length, archive: archived.length,
                   demand: openDemandRows ? openDemandRows.filter(d => !d.mine).length : '·' };
  document.querySelectorAll('#leadsTabs [data-leads-tab]').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.leadsTab === leadsTab));
    b.querySelector('[data-n]').textContent = counts[b.dataset.leadsTab];
  });
  alignScrollTabs(document.getElementById('leadsTabs'));
  document.getElementById('leadsSrc').hidden = leadsTab === 'demand';
  if (leadsTab === 'demand'){ renderOpenDemand(listEl); return; }

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
    : leadsPrioritySort(filtered);

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
    listEl.innerHTML = leadsEmptyHtml();
    const add = listEl.querySelector('[data-leads-empty]');
    if (add) add.addEventListener('click', () => {
      if (typeof openInlineForm === 'function') openInlineForm('accProperties', 'addPropertyForm', 'toggleAddProperty');
    });
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

function leadsEmptyHtml(){
  if (leadsTab === 'archive') return '<div class="empty-state"><p>אין לידים בארכיון.</p></div>';
  if (leadsTab === 'work') return '<div class="empty-state"><p>אין לידים בטיפול.</p><p>ליד שסימנת טופל עובר לכאן.</p></div>';
  if (allLeads.length === 0){
    return '<div class="empty-state"><p>אין לידים עדיין.</p>'
      + '<p>פנייה מהאתר, שיחה למספר וירטואלי או ליד שנרכש יופיעו כאן.</p>'
      + '<button type="button" class="ui-btn" data-leads-empty="property">נכס חדש</button></div>';
  }
  return '<div class="empty-state"><p>אין לידים חדשים. כל הכבוד.</p></div>';
}

function leadsSkeletonHtml(){
  const bar = '<div class="lp-skel" aria-hidden="true"><span></span><span><i></i><i></i></span></div>';
  return '<div class="lp-skel-wrap" role="status"><span class="sr-only">טוען לידים</span>' + bar + bar + bar + '</div>';
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
  else if (src === 'call' && callCutOff(call)) why = 'השיחה לא הסתיימה - כדאי לחזור';
  const facts = src === 'call' ? leadCallFacts(call) : [];
  const wants = leadWants(lead, call);

  const when = leadWhen(lead.created_at);
  const unread = stage === 'new' && !archived;
  const phone = lead.display_phone || '';
  const el = document.createElement('article');
  el.className = 'ui-scope lp-card' + (urgent ? ' is-urgent' : '') + (unread ? ' is-unread' : '');
  el.dataset.leadId = lead.id;
  el.innerHTML =
    `<div class="lp-head">`
    + `<span class="lp-rank" aria-label="עדיפות ${rank}">${rank}</span>`
    + `<span class="lp-avatar" aria-hidden="true">${esc(String(name).trim().charAt(0) || '?')}</span>`
    + `<div class="lp-who"><div class="lp-name">${unread ? '<span class="lp-dot" aria-hidden="true"></span>' : ''}<bdi dir="auto">${esc(name)}</bdi></div>`
    + (phone ? `<div class="lp-phone"><bdi dir="auto">${esc(phone)}</bdi></div>` : '')
    + `<div class="lp-meta"><span class="ui-tag ui-tag--${meta.tone}">${esc(meta.label)}${detail ? ' · ' + esc(detail) : ''}</span>`
    + leadStageTagHtml(lead)
    + `<span class="lp-time" title="${esc(when.title)}"${when.title ? ` aria-label="${esc(when.title)}"` : ''}>${esc(when.text)}</span></div></div>`
    + `</div>`
    + (wants ? `<p class="lp-wants">${esc(wants)}</p>` : '')
    + `<p class="lp-why"><strong>למה עכשיו:</strong> ${esc(why)}</p>`
    + (facts.length ? `<div class="lp-facts" aria-label="מה זוהה בשיחה">${facts.map(f => `<span class="ui-tag">${esc(f)}</span>`).join('')}</div>` : '')
    + (locked || archived ? '' : `<ol class="lp-steps" aria-label="שלב">` + LEAD_BAR.map(([k, label], i) => {
        const at = LEAD_BAR.findIndex(s => s[0] === stage);
        return `<li><button type="button" class="lp-step${i <= at ? ' is-on' : ''}${k === stage ? ' is-current' : ''}" data-lp-stage="${k}"`
          + `${k === stage ? ' aria-current="step"' : ''}${leadWorkReady ? '' : ' disabled'}>${esc(label)}</button></li>`;
      }).join('') + `</ol>`)
    + `<div class="lp-quick"></div>`
    + `<div class="lp-acts"></div>`
    + `<div class="lp-details" hidden></div>`;

  const quick = el.querySelector('.lp-quick');
  const acts = el.querySelector('.lp-acts');
  const tel = String(lead.display_phone || '').replace(/[^\d+]/g, '');
  const telOk = tel.replace(/\D/g, '').length >= 9;
  const wa = !locked ? waLink(lead.display_phone) : null;
  const addBtn = (parent, label, cls, attrs, fn) => {
    const isLink = attrs && attrs.href;
    const b = document.createElement(isLink ? 'a' : 'button');
    if (!isLink) b.type = 'button';
    b.className = cls;
    b.innerHTML = label;
    Object.entries(attrs || {}).forEach(([k, v]) => b.setAttribute(k, v));
    if (fn) b.addEventListener('click', fn);
    parent.appendChild(b);
    return b;
  };
  // חיוג ווואטסאפ: מתעדים מענה (markLeadResponded) ומקדמים ל"יצרתי קשר".
  // "טופל" הוא רק השלב, בלי first_response_at (הסקיל lead-card, כלל 2).
  const contacted = (kind) => {
    crmTrackLead(kind);
    markLeadResponded(lead);
    if (leadWorkReady && leadStageOf(lead) === 'new') saveLeadWork(lead, { stage:'contacted' }).then(ok => { if (ok) renderLeads(agentId); });
  };
  if (locked){
    addBtn(quick, 'פתיחת הליד', 'ui-btn lp-q', null, () => {
      leadsOpenDetails.add(lead.id);
      toggleLeadDetails(el, group, agentId, true);
    });
  } else {
    if (telOk) addBtn(quick, 'חיוג', 'ui-btn lp-q lp-q-call', { href:'tel:' + tel, 'aria-label':'חיוג אל ' + name }, () => contacted('call'));
    if (wa) addBtn(quick, 'וואטסאפ', 'ui-btn ui-btn--secondary lp-q lp-q-wa', {
      href: wa + '?text=' + encodeURIComponent(leadWhatsAppText(lead, leadPropertyContext(lead))),
      target:'_blank', rel:'noopener', 'aria-label':'וואטסאפ אל ' + name,
    }, () => contacted('whatsapp'));
    if (!archived && leadWorkReady && stage === 'new'){
      addBtn(quick, 'טופל', 'ui-btn ui-btn--secondary lp-q lp-q-done', { 'aria-label':'סימון הליד כטופל' }, () => leadMarkHandled(lead, agentId));
    }
  }
  if (!quick.childElementCount) quick.hidden = true;
  if (!locked && !archived){
    if (call && call.recording_path) addBtn(acts, 'האזנה', 'ui-btn ui-btn--secondary', null, e => playLeadCall(e.currentTarget, call));
    addBtn(acts, 'הוספה כלקוח/ה', 'ui-link', null, () => leadToClient(lead, call));
  }
  const det = addBtn(acts, 'פרטים', 'ui-link', { 'aria-expanded':'false' }, () => toggleLeadDetails(el, group, agentId));
  det.classList.add('lp-details-btn');
  if (!locked && !archived){
    addBtn(acts, 'לארכיון', 'ui-link lp-archive', null, e => archiveLead(lead, e.currentTarget, agentId));
  }

  el.querySelector('.lp-steps')?.addEventListener('click', e => {
    const b = e.target.closest('[data-lp-stage]');
    if (!b || b.disabled) return;
    saveLeadWork(lead, { stage: b.dataset.lpStage }).then(ok => { if (ok) renderLeads(agentId); });
  });

  if (leadsOpenDetails.has(lead.id)) toggleLeadDetails(el, group, agentId, true);
  return el;
}

/* מדידה של הפעולות בלי לפתוח את הכרטיס. ב-CRM אין events.js, אז בלי
   shukTrack אותה דחיפה יוצאת ל-dataLayer. בלי שם, טלפון או מזהה ליד. */
function crmTrackLead(kind){
  try {
    if (typeof window.shukTrack === 'function'){
      if (kind === 'call') window.shukTrack('crm_lead_call', {});
      else if (kind === 'whatsapp') window.shukTrack('crm_lead_whatsapp', {});
      else if (kind === 'handled') window.shukTrack('crm_lead_handled', {});
      else if (kind === 'undo') window.shukTrack('crm_lead_handled_undo', {});
      return;
    }
    const name = kind === 'call' ? 'crm_lead_call'
      : kind === 'whatsapp' ? 'crm_lead_whatsapp'
      : kind === 'handled' ? 'crm_lead_handled'
      : kind === 'undo' ? 'crm_lead_handled_undo' : '';
    if (!name) return;
    window.dataLayer = window.dataLayer || [];
    const path = ((location.pathname || '').split('/').pop() || 'crm').replace(/\.html$/, '') || 'crm';
    window.dataLayer.push({ event: name, page_type: path });
  } catch (e) { /* מדידה לא חוסמת חיוג */ }
}

/* "טופל" מהרשימה: השלב עובר מ"חדש" ל"נוצר קשר ראשוני" (saveLeadWork),
   בלי mark_lead_responded. ביטול בטוסט מחזיר את השלב הקודם כחמש שניות. */
function leadMarkHandled(lead, agentId){
  if (!lead || !leadWorkReady || lead.status !== 'unlocked') return;
  if (archivedLeadIds.has(lead.id) || leadStageOf(lead) !== 'new') return;
  const who = agentId || (currentAgent && currentAgent.id);
  saveLeadWork(lead, { stage:'contacted' }).then(ok => {
    if (!ok) return;
    renderLeads(who);
    crmTrackLead('handled');
    const undo = () => {
      saveLeadWork(lead, { stage:'new' }).then(back => {
        if (!back) return;
        crmTrackLead('undo');
        renderLeads(who);
        showToast('הסימון בוטל');
      });
    };
    if (typeof showUndoToast === 'function') showUndoToast('הליד סומן כטופל', undo, 5000);
    else showToast('הליד סומן כטופל');
  });
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

/* ---------- ביקוש פתוח ----------
   פוסט בפייסבוק שבעליו לא ענה/תה לבקשת ההסכמה 7 ימים (scraped_leads_lifecycle,
   docs/scraped-leads.md), ובתקופת ההשקה - כל פוסט מרגע הקליטה, במקביל לבקשת
   ההסכמה (open_demand_list). אינו ליד: בלי שם, טלפון או טקסט, בלי מכסה ובלי
   תשלום. הדרך היחידה לפנות היא הפוסט עצמו - ולכן אין כאן חיוג, וואטסאפ או
   "הוספה כלקוח/ה". "אני פונה" (open_demand_claim) תופס את הביקוש לסוכן/ת
   אחד/ת ופותח את הפוסט, עד תקרה יומית. נטען רק כשהלשונית נפתחת. */
let openDemandRows = null;
let openDemandStats = null;
let openDemandLoading = false;
// מופיע ליד כל ביקוש, וזהה לנוסח בהתראה (scraped_lead_notify_demand)
const OPEN_DEMAND_RULE = 'אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ';
// "ללא תיווך": בפוסט - הצעה לשיווק; בשם הקבוצה - כלל של הקבוצה, ולכן רק בפרטי
const OPEN_DEMAND_NO_BROKER = {
  post:  { tag: 'כתב/ה ללא תיווך',
           rule: 'הצעה אחת ומנומסת לשיווק מקצועי, עדיף בהודעה פרטית בפייסבוק. לא להציע קונים.' },
  group: { tag: 'קבוצה ללא תיווך',
           rule: 'לא להגיב בפוסט, רק בהודעה פרטית בפייסבוק. הצעה אחת ומנומסת לשיווק מקצועי.' },
};

async function loadOpenDemand(){
  if (openDemandLoading) return;
  openDemandLoading = true;
  const [list, stats] = await Promise.all([sb.rpc('open_demand_list'), sb.rpc('open_demand_stats')]);
  openDemandLoading = false;
  if (list.error){ showToast(heErr(list.error)); openDemandRows = []; }
  else openDemandRows = list.data || [];
  openDemandStats = stats.error ? null : stats.data;
  if (leadsTab === 'demand') renderLeads(currentAgent && currentAgent.id);
}

function openDemandWants(d){
  const owner = d.lead_type === 'owner_inbound';
  const rent = d.deal_type === 'rent';
  const who = owner ? (rent ? 'משכיר/ה' : 'מוכר/ת') : (rent ? 'מחפש/ת לשכור' : 'מחפש/ת לקנות');
  const hood = d.neighborhood_id && typeof allNeighborhoods !== 'undefined'
    ? (allNeighborhoods.find(n => n.id === d.neighborhood_id) || {}).name : '';
  return [who + ' ' + (d.property_type || 'נכס'), hood ? hood + ', ' + d.city : d.city,
    d.rooms ? d.rooms + ' חדרים' : '', d.budget ? (owner ? 'מחיר ' : 'עד ') + shekelCompact(d.budget) : '',
    d.move_in ? 'כניסה: ' + d.move_in : '', d.summary || ''].filter(Boolean).join(' · ');
}

function openDemandCapLeft(){
  const st = openDemandStats;
  return st ? Math.max(0, (st.daily_cap || 0) - (st.my_today || 0)) : null;
}

function renderOpenDemand(listEl){
  document.getElementById('leadsMore').innerHTML = '';
  const st = openDemandStats, left = openDemandCapLeft();
  const open = (openDemandRows || []).filter(d => !d.mine).length;
  document.getElementById('leadsCountLine').textContent = openDemandRows === null ? '' : [
    open ? plural(open, 'ביקוש פתוח אחד', 'ביקושים פתוחים') + ' בעיר שלך' : '',
    st && st.claimed_today ? 'נתפסו היום: ' + st.claimed_today : '',
    left !== null ? 'נשארו לך היום: ' + left + ' מתוך ' + st.daily_cap : '',
  ].filter(Boolean).join(' · ');
  if (openDemandRows === null){
    listEl.innerHTML = '<div class="empty-state">טוען...</div>';
    loadOpenDemand();
    return;
  }
  const hint = '<p class="ui-hint lp-demand-hint"><span>אנשים פרטיים שכתבו בפייסבוק מה הם מחפשים או מציעים, ולא השאירו פרטים.'
    + ' "אני פונה" שומר את הביקוש לך בלבד ופותח את הפוסט.</span>'
    + '<span><strong>' + OPEN_DEMAND_RULE + '</strong></span></p>';
  if (!openDemandRows.length){
    listEl.innerHTML = hint + '<div class="empty-state">אין כרגע ביקוש פתוח בעיר שלך.</div>';
    return;
  }
  listEl.innerHTML = hint + openDemandRows.map(d => {
    const src = d.source === 'instagram_dm' || d.source === 'instagram_comment' ? 'אינסטגרם'
      : d.source === 'facebook_dm' || d.source === 'facebook_comment' ? 'פייסבוק'
      : d.source === 'facebook_marketplace' ? 'מרקטפלייס' : 'קבוצת פייסבוק';
    const url = /^https:\/\//.test(d.post_url || '') ? d.post_url : '';
    const nb = OPEN_DEMAND_NO_BROKER[d.no_broker];
    const rule = url ? (nb ? nb.rule : OPEN_DEMAND_RULE)
      : 'הפנייה הגיעה משיחה עם גבריאלה. אין כאן מספר, לא ב-SMS ולא בוואטסאפ.';
    const act = d.mine
      ? (url
          ? `<a class="ui-btn ui-btn--secondary" href="${esc(url)}" target="_blank" rel="noopener">לפוסט המקורי ↗</a>`
          : '<span class="ui-muted">פרטי הקשר עדיין לא נמסרים כאן.</span>')
      : (left === 0
          ? '<span class="ui-muted">הגעת לתקרה היומית. מחר אפשר שוב.</span>'
          : `<button type="button" class="ui-btn" data-demand-claim="${esc(d.id)}"${url ? ' data-open-post="1"' : ''}>${url ? 'אני פונה - לפוסט ↗' : 'אני פונה'}</button>`);
    return `<article class="ui-scope lp-card" data-demand-id="${esc(d.id)}">`
      + `<div class="lp-head"><span class="lp-avatar" aria-hidden="true">📣</span>`
      + `<div class="lp-who"><div class="lp-name">${esc(openDemandWants(d).split(' · ')[0])}</div>`
      + `<div class="lp-meta"><span class="ui-tag ui-tag--accent">${esc(src)}${d.source_detail ? ' · ' + esc(d.source_detail) : ''}</span>`
      + (d.mine ? '<span class="ui-tag ui-tag--ok">פנית</span>' : '')
      + (nb ? `<span class="ui-tag ui-tag--warn">${esc(nb.tag)}</span>` : '')
      + `<span class="ui-muted">${esc(leadAgo(d.posted_at))}</span></div></div></div>`
      + `<p class="lp-wants">${esc(openDemandWants(d))}</p>`
      + (d.mine ? '' : `<p class="lp-why"><strong>חינם:</strong> לסוכן/ת הראשון/ה שלוחץ/ת "אני פונה". אחרי הלחיצה הביקוש יורד מהרשימה של כל השאר.</p>`)
      + `<p class="lp-why"><strong>${esc(rule)}</strong></p>`
      + `<div class="lp-acts">${act}</div>`
      + `</article>`;
  }).join('');
}

const OPEN_DEMAND_CLAIM_ERR = {
  claimed: 'סוכן/ת אחר/ת כבר פנה/תה לביקוש הזה.',
  daily_cap: 'הגעת לתקרה היומית של ביקושים. מחר אפשר שוב.',
  not_found: 'הביקוש כבר לא פתוח.',
};

async function claimOpenDemand(id, btn){
  // החלון נפתח בתוך הלחיצה, אחרת חוסם החלונות של הדפדפן עוצר אותו אחרי ה-await.
  // בלי פוסט (שיחה עם גבריאלה) אין לאן לפתוח, וחלון ריק רק מפריע.
  const openPost = !!(btn && btn.getAttribute('data-open-post') === '1');
  const win = openPost ? window.open('', '_blank') : null;
  if (btn) btn.disabled = true;
  const { data, error } = await sb.rpc('open_demand_claim', { p_id: id });
  const err = error ? heErr(error) : (data && data.error ? (OPEN_DEMAND_CLAIM_ERR[data.error] || heErr(data.error)) : '');
  const url = !err && data && /^https:\/\//.test(data.post_url || '') ? data.post_url : '';
  if (win){
    if (url){ win.opener = null; win.location.href = url; }
    else win.close();
  }
  if (err) showToast(err);
  openDemandRows = null;
  renderLeads(currentAgent && currentAgent.id);
}

function openLeadsDemand(){
  leadsTab = 'demand';
  openDemandRows = null;
  renderLeads(currentAgent && currentAgent.id);
}

/* ---------- המאזינים ---------- */
(function wireLeads(){
  const tabs = document.getElementById('leadsTabs');
  if (!tabs) return;
  const rerender = () => renderLeads(currentAgent && currentAgent.id);
  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-leads-tab]');
    if (!b) return;
    leadsTab = b.dataset.leadsTab; leadsShown = LEADS_STEP;
    if (leadsTab === 'demand') openDemandRows = null;   // תמיד טרי: נוסף ונמחק כל שעה
    rerender();
  });
  document.getElementById('leadsSrc').addEventListener('input', () => {
    leadsSrc = uiChipValues(document.getElementById('leadsSrc'))[0] || 'all'; leadsShown = LEADS_STEP; rerender();
  });
  document.getElementById('leadsList').addEventListener('click', e => {
    const b = e.target.closest('[data-demand-claim]');
    if (b && !b.disabled) claimOpenDemand(b.dataset.demandClaim, b);
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
  const prefEdit = document.getElementById('leadsPrefEdit');
  if (prefEdit) prefEdit.addEventListener('click', () => openLeadPrefs());
  const sheetClose = document.getElementById('leadPrefsSheetClose');
  const sheetBackdrop = document.getElementById('leadPrefsSheetBackdrop');
  if (sheetClose) sheetClose.addEventListener('click', closeLeadPrefsSheet);
  if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeLeadPrefsSheet);
  watchScrollTabs(document.getElementById('leadsTabs'));
  watchScrollTabs(document.getElementById('clientsKindTabs'));
  document.addEventListener('keydown', e => {
    const sheet = document.getElementById('leadPrefsSheet');
    if (e.key === 'Escape' && sheet && !sheet.hidden) closeLeadPrefsSheet();
  });
})();

/* לשוניות ארוכות במובייל: הגלילה ב-RTL נפתחת על הקצה השמאלי וחותכת את
   הלשונית הראשונה. מחזירים את הנבחרת (או הראשונה) אל תוך המסך, ומשאירים
   סימן שהשורה גוללת. */
function markScrollEdges(tabs){
  const items = tabs.querySelectorAll('[role="tab"]');
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const box = tabs.getBoundingClientRect();
  const fr = first.getBoundingClientRect();
  const lr = last.getBoundingClientRect();
  tabs.classList.toggle('is-more-right', fr.right > box.right + 2);
  tabs.classList.toggle('is-more-left', lr.left < box.left - 2);
}

function alignScrollTabs(tabs){
  if (!tabs || !tabs.clientWidth) return;
  const overflow = tabs.scrollWidth > tabs.clientWidth + 2;
  if (!overflow){
    tabs.classList.remove('is-more-left', 'is-more-right');
    return;
  }
  const target = tabs.querySelector('[aria-selected="true"]') || tabs.querySelector('[role="tab"]');
  if (target){
    const box = tabs.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    // scrollBy לפי ציר המסך, לא לפי scrollLeft: בכרום RTL הערך 0 הוא הקצה
    // השמאלי, ושם נחתכת הלשונית הראשונה.
    let dx = 0;
    if (rect.width > box.width + 1) dx = rect.right - box.right;
    else {
      if (rect.right > box.right + 1) dx += rect.right - box.right;
      if (rect.left < box.left - 1) dx -= box.left - rect.left;
    }
    if (Math.abs(dx) > 1) tabs.scrollBy({ left: dx });
  }
  markScrollEdges(tabs);
}

function watchScrollTabs(tabs){
  if (!tabs || tabs.dataset.scrollWatch || typeof ResizeObserver === 'undefined') return;
  tabs.dataset.scrollWatch = '1';
  new ResizeObserver(() => alignScrollTabs(tabs)).observe(tabs);
  tabs.addEventListener('scroll', () => markScrollEdges(tabs), { passive:true });
}

const LEAD_PREFS_MQ = window.matchMedia('(max-width:1023px)');
function leadPrefsMobile(){ return !!(LEAD_PREFS_MQ && LEAD_PREFS_MQ.matches); }

let leadPrefsHome = null;
function openLeadPrefsSheet(focusId){
  if (!leadPrefsMobile()) return false;
  const section = document.getElementById('setLeadPrefs');
  const sheet = document.getElementById('leadPrefsSheet');
  const slot = document.getElementById('leadPrefsSheetSlot');
  if (!section || !sheet || !slot) return false;
  const already = !sheet.hidden && section.parentNode === slot;
  if (!already && typeof closeNavLayers === 'function') closeNavLayers();
  if (!leadPrefsHome) leadPrefsHome = { parent: section.parentNode, next: section.nextSibling };
  if (section.parentNode !== slot) slot.appendChild(section);
  const follow = document.getElementById('leadsFollowRow');
  const links = document.getElementById('leadsSetLinks');
  if (follow && follow.parentNode !== slot) slot.appendChild(follow);
  if (links && links.parentNode !== slot) slot.appendChild(links);
  if (typeof uiFoldOpen === 'function') uiFoldOpen('setLeadPrefs', true);
  sheet.hidden = false;
  document.body.classList.add('lp-sheet-open');
  const focus = focusId && document.getElementById(focusId);
  if (focus) setTimeout(() => { try { focus.focus({ preventScroll:true }); } catch (e) { /* */ } }, 60);
  return true;
}

function closeLeadPrefsSheet(){
  const sheet = document.getElementById('leadPrefsSheet');
  const section = document.getElementById('setLeadPrefs');
  if (leadPrefsHome && section && leadPrefsHome.parent){
    leadPrefsHome.parent.insertBefore(section, leadPrefsHome.next);
  }
  const body = document.getElementById('leadsSetBody');
  const follow = document.getElementById('leadsFollowRow');
  const links = document.getElementById('leadsSetLinks');
  const edit = document.getElementById('leadsEditPrefs');
  if (body && follow && follow.parentNode !== body){
    if (edit && edit.parentNode === body) edit.insertAdjacentElement('afterend', follow);
    else body.appendChild(follow);
  }
  if (body && links && links.parentNode !== body) body.appendChild(links);
  if (sheet) sheet.hidden = true;
  document.body.classList.remove('lp-sheet-open');
}

function leadPrefsFromHash(){
  const id = (location.hash || '').replace(/^#/, '');
  if (id !== 'setLeadPrefs' && id !== 'setOwnerSwitch') return;
  if (openLeadPrefsSheet(id)) return;
  if (id === 'setLeadPrefs' && typeof openLeadPrefs === 'function') openLeadPrefs();
  else if (typeof gotoSection === 'function') gotoSection('accPrefs', id, { scrollTo:'#' + id });
}

window.addEventListener('resize', () => {
  alignScrollTabs(document.getElementById('leadsTabs'));
  alignScrollTabs(document.getElementById('clientsKindTabs'));
  const sheet = document.getElementById('leadPrefsSheet');
  if (sheet && !sheet.hidden && !leadPrefsMobile()) closeLeadPrefsSheet();
});
document.addEventListener('DOMContentLoaded', leadPrefsFromHash);

/* שורת הסיכום והמתגים של "הגדרות לידים" */
function syncLeadsSettings(){
  const sum = document.getElementById('leadsSetSummary');
  const stripSum = document.getElementById('leadsPrefSummary');
  const strip = document.getElementById('leadsPrefStrip');
  if (!sum && !stripSum) return;
  const row = typeof leadPrefsRow !== 'undefined' ? leadPrefsRow : null;
  const ownerOn = !!(row && row.active);
  const followOn = assistantTierOk() && !(typeof agendaAutoOff !== 'undefined' && agendaAutoOff.includes('lead_followup'));
  const ownerSwitch = document.getElementById('leadsOwnerSwitch');
  if (ownerSwitch){
    ownerSwitch.setAttribute('aria-pressed', String(ownerOn));
    ownerSwitch.disabled = !row;
  }
  const fs = document.getElementById('leadsFollowupSwitch');
  if (fs){
    fs.setAttribute('aria-pressed', String(followOn));
    fs.disabled = !assistantTierOk();
  }
  const text = [
    !row ? 'לידי בעלים לא הוגדרו' : ownerOn ? 'לידי בעלים פעילים · ' + plural((row.preferred_neighborhoods || []).length, 'שכונה אחת', 'שכונות') : 'לידי בעלים מושהים',
    followOn ? 'משימה לחזור תוך שעה' : '',
  ].filter(Boolean).join(' · ');
  if (sum) sum.textContent = text;
  if (strip) strip.classList.toggle('is-unset', !row);
  if (stripSum) stripSum.textContent = !row ? 'הגדירו אילו לידים לקבל' : text;
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
  alignScrollTabs(document.getElementById('clientsKindTabs'));

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

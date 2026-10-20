/* ==========================================================================
   "נכסים" - מסך אחד לנכסים שלי ולנכסים ששותפו איתי
   --------------------------------------------------------------------------
   שלב 5 בעיצוב מחדש (סעיפים 3.13-3.16; docs/properties-unified.md). מה שכאן
   הוא מה שנוסף מעל הרשימות הקיימות, ולא מנוע חדש:

     · שתי הלשוניות - "הנכסים שלי" ו"שיתופים" (propOwnerTab). ‏accSharedWithMe
       הפך לכינוי של accProperties + הלשונית השנייה (ACC_ALIAS), כדי שקישורים
       מהתראות שכבר נשלחו ומ-notification-push ימשיכו לעבוד
     · "דורש תשומת לב" - צ'יפים עם מונים מעל הרשימה (PR_SMART). הערך נשמר
       בשדה הנסתר #propSmartFilter, שהוא עוד פקד ב-PROP_FILTER_IDS
     · "כלים לנכס" מתחת לכרטיס שנפתח: עסקאות שנסגרו באזור ומידע תכנוני
       ממולאים מכתובת הנכס, ולקוחות מתאימים
     · בלשונית השיתופים: התאמה ללקוחות שלי, חדשים מהשבוע, וסימנייה לשמירה
       (property_bookmarks, 20270713090000). שני אלה נטענים רק כשהלשונית
       נפתחת בפעם הראשונה, כדי לא להוסיף בקשות לכניסה ל-CRM

   הסינון, הכרטיס והפעולות עצמם נשארו ב-assets/crm.js. הקובץ נטען לפני
   crm.js; הפונקציות נקראות רק אחרי שהוא רץ.
   ========================================================================== */

/* ---------- כינויים לקטגוריות שאוחדו ---------- */
const ACC_ALIAS = {
  accSharedWithMe: { acc:'accProperties', tab:'shared' },
};
function accAliasTarget(id){ return ACC_ALIAS[id] ? ACC_ALIAS[id].acc : id; }
function accResolve(id){
  const a = ACC_ALIAS[id];
  if (!a) return id;
  propOwnerTab(a.tab);
  return a.acc;
}

/* ---------- שתי הלשוניות ---------- */
let prOwner = 'mine';

function propOwnerTab(tab){
  if (tab !== 'mine' && tab !== 'shared') return;
  prOwner = tab;
  document.querySelectorAll('[data-pr-owner]').forEach(b => {
    const on = b.dataset.prOwner === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const mine = document.getElementById('prMinePane');
  const shared = document.getElementById('prSharedPane');
  if (mine) mine.hidden = tab !== 'mine';
  if (shared) shared.hidden = tab !== 'shared';
  if (tab === 'shared') prEnsureSharedExtras();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-pr-owner]');
  if (b) propOwnerTab(b.dataset.prOwner);
});
document.addEventListener('keydown', e => {
  const b = e.target.closest('[data-pr-owner]');
  if (!b || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
  e.preventDefault();
  const next = b.dataset.prOwner === 'mine' ? 'shared' : 'mine';
  propOwnerTab(e.key === 'Home' ? 'mine' : e.key === 'End' ? 'shared' : next);
  document.querySelector(`[data-pr-owner="${prOwner}"]`).focus();
});

function prSyncOwnerSubs(){
  const mineSub = document.getElementById('prMineSub');
  if (mineSub && typeof myPropertyRows !== 'undefined'){
    const live = myPropertyRows.filter(p => p.status === 'active').length;
    const arch = myPropertyRows.filter(p => p.status === 'archived').length;
    mineSub.textContent = myPropertyRows.length
      ? [`${live} מפורסמים`, arch ? `${arch} בארכיון` : ''].filter(Boolean).join(' · ')
      : 'עוד אין נכסים';
  }
  const sharedSub = document.getElementById('prSharedSub');
  if (sharedSub && typeof sharedWithMeRows !== 'undefined'){
    const n = sharedWithMeRows.length;
    sharedSub.textContent = n === 1 ? 'נכס אחד שקיבלת' : `${n} נכסים שקיבלת`;
  }
}

/* ---------- "דורש תשומת לב" ----------
   warn: צהוב - מה שדורש פעולה. צ'יפ בלי נכסים לא מוצג (סעיף 2.1: בלי מונה
   כשאין מה לעשות), חוץ מזה שנבחר - אחרת אי אפשר היה לבטל אותו. */
const PR_SMART = [
  { key:'today',   label:'עלו היום',        warn:false,
    test:p => p.status === 'active' && propertyDaysOnMarket(p) === 0 },
  { key:'stale14', label:'14+ ימים בשוק',   warn:true,
    test:p => p.status === 'active' && (propertyDaysOnMarket(p) ?? 0) >= 14 },
  { key:'nophoto', label:'בלי תמונות',      warn:true,
    test:p => p.status === 'active' && !propertyHasImage(p) },
  { key:'excl',    label:'בלעדיות מסתיימת', warn:true,
    test:p => { const d = exclusivityDaysLeft(p); return d !== null && d <= PR_EXCL_SOON_DAYS; } },
  { key:'archive', label:'בארכיון',          warn:false,
    test:p => p.status === 'archived' },
];
// "מסתיימת" - שבועיים, כמו "תוקף נגמר בקרוב" (agent_reminder_expiry_days)
const PR_EXCL_SOON_DAYS = 14;

function prSmartTest(p, key){
  const s = PR_SMART.find(x => x.key === key);
  return !s || s.test(p);
}

function prRenderSmart(){
  const box = document.getElementById('prSmart');
  const input = document.getElementById('propSmartFilter');
  if (!box || !input) return;
  const cur = input.value;
  const rows = typeof myPropertyRows !== 'undefined' ? myPropertyRows : [];
  const chips = PR_SMART.map(s => ({ s, n: rows.filter(s.test).length }))
    .filter(c => c.n || c.s.key === cur);
  box.hidden = !chips.length;
  box.innerHTML = chips.map(({ s, n }) =>
    `<button type="button" class="ui-chip" data-pr-smart="${s.key}" aria-pressed="${s.key === cur}">`
    + `${escapeHtml(s.label)} <span class="ui-chip-n${s.warn && n ? ' is-warn' : ''}">${n}</span></button>`).join('');
}

document.addEventListener('click', e => {
  const chip = e.target.closest('[data-pr-smart]');
  if (!chip) return;
  const input = document.getElementById('propSmartFilter');
  input.value = input.value === chip.dataset.prSmart ? '' : chip.dataset.prSmart;
  /* "בארכיון" מראה את מה שבארכיון גם כשבורר הסטטוס מסנן אחרת */
  if (input.value === 'archive') document.getElementById('propStatusFilter').value = '';
  renderPropertiesFromTop();
});

/* ---------- אייקון הסוג בשורה ---------- */
const PR_ICONS = {
  office:   'M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2',
  apt:      'M4 21V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v17M2 21h20M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2',
  house:    'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  industry: 'M2 20h20M4 20V10l5 3V10l5 3V6h6v14',
  shop:     'M3 9l1.5-5h15L21 9M4 9v11h16V9M9 20v-6h6v6',
  land:     'M3 20h18M5 20l4-8 3 5 2-3 5 6',
};
function prTypeIcon(p){
  const t = String(p.property_type || '');
  const key = /משרד/.test(t) ? 'office'
    : /תעשי|מחסן|לוגיסט/.test(t) ? 'industry'
    : /חנו|מסחר/.test(t) ? 'shop'
    : /קרקע|מגרש|חקלא/.test(t) ? 'land'
    : /בית|קוטג|וילה|דו.?משפ|משק/.test(t) ? 'house'
    : 'apt';
  return `<span class="pr-thumb" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${PR_ICONS[key]}"></path></svg></span>`;
}

/* תגית המצב בשורה: עלה היום (ירוק) / X ימים בשוק / 14+ (צהוב) / בארכיון
   (אפור). סטטוס אחר (ירד מפרסום, נמכר, ממתין לאישור רישיון) - בשמו. */
function prStatusPill(p){
  if (p.status === 'archived') return '<span class="pr-st is-off">בארכיון</span>';
  if (typeof propertyHeldForLicense === 'function' && propertyHeldForLicense(p))
    return `<span class="pr-st is-stale">${escapeHtml(propertyStatusLabel(p))}</span>`;
  if (p.status !== 'active') return `<span class="pr-st is-off">${escapeHtml(propertyStatusLabel(p))}</span>`;
  const d = propertyDaysOnMarket(p);
  if (d === null) return `<span class="pr-st">${escapeHtml(propertyStatusLabel(p))}</span>`;
  if (d === 0) return '<span class="pr-st is-new">עלה היום</span>';
  const text = d === 1 ? 'יום אחד בשוק' : `${d} ימים בשוק`;
  return `<span class="pr-st${d >= 14 ? ' is-stale' : ''}">${text}</span>`;
}

/* ---------- כלים לנכס ----------
   מתחת לכרטיס שנפתח. הכלים עצמם הם המסכים הקיימים (accDealsLookup,
   accPlanning) - כאן רק ממלאים את הכתובת ומריצים. המידע התכנוני הוא עפולה
   בלבד (STREET_PLANNING_CITY); לנכס בעיר אחרת הכלי מופיע רק כשכבר נשמר
   לו מידע תכנוני. */
function prToolsRow(p, panel){
  const row = document.createElement('div');
  row.className = 'ui-scope pr-tools';
  const planningCity = typeof STREET_PLANNING_CITY !== 'undefined' ? STREET_PLANNING_CITY : 'עפולה';
  const planning = typeof propertyPlanningInfo !== 'undefined' && propertyPlanningInfo[p.id];
  const matched = (typeof propertyMatchedClients !== 'undefined' && propertyMatchedClients[p.id]) || [];
  const tools = [
    p.city && { key:'deals', label:'עסקאות שנסגרו באזור' },
    (planning || p.city === planningCity) && { key:'plan', label:'מידע תכנוני' },
    matched.length && { key:'match', label: matched.length === 1 ? 'לקוח/ה מתאים/ה' : `${matched.length} לקוחות מתאימים` },
  ].filter(Boolean);
  if (!tools.length) return row;
  row.innerHTML = '<span class="pr-tools-label">כלים לנכס:</span>'
    + tools.map(t => `<button type="button" class="pr-tool" data-pr-tool="${t.key}">${escapeHtml(t.label)}</button>`).join('');
  row.addEventListener('click', e => {
    const b = e.target.closest('[data-pr-tool]');
    if (!b) return;
    if (b.dataset.prTool === 'deals') prOpenDeals(p);
    else if (b.dataset.prTool === 'plan') prOpenPlanning(p, planning);
    else {
      // רשימת הלקוחות כבר בכרטיס (bindMatchedClients) - פותחים אותה שם
      const btn = panel.querySelector('.pc-matched');
      if (!btn) return;
      if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
      const list = panel.querySelector('.pc-matched-list') || btn;
      list.scrollIntoView({ behavior: navReduceMotion() ? 'auto' : 'smooth', block:'center' });
    }
  });
  return row;
}

function prSetVal(id, v){
  const el = document.getElementById(id);
  if (el) el.value = v == null ? '' : String(v);
}

function prOpenDeals(p){
  prSetVal('mdCity', p.city);
  prSetVal('mdStreet', p.street);
  prSetVal('mdHouseNum', p.house_number);
  const type = document.getElementById('mdType');
  if (type) type.value = [...type.options].some(o => o.value && o.value === p.property_type) ? p.property_type : '';
  gotoSection('accDealsLookup', null, { scrollTo:'#mdResults' });
  document.getElementById('mdLookupBtn')?.click();
}

function prOpenPlanning(p, planning){
  if (planning && typeof renderPlanningResult === 'function'){
    renderPlanningResult(planning);
    gotoSection('accPlanning', null, { scrollTo:'#planResultPanel' });
    return;
  }
  prSetVal('planStreet', p.street);
  prSetVal('planHouseNum', p.house_number);
  prSetVal('planGush', '');
  prSetVal('planHelka', '');
  gotoSection('accPlanning', null, { scrollTo:'#planResultPanel' });
  document.getElementById('planLookupBtn')?.click();
}

/* ---------- שיתופים: התאמות, סימניות ---------- */
let sharedMatchCounts = {};      // property_id → כמה מהלקוחות שלי הנכס מתאים להם
let prBookmarks = new Set();     // property_id
let prBookmarksReady = false;    // הטבלה קיימת (המיגרציה רצה)
let prSharedExtrasP = null;

/* נטען בפתיחה הראשונה של הלשונית, ושוב אחרי "רענון" */
function prEnsureSharedExtras(force){
  if (prSharedExtrasP && !force) return prSharedExtrasP;
  prSharedExtrasP = prLoadSharedExtras().then(() => {
    if (typeof renderSharedWithMe === 'function') renderSharedWithMe();
  });
  return prSharedExtrasP;
}

async function prLoadSharedExtras(){
  if (typeof sb === 'undefined' || !currentAgent) return;
  const ids = (typeof sharedWithMeRows !== 'undefined' ? sharedWithMeRows : []).map(r => r.property_id).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const [bm, ...matchRes] = await Promise.all([
    sb.from('property_bookmarks').select('property_id'),
    ...chunks.map(c => sb.from('client_match_alerts')
      .select('property_id, client_id, agent_clients(status)')
      .in('property_id', c).neq('status', 'dismissed')),
  ]);
  prBookmarksReady = !bm.error;
  prBookmarks = new Set((bm.data || []).map(r => r.property_id));
  const seen = new Set();
  sharedMatchCounts = {};
  matchRes.forEach(({ data }) => (data || []).forEach(r => {
    if (!r.agent_clients || r.agent_clients.status === 'closed') return;
    const k = r.property_id + '|' + r.client_id;
    if (seen.has(k)) return;
    seen.add(k);
    sharedMatchCounts[r.property_id] = (sharedMatchCounts[r.property_id] || 0) + 1;
  }));
  prSyncPartnersSub();
}

const PR_MARK_SVG = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';

/* הסימנייה ליד כותרת השורה (buildSharedTab) */
function prAddBookmark(el, r){
  if (!prBookmarksReady || !r.property_id) return;
  const on = prBookmarks.has(r.property_id);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pr-mark';
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', (on ? 'הסרה מהשמורים: ' : 'שמירה: ') + propertyTabAddress(r));
  btn.innerHTML = PR_MARK_SVG;
  btn.addEventListener('click', () => prToggleBookmark(r, btn));
  el.classList.add('has-mark');
  el.querySelector('.prop-tab-head').insertAdjacentElement('afterend', btn);
}

async function prToggleBookmark(r, btn){
  const id = r.property_id;
  const on = !prBookmarks.has(id);
  btn.disabled = true;
  const { error } = on
    ? await sb.from('property_bookmarks').insert({ agent_id: currentAgent.id, property_id: id })
    : await sb.from('property_bookmarks').delete().eq('agent_id', currentAgent.id).eq('property_id', id);
  btn.disabled = false;
  if (error && !(on && /duplicate|23505/.test(error.message || error.code || ''))){
    showToast('השמירה נכשלה: ' + heErr(error));
    return;
  }
  if (on) prBookmarks.add(id); else prBookmarks.delete(id);
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', (on ? 'הסרה מהשמורים: ' : 'שמירה: ') + propertyTabAddress(r));
  // הרשימה מסוננת לפי "שמורים"? נכס שהוסר יוצא ממנה
  renderSharedWithMe();
}

/* "32 מתוך 32 משרדים" - כשרשימת משרדי השת"פ כבר נטענה (loadSharePartners) */
function prSyncPartnersSub(){
  const el = document.getElementById('prPartnersSub');
  if (!el || typeof sharePartnerAgencies === 'undefined' || !sharePartnerAgencies.length) return;
  const total = sharePartnerAgencies.length;
  const on = total - sharePartnerAgencies.filter(a => shareExcludedIds.has(a.id)).length;
  el.textContent = `${on} מתוך ${total} משרדים · אפשר להוסיף ולהסיר`;
}

/* קיבוץ לפי תאריך השיתוף (3.14) */
function prSharedGroup(ts){
  const t = ts ? new Date(ts).getTime() : NaN;
  if (!Number.isFinite(t)) return 'קודם';
  const days = (Date.now() - t) / 86400000;
  if (days < 1) return 'היום';
  if (days < 7) return 'השבוע';
  if (days < 31) return 'החודש';
  return 'קודם';
}

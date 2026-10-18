/* ==========================================================================
   דף הבית של הסוכן/ת - "לוח היום" (#homeBoard)
   --------------------------------------------------------------------------
   שלב 2 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 2.6;
   docs/crm-home.md). ארבעה בלוקים מתחת לשורת "דורש טיפול מיידי":

     1. לידים שמחכים לך - הלידים עצמם, עם חיוג ווואטסאפ ושעון בלעדיות
     2. היום שלי        - הפגישות והמשימות של היום ומה שבאיחור
     3. איפה הלקוחות שלי - כמה לידים בכל שלב טיפול (lead_work.stage)
     4. הנכסים שלי       - צפיות ופניות לכל נכס פעיל, ומה כדאי לעשות

   **אין כאן שום שאילתה.** כל מה שמוצג כבר בזיכרון מהטעינה של הדשבורד:
   allLeads / archivedLeadIds / leadWork (loadLeads), agendaItems
   (loadAgenda), myPropertyRows / propertyViewCounts (loadProperties) ו-
   priceOf (loadPricing). הלוח נבנה מחדש ב-refreshNavCounts, שכבר מתקבץ
   לבנייה אחת לפריים - כלומר בכל פעם שאחת הטעינות האלה מסתיימת.

   **חיוג או וואטסאפ לליד קוראים ל-markLeadResponded** - אחרת זמן התגובה
   לא נרשם (docs/office-dashboard.md). ליד נעול אינו נפתח מכאן: הלחיצה
   מובילה לכרטיס שלו, שם המחיר של הפתיחה גלוי לפני שמשלמים.

   הקובץ נטען לפני assets/crm.js, וכל הפונקציות כאן נקראות רק אחרי שהוא
   רץ - ולכן הגלובלים שלו (esc, dashIcon, gotoSection...) זמינים בזמן הקריאה.
   ========================================================================== */

const HOME_LEADS_MAX = 3;
const HOME_AGENDA_MAX = 4;
const HOME_PROPS_MAX = 3;
/* ליד פתוח נחשב "מחכה" רק בשבועיים הראשונים. ליד מלפני חודש בלי שלב הוא
   ליד שנשכח לעדכן, לא ליד שמחכה לטלפון - והוא היה תופס את הבלוק לעד. */
const HOME_WAITING_DAYS = 14;
/* השלבים בצנרת, בסדר שבו ליד מתקדם. "לא רלוונטי / לא ענה" אינו שלב בדרך
   לעסקה, ולכן אינו עמודה - הוא נספר בשורה שמתחת. */
const HOME_PIPE = [
  ['new',       'חדש'],
  ['contacted', 'בקשר'],
  ['meeting',   'פגישה / סיור'],
  ['won',       'נסגר'],
];

let homeTick = 0;

function homeMine(lead){
  return !!(lead && currentAgent && lead.agent_id === currentAgent.id);
}

function homeActiveLeads(){
  if (typeof allLeads === 'undefined') return [];
  return allLeads.filter(l => homeMine(l) && !archivedLeadIds.has(l.id));
}

function homeStageOf(lead){
  const w = leadWork.get(lead.id);
  return (w && w.stage) || 'new';
}

/* חלון הבלעדיות של ליד בעלים - אותו תנאי של claim_lead במסד
   (20261230090000): owner_inbound שלא הגיע מהדף של הסוכן/ת או המשרד,
   ונעול. השעות מ-pricing_config (owner_lead_exclusivity_hours). אחרי
   החלון הליד פתוח גם לאחרים, ולכן השעון הוא הסיבה לפתוח אותו עכשיו. */
function homeExclusiveEnd(lead){
  if (lead.lead_type !== 'owner_inbound' || lead.status === 'unlocked') return null;
  if (lead.source === 'agency_page' || lead.source === 'agent_page') return null;
  const hours = Number(priceOf('owner_lead_exclusivity_hours', 0));
  const born = new Date(lead.created_at || 0).getTime();
  if (!hours || !born) return null;
  const end = born + hours * 3600e3;
  return end > Date.now() ? end : null;
}

function homeClock(ms){
  const m = Math.max(0, Math.floor(ms / 60000));
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

/* מי מחכה: ליד נעול שלי (מחכה שאפתח אותו), וליד פתוח בשלב "חדש" מהשבועיים
   האחרונים שעוד לא פניתי אליו מהמסך הזה. קודם מה שהבלעדיות שלו נגמרת
   ראשונה, ואחריו הטרי ביותר. */
function homeWaitingLeads(){
  const horizon = HOME_WAITING_DAYS * 1440;
  return homeActiveLeads()
    .filter(l => l.status !== 'unlocked'
      || (homeStageOf(l) === 'new' && !l._responded && leadAgeMinutes(l) < horizon))
    .map(l => ({ lead:l, end: homeExclusiveEnd(l) }))
    .sort((a, b) => (a.end || Infinity) - (b.end || Infinity)
      || new Date(b.lead.created_at) - new Date(a.lead.created_at));
}

function homeLeadRow(item){
  const lead = item.lead;
  const ctx = leadPropertyContext(lead);
  const kind = leadKind(lead);
  const unlocked = lead.status === 'unlocked';
  const about = ctx.title || [lead.property_type, lead.city].filter(Boolean).join(' · ');
  const row = document.createElement('div');
  row.className = 'hb-lead';
  row.innerHTML =
      '<div class="hb-lead-text">'
    +   '<span class="hb-lead-t">' + esc(kind.label.split(' · ')[0] + (about ? ' · ' + about : '')) + '</span>'
    +   '<span class="hb-lead-s">' + (unlocked ? '' : '🔒 ') + esc(lead.display_name || 'פונה')
    +     ' · ' + esc(opsAgo(leadAgeMinutes(lead))) + '</span>'
    + '</div>'
    + (item.end ? '<span class="hb-excl" data-end="' + item.end + '" title="עד אז הליד שמור לך">'
        + dashIcon('clock') + '<span class="hb-excl-t">' + esc(homeClock(item.end - Date.now())) + '</span>'
        + '<span class="hb-excl-l">בלעדיות</span></span>' : '');

  const acts = document.createElement('div');
  acts.className = 'hb-lead-acts';
  const tel = String(lead.display_phone || '').replace(/[^\d+]/g, '');
  const wa = unlocked ? waLink(lead.display_phone) : null;
  if (unlocked && tel.replace(/\D/g, '').length >= 9){
    const a = document.createElement('a');
    a.className = 'hb-btn hb-btn-main';
    a.href = 'tel:' + tel;
    a.innerHTML = dashIcon('phone') + '<span>התקשרות</span>';
    a.addEventListener('click', ()=> markLeadResponded(lead));
    acts.appendChild(a);
  }
  if (wa){
    const a = document.createElement('a');
    a.className = 'hb-btn';
    a.href = wa + '?text=' + encodeURIComponent(leadWhatsAppText(lead, ctx));
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = '<span class="hb-wa">' + waGlyph() + '</span><span>וואטסאפ</span>';
    a.addEventListener('click', ()=> markLeadResponded(lead));
    acts.appendChild(a);
  }
  if (!acts.children.length){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hb-btn hb-btn-main';
    b.innerHTML = dashIcon('inbox') + '<span>' + (unlocked ? 'לכרטיס הליד' : 'לפתיחת הליד') + '</span>';
    b.addEventListener('click', ()=>{ gotoSection('accLeads'); openLeadFromParam(lead.id); });
    acts.appendChild(b);
  }
  row.appendChild(acts);
  return row;
}

function homeCard(id, title, linkText, onLink){
  const card = document.createElement('section');
  card.className = 'hb-card';
  card.id = id;
  card.setAttribute('aria-label', title);
  const head = document.createElement('div');
  head.className = 'hb-head';
  head.innerHTML = '<h3>' + esc(title) + '</h3>';
  if (linkText){
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'hb-link';
    a.textContent = linkText + ' ←';
    a.addEventListener('click', onLink);
    head.appendChild(a);
  }
  card.appendChild(head);
  return card;
}

function homeLeadsCard(){
  if (!navAccVisible('accLeads')) return null;
  const waiting = homeWaitingLeads();
  const card = homeCard('hbLeads', 'לידים שמחכים לך',
    waiting.length ? 'לכל הלידים' : '', ()=> gotoSection('accLeads'));
  if (!waiting.length){
    card.insertAdjacentHTML('beforeend',
      '<p class="hb-empty">' + dashIcon('check') + '<span>אין ליד שמחכה לך עכשיו</span></p>');
    return card;
  }
  waiting.slice(0, HOME_LEADS_MAX).forEach(item => card.appendChild(homeLeadRow(item)));
  const more = waiting.length - HOME_LEADS_MAX;
  if (more > 0){
    card.insertAdjacentHTML('beforeend',
      '<p class="hb-more">ועוד ' + esc(plural(more, 'ליד אחד', 'לידים')) + ' ברשימה</p>');
  }
  return card;
}

/* ---------- היום שלי ----------
   מה שפתוח עד סוף היום, כולל מה שבאיחור - אותו "היום" של agendaBuckets
   ושל המונה בבלוק "דורש טיפול מיידי". */
function homeAgendaCard(){
  if (!navAccVisible('accAgenda') || typeof agendaBuckets !== 'function') return null;
  const today = agendaBuckets().today
    .slice().sort((a, b) => (agendaDue(a) || 0) - (agendaDue(b) || 0));
  const card = homeCard('hbToday', 'היום שלי', 'ליומן', ()=> gotoSection('accAgenda'));
  if (!today.length){
    card.insertAdjacentHTML('beforeend',
      '<p class="hb-empty">' + dashIcon('calendar') + '<span>אין פגישות או משימות להיום</span></p>');
  }
  today.slice(0, HOME_AGENDA_MAX).forEach(it=>{
    const late = agendaIsLate(it);
    const d = agendaDue(it);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'hb-ag' + (late ? ' is-late' : '');
    row.innerHTML =
        '<span class="hb-ag-time">' + esc(late ? 'באיחור'
          : d ? d.toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' }) : '') + '</span>'
      + '<span class="hb-ag-text"><span class="hb-ag-t">' + esc(it.title || '') + '</span>'
      + (it.location ? '<span class="hb-ag-s">' + esc(it.location) + '</span>' : '') + '</span>';
    row.addEventListener('click', ()=> agendaFocus(it.id));
    card.appendChild(row);
  });
  if (today.length > HOME_AGENDA_MAX){
    card.insertAdjacentHTML('beforeend', '<p class="hb-more">ועוד '
      + esc(plural(today.length - HOME_AGENDA_MAX, 'פריט אחד', 'פריטים')) + ' ביומן</p>');
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'hb-add';
  add.textContent = '+ פגישה או משימה';
  add.addEventListener('click', ()=> openAgendaForm({ kind:'meeting' }));
  card.appendChild(add);
  return card;
}

/* ---------- איפה הלקוחות שלי ----------
   הלידים הפעילים שלי לפי השלב ב-lead_work. ליד בלי שורה שם הוא "חדש" -
   אותה ברירת מחדל של הבורר בכרטיס. רק כשהטבלה קיימת (leadWorkReady). */
function homePipelineCard(){
  if (!navAccVisible('accLeads') || !leadWorkReady) return null;
  const leads = homeActiveLeads();
  if (!leads.length) return null;
  const counts = {};
  leads.forEach(l => { const s = homeStageOf(l); counts[s] = (counts[s] || 0) + 1; });
  const max = Math.max(1, ...HOME_PIPE.map(([k]) => counts[k] || 0));
  const card = homeCard('hbPipe', 'איפה הלקוחות שלי', 'ללידים', ()=> gotoSection('accLeads'));
  const grid = document.createElement('div');
  grid.className = 'hb-pipe';
  HOME_PIPE.forEach(([key, label])=>{
    const n = counts[key] || 0;
    grid.insertAdjacentHTML('beforeend',
      '<div class="hb-stage hb-st-' + key + '"><span class="hb-stage-n">' + esc(String(n)) + '</span>'
      + '<span class="hb-stage-l">' + esc(label) + '</span>'
      + '<span class="hb-stage-bar"><span style="height:' + Math.round(n / max * 100) + '%"></span></span></div>');
  });
  card.appendChild(grid);
  const off = counts.not_relevant || 0;
  if (off){
    card.insertAdjacentHTML('beforeend', '<p class="hb-more">'
      + esc(plural(off, 'ליד אחד סומן', 'לידים סומנו')) + ' "לא רלוונטי / לא ענה"</p>');
  }
  return card;
}

/* ---------- הנכסים שלי ----------
   הצפיות הן המונה המצטבר מכרטיס הנכס (property_view_counts), והפניות הן
   הלידים שלי על הנכס - שני המספרים שהכרטיס עצמו כבר מציג. אין כאן חלון
   של 7 ימים כמו בעיצוב, כי אין מקור כזה בלי שאילתה חדשה.
   המוביל מסומן, ולשני האחרים - הפעולה שמתאימה להם: נכס בלי תמונות מקבל
   "להוספת תמונות", ונכס בלי פניות - "לקידום". שתיהן פותחות את הכרטיס,
   שם הכפתורים עצמם עם המחיר של היום. */
function homePropsCard(){
  if (!navAccVisible('accProperties') || typeof myPropertyRows === 'undefined') return null;
  const active = myPropertyRows.filter(p => p.status === 'active' && homeMine(p));
  if (!active.length) return null;
  const inquiries = {};
  homeActiveLeads().forEach(l => { if (l.property_id) inquiries[l.property_id] = (inquiries[l.property_id] || 0) + 1; });
  const score = p => (propertyViewCounts[p.id] || 0) + 20 * (inquiries[p.id] || 0);
  const sorted = active.slice().sort((a, b) => score(b) - score(a));
  const leader = sorted[0];
  const noPhotos = active.find(p => !(p.images || []).length);
  const quiet = sorted.slice().reverse().find(p => p !== leader && p !== noPhotos && !(inquiries[p.id] || 0));
  const pick = [leader, noPhotos, quiet].filter((p, i, arr) => p && arr.indexOf(p) === i).slice(0, HOME_PROPS_MAX);

  const card = homeCard('hbProps', 'הנכסים שלי', 'לכל הנכסים', ()=> gotoSection('accProperties'));
  pick.forEach(p=>{
    const views = propertyViewCounts[p.id] || 0;
    const inq = inquiries[p.id] || 0;
    const missing = !(p.images || []).length;
    let tag = '', cta = '';
    if (p === leader && score(p) > 0) tag = '<span class="hb-tag is-ok">מוביל</span>';
    else if (missing) cta = 'להוספת תמונות';
    else if (!inq) cta = 'לקידום';
    const row = document.createElement('div');
    row.className = 'hb-prop';
    row.innerHTML =
        '<span class="hb-prop-text"><span class="hb-prop-t">' + esc(p.title || p.address || 'נכס') + '</span>'
      + '<span class="hb-prop-s">' + esc(missing ? 'חסרות תמונות'
          : plural(views, 'צפייה אחת', 'צפיות') + ' · ' + plural(inq, 'פנייה אחת', 'פניות')) + '</span></span>'
      + tag;
    if (cta){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hb-btn';
      b.textContent = cta;
      b.addEventListener('click', ()=>{ gotoSection('accProperties'); openPropertyFromParam(p.id); });
      row.appendChild(b);
    } else {
      row.classList.add('is-click');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const open = ()=>{ gotoSection('accProperties'); openPropertyFromParam(p.id); };
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });
    }
    card.appendChild(row);
  });
  return card;
}

/* השורה שמתחת לברכה: מה מחכה היום, במשפט אחד. הברכה עצמה ומשפטי
   המוטיבציה (GREETINGS) לא משתנים - החלטה של תומר. */
function homeBrief(){
  const el = document.getElementById('dashBrief');
  if (!el) return;
  const leads = navAccVisible('accLeads') ? homeWaitingLeads().length : 0;
  const meetings = navAccVisible('accAgenda') && typeof agendaBuckets === 'function'
    ? agendaBuckets().today.filter(it => it.kind !== 'task' && !agendaIsLate(it)).length : 0;
  const parts = [];
  if (leads) parts.push(plural(leads, 'ליד אחד מחכה לך', 'לידים מחכים לך'));
  if (meetings) parts.push(plural(meetings, 'פגישה אחת היום', 'פגישות היום'));
  el.textContent = parts.length ? parts.join(' ויש ') + '.' : '';
  el.hidden = !parts.length;
}

function renderHomeBoard(){
  // כפתור "המנטור" - לפי מה שנטען עד עכשיו (assets/crm-coach.js)
  if (typeof homeCoachSync === 'function') homeCoachSync();
  const host = document.getElementById('homeBoard');
  if (!host) return;
  if (dashView !== 'agent' || !currentAgent){ host.hidden = true; return; }
  const cards = [homeLeadsCard(), homeAgendaCard(), homePipelineCard(), homePropsCard()].filter(Boolean);
  host.innerHTML = '';
  cards.forEach(c => host.appendChild(c));
  host.hidden = !cards.length;
  homeBrief();
  homeArmTick();
}

/* השעון של הבלעדיות זז בלי לבנות את הלוח מחדש: פעם בחצי דקה, רק הטקסט.
   כשהזמן נגמר - בנייה מלאה, כי הליד כבר אינו שמור ויוצא מהמיון. */
function homeArmTick(){
  const any = document.querySelector('#homeBoard .hb-excl');
  if (!any){ if (homeTick){ clearInterval(homeTick); homeTick = 0; } return; }
  if (homeTick) return;
  homeTick = setInterval(()=>{
    let expired = false;
    document.querySelectorAll('#homeBoard .hb-excl').forEach(el=>{
      const left = Number(el.dataset.end) - Date.now();
      if (left <= 0) expired = true;
      const t = el.querySelector('.hb-excl-t');
      if (t) t.textContent = homeClock(left);
    });
    if (expired) renderHomeBoard();
  }, 30000);
}
